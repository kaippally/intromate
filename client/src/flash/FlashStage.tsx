import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { tumbleRotation } from '@sm/lib/tumble';
import { findSymbol, type FlashDoc, type Node } from './model';
import { resolveSymbol } from './resolve';
import { DisplayNode } from './DisplayNode';

// The Stage: resolves the editing symbol's display list at the current frame and draws it, scaled
// to the panel. Everything outside the document rectangle is clipped, as Flash clips the Stage.
// Selection handles + drag-to-move edit the selected node's transform directly on the canvas.
export function FlashStage({ doc, symbolId, frame, boxW, boxH, selectedNodeId, onSelectNode, onMoveNode, onTransformNode, onEditInstance, editable = true }: {
  doc: FlashDoc;
  symbolId: string;
  frame: number;
  boxW: number;
  boxH: number;
  selectedNodeId?: string | null;
  onSelectNode?: (id: string | null) => void;
  onMoveNode?: (id: string, x: number, y: number) => void;
  onTransformNode?: (id: string, patch: Partial<Node>) => void;
  onEditInstance?: (symbolId: string) => void;
  editable?: boolean;
}) {
  const sym = findSymbol(doc, symbolId);
  const scale = Math.min(boxW / doc.width, boxH / doc.height) || 1;
  const list = useMemo(() => (sym ? resolveSymbol(doc, sym, frame) : []), [doc, sym, frame]);
  const wrapRef = useRef<HTMLDivElement>(null);

  // The node currently selected, and its live transform at this frame (for the handle box).
  const selected = useMemo(() => {
    if (!sym || !selectedNodeId) return null;
    for (const l of sym.layers) for (const k of l.keyframes) {
      const n = k.nodes.find(n => n.id === selectedNodeId);
      if (n) return n;
    }
    return null;
  }, [sym, selectedNodeId]);

  // Selection box measured from the REAL rendered element, relative to the stage frame. This always
  // covers exactly what's on screen — the box can't drift from the object the way computed boxes did.
  const [selRect, setSelRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!selected || !wrap) { setSelRect(null); return; }
    const frameEl = wrap.querySelector('.im-stage-frame') as HTMLElement | null;
    const nodeEl = frameEl?.querySelector(`[data-node-id="${selected.id}"]`) as HTMLElement | null;
    if (!frameEl || !nodeEl) { setSelRect(null); return; }
    const fr = frameEl.getBoundingClientRect(), nr = nodeEl.getBoundingClientRect();
    setSelRect({ left: nr.left - fr.left, top: nr.top - fr.top, width: nr.width, height: nr.height });
  }, [selected, selectedNodeId, frame, doc, scale, boxW, boxH]);

  // Top-level (directly-selectable) node ids at this frame, and a quick lookup of the source Node.
  const topIds = useMemo(() => new Set(list.map(n => n.srcId).filter(Boolean) as string[]), [list]);
  const nodeById = (id: string): Node | null => {
    if (!sym) return null;
    for (const l of sym.layers) for (const k of l.keyframes) { const n = k.nodes.find(n => n.id === id); if (n) return n; }
    return null;
  };

  // Hit-test the REAL rendered pixels: walk up from the clicked element to the outermost
  // data-node-id that is a top-level object here. This always matches what's on screen, so clicks
  // can't miss the way fixed hit-boxes did.
  function hitTopId(target: EventTarget | null): string | null {
    let el = (target as HTMLElement)?.closest?.('[data-node-id]') as HTMLElement | null;
    let hit: string | null = null;
    while (el) {
      const id = el.getAttribute('data-node-id');
      if (id && topIds.has(id)) hit = id;         // keep climbing → outermost wins
      el = el.parentElement?.closest('[data-node-id]') as HTMLElement | null;
    }
    return hit;
  }
  function stageMouseDown(e: React.MouseEvent) {
    if (!editable) return;
    const id = hitTopId(e.target);
    if (id) { const n = nodeById(id); if (n) return startDrag(e, n); }
    onSelectNode?.(null);
  }
  // Double-click an instance on the canvas → open that object's own timeline (dive in).
  function stageDoubleClick(e: React.MouseEvent) {
    if (!editable || !onEditInstance) return;
    const id = hitTopId(e.target);
    const n = id ? nodeById(id) : null;
    if (n?.kind === 'instance' && n.symbolRef) onEditInstance(n.symbolRef);
  }

  function startDrag(e: React.MouseEvent, node: Node) {
    if (!editable || !onMoveNode) return;
    e.stopPropagation();
    onSelectNode?.(node.id);
    const x0 = e.clientX, y0 = e.clientY, nx = node.x, ny = node.y;
    let moved = false;
    const move = (ev: MouseEvent) => { moved = true; onMoveNode(node.id, Math.round(nx + (ev.clientX - x0) / scale), Math.round(ny + (ev.clientY - y0) / scale)); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); void moved; };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  // Shift+wheel = uniform SCALE (Z position); Ctrl+wheel = Z depth (perspective dolly). Attached
  // natively (non-passive) so Ctrl+wheel doesn't trigger the browser's page zoom.
  const selRef = useRef(selected); selRef.current = selected;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !editable || !onTransformNode) return;
    const onWheel = (e: WheelEvent) => {
      const n = selRef.current;
      if (!n || (!e.shiftKey && !e.ctrlKey && !e.metaKey)) return;
      e.preventDefault();
      if (e.shiftKey) {
        const f = e.deltaY < 0 ? 1.05 : 1 / 1.05;
        onTransformNode(n.id, { scaleX: +(n.scaleX * f).toFixed(3), scaleY: +(n.scaleY * f).toFixed(3) });
      } else {
        onTransformNode(n.id, { z: Math.round((n.z ?? 0) + (e.deltaY < 0 ? 40 : -40)) });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [editable, onTransformNode]);

  const stage: CSSProperties = {
    position: 'absolute', top: 0, left: 0, width: doc.width, height: doc.height,
    transform: `scale(${scale})`, transformOrigin: '0 0', background: doc.bg, overflow: 'hidden',
  };

  return (
    <div ref={wrapRef} className="relative w-full h-full flex items-center justify-center bg-[#0b1120] overflow-hidden"
      onMouseDown={stageMouseDown} onDoubleClick={stageDoubleClick}>
      <div className="im-stage-frame relative shadow-2xl shadow-black/60 ring-1 ring-slate-700" style={{ width: doc.width * scale, height: doc.height * scale }}>
        <div style={stage}>
          {list.map(n => <DisplayNode key={n.key} node={n} />)}
        </div>
        {editable && selected && selRect && onTransformNode && (
          <TransformControls node={selected} rect={selRect} scale={scale}
            onTransform={p => onTransformNode(selected.id, p)}
            onMove={(x, y) => onMoveNode?.(selected.id, x, y)} />
        )}
      </div>
    </div>
  );
}

