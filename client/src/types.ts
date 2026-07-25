import type { Track } from '@sm/titles/types';
import type { SlidePageStyle, SlidePresentationStyle, SlideSurface } from '@sm/components/slideStyles';
import type { SlideCrop } from '@sm/components/slideCrop';

// An intro element is a Studio Mate L3 Track (text / gradientText / image / shape) or a
// slide-style CARD (image or video with a 3D slab, crop and pose animation). Nothing about
// the Track shape changes: `delay` is the element's start on the intro timeline, `animInMs` /
// `duration` / `animOutMs` are its IN / HOLD / OUT — exactly the fields L3 already stores.
// `holdAnim` is the only addition: L3 derives the hold loop from the IN effect, IntroMate lets
// you pick it per element.
export type TrackEl = Track & { holdAnim?: string };

export interface CardEl {
  id: number;
  enabled: boolean;
  type: 'card' | 'video';
  name?: string;
  src: string;
  crop?: SlideCrop;
  delay: number;             // start on the timeline (ms)
  duration: number;          // HOLD ms between the IN and OUT tweens
  page: Partial<SlidePageStyle>;          // thickness / shadow / border / radius
  pres: Partial<SlidePresentationStyle>;  // IN / HOLD / OUT poses + tween ms + easing + waft
  reflection?: boolean;      // mirror this card in the stage surface
  muted?: boolean;           // video only
  volume?: number;           // video only, 0..2
  // Video only — both-end trim in SOURCE milliseconds. The element shows source[trimIn…trimOut]
  // from its own start; trimOutMs 0/undefined = to the end of the file.
  trimInMs?: number;
  trimOutMs?: number;
}

export type IntroElement = TrackEl | CardEl;

export const isCard = (el: IntroElement): el is CardEl => el.type === 'card' || el.type === 'video';

export interface IntroAudio {
  id: number;
  url: string;
  label?: string;
  startMs: number;     // where the clip lands on the intro timeline
  // Both-end trim, in SOURCE milliseconds. trimOutMs 0/undefined = play to the end of the file.
  trimInMs?: number;
  trimOutMs?: number;
  volume: number;      // 0..2 (1 = unity); multiplied by the project master before playback/mux
  fadeInMs: number;
  fadeOutMs: number;
  muted?: boolean;
}

/**
 * An Object is a reusable animated unit with its OWN timeline: a bundle of elements whose
 * delays are relative to the object's start. It is authored once (logo sting, lower-third,
 * photo card reveal) and then PLACED on the main timeline as instances.
 */
export interface IntroObject {
  id: string;
  name: string;
  elements: IntroElement[];   // local timeline — delay 0 = the object's own start
}

/**
 * A placement of an object on the main timeline. `overrides` swaps the media/text of individual
 * elements, keyed by the element id inside the object — so the same animation can be replicated
 * with a different image, video or headline without copying the animation.
 */
export interface ObjectInstance {
  id: number;
  objectId: string;
  name?: string;
  enabled: boolean;
  startMs: number;
  overrides: Record<string, string>;
}

/** A swappable field on an object element, derived from its type — no slot authoring needed. */
export interface ObjectSlot {
  elementId: number;
  label: string;
  field: 'image' | 'src' | 'text';
  kind: 'image' | 'video' | 'text';
  value: string;
}

export interface IntroBackground {
  kind: 'transparent' | 'color' | 'gradient' | 'image' | 'video';
  color?: string;
  color2?: string;
  angle?: number;
  url?: string;
  fit?: 'cover' | 'contain';
}

export interface IntroProject {
  id: string;
  name: string;
  aspectRatio: string;       // '1920x1080' | '1080x1920' | …
  durationMs: number;
  fps: number;
  background: IntroBackground;
  // Deck-level surface reflection, straight from the Slides vocabulary. `grid` draws the
  // editor-only perspective floor so you can see where the surface line sits.
  stage: Partial<SlideSurface> & { grid?: boolean };
  /** Free elements — authored straight on the main timeline. */
  elements: IntroElement[];
  /** Reusable objects (each with its own internal timeline) and their placements. */
  objects?: IntroObject[];
  instances?: ObjectInstance[];
  audio: IntroAudio[];
  /** Master level applied to every cue, in preview AND in the rendered mux. 0..2, default 1. */
  masterVolume?: number;
}

export interface ElementWindow { start: number; inMs: number; holdMs: number; outMs: number; end: number }

/** `store` names the library the item came from: intromate | studiomate | sfx | music | videos | clips */
export interface MediaItem { id: string; label: string; url: string; store: string }

export type RenderFormat = 'mp4' | 'mpg' | 'mov' | 'webm' | 'png';

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
}
