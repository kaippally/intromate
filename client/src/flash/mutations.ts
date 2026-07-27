// Pure edits on a FlashDoc — every one returns a new document, so they compose with the 100-level
// undo history. Documents are small, so we clone with structuredClone and mutate the copy: simple
// and always correct, no partial-clone bookkeeping.

import { activeKeyframe, findSymbol, symbolLength, IDENTITY } from './model';
import type { Asset, FlashDoc, HeldParam, Keyframe, Layer, Node, NodeKind, Symbol, SymbolType, Transform, TweenKind } from './model';

let seq = 0;
export const uid = (p = 'x') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

const clone = <T>(v: T): T => structuredClone(v);

export const getSymbol = (doc: FlashDoc, id: string) => findSymbol(doc, id);
export const getLayer = (sym: Symbol, id: string) => sym.layers.find(l => l.id === id) ?? null;

// The keyframe a layer shows at `frame` — created if the layer has none there yet is the caller's job.
export function keyframeAt(layer: Layer, frame: number): Keyframe | null {
  return activeKeyframe(layer, frame)?.kf ?? null;
}

function withSymbol(doc: FlashDoc, symId: string, fn: (s: Symbol) => void): FlashDoc {
  const next = clone(doc);
  const sym = next.symbols.find(s => s.id === symId);
  if (sym) fn(sym);
  return next;
}

// ── Symbols (Library) ─────────────────────────────────────────────────────────
export function addSymbol(doc: FlashDoc, name: string, type: SymbolType): { doc: FlashDoc; id: string } {
  const next = clone(doc);
  const id = uid('sym');
  next.symbols.push({
    id, name, type, regX: 0, regY: 0, ord: next.symbols.length,
    layers: [{ id: uid('lyr'), name: 'Layer 1', ord: 0, kind: 'normal', parentId: null, locked: false, visible: true, outlined: false,
      keyframes: [{ id: uid('kf'), frame: 0, kind: 'blank', tween: 'none', ease: null, label: null, script: null, soundAssetId: null, soundSync: 'event', nodes: [] }] }],
  });
  return { doc: next, id };
}

export function renameSymbol(doc: FlashDoc, id: string, name: string): FlashDoc {
  return withSymbol(doc, id, s => { s.name = name; });
}

// The playback loop/stop point for a symbol's timeline. Pass frame=null to clear it.
export function setSymbolLoop(doc: FlashDoc, id: string, loopFrame: number | null, loopAction: 'loop' | 'stop'): FlashDoc {
  return withSymbol(doc, id, s => { s.loopFrame = loopFrame; s.loopAction = loopAction; });
}

export function deleteSymbol(doc: FlashDoc, id: string): FlashDoc {
  if (id === doc.rootSymbol) return doc;
  const next = clone(doc);
  next.symbols = next.symbols.filter(s => s.id !== id);
  // Strip any instances of the deleted symbol.
  for (const s of next.symbols) for (const l of s.layers) for (const k of l.keyframes)
    k.nodes = k.nodes.filter(n => !(n.kind === 'instance' && n.symbolRef === id));
  return next;
}

export function duplicateSymbol(doc: FlashDoc, id: string): { doc: FlashDoc; id: string } {
  const src = findSymbol(doc, id);
  if (!src) return { doc, id };
  const next = clone(doc);
  const copy = clone(src);
  copy.id = uid('sym');
  copy.name = `${src.name} copy`;
  copy.ord = next.symbols.length;
  reid(copy);
  next.symbols.push(copy);
  return { doc: next, id: copy.id };
}

// Fresh ids for a duplicated symbol subtree (layers/keyframes/nodes) so nothing aliases the original.
function reid(sym: Symbol) {
  for (const l of sym.layers) {
    l.id = uid('lyr');
    for (const k of l.keyframes) {
      k.id = uid('kf');
      for (const n of k.nodes) { const t = n.token; n.id = uid('nd'); n.token = t === undefined ? n.id : uid('tok'); }
    }
  }
}

