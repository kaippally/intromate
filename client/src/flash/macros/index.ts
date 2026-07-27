// The macro catalogue. Adding an animation macro = writing a pure builder module and listing it
// here; the Macro panel renders its fields and Apply button from the definition, so no macro ships
// its own UI.

import { carouselMacro } from './carousel';
import type { MacroDef } from './types';

// Params differ per macro, so the registry is deliberately loose — the panel reads `fields` to know
// what to render and hands the same object straight back to `build`.
export const MACROS: MacroDef<any>[] = [carouselMacro];

export const macroById = (id: string) => MACROS.find(m => m.id === id) ?? MACROS[0]!;

export { carouselMacro };
export type { MacroClip, MacroDef, MacroField } from './types';
export { clipAspect } from './types';
