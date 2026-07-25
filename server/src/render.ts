import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import { EXPORTS_DIR } from './paths.js';
import { FFMPEG } from './ffmpegPath.js';
import { resolveMediaFile } from './media.js';

export type RenderFormat = 'mp4' | 'mpg' | 'mov' | 'webm' | 'png';

// Formats that carry an alpha channel — the page is screenshotted with a transparent
// background so the intro can sit over live video as an OBS stinger.
const ALPHA: RenderFormat[] = ['mov', 'webm', 'png'];

export interface RenderOptions {
  format: RenderFormat;
  fps: number;
  scale: number;          // device scale factor: 1 = 1080p from a 1920×1080 stage, 2 = 4K
}

export interface RenderJob {
  id: string;
  projectId: string;
  name: string;
  format: RenderFormat;
  fps: number;
  width: number;
  height: number;
  total: number;
  frame: number;
  status: 'starting' | 'rendering' | 'encoding' | 'done' | 'error' | 'cancelled';
  file: string | null;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
  cancel?: boolean;
}

const jobs = new Map<string, RenderJob>();
const subs = new Map<string, Set<(j: RenderJob) => void>>();

export const getJob = (id: string) => jobs.get(id) ?? null;
export const listJobs = () => [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 30);
export function cancelJob(id: string) { const j = jobs.get(id); if (j) j.cancel = true; }

export function subscribe(id: string, fn: (j: RenderJob) => void): () => void {
  if (!subs.has(id)) subs.set(id, new Set());
  subs.get(id)!.add(fn);
  return () => subs.get(id)?.delete(fn);
}
function emit(j: RenderJob) { subs.get(j.id)?.forEach(fn => fn(j)); }

// ── ffmpeg command ────────────────────────────────────────────────────────────
interface AudioCue {
  file: string;
  startMs: number;      // position on the intro timeline
  trimInMs: number;     // source in-point
  trimOutMs: number;    // source out-point (0 = to the end of the file)
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
}

function videoArgs(format: RenderFormat, fps: number): string[] {
  switch (format) {
    case 'mp4':  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
    // MPEG-2 Program Stream — the classic .mpg. No alpha, but it plays in anything.
    case 'mpg':  return ['-c:v', 'mpeg2video', '-b:v', '15M', '-maxrate', '20M', '-bufsize', '4M', '-pix_fmt', 'yuv420p', '-f', 'vob'];
    case 'mov':  return ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16'];
    case 'webm': return ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '28', '-row-mt', '1', '-deadline', 'good'];
    case 'png':  return [];
  }
  void fps;
  return [];
}

function audioCodecArgs(format: RenderFormat): string[] {
  switch (format) {
    case 'mp4':  return ['-c:a', 'aac', '-b:a', '256k'];
    case 'mpg':  return ['-c:a', 'mp2', '-b:a', '384k'];
    case 'mov':  return ['-c:a', 'pcm_s16le'];
    case 'webm': return ['-c:a', 'libopus', '-b:a', '192k'];
    case 'png':  return [];
  }
  return [];
}

