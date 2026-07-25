# Module — Library

The repository of reusable **Symbols** (each its own timeline) and imported **media assets**. File:
[../../client/src/flash/panels/LibraryPanel.tsx](../../client/src/flash/panels/LibraryPanel.tsx).

## Symbols as a containment tree (canonical)

The Library shows symbols as an **expandable containment tree**: a symbol expands (click ▸) to the
symbols instanced inside it. Roots are `scene` symbols plus any symbol not instanced anywhere (so
nothing is hidden). Example verified in-app: `Scene 1 › Object 1 › Object 2`.

The tree is derived, not stored: `childrenOf(sym)` = the unique `symbolRef`s among that symbol's
nodes (because **an instance is a node**, see [../ARCHITECTURE/DATA_MODEL.md](../ARCHITECTURE/DATA_MODEL.md)).
A per-path visited set stops cycles.

## Actions

| Action | How | Result |
|---|---|---|
| **New Symbol** | `+ Symbol` / `Ctrl+F8` | a new empty `movieclip` in the Library |
| **Edit a symbol** | double-click a row / `Ctrl+E` | dive into its timeline (breadcrumb) |
| **Place** | hover a symbol → `Place` | add an **instance** of it to the *current* editing timeline at the playhead |
| **Duplicate** | hover → ⧉ | a new independent symbol (a copy of the master) |
| **Delete** | hover → × | remove the symbol and strip its instances |
| **Import media** | `Import` / `Ctrl+R` | pick from the media libraries → adds an Asset |
| **Replace media** | right-click a media row / `Replace` | swap the asset's source; every node using it updates |

**Placing** an object onto a timeline instances the master; that is how "add an object to a timeline"
works. Because tweens are per-layer ([TIMELINE.md](TIMELINE.md)), an on-stage **Duplicate** of an
object defaults to a **new layer** (Stage right-click → Duplicate to New Layer / Same Layer).

## Media & replacement

- Assets come from IntroMate's own store **and** the read-only Studio Mate libraries (images, audio,
  music, videos, StreamCapture clips), via the shared `MediaPicker`
  ([../../client/src/components/MediaPicker.tsx](../../client/src/components/MediaPicker.tsx)).
- **Replace on a node** (Stage right-click → "Replace image/video…") is **type-locked**: an image
  slot only offers images, a video slot only videos. The picker is opened with the node's own kind;
  on pick the node's `assetId` is repointed and its `w/h` re-fit to the new aspect (no distortion).
- **Replace on a Library asset** (right-click the media row) swaps the source for **every** node that
  references it at once (`replaceAsset`).

## Nesting a new object from here

`Ctrl+Shift+K` (Timeline command) creates a **new Object Timeline** nested from the current one:
`newNestedTimeline` adds a `movieclip` symbol, places an instance of it on the current layer, and
dives in (breadcrumb pushes `Object N`). `Ctrl+Shift+F8` converts the current selection into a new
Object Timeline (`selectionToTimeline`).

## Breadcrumb scope tabs

The scope trail (`Main › Object A › Object B`) lives in the header
([FlashApp.tsx](../../client/src/flash/FlashApp.tsx)). Click a crumb to pop back; right-click a crumb
to Duplicate / Rename / Delete that object. Editing a symbol edits the **master**, so every instance
of it everywhere updates.