export function boxOf(n: Node): { w: number; h: number } {
  const p = (n.props ?? {}) as any;
  if (n.kind === 'image' || n.kind === 'video') return { w: p.w ?? 320, h: p.h ?? 180 };
  if (n.kind === 'shape') return { w: p.w ?? 120, h: p.shape === 'line' ? Math.max(6, p.strokeWidth ?? 4) : (p.h ?? 120) };
  if (n.kind === 'text') return { w: p.w ?? Math.max(40, String(p.text ?? '').length * (p.size ?? 48) * 0.55), h: p.h ?? (p.size ?? 48) * 1.2 };
  return { w: 200, h: 200 };
}

// On-canvas transform controls, following Studio Mate's direct-manipulation feel:
//   • 8 handles (corners + edges) resize → scaleX / scaleY; a corner with Ctrl scales UNIFORMLY.
//   • the round handle above the box rotates (2D).
//   • Ctrl+drag on the body tumbles PERSPECTIVE (rotX/rotY) via the shared tumble gesture — the
//     same 0.5°/px yaw+pitch the Clipboard / L3 / Slides use.
// All math is in stage space (raw px ÷ scale), so it reads 1:1 with the pointer at any zoom.
const HANDLES: { id: string; fx: number; fy: number; cursor: string }[] = [
  { id: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' }, { id: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' }, { id: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { id: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' }, { id: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { id: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' }, { id: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' }, { id: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
];

function TransformControls({ node, rect, scale, onTransform, onMove }: { node: Node; rect: { left: number; top: number; width: number; height: number }; scale: number; onTransform: (p: Partial<Node>) => void; onMove: (x: number, y: number) => void }) {
  // The box is drawn on the MEASURED screen rect of the object, so it always covers it exactly.
  // Resize maps a corner/edge drag to a scale factor relative to the object's current on-screen size.
  function bodyDown(e: React.MouseEvent) {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) return perspective(e);
    const x0 = e.clientX, y0 = e.clientY, nx = node.x, ny = node.y;
    const move = (ev: MouseEvent) => onMove(Math.round(nx + (ev.clientX - x0) / scale), Math.round(ny + (ev.clientY - y0) / scale));
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  function resize(handleId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    const sx0 = node.scaleX, sy0 = node.scaleY, nx0 = node.x, ny0 = node.y;
    const w0 = rect.width || 1, h0 = rect.height || 1;
    const b = boxOf(node);                       // local (unscaled) content size
    const hx = handleId.includes('w') ? -1 : handleId.includes('e') ? 1 : 0;
    const hy = handleId.includes('n') ? -1 : handleId.includes('s') ? 1 : 0;
    // The edge to keep pinned is the one OPPOSITE the handle. The object's origin is its top-left,
    // so E/S already pin left/top; for W/N we move x/y to pin the right/bottom edge instead.
    const rightX = nx0 + b.w * sx0, bottomY = ny0 + b.h * sy0;
    const move = (ev: MouseEvent) => {
      let nsx = hx ? Math.max(0.02, sx0 * (1 + (hx * (ev.clientX - x0)) / w0)) : sx0;
      let nsy = hy ? Math.max(0.02, sy0 * (1 + (hy * (ev.clientY - y0)) / h0)) : sy0;
      if (ev.ctrlKey || ev.metaKey) { // uniform
        const f = hx && hy ? Math.max(nsx / sx0, nsy / sy0) : hx ? nsx / sx0 : nsy / sy0;
        nsx = sx0 * f; nsy = sy0 * f;
      }
      const patch: Partial<Node> = { scaleX: +nsx.toFixed(3), scaleY: +nsy.toFixed(3) };
      if (hx < 0) patch.x = Math.round(rightX - b.w * nsx);   // dragging left → pin right edge
      if (hy < 0) patch.y = Math.round(bottomY - b.h * nsy);  // dragging top  → pin bottom edge
      onTransform(patch);
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  function rotate(e: React.MouseEvent) {
    e.stopPropagation();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const frameRect = (e.currentTarget as HTMLElement).closest('.im-stage-frame')!.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const ang = Math.atan2(ev.clientY - frameRect.top - cy, ev.clientX - frameRect.left - cx) * 180 / Math.PI + 90;
      onTransform({ rotation: Math.round(ang) });
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  function perspective(e: React.MouseEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, rx0 = node.rotX ?? 0, ry0 = node.rotY ?? 0;
    const move = (ev: MouseEvent) => {
      const { rotX, rotY } = tumbleRotation(rx0, ry0, ev.clientX - x0, ev.clientY - y0, 80, 1);
      onTransform({ rotX, rotY });
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  return (
    <div className="absolute" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
      <div className="absolute inset-0 border border-sky-400" style={{ cursor: 'move' }}
        title="Drag to move · Ctrl+drag = perspective" onMouseDown={bodyDown} />
      {HANDLES.map(hd => (
        <div key={hd.id} onMouseDown={e => resize(hd.id, e)}
          className="absolute bg-sky-400 border border-white"
          style={{ width: 8, height: 8, left: `calc(${hd.fx * 100}% - 4px)`, top: `calc(${hd.fy * 100}% - 4px)`, cursor: hd.cursor }} />
      ))}
      <div onMouseDown={rotate} className="absolute bg-emerald-400 rounded-full border border-white"
        style={{ width: 10, height: 10, left: 'calc(50% - 5px)', top: -22, cursor: 'grab' }} title="Rotate" />
      <div className="absolute bg-emerald-400/60" style={{ width: 1, height: 16, left: '50%', top: -16 }} />
    </div>
  );
}
