// Video Carousel — N clips advancing through a depth stack, one behind the other, then out past
// the camera. The Studio Mate Slides IN / HOLD / OUT vocabulary, rebuilt as real keyframes.
//
// WHY IT IS BUILT THIS WAY. In Slides an effect is a wall-clock CSS animation: `play(el, ctx)` runs
// a @keyframes with a delay, and the element's whole life is IN (fill both) → HOLD (infinite loop)
// → OUT (fill forwards). None of that can cross into Flash: `resolveDocument(doc, frame)` is a pure
// function of the frame, so nothing here may read a clock. So the macro keeps the SHAPE of the
// Slides model and changes its substrate — each phase becomes a keyframe span:
//
//   IN    a tween from the station behind to the station in front, over `inFrames`, eased
//   HOLD  a keyframe with tween 'none' — the resolver holds the pose until the next keyframe
//   OUT   a tween from the feature station to the exit station, over `outFrames`, eased
//
// The reflection comes over unchanged and for free. In Slides the mirror needs a `playReflect`
// override, because the effect animates the inner fx element and a floor mirror must move the
// OPPOSITE way vertically. Here the motion lives on the node's own transform and the reflection is
// a child of it (DisplayNode → reflectionInPlaneStylePct), so the mirror is carried by the same
// matrix as the object and stays a correct floor reflection at every depth, with no correction.
//
// STACKING. One clip per layer, and layer order is fixed — it cannot animate. That is not a
// limitation here, because a carousel is a queue: the frontmost clip is always the EARLIEST one
// still alive. Clip 0 exits toward the camera (in front of everything), clip k+1 waits behind
// clip k. So descending layer order — clip 0 on the topmost layer — is correct for the whole run,
// which is why the macro adds its layers back-to-front.

import { addAnimatedMediaLayer, type Pose } from '../mutations';
import { PERSPECTIVE, ease } from '../resolve';
import type { FlashDoc } from '../model';
import { clipAspect, type MacroClip, type MacroDef } from './types';

export interface CarouselParams {
  depthMode: string;        // 'perspective' = real translateZ foreshortening · 'scale' = flat scale
  depth: number;            // queued stations visible behind the feature
  widthPct: number;         // feature width cap, % of stage width
  heightPct: number;        // feature height cap, % of stage height — keeps portrait clips on stage
  surfaceY: number;         // % of stage height where every clip's BOTTOM edge sits (the floor line)
  inFrames: number;
  holdFrames: number;       // dwell at a station — also the beat, so clips advance in lockstep
  outFrames: number;
  spacingZ: number;         // depth between adjacent stations (perspective mode)
  spacingScale: number;     // scale ratio between adjacent stations (scale mode)
  queueAlpha: number;       // opacity of the nearest queued clip (deeper ones fade to 0)
  exitZ: number;            // depth of the exit station — positive drives it past the camera
  exitScale: number;        // scale mode equivalent
  peekX: number;            // per-station horizontal offset — fans the stack
  peekY: number;            // per-station vertical offset
  radius: number;
  reflection: boolean;
  reflectionOpacity: number;
  reflectionFeather: number;
  reflectionDistance: number;
  muted: boolean;
}

// Advance into place with a confident settle; leave with an accelerating rush — the same easing
// pair the Slides IN and OUT effects use.
const EASE_IN: number[] = [0.22, 1, 0.36, 1];
const EASE_OUT: number[] = [0.4, 0, 1, 1];

// Projected scale of a node parked at depth z, matching the renderer's own projection exactly.
const depthScale = (z: number) => PERSPECTIVE / (PERSPECTIVE - z);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Samples added inside each moving leg in perspective mode. The resolver lerps z linearly, but the
// projected size is PERSPECTIVE/(PERSPECTIVE−z) — not linear in z — so a leg described by only its
// two endpoints lets the clip drift off the floor line in flight (badly for tall clips: ~190px on a
// 1080 stage). Sampling the eased path and placing an EXACT pose at each sample pins it back down.
// Scale mode needs none of this: there x and y are both linear in the scale being lerped, so two
// keyframes are already exact.
const LEG_SAMPLES = 4;

// The beat: one station per `holdFrames`, so every clip advances in lockstep and a clip reaching
// the feature coincides with the previous one starting to leave.
const beat = (p: CarouselParams) => Math.max(1, Math.round(p.holdFrames));

/** Frames from a clip first appearing to it clearing the stage. */
function clipLife(p: CarouselParams): number {
  return Math.max(1, Math.round(p.depth)) * beat(p) + Math.max(1, Math.round(p.outFrames));
}

