import { BezierEditor } from '@sm/titles/components/BezierEditor';
import type { FlashDoc, HeldParam, Keyframe, Node, Symbol, TweenKind } from '../model';

// Contextual property inspector: it changes with the selection, Flash-style. A selected node shows
// its transform + type props; a selected keyframe shows its tween + easing bezier graph; otherwise
// the document properties.
export function InspectorPanel({ doc, symbol, selectedNode, selectedKeyframe, selectedLayerId,
  onPatchNode, onPatchKeyframe, onPatchDoc }: {
  doc: FlashDoc;
  symbol: Symbol;
  selectedNode: Node | null;
  selectedKeyframe: Keyframe | null;
  selectedLayerId: string | null;
  onPatchNode: (nodeId: string, patch: Partial<Node>) => void;
  onPatchKeyframe: (layerId: string, frame: number, patch: Partial<Keyframe>) => void;
  onPatchDoc: (patch: Partial<FlashDoc>) => void;
}) {
  return (
    <div className="h-full overflow-auto bg-slate-950 text-xs">
      {selectedNode
        ? <NodeInspector node={selectedNode} doc={doc} onPatch={p => onPatchNode(selectedNode.id, p)} />
        : selectedKeyframe && selectedLayerId
          ? <KeyframeInspector kf={selectedKeyframe} onPatch={p => onPatchKeyframe(selectedLayerId, selectedKeyframe.frame, p)} />
          : <DocInspector doc={doc} symbol={symbol} onPatch={onPatchDoc} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-800">
      <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="px-2 pb-2 space-y-1">{children}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] uppercase text-slate-500">{label}</span>
      <div className="flex-1 flex items-center gap-1">{children}</div>
    </label>
  );
}
const N = ({ v, on, step = 1 }: { v: number | undefined; on: (n: number) => void; step?: number }) =>
  <input type="number" className="im-input" value={v ?? 0} step={step} onChange={e => on(Number(e.target.value))} />;
const T = ({ v, on }: { v: string | undefined; on: (s: string) => void }) =>
  <input className="im-input" value={v ?? ''} onChange={e => on(e.target.value)} />;