// ── Assets (Library media) ─────────────────────────────────────────────────────
export function addAsset(doc: FlashDoc, a: Omit<Asset, 'id'>): { doc: FlashDoc; id: string } {
  const existing = doc.assets.find(x => x.url === a.url);
  if (existing) return { doc, id: existing.id };
  const next = clone(doc);
  const id = uid('ast');
  next.assets.push({ ...a, id });
  return { doc: next, id };
}

// Replace an asset's source (existing or freshly uploaded media). Every node referencing it updates
// at once, so swapping a photo everywhere is one edit.
export function replaceAsset(doc: FlashDoc, assetId: string, url: string, name: string, kind: Asset['kind']): FlashDoc {
  const next = clone(doc);
  const a = next.assets.find(x => x.id === assetId);
  if (a) { a.url = url; a.name = name; a.kind = kind; }
  return next;
}

// ── Layers ─────────────────────────────────────────────────────────────────────
export function addLayer(doc: FlashDoc, symId: string, name?: string): FlashDoc {
  return withSymbol(doc, symId, s => {
    const ord = s.layers.length;
    s.layers.push({ id: uid('lyr'), name: name ?? `Layer ${ord + 1}`, ord, kind: 'normal', parentId: null, locked: false, visible: true, outlined: false,
      keyframes: [{ id: uid('kf'), frame: 0, kind: 'blank', tween: 'none', ease: null, label: null, script: null, soundAssetId: null, soundSync: 'event', nodes: [] }] });
  });
}

export function deleteLayer(doc: FlashDoc, symId: string, layerId: string): FlashDoc {
  return withSymbol(doc, symId, s => {
    if (s.layers.length > 1) { s.layers = s.layers.filter(l => l.id !== layerId); s.layers.forEach((l, i) => (l.ord = i)); }
  });
}

export function patchLayer(doc: FlashDoc, symId: string, layerId: string, patch: Partial<Layer>): FlashDoc {
  return withSymbol(doc, symId, s => { const l = s.layers.find(x => x.id === layerId); if (l) Object.assign(l, patch); });
}

// Move a layer up/down in the z-order (ord). dir +1 = toward front.
export function reorderLayer(doc: FlashDoc, symId: string, layerId: string, dir: number): FlashDoc {
  return withSymbol(doc, symId, s => {
    const ordered = [...s.layers].sort((a, b) => a.ord - b.ord);
    const i = ordered.findIndex(l => l.id === layerId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i]!.ord, ordered[j]!.ord] = [ordered[j]!.ord, ordered[i]!.ord];
  });
}

// ── Keyframes ────────────────────────────────────────────────────────────────
// Insert a keyframe at `frame`, seeded from the currently-active keyframe's nodes (Flash's F6).
export function insertKeyframe(doc: FlashDoc, symId: string, layerId: string, frame: number, blank = false): FlashDoc {
  return withSymbol(doc, symId, s => {
    const l = s.layers.find(x => x.id === layerId);
    if (!l) return;
    if (l.keyframes.some(k => k.frame === frame)) return;
    const active = activeKeyframe(l, frame)?.kf;
    const nodes = blank || !active ? [] : clone(active.nodes).map(n => ({ ...n, id: uid('nd') }));
    l.keyframes.push({ id: uid('kf'), frame, kind: blank ? 'blank' : 'key', tween: 'none', ease: null, label: null, script: null, soundAssetId: null, soundSync: 'event', nodes });
    l.keyframes.sort((a, b) => a.frame - b.frame);
  });
}

export function deleteKeyframe(doc: FlashDoc, symId: string, layerId: string, frame: number): FlashDoc {
  return withSymbol(doc, symId, s => {
    const l = s.layers.find(x => x.id === layerId);
    if (!l || frame === 0) return;
    l.keyframes = l.keyframes.filter(k => k.frame !== frame);
  });
}

