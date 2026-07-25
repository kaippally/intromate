import { Router } from 'express';
import express from 'express';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { MEDIA_DIR, SM_FONTS, SM_IMAGES, SM_AUDIO, SM_MUSIC, SM_VIDEOS, SM_CLIPS } from './paths.js';
import { FFMPEG } from './ffmpegPath.js';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|mkv)$/i;
const FONT_RE = /\.(ttf|otf)$/i;

const CACHE_DIR = join(MEDIA_DIR, '.cache');
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

export interface MediaItem { id: string; label: string; url: string; store: string }

// Every library IntroMate can read. Studio Mate's stores are mounted read-only under
// /api/media/sm/<key> so an intro uses the same assets the show already has.
const STORES: { key: string; dir: string; label: string; re: RegExp; kind: 'image' | 'audio' | 'video' }[] = [
  { key: 'sm/images', dir: SM_IMAGES, label: 'studiomate', re: IMAGE_RE, kind: 'image' },
  { key: 'sm/audio',  dir: SM_AUDIO,  label: 'sfx',       re: AUDIO_RE, kind: 'audio' },
  { key: 'sm/music',  dir: SM_MUSIC,  label: 'music',     re: AUDIO_RE, kind: 'audio' },
  { key: 'sm/videos', dir: SM_VIDEOS, label: 'videos',    re: VIDEO_RE, kind: 'video' },
  { key: 'sm/clips',  dir: SM_CLIPS,  label: 'clips',     re: VIDEO_RE, kind: 'video' },
];

function scan(dir: string, re: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => re.test(f)).sort();
}

function localItems(re: RegExp): MediaItem[] {
  return scan(MEDIA_DIR, re).map(f => ({ id: f, label: f, url: `/api/media/file/${f}`, store: 'intromate' }));
}

function storeItems(kind: 'image' | 'audio' | 'video'): MediaItem[] {
  return STORES.filter(s => s.kind === kind).flatMap(s =>
    scan(s.dir, s.re).map(f => ({ id: `${s.key}/${f}`, label: f, url: `/api/media/${s.key}/${encodeURIComponent(f)}`, store: s.label })));
}

export const listImages = () => [...localItems(IMAGE_RE), ...storeItems('image')];
export const listAudio = () => [...localItems(AUDIO_RE), ...storeItems('audio')];
export const listVideos = () => [...localItems(VIDEO_RE), ...storeItems('video')];

/** Resolve a project media url back to a file on disk (for the ffmpeg audio mux / thumbs / peaks). */
export function resolveMediaFile(url: string): string | null {
  const clean = decodeURIComponent(url.split('?')[0]!);
  const local = /^\/api\/media\/file\/(.+)$/.exec(clean);
  if (local) { const p = join(MEDIA_DIR, basename(local[1]!)); return existsSync(p) ? p : null; }
  for (const s of STORES) {
    const m = new RegExp(`^/api/media/${s.key}/(.+)$`).exec(clean);
    if (m) { const p = join(s.dir, basename(m[1]!)); return existsSync(p) ? p : null; }
  }
  return existsSync(clean) ? clean : null;
}

const cacheKey = (file: string, suffix: string) => join(CACHE_DIR, `${createHash('sha1').update(file).digest('hex').slice(0, 20)}.${suffix}`);

// ── Waveform peaks ───────────────────────────────────────────────────────────
// A Studio Mate StreamCapture clip already ships a `<file>.peaks.json` sidecar — use it rather
// than decoding again. Everything else is decoded once by ffmpeg and cached.
export async function peaksFor(file: string, buckets = 400): Promise<{ peaks: number[]; durationMs: number }> {
  const sidecar = file.replace(/\.[^.]+$/, '.peaks.json');
  if (existsSync(sidecar)) {
    try {
      const j = JSON.parse(readFileSync(sidecar, 'utf8'));
      if (Array.isArray(j.peaks)) return { peaks: downsample(j.peaks, buckets), durationMs: j.durationMs ?? 0 };
    } catch { /* fall through to a fresh decode */ }
  }
  const cache = cacheKey(file, `${buckets}.peaks.json`);
  if (existsSync(cache)) { try { return JSON.parse(readFileSync(cache, 'utf8')); } catch {} }
  const out = await decodePeaks(file, buckets);
  writeFileSync(cache, JSON.stringify(out));
  return out;
}

function downsample(peaks: number[], buckets: number): number[] {
  if (peaks.length <= buckets) return peaks;
  const per = peaks.length / buckets;
  return Array.from({ length: buckets }, (_, i) => {
    let m = 0;
    for (let j = Math.floor(i * per); j < Math.floor((i + 1) * per); j++) m = Math.max(m, peaks[j] ?? 0);
    return Math.round(m * 1000) / 1000;
  });
}