// ── Node ──────────────────────────────────────────────────────────────────────
function NodeInspector({ node, doc, onPatch }: { node: Node; doc: FlashDoc; onPatch: (p: Partial<Node>) => void }) {
  const p = (node.props ?? {}) as any;
  const setProp = (patch: Record<string, unknown>) => onPatch({ props: { ...node.props, ...patch } });
  const refSym = node.kind === 'instance' ? doc.symbols.find(s => s.id === node.symbolRef) : null;

  // Per-parameter HOLD toggle — a held param won't tween out of this keyframe (AE / Resolve).
  const held = new Set(node.hold ?? []);
  const toggleHold = (k: HeldParam) => {
    const next = new Set(held);
    next.has(k) ? next.delete(k) : next.add(k);
    onPatch({ hold: [...next] });
  };
  const Hold = ({ k }: { k: HeldParam }) => (
    <button className={`w-5 h-5 shrink-0 rounded border text-[9px] ${held.has(k) ? 'border-amber-500 bg-amber-500/20 text-amber-300' : 'border-slate-700 text-slate-600 hover:text-slate-300'}`}
      title={held.has(k) ? 'Held — will not tween' : 'Hold this parameter across the tween'} onClick={() => toggleHold(k)}>⏸</button>
  );

  return (
    <>
      <Section title={`Keyframe · ${node.kind}${refSym ? ` · ${refSym.name}` : ''}`}>
        {node.kind === 'instance' && <Field label="Name"><T v={node.name ?? ''} on={v => onPatch({ name: v })} /></Field>}
        <Field label="X"><N v={node.x} on={v => onPatch({ x: v })} /><Hold k="x" /></Field>
        <Field label="Y"><N v={node.y} on={v => onPatch({ y: v })} /><Hold k="y" /></Field>
        <Field label="Scale X"><N v={node.scaleX} step={0.01} on={v => onPatch({ scaleX: v })} /><Hold k="scaleX" /></Field>
        <Field label="Scale Y"><N v={node.scaleY} step={0.01} on={v => onPatch({ scaleY: v })} /><Hold k="scaleY" /></Field>
        <Field label="Rotate"><N v={node.rotation} on={v => onPatch({ rotation: v })} /><Hold k="rotation" /></Field>
        <Field label="Skew X"><N v={node.skewX} on={v => onPatch({ skewX: v })} /><Hold k="skewX" /></Field>
        <Field label="Skew Y"><N v={node.skewY} on={v => onPatch({ skewY: v })} /><Hold k="skewY" /></Field>
        <Field label="Alpha"><input type="range" min={0} max={1} step={0.01} value={node.alpha} className="flex-1" onChange={e => onPatch({ alpha: Number(e.target.value) })} /><Hold k="alpha" /></Field>
      </Section>

      {node.kind === 'instance' && (
        <Section title="Symbol">
          <Field label="Loop">
            <select className="im-input" value={node.loopMode ?? 'loop'} onChange={e => onPatch({ loopMode: e.target.value as any })}>
              <option value="loop">Loop</option><option value="playonce">Play Once</option><option value="single">Single Frame</option>
            </select>
          </Field>
          <Field label="First fr"><N v={node.firstFrame} on={v => onPatch({ firstFrame: v })} /></Field>
        </Section>
      )}

      {node.kind === 'text' && (
        <Section title="Text">
          <Field label="Text"><T v={p.text} on={v => setProp({ text: v })} /></Field>
          <Field label="Size"><N v={p.size} on={v => setProp({ size: v })} /></Field>
          <Field label="Color"><input type="color" className="w-7 h-6 bg-transparent border border-slate-700 rounded" value={p.color ?? '#ffffff'} onChange={e => setProp({ color: e.target.value })} /><T v={p.color} on={v => setProp({ color: v })} /></Field>
          <Field label="Align">
            <select className="im-input" value={p.align ?? 'left'} onChange={e => setProp({ align: e.target.value })}>
              <option>left</option><option>center</option><option>right</option>
            </select>
          </Field>
        </Section>
      )}

      {node.kind === 'shape' && (
        <Section title="Shape">
          <Field label="Fill"><Swatch v={p.fill ?? '#3aa0ff'} on={v => setProp({ fill: v })} /></Field>
          <Field label="Width"><N v={p.w} on={v => setProp({ w: v })} /></Field>
          <Field label="Height"><N v={p.h} on={v => setProp({ h: v })} /></Field>
        </Section>
      )}

      {(node.kind === 'image' || node.kind === 'video') && (
        <Section title="Size & Crop">
          <Field label="Width"><N v={p.w} on={v => setProp({ w: v })} /></Field>
          <Field label="Height"><N v={p.h} on={v => setProp({ h: v })} /></Field>
          <div className="text-[10px] uppercase text-slate-500 mt-1 mb-0.5">Crop (0–1)</div>
          <Field label="Left"><Slide v={p.crop?.x ?? 0} min={0} max={0.9} step={0.01} on={v => setCrop(p, setProp, { x: v })} /></Field>
          <Field label="Top"><Slide v={p.crop?.y ?? 0} min={0} max={0.9} step={0.01} on={v => setCrop(p, setProp, { y: v })} /></Field>
          <Field label="Width"><Slide v={p.crop?.w ?? 1} min={0.1} max={1} step={0.01} on={v => setCrop(p, setProp, { w: v })} /></Field>
          <Field label="Height"><Slide v={p.crop?.h ?? 1} min={0.1} max={1} step={0.01} on={v => setCrop(p, setProp, { h: v })} /></Field>
          <button className="im-btn mt-1" onClick={() => setProp({ crop: undefined })}>Reset crop</button>
        </Section>
      )}

      {node.kind === 'video' && (
        <Section title="Video">
          <Field label="Muted"><Check v={p.muted} on={v => setProp({ muted: v })} /></Field>
          <Field label="Volume"><Slide v={p.volume ?? 1} min={0} max={2} step={0.01} on={v => setProp({ volume: v })} /></Field>
          <Field label="Trim in"><N v={p.trimInMs} step={100} on={v => setProp({ trimInMs: v })} /></Field>
          <Field label="Trim out"><N v={p.trimOutMs} step={100} on={v => setProp({ trimOutMs: v })} /></Field>
          <Field label="Fade in"><Slide v={p.fadeInMs ?? 0} min={0} max={4000} step={50} on={v => setProp({ fadeInMs: v })} /></Field>
          <Field label="Fade out"><Slide v={p.fadeOutMs ?? 0} min={0} max={4000} step={50} on={v => setProp({ fadeOutMs: v })} /></Field>
        </Section>
      )}

      {(node.kind === 'image' || node.kind === 'video' || node.kind === 'text' || node.kind === 'shape') && (
        <Section title="Border">
          <Field label="Radius"><Slide v={p.borderRadius ?? p.radius ?? 0} min={0} max={200} on={v => setProp({ borderRadius: v, radius: v })} /></Field>
          <Field label="Thickness"><Slide v={p.borderWidth ?? p.strokeWidth ?? 0} min={0} max={40} on={v => setProp({ borderWidth: v, strokeWidth: v })} /></Field>
          <Field label="Colour"><Swatch v={p.borderColor ?? p.stroke ?? '#ffffff'} on={v => setProp({ borderColor: v, stroke: v })} /></Field>
          <Field label="Style">
            <select className="im-input" value={p.borderStyle ?? 'solid'} onChange={e => setProp({ borderStyle: e.target.value })}>
              <option>solid</option><option>dashed</option><option>dotted</option>
            </select>
          </Field>
        </Section>
      )}

      {(node.kind === 'image' || node.kind === 'video' || node.kind === 'text') && (
        <Section title="Surface Reflection">
          <Field label="On"><Check v={p.reflection} on={v => setProp({ reflection: v })} /></Field>
          <Field label="Object %"><Slide v={p.reflectionOpacityMain ?? 100} min={0} max={100} on={v => setProp({ reflectionOpacityMain: v })} /></Field>
          <Field label="Reflect %"><Slide v={p.reflectionOpacity ?? 50} min={0} max={100} on={v => setProp({ reflectionOpacity: v })} /></Field>
          <Field label="Distance"><Slide v={p.reflectionDistance ?? 0} min={0} max={200} on={v => setProp({ reflectionDistance: v })} /></Field>
          <Field label="Feather"><Slide v={p.reflectionFeather ?? 67} min={0} max={100} on={v => setProp({ reflectionFeather: v })} /></Field>
        </Section>
      )}
    </>
  );
}

