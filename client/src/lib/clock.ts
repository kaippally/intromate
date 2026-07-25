// The seekable clock — the one piece Studio Mate does not have.
//
// Every visual in an intro is a paused Web Animation (CSS keyframe effects from the shared
// effect registry, plus WAAPI pose/A→B tweens). Nothing is scheduled with setTimeout, so the
// whole composition is a pure function of one number: `timeMs`. Playback is that number driven
// by rAF; scrubbing is that number set by hand; export is that number stepped 1/fps at a time.
// Preview and render therefore cannot drift — they are the same code path.

export type FrameSub = (t: number) => void;

interface VideoReg { el: HTMLVideoElement; startMs: number; trimInMs: number; trimOutMs: number }

export class IntroClock {
  private root: HTMLElement | null = null;
  private subs = new Set<FrameSub>();
  private videos = new Map<number, VideoReg>();
  private raf = 0;
  private origin = 0;
  timeMs = 0;
  durationMs = 6000;
  playing = false;
  /** Fires on play/pause/seek so React can re-render transport UI (never per frame). */
  onState: (() => void) | null = null;

  attach(root: HTMLElement | null) { this.root = root; }

  /** Per-frame subscribers (visibility gates, char effects, playhead). Called on every apply(). */
  subscribe(fn: FrameSub): () => void {
    this.subs.add(fn);
    fn(this.timeMs);
    return () => { this.subs.delete(fn); };
  }

  registerVideo(id: number, el: HTMLVideoElement | null, startMs: number, trimInMs: number, trimOutMs = 0) {
    if (el) this.videos.set(id, { el, startMs, trimInMs, trimOutMs });
    else this.videos.delete(id);
  }

  /** Source-time (seconds) a registered video should show at intro-time `t`, or null when it is
   *  outside its window. Clamped to the clip's out-point so a long element holds the last frame. */
  private videoTime(v: VideoReg, t: number): number | null {
    const want = (t - v.startMs + v.trimInMs) / 1000;
    if (want < 0 || !isFinite(want)) return null;
    const out = v.trimOutMs > 0 ? v.trimOutMs / 1000 : 0;
    return out > 0 ? Math.min(want, out) : want;
  }

  seek(t: number) {
    this.timeMs = Math.max(0, Math.min(this.durationMs, t));
    if (this.playing) this.origin = performance.now() - this.timeMs;
    this.apply();
    this.onState?.();
  }

  play() {
    if (this.playing) return;
    if (this.timeMs >= this.durationMs) this.timeMs = 0;
    this.playing = true;
    this.origin = performance.now() - this.timeMs;
    this.raf = requestAnimationFrame(this.tick);
    this.onState?.();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.syncVideos(true);
    this.onState?.();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  private tick = (now: number) => {
    if (!this.playing) return;
    const t = now - this.origin;
    if (t >= this.durationMs) {
      this.timeMs = this.durationMs;
      this.apply();
      this.pause();
      return;
    }
    this.timeMs = t;
    this.apply();
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Writes the current time into every animation under the stage, then notifies subscribers. */
  apply() {
    const anims = this.root?.getAnimations({ subtree: true }) ?? [];
    for (const a of anims) {
      try {
        if (a.playState === 'running') a.pause();
        a.currentTime = this.timeMs;
      } catch { /* an animation cancelled mid-walk — the next frame re-applies */ }
    }
    this.syncVideos(false);
    for (const fn of this.subs) fn(this.timeMs);
  }

  // Videos are their own clocks. While playing we only correct drift (seeking every frame
  // stutters); paused/scrubbing we place the exact frame.
  private syncVideos(force: boolean) {
    for (const v of this.videos.values()) {
      const { el } = v;
      const want = this.videoTime(v, this.timeMs);
      if (want == null) { if (!el.paused) el.pause(); continue; }
      // Past the out-point the clip holds its last frame rather than running on.
      if (v.trimOutMs > 0 && (this.timeMs - v.startMs + v.trimInMs) / 1000 >= v.trimOutMs / 1000) {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - want) > 0.02) el.currentTime = want;
        continue;
      }
      if (this.playing && !force) {
        if (el.paused) el.play().catch(() => {});
        if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - want) > 0.005) el.currentTime = want;
      }
    }
  }

  /** Export path: seek and resolve once every video has actually landed on the frame. */
  async seekExact(t: number): Promise<void> {
    this.playing = false;
    this.timeMs = Math.max(0, Math.min(this.durationMs, t));
    this.apply();
    await Promise.all([...this.videos.values()].map(v => {
      const el = v.el;
      const want = this.videoTime(v, this.timeMs);
      if (want == null || Math.abs(el.currentTime - want) < 0.001) return Promise.resolve();
      return new Promise<void>(res => {
        const done = () => { el.removeEventListener('seeked', done); res(); };
        el.addEventListener('seeked', done);
        el.currentTime = want;
        setTimeout(done, 500);
      });
    }));
    await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())));
  }
}
