import type { IntroProject, MediaItem, RenderFormat, RenderJob } from './types';

// Same-origin only. In dev Vite proxies /api → localhost:4040; the render page served by the
// server itself hits it directly. Nothing here ever calls a non-localhost host.
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}
const post = <T>(url: string, body?: unknown) =>
  j<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export interface ProjectMeta { id: string; name: string; updatedAt: number; durationMs: number }

export const listProjects = () => j<ProjectMeta[]>('/api/intro/projects');
export const loadProject = (id: string) => j<IntroProject>(`/api/intro/projects/${encodeURIComponent(id)}`);
export const saveProject = (p: IntroProject) =>
  j<IntroProject>(`/api/intro/projects/${encodeURIComponent(p.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
  });
export const createProject = (p: IntroProject) => post<IntroProject>('/api/intro/projects', p);
export const deleteProject = (id: string) => j<{ ok: boolean }>(`/api/intro/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const duplicateProject = (id: string, name: string) => post<IntroProject>(`/api/intro/projects/${encodeURIComponent(id)}/duplicate`, { name });

export const listImages = () => j<MediaItem[]>('/api/media/images');
export const listAudio = () => j<MediaItem[]>('/api/media/audio');
export const listVideos = () => j<MediaItem[]>('/api/media/videos');
export const listFonts = () => j<{ id: string; label: string }[]>('/api/fonts/list');
export const uploadMedia = (name: string, data: string) => post<MediaItem>('/api/media/upload', { name, data });
export const audioPeaks = (url: string, buckets = 400) =>
  j<{ peaks: number[]; durationMs: number }>(`/api/media/peaks?url=${encodeURIComponent(url)}&buckets=${buckets}`);
/** Server-rendered poster frame for a video file (ffmpeg, cached on disk). */
export const thumbUrl = (url: string) => `/api/media/thumb?url=${encodeURIComponent(url)}`;
export const mediaInfo = (url: string) => j<{ durationMs: number }>(`/api/media/info?url=${encodeURIComponent(url)}`);

export const startRender = (projectId: string, format: RenderFormat, fps: number, scale: number) =>
  post<RenderJob>('/api/render', { projectId, format, fps, scale });
export const cancelRender = (id: string) => post<{ ok: boolean }>(`/api/render/${id}/cancel`);
export const listJobs = () => j<RenderJob[]>('/api/render/jobs');

export function watchRender(id: string, onJob: (j: RenderJob) => void): () => void {
  const es = new EventSource(`/api/render/${id}/events`);
  es.onmessage = e => {
    const job = JSON.parse(e.data) as RenderJob;
    onJob(job);
    if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') es.close();
  };
  es.onerror = () => es.close();
  return () => es.close();
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