function decodePeaks(file: string, buckets: number): Promise<{ peaks: number[]; durationMs: number }> {
  return new Promise((res, rej) => {
    const ff = spawn(FFMPEG, ['-v', 'quiet', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    ff.stdout.on('data', c => chunks.push(c));
    ff.on('error', rej);
    ff.on('close', () => {
      const buf = Buffer.concat(chunks);
      const samples = buf.length / 2;
      if (!samples) return res({ peaks: [], durationMs: 0 });
      const per = Math.max(1, Math.floor(samples / buckets));
      const out: number[] = [];
      for (let i = 0; i < samples; i += per) {
        let peak = 0;
        for (let j = i; j < Math.min(samples, i + per); j++) peak = Math.max(peak, Math.abs(buf.readInt16LE(j * 2)));
        out.push(Math.round((peak / 32768) * 1000) / 1000);
      }
      res({ peaks: out, durationMs: Math.round((samples / 8000) * 1000) });
    });
  });
}

// ── Duration ─────────────────────────────────────────────────────────────────
// Parsed off ffmpeg's own banner so no separate ffprobe binary has to be resolved.
export function probeDurationMs(file: string): Promise<number> {
  return new Promise(res => {
    const ff = spawn(FFMPEG, ['-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', d => { err += d.toString(); });
    ff.on('error', () => res(0));
    ff.on('close', () => {
      const m = /Duration:\s*(\d+):(\d\d):(\d\d)\.(\d\d)/.exec(err);
      res(m ? ((+m[1]! * 3600 + +m[2]! * 60 + +m[3]!) * 1000 + +m[4]! * 10) : 0);
    });
  });
}

// ── Video poster frames ──────────────────────────────────────────────────────
function thumbFor(file: string): Promise<string> {
  const out = cacheKey(file, 'jpg');
  if (existsSync(out)) return Promise.resolve(out);
  return new Promise((res, rej) => {
    const ff = spawn(FFMPEG, ['-y', '-ss', '1', '-i', file, '-vframes', '1', '-vf', 'scale=320:-1', '-q:v', '4', out], { stdio: 'ignore' });
    ff.on('error', rej);
    ff.on('close', () => existsSync(out) ? res(out) : rej(new Error('no frame')));
  });
}

export function mediaRouter(): Router {
  const r = Router();
  r.use(express.json({ limit: '80mb' }));

  r.get('/images', (_q, s) => s.json(listImages()));
  r.get('/audio', (_q, s) => s.json(listAudio()));
  r.get('/videos', (_q, s) => s.json(listVideos()));

  r.use('/file', express.static(MEDIA_DIR, { maxAge: '1h' }));
  for (const st of STORES) r.use(`/${st.key}`, express.static(st.dir, { maxAge: '1h' }));

  // Content-addressed upload — files on disk, never data: urls in the project.
  r.post('/upload', (q, s) => {
    const { name, data } = q.body as { name?: string; data?: string };
    if (!name || !data) return s.status(400).json({ error: 'name and data required' });
    const b64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
    const buf = Buffer.from(b64, 'base64');
    const ext = (extname(name) || '.png').toLowerCase();
    const file = `${createHash('sha1').update(buf).digest('hex').slice(0, 16)}${ext}`;
    const path = join(MEDIA_DIR, file);
    if (!existsSync(path)) writeFileSync(path, buf);
    s.json({ id: file, label: name, url: `/api/media/file/${file}`, store: 'intromate', bytes: buf.length });
  });

  r.get('/peaks', async (q, s) => {
    const file = resolveMediaFile(String(q.query.url ?? ''));
    if (!file) return s.status(404).json({ error: 'not found' });
    try { s.json(await peaksFor(file, Math.max(50, Math.min(4000, Number(q.query.buckets ?? 400))))); }
    catch (e) { s.status(500).json({ error: String(e) }); }
  });

  r.get('/info', async (q, s) => {
    const file = resolveMediaFile(String(q.query.url ?? ''));
    if (!file) return s.status(404).json({ error: 'not found' });
    s.json({ durationMs: await probeDurationMs(file) });
  });

  r.get('/thumb', async (q, s) => {
    const file = resolveMediaFile(String(q.query.url ?? ''));
    if (!file) return s.status(404).end();
    try { s.sendFile(resolve(await thumbFor(file))); }
    catch { s.status(404).end(); }
  });

  return r;
}

export function fontsRouter(): Router {
  const r = Router();
  // The same files Studio Mate's /api/titles/fonts serves, from the same committed data/fonts
  // store — so an intro renders with the identical typeface the L3 titles use.
  r.get('/list', (_q, s) => s.json(
    scan(SM_FONTS, FONT_RE).map(f => ({ id: basename(f, extname(f)), label: basename(f, extname(f)), file: f })),
  ));
  r.use('/', express.static(SM_FONTS, { maxAge: '1d' }));
  return r;
}
