import { useEffect, useRef, useState } from 'react';
import { audioPeaks } from '../api';

// One shared peaks cache for the whole app — the picker, the timeline lane and the inspector all
// draw the same file, and the server only decodes it once (it caches too, and reuses Studio Mate's
// .peaks.json sidecars for StreamCapture clips).
const cache = new Map<string, { peaks: number[]; durationMs: number }>();
const inflight = new Map<string, Promise<{ peaks: number[]; durationMs: number }>>();

export function getPeaks(url: string, buckets = 400) {
  const key = `${url}|${buckets}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(key);
  if (!p) {
    p = audioPeaks(url, buckets).then(r => { cache.set(key, r); inflight.delete(key); return r; });
    inflight.set(key, p);
  }
  return p;
}

export function Waveform({ url, width, height, color = '#34d399', buckets = 400, onDuration, lazy = true, startFrac = 0, endFrac = 1 }: {
  url: string;
  width: number;
  height: number;
  color?: string;
  buckets?: number;
  onDuration?: (ms: number) => void;
  lazy?: boolean;
  /** Draw only this slice of the file — how a trimmed clip shows just the part it uses. */
  startFrac?: number;
  endFrac?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(cache.get(`${url}|${buckets}`)?.peaks ?? null);
  const [visible, setVisible] = useState(!lazy);

  // Only decode what the operator actually scrolls to — a library of 60 tracks otherwise fires
  // 60 decodes on open.
  useEffect(() => {
    if (!lazy || visible) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(e => { if (e.some(x => x.isIntersecting)) { setVisible(true); io.disconnect(); } });
    io.observe(el);
    return () => io.disconnect();
  }, [lazy, visible]);

  useEffect(() => {
    if (!visible) return;
    let dead = false;
    getPeaks(url, buckets).then(r => { if (!dead) { setPeaks(r.peaks); onDuration?.(r.durationMs); } }).catch(() => {});
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, buckets, visible]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, width) * dpr;
    c.height = Math.max(1, height) * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!peaks?.length) return;
    ctx.fillStyle = color;
    const mid = height / 2;
    const a = Math.max(0, Math.min(1, startFrac));
    const b = Math.max(a, Math.min(1, endFrac));
    for (let x = 0; x < width; x++) {
      const frac = a + (x / width) * (b - a);
      const p = peaks[Math.min(peaks.length - 1, Math.floor(frac * peaks.length))] ?? 0;
      ctx.fillRect(x, mid - p * mid, 1, Math.max(1, p * mid * 2));
    }
  }, [peaks, width, height, color, startFrac, endFrac]);

  return <canvas ref={ref} style={{ width, height, display: 'block' }} />;
}
