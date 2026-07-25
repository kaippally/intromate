import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cancelRender, startRender, watchRender } from '../api';
import type { IntroProject, RenderFormat, RenderJob } from '../types';

const FORMATS: { id: RenderFormat; label: string; note: string }[] = [
  { id: 'mp4',  label: 'MP4 (H.264)',        note: 'Upload / edit. No transparency.' },
  { id: 'mpg',  label: 'MPG (MPEG-2 PS)',    note: 'Classic .mpg — plays anywhere. No transparency.' },
  { id: 'mov',  label: 'MOV (ProRes 4444)',  note: 'Keeps alpha — the OBS stinger format.' },
  { id: 'webm', label: 'WebM (VP9 alpha)',   note: 'Keeps alpha, much smaller than ProRes.' },
  { id: 'png',  label: 'PNG sequence',       note: 'Frames on disk with alpha.' },
];

export function ExportDialog({ project, onClose }: { project: IntroProject; onClose: () => void }) {
  const [format, setFormat] = useState<RenderFormat>('mp4');
  const [fps, setFps] = useState(project.fps ?? 60);
  const [scale, setScale] = useState(1);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return;
    return watchRender(job.id, setJob);
  }, [job?.id]);

  async function go() {
    setError(null);
    try { setJob(await startRender(project.id, format, fps, scale)); }
    catch (e: any) { setError(String(e.message ?? e)); }
  }

  const [w, h] = (project.aspectRatio || '1920x1080').split('x').map(Number);
  const pct = job ? Math.round((job.frame / Math.max(1, job.total)) * 100) : 0;
  const running = !!job && (job.status === 'starting' || job.status === 'rendering' || job.status === 'encoding');

  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center" style={{ zIndex: 9000 }} onClick={onClose}>
      <div className="im-panel w-[520px] p-3" onClick={e => e.stopPropagation()}>
        <div className="text-sm font-semibold mb-3">Render “{project.name}”</div>

        <div className="space-y-2 mb-3">
          {FORMATS.map(f => (
            <label key={f.id} className={`flex gap-2 items-start p-2 rounded border cursor-pointer ${format === f.id ? 'border-sky-600 bg-sky-950/40' : 'border-slate-800'}`}>
              <input type="radio" name="fmt" checked={format === f.id} onChange={() => setFormat(f.id)} className="mt-0.5" />
              <div>
                <div className="text-xs">{f.label}</div>
                <div className="text-[10px] text-slate-500">{f.note}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex gap-3 items-center text-xs mb-3">
          <label className="flex items-center gap-1">FPS
            <select className="im-input w-16" value={fps} onChange={e => setFps(Number(e.target.value))}>
              {[24, 25, 30, 50, 60].map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Scale
            <select className="im-input w-24" value={scale} onChange={e => setScale(Number(e.target.value))}>
              <option value={0.5}>50%</option>
              <option value={1}>100%</option>
              <option value={2}>200%</option>
            </select>
          </label>
          <span className="text-slate-500">{Math.round((w || 1920) * scale)}×{Math.round((h || 1080) * scale)} · {(project.durationMs / 1000).toFixed(1)}s · {Math.ceil((project.durationMs / 1000) * fps)} frames</span>
        </div>

        {job && (
          <div className="mb-3">
            <div className="h-2 bg-slate-800 rounded overflow-hidden">
              <div className="h-full bg-sky-500 transition-[width] duration-150" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>{job.status}{job.status === 'rendering' ? ` — frame ${job.frame}/${job.total}` : ''}</span>
              <span>{pct}%</span>
            </div>
            {job.status === 'done' && job.file && (
              <div className="mt-2 text-xs">
                <a className="im-btn-primary inline-block" href={`/api/render/${job.id}/file`} download>Download</a>
                <span className="ml-2 text-slate-500 break-all">{job.file}</span>
              </div>
            )}
            {job.error && <div className="mt-2 text-[11px] text-rose-400 whitespace-pre-wrap max-h-32 overflow-auto">{job.error}</div>}
          </div>
        )}

        {error && <div className="text-[11px] text-rose-400 mb-2">{error}</div>}

        <div className="flex gap-2 justify-end">
          {running
            ? <button className="im-btn" onClick={() => job && cancelRender(job.id)}>Cancel render</button>
            : <button className="im-btn-primary" onClick={go}>Render</button>}
          <button className="im-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
