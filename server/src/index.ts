import express from 'express';
import cors from 'cors';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { CLIENT_DIST, EXPORTS_DIR } from './paths.js';
import * as projects from './projects.js';
import { mediaRouter, fontsRouter } from './media.js';
import { startRender, getJob, listJobs, cancelJob, subscribe, type RenderFormat } from './render.js';
import { FFMPEG } from './ffmpegPath.js';
import * as docs from './documents.js';

const PORT = Number(process.env.INTROMATE_PORT ?? 4040);
// The page the renderer screenshots. Dev = the Vite server; once the client is built the
// server hosts it itself, so an export no longer depends on the dev server being up.
const CLIENT_URL = process.env.INTROMATE_CLIENT_URL ?? (existsSync(CLIENT_DIST) ? `http://localhost:${PORT}` : 'http://localhost:5200');

const app = express();
app.use(cors());
app.use(express.json({ limit: '80mb' }));

app.get('/api/intro/health', (_q, s) => s.json({ ok: true, port: PORT, project: 'IntroMate', ffmpeg: FFMPEG, renderPage: `${CLIENT_URL}/render.html` }));

// ── Projects ─────────────────────────────────────────────────────────────────
app.get('/api/intro/projects', (_q, s) => s.json(projects.list()));

app.post('/api/intro/projects', (q, s) => {
  const body = q.body ?? {};
  const id = projects.slug(body.id ?? body.name ?? 'intro');
  s.json(projects.write(id, { ...body, id, name: body.name ?? id }));
});

app.get('/api/intro/projects/:id', (q, s) => {
  const p = projects.read(q.params.id);
  return p ? s.json(p) : s.status(404).json({ error: 'not found' });
});

app.put('/api/intro/projects/:id', (q, s) => s.json(projects.write(q.params.id, q.body)));

app.delete('/api/intro/projects/:id', (q, s) => s.json({ ok: projects.remove(q.params.id) }));

app.post('/api/intro/projects/:id/rename', (q, s) => {
  const p = projects.rename(q.params.id, String(q.body?.name ?? ''));
  return p ? s.json(p) : s.status(404).json({ error: 'not found' });
});

app.post('/api/intro/projects/:id/duplicate', (q, s) => {
  const p = projects.duplicate(q.params.id, String(q.body?.name ?? `${q.params.id}-copy`));
  return p ? s.json(p) : s.status(404).json({ error: 'not found' });
});

app.get('/api/intro/projects/:id/versions', (q, s) => s.json(projects.versions(q.params.id)));

app.get('/api/intro/projects/:id/versions/:ts', (q, s) => {
  const p = projects.readVersion(q.params.id, Number(q.params.ts));
  return p ? s.json(p) : s.status(404).json({ error: 'not found' });
});

// ── Flash documents (SQL-backed) ──────────────────────────────────────────────
app.get('/api/doc', (_q, s) => s.json(docs.listDocuments()));

app.post('/api/doc', (q, s) => {
  const { name = 'Untitled', fps, width, height } = q.body ?? {};
  s.json(docs.createDocument(String(name), { fps, width, height }));
});

app.get('/api/doc/:id', (q, s) => {
  const d = docs.readDocument(q.params.id);
  return d ? s.json(d) : s.status(404).json({ error: 'not found' });
});

app.put('/api/doc/:id', (q, s) => {
  const body = { ...q.body, id: q.params.id };
  s.json(docs.writeDocument(body));
});

app.delete('/api/doc/:id', (q, s) => s.json({ ok: docs.deleteDocument(q.params.id) }));

// ── Media + fonts ────────────────────────────────────────────────────────────
app.use('/api/media', mediaRouter());
// TrackView's ensureFont() loads /api/titles/fonts/<id>.ttf — the Studio Mate path, served
// here from the same committed data/fonts store so the render matches the L3 look exactly.
app.use('/api/titles/fonts', fontsRouter());
app.use('/api/fonts', fontsRouter());

// ── Render ───────────────────────────────────────────────────────────────────
app.post('/api/render', (q, s) => {
  const { projectId, format = 'mp4', fps = 60, scale = 1 } = q.body ?? {};
  const project = projects.read(String(projectId ?? ''));
  if (!project) return s.status(404).json({ error: 'project not found' });
  const job = startRender(project, {
    format: format as RenderFormat,
    fps: Math.max(1, Math.min(120, Number(fps))),
    scale: Math.max(0.25, Math.min(4, Number(scale))),
  }, `${CLIENT_URL}/render.html`);
  s.json(job);
});

app.get('/api/render/jobs', (_q, s) => s.json(listJobs()));

app.get('/api/render/:id', (q, s) => {
  const j = getJob(q.params.id);
  return j ? s.json(j) : s.status(404).json({ error: 'not found' });
});

app.post('/api/render/:id/cancel', (q, s) => { cancelJob(q.params.id); s.json({ ok: true }); });

app.get('/api/render/:id/events', (q, s) => {
  const job = getJob(q.params.id);
  if (!job) return s.status(404).end();
  s.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  s.flushHeaders();
  const send = (j: any) => s.write(`data: ${JSON.stringify(j)}\n\n`);
  send(job);
  const off = subscribe(job.id, j => {
    send(j);
    if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') { off(); s.end(); }
  });
  q.on('close', off);
});

app.get('/api/render/:id/file', (q, s) => {
  const j = getJob(q.params.id);
  if (!j?.file || !existsSync(j.file)) return s.status(404).json({ error: 'not ready' });
  if (statSync(j.file).isDirectory()) return s.json({ dir: j.file });
  s.set('Content-Disposition', `attachment; filename="${basename(j.file)}"`);
  createReadStream(j.file).pipe(s);
});

app.use('/exports', express.static(EXPORTS_DIR));

// ── Built client (optional) ──────────────────────────────────────────────────
if (existsSync(CLIENT_DIST)) app.use(express.static(CLIENT_DIST));

app.listen(PORT, () => {
  console.log(`[IntroMate] server on http://localhost:${PORT}`);
  console.log(`[IntroMate] render page ${CLIENT_URL}/render.html`);
  console.log(`[IntroMate] ffmpeg ${FFMPEG}`);
});
