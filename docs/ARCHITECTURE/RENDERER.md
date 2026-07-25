# Architecture — Renderer (resolver · DOM · export)

The renderer turns a document + a frame into pixels, and the **same** path feeds the video exporter.
Files: [../../client/src/flash/resolve.ts](../../client/src/flash/resolve.ts) (the pure resolver),
[../../client/src/flash/DisplayNode.tsx](../../client/src/flash/DisplayNode.tsx) (DOM),
[../../server/src/render.ts](../../server/src/render.ts) (export).

## Invariant: the resolver is pure

`resolveDocument(doc, frame)` (and `resolveSymbol(doc, symbol, frame)`) return a display list from a
document and a frame number **and nothing else** — no wall clock, no playback history, no external
state. This is the load-bearing invariant:

```
        resolveDocument(doc, frame) ── pure ──▶ RenderNode[]
              │                                     │
 PREVIEW: frame from the scrubber/playhead     DOM (you see it)
 EXPORT:  frame stepped 0,1,2,… by ffmpeg      screenshot each
```

Because both drive the identical function, preview, scrub and export can never diverge. **Do not read
time, randomness or mutable module state inside `resolve*`.** (The pending logic layer — independent
MovieClip playheads, `gotoAndPlay` — breaks purity by design and will be handled by a stepped VM with
snapshot-based backward seeking; until then nested MovieClips resolve as slaved graphics.)

## `resolveSymbol` — the algorithm

Walk the symbol's layers **bottom → top** (`ord` ascending). For each visible, non-mask layer:

1. **Active keyframe** = the last keyframe with `frame ≤ target` (`activeKeyframe`). None or `blank`
   → the layer contributes nothing. Plain frames therefore hold the previous keyframe's state.
2. **Tween?** If the active keyframe's `tween ≠ none` and a next keyframe exists, compute
   `t = ease(kf.ease, (frame − kf.frame) / (next.frame − kf.frame))`.
3. **Per node** (sorted by `ord`):
   - If tweening, find the next keyframe's node with the **same `token`** and interpolate
     (`tweenNode`, see Hold below); else use the node's own transform.
   - Emit a `RenderNode { key, srcId, transform, alpha, blend, leaf | children }`.
     `srcId` = the source `Node.id`, used by the editor to hit-test real pixels for selection.
4. **Instances recurse** — a `kind:'instance'` node resolves its `symbolRef` symbol at a **slaved
   local frame**.

Mask layers: a `mask` layer's content clips the following `masked` layers (grouped via `maskChildren`).

## Hold — per-parameter freeze (`tweenNode`)

For a tween A→B, each channel interpolates **unless it is in A's `hold[]`**, in which case it keeps
A's value across the whole span and jumps at B (After Effects / DaVinci Resolve "hold"). Channels:
`x, y, scaleX, scaleY, rotation, skewX, skewY, rotX, rotY, z, alpha`. The hold flag lives on the
**outgoing** keyframe (A governs the tween leaving it). Held channels ignore the ease curve because
they don't move. So `hold:['x']` → X frozen while Y/scale/rotation tween normally over the same span.

## Slaved nested timelines — `localFrame`

An instance's own frame advances with the parent from where it appeared:

```
elapsed   = parentFrame − keyframeFrame        // how long the parent has held it
localFrame = map(firstFrame + elapsed) by loopMode:
   loop     → wrap over the symbol length
   playonce → clamp to the last frame
   single   → pin firstFrame
```

`depthGuard` (16) stops a symbol that (indirectly) contains itself. Because `localFrame` is a pure
function of the top frame, nested timelines — to any depth — scrub and export deterministically.

## DOM renderer — `DisplayNode`

Each `RenderNode` is an absolutely-positioned `<div>` with `transformOrigin:0 0` carrying
`cssTransform(node.transform)`; children nest inside, so CSS composes parent→child transforms exactly
as Flash composes matrices. `data-node-id` = `srcId` (selection hit-testing). The transform order is
Flash's: `translate → perspective(translateZ,rotateX,rotateY) → rotate → skew → scale`.

Leaf rendering (also in `DisplayNode`):
- **image/video** — sized to `props.w × h`; **crop** enlarges the media to `1/crop` and offsets so
  only the cropped window shows; **border** (radius/width/colour) via CSS.
- **text** — font/size/colour/align, optional gradient via `background-clip:text`, optional border.
- **shape** — rect/ellipse/line with fill/gradient/stroke/radius.
- **surface reflection** — when the node carries reflection props, a coplanar flipped clone is drawn
  below it using Studio Mate's `@sm/clipboard/reflection` engine (feathered, dimmed).

## Video export (shared pipeline)

The Flash document renders through the same exporter as the intro maker: headless Chromium loads a
render page, `window` exposes a frame-step hook, and for each frame `0 … fps×seconds` the page is
screenshotted and piped into one ffmpeg pass → **mp4 · mpg · mov(alpha) · webm(alpha) · png**.

> **Trap:** never pass `animations:'disabled'` to `page.screenshot()` — Playwright fast-forwards
> animations to their end state, capturing empty frames. The clock/resolver already pins the frame.

**Remaining glue:** the exporter currently drives intro-maker projects; wiring a Flash document id
into the frame stepper (load doc → step `resolveDocument`) is the one pending piece — the resolver and
DOM are ready.
