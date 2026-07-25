import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TimelineRuler } from '@sm/components/timeline/TimelineRuler';
import { PX_PER_SEC, MIN_ZOOM, MAX_ZOOM } from '@sm/lib/bulltrackConstants';
import { DEFAULT_PRESENTATION } from '@sm/components/slideStyles';
import { Waveform } from './Waveform';
import type { IntroClock } from '../lib/clock';
import { elementWindow } from '../project';
import { isCard, type CardEl, type IntroAudio, type IntroElement, type IntroProject, type TrackEl } from '../types';

const LANE_H = 30;
const GUTTER = 150;
const SNAP_MS = 50;
const MIN_CLIP_MS = 50;

type DragMode = 'move' | 'start' | 'in' | 'hold' | 'out';

// The intro timeline. A chip is not new data — it is the element's own delay / animInMs /
// duration / animOutMs drawn end to end, so dragging it edits the very fields the L3 track
// model already stores. Zoom is Studio Mate's: PX_PER_SEC × a log-scaled zoom between a
// fit-derived minZoom and MAX_ZOOM, ± buttons, reset, and Ctrl/⌘+wheel anchored at the cursor.
export function Timeline({ project, clock, selectedId, selectedAudioId, onSelect, onSelectAudio, onPatch, onPatchAudio, onRemoveAudio }: {
  project: IntroProject;
  clock: IntroClock;
  selectedId: number | null;
  selectedAudioId: number | null;
  onSelect: (id: number) => void;
  onSelectAudio: (id: number) => void;
  onPatch: (id: number, patch: Partial<IntroElement>) => void;
  onPatchAudio: (id: number, patch: Partial<IntroAudio>) => void;
  onRemoveAudio: (id: number) => void;
}) {
  const [zoom, setZoom] = useState(4);
  const [width, setWidth] = useState(900);
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  const minZoomRef = useRef(MIN_ZOOM);

  // Zoom-out floor: the whole intro never shrinks below half the viewport (Studio Mate's rule).
  const minZoom = Math.min(MAX_ZOOM / 2, Math.max(MIN_ZOOM, (width * 500) / (Math.max(1, project.durationMs) * PX_PER_SEC)));
  const clampZoom = useCallback((z: number) => Math.min(MAX_ZOOM, Math.max(minZoom, z)), [minZoom]);
  const pxPerMs = (PX_PER_SEC * zoom) / 1000;
  zoomRef.current = zoom;
  minZoomRef.current = minZoom;

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Fit the whole intro on load / when a different project opens, unless a zoom was saved for it.
  useEffect(() => {
    const saved = Number(localStorage.getItem(`intromate:zoom:${project.id}`) || 0);
    if (saved > 0) { setZoom(saved); return; }
    if (width > 0 && project.durationMs > 0) setZoom(clampZoom((width * 1000) / (project.durationMs * PX_PER_SEC) * 0.95));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => { localStorage.setItem(`intromate:zoom:${project.id}`, String(zoom)); }, [zoom, project.id]);

  // Ctrl/⌘+wheel zoom, anchored so the time under the cursor stays under the cursor.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const prev = zoomRef.current;
      const next = Math.min(MAX_ZOOM, Math.max(minZoomRef.current, prev * (e.deltaY < 0 ? 1.15 : 0.87)));
      if (next === prev) return;
      const oldPx = (PX_PER_SEC * prev) / 1000;
      const newPx = (PX_PER_SEC * next) / 1000;
      const areaLeft = areaRef.current?.getBoundingClientRect().left ?? 0;
      const mouseMs = Math.max(0, (e.clientX - areaLeft) / oldPx);
      pendingScroll.current = Math.max(0, el.scrollLeft + mouseMs * (newPx - oldPx));
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Apply the anchored scroll after the content has been laid out at the new zoom.
  useLayoutEffect(() => {
    if (pendingScroll.current == null || !scrollRef.current) return;
    scrollRef.current.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
  }, [zoom]);

  // The playhead lives inside the scrolling content, so its offset is pure time.
  useEffect(() => clock.subscribe(t => {
    if (playheadRef.current) playheadRef.current.style.transform = `translateX(${t * pxPerMs}px)`;
  }), [clock, pxPerMs]);

  const seekFromEvent = (e: React.MouseEvent) => {
    const rect = areaRef.current!.getBoundingClientRect();
    clock.seek((e.clientX - rect.left) / pxPerMs);
  };

  // Zoom by a factor about the viewport centre (the ± buttons and keyboard).
  const zoomBy = (factor: number) => {
    const el = scrollRef.current;
    const prev = zoomRef.current;
    const next = clampZoom(prev * factor);
    if (next === prev) return;
    if (el) {
      const centreMs = (el.scrollLeft + el.clientWidth / 2 - GUTTER) / ((PX_PER_SEC * prev) / 1000);
      const newPx = (PX_PER_SEC * next) / 1000;
      pendingScroll.current = Math.max(0, centreMs * newPx - el.clientWidth / 2 + GUTTER);
    }
    setZoom(next);
  };

  function startDrag(e: React.MouseEvent, el: IntroElement, mode: DragMode) {
    e.preventDefault();
    e.stopPropagation();
    onSelect(el.id);
    const w = elementWindow(el);
    const x0 = e.clientX;
    const card = isCard(el);
    const move = (ev: MouseEvent) => {
      const raw = (ev.clientX - x0) / pxPerMs;
      const d = ev.altKey ? raw : Math.round(raw / SNAP_MS) * SNAP_MS;
      if (mode === 'move' || mode === 'start') onPatch(el.id, { delay: Math.max(0, w.start + d) } as Partial<IntroElement>);
      else if (mode === 'in') {
        const ms = Math.max(1, w.inMs + d);
        onPatch(el.id, (card ? { pres: { ...(el as CardEl).pres, showDuration: ms } } : { animInMs: ms }) as Partial<IntroElement>);
      } else if (mode === 'hold') onPatch(el.id, { duration: Math.max(0, w.holdMs + d) } as Partial<IntroElement>);
      else if (mode === 'out') {
        const ms = Math.max(1, w.outMs + d);
        onPatch(el.id, (card ? { pres: { ...(el as CardEl).pres, hideDuration: ms } } : { animOutMs: ms }) as Partial<IntroElement>);
      }
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  // Audio: body = slide the clip along the timeline; edges = trim the SOURCE from either end.
  // Trimming the head keeps the tail where it is, exactly like an NLE.
  function dragAudio(e: React.MouseEvent, cue: IntroAudio, mode: 'move' | 'head' | 'tail', fileMs: number) {
    e.preventDefault();
    e.stopPropagation();
    onSelectAudio(cue.id);
    const x0 = e.clientX;
    const start0 = cue.startMs;
    const in0 = cue.trimInMs ?? 0;
    const out0 = cue.trimOutMs && cue.trimOutMs > in0 ? cue.trimOutMs : fileMs;
    const move = (ev: MouseEvent) => {
      const raw = (ev.clientX - x0) / pxPerMs;
      const d = ev.altKey ? raw : Math.round(raw / SNAP_MS) * SNAP_MS;
      if (mode === 'move') onPatchAudio(cue.id, { startMs: Math.max(0, Math.round(start0 + d)) });
      else if (mode === 'head') {
        const trimIn = Math.max(0, Math.min(out0 - MIN_CLIP_MS, Math.round(in0 + d)));
        onPatchAudio(cue.id, { trimInMs: trimIn, startMs: Math.max(0, Math.round(start0 + (trimIn - in0))) });
      } else {
        const trimOut = Math.max(in0 + MIN_CLIP_MS, Math.min(fileMs || Infinity, Math.round(out0 + d)));
        onPatchAudio(cue.id, { trimOutMs: trimOut });
      }
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  const contentW = Math.max(width, project.durationMs * pxPerMs + 80);

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-slate-800 text-xs">
        <span className="text-[9px] uppercase text-slate-600">Zoom</span>
        <button className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 font-bold text-xs leading-none"
          onClick={() => zoomBy(0.7)} title="Zoom out">−</button>
        <input
          type="range" min={0} max={1000} step={1}
          value={Math.round((Math.log(Math.max(zoom, minZoom)) - Math.log(minZoom)) / (Math.log(MAX_ZOOM) - Math.log(minZoom)) * 1000)}
          onChange={e => {
            const t = Number(e.target.value) / 1000;
            setZoom(clampZoom(Math.exp(Math.log(minZoom) + t * (Math.log(MAX_ZOOM) - Math.log(minZoom)))));
          }}
          className="w-[110px] h-[4px] accent-sky-500"
          title={`Zoom: ${zoom.toFixed(2)}×`}
        />
        <button className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 font-bold text-xs leading-none"
          onClick={() => zoomBy(1.43)} title="Zoom in">+</button>
        <span className="text-[10px] text-slate-400 tabular-nums w-12 text-center">{zoom.toFixed(2)}×</span>
        <button className="text-[9px] text-slate-600 hover:text-slate-300" onClick={() => setZoom(clampZoom(1))} title="Reset zoom">↺</button>
        <button className="text-[9px] text-slate-600 hover:text-slate-300"
          onClick={() => setZoom(clampZoom((width * 1000) / (Math.max(1, project.durationMs) * PX_PER_SEC) * 0.95))} title="Fit the whole intro">⇔</button>
        <span className="ml-3 text-slate-600">Ctrl+wheel zooms · Alt-drag = no snap</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div className="flex" style={{ width: GUTTER + contentW }}>
          <div className="shrink-0 bg-slate-950 sticky left-0 z-20" style={{ width: GUTTER }}>
            <div className="h-[28px] border-b border-slate-800" />
            {project.elements.map(el => (
              <div key={el.id}
                className={`flex items-center gap-1 px-2 border-b border-slate-900 cursor-pointer ${selectedId === el.id ? 'bg-slate-800' : ''}`}
                style={{ height: LANE_H }}
                onClick={() => onSelect(el.id)}>
                <input type="checkbox" checked={el.enabled} onChange={e => onPatch(el.id, { enabled: e.target.checked } as Partial<IntroElement>)} className="scale-75" />
                <span className="truncate text-[11px] text-slate-300">{el.name ?? label(el)}</span>
              </div>
            ))}
            {project.audio.map(a => (
              <div key={`a${a.id}`}
                className={`flex items-center gap-1 px-2 border-b border-slate-900 cursor-pointer ${selectedAudioId === a.id ? 'bg-slate-800' : ''}`}
                style={{ height: LANE_H }}
                onClick={() => onSelectAudio(a.id)}>
                <button className="text-[10px] w-4 shrink-0 text-slate-500 hover:text-slate-200" title="Mute cue"
                  onClick={e => { e.stopPropagation(); onPatchAudio(a.id, { muted: !a.muted }); }}>{a.muted ? '🔇' : '🔊'}</button>
                <span className="truncate text-[10px] text-emerald-400 w-14">{a.label ?? 'audio'}</span>
                <input type="range" min={0} max={2} step={0.01} value={a.volume ?? 1} title="Level" className="w-14"
                  onClick={e => e.stopPropagation()}
                  onChange={e => onPatchAudio(a.id, { volume: Number(e.target.value) })} />
                <span className="text-[9px] text-slate-500 tabular-nums w-7">{Math.round((a.volume ?? 1) * 100)}</span>
                <button className="text-slate-500 hover:text-rose-400" onClick={e => { e.stopPropagation(); onRemoveAudio(a.id); }}>×</button>
              </div>
            ))}
          </div>

          <div ref={areaRef} className="relative flex-1" onMouseDown={seekFromEvent}>
            <TimelineRuler durationMs={project.durationMs} zoom={zoom} scrollLeft={0} width={contentW} gridMs={SNAP_MS * 2} />

            {project.elements.map(el => {
              const w = elementWindow(el);
              const left = w.start * pxPerMs;
              const inW = w.inMs * pxPerMs, holdW = w.holdMs * pxPerMs, outW = w.outMs * pxPerMs;
              const sel = selectedId === el.id;
              return (
                <div key={el.id} className="relative border-b border-slate-900" style={{ height: LANE_H }}>
                  <div
                    className={`absolute top-[4px] bottom-[4px] flex rounded-sm overflow-hidden ${sel ? 'ring-1 ring-sky-400' : ''} ${el.enabled ? '' : 'opacity-40'}`}
                    style={{ left, width: Math.max(6, inW + holdW + outW) }}
                    onMouseDown={e => startDrag(e, el, 'move')}
                    title={`${el.name ?? label(el)} — ${fmt(w.start)} → ${fmt(w.end)}`}
                  >
                    <div className="bg-sky-700/80 h-full" style={{ width: inW }} />
                    <div className="bg-slate-600/80 h-full" style={{ width: holdW }} />
                    <div className="bg-rose-800/80 h-full" style={{ width: outW }} />
                    <span className="absolute inset-0 flex items-center px-1 text-[10px] text-white/90 pointer-events-none truncate">
                      {el.name ?? label(el)}
                    </span>
                  </div>
                  <Handle x={left} onDown={e => startDrag(e, el, 'start')} title="start" />
                  <Handle x={left + inW} onDown={e => startDrag(e, el, 'in')} title="IN length" />
                  <Handle x={left + inW + holdW} onDown={e => startDrag(e, el, 'hold')} title="HOLD length" />
                  <Handle x={left + inW + holdW + outW} onDown={e => startDrag(e, el, 'out')} title="OUT length" />
                </div>
              );
            })}

            {project.audio.map(cue => (
              <AudioLane key={cue.id} cue={cue} pxPerMs={pxPerMs} selected={selectedAudioId === cue.id}
                onDrag={(e, mode, fileMs) => dragAudio(e, cue, mode, fileMs)} />
            ))}

            <div ref={playheadRef} className="absolute top-0 bottom-0 w-px bg-amber-400 pointer-events-none z-30" style={{ left: 0 }}>
              <div className="w-2 h-2 -ml-1 bg-amber-400 rotate-45" />
            </div>
            <div className="absolute top-0 bottom-0 border-l border-dashed border-slate-600 pointer-events-none"
              style={{ left: project.durationMs * pxPerMs }} title="project end" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Handle({ x, onDown, title }: { x: number; onDown: (e: React.MouseEvent) => void; title: string }) {
  return (
    <div
      className="absolute top-[2px] bottom-[2px] w-[7px] -ml-[3px] cursor-col-resize hover:bg-sky-400/40 z-10"
      style={{ left: x }}
      onMouseDown={onDown}
      title={title}
    />
  );
}

function AudioLane({ cue, pxPerMs, selected, onDrag }: {
  cue: IntroAudio;
  pxPerMs: number;
  selected: boolean;
  onDrag: (e: React.MouseEvent, mode: 'move' | 'head' | 'tail', fileMs: number) => void;
}) {
  const [fileMs, setFileMs] = useState(0);
  const trimIn = cue.trimInMs ?? 0;
  const trimOut = cue.trimOutMs && cue.trimOutMs > trimIn ? cue.trimOutMs : fileMs;
  const span = Math.max(0, trimOut - trimIn);
  const w = Math.max(20, span * pxPerMs);
  const left = cue.startMs * pxPerMs;
  const gain = Math.max(0, Math.min(2, cue.volume ?? 1));
  const trimmed = trimIn > 0 || (cue.trimOutMs ?? 0) > 0;

  return (
    <div className="relative border-b border-slate-900" style={{ height: LANE_H }}>
      <div
        className={`absolute top-[4px] bottom-[4px] bg-emerald-900/40 border rounded-sm overflow-hidden cursor-move ${selected ? 'border-sky-400' : 'border-emerald-700/60'} ${cue.muted ? 'opacity-40' : ''}`}
        style={{ left, width: w }}
        onMouseDown={e => onDrag(e, 'move', fileMs)}
        title={`${cue.label ?? 'audio'} — ${fmt(span)}${trimmed ? ` of ${fmt(fileMs)}` : ''} · level ${Math.round(gain * 100)}%`}
      >
        {/* Only the trimmed slice of the file is drawn, so the chip shows what you actually hear. */}
        <Waveform url={cue.url} width={w} height={LANE_H - 8} lazy={false}
          buckets={Math.min(2000, Math.max(200, Math.round(w)))}
          startFrac={fileMs ? trimIn / fileMs : 0}
          endFrac={fileMs ? trimOut / fileMs : 1}
          onDuration={setFileMs} />
        <div className="absolute left-0 right-0 border-t border-sky-400/70 pointer-events-none" style={{ top: `${50 - Math.min(50, gain * 25)}%` }} />
        <div className="absolute left-0 right-0 border-b border-sky-400/70 pointer-events-none" style={{ bottom: `${50 - Math.min(50, gain * 25)}%` }} />
        {cue.fadeInMs > 0 && <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-slate-950/80 to-transparent pointer-events-none" style={{ width: cue.fadeInMs * pxPerMs }} />}
        {cue.fadeOutMs > 0 && <div className="absolute top-0 bottom-0 right-0 bg-gradient-to-l from-slate-950/80 to-transparent pointer-events-none" style={{ width: cue.fadeOutMs * pxPerMs }} />}
      </div>
      {/* Trim handles — head and tail of the SOURCE clip. */}
      <div className="absolute top-[4px] bottom-[4px] w-[7px] cursor-col-resize hover:bg-emerald-300/50 z-10"
        style={{ left: left - 3 }} title="Trim head" onMouseDown={e => onDrag(e, 'head', fileMs)} />
      <div className="absolute top-[4px] bottom-[4px] w-[7px] cursor-col-resize hover:bg-emerald-300/50 z-10"
        style={{ left: left + w - 4 }} title="Trim tail" onMouseDown={e => onDrag(e, 'tail', fileMs)} />
    </div>
  );
}

const label = (el: IntroElement) => isCard(el) ? (el.type === 'video' ? 'Video' : 'Card') : ((el as TrackEl).type);
const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

export const defaultCardIn = DEFAULT_PRESENTATION.showDuration;
