# Module — Inspector (Properties)

A **contextual** property panel that changes with the selection, Flash-style. File:
[../../client/src/flash/panels/InspectorPanel.tsx](../../client/src/flash/panels/InspectorPanel.tsx).

## Selection → panel

| Selection | Shows |
|---|---|
| an **object** (node) | Transform (+ per-parameter hold) · type props · Size & Crop · Video · Border · Surface Reflection |
| a **keyframe** | Tween kind + label + **easing bezier graph** |
| nothing | Document (name, size, fps, background) |

## Transform + per-parameter hold (canonical)

Each transform channel — X, Y, Scale X, Scale Y, Rotate, Skew X, Skew Y, Alpha — has a numeric field
and a **⏸ hold toggle**. A held channel turns amber and is written to the node's `hold[]`; during a
tween out of that keyframe it does **not** interpolate — it holds and jumps at the next keyframe
(After Effects / DaVinci Resolve model). See [../ARCHITECTURE/RENDERER.md](../ARCHITECTURE/RENDERER.md) §Hold.

## Keyframe easing

When a keyframe with a tween is selected, the panel shows a preset dropdown and the **BezierEditor**
(`@sm/titles/components/BezierEditor`, reused read-only) bound to `keyframe.ease = [x1,y1,x2,y2]`.
This is the curve the tween A→B follows; held channels ignore it.

## Type-specific + style sections

- **Text** — text, size, colour (with swatches), align.
- **Shape** — fill (swatches), width, height.
- **Size & Crop** (image/video) — width/height + crop left/top/width/height (0–1) with a Reset.
- **Video** — Muted, Volume, Trim in/out, Fade in/out. *(Fields persist; frame-synced playback is
  pending — see [../FLASH.md](../FLASH.md) §11.)*
- **Border** (image/video/text/shape) — Radius and Thickness (slider **+** numeric), Colour (colour
  input **+** preset swatches), Style.
- **Surface Reflection** (image/video/text) — On, Object %, Reflect %, Distance, Feather (Studio
  Mate Clipboard reflection).

## Shared controls

`Slide` (range **+** numeric), `Swatch` (colour input **+** 10 preset swatches), `Check`. All writes
go through `onPatchNode / onPatchKeyframe / onPatchDoc`, i.e. pure mutations committed to history with
a coalescing key so a slider drag is one undo step.