function ffmpegArgs(opts: RenderOptions, durationMs: number, audio: AudioCue[], out: string): string[] {
  const durS = durationMs / 1000;
  const args = ['-y', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(opts.fps), '-i', 'pipe:0'];
  for (const a of audio) args.push('-i', a.file);

  if (audio.length) {
    const chains = audio.map((a, i) => {
      const st = a.startMs / 1000;
      const delay = Math.max(0, Math.round(a.startMs));
      // Both-end trim first (atrim + asetpts rebases the clip to zero), then place it on the
      // timeline, then level, then the fades — which are relative to the placed clip.
      let f = `[${i + 1}:a]`;
      if (a.trimInMs > 0 || a.trimOutMs > 0) {
        const parts = [`start=${(a.trimInMs / 1000).toFixed(3)}`];
        if (a.trimOutMs > a.trimInMs) parts.push(`end=${(a.trimOutMs / 1000).toFixed(3)}`);
        f += `atrim=${parts.join(':')},asetpts=PTS-STARTPTS,`;
      }
      f += `adelay=${delay}|${delay},volume=${a.volume}`;
      const clipEndS = a.trimOutMs > a.trimInMs ? st + (a.trimOutMs - a.trimInMs) / 1000 : durS;
      if (a.fadeInMs > 0) f += `,afade=t=in:st=${st.toFixed(3)}:d=${(a.fadeInMs / 1000).toFixed(3)}`;
      if (a.fadeOutMs > 0) f += `,afade=t=out:st=${Math.max(0, Math.min(durS, clipEndS) - a.fadeOutMs / 1000).toFixed(3)}:d=${(a.fadeOutMs / 1000).toFixed(3)}`;
      return `${f}[a${i}]`;
    });
    const mix = `${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0:duration=longest[aout]`;
    args.push('-filter_complex', [...chains, mix].join(';'), '-map', '0:v', '-map', '[aout]', ...audioCodecArgs(opts.format));
  } else {
    args.push('-map', '0:v', '-an');
  }

  args.push(...videoArgs(opts.format, opts.fps), '-r', String(opts.fps), '-t', durS.toFixed(3), out);
  return args;
}

// ── Render ────────────────────────────────────────────────────────────────────
export function startRender(project: any, opts: RenderOptions, pageUrl: string): RenderJob {
  const [w, h] = String(project.aspectRatio ?? '1920x1080').split('x').map(Number);
  const width = Math.round((w || 1920) * opts.scale);
  const height = Math.round((h || 1080) * opts.scale);
  const durationMs = Math.max(100, Number(project.durationMs) || 5000);

  const job: RenderJob = {
    id: randomUUID().slice(0, 8),
    projectId: project.id,
    name: project.name ?? project.id,
    format: opts.format,
    fps: opts.fps,
    width, height,
    total: Math.max(1, Math.ceil((durationMs / 1000) * opts.fps)),
    frame: 0,
    status: 'starting',
    file: null,
    error: null,
    startedAt: Date.now(),
    endedAt: null,
  };
  jobs.set(job.id, job);
  run(job, project, opts, pageUrl, durationMs).catch(e => {
    job.status = 'error';
    job.error = String(e?.message ?? e);
    job.endedAt = Date.now();
    emit(job);
  });
  return job;
}

