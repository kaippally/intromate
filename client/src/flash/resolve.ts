// The renderer's core: given a document, a symbol and a frame, produce the display list to draw —
// a tree of resolved nodes mirroring Flash's display list. Layers compose bottom→top; a layer's
// active keyframe holds until the next; a tween interpolates the transform between the keyframe and
// the next, pairing objects by token; an instance recurses into its symbol at a slaved local frame.
//
// The whole thing is a pure function of the top frame — nested timelines included — so the editor
// scrubs and the exporter steps deterministically, exactly like the existing seekable clock.

import {
  activeKeyframe, findSymbol, symbolLength, IDENTITY,
  type FlashDoc, type HeldParam, type Keyframe, type Layer, type Node, type Symbol, type Transform,
} from './model';

export interface RenderLeaf {
  kind: 'image' | 'video' | 'text' | 'shape';
  assetUrl?: string;
  props?: Record<string, unknown>;
  mediaTime?: number;         // video only: the media position (seconds) this frame should show
}

export interface RenderNode {
  key: string;
  srcId?: string;             // the source Node.id — the editor hit-tests real pixels via this
  transform: Transform;
  alpha: number;
  blend?: string;
  name?: string | null;
  leaf?: RenderLeaf;          // a drawable leaf, or…
  children?: RenderNode[];    // …a symbol instance's own resolved display list
  maskChildren?: RenderNode[]; // resolved mask layer content, if this group is masked
}

// ── Easing ───────────────────────────────────────────────────────────────────
function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const fx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const dfx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const x = fx(u) - t;
    if (Math.abs(x) < 1e-4) break;
    const d = dfx(u);
    if (Math.abs(d) < 1e-6) break;
    u -= x / d;
  }
  u = Math.max(0, Math.min(1, u));
  return ((ay * u + by) * u + cy) * u;
}

