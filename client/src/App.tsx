import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api';
import { IntroClock } from './lib/clock';
import { useAudioBed } from './lib/audioBed';
import { HISTORY_LIMIT, useHistory } from './lib/history';
import { IntroStage } from './components/IntroStage';
import { Timeline } from './components/Timeline';
import { Inspector } from './components/Inspector';
import { ExportDialog } from './components/ExportDialog';
import { MediaPicker } from './components/MediaPicker';
import { defaultProject, elementWindow, newElement, nextId, projectEnd } from './project';
import type { IntroAudio, IntroElement, IntroProject } from './types';

const LAST_KEY = 'intromate:lastProject';

const ADD_KINDS: { kind: Parameters<typeof newElement>[0]; label: string }[] = [
  { kind: 'text', label: 'Text' },
  { kind: 'gradientText', label: 'Gradient' },
  { kind: 'image', label: 'Image' },
  { kind: 'shape', label: 'Shape' },
  { kind: 'card', label: 'Card 3D' },
  { kind: 'video', label: 'Video' },
];

export default function App() {
  const clock = useMemo(() => new IntroClock(), []);
  // Every edit goes through `commit`, so undo/redo covers the whole app — 100 steps deep.
  const { present: project, commit: setProject, undo, redo, reset: resetHistory, canUndo, canRedo, undoDepth } =
    useHistory<IntroProject | null>(null, HISTORY_LIMIT);
  const [projects, setProjects] = useState<api.ProjectMeta[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(null);
  const [fonts, setFonts] = useState<{ id: string; label: string }[]>([]);
  const [exporting, setExporting] = useState(false);
  const [addingAudio, setAddingAudio] = useState(false);
  const [muted, setMuted] = useState(false);
  const [, force] = useState(0);
  const stageBox = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 960, h: 540 });
  const timeRef = useRef<HTMLSpanElement>(null);
  const loaded = useRef(false);

  useEffect(() => { clock.onState = () => force(n => n + 1); }, [clock]);
  useEffect(() => clock.subscribe(t => { if (timeRef.current) timeRef.current.textContent = `${(t / 1000).toFixed(2)}s`; }), [clock]);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    api.listFonts().then(setFonts).catch(() => {});
    (async () => {
      const list = await api.listProjects().catch(() => []);
      setProjects(list);
      const last = localStorage.getItem(LAST_KEY);
      const pick = list.find(p => p.id === last) ?? list[0];
      // Opening a project starts a fresh history — you can't undo past the file you loaded.
      resetHistory(pick ? await api.loadProject(pick.id) : await api.createProject(defaultProject('first-intro', 'First Intro')));
      loaded.current = true;
    })();
  }, []);

  useEffect(() => { if (project) localStorage.setItem(LAST_KEY, project.id); }, [project?.id]);

  // ── Autosave ───────────────────────────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!project || !loaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.saveProject(project).then(() => api.listProjects().then(setProjects)).catch(() => {});
    }, 900);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [project]);

  useEffect(() => {
    const el = stageBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth - 24, h: el.clientHeight - 24 }));
    ro.observe(el);
    setBox({ w: el.clientWidth - 24, h: el.clientHeight - 24 });
    return () => ro.disconnect();
  }, [project?.id]);

  useAudioBed(project?.audio ?? [], clock, muted, project?.masterVolume ?? 1);

  // ── Edits ──────────────────────────────────────────────────────────────────
  // The coalesce key is "what is being edited", so one drag of one slider or chip collapses into a
  // single undo step. Discrete edits (a checkbox, a picked preset) get NO key — flipping a toggle
  // twice must be two steps, not one.
  const coalesceKey = (prefix: string, patch: object): string | undefined =>
    Object.values(patch).some(v => typeof v === 'boolean') ? undefined : `${prefix}:${Object.keys(patch).join(',')}`;

  const patchElement = useCallback((id: number, patch: Partial<IntroElement>) => {
    setProject(p => p && ({ ...p, elements: p.elements.map(e => e.id === id ? { ...e, ...patch } as IntroElement : e) }),
      coalesceKey(`el:${id}`, patch));
  }, [setProject]);
  const patchProject = useCallback((patch: Partial<IntroProject>) => {
    setProject(p => p && ({ ...p, ...patch }), coalesceKey('pj', patch));
  }, [setProject]);
  const patchAudio = useCallback((id: number, patch: Partial<IntroAudio>) => {
    setProject(p => p && ({ ...p, audio: p.audio.map(a => a.id === id ? { ...a, ...patch } : a) }),
      coalesceKey(`au:${id}`, patch));
  }, [setProject]);
  const removeAudio = useCallback((id: number) => {
    setProject(p => p && ({ ...p, audio: p.audio.filter(a => a.id !== id) }));
  }, [setProject]);

  // State updaters stay pure — selection is set alongside, never inside them (an impure updater
  // can run twice and add the element twice).
  const addElement = (kind: Parameters<typeof newElement>[0]) => {
    if (!project) return;
    const el = newElement(kind, nextId(project.elements), Math.round(clock.timeMs));
    setProject(p => p && ({ ...p, elements: [...p.elements, el] }));
    setSelectedId(el.id);
    setSelectedAudioId(null);
  };

  const removeElement = (id: number) => setProject(p => p && ({ ...p, elements: p.elements.filter(e => e.id !== id) }));

  const duplicateElement = (id: number) => {
    if (!project) return;
    const src = project.elements.find(e => e.id === id);
    if (!src) return;
    const copy = { ...JSON.parse(JSON.stringify(src)), id: nextId(project.elements), delay: elementWindow(src).end } as IntroElement;
    setProject(p => p && ({ ...p, elements: [...p.elements, copy] }));
    setSelectedId(copy.id);
  };

  const fitDuration = () => setProject(p => p && ({ ...p, durationMs: Math.max(1000, Math.ceil(projectEnd(p) / 100) * 100) }));

  // ── Shortcuts ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      // Undo/redo work everywhere except inside a text field, where the browser's own
      // per-field undo is what you want.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault(); redo(); return;
      }
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); clock.toggle(); }
      else if (e.key === 'Home') clock.seek(0);
      else if (e.key === 'End') clock.seek(clock.durationMs);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId != null) removeElement(selectedId);
      else if (e.key === 'ArrowLeft') clock.seek(clock.timeMs - (e.shiftKey ? 1000 : 100));
      else if (e.key === 'ArrowRight') clock.seek(clock.timeMs + (e.shiftKey ? 1000 : 100));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [clock, selectedId, undo, redo]);

  if (!project) return <div className="h-screen flex items-center justify-center text-slate-500">Loading IntroMate…</div>;

  const selected = project.elements.find(e => e.id === selectedId) ?? null;
  const selectedAudio = project.audio.find(a => a.id === selectedAudioId) ?? null;

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-200">
      {/* Header */}
      <header className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        <span className="font-semibold text-sky-400">IntroMate</span>
        <select className="im-input w-52" value={project.id}
          onChange={async e => { resetHistory(await api.loadProject(e.target.value)); setSelectedId(null); setSelectedAudioId(null); clock.seek(0); }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="im-btn" onClick={async () => {
          const name = prompt('New intro name', 'Untitled Intro');
          if (!name) return;
          const p = await api.createProject(defaultProject(name.toLowerCase().replace(/\s+/g, '-'), name));
          setProjects(await api.listProjects());
          resetHistory(p);
        }}>New</button>
        <button className="im-btn" onClick={async () => {
          const name = prompt('Duplicate as', `${project.name} copy`);
          if (!name) return;
          const p = await api.duplicateProject(project.id, name);
          setProjects(await api.listProjects());
          resetHistory(p);
        }}>Duplicate</button>
        <button className="im-btn" onClick={async () => {
          if (!confirm(`Delete “${project.name}”? This cannot be undone.`)) return;
          await api.deleteProject(project.id);
          const list = await api.listProjects();
          setProjects(list);
          resetHistory(list[0] ? await api.loadProject(list[0].id) : defaultProject());
        }}>Delete</button>

        <button className="im-btn" onClick={undo} disabled={!canUndo} title={`Undo (Ctrl+Z) — ${undoDepth}/${HISTORY_LIMIT}`}>↶</button>
        <button className="im-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">↷</button>
        <span className="text-[10px] text-slate-600 tabular-nums w-8">{undoDepth}</span>

        <div className="flex-1" />

        <button className="im-btn" onClick={() => clock.seek(0)} title="Home">⏮</button>
        <button className="im-btn-primary w-16" onClick={() => clock.toggle()} title="Space">{clock.playing ? 'Pause' : 'Play'}</button>
        <span ref={timeRef} className="w-16 text-right tabular-nums text-xs text-slate-400">0.00s</span>
        <span className="text-xs text-slate-600">/ {(project.durationMs / 1000).toFixed(2)}s</span>
        <button className="im-btn" onClick={fitDuration} title="Set the project length to the last element's end">Fit</button>
        <button className="im-btn" onClick={() => setMuted(m => !m)}>{muted ? 'Unmute' : 'Mute'}</button>
        <button className="im-btn-primary" onClick={() => setExporting(true)}>Render…</button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Elements */}
        <aside className="w-44 shrink-0 border-r border-slate-800 flex flex-col">
          <div className="p-2 grid grid-cols-2 gap-1">
            {ADD_KINDS.map(k => <button key={k.kind} className="im-btn" onClick={() => addElement(k.kind)}>+ {k.label}</button>)}
            <button className="im-btn col-span-2" onClick={() => setAddingAudio(true)}>+ Audio</button>
          </div>
          <div className="flex-1 overflow-auto border-t border-slate-800">
            {project.elements.map(el => (
              <div key={el.id}
                className={`group flex items-center gap-1 px-2 py-1 text-xs cursor-pointer border-b border-slate-900 ${selectedId === el.id ? 'bg-slate-800 text-sky-300' : 'hover:bg-slate-900'}`}
                onClick={() => { setSelectedId(el.id); setSelectedAudioId(null); }}>
                <span className="flex-1 truncate">{el.name ?? el.type}</span>
                <button className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-sky-400" title="Duplicate"
                  onClick={e => { e.stopPropagation(); duplicateElement(el.id); }}>⧉</button>
                <button className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400" title="Delete"
                  onClick={e => { e.stopPropagation(); removeElement(el.id); }}>×</button>
              </div>
            ))}
          </div>
        </aside>

        {/* Stage */}
        <main ref={stageBox} className="flex-1 min-w-0 flex items-center justify-center bg-[#0b1120] p-3">
          <div className="shadow-2xl shadow-black/60 ring-1 ring-slate-800">
            <IntroStage
              project={project} clock={clock} boxW={box.w} boxH={box.h}
              editable selectedId={selectedId} onSelect={setSelectedId} onPatch={patchElement} guides
            />
          </div>
        </main>

        {/* Inspector */}
        <aside className="w-72 shrink-0 border-l border-slate-800">
          <Inspector
            project={project} element={selected} audio={selectedAudio} fonts={fonts}
            onPatchProject={patchProject}
            onPatch={patch => selectedId != null && patchElement(selectedId, patch)}
            onPatchAudio={patch => selectedAudioId != null && patchAudio(selectedAudioId, patch)}
            onRemoveAudio={() => { if (selectedAudioId != null) { removeAudio(selectedAudioId); setSelectedAudioId(null); } }}
          />
        </aside>
      </div>

      {/* Timeline */}
      <div className="h-56 border-t border-slate-800">
        <Timeline
          project={project} clock={clock}
          selectedId={selectedId} onSelect={id => { setSelectedId(id); setSelectedAudioId(null); }}
          selectedAudioId={selectedAudioId} onSelectAudio={id => { setSelectedAudioId(id); setSelectedId(null); }}
          onPatch={patchElement} onPatchAudio={patchAudio} onRemoveAudio={removeAudio}
        />
      </div>

      {exporting && <ExportDialog project={project} onClose={() => setExporting(false)} />}
      {addingAudio && (
        <MediaPicker kind="audio" onClose={() => setAddingAudio(false)} onPick={item => {
          const cue: IntroAudio = { id: nextId(project.audio), url: item.url, label: item.label, startMs: Math.round(clock.timeMs), volume: 1, fadeInMs: 0, fadeOutMs: 0 };
          setProject(p => p && ({ ...p, audio: [...p.audio, cue] }));
          setSelectedAudioId(cue.id);
          setSelectedId(null);
        }} />
      )}
    </div>
  );
}