async function run(job: RenderJob, project: any, opts: RenderOptions, pageUrl: string, durationMs: number) {
  const alpha = ALPHA.includes(opts.format);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outName = `${project.id}-${stamp}`;
  const seqDir = join(EXPORTS_DIR, outName);
  const outFile = opts.format === 'png' ? seqDir : join(EXPORTS_DIR, `${outName}.${opts.format}`);
  if (opts.format === 'png') mkdirSync(seqDir, { recursive: true });

  // Per-cue level × the project master — the same product the editor's bed applies, so the file
  // is mixed at the level that was auditioned.
  const master = project.masterVolume == null ? 1 : Number(project.masterVolume);
  const cues: AudioCue[] = (project.audio ?? [])
    .filter((a: any) => !a.muted)
    .map((a: any) => {
      const file = resolveMediaFile(String(a.url ?? ''));
      return file ? {
        file,
        startMs: Number(a.startMs) || 0,
        trimInMs: Number(a.trimInMs) || 0,
        trimOutMs: Number(a.trimOutMs) || 0,
        volume: Math.max(0, (a.volume == null ? 1 : Number(a.volume)) * master),
        fadeInMs: Number(a.fadeInMs) || 0,
        fadeOutMs: Number(a.fadeOutMs) || 0,
      } : null;
    })
    .filter(Boolean) as AudioCue[];

  // A video element carries its own audio — the page is screenshotted silently, so the clip's
  // sound has to come into the mux the same way a music cue does, at its own trim and level.
  const videoCues: AudioCue[] = (project.elements ?? [])
    .filter((e: any) => e.type === 'video' && e.enabled !== false && !e.muted && e.src)
    .map((e: any) => {
      const file = resolveMediaFile(String(e.src));
      return file ? {
        file,
        startMs: Number(e.delay) || 0,
        trimInMs: Number(e.trimInMs) || 0,
        trimOutMs: Number(e.trimOutMs) || 0,
        volume: Math.max(0, (e.volume == null ? 1 : Number(e.volume)) * master),
        fadeInMs: 0,
        fadeOutMs: 0,
      } : null;
    })
    .filter(Boolean) as AudioCue[];

  const audio = [...cues, ...videoCues];

  let browser: Browser | null = null;
  let ff: ChildProcessByStdio<Writable, null, Readable> | null = null;
  let ffDone: Promise<void> = Promise.resolve();
  let ffErr = '';

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars'],
    });
    const [bw, bh] = String(project.aspectRatio ?? '1920x1080').split('x').map(Number);
    const page = await browser.newPage({
      viewport: { width: bw || 1920, height: bh || 1080 },
      deviceScaleFactor: opts.scale,
      // A transparent page for alpha formats; opaque black otherwise so h264 has no fringing.
      colorScheme: 'dark',
    });
    page.on('console', m => { if (m.type() === 'error') ffErr += `[page] ${m.text()}\n`; });

    await page.goto(`${pageUrl}?project=${encodeURIComponent(project.id)}&mode=render${alpha ? '&alpha=1' : ''}`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction('window.introReady === true', null, { timeout: 90_000 });

    if (opts.format !== 'png') {
      const proc = spawn(FFMPEG, ffmpegArgs(opts, durationMs, audio, outFile), { stdio: ['pipe', 'ignore', 'pipe'] });
      ff = proc;
      proc.stderr.on('data', d => { ffErr = (ffErr + d.toString()).slice(-4000); });
      ffDone = new Promise<void>((res, rej) => {
        proc.on('error', rej);
        proc.on('close', code => code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}\n${ffErr.slice(-1500)}`)));
      });
      proc.stdin.on('error', () => { /* closed early — surfaced by ffDone */ });
    }

    job.status = 'rendering';
    emit(job);

    const frameMs = 1000 / opts.fps;
    for (let f = 0; f < job.total; f++) {
      if (job.cancel) throw new Error('cancelled');
      const t = Math.min(durationMs, f * frameMs);
      await page.evaluate((ms: number) => (globalThis as any).introSeek(ms), t);
      // NEVER pass animations:'disabled' — Playwright implements it by fast-forwarding every
      // animation to its end state, which would run each element's OUT to completion and capture
      // an empty frame. The clock has already paused everything at exactly `t`.
      const buf = await page.screenshot({ type: 'png', omitBackground: alpha, caret: 'hide' });
      if (opts.format === 'png') {
        writeFileSync(join(seqDir, `frame-${String(f).padStart(6, '0')}.png`), buf);
      } else if (!ff!.stdin.write(buf)) {
        await new Promise(res => ff!.stdin.once('drain', res));
      }
      job.frame = f + 1;
      if (f % 5 === 0 || f === job.total - 1) emit(job);
    }

    if (ff) {
      job.status = 'encoding';
      emit(job);
      ff.stdin.end();
      await ffDone;
    }

    job.status = 'done';
    job.file = outFile;
    job.endedAt = Date.now();
    emit(job);
  } catch (e: any) {
    try { ff?.stdin.end(); } catch {}
    job.status = job.cancel ? 'cancelled' : 'error';
    job.error = String(e?.message ?? e);
    job.endedAt = Date.now();
    emit(job);
  } finally {
    await browser?.close().catch(() => {});
  }
}

export const exportsDirHas = (f: string) => existsSync(join(EXPORTS_DIR, f));
