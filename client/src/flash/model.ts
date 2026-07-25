// The Flash-style document model — the canonical shape the React front end edits and the SQL store
// persists (normalised server-side, handed to the client as one nested tree). An instance is a Node
// with kind 'instance' pointing at a Symbol, so Library→Stage instantiation needs no separate type.

export type SymbolType = 'scene' | 'movieclip' | 'graphic' | 'button';
export type LayerKind = 'normal' | 'mask' | 'masked' | 'guide' | 'folder';
export type TweenKind = 'none' | 'motion' | 'classic' | 'shape';
export type NodeKind = 'instance' | 'shape' | 'text' | 'image' | 'video' | 'group';
export type LoopMode = 'loop' | 'playonce' | 'single';

export interface Transform {
  x: number; y: number;
  scaleX: number; scaleY: number;
  rotation: number;   // 2D rotation, degrees
  skewX: number; skewY: number;
  rotX?: number;      // 3D perspective tilt (pitch), degrees — Ctrl+drag on canvas
  rotY?: number;      // 3D perspective tilt (yaw), degrees
  z?: number;         // depth (translateZ, px) — Ctrl+wheel dollies it, perspective foreshortens it
}

export const IDENTITY: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0, rotX: 0, rotY: 0, z: 0 };

// Vector shape / text / effect specifics ride on the node's `props`, kept loose so leaf kinds can
// carry what they need without widening the core Node. The renderer narrows by node.kind.
export interface ShapeProps {
  shape: 'rect' | 'ellipse' | 'line';
  fill?: string; fill2?: string; gradientAngle?: number;
  stroke?: string; strokeWidth?: number; strokeStyle?: 'solid' | 'dashed' | 'dotted';
  radius?: number;            // rect corner radius
  w: number; h: number;       // local box (before transform)
}
export interface TextProps {
  text: string;
  font?: string; size?: number; color?: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean; italic?: boolean;
  w?: number; h?: number;     // box (0/undefined = auto-size)
  gradient?: { c1: string; c2: string; angle: number };
}
export interface MediaProps { w?: number; h?: number; crop?: { x: number; y: number; w: number; h: number } }
export type NodeProps = Partial<ShapeProps & TextProps & MediaProps> & Record<string, unknown>;

export interface Node extends Transform {
  id: string;
  token: string;              // tween-pairing key: the same logical object across two keyframes
  ord: number;                // z within the layer's keyframe (higher = front)
  kind: NodeKind;
  symbolRef?: string | null;  // instance → Symbol.id
  assetId?: string | null;    // image/video → Asset.id
  name?: string | null;       // instance name (scriptable handle, later)
  alpha: number;              // 0..1
  blend?: string;
  loopMode?: LoopMode;        // graphic instance only
  firstFrame?: number;        // graphic instance only
  props?: NodeProps;
  // Per-parameter HOLD (After Effects / Resolve paradigm): parameters listed here do NOT tween out
  // of THIS keyframe — they hold their value across the span to the next keyframe, then jump. So a
  // held 'x' means A→B keeps A's x for the whole tween.
  hold?: HeldParam[];
}

export type HeldParam = 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'skewX' | 'skewY' | 'rotX' | 'rotY' | 'z' | 'alpha';
export const HELD_PARAMS: HeldParam[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'rotX', 'rotY', 'z', 'alpha'];

export interface Keyframe {
  id: string;
  frame: number;              // 0-based
  kind: 'key' | 'blank';
  tween: TweenKind;
  ease?: number[] | null;     // [x1,y1,x2,y2]
  label?: string | null;
  script?: string | null;
  soundAssetId?: string | null;
  soundSync?: 'event' | 'stream' | 'start' | 'stop';
  nodes: Node[];
}

export interface Layer {
  id: string;
  name: string;
  ord: number;                // 0 = bottom of the z-order
  kind: LayerKind;
  parentId?: string | null;
  locked: boolean;
  visible: boolean;
  outlined: boolean;
  keyframes: Keyframe[];      // sorted by frame
}

export interface Symbol {
  id: string;
  name: string;
  type: SymbolType;
  regX: number; regY: number; // registration point
  ord: number;
  layers: Layer[];
  loopFrame?: number | null;      // playback boundary: when the playhead reaches this frame it
  loopAction?: 'loop' | 'stop';   // loops back to 0 ('loop', default) or halts ('stop')
}

export interface Asset {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio' | 'font' | 'bitmap';
  url: string;
  meta?: Record<string, unknown> | null;
}

export interface FlashDoc {
  id: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  bg: string;
  rootSymbol: string;         // Symbol.id of the Main Timeline (type 'scene')
  symbols: Symbol[];
  assets: Asset[];
  createdAt?: number;
  updatedAt?: number;
}

// ── Lookups ──────────────────────────────────────────────────────────────────
export const findSymbol = (doc: FlashDoc, id: string | null | undefined) => doc.symbols.find(s => s.id === id) ?? null;
export const rootSymbol = (doc: FlashDoc) => findSymbol(doc, doc.rootSymbol);
export const findAsset = (doc: FlashDoc, id: string | null | undefined) => doc.assets.find(a => a.id === id) ?? null;

/** The active keyframe for a layer at a target frame: the last one starting at or before it. */
export function activeKeyframe(layer: Layer, frame: number): { kf: Keyframe; next: Keyframe | null } | null {
  let kf: Keyframe | null = null, next: Keyframe | null = null;
  for (const k of layer.keyframes) {
    if (k.frame <= frame) kf = k;
    else { next = k; break; }
  }
  return kf ? { kf, next } : null;
}

/** How many frames a symbol's timeline spans — the last keyframe across all its layers, +1. */
export function symbolLength(sym: Symbol): number {
  let last = 0;
  for (const layer of sym.layers) for (const k of layer.keyframes) last = Math.max(last, k.frame);
  return last + 1;
}
