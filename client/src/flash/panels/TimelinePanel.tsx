import { useRef } from 'react';
import type { FlashDoc, Layer, Symbol } from '../model';
import { symbolLength } from '../model';

const FRAME_W = 12;
const LAYER_H = 22;
const NAME_W = 150;

// The layers×frames grid for the symbol currently being edited. Keyframes are dots; held frames are
// a bar to the next keyframe; a tween span is tinted with an arrow. Click the ruler or a cell to move
// the playhead; click a layer name to select it (the target for keyframe/frame commands).
export function TimelinePanel({ doc, symbol, frame, selectedLayerId, selectedKfFrame, onSeek, onSelectLayer, onSelectKeyframe, onMoveKeyframe, onFrameContext, onToggleVisible, onToggleLock, onPatchLayerName, onAddLayer, onDeleteLayer }: {
  doc: FlashDoc;
  symbol: Symbol;
  frame: number;
  selectedLayerId: string | null;
  selectedKfFrame: number | null;
  onSeek: (frame: number) => void;
  onSelectLayer: (id: string) => void;
  onSelectKeyframe: (layerId: string, frame: number) => void;
  onMoveKeyframe: (layerId: string, from: number, to: number) => void;
  onFrameContext: (e: React.MouseEvent, layerId: string, frame: number) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onPatchLayerName: (id: string, name: string) => void;
  onAddLayer: () => void;
  onDeleteLayer: (id: string) => void;
}) {
  const len = Math.max(48, symbolLength(symbol) + 12);
  const gridRef = useRef<HTMLDivElement>(null);
  const layers = [...symbol.layers].sort((a, b) => b.ord - a.ord); // top layer first (front on top)

  const seekAt = (clientX: number) => {
    const rect = gridRef.current!.getBoundingClientRect();
    onSeek(Math.max(0, Math.floor((clientX - rect.left) / FRAME_W)));
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-xs select-none overflow-hidden">
      {/* Ruler */}
      <div className="flex border-b border-slate-800 shrink-0">
        <div className="shrink-0 bg-slate-900 border-r border-slate-800 flex items-center gap-1 px-1" style={{ width: NAME_W }}>
          <button className="im-btn text-[10px] py-0" onClick={onAddLayer} title="New Layer (Ctrl+Shift+L)">+ Layer</button>
          <button className="im-btn text-[10px] py-0 disabled:opacity-40" disabled={!selectedLayerId} onClick={() => selectedLayerId && onDeleteLayer(selectedLayerId)} title="Delete selected layer">🗑</button>
        </div>
        <div ref={gridRef} className="relative overflow-hidden flex-1 cursor-pointer" style={{ height: 20 }}
          onMouseDown={e => seekAt(e.clientX)}>
          <div className="relative" style={{ width: len * FRAME_W, height: 20 }}>
            {Array.from({ length: Math.ceil(len / 5) + 1 }, (_, i) => i * 5).map(f => (
              <div key={f} className="absolute top-0 h-full border-l border-slate-800 text-[9px] text-slate-500 pl-0.5" style={{ left: f * FRAME_W }}>{f}</div>
            ))}
            <div className="absolute top-0 bottom-0 w-px bg-amber-400 z-10 pointer-events-none" style={{ left: frame * FRAME_W + FRAME_W / 2 }} />
          </div>
        </div>
      </div>

      {/* Layer rows */}
      <div className="flex-1 overflow-auto">
        {layers.map(layer => (
          <LayerRow key={layer.id} layer={layer} len={len} frame={frame}
            selected={selectedLayerId === layer.id}
            selectedKfFrame={selectedLayerId === layer.id ? selectedKfFrame : null}
            onSelect={() => onSelectLayer(layer.id)}
            onSeek={onSeek}
            onSelectKeyframe={f => onSelectKeyframe(layer.id, f)}
            onMoveKeyframe={(from, to) => onMoveKeyframe(layer.id, from, to)}
            onContext={(e, f) => onFrameContext(e, layer.id, f)}
            onToggleVisible={() => onToggleVisible(layer.id)}
            onToggleLock={() => onToggleLock(layer.id)}
            onRename={n => onPatchLayerName(layer.id, n)} />
        ))}
      </div>
    </div>
  );
}