// Drag a keyframe to a new frame. Frame 0 is pinned (a layer always starts at 0); the target must be
// free. Returns the doc unchanged if the move is illegal, so a drag can't corrupt the layer.
export function moveKeyframe(doc: FlashDoc, symId: string, layerId: string, fromFrame: number, toFrame: number): FlashDoc {
  if (fromFrame === 0 || toFrame < 1 || fromFrame === toFrame) return doc;
  return withSymbol(doc, symId, s => {
    const l = s.layers.find(x => x.id === layerId);
    if (!l) return;
    if (l.keyframes.some(k => k.frame === toFrame)) return; // occupied
    const k = l.keyframes.find(k => k.frame === fromFrame);
    if (!k) return;
    k.frame = toFrame;
    l.keyframes.sort((a, b) => a.frame - b.frame);
  });
}

export function patchKeyframe(doc: FlashDoc, symId: string, layerId: string, frame: number, patch: Partial<Keyframe>): FlashDoc {
  return withSymbol(doc, symId, s => {
    const k = s.layers.find(x => x.id === layerId)?.keyframes.find(k => k.frame === frame);
    if (k) Object.assign(k, patch);
  });
}

// ── Nodes ────────────────────────────────────────────────────────────────────
// Ensure the layer has a keyframe at `frame` (create one seeded from active), and return it.
function ensureKeyframe(l: Layer, frame: number): Keyframe {
  let k = l.keyframes.find(k => k.frame === frame);
  if (k) return k;
  const active = activeKeyframe(l, frame)?.kf;
  k = { id: uid('kf'), frame, kind: 'key', tween: 'none', ease: null, label: null, script: null, soundAssetId: null, soundSync: 'event',
    nodes: active ? clone(active.nodes).map(n => ({ ...n, id: uid('nd') })) : [] };
  l.keyframes.push(k);
  l.keyframes.sort((a, b) => a.frame - b.frame);
  return k;
}

function baseNode(kind: NodeKind, x: number, y: number): Node {
  return { id: uid('nd'), token: uid('tok'), ord: 0, kind, ...IDENTITY, x, y, alpha: 1, blend: 'normal', loopMode: 'loop', firstFrame: 0 };
}

// Media is one-per-timeline: a placed image/video always gets its OWN layer, so the per-layer tween
// rule means a tween on it animates exactly that clip. The layer is blank up to the playhead frame
// and its first keyframe sits there carrying the media — where you drop it is the clip's in-point.
export function addMediaLayer(doc: FlashDoc, symId: string, frame: number, assetId: string, props?: Record<string, unknown>, kind: 'image' | 'video' = 'image'): { doc: FlashDoc; nodeId: string; layerId: string } {
  let nodeId = '', layerId = '';
  const w = Number((props as any)?.w) || 640, h = Number((props as any)?.h) || 360;
  const c = centre(doc, w, h);
  const start = Math.max(0, Math.round(frame));
  const next = withSymbol(doc, symId, s => {
    const n = baseNode(kind, c.x, c.y); n.assetId = assetId; n.ord = 0; n.props = props;
    const keyframes: Keyframe[] = [];
    if (start > 0) keyframes.push({ id: uid('kf'), frame: 0, kind: 'blank', tween: 'none', ease: null, label: null, script: null, soundAssetId: null, soundSync: 'event', nodes: [] });
    keyframes.push({ id: uid('kf'), frame: start, kind: 'key', tween: 'none', ease: null, label: null, script: null, soundAssetId: null, soundSync: 'event', nodes: [n] });
    const ord = s.layers.length;
    layerId = uid('lyr');
    s.layers.push({ id: layerId, name: `Layer ${ord + 1}`, ord, kind: 'normal', parentId: null, locked: false, visible: true, outlined: false, keyframes });
    nodeId = n.id;
  });
  return { doc: next, nodeId, layerId };
}

// A station a macro parks an object at on one keyframe: the pose it holds there, and how it travels
// to the NEXT pose. Macros compute the geometry; this is the shape they hand over.
export interface Pose extends Partial<Transform> {
  frame: number;
  alpha?: number;
  tween?: TweenKind;
  ease?: number[] | null;   // [x1,y1,x2,y2]; y outside 0..1 overshoots, which the resolver handles
  hold?: HeldParam[];
}