// Slider + numeric, and a colour input with preset swatches — the shared media controls.
function Slide({ v, on, min, max, step = 1 }: { v: number | undefined; on: (n: number) => void; min: number; max: number; step?: number }) {
  return (
    <>
      <input type="range" className="flex-1" min={min} max={max} step={step} value={v ?? 0} onChange={e => on(Number(e.target.value))} />
      <input type="number" className="im-input w-14" value={v ?? 0} step={step} onChange={e => on(Number(e.target.value))} />
    </>
  );
}
const SWATCHES = ['#ffffff', '#000000', '#ff4d4d', '#ffb020', '#ffe14d', '#3aff8a', '#38bdf8', '#7c5cff', '#ff5cc8', '#8b5e3c'];
function Swatch({ v, on }: { v: string; on: (s: string) => void }) {
  return (
    <div className="flex-1 flex items-center gap-1 flex-wrap">
      <input type="color" className="w-7 h-6 bg-transparent border border-slate-700 rounded" value={(v ?? '#ffffff').slice(0, 7)} onChange={e => on(e.target.value)} />
      <input className="im-input w-20" value={v ?? ''} onChange={e => on(e.target.value)} />
      <div className="flex gap-0.5 mt-0.5 basis-full">
        {SWATCHES.map(c => <button key={c} className="w-4 h-4 rounded-sm border border-slate-700" style={{ background: c }} onClick={() => on(c)} title={c} />)}
      </div>
    </div>
  );
}
function Check({ v, on }: { v: boolean | undefined; on: (b: boolean) => void }) {
  return <input type="checkbox" checked={!!v} onChange={e => on(e.target.checked)} />;
}
function setCrop(p: any, setProp: (patch: Record<string, unknown>) => void, patch: Partial<{ x: number; y: number; w: number; h: number }>) {
  const c = { x: 0, y: 0, w: 1, h: 1, ...(p.crop ?? {}), ...patch };
  setProp({ crop: c });
}

