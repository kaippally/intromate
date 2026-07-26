# Module — Stage

The spatial canvas: renders the editing symbol's display list at the current frame and provides
direct manipulation. File: [../../client/src/flash/FlashStage.tsx](../../client/src/flash/FlashStage.tsx)
(wrapped by `MeasuredStage` in [FlashApp.tsx](../../client/src/flash/FlashApp.tsx) for sizing).

## Layout

The stage is the `doc.width × doc.height` rectangle, CSS-`scale()`d to fit the panel and clipped
(`overflow:hidden`) like Flash. `scale = min(boxW/width, boxH/height)`. All pointer maths convert
screen px → stage px by `÷ scale`.

## Selection — pixel hit-testing (canonical)

**Selection hit-tests the real rendered pixels, never a computed box.** Every `DisplayNode` wrapper
carries `data-node-id` (its `srcId`). On mousedown the stage walks up from `event.target` to the
**outermost** `data-node-id` that is a top-level object of the editing symbol (`topIds`), and selects
that. Clicking empty stage deselects.

> Why: earlier the stage drew invisible hit-boxes from stored geometry; they drifted from the visual
> (text estimates, reflections, aspect) so clicks missed. Hit-testing the DOM cannot miss. *(Fixed a
> reported "selection is tricky / doesn't happen" bug.)*

**Double-click** an `instance` → dive into its symbol's timeline (`onEditInstance` → breadcrumb push).

## Selection box — measured, not computed (canonical)

`TransformControls` draws on the **measured** `getBoundingClientRect` of the selected node's real
element, relative to the stage frame (`selRect`, recomputed on selection/frame/size change). The box
therefore always covers exactly what's on screen regardless of aspect, crop or reflection. *(Fixed
the "bounding box only covers a strip of the image" bug — the box now equals the image rect exactly.)*

## Transform gestures

| Gesture | Effect | Notes |
|---|---|---|
| Drag body | move | `x/y`; box body and object are both draggable |
| Drag a handle (8) | resize → `scaleX/scaleY` | **opposite edge pinned** (drag W → right edge fixed by adjusting `x`); corner + **Ctrl** = uniform |
| Drag rotate handle | `rotation` | round handle above the box |
| **Ctrl + wheel** | zoom the **canvas** (0.2×–8×) | cursor-anchored; the point under the pointer stays put. Never the browser's page zoom. Resets when a different symbol opens |
| **Shift + wheel** | uniform scale of the selected node | `scaleX/scaleY` × 1.05 per notch |
| **Alt + wheel** | `z` depth (perspective dolly) | ±40 per notch |
| **Ctrl + drag** body | perspective tumble `rotX/rotY` | Studio Mate `@sm/lib/tumble`, 0.5°/px yaw+pitch |

All three wheel gestures are attached natively with `{ passive: false }` so `preventDefault` actually
suppresses the browser gesture. *(Ctrl+wheel used to be Z depth; it became canvas zoom when the
browser-zoom guard landed, and Z depth moved to Alt+wheel.)*

**Opposite-edge anchoring:** the object's origin is its top-left, so E/S handles already pin
left/top; for W/N handles the resize also moves `x/y` to pin the right/bottom edge. *(Fixed "E/S/SE
scale right, the rest wrong".)* Resize maps the screen-pixel delta to a scale factor relative to the
object's on-screen size (`selRect`), so it tracks the cursor 1:1 at any zoom.

> Known limitation: anchoring uses the axis-aligned rect, so a already-2D-rotated object can drift
> slightly on resize. Un-rotated objects (the common case) are exact.

## Right-click a stage object

Opens the node context menu (built in `FlashApp.nodeMenu`, rendered by
[ContextMenu.tsx](../../client/src/flash/ContextMenu.tsx)): Edit (dive in) · **Replace image/video…**
(type-locked to the node's kind) · **Start Play** (video only) · Convert to Object Timeline · Loop
mode (instances) · Bring to Front / Send to Back · **Duplicate to New Layer / Same Layer** · Delete.

**Start Play** is a checkable toggle shown only on `video` nodes. It writes `props.autoplay` on the
node, and `DisplayNode` plays or pauses the real `<video>` element in response — toggling it off also
rewinds to 0, so the stage returns to the deterministic first frame. The flag is document state, so
the resolver stays pure; this is *element* playback, not frame-synced playback (still pending — see
[../FLASH.md](../FLASH.md) §11).

## Wiring

`FlashStage` props: `doc, symbolId, frame, boxW, boxH, selectedNodeId, onSelectNode, onMoveNode,
onTransformNode, onEditInstance, editable`. It renders `resolveSymbol(doc, sym, frame)` via
`DisplayNode`, and (when editable) the measured `TransformControls`.
