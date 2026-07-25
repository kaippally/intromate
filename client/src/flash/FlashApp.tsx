import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mosaic, MosaicWindow, type MosaicNode } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import * as api from './api';
import * as M from './mutations';
import { findSymbol, symbolLength, type FlashDoc, type Keyframe, type Node } from './model';
import { useHistory } from '../lib/history';
import { useKeymap } from './keymap';
import { FlashStage } from './FlashStage';
import { LibraryPanel } from './panels/LibraryPanel';
import { TimelinePanel } from './panels/TimelinePanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { ShortcutManager } from './ShortcutManager';
import { SettingsPanel } from './SettingsPanel';
import { useContextMenu, type MenuItem } from './ContextMenu';
import { MediaPicker } from '../components/MediaPicker';
import type { MediaItem } from '../types';

type PanelId = 'library' | 'stage' | 'timeline' | 'inspector';
const LAST_DOC = 'flash:lastDoc';
const LAYOUT_KEY = 'flash:layout';

const DEFAULT_LAYOUT: MosaicNode<PanelId> = {
  direction: 'row',
  first: 'library',
  second: {
    direction: 'row',
    first: { direction: 'column', first: 'stage', second: 'timeline', splitPercentage: 62 },
    second: 'inspector',
    splitPercentage: 78,
  },
  splitPercentage: 18,
};

