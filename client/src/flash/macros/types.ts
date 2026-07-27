// Animation macros — generators that write a finished construction into the document.
//
// A macro is a PURE document function: clips + params in, a new FlashDoc out. It never renders
// anything itself and never holds state; it composes the same mutations every other edit uses, so
// the whole construction commits as ONE history step (Ctrl+Z removes the entire carousel) and the
// result is ordinary layers and keyframes the author can then hand-edit, scrub and export.

import type { FlashDoc } from '../model';

// A clip queued in the Macro panel. `aw`/`ah` are the natural pixel size probed when it was picked,
// so the macro can lay each clip out at its true aspect; 0 means the probe failed (fall back to 16:9).
export interface MacroClip {
  key: string;                  // list identity for React + reordering — not a document id
  url: string;
  label: string;
  kind: 'image' | 'video';
  aw: number;
  ah: number;
}

export const clipAspect = (c: MacroClip) => (c.aw > 0 && c.ah > 0 ? c.aw / c.ah : 16 / 9);

// One editable parameter, described so the panel can render the whole form generically — a macro
// declares its knobs and gets a UI, rather than every macro shipping its own panel.
export type MacroField<P> =
  | { key: keyof P & string; label: string; kind: 'number'; min: number; max: number; step?: number; hint?: string }
  | { key: keyof P & string; label: string; kind: 'bool'; hint?: string }
  | { key: keyof P & string; label: string; kind: 'choice'; options: { value: string; label: string }[]; hint?: string };

export interface MacroDef<P> {
  id: string;
  label: string;
  blurb: string;                // one line describing what it builds
  minClips: number;
  defaults: P;
  fields: MacroField<P>[];
  /** Frames the construction will span, so the panel can show the length before committing. */
  length(clipCount: number, params: P): number;
  build(doc: FlashDoc, symId: string, startFrame: number, clips: MacroClip[], params: P, assetIds: string[]): FlashDoc;
}
