import { useMemo, useState } from 'react';
import { MACROS, macroById, type MacroClip, type MacroField } from '../macros';
import { carouselTiming, type CarouselParams } from '../macros/carousel';
import { MediaPicker } from '../../components/MediaPicker';
import { thumbUrl } from '../../api';
import type { FlashDoc } from '../model';
import type { MediaItem } from '../../types';

// Animation macros: pick a macro, queue as many clips as you like, tune the parameters, Apply. The
// macro writes ordinary layers and keyframes into the current timeline — from that point it is just
// a document, editable by hand like anything else, and one Ctrl+Z takes the whole thing back out.
//
// The form is generated from the macro's `fields`, so a new macro needs no UI work here.
export function MacroPanel({ doc, frame, onApply }: {
  doc: FlashDoc;
  frame: number;
  onApply: (macroId: string, clips: MacroClip[], params: Record<string, unknown>, startFrame: number) => void;
}) {
  const [macroId, setMacroId] = useState(MACROS[0]!.id);
  const macro = macroById(macroId);
  const [paramsById, setParamsById] = useState<Record<string, Record<string, unknown>>>(
    () => Object.fromEntries(MACROS.map(m => [m.id, { ...m.defaults }])),
  );
  const [clips, setClips] = useState<MacroClip[]>([]);
  const [picking, setPicking] = useState(false);
  const [atPlayhead, setAtPlayhead] = useState(true);

  const params = paramsById[macroId] ?? { ...macro.defaults };
  const setParam = (key: string, v: unknown) =>
    setParamsById(s => ({ ...s, [macroId]: { ...(s[macroId] ?? macro.defaults), [key]: v } }));

  // Probe the natural size on add, exactly as the Library does when placing media, so each clip
  // lays out at its true aspect instead of an assumed 16:9.
  const addClip = (item: MediaItem) => {
    const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(item.url);
    const key = `${item.url}#${Date.now()}`;
    const base: MacroClip = { key, url: item.url, label: item.label, kind: isVideo ? 'video' : 'image', aw: 0, ah: 0 };
    setClips(c => [...c, base]);
    const size = (aw: number, ah: number) => setClips(c => c.map(x => (x.key === key ? { ...x, aw, ah } : x)));
    if (isVideo) {
      const v = document.createElement('video');
      v.onloadedmetadata = () => size(v.videoWidth, v.videoHeight);
      v.onerror = () => size(0, 0);
      v.src = item.url;
    } else {
      const img = new Image();
      img.onload = () => size(img.naturalWidth, img.naturalHeight);
      img.onerror = () => size(0, 0);
      img.src = item.url;
    }
  };

  const move = (i: number, d: number) => setClips(c => {
    const j = i + d;
    if (j < 0 || j >= c.length) return c;
    const n = [...c];
    [n[i], n[j]] = [n[j]!, n[i]!];
    return n;
  });

  const fps = doc.fps || 24;
  const total = useMemo(() => macro.length(clips.length, params as never), [macro, clips.length, params]);
  const timing = macroId === 'carousel' ? carouselTiming(clips.length, params as unknown as CarouselParams) : null;
  const ready = clips.length >= macro.minClips;
  const startFrame = atPlayhead ? frame : 0;

  return (
    <div className="h-full overflow-auto bg-slate-950 text-xs flex flex-col">
      <div className="px-2 py-1.5 border-b border-slate-800 space-y-1">
        <select className="im-input w-full" value={macroId} onChange={e => setMacroId(e.target.value)}>
          {MACROS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div className="text-[10px] leading-snug text-slate-500">{macro.blurb}</div>
      </div>

      {/* Clips — any number, in running order */}
      <div className="border-b border-slate-800">
        <div className="px-2 py-1.5 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex-1">Clips ({clips.length})</span>
          {clips.length > 0 && <button className="im-btn" onClick={() => setClips([])}>Clear</button>}
          <button className="im-btn" onClick={() => setPicking(true)}>+ Add</button>
        </div>
        <div className="px-2 pb-2 space-y-0.5">
          {clips.map((c, i) => (
            <div key={c.key} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-slate-900">
              <span className="w-4 shrink-0 text-[10px] tabular-nums text-slate-600">{i + 1}</span>
              <img src={c.kind === 'video' ? thumbUrl(c.url) : c.url} alt="" loading="lazy"
                className="w-10 h-6 shrink-0 object-cover rounded-sm bg-slate-900" />
              <div className="flex-1 min-w-0">
                <div className="truncate text-[11px]">{c.label}</div>
                <div className="text-[9px] text-slate-600">{c.aw > 0 ? `${c.aw}×${c.ah}` : 'sizing…'} · {c.kind}</div>
              </div>
              <button className="im-btn px-1" disabled={i === 0} title="Move earlier" onClick={() => move(i, -1)}>↑</button>
              <button className="im-btn px-1" disabled={i === clips.length - 1} title="Move later" onClick={() => move(i, 1)}>↓</button>
              <button className="im-btn px-1" title="Remove" onClick={() => setClips(x => x.filter(y => y.key !== c.key))}>✕</button>
            </div>
          ))}
          {!clips.length && (
            <div className="text-[10px] text-slate-600 py-2 text-center">
              Add {macro.minClips} or more clips — they run in this order.
            </div>
          )}
        </div>
      </div>

      {/* Parameters, generated from the macro definition */}
      <div className="border-b border-slate-800">
        <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Parameters</div>
        <div className="px-2 pb-2 space-y-1">
          {macro.fields.map(f => <FieldRow key={f.key} f={f} v={params[f.key]} on={v => setParam(f.key, v)} />)}
        </div>
      </div>

      {/* Summary + apply */}
      <div className="px-2 py-2 space-y-1.5 mt-auto sticky bottom-0 bg-slate-950 border-t border-slate-800">
        <label className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <input type="checkbox" checked={atPlayhead} onChange={e => setAtPlayhead(e.target.checked)} />
          Start at playhead (frame {frame})
        </label>
        <div className="text-[10px] text-slate-500 leading-relaxed">
          {ready
            ? <>Builds <b className="text-slate-300">{clips.length}</b> layers spanning <b className="text-slate-300">{total}</b> frames
                {' '}(<b className="text-slate-300">{(total / fps).toFixed(1)}s</b> @ {fps}fps)
                {timing && <> · beat {timing.beat}f · each clip lives {timing.life}f</>}</>
            : <>Needs at least {macro.minClips} clips.</>}
        </div>
        <button className="im-btn-primary w-full py-1" disabled={!ready}
          onClick={() => onApply(macroId, clips, params, startFrame)}>
          Apply macro{atPlayhead && frame > 0 ? ` at frame ${startFrame}` : ''}
        </button>
      </div>

      {picking && <MediaPicker kind="video" kinds={['video', 'image']} onClose={() => setPicking(false)} onPick={addClip} />}
    </div>
  );
}

function FieldRow({ f, v, on }: { f: MacroField<any>; v: unknown; on: (v: unknown) => void }) {
  return (
    <label className="flex items-center gap-2" title={f.hint}>
      <span className="w-24 shrink-0 text-[10px] uppercase text-slate-500 leading-tight">{f.label}</span>
      <div className="flex-1 flex items-center gap-1">
        {f.kind === 'bool' && <input type="checkbox" checked={!!v} onChange={e => on(e.target.checked)} />}
        {f.kind === 'choice' && (
          <select className="im-input flex-1" value={String(v ?? '')} onChange={e => on(e.target.value)}>
            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {f.kind === 'number' && (
          <>
            <input type="range" className="flex-1 min-w-0" min={f.min} max={f.max} step={f.step ?? 1}
              value={Number(v ?? 0)} onChange={e => on(Number(e.target.value))} />
            <input type="number" className="im-input w-14 shrink-0" min={f.min} max={f.max} step={f.step ?? 1}
              value={Number(v ?? 0)} onChange={e => on(Number(e.target.value))} />
          </>
        )}
      </div>
    </label>
  );
}