// One media clip on its own layer, animated through a sequence of poses — the primitive every macro
// builds with. Each keyframe carries the SAME token, which is what makes the resolver tween them
// (pairNodes) and run the video's clock from the first pose rather than restarting it at every
// keyframe (tokenOrigin). The layer is blank before the first pose and after the last, so the clip
// has a real in and out point. Layer ord follows the usual convention — pushed later = in front.
export function addAnimatedMediaLayer(
  doc: FlashDoc, symId: string,
  spec: { name?: string; assetId: string; kind?: 'image' | 'video'; props?: Record<string, unknown>; poses: Pose[]; endBlank?: boolean },
): { doc: FlashDoc; layerId: string; nodeId: string } {
  let layerId = '', nodeId = '';
  if (!spec.poses.length) return { doc, layerId, nodeId };
  const poses = [...spec.poses].sort((a, b) => a.frame - b.frame);
  const token = uid('tok');
  const blank = (frame: number): Keyframe => ({ id: uid('kf'), frame, kind: 'blank', tween: 'none', ease: null, label: null, script: null, soundAssetId: null, soundSync: 'event', nodes: [] });

  const next = withSymbol(doc, symId, s => {
    const keyframes: Keyframe[] = [];
    if (poses[0]!.frame > 0) keyframes.push(blank(0));
    for (const p of poses) {
      const n = baseNode(spec.kind ?? 'video', Math.round(p.x ?? 0), Math.round(p.y ?? 0));
      n.token = token;
      n.assetId = spec.assetId;
      n.ord = 0;
      n.props = spec.props;
      n.scaleX = p.scaleX ?? 1; n.scaleY = p.scaleY ?? 1;
      n.rotation = p.rotation ?? 0; n.skewX = p.skewX ?? 0; n.skewY = p.skewY ?? 0;
      n.rotX = p.rotX ?? 0; n.rotY = p.rotY ?? 0; n.z = p.z ?? 0;
      n.alpha = p.alpha ?? 1;
      if (p.hold?.length) n.hold = p.hold;
      keyframes.push({ id: uid('kf'), frame: Math.max(0, Math.round(p.frame)), kind: 'key', tween: p.tween ?? 'none', ease: p.ease ?? null, label: null, script: null, soundAssetId: null, soundSync: 'event', nodes: [n] });
      if (!nodeId) nodeId = n.id;
    }
    if (spec.endBlank) keyframes.push(blank(Math.round(poses[poses.length - 1]!.frame) + 1));
    keyframes.sort((a, b) => a.frame - b.frame);
    // A layer may hold only one keyframe per frame. Rounding a sampled path can land two poses on
    // the same frame; the later one is the more advanced, so it wins.
    for (let i = keyframes.length - 1; i > 0; i--) if (keyframes[i]!.frame === keyframes[i - 1]!.frame) keyframes.splice(i - 1, 1);
    layerId = uid('lyr');
    s.layers.push({ id: layerId, name: spec.name ?? `Layer ${s.layers.length + 1}`, ord: s.layers.length, kind: 'normal', parentId: null, locked: false, visible: true, outlined: false, keyframes });
  });
  return { doc: next, layerId, nodeId };
}

// Centre a w×h box in the document frame.
const centre = (doc: FlashDoc, w: number, h: number) => ({ x: Math.round((doc.width - w) / 2), y: Math.round((doc.height - h) / 2) });

export function addTextNode(doc: FlashDoc, symId: string, layerId: string, frame: number, text = 'Text'): { doc: FlashDoc; nodeId: string } {
  let nodeId = '';
  const size = 96, w = Math.max(120, text.length * size * 0.55), h = size * 1.2;
  const c = centre(doc, w, h);
  const next = withSymbol(doc, symId, s => {
    const l = s.layers.find(x => x.id === layerId);
    if (!l) return;
    const k = ensureKeyframe(l, frame);
    if (k.kind === 'blank') k.kind = 'key';
    const n = baseNode('text', c.x, c.y); n.ord = k.nodes.length; n.props = { text, size, color: '#ffffff', align: 'left' };
    k.nodes.push(n); nodeId = n.id;
  });
  return { doc: next, nodeId };
}