// ── Keyframe (tween + easing graph) ─────────────────────────────────────────────
const EASE_PRESETS: { label: string; ease: number[] }[] = [
  { label: 'Linear', ease: [0, 0, 1, 1] },
  { label: 'Ease', ease: [0.25, 0.1, 0.25, 1] },
  { label: 'Ease In', ease: [0.42, 0, 1, 1] },
  { label: 'Ease Out', ease: [0, 0, 0.58, 1] },
  { label: 'Ease In-Out', ease: [0.42, 0, 0.58, 1] },
  { label: 'Back Out', ease: [0.34, 1.56, 0.64, 1] },
  { label: 'Bounce-ish', ease: [0.68, -0.55, 0.27, 1.55] },
];

function KeyframeInspector({ kf, onPatch }: { kf: Keyframe; onPatch: (p: Partial<Keyframe>) => void }) {
  const ease = (kf.ease && kf.ease.length === 4 ? kf.ease : [0.25, 0.1, 0.25, 1]) as [number, number, number, number];
  return (
    <>
      <Section title={`Keyframe · frame ${kf.frame}`}>
        <Field label="Tween">
          <select className="im-input" value={kf.tween} onChange={e => onPatch({ tween: e.target.value as TweenKind })}>
            <option value="none">None</option>
            <option value="motion">Motion</option>
            <option value="classic">Classic</option>
            <option value="shape">Shape</option>
          </select>
        </Field>
        <Field label="Label"><T v={kf.label ?? ''} on={v => onPatch({ label: v || null })} /></Field>
      </Section>

      {kf.tween !== 'none' && (
        <Section title="Easing (A → B)">
          <select className="im-input mb-1" value={EASE_PRESETS.findIndex(p => sameEase(p.ease, ease))}
            onChange={e => { const i = Number(e.target.value); if (i >= 0) onPatch({ ease: EASE_PRESETS[i]!.ease }); }}>
            <option value={-1}>Custom…</option>
            {EASE_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </select>
          <BezierEditor value={ease} onChange={v => onPatch({ ease: v })} />
        </Section>
      )}
    </>
  );
}
const sameEase = (a: number[], b: number[]) => a.length === 4 && b.length === 4 && a.every((v, i) => Math.abs(v - b[i]!) < 0.001);

// ── Document ───────────────────────────────────────────────────────────────────
function DocInspector({ doc, symbol, onPatch }: { doc: FlashDoc; symbol: Symbol; onPatch: (p: Partial<FlashDoc>) => void }) {
  return (
    <>
      <Section title={`Editing · ${symbol.name}`}>
        <div className="text-[11px] text-slate-500">Select an object or a keyframe to edit its properties.</div>
      </Section>
      <Section title="Document">
        <Field label="Name"><T v={doc.name} on={v => onPatch({ name: v })} /></Field>
        <Field label="Width"><N v={doc.width} on={v => onPatch({ width: v })} /></Field>
        <Field label="Height"><N v={doc.height} on={v => onPatch({ height: v })} /></Field>
        <Field label="FPS"><N v={doc.fps} on={v => onPatch({ fps: v })} /></Field>
        <Field label="BG"><input type="color" className="w-7 h-6 bg-transparent border border-slate-700 rounded" value={doc.bg} onChange={e => onPatch({ bg: e.target.value })} /><T v={doc.bg} on={v => onPatch({ bg: v })} /></Field>
      </Section>
    </>
  );
}
