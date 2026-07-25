import { useEffect, useRef } from 'react';
import type { IntroClock } from './clock';
import type { IntroAudio } from '../types';

// Gain for a cue at time t: its own level × master, shaped by the fade in/out envelope.
// The same numbers ffmpeg gets at render time (volume= + afade=), so what you hear while
// scrubbing is what the file will contain.
/** How long the cue is heard for: its trimmed source span, or what's left of the file. */
export function cueSpanMs(cue: IntroAudio, fileDurationMs: number): number {
  const inMs = cue.trimInMs ?? 0;
  const outMs = cue.trimOutMs && cue.trimOutMs > inMs ? cue.trimOutMs : fileDurationMs;
  return Math.max(0, outMs - inMs);
}

export function cueGain(cue: IntroAudio, t: number, master: number, spanMs: number): number {
  if (cue.muted) return 0;
  const local = t - cue.startMs;
  if (local < 0) return 0;
  let g = Math.max(0, Math.min(2, cue.volume ?? 1)) * Math.max(0, Math.min(2, master));
  if (cue.fadeInMs > 0 && local < cue.fadeInMs) g *= local / cue.fadeInMs;
  if (cue.fadeOutMs > 0 && spanMs && local > spanMs - cue.fadeOutMs) g *= Math.max(0, (spanMs - local) / cue.fadeOutMs);
  return Math.max(0, Math.min(1, g));
}

// The music/SFX bed follows the same clock as the visuals, so scrubbing lands on the right beat.
// Export never uses this — ffmpeg muxes the cues from the same startMs / volume / fade numbers.
export function useAudioBed(cues: IntroAudio[], clock: IntroClock, muted: boolean, master = 1) {
  const els = useRef(new Map<number, HTMLAudioElement>());

  useEffect(() => {
    const map = els.current;
    for (const cue of cues) {
      let el = map.get(cue.id);
      if (!el || el.dataset.url !== cue.url) {
        el?.pause();
        el = new Audio(cue.url);
        el.preload = 'auto';
        el.dataset.url = cue.url;
        map.set(cue.id, el);
      }
    }
    for (const [id, el] of [...map]) {
      if (!cues.some(c => c.id === id)) { el.pause(); map.delete(id); }
    }
  }, [cues]);

  useEffect(() => clock.subscribe(t => {
    for (const cue of cues) {
      const el = els.current.get(cue.id);
      if (!el) continue;
      const fileMs = (el.duration || 0) * 1000;
      const span = cueSpanMs(cue, fileMs);
      const local = t - cue.startMs;
      // Source position = trim-in + how far into the cue we are. Past the out-point it stops.
      const want = ((cue.trimInMs ?? 0) + local) / 1000;
      el.volume = muted ? 0 : cueGain(cue, t, master, span);
      if (local < 0 || (span > 0 && local > span) || (el.duration && want > el.duration)) {
        if (!el.paused) el.pause();
        continue;
      }
      if (clock.playing && !muted) {
        if (el.paused) el.play().catch(() => {});
        if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want;
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - want) > 0.05) el.currentTime = want;
      }
    }
  }), [cues, clock, muted, master]);

  useEffect(() => () => { els.current.forEach(el => el.pause()); els.current.clear(); }, []);
}