export function addShapeNode(doc: FlashDoc, symId: string, layerId: string, frame: number, shape: 'rect' | 'ellipse' | 'line'): { doc: FlashDoc; nodeId: string } {
  let nodeId = '';
  const w = shape === 'line' ? 300 : 240, h = shape === 'line' ? 4 : 160;
  const c = centre(doc, w, h);
  const next = withSymbol(doc, symId, s => {
    const l = s.layers.find(x => x.id === layerId);
    if (!l) return;
    const k = ensureKeyframe(l, frame);
    if (k.kind === 'blank') k.kind = 'key';
    const n = baseNode('shape', c.x, c.y); n.ord = k.nodes.length;
    n.props = { shape, w, h, fill: '#3aa0ff', stroke: '#ffffff', strokeWidth: shape === 'line' ? 4 : 0, radius: 0 };
    k.nodes.push(n); nodeId = n.id;
  });
  return { doc: next, nodeId };
}

// Place an instance of a symbol (Library → Stage) on a layer's keyframe.
export function addInstanceNode(doc: FlashDoc, symId: string, layerId: string, frame: number, refSymbolId: string): { doc: FlashDoc; nodeId: string } {
  let nodeId = '';
  const next = withSymbol(doc, symId, s => {
    const l = s.layers.find(x => x.id === layerId);
    if (!l) return;
    const k = ensureKeyframe(l, frame);
    if (k.kind === 'blank') k.kind = 'key';
    const n = baseNode('instance', 0, 0); n.symbolRef = refSymbolId; n.ord = k.nodes.length;
    const ref = findSymbol(doc, refSymbolId);
    n.name = ref ? `${ref.name.replace(/\s+/g, '')}_${k.nodes.length + 1}` : undefined;
    k.nodes.push(n); nodeId = n.id;
  });
  return { doc: next, nodeId };
}

// Create a new Object Timeline (a MovieClip symbol) nested from the CURRENT timeline: a fresh empty
// symbol is added to the Library, an instance of it is dropped on the current layer at `frame`, and
// the new symbol id + instance id are returned so the caller can push it onto the breadcrumb and
// dive in. This is the Ctrl+Shift+K flow.
export function newNestedTimeline(doc: FlashDoc, parentSymId: string, layerId: string, frame: number, name?: string): { doc: FlashDoc; symbolId: string; nodeId: string } {
  const objName = name ?? nextObjectName(doc);
  const made = addSymbol(doc, objName, 'movieclip');
  const placed = addInstanceNode(made.doc, parentSymId, layerId, frame, made.id);
  return { doc: placed.doc, symbolId: made.id, nodeId: placed.nodeId };
}

