import { ANIM_IN_MS, ANIM_OUT_MS } from '@sm/lib/animations';
import { DEFAULT_PRESENTATION, DEFAULT_SURFACE_Y } from '@sm/components/slideStyles';
import type { CardEl, ElementWindow, IntroElement, IntroObject, IntroProject, ObjectInstance, ObjectSlot, TrackEl } from './types';
import { isCard } from './types';

export const ASPECTS = ['1920x1080', '1080x1920', '1280x720', '1080x1080', '2560x1440'];

export function stageSize(project: Pick<IntroProject, 'aspectRatio'>): { vw: number; vh: number } {
  const [w, h] = (project.aspectRatio || '1920x1080').split('x').map(Number);
  return { vw: w || 1920, vh: h || 1080 };
}

// The element's slot on the timeline. IN → HOLD → OUT, laid end to end from `delay`.
// This is a VIEW over fields the L3 track model already has — no new timing data.
export function elementWindow(el: IntroElement): ElementWindow {
  const start = Math.max(0, el.delay ?? 0);
  const inMs = isCard(el)
    ? (el.pres?.showDuration ?? DEFAULT_PRESENTATION.showDuration)
    : ((el as TrackEl).animInMs ?? ANIM_IN_MS);
  const outMs = isCard(el)
    ? (el.pres?.hideDuration ?? DEFAULT_PRESENTATION.hideDuration)
    : ((el as TrackEl).animOutMs ?? ANIM_OUT_MS);
  const holdMs = Math.max(0, el.duration ?? 0);
  return { start, inMs, holdMs, outMs, end: start + inMs + holdMs + outMs };
}

export function projectEnd(project: IntroProject): number {
  return resolveElements(project).reduce((max, el) => Math.max(max, elementWindow(el).end), 0);
}

// ── Objects ──────────────────────────────────────────────────────────────────

/** How long an object runs on its own — the end of its last element. */
export function objectDuration(obj: IntroObject): number {
  return obj.elements.reduce((max, el) => Math.max(max, elementWindow(el).end), 0);
}

/** The swappable fields of an object: every element that carries media or text. */
export function objectSlots(obj: IntroObject): ObjectSlot[] {
  return obj.elements.map((el): ObjectSlot | null => {
    if (isCard(el)) {
      return { elementId: el.id, label: el.name ?? el.type, field: 'src', kind: el.type === 'video' ? 'video' : 'image', value: el.src ?? '' };
    }
    if (el.type === 'image') return { elementId: el.id, label: el.name ?? 'Image', field: 'image', kind: 'image', value: (el as any).image ?? '' };
    if (el.type === 'text' || el.type === 'gradientText') {
      return { elementId: el.id, label: el.name ?? 'Text', field: 'text', kind: 'text', value: (el as any).text ?? '' };
    }
    return null;
  }).filter(Boolean) as ObjectSlot[];
}

export const findObject = (project: IntroProject, id: string | null | undefined) =>
  (project.objects ?? []).find(o => o.id === id) ?? null;

/** An instance's span on the main timeline. */
export function instanceWindow(project: IntroProject, inst: ObjectInstance): { start: number; end: number } {
  const obj = findObject(project, inst.objectId);
  return { start: inst.startMs, end: inst.startMs + (obj ? objectDuration(obj) : 0) };
}

// Element ids must stay unique once instances are flattened onto one stage, and stable across
// renders so React keeps each element's DOM (and its paused animations) alive.
const resolvedId = (instanceId: number, elementId: number) => instanceId * 100_000 + elementId;

/** Apply an instance's media/text overrides to one of its object's elements. */
function applyOverride(el: IntroElement, value: string | undefined): IntroElement {
  if (value == null || value === '') return el;
  if (isCard(el)) return { ...el, src: value };
  if (el.type === 'image') return { ...el, image: value } as IntroElement;
  if (el.type === 'text') return { ...el, text: value, outputText: value } as IntroElement;
  if (el.type === 'gradientText') return { ...el, text: value } as IntroElement;
  return el;
}

/**
 * The flat element list the stage actually renders: the project's own elements plus every
 * enabled instance's object, with delays shifted to the instance start and overrides applied.
 * `soloObjectId` renders ONLY that object at its own local times — how the editor previews an
 * object while you are building it.
 */
export function resolveElements(project: IntroProject, soloObjectId?: string | null): IntroElement[] {
  if (soloObjectId) {
    const obj = findObject(project, soloObjectId);
    return obj ? obj.elements : [];
  }
  const out: IntroElement[] = [...project.elements];
  for (const inst of project.instances ?? []) {
    if (!inst.enabled) continue;
    const obj = findObject(project, inst.objectId);
    if (!obj) continue;
    for (const el of obj.elements) {
      out.push({
        ...applyOverride(el, inst.overrides?.[String(el.id)]),
        id: resolvedId(inst.id, el.id),
        delay: (el.delay ?? 0) + inst.startMs,
      } as IntroElement);
    }
  }
  return out;
}