function ease(spec: number[] | null | undefined, t: number): number {
  if (!spec || spec.length !== 4) return t; // linear
  return cubicBezier(spec[0]!, spec[1]!, spec[2]!, spec[3]!, t);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Interpolate A→B per property, but any parameter the A node HOLDS keeps A's value across the whole
// span (the After Effects / Resolve hold: it doesn't tween, it jumps at the next keyframe).
function tweenNode(a: Node, b: Node, t: number): { xform: Transform; alpha: number } {
  const held = new Set(a.hold ?? []);
  const p = (k: HeldParam, av: number, bv: number) => (held.has(k) ? av : lerp(av, bv, t));
  return {
    xform: {
      x: p('x', a.x, b.x), y: p('y', a.y, b.y),
      scaleX: p('scaleX', a.scaleX, b.scaleX), scaleY: p('scaleY', a.scaleY, b.scaleY),
      rotation: p('rotation', a.rotation, b.rotation),
      skewX: p('skewX', a.skewX, b.skewX), skewY: p('skewY', a.skewY, b.skewY),
      rotX: p('rotX', a.rotX ?? 0, b.rotX ?? 0), rotY: p('rotY', a.rotY ?? 0, b.rotY ?? 0),
      z: p('z', a.z ?? 0, b.z ?? 0),
    },
    alpha: p('alpha', a.alpha, b.alpha),
  };
}

// The frame an object was born on: walk back from the keyframe in force while consecutive keyframes
// still carry the same token. A video's clock has to run from there, not from whichever keyframe is
// currently active — every keyframe the author adds would otherwise restart the clip from zero.
function tokenOrigin(layer: Layer, kfIndex: number, token: string): number {
  const ks = layer.keyframes;
  let i = kfIndex;
  while (i > 0 && ks[i - 1]!.kind !== 'blank' && ks[i - 1]!.nodes.some(n => n.token === token)) i--;
  return ks[i]?.frame ?? 0;
}

// Pair each node on keyframe A with its counterpart on B, so the tween knows what "moves".
//
// Identity is the token (F6 clones a keyframe and keeps it, which is the intended workflow). But
// authors routinely build a span by dropping a second object straight onto the end keyframe — that
// object gets a fresh token, pairs with nothing, and the span silently renders static even though
// the timeline draws a tween arrow. So when a token finds no partner, fall back to the first
// unclaimed node of the same kind by z-order. Within one layer that is unambiguous: the per-layer
// tween rule already means a layer animates one object.
function pairNodes(a: Node[], b: Node[]): Map<string, Node> {
  const out = new Map<string, Node>();
  const free = new Set(b);
  for (const n of a) {
    const m = b.find(x => x.token === n.token);
    if (m && free.has(m)) { out.set(n.id, m); free.delete(m); }
  }
  for (const n of a) {
    if (out.has(n.id)) continue;
    const m = [...free].sort((x, y) => x.ord - y.ord).find(x => x.kind === n.kind);
    if (m) { out.set(n.id, m); free.delete(m); }
  }
  return out;
}

const nodeTransform = (n: Node): Transform => ({
  x: n.x, y: n.y, scaleX: n.scaleX, scaleY: n.scaleY, rotation: n.rotation, skewX: n.skewX, skewY: n.skewY,
  rotX: n.rotX ?? 0, rotY: n.rotY ?? 0, z: n.z ?? 0,
});

// Local frame a slaved (graphic / no-script movieclip) instance shows, given how long its parent has
// been holding it. Loop wraps, playonce holds the last frame, single pins firstFrame.
function localFrame(elapsed: number, firstFrame: number, length: number, mode: string): number {
  if (mode === 'single' || length <= 1) return firstFrame;
  const f = firstFrame + Math.max(0, elapsed);
  if (mode === 'playonce') return Math.min(f, length - 1);
  return ((f % length) + length) % length; // loop
}

// The media position a video shows at this frame: where its own keyframe started it, plus how long
// the playhead has been past that, from the trim-in point. Purely (elapsed, fps, trim) — no clock
// is read here. The DOM leaf seeks to this when paired and only uses it to correct drift while the
// timeline runs, so scrub, playback and a frame-stepped export all agree.
function videoTime(props: Node['props'], elapsed: number, fps: number): number {
  const p = (props ?? {}) as { trimInMs?: number; trimOutMs?: number };
  const inS = (p.trimInMs ?? 0) / 1000;
  const t = inS + Math.max(0, elapsed) / (fps || 30);
  const outS = p.trimOutMs != null ? p.trimOutMs / 1000 : null;
  return outS != null && outS > inS ? Math.min(t, outS) : t;
}

// ── Resolve one node at a given (possibly interpolated) transform ──────────────
function resolveNode(doc: FlashDoc, node: Node, xform: Transform, alpha: number, path: string, depthGuard: number, elapsed = 0): RenderNode {
  // Key on the TOKEN, not the node id. Each keyframe holds its own copy of an object with a fresh
  // id, so an id-based key changes the moment the playhead crosses a keyframe — React then tears the
  // element down and rebuilds it, which restarts any <video> from zero and made video playback
  // impossible. The token is precisely the per-layer identity that persists across keyframes, so
  // keying on it keeps one stable DOM element for the life of the object. srcId stays the real node
  // id: selection hit-testing must still resolve to the node on THIS keyframe.
  const base: RenderNode = { key: `${path}/${node.token || node.id}`, srcId: node.id, transform: xform, alpha, blend: node.blend, name: node.name };

  if (node.kind === 'instance' && node.symbolRef) {
    const sym = findSymbol(doc, node.symbolRef);
    if (sym && depthGuard > 0) {
      // Slaved timeline: the instance's own frame advances with the parent from where it appeared.
      const len = symbolLength(sym);
      const local = localFrame(0, node.firstFrame ?? 0, len, node.loopMode ?? 'loop');
      base.children = resolveSymbol(doc, sym, local, `${base.key}`, depthGuard - 1);
      return base;
    }
  }

  if (node.kind === 'image' || node.kind === 'video') {
    const asset = doc.assets.find(a => a.id === node.assetId);
    base.leaf = { kind: node.kind, assetUrl: asset?.url, props: node.props };
    if (node.kind === 'video') base.leaf.mediaTime = videoTime(node.props, elapsed, doc.fps);
  } else if (node.kind === 'text' || node.kind === 'shape') {
    base.leaf = { kind: node.kind, props: node.props };
  }
  return base;
}

// Resolve one layer's contribution at a frame (its active keyframe, with tween applied).
function resolveLayer(doc: FlashDoc, layer: Layer, frame: number, elapsedBase: number, path: string, depthGuard: number): RenderNode[] {
  if (!layer.visible) return [];
  const active = activeKeyframe(layer, frame);
  if (!active || active.kf.kind === 'blank') return [];
  const { kf, next } = active;

  const tweening = kf.tween !== 'none' && !!next && next.frame > kf.frame;
  const span = tweening ? next!.frame - kf.frame : 1;
  const t = tweening ? ease(kf.ease, Math.max(0, Math.min(1, (frame - kf.frame) / span))) : 0;
  const pairs = tweening ? pairNodes(kf.nodes, next!.nodes) : null;
  const kfIndex = Math.max(0, layer.keyframes.findIndex(k => k.id === kf.id));

  return [...kf.nodes].sort((a, b) => a.ord - b.ord).map(n => {
    let xform = nodeTransform(n);
    let alpha = n.alpha;
    if (tweening) {
      const nb = pairs!.get(n.id);
      if (nb) { const r = tweenNode(n, nb, t); xform = r.xform; alpha = r.alpha; }
    }
    // A media clock runs from the object's birth, so it survives intermediate keyframes.
    const child = resolveNode(doc, n, xform, alpha, path, depthGuard, frame - tokenOrigin(layer, kfIndex, n.token) + elapsedBase);
    if (child.children && (n.loopMode ?? 'loop') !== 'single') {
      const sym = findSymbol(doc, n.symbolRef);
      if (sym) {
        const len = symbolLength(sym);
        const local = localFrame(frame - kf.frame + elapsedBase, n.firstFrame ?? 0, len, n.loopMode ?? 'loop');
        child.children = resolveSymbol(doc, sym, local, child.key, depthGuard - 1);
      }
    }
    return child;
  });
}

/**
 * The display list for a symbol at a frame — its layers composed bottom→top. Mask layers clip the
 * layers marked masked beneath them (resolved content handed through `maskChildren`).
 */
export function resolveSymbol(doc: FlashDoc, sym: Symbol, frame: number, path = 'root', depthGuard = 16): RenderNode[] {
  const layers = [...sym.layers].sort((a, b) => a.ord - b.ord);
  const out: RenderNode[] = [];
  let pendingMask: RenderNode[] | null = null;

  for (const layer of layers) {
    if (layer.kind === 'guide' || layer.kind === 'folder') continue;
    const content = resolveLayer(doc, layer, frame, 0, `${path}:${layer.id}`, depthGuard);
    if (layer.kind === 'mask') { pendingMask = content; continue; }
    if (layer.kind === 'masked' && pendingMask) {
      out.push({ key: `${path}:masked:${layer.id}`, transform: IDENTITY, alpha: 1, children: content, maskChildren: pendingMask });
      continue;
    }
    pendingMask = null;
    out.push(...content);
  }
  return out;
}

/** The full display list for a document at a frame — resolved from its Main Timeline (root scene). */
export function resolveDocument(doc: FlashDoc, frame: number): RenderNode[] {
  const root = findSymbol(doc, doc.rootSymbol);
  return root ? resolveSymbol(doc, root, frame) : [];
}

/** CSS transform string for a resolved node (Flash order: translate, 3D tilt, rotate, skew, scale).
 *  The 3D tilt (rotX/rotY) is wrapped in a perspective so Ctrl+drag reads as real depth. */
export function cssTransform(t: Transform): string {
  const has3d = t.rotX || t.rotY || t.z;
  const persp = has3d ? `perspective(1200px) translateZ(${t.z ?? 0}px) rotateX(${t.rotX ?? 0}deg) rotateY(${t.rotY ?? 0}deg) ` : '';
  return `translate(${t.x}px, ${t.y}px) ${persp}rotate(${t.rotation}deg) skew(${t.skewX}deg, ${t.skewY}deg) scale(${t.scaleX}, ${t.scaleY})`;
}

export { symbolLength };