// Convert the selected nodes on the current keyframe into a new Object Timeline: they move into a new
// symbol (at their relative positions) and are replaced on the parent by a single instance. Flash F8.
export function selectionToTimeline(doc: FlashDoc, parentSymId: string, layerId: string, frame: number, nodeIds: string[], name?: string): { doc: FlashDoc; symbolId: string; nodeId: string } | null {
  if (!nodeIds.length) return null;
  const next = clone(doc);
  const parent = next.symbols.find(s => s.id === parentSymId);
  const layer = parent?.layers.find(l => l.id === layerId);
  const kf = layer?.keyframes.find(k => k.frame === frame) ?? (layer ? activeKeyframe(layer, frame)?.kf : null);
  if (!parent || !layer || !kf) return null;

  const taken = kf.nodes.filter(n => nodeIds.includes(n.id));
  if (!taken.length) return null;
  // Origin = the top-left of the selection, so the object's local coords start near 0.
  const ox = Math.min(...taken.map(n => n.x));
  const oy = Math.min(...taken.map(n => n.y));

  const symId = uid('sym');
  const inner = taken.map((n, i) => ({ ...clone(n), id: uid('nd'), token: uid('tok'), ord: i, x: n.x - ox, y: n.y - oy }));
  next.symbols.push({
    id: symId, name: name ?? nextObjectName(next), type: 'movieclip', regX: 0, regY: 0, ord: next.symbols.length,
    layers: [{ id: uid('lyr'), name: 'Layer 1', ord: 0, kind: 'normal', parentId: null, locked: false, visible: true, outlined: false,
      keyframes: [{ id: uid('kf'), frame: 0, kind: 'key', tween: 'none', ease: null, label: null, script: null, soundAssetId: null, soundSync: 'event', nodes: inner }] }],
  });

  kf.nodes = kf.nodes.filter(n => !nodeIds.includes(n.id));
  const instance = { ...baseNode('instance', ox, oy), symbolRef: symId, ord: kf.nodes.length, name: `${(name ?? 'Object').replace(/\s+/g, '')}_1` };
  kf.nodes.push(instance);
  return { doc: next, symbolId: symId, nodeId: instance.id };
}

function nextObjectName(doc: FlashDoc): string {
  let n = 1;
  while (doc.symbols.some(s => s.name === `Object ${n}`)) n++;
  return `Object ${n}`;
}

// Duplicate an on-stage object. Because a tween is per-layer, the default puts the copy on its OWN
// new layer (so it can be animated independently) — pass sameLayer to drop it beside the original.
export function duplicateNode(doc: FlashDoc, symId: string, nodeId: string, sameLayer = false): { doc: FlashDoc; nodeId: string; layerId: string } {
  const next = clone(doc);
  const sym = next.symbols.find(s => s.id === symId);
  let src: Node | null = null, srcLayer: Layer | null = null, srcKf: Keyframe | null = null;
  if (sym) for (const l of sym.layers) for (const k of l.keyframes) { const n = k.nodes.find(n => n.id === nodeId); if (n) { src = n; srcLayer = l; srcKf = k; } }
  if (!sym || !src || !srcLayer || !srcKf) return { doc, nodeId: '', layerId: '' };

  const copy: Node = { ...clone(src), id: uid('nd'), token: uid('tok'), x: src.x + 20, y: src.y + 20 };
  if (sameLayer) {
    copy.ord = srcKf.nodes.length;
    srcKf.nodes.push(copy);
    return { doc: next, nodeId: copy.id, layerId: srcLayer.id };
  }
  copy.ord = 0;
  const layer: Layer = {
    id: uid('lyr'), name: `${srcLayer.name} copy`, ord: sym.layers.length, kind: 'normal', parentId: null,
    locked: false, visible: true, outlined: false,
    keyframes: [{ id: uid('kf'), frame: srcKf.frame, kind: 'key', tween: 'none', ease: null, label: null, script: null, soundAssetId: null, soundSync: 'event', nodes: [copy] }],
  };
  sym.layers.push(layer);
  return { doc: next, nodeId: copy.id, layerId: layer.id };
}

// Patch a node found by id anywhere in a symbol's keyframes (the node the inspector is editing).
export function patchNode(doc: FlashDoc, symId: string, nodeId: string, patch: Partial<Node>): FlashDoc {
  return withSymbol(doc, symId, s => {
    for (const l of s.layers) for (const k of l.keyframes) {
      const n = k.nodes.find(n => n.id === nodeId);
      if (n) { Object.assign(n, patch); if (patch.props) n.props = { ...n.props, ...patch.props }; return; }
    }
  });
}

export function deleteNode(doc: FlashDoc, symId: string, nodeId: string): FlashDoc {
  return withSymbol(doc, symId, s => {
    for (const l of s.layers) for (const k of l.keyframes) k.nodes = k.nodes.filter(n => n.id !== nodeId);
  });
}

export { symbolLength };