export function newObject(id: string, name: string, elements: IntroElement[] = []): IntroObject {
  return { id, name, elements };
}

export function objectId(existing: IntroObject[], name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'object';
  let id = base, n = 2;
  while (existing.some(o => o.id === id)) id = `${base}-${n++}`;
  return id;
}

export function nextId(elements: { id: number }[]): number {
  return elements.length ? Math.max(...elements.map(e => e.id)) + 1 : 1;
}

const baseTrack = (id: number) => ({
  id, enabled: true,
  animation: 'fadeIn' as const,
  animationOut: 'fadeOut' as const,
  animInMs: ANIM_IN_MS,
  animOutMs: ANIM_OUT_MS,
  xPos: 0, yPos: 0, zPos: 0,
  delay: 0, duration: 2000,
  audioStart: '', audioEnd: '',
});

export function newElement(kind: 'text' | 'gradientText' | 'image' | 'shape' | 'card' | 'video', id: number, delay = 0): IntroElement {
  if (kind === 'text') {
    return { ...baseTrack(id), type: 'text', name: 'Text', text: 'YOUR TITLE', outputText: 'YOUR TITLE',
      font: 'helvetiker', color: '#ffffff', size: 1.4, depth: 0, bevel: false, align: 'center', delay,
      animation: 'crashLandTop', reflection: false } as TrackEl;
  }
  if (kind === 'gradientText') {
    return { ...baseTrack(id), type: 'gradientText', name: 'Gradient', text: 'GRADIENT', font: 'helvetiker',
      size: 1.6, align: 'center', gradColor1: '#38bdf8', gradColor2: '#a855f7', gradAngle: 90, delay,
      animation: 'scaleIn' } as TrackEl;
  }
  if (kind === 'image') {
    return { ...baseTrack(id), type: 'image', name: 'Logo', image: '', size: 2, delay, animation: 'scaleIn' } as TrackEl;
  }
  if (kind === 'shape') {
    return { ...baseTrack(id), type: 'shape', name: 'Bar', shapeType: 'rect', fill: 'solid', fillColor: '#0ea5e9',
      fillColor2: '#1e293b', opacity: 1, border: 0, borderColor: '#ffffff', radius: 4, width: 10, height: 0.6,
      delay, animation: 'grow', growOrigin: 'left', animationOut: 'shrink' } as TrackEl;
  }
  const card: CardEl = {
    id, enabled: true, type: kind === 'video' ? 'video' : 'card', name: kind === 'video' ? 'Video' : 'Card',
    src: '', delay, duration: 2500,
    page: { thickness: 12, shadowBlur: 40, shadowY: 18, shadowColor: '#000000cc', borderRadius: 8 },
    pres: { in: { x: 0, y: 0, z: -1400, scale: 1, opacity: 0, rotateX: 0, rotateY: 0, perspective: 1400 },
            hold: { x: 0, y: -60, z: 0, scale: 0.72, opacity: 100, rotateX: 0, rotateY: 0, perspective: 1400 },
            out: { x: 0, y: -60, z: 600, scale: 0.72, opacity: 0, rotateX: 0, rotateY: 0, perspective: 1400 },
            showDuration: 900, hideDuration: 500 },
    reflection: true, muted: false, volume: 1, trimInMs: 0, trimOutMs: 0,
  };
  return card;
}

export function defaultProject(id = 'untitled', name = 'Untitled Intro'): IntroProject {
  return {
    id, name,
    aspectRatio: '1920x1080',
    durationMs: 6000,
    fps: 60,
    background: { kind: 'gradient', color: '#020617', color2: '#0b2545', angle: 160 },
    stage: { reflection: true, reflectionSurfaceY: DEFAULT_SURFACE_Y, reflectionOpacity: 40, reflectionFeather: 70, reflectionBlur: 2, grid: false },
    elements: [
      { ...(newElement('text', 1, 300) as TrackEl), text: 'KAIPPS', outputText: 'KAIPPS', size: 2.2, yPos: 1.2,
        color: '#ffffff', animation: 'crashLandTop', animationOut: 'blurOut', duration: 3200, reflection: true,
        reflectionOpacity: 45, reflectionFeather: 70 } as TrackEl,
      { ...(newElement('gradientText', 2, 900) as TrackEl), text: 'STUDIO', size: 1.1, yPos: -0.4,
        gradColor1: '#38bdf8', gradColor2: '#a855f7', animation: 'zipInRight', animationOut: 'vibrateMoveLeft', duration: 2600 } as TrackEl,
      { ...(newElement('shape', 3, 1400) as TrackEl), width: 9, height: 0.12, yPos: -1.4, fillColor: '#38bdf8',
        animation: 'grow', growOrigin: 'center', animationOut: 'shrink', duration: 2200 } as TrackEl,
    ],
    audio: [],
  };
}
