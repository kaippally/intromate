// Turns Studio Mate's effect modules into PAUSED, absolutely-timed animations.
//
// Nothing here re-implements an effect: `effectById` hands over the very same module the L3
// titles and the Clipboard board play, and we emit its keyframe name / easing / iteration /
// fill as a CSS `animation` shorthand with the element's absolute start as the delay. The clock
// then owns time for all of them. `paused` in the shorthand means an element never flashes a
// frame of live animation between mount and the first apply().

import { effectById, ensureEffectStyles, ANIM_IN_MS, ANIM_OUT_MS, HOLD_LOOP_MS } from '@sm/lib/animations';
import { isTextLike, type Track, type TextTrack, type ImageTrack, type ShapeTrack } from '@sm/titles/types';
import { textBoxPx, imageSizePx, shapeSizePx } from '@sm/titles/render/coords';
import { getMainSpans, getReflSpans } from '@sm/lib/animations/in/chars';
import type { ElementWindow, TrackEl } from '../types';

export const CHAR_EFFECTS = new Set(['typeWriter', 'letterBlurIn']);

// letterBlurIn's per-char keyframes (from the shared module) replayed at absolute times.
const LBI_KEYFRAME = 'l3-lbi-char';
const LBI_CHAR_SHARE = 0.4;

type Fill = 'both' | 'forwards' | 'none';

/** One CSS `animation` shorthand for a shared effect module, or null if it has no keyframes. */
export function shorthand(
  effectId: string | undefined,
  o: { durationMs: number; delayMs: number; fill: Fill; reflect?: boolean; iterations?: number | 'infinite' },
): string | null {
  const e = effectId ? effectById(effectId) : undefined;
  if (!e?.keyframeName) return null;
  // A reflection clone rides its parent fx for opacity/X; only effects that ship a mirror
  // (playReflect) get their own vertical override — exactly as the registry does it.
  if (o.reflect && !e.reflectCss) return null;
  const name = o.reflect ? `${e.keyframeName}-refl` : e.keyframeName;
  const iter = o.iterations ?? e.iteration ?? 1;
  return `${name} ${Math.max(1, o.durationMs)}ms ${e.easing ?? 'ease'} ${Math.round(o.delayMs)}ms ${iter} ${o.fill} paused`;
}

/**
 * The element's whole life as one comma-separated animation list: IN (fill both, so it rests at
 * its 0% frame before the start), the optional HOLD loop, then OUT. Later entries win where they
 * overlap, which is why OUT overrides a running HOLD and a held IN.
 */
export function fxAnimation(el: TrackEl, w: ElementWindow, reflect = false): string {
  ensureEffectStyles();
  const parts: (string | null)[] = [
    CHAR_EFFECTS.has(el.animation) ? null : shorthand(el.animation, { durationMs: w.inMs, delayMs: w.start, fill: 'both', reflect }),
    el.holdAnim && el.holdAnim !== 'none'
      ? shorthand(el.holdAnim, { durationMs: holdLoopMs(el), delayMs: w.start + w.inMs, fill: 'none', reflect, iterations: 'infinite' })
      : null,
    shorthand(el.animationOut, { durationMs: w.outMs, delayMs: w.start + w.inMs + w.holdMs, fill: 'forwards', reflect }),
  ];
  return parts.filter(Boolean).join(', ');
}

export function holdLoopMs(el: TrackEl): number {
  const speed = (el as TextTrack).bounceSpeed;
  return el.holdAnim === 'holdBounce' && speed && speed > 0 ? HOLD_LOOP_MS / speed : HOLD_LOOP_MS;
}

/** The wrapper transform for a track at rest (position is owned by left/top, this is pose only). */
export function baseTransform(t: Track): string {
  return `translate(-50%,-50%) translate(0px,0px) scale(1,1) perspective(1200px) rotateX(${t.rotationX ?? 0}deg) rotateY(${t.rotationY ?? 0}deg) rotateZ(${t.rotationZ ?? 0}deg)`;
}

/**
 * State A → State B: the same delta maths L3 uses (position, size-as-scale, rotation), emitted as
 * a two-keyframe WAAPI animation on the outer wrapper so it is seekable — a CSS transition is not.
 */
