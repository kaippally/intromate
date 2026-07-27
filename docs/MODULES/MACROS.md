# Macros — animation generators

A **macro** writes a finished construction into the current timeline: it takes media and parameters
and emits ordinary **layers and keyframes**. There is no macro runtime, no macro node type and no
second renderer — once applied, the result is a plain document the author edits, scrubs and exports
like anything hand-built, and a single **Ctrl+Z** removes the whole thing.

| | |
|---|---|
| Panel | [client/src/flash/panels/MacroPanel.tsx](../../client/src/flash/panels/MacroPanel.tsx) (Mosaic tile `macro`, under the Library) |
| Catalogue | [client/src/flash/macros/index.ts](../../client/src/flash/macros/index.ts) |
| Contract | [client/src/flash/macros/types.ts](../../client/src/flash/macros/types.ts) |
| Primitive | `addAnimatedMediaLayer` in [client/src/flash/mutations.ts](../../client/src/flash/mutations.ts) |
| Command | `view.macros` — *Show Macro Panel* (**Ctrl+Alt+A**), restores the tile if it was closed |

## The contract

```ts
interface MacroDef<P> {
  id; label; blurb; minClips;
  defaults: P;
  fields: MacroField<P>[];                    // the panel renders the form from this
  length(clipCount, params): number;          // frames the construction will span
  build(doc, symId, startFrame, clips, params, assetIds): FlashDoc;   // PURE
}
```

`build` is a pure document function. It composes the same mutations every other edit uses, and
`FlashApp.applyMacro` registers the assets and calls it **inside one `commit`** — so the entire
construction is one history step.

Adding a macro = one builder module + one line in `MACROS`. The panel needs no changes: it renders
the form from `fields` and hands the same object straight back to `build`.

### `addAnimatedMediaLayer`

The primitive every macro builds with: one media clip on its own layer, animated through a list of
`Pose`s. Two details make it work and both are load-bearing:

- **Every keyframe carries the same `token`.** That is what makes the resolver tween them
  (`pairNodes`) and run the video's clock from the first pose rather than restarting it at each
  keyframe (`tokenOrigin`). → [../ARCHITECTURE/RENDERER.md](../ARCHITECTURE/RENDERER.md)
- **The layer is blank before the first pose and after the last**, so the clip has a real in and out
  point on the timeline.

Duplicate frames are collapsed (a layer may hold only one keyframe per frame).

---

## Video Carousel

`macros/carousel.ts` — clips advance through a depth stack, one behind the other, hold at the front,
then rush past the camera.

### Where it comes from

It is the Studio Mate **Slides IN / HOLD / OUT** vocabulary rebuilt on a different substrate. In
Slides an effect is a wall-clock CSS animation — `play(el, ctx)` runs a `@keyframes` with a delay,
and an element's life is IN (`fill both`) → HOLD (infinite loop) → OUT (`fill forwards`)
(`@sm/lib/animations`). **None of that can cross into Flash**, because `resolveDocument(doc, frame)`
must stay a pure function of the frame. So the macro keeps the shape and changes the substrate:

| Slides | Carousel macro |
|---|---|
| IN — eased CSS keyframes, `fill both` | a **tween** from the station behind to the station in front, over `inFrames` |
| HOLD — infinite loop while on screen | a keyframe with **`tween: 'none'`** — the resolver holds the pose until the next keyframe |
| OUT — eased keyframes, `fill forwards` | a **tween** from the feature station to the exit station, over `outFrames` |

### The reflection comes over for free

In Slides a floor mirror needs a `playReflect` override, because the effect animates the inner `fx`
element and the mirror must move the *opposite* way vertically (`−2·translateY`). Here the motion
lives on the **node's own transform**, and the reflection is a child of it
([DisplayNode.tsx](../../client/src/flash/DisplayNode.tsx) → `reflectionInPlaneStylePct`). The mirror
is carried by the same matrix as the object, so it stays a correct floor reflection at every depth
with **no correction at all**. The macro just sets the reflection props; the Inspector's *Surface
Reflection* section tunes them afterwards, per clip.

### Stacking — why fixed layer order is enough

One clip per layer, and **layer order cannot animate**. That is not a limitation here, because a
carousel is a queue: the frontmost clip is always the *earliest* one still alive. Clip 0 exits toward
the camera in front of everything; clip *k+1* always waits behind clip *k*. So descending layer order
— clip 0 on the topmost layer — is correct for the entire run, which is why the macro **adds its
layers back-to-front**.

### Schedule

`holdFrames` is the **beat**: every clip advances one station per beat, in lockstep, so a clip
reaching the front coincides with the previous one starting to leave. For clip *k*:

```
appear   = startFrame + k·beat
station j (j = depth … 1)   move over inFrames  →  rest until the next beat
front    = appear + depth·beat            ← starts OUT here
gone     = front + outFrames
```

Station `depth` has **alpha 0**, so a clip is born as a fade-up out of the depth rather than popping
in. Clips are fitted inside a `widthPct × heightPct` box, so a portrait clip in a mixed queue stays
on stage instead of towering off it.

### Depth modes — a real trade-off

| Mode | Geometry | Keyframes / layer | Look |
|---|---|---|---|
| `perspective` (default) | ~14px residual drift on a 1080 stage | ~22 | true foreshortening via `translateZ` |
| `scale` | exact (sub-pixel) | ~10 | flat resize |

**Why perspective needs help.** The projected size of a node at depth *z* is
`PERSPECTIVE / (PERSPECTIVE − z)` — *not* linear in `z`, which is what the resolver lerps. A leg
described by only its two endpoints therefore lets the clip drift off the floor line in flight —
measured at **190px** for a tall clip before the fix. So each moving leg is **sampled**
(`LEG_SAMPLES`): the eased path is evaluated with the resolver's own exported `ease()`, an exact pose
is placed at each sample, and the samples tween linearly between themselves. That carries the easing
*and* the geometry, and cuts the drift to ~14px.

`scale` mode needs none of this — there `x` and `y` are both linear in the scale being lerped, so two
keyframes are already exact. Choose it when you want a clean, hand-editable timeline.

`PERSPECTIVE` is exported from [resolve.ts](../../client/src/flash/resolve.ts) — anything predicting
where a node at a given `z` lands on screen must use that same value.

### Verifying a change

[review/check-carousel.ts](../../review/check-carousel.ts) builds a carousel from mixed-aspect clips,
resolves **every frame**, and reports the worst centre / floor-line drift and the keyframe density
per mode. Run it after touching the geometry:

```
npx tsx review/check-carousel.ts
```

---

## Known model limits

Two things the document model does not currently do. Neither blocks the carousel, but both would
widen what macros can express:

1. **No shared stage camera.** `cssTransform` emits `perspective(1200px)` **per node**, so each
   object recedes toward its own centre rather than a single vanishing point. The carousel hides this
   by keeping the stack centred; a fanned layout (`peekX`) at large depth will not converge the way a
   real camera would. *Fix:* move `perspective` onto the stage container and give nodes bare
   `translateZ` — a renderer change that alters how existing 3D-tilted documents look.
2. **Only transform + alpha tween.** `tweenNode` interpolates `x, y, scaleX, scaleY, rotation,
   skewX, skewY, rotX, rotY, z, alpha`. Everything on `props` — reflection opacity, border radius,
   crop, blur — is a **step change at keyframes**. So a reflection cannot fade as a clip recedes.
   *Fix:* interpolate numeric `props` in `tweenNode` alongside the transform.