function LayerRow({ layer, len, frame, selected, selectedKfFrame, onSelect, onSeek, onSelectKeyframe, onMoveKeyframe, onContext, onToggleVisible, onToggleLock, onRename }: {
  layer: Layer; len: number; frame: number; selected: boolean; selectedKfFrame: number | null;
  onSelect: () => void; onSeek: (f: number) => void; onSelectKeyframe: (f: number) => void;
  onMoveKeyframe: (from: number, to: number) => void; onContext: (e: React.MouseEvent, f: number) => void;
  onToggleVisible: () => void; onToggleLock: () => void; onRename: (n: string) => void;
}) {
  const kfFrames = layer.keyframes.map(k => k.frame).sort((a, b) => a - b);
  const nextOf = (f: number) => kfFrames.find(x => x > f) ?? len;
  const frameAt = (clientX: number, el: HTMLElement) => Math.max(0, Math.floor((clientX - el.getBoundingClientRect().left) / FRAME_W));

  // Drag a keyframe dot to a new frame (frame 0 is pinned). Live-updates so it slides under the cursor.
  function dragKf(e: React.MouseEvent, from: number) {
    e.stopPropagation();
    onSelect(); onSelectKeyframe(from);
    if (from === 0) return; // pinned
    const grid = (e.currentTarget as HTMLElement).closest('[data-frames]') as HTMLElement;
    let current = from;
    const move = (ev: MouseEvent) => {
      const to = Math.max(1, frameAt(ev.clientX, grid));
      if (to !== current) { onMoveKeyframe(current, to); current = to; }
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  return (
    <div className={`flex border-b border-slate-900 ${selected ? 'bg-slate-800/60' : ''}`} style={{ height: LAYER_H }}>
      <div className="shrink-0 flex items-center gap-1 px-1 border-r border-slate-800 bg-slate-900" style={{ width: NAME_W }} onMouseDown={onSelect}>
        <button className="w-4 text-slate-400 hover:text-white" title="Show/Hide" onClick={e => { e.stopPropagation(); onToggleVisible(); }}>{layer.visible ? '👁' : '·'}</button>
        <button className="w-4 text-slate-400 hover:text-white" title="Lock" onClick={e => { e.stopPropagation(); onToggleLock(); }}>{layer.locked ? '🔒' : '·'}</button>
        <input className="flex-1 min-w-0 bg-transparent text-[11px] text-slate-200 outline-none" value={layer.name}
          onChange={e => onRename(e.target.value)} onMouseDown={e => e.stopPropagation()} />
      </div>
      <div className="relative flex-1 overflow-hidden" data-frames
        onMouseDown={e => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); onSelect(); onSeek(Math.max(0, Math.floor((e.clientX - rect.left) / FRAME_W))); }}
        onContextMenu={e => onContext(e, frameAt(e.clientX, e.currentTarget as HTMLElement))}>
        <div className="relative h-full" style={{ width: len * FRAME_W }}>
          {/* Empty-frame ticks every 5 */}
          {Array.from({ length: Math.ceil(len / 5) + 1 }, (_, i) => i * 5).map(f => (
            <div key={f} className="absolute top-0 h-full border-l border-slate-800/60" style={{ left: f * FRAME_W }} />
          ))}
          {/* Held-frame bars + keyframe dots */}
          {layer.keyframes.map(k => {
            const end = nextOf(k.frame);
            const span = (end - k.frame) * FRAME_W;
            const tween = k.tween !== 'none';
            return (
              <div key={k.id} className="absolute top-0 h-full" style={{ left: k.frame * FRAME_W, width: span }}>
                <div className="absolute top-[3px] bottom-[3px] left-0 right-[1px] rounded-sm"
                  style={{ background: tween ? 'rgba(124,92,255,0.35)' : (k.kind === 'blank' ? 'transparent' : 'rgba(148,163,184,0.18)') }} />
                {tween && <div className="absolute top-1/2 left-2 right-2 border-t border-violet-300/60" />}
                <div className={`absolute rounded-full ${k.frame === 0 ? '' : 'cursor-grab active:cursor-grabbing'}`}
                  onMouseDown={e => dragKf(e, k.frame)}
                  style={{
                    left: FRAME_W / 2 - 4, top: LAYER_H / 2 - 4, width: 8, height: 8,
                    background: k.kind === 'blank' ? 'transparent' : '#e2e8f0',
                    border: selectedKfFrame === k.frame ? '2px solid #38bdf8' : (k.kind === 'blank' ? '1px solid #64748b' : 'none'),
                    boxShadow: selectedKfFrame === k.frame ? '0 0 0 1px #38bdf8' : undefined,
                  }} />
              </div>
            );
          })}
          <div className="absolute top-0 bottom-0 w-px bg-amber-400/70 pointer-events-none" style={{ left: frame * FRAME_W + FRAME_W / 2 }} />
        </div>
      </div>
    </div>
  );
}