export default function FlashApp() {
  const { present: doc, commit, undo, redo, reset, canUndo, canRedo } = useHistory<FlashDoc | null>(null);
  const [docs, setDocs] = useState<api.DocMeta[]>([]);
  const [stack, setStack] = useState<string[]>([]);          // breadcrumb: symbol ids, last = editing
  const [frame, setFrame] = useState(0);
  const [selNodes, setSelNodes] = useState<string[]>([]);
  const selNode = selNodes[selNodes.length - 1] ?? null;   // the "primary" node (inspector / transform box)
  const selectOne = useCallback((id: string | null) => setSelNodes(id ? [id] : []), []);
  const toggleNode = useCallback((id: string) => setSelNodes(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id])), []);
  const [selKf, setSelKf] = useState<{ layerId: string; frame: number } | null>(null);
  const [selLayer, setSelLayer] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [replaceReq, setReplaceReq] = useState<{ nodeId: string; kind: 'image' | 'video' } | null>(null);
  const [layout, setLayout] = useState<MosaicNode<PanelId>>(() => {
    try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null') || DEFAULT_LAYOUT; } catch { return DEFAULT_LAYOUT; }
  });
  const loaded = useRef(false);
  const ctx = useContextMenu();

  const editingSymbolId = stack[stack.length - 1] ?? doc?.rootSymbol ?? '';
  const editingSymbol = doc ? findSymbol(doc, editingSymbolId) : null;

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const list = await api.listDocs().catch(() => []);
      setDocs(list);
      const last = localStorage.getItem(LAST_DOC);
      const pick = list.find(d => d.id === last) ?? list[0];
      const d = pick ? await api.loadDoc(pick.id) : await api.createDoc('Untitled');
      reset(d); setStack([d.rootSymbol]); loaded.current = true;
    })();
  }, []); // eslint-disable-line

  useEffect(() => { if (doc) localStorage.setItem(LAST_DOC, doc.id); }, [doc?.id]);
  useEffect(() => { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); }, [layout]);

  // Ctrl/⌘+wheel is captured by the Stage and Timeline for zoom — never the browser's page zoom.
  // A capture-phase, non-passive guard cancels the gesture everywhere in the app; region handlers
  // (which don't stopPropagation) still run and do the actual zoom.
  useEffect(() => {
    const stop = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    window.addEventListener('wheel', stop, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', stop, { capture: true } as EventListenerOptions);
  }, []);

  // Autosave the whole tree (server flattens it into SQL).
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!doc || !loaded.current) return;
    if (saveT.current) clearTimeout(saveT.current);
    saveT.current = setTimeout(() => api.saveDoc(doc).then(() => api.listDocs().then(setDocs)).catch(() => {}), 800);
    return () => { if (saveT.current) clearTimeout(saveT.current); };
  }, [doc]);

  // ── Playback ─────────────────────────────────────────────────────────────────
  const frameRef = useRef(frame); frameRef.current = frame;
  useEffect(() => {
    if (!playing || !doc || !editingSymbol) return;
    const len = Math.max(1, symbolLength(editingSymbol));
    // A loop/stop point (set from the timeline right-click menu) overrides the natural end: the
    // playhead either loops back to 0 or halts when it reaches that frame.
    const stopAt = editingSymbol.loopFrame != null && editingSymbol.loopFrame > 0 ? editingSymbol.loopFrame : null;
    const action = editingSymbol.loopAction ?? 'loop';
    const period = 1000 / (doc.fps || 24);
    let raf = 0, last = performance.now(), acc = 0;
    const tick = (now: number) => {
      acc += now - last; last = now;
      let steps = 0;
      while (acc >= period) { acc -= period; steps++; }
      if (steps) {
        let nf = frameRef.current + steps;
        if (stopAt != null && nf >= stopAt) {
          if (action === 'stop') { frameRef.current = stopAt; setFrame(stopAt); setPlaying(false); return; }
          nf = nf % stopAt;                     // loop back within [0, stopAt)
        } else {
          nf = nf % len;
        }
        frameRef.current = nf; setFrame(nf);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, doc?.fps, editingSymbol]);

  // ── Context navigation (breadcrumb) ───────────────────────────────────────────
  const editSymbol = useCallback((symId: string) => {
    if (!doc) return;
    setStack(symId === doc.rootSymbol ? [doc.rootSymbol] : [doc.rootSymbol, symId]);
    setFrame(0); setSelNodes([]); setSelKf(null);
  }, [doc]);
  const diveInto = useCallback((symId: string) => {
    setStack(s => [...s, symId]); setFrame(0); setSelNodes([]); setSelKf(null);
  }, []);
  const gotoCrumb = (i: number) => { setStack(s => s.slice(0, i + 1)); setFrame(0); setSelNodes([]); setSelKf(null); };

  // The layer commands target: the selected layer, else the top layer.
  const targetLayerId = useMemo(() => selLayer ?? (editingSymbol ? [...editingSymbol.layers].sort((a, b) => b.ord - a.ord)[0]?.id ?? null : null), [selLayer, editingSymbol]);

  const selectedNode: Node | null = useMemo(() => {
    if (!editingSymbol || !selNode) return null;
    for (const l of editingSymbol.layers) for (const k of l.keyframes) { const n = k.nodes.find(n => n.id === selNode); if (n) return n; }
    return null;
  }, [editingSymbol, selNode]);
  const selectedKeyframe: Keyframe | null = useMemo(() => {
    if (!editingSymbol || !selKf) return null;
    const l = editingSymbol.layers.find(l => l.id === selKf.layerId);
    return l?.keyframes.find(k => k.frame === selKf.frame) ?? null;
  }, [editingSymbol, selKf]);

  // ── Mutations helper ──────────────────────────────────────────────────────────
  const mut = useCallback((fn: (d: FlashDoc) => FlashDoc, key?: string) => {
    commit(d => (d ? fn(d) : d), key);
  }, [commit]);

  // Sorted, de-duplicated keyframe frames for Ctrl+Left/Right navigation — the selected layer's
  // keyframes when a layer is selected, otherwise the union across the whole timeline.
  const keyframeFrames = useCallback((): number[] => {
    if (!editingSymbol) return [];
    const layers = selLayer ? editingSymbol.layers.filter(l => l.id === selLayer) : editingSymbol.layers;
    const set = new Set<number>();
    for (const l of layers) for (const k of l.keyframes) set.add(k.frame);
    return [...set].sort((a, b) => a - b);
  }, [editingSymbol, selLayer]);

  // ── Command handlers (every catalogue id → a function) ─────────────────────────
  const H: Record<string, () => void> = doc && editingSymbol ? {
    'file.new': async () => { const d = await api.createDoc(`Untitled ${docs.length + 1}`); setDocs(await api.listDocs()); reset(d); setStack([d.rootSymbol]); },
    'file.save': () => { if (doc) api.saveDoc(doc); },
    'file.export': () => alert('Render/export uses the same frame stepper as the preview — wiring the Flash doc into the exporter is the next slice.'),

    'edit.undo': undo,
    'edit.redo': redo,
    'edit.duplicate': () => {
      if (!selNode) return;
      const r = M.duplicateNode(doc, editingSymbolId, selNode, false); // copy onto its own new layer
      if (r.nodeId) { commit(() => r.doc); setSelNodes([r.nodeId]); setSelLayer(r.layerId); }
    },
    'edit.delete': () => { if (selNodes.length) { const ids = selNodes; mut(d => ids.reduce((dd, id) => M.deleteNode(dd, editingSymbolId, id), d)); setSelNodes([]); } },

    'play.toggle': () => setPlaying(p => !p),
    'play.stop': () => { setPlaying(false); setFrame(0); },
    'play.first': () => setFrame(0),
    'play.last': () => setFrame(Math.max(0, symbolLength(editingSymbol) - 1)),
    'play.next': () => setFrame(f => f + 1),
    'play.prev': () => setFrame(f => Math.max(0, f - 1)),
    // Jump between keyframes — on the selected layer if one is selected, else across all layers.
    'play.nextKf': () => { const fs = keyframeFrames(); const n = fs.find(f => f > frame); if (n != null) setFrame(n); },
    'play.prevKf': () => { const fs = keyframeFrames(); const p = [...fs].reverse().find(f => f < frame); if (p != null) setFrame(p); },

    'tl.keyframe': () => { if (targetLayerId) mut(d => M.insertKeyframe(d, editingSymbolId, targetLayerId, frame, false), 'kf'); },
    'tl.blankKey': () => { if (targetLayerId) mut(d => M.insertKeyframe(d, editingSymbolId, targetLayerId, frame, true), 'kf'); },
    'tl.frame': () => setFrame(f => f + 1),
    'tl.removeFrame': () => { if (targetLayerId) mut(d => M.deleteKeyframe(d, editingSymbolId, targetLayerId, frame)); },
    'tl.clearKey': () => { if (targetLayerId) mut(d => M.deleteKeyframe(d, editingSymbolId, targetLayerId, frame)); },
    'tl.motionTween': () => { if (targetLayerId) mut(d => M.patchKeyframe(d, editingSymbolId, targetLayerId, activeFrame(d, editingSymbolId, targetLayerId, frame), { tween: 'motion', ease: [0.25, 0.1, 0.25, 1] })); },
    'tl.addLayer': () => mut(d => M.addLayer(d, editingSymbolId)),
    'tl.deleteLayer': () => { if (targetLayerId) mut(d => M.deleteLayer(d, editingSymbolId, targetLayerId)); },

    'obj.newTimeline': () => {
      if (!targetLayerId) return;
      const r = M.newNestedTimeline(doc, editingSymbolId, targetLayerId, frame);
      commit(() => r.doc); setSelNodes([r.nodeId]); diveInto(r.symbolId);
    },
    'obj.convert': () => {
      if (!targetLayerId || !selNode) return;
      const r = M.selectionToTimeline(doc, editingSymbolId, targetLayerId, frame, [selNode]);
      if (r) { commit(() => r.doc); setSelNodes([r.nodeId]); }
    },

    'lib.newSymbol': () => { const name = prompt('Symbol name', `Symbol ${doc.symbols.length}`); if (name) { const r = M.addSymbol(doc, name, 'movieclip'); commit(() => r.doc); editSymbol(r.id); } },
    'lib.convert': () => { if (targetLayerId && selNode) { const r = M.selectionToTimeline(doc, editingSymbolId, targetLayerId, frame, [selNode]); if (r) { commit(() => r.doc); setSelNodes([r.nodeId]); } } },
    'lib.import': () => {/* handled in Library panel button */},
    'lib.duplicate': () => { if (selectedNode?.symbolRef) { const r = M.duplicateSymbol(doc, selectedNode.symbolRef); commit(() => r.doc); } },
    'lib.edit': () => { if (selectedNode?.kind === 'instance' && selectedNode.symbolRef) diveInto(selectedNode.symbolRef); },
    'lib.addText': () => { if (targetLayerId) { const r = M.addTextNode(doc, editingSymbolId, targetLayerId, frame); commit(() => r.doc); setSelNodes([r.nodeId]); } },
    'lib.addRect': () => { if (targetLayerId) { const r = M.addShapeNode(doc, editingSymbolId, targetLayerId, frame, 'rect'); commit(() => r.doc); setSelNodes([r.nodeId]); } },
    'lib.addEllipse': () => { if (targetLayerId) { const r = M.addShapeNode(doc, editingSymbolId, targetLayerId, frame, 'ellipse'); commit(() => r.doc); setSelNodes([r.nodeId]); } },

    'arr.raiseLayer': () => { if (targetLayerId) mut(d => M.reorderLayer(d, editingSymbolId, targetLayerId, 1)); },
    'arr.lowerLayer': () => { if (targetLayerId) mut(d => M.reorderLayer(d, editingSymbolId, targetLayerId, -1)); },

    'sel.nudgeLeft': () => nudge(-1, 0),
    'sel.nudgeRight': () => nudge(1, 0),
    'sel.nudgeUp': () => nudge(0, -1),
    'sel.nudgeDown': () => nudge(0, 1),

    'view.zoomIn': () => {}, 'view.zoomOut': () => {}, 'view.zoomFit': () => {},
    'view.shortcuts': () => setShowKeys(true),
  } : {};

  function nudge(dx: number, dy: number) {
    if (!doc || !selNode) return;
    const n = selectedNode; if (!n) return;
    mut(d => M.patchNode(d, editingSymbolId, selNode, { x: n.x + dx * 10, y: n.y + dy * 10 }), 'nudge');
  }

  const { rebind, resetOne, resetAll, map } = useKeymap(H);

  // ── Placing media / instances into the current timeline ────────────────────────
  const placeMedia = useCallback((item: MediaItem) => {
    if (!doc || !targetLayerId) return;
    const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(item.url);
    // Probe the natural aspect so the node (and therefore its bounding box) is the right shape.
    const place = (aw: number, ah: number) => {
      const aspect = aw && ah ? aw / ah : 16 / 9;
      const w = Math.round(Math.min(doc.width * 0.5, aw || doc.width * 0.5));
      const h = Math.round(w / aspect);
      const a = M.addAsset(doc, { name: item.label, kind: isVideo ? 'video' : 'image', url: item.url });
      const r = M.addImageNode(a.doc, editingSymbolId, targetLayerId, frame, a.id,
        { w, h, ...(isVideo ? { muted: true, volume: 1, trimInMs: 0, trimOutMs: 0, fadeInMs: 0, fadeOutMs: 0 } : {}) }, isVideo ? 'video' : 'image');
      commit(() => r.doc); setSelNodes([r.nodeId]);
    };
    if (isVideo) { const v = document.createElement('video'); v.onloadedmetadata = () => place(v.videoWidth, v.videoHeight); v.onerror = () => place(0, 0); v.src = item.url; }
    else { const img = new Image(); img.onload = () => place(img.naturalWidth, img.naturalHeight); img.onerror = () => place(0, 0); img.src = item.url; }
  }, [doc, targetLayerId, editingSymbolId, frame, commit]);

  const placeInstance = useCallback((symId: string) => {
    if (!doc || !targetLayerId) return;
    const r = M.addInstanceNode(doc, editingSymbolId, targetLayerId, frame, symId);
    commit(() => r.doc); setSelNodes([r.nodeId]);
  }, [doc, targetLayerId, editingSymbolId, frame, commit]);

  // Swap the media on an existing media node, keeping its transform. New aspect keeps the width and
  // adjusts height so the replacement isn't distorted. Every instance keeps its place on the timeline.
  const replaceNodeMedia = useCallback((nodeId: string, item: MediaItem) => {
    if (!doc) return;
    const cur = (() => { for (const l of editingSymbol!.layers) for (const k of l.keyframes) { const n = k.nodes.find(n => n.id === nodeId); if (n) return n; } return null; })();
    const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(item.url);
    const apply = (aw: number, ah: number) => {
      const w = Number(cur?.props?.w) || Math.round(doc.width * 0.4);
      const aspect = aw && ah ? aw / ah : (Number(cur?.props?.h) ? w / Number(cur!.props!.h) : 16 / 9);
      const h = Math.round(w / aspect);
      const a = M.addAsset(doc, { name: item.label, kind: isVideo ? 'video' : 'image', url: item.url });
      const d = M.patchNode(a.doc, editingSymbolId, nodeId, { assetId: a.id, props: { ...(cur?.props ?? {}), w, h } });
      commit(() => d);
    };
    if (isVideo) { const v = document.createElement('video'); v.onloadedmetadata = () => apply(v.videoWidth, v.videoHeight); v.onerror = () => apply(0, 0); v.src = item.url; }
    else { const img = new Image(); img.onload = () => apply(img.naturalWidth, img.naturalHeight); img.onerror = () => apply(0, 0); img.src = item.url; }
  }, [doc, editingSymbol, editingSymbolId, commit]);

  // Right-click a timeline frame → add / delete keyframes and tweens there.
  const openFrameMenu = (e: React.MouseEvent, layerId: string, f: number) => {
    if (!doc) return;
    const layer = editingSymbol?.layers.find(l => l.id === layerId);
    const hasKf = !!layer?.keyframes.find(k => k.frame === f);
    const kf = layer?.keyframes.find(k => k.frame === f);
    ctx.open(e, [
      { label: `Frame ${f}`, disabled: true },
      { separator: true },
      { label: 'Insert Keyframe', shortcut: 'Ctrl+Alt+K', disabled: hasKf, onClick: () => mut(d => M.insertKeyframe(d, editingSymbolId, layerId, f, false)) },
      { label: 'Insert Blank Keyframe', shortcut: 'F7', disabled: hasKf, onClick: () => mut(d => M.insertKeyframe(d, editingSymbolId, layerId, f, true)) },
      { label: 'Create Motion Tween', disabled: !hasKf, checked: kf?.tween !== 'none' && !!kf, onClick: () => mut(d => M.patchKeyframe(d, editingSymbolId, layerId, f, { tween: kf?.tween === 'motion' ? 'none' : 'motion', ease: [0.25, 0.1, 0.25, 1] })) },
      { separator: true },
      { label: 'Delete Keyframe', disabled: !hasKf || f === 0, onClick: () => { mut(d => M.deleteKeyframe(d, editingSymbolId, layerId, f)); if (selKf?.frame === f) setSelKf(null); } },
      { separator: true },
      // Playback boundary at this frame: the playhead loops back to the start, or stops. Clicking the
      // active one again clears it. It's per-symbol (the whole timeline), not per-layer.
      { label: 'Loop to Start Here', disabled: f === 0, checked: editingSymbol?.loopFrame === f && (editingSymbol?.loopAction ?? 'loop') === 'loop',
        onClick: () => mut(d => M.setSymbolLoop(d, editingSymbolId, editingSymbol?.loopFrame === f && (editingSymbol?.loopAction ?? 'loop') === 'loop' ? null : f, 'loop')) },
      { label: 'Stop Here', disabled: f === 0, checked: editingSymbol?.loopFrame === f && editingSymbol?.loopAction === 'stop',
        onClick: () => mut(d => M.setSymbolLoop(d, editingSymbolId, editingSymbol?.loopFrame === f && editingSymbol?.loopAction === 'stop' ? null : f, 'stop')) },
    ]);
  };

  // Right-click a stage object → assign settings.
  const nodeMenu = (node: Node): MenuItem[] => [
    { label: 'Edit (open timeline)', disabled: node.kind !== 'instance', onClick: () => node.symbolRef && diveInto(node.symbolRef) },
    // Replace Media is offered ONLY for media nodes, and the picker is locked to the node's own kind
    // — an image slot accepts only images, a video slot only videos.
    ...((node.kind === 'image' || node.kind === 'video')
      ? [{ label: `Replace ${node.kind}…`, onClick: () => setReplaceReq({ nodeId: node.id, kind: node.kind as 'image' | 'video' }) }]
      : []),
    { label: 'Convert to Object Timeline', shortcut: 'Ctrl+Shift+F8', onClick: () => H['obj.convert']?.() },
    { separator: true },
    { label: 'Loop', submenu: node.kind === 'instance' ? (['loop', 'playonce', 'single'] as const).map(m => ({ label: m, checked: (node.loopMode ?? 'loop') === m, onClick: () => mut(d => M.patchNode(d, editingSymbolId, node.id, { loopMode: m })) })) : undefined, disabled: node.kind !== 'instance' },
    { label: 'Bring to Front', onClick: () => mut(d => M.patchNode(d, editingSymbolId, node.id, { ord: 9999 })) },
    { label: 'Send to Back', onClick: () => mut(d => M.patchNode(d, editingSymbolId, node.id, { ord: -1 })) },
    { separator: true },
    { label: 'Duplicate to New Layer', shortcut: 'Ctrl+D', onClick: () => H['edit.duplicate']?.() },
    { label: 'Duplicate on Same Layer', onClick: () => { if (!doc) return; const r = M.duplicateNode(doc, editingSymbolId, node.id, true); if (r.nodeId) { commit(() => r.doc); setSelNodes([r.nodeId]); } } },
    { label: selNodes.includes(node.id) && selNodes.length > 1 ? `Delete ${selNodes.length} objects` : 'Delete', shortcut: 'Del', onClick: () => { const ids = selNodes.includes(node.id) && selNodes.length > 1 ? selNodes : [node.id]; mut(d => ids.reduce((dd, id) => M.deleteNode(dd, editingSymbolId, id), d)); setSelNodes([]); } },
  ];

  if (!doc || !editingSymbol) return <div className="h-screen flex items-center justify-center text-slate-500 bg-slate-950">Loading…</div>;

  const panels: Record<PanelId, { title: string; body: React.ReactNode }> = {
    library: {
      title: 'Library',
      body: <LibraryPanel doc={doc} editingSymbolId={editingSymbolId}
        onNewSymbol={() => H['lib.newSymbol']?.()} onEditSymbol={editSymbol} onPlaceInstance={placeInstance}
        onDuplicate={id => { const r = M.duplicateSymbol(doc, id); commit(() => r.doc); }}
        onDeleteSymbol={id => commit(() => M.deleteSymbol(doc, id))}
        onImport={() => {}} onPlaceImage={placeMedia}
        onReplaceAsset={(assetId, item) => { const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(item.url); const isAudio = /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(item.url); commit(() => M.replaceAsset(doc, assetId, item.url, item.label, isVideo ? 'video' : isAudio ? 'audio' : 'image')); }} />,
    },
    stage: {
      title: 'Stage',
      body: <MeasuredStage doc={doc} symbolId={editingSymbolId} frame={frame}
        selectedNodeId={selNode} selectedNodeIds={selNodes} onSelectNode={selectOne} onToggleNode={toggleNode}
        onMoveNode={(id: string, x: number, y: number) => mut(d => M.patchNode(d, editingSymbolId, id, { x, y }), 'move')}
        onTransformNode={(id: string, p: Partial<Node>) => mut(d => M.patchNode(d, editingSymbolId, id, p), 'xform')}
        onEditInstance={(symId: string) => diveInto(symId)}
        onContext={ctx.open} nodeMenu={nodeMenu} />,
    },
    timeline: {
      title: 'Timeline',
      body: <TimelinePanel doc={doc} symbol={editingSymbol} frame={frame} selectedLayerId={selLayer} selectedKfFrame={selKf?.frame ?? null}
        onSeek={setFrame} onSelectLayer={setSelLayer}
        onSelectKeyframe={(layerId, f) => { setSelLayer(layerId); setSelKf({ layerId, frame: f }); setSelNodes([]); setFrame(f); }}
        onMoveKeyframe={(layerId, from, to) => { mut(d => M.moveKeyframe(d, editingSymbolId, layerId, from, to), 'kfmove'); if (selKf?.frame === from) setSelKf({ layerId, frame: to }); }}
        onFrameContext={(e, layerId, f) => openFrameMenu(e, layerId, f)}
        onToggleVisible={id => mut(d => M.patchLayer(d, editingSymbolId, id, { visible: !editingSymbol.layers.find(l => l.id === id)?.visible }))}
        onToggleLock={id => mut(d => M.patchLayer(d, editingSymbolId, id, { locked: !editingSymbol.layers.find(l => l.id === id)?.locked }))}
        onPatchLayerName={(id, name) => mut(d => M.patchLayer(d, editingSymbolId, id, { name }), 'lname')}
        onAddLayer={() => mut(d => M.addLayer(d, editingSymbolId))}
        onDeleteLayer={id => { mut(d => M.deleteLayer(d, editingSymbolId, id)); if (selLayer === id) setSelLayer(null); }} />,
    },
    inspector: {
      title: 'Properties',
      body: <InspectorPanel doc={doc} symbol={editingSymbol} selectedNode={selectedNode} selectedKeyframe={selectedKeyframe} selectedLayerId={selKf?.layerId ?? null}
        onPatchNode={(id, p) => mut(d => M.patchNode(d, editingSymbolId, id, p), `n:${id}`)}
        onPatchKeyframe={(layerId, f, p) => mut(d => M.patchKeyframe(d, editingSymbolId, layerId, f, p), 'kf')}
        onPatchDoc={p => mut(d => ({ ...d, ...p }), 'doc')} />,
    },
  };

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-200">
      {/* Header: doc + transport + breadcrumb */}
      <header className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-800 text-xs">
        <span className="font-semibold text-sky-400">IntroMate · Flash</span>
        <select className="im-input w-44" value={doc.id} onChange={async e => { const d = await api.loadDoc(e.target.value); reset(d); setStack([d.rootSymbol]); setFrame(0); }}>
          {docs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button className="im-btn" onClick={() => H['file.new']?.()}>New</button>
        <button className="im-btn" onClick={undo} disabled={!canUndo} title="Undo">↶</button>
        <button className="im-btn" onClick={redo} disabled={!canRedo} title="Redo">↷</button>

        <div className="mx-2 h-4 w-px bg-slate-700" />
        <button className="im-btn" onClick={() => H['play.first']?.()}>⏮</button>
        <button className="im-btn-primary w-14" onClick={() => H['play.toggle']?.()}>{playing ? 'Pause' : 'Play'}</button>
        <span className="tabular-nums text-slate-400 w-16 text-center">frame {frame}</span>

        <div className="flex-1" />
        <button className="im-btn" onClick={() => setShowKeys(true)} title="Keyboard Shortcuts (Ctrl+/)">⌨ Shortcuts</button>
        <button className="im-btn text-base leading-none px-1.5" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
      </header>

      {/* Breadcrumb scope tabs */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-slate-800 text-xs bg-slate-900/60">
        {stack.map((sid, i) => {
          const s = findSymbol(doc, sid);
          return (
            <span key={sid} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-600">›</span>}
              <button className={`px-2 py-0.5 rounded ${i === stack.length - 1 ? 'bg-sky-700/50 text-sky-200' : 'hover:bg-slate-800 text-slate-300'}`}
                onClick={() => gotoCrumb(i)}
                onContextMenu={e => ctx.open(e, [
                  { label: `Object: ${s?.name ?? sid}`, disabled: true },
                  { separator: true },
                  { label: 'Duplicate Object', onClick: () => { const r = M.duplicateSymbol(doc, sid); commit(() => r.doc); editSymbol(r.id); } },
                  { label: 'Rename…', onClick: () => { const n = prompt('Rename object', s?.name ?? ''); if (n) commit(() => M.renameSymbol(doc, sid, n)); } },
                  ...(sid !== doc.rootSymbol ? [{ label: 'Delete Object', onClick: () => { commit(() => M.deleteSymbol(doc, sid)); gotoCrumb(Math.max(0, i - 1)); } }] : []),
                ])}>{s?.name ?? sid}</button>
            </span>
          );
        })}
        <span className="ml-2 text-[10px] text-slate-600">Ctrl+Shift+K nests a new Object Timeline here</span>
      </div>

      {/* Mosaic panels */}
      <div className="flex-1 relative flash-mosaic">
        <Mosaic<PanelId>
          value={layout}
          onChange={v => v && setLayout(v)}
          renderTile={(id, path) => (
            <MosaicWindow<PanelId> path={path} title={panels[id].title}
              toolbarControls={[]}>
              {panels[id].body}
            </MosaicWindow>
          )}
        />
      </div>

      {ctx.node}
      {showKeys && <ShortcutManager map={map} onRebind={rebind} onResetOne={resetOne} onResetAll={resetAll} onClose={() => setShowKeys(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} onOpenShortcuts={() => { setShowSettings(false); setShowKeys(true); }} />}
      {replaceReq && (
        <MediaPicker kind={replaceReq.kind} onClose={() => setReplaceReq(null)}
          onPick={item => { replaceNodeMedia(replaceReq.nodeId, item); setReplaceReq(null); }} />
      )}
    </div>
  );
}

// The frame of the active keyframe for a layer (for tween/patch-by-frame commands).
function activeFrame(d: FlashDoc, symId: string, layerId: string, frame: number): number {
  const l = findSymbol(d, symId)?.layers.find(l => l.id === layerId);
  let f = 0;
  for (const k of l?.keyframes ?? []) if (k.frame <= frame) f = k.frame; else break;
  return f;
}

// Stage wrapped in a size observer so it scales to whatever the Mosaic tile gives it.
function MeasuredStage(props: any) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 450 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const { onContext, nodeMenu, ...stageProps } = props as any;
  return (
    <div ref={ref} className="w-full h-full"
      onContextMenu={e => {
        // Right-click a node hit box → its menu; else the stage menu.
        const target = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null;
        // Selection-based menu: use the currently selected node.
        if (stageProps.selectedNodeId) {
          const n = findNode(stageProps.doc, stageProps.symbolId, stageProps.selectedNodeId);
          if (n) return onContext(e, nodeMenu(n));
        }
        void target;
      }}>
      <FlashStage {...stageProps} boxW={box.w} boxH={box.h} />
    </div>
  );
}
function findNode(doc: FlashDoc, symId: string, nodeId: string): Node | null {
  const s = findSymbol(doc, symId); if (!s) return null;
  for (const l of s.layers) for (const k of l.keyframes) { const n = k.nodes.find(n => n.id === nodeId); if (n) return n; }
  return null;
}