export function abKeyframes(t: Track, vw: number, vh: number, imgAspect = 1.6): { from: string; to: string } | null {
  if (!t.transitionEnabled || !t.stateB) return null;
  const b = t.stateB;
  const dx = b.xPos !== undefined ? ((b.xPos - t.xPos) / 20) * (vw / 2) : 0;
  const dy = b.yPos !== undefined ? -((b.yPos - t.yPos) / 10) * (vh / 2) : 0;
  const bRx = b.rotationX ?? t.rotationX ?? 0;
  const bRy = b.rotationY ?? t.rotationY ?? 0;
  const bRz = b.rotationZ ?? t.rotationZ ?? 0;

  const dims = (x: Track): { w: number; h: number } | null => {
    if (isTextLike(t)) { const box = textBoxPx(x as TextTrack, vh); return box ? { w: box.w, h: box.h } : null; }
    if (t.type === 'image') return imageSizePx(x as ImageTrack, vh, imgAspect);
    return shapeSizePx(x as ShapeTrack, vh);
  };
  const merged = {
    ...t,
    ...(b.size != null && { size: b.size }),
    ...(b.sizeX != null && { sizeX: b.sizeX }),
    ...(b.sizeY != null && { sizeY: b.sizeY }),
    ...(b.width != null && { width: b.width }),
    ...(b.height != null && { height: b.height }),
    ...(b.boxW != null && { boxW: b.boxW, boxH: b.boxH }),
  } as Track;
  const a = dims(t), bd = dims(merged);
  let sx = a && bd && a.w ? bd.w / a.w : 1;
  let sy = a && bd && a.h ? bd.h / a.h : 1;
  if (isTextLike(t) && (textBoxPx(t as TextTrack, vh) == null || textBoxPx(merged as TextTrack, vh) == null)) {
    const aS = (t as TextTrack).size || 1;
    sx = sy = ((merged as TextTrack).size ?? aS) / aS;
  }
  return {
    from: baseTransform(t),
    to: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(${sx},${sy}) perspective(1200px) rotateX(${bRx}deg) rotateY(${bRy}deg) rotateZ(${bRz}deg)`,
  };
}

export function bezierCss(e: number[] | undefined, fallback = 'cubic-bezier(0.22,1,0.36,1)'): string {
  return Array.isArray(e) && e.length === 4 ? `cubic-bezier(${e[0]},${e[1]},${e[2]},${e[3]})` : fallback;
}

/** Create a paused WAAPI animation and park it at the clock's current time. */
export function paused(el: Element, keyframes: Keyframe[], timing: KeyframeAnimationOptions, atMs: number): Animation {
  const a = el.animate(keyframes, timing);
  a.pause();
  try { a.currentTime = atMs; } catch { /* out of range on a just-created animation */ }
  return a;
}

// ── Character effects ────────────────────────────────────────────────────────
// typeWriter and letterBlurIn are the only effects driven by JS rather than pure CSS, so they
// get a seek adapter here. Both reuse the shared grapheme splitter, so the DOM they build is
// identical to the one L3 builds.

function groupUnits(chars: HTMLElement[], mode: 'chars' | 'words'): HTMLElement[][] {
  if (mode !== 'words') return chars.map(c => [c]);
  const units: HTMLElement[][] = [];
  let cur: HTMLElement[] = [];
  for (const c of chars) {
    cur.push(c);
    if (/\s/.test(c.textContent ?? '')) { units.push(cur); cur = []; }
  }
  if (cur.length) units.push(cur);
  return units;
}

/**
 * Prepare a char-level IN effect and return a per-frame seek fn (or null when the effect drives
 * itself through CSS on the char spans, which the clock already owns).
 */
export function setupCharEffect(fx: HTMLElement, el: TrackEl, w: ElementWindow): ((t: number) => void) | null {
  if (!CHAR_EFFECTS.has(el.animation)) return null;
  ensureEffectStyles();
  const chars = getMainSpans(fx);
  const refl = getReflSpans(fx);
  if (!chars.length) return null;

  if (el.animation === 'letterBlurIn') {
    const charMs = Math.max(120, w.inMs * LBI_CHAR_SHARE);
    const stagger = chars.length > 1 ? Math.max(0, (w.inMs - charMs) / (chars.length - 1)) : 0;
    const apply = (spans: HTMLElement[]) => spans.forEach((c, i) => {
      c.style.visibility = '';
      c.style.animation = `${LBI_KEYFRAME} ${charMs}ms ease-out ${Math.round(w.start + i * stagger)}ms 1 both paused`;
    });
    apply(chars);
    apply(refl);
    return null;
  }

  // typeWriter — reveal by unit across the IN window; exact at any time, forwards or back.
  const units = groupUnits(chars, (el as TextTrack).typeWriterMode ?? 'chars');
  const perUnit = Math.max(1, w.inMs / (units.length || 1));
  for (const c of [...chars, ...refl]) c.style.animation = '';
  let lastShown = -1;
  return (t: number) => {
    const elapsed = t - w.start;
    const shown = elapsed < 0 ? 0 : Math.min(units.length, Math.floor(elapsed / perUnit) + 1);
    if (shown === lastShown) return;
    lastShown = shown;
    let idx = 0;
    units.forEach((unit, u) => {
      const vis = u < shown ? 'visible' : 'hidden';
      for (const c of unit) { c.style.visibility = vis; const r = refl[idx]; if (r) r.style.visibility = vis; idx++; }
    });
  };
}

export { ANIM_IN_MS, ANIM_OUT_MS };