export const carouselMacro: MacroDef<CarouselParams> = {
  id: 'carousel',
  label: 'Video Carousel',
  blurb: 'Clips advance through a depth stack — one behind the other — hold at the front, then rush past the camera.',
  minClips: 2,

  defaults: {
    depthMode: 'perspective',
    depth: 3,
    widthPct: 52,
    heightPct: 55,
    surfaceY: 62,
    inFrames: 14,
    holdFrames: 40,
    outFrames: 16,
    spacingZ: 380,
    spacingScale: 0.72,
    queueAlpha: 85,
    exitZ: 520,
    exitScale: 1.8,
    peekX: 0,
    peekY: 0,
    radius: 10,
    reflection: true,
    reflectionOpacity: 42,
    reflectionFeather: 70,
    reflectionDistance: 6,
    muted: true,
  },

  fields: [
    { key: 'depthMode', label: 'Depth', kind: 'choice', options: [{ value: 'perspective', label: 'Perspective (3D)' }, { value: 'scale', label: 'Scale (flat)' }], hint: 'Perspective foreshortens with real translateZ; Scale is a flat resize that tweens exactly.' },
    { key: 'depth', label: 'Queue depth', kind: 'number', min: 1, max: 6, hint: 'Clips visible waiting behind the feature.' },
    { key: 'widthPct', label: 'Max width %', kind: 'number', min: 15, max: 100, hint: 'Clips are fitted inside the width × height box, so mixed aspects all stay on stage.' },
    { key: 'heightPct', label: 'Max height %', kind: 'number', min: 15, max: 100 },
    { key: 'surfaceY', label: 'Floor line %', kind: 'number', min: 20, max: 100, hint: 'Where every clip’s bottom edge sits — the reflection falls below it.' },
    { key: 'inFrames', label: 'IN frames', kind: 'number', min: 1, max: 120 },
    { key: 'holdFrames', label: 'HOLD frames', kind: 'number', min: 2, max: 300, hint: 'Dwell at each station, and the beat the whole carousel advances on.' },
    { key: 'outFrames', label: 'OUT frames', kind: 'number', min: 1, max: 120 },
    { key: 'spacingZ', label: 'Station depth', kind: 'number', min: 40, max: 1000, step: 10 },
    { key: 'spacingScale', label: 'Station scale', kind: 'number', min: 0.2, max: 0.95, step: 0.01 },
    { key: 'queueAlpha', label: 'Queue opacity %', kind: 'number', min: 0, max: 100 },
    { key: 'exitZ', label: 'Exit depth', kind: 'number', min: -1000, max: 1100, step: 10, hint: 'Positive drives the clip past the camera. Keep below 1200.' },
    { key: 'exitScale', label: 'Exit scale', kind: 'number', min: 0.1, max: 6, step: 0.1 },
    { key: 'peekX', label: 'Fan X', kind: 'number', min: -400, max: 400, step: 5 },
    { key: 'peekY', label: 'Fan Y', kind: 'number', min: -400, max: 400, step: 5 },
    { key: 'radius', label: 'Corner radius', kind: 'number', min: 0, max: 120 },
    { key: 'reflection', label: 'Reflection', kind: 'bool' },
    { key: 'reflectionOpacity', label: 'Reflect %', kind: 'number', min: 0, max: 100 },
    { key: 'reflectionFeather', label: 'Feather %', kind: 'number', min: 0, max: 100 },
    { key: 'reflectionDistance', label: 'Gap', kind: 'number', min: 0, max: 200 },
    { key: 'muted', label: 'Mute clips', kind: 'bool' },
  ],

  length(clipCount, p) {
    if (clipCount <= 0) return 0;
    return (clipCount - 1) * beat(p) + clipLife(p) + 1;
  },

  build(doc, symId, startFrame, clips, p, assetIds) {
    const step = beat(p);
    const depth = Math.max(1, Math.round(p.depth));
    const inF = Math.max(1, Math.round(p.inFrames));
    const outF = Math.max(1, Math.round(p.outFrames));
    const start = Math.max(0, Math.round(startFrame));

    const stageW = doc.width, stageH = doc.height;
    const floorY = (Math.max(0, Math.min(100, p.surfaceY)) / 100) * stageH;
    const cx = stageW / 2;
    const persp = p.depthMode !== 'scale';

    // A state is where the clip is along its journey: how deep, how large it renders there, how
    // opaque, and any fan offset. Everything the layout needs is derived from this.
    type State = { z: number; s: number; alpha: number; ox: number; oy: number };

    // Station j: j = 0 is the feature at the front, j = depth the birth point at the back. The
    // deepest station is fully transparent, so a clip is born as a fade-up out of the depth rather
    // than popping in — the Slides IN, expressed as the first leg of the journey.
    const station = (j: number): State => {
      const z = persp ? -j * p.spacingZ : 0;
      return {
        z,
        s: persp ? depthScale(z) : Math.pow(p.spacingScale, j),
        alpha: j <= 0 ? 1 : Math.max(0, (p.queueAlpha / 100) * (1 - j / depth)),
        ox: p.peekX * j,
        oy: p.peekY * j,
      };
    };

    const exit = (): State => ({
      z: persp ? p.exitZ : 0,
      s: persp ? depthScale(p.exitZ) : p.exitScale,
      alpha: 0, ox: 0, oy: 0,
    });

    // Interpolate the way the RESOLVER will — it lerps z (or scale) linearly — then recompute the
    // projected size from that lerped z. This is what makes a sampled pose land exactly where the
    // renderer will actually draw it.
    const mix = (a: State, b: State, t: number): State => {
      const z = lerp(a.z, b.z, t);
      return {
        z,
        s: persp ? depthScale(z) : lerp(a.s, b.s, t),
        alpha: lerp(a.alpha, b.alpha, t),
        ox: lerp(a.ox, b.ox, t),
        oy: lerp(a.oy, b.oy, t),
      };
    };

    // Every clip stands on the same floor line and is centred on it. A node's transform-origin is
    // its top-left, so both perspective and scale shrink the box toward that corner — placing it
    // means solving for the top-left that puts the SCALED box where we want it.
    const place = (st: State, w: number, h: number, frame: number, tween: 'motion' | 'none', e: number[] | null): Pose => ({
      frame,
      x: cx - (w * st.s) / 2 + st.ox,
      y: floorY - h * st.s + st.oy,
      alpha: st.alpha,
      tween,
      ease: e,
      ...(persp ? { z: st.z } : { scaleX: st.s, scaleY: st.s }),
    });

    // One moving leg A → B starting at `at` over `dur`. In scale mode that is a single eased
    // keyframe; in perspective mode the eased path is sampled so the clip stays planted on the
    // floor line (the samples carry the easing, so they tween linearly between themselves).
    const pushLeg = (poses: Pose[], a: State, b: State, at: number, dur: number, e: number[], w: number, h: number) => {
      if (!persp) { poses.push(place(a, w, h, at, 'motion', e)); return; }
      const n = Math.max(1, Math.min(LEG_SAMPLES, Math.round(dur)));  // never two samples on one frame
      for (let i = 0; i < n; i++) {
        const u = i / n;
        poses.push(place(mix(a, b, ease(e, u)), w, h, Math.round(at + u * dur), 'motion', null));
      }
    };

    // Back-to-front: the LAST clip is added first so it lands on the bottom layer, leaving clip 0 on
    // top. See the stacking note above — a queue never needs a later clip in front of an earlier one.
    let out = doc;
    for (let k = clips.length - 1; k >= 0; k--) {
      const clip = clips[k]!;
      const assetId = assetIds[k];
      if (!assetId) continue;

      // Fit the clip inside a box rather than forcing a width, so a portrait clip in a mixed queue
      // stays on stage instead of towering off it.
      const aspect = clipAspect(clip);
      const maxW = (Math.max(1, Math.min(100, p.widthPct)) / 100) * stageW;
      const maxH = (Math.max(1, Math.min(100, p.heightPct)) / 100) * stageH;
      const w = Math.round(Math.min(maxW, maxH * aspect));
      const h = Math.round(w / aspect);

      const appear = start + k * step;
      const poses: Pose[] = [];

      // Walk the queue: at each beat, move up one station over `inFrames` (IN), then rest at the new
      // station until the next beat (HOLD — a keyframe with no tween, which the resolver holds).
      for (let j = depth; j >= 1; j--) {
        const at = appear + (depth - j) * step;
        pushLeg(poses, station(j), station(j - 1), at, inF, EASE_IN, w, h);
        poses.push(place(station(j - 1), w, h, at + inF, 'none', null));
      }

      // Featured at the front, then OUT: rush past the camera and fade as the next clip lands.
      const leaves = appear + depth * step;
      pushLeg(poses, station(0), exit(), leaves, outF, EASE_OUT, w, h);
      poses.push(place(exit(), w, h, leaves + outF, 'none', null));

      const r = addAnimatedMediaLayer(out, symId, {
        name: `Carousel ${k + 1} · ${clip.label}`.slice(0, 48),
        assetId,
        kind: clip.kind,
        poses,
        endBlank: true,
        props: {
          w, h,
          borderRadius: p.radius, radius: p.radius,
          ...(clip.kind === 'video' ? { muted: p.muted, volume: 1, trimInMs: 0, trimOutMs: 0, autoplay: true } : {}),
          ...(p.reflection
            ? {
                reflection: true,
                reflectionOpacity: p.reflectionOpacity,
                reflectionFeather: p.reflectionFeather,
                reflectionDistance: p.reflectionDistance,
                reflectionOpacityMain: 100,
              }
            : {}),
        },
      });
      out = r.doc;
    }
    return out;
  },
};

/** Exposed for the panel's summary line. */
export function carouselTiming(clipCount: number, p: CarouselParams) {
  return { beat: beat(p), life: clipLife(p), total: carouselMacro.length(clipCount, p) };
}

export type { FlashDoc, MacroClip };
