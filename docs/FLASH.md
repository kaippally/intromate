# IntroMate · Flash — the timeline authoring tool

A Macromedia-Flash-style authoring environment built into IntroMate: a spatial **Stage**, a
**Display List**, a frame **Timeline** with a sweeping playhead, reusable **Symbols** in a
**Library**, **keyframes** with per-parameter tweening, and nested object timelines — all rebuilt
natively in **React + DOM** with a **SQLite** document store.

**Open it at** <http://localhost:5200/flash.html> (run the app with `npm run dev`, see the main
[README](../README.md)).

It is a separate surface from the original intro maker (`/`), sharing the same server (:4040) and the
same Studio Mate motion engine imported read-only under `@sm/…`.

---

## 1. Architecture at a glance

```
React front end (design + preview)        SQLite  (durable document store)
────────────────────────────────          ───────────────────────────────
Mosaic panels: Library · Stage ·           document → symbol → layer →
  Timeline · Properties                    keyframe → node · asset
        │                                          ▲   PUT /api/doc/:id  (whole tree, atomic)
resolveDocument(doc, frame)  ──pure──▶  display list  ──▶  nested <div>s (DisplayNode)
        │                                          │
   FlashStage draws it; the SAME resolver + DOM feed the video renderer (frame-stepped)
```

Two deliberate choices:

- **DOM/CSS is the renderer.** A Flash display list is a tree of containers with composing
  transforms, clipping, blend and masks — which is exactly what nested transformed `<div>`s do for
  free. This keeps the whole Studio Mate inheritance usable (effects, 3D slab, surface reflection,
  the `tumble` gesture) and lets the existing Playwright→ffmpeg exporter screenshot the same DOM the
  editor shows.
- **The resolver is pure.** `resolveDocument(doc, frame)` returns one display list from a document +
  a frame number and nothing else (no wall clock, no history). Preview, scrub and export are the
  same function called with a different frame, so they cannot drift.

---

## 2. The document model

Files: [client/src/flash/model.ts](../client/src/flash/model.ts).

| Entity | Is | Notes |
|---|---|---|
| **Document** (`FlashDoc`) | the .fla | fps, width, height, bg, `rootSymbol`, `symbols[]`, `assets[]` |
| **Symbol** | a reusable timeline | `type: scene \| movieclip \| graphic \| button`; owns `layers[]`. The Main Timeline is a `scene`. |
| **Layer** | a track | `ord` (0 = bottom of z-order), `kind: normal \| mask \| masked \| guide \| folder`, `visible/locked`; owns `keyframes[]` |
| **Keyframe** | state at a frame | `frame`, `kind: key \| blank`, `tween`, `ease [x1,y1,x2,y2]`, `label`, `script`; owns `nodes[]` |
| **Node** | a display object | `kind: instance \| shape \| text \| image \| video \| group`; a full `Transform` + `alpha` + `hold[]` + `props` |
| **Asset** | Library media | image/video/audio/font; a `url` into the media server (never inline data) |

**Key insight — an instance _is_ a node.** A Library→Stage instance is just a `Node` with
`kind:'instance'` and `symbolRef` pointing at another Symbol. There is no separate placement table.
Symbols can contain instances of other symbols, giving Flash's nested "Russian-doll" timelines.

**Transform** carries `x, y, scaleX, scaleY, rotation, skewX, skewY` plus the 3D fields `rotX, rotY`
(perspective tilt) and `z` (depth). `HeldParam` is any of those channels (+ `alpha`) that can be
frozen — see §4.

---

## 3. SQL storage

Files: [server/src/db.ts](../server/src/db.ts) (schema + migrations),
[server/src/documents.ts](../server/src/documents.ts) (read/write tree).

The model is normalised because it _is_ relational:

```
document ─< symbol ─< layer ─< keyframe ─< node
document ─< asset
node.symbol_ref → symbol.id     (an instance references its master)
```

- **Read** rebuilds the nested JSON tree with a handful of indexed queries.
- **Write** (`PUT /api/doc/:id`) flattens the whole tree back inside **one transaction**. Because an
  instance can reference a symbol defined later in the same tree, the transaction sets
  `PRAGMA defer_foreign_keys = ON` so insertion order doesn't matter.
- New model fields (`rot_x`, `rot_y`, `z`, `hold`) are added by guarded `ALTER TABLE` migrations, so
  an existing `flash.db` upgrades in place.

Inspect the DB directly: `sqlite3 data/flash.db ".tables"`.

### API

| Method | Route | Does |
|---|---|---|
| GET | `/api/doc` | list documents |
| POST | `/api/doc` | create (seeds a Scene with one layer + one blank keyframe) |
| GET | `/api/doc/:id` | load the nested tree |
| PUT | `/api/doc/:id` | save the whole tree (atomic) |
| DELETE | `/api/doc/:id` | delete |

Media/fonts routes are shared with the intro maker (`/api/media/*`, `/api/fonts`), reading
IntroMate's own store **and** the Studio Mate image/audio/music/video/StreamCapture libraries.

---

## 4. The frame resolver

File: [client/src/flash/resolve.ts](../client/src/flash/resolve.ts).

`resolveSymbol(doc, symbol, frame)` walks the symbol's layers bottom→top and returns a tree of
`RenderNode`s. For each layer:

1. **Active keyframe** — the last keyframe at or before `frame` (plain frames hold the previous
   keyframe's state). A `blank` keyframe contributes nothing.
2. **Tween** — if the keyframe has a tween and a following keyframe, each node is interpolated toward
   the node with the **same `token`** in the next keyframe, eased by the keyframe's cubic-bezier.
3. **Per-parameter hold** — any channel listed in the node's `hold[]` does **not** interpolate: it
   keeps the A value across the whole span and jumps at the next keyframe (After Effects / Resolve
   "hold"). So `hold:['x']` on A → X stays put while Y/scale/rotation tween normally.
4. **Nested timelines** — an `instance` node recurses into its symbol at a **slaved local frame**:
   `elapsed = parentFrame − keyframeFrame`, mapped by the node's `loopMode` (`loop` wraps,
   `playonce` holds the last frame, `single` pins `firstFrame`). A `depthGuard` (16) stops cycles.

Every step is a pure function of the top frame — nested timelines included — so the whole
composition scrubs and exports deterministically.

> **Deferred:** a MovieClip's _independent_ playhead and `gotoAndPlay` (the ActionScript layer).
> Until that exists, nested MovieClips resolve like slaved graphics. Adding it means stepping a VM
> and re-simulating on backward seeks — the exporter already steps forward, so export stays exact.

`DisplayNode` ([client/src/flash/DisplayNode.tsx](../client/src/flash/DisplayNode.tsx)) renders the
tree as nested absolutely-positioned `<div>`s carrying each node's CSS transform, so parent
transforms compose down exactly as Flash composes matrices. It also applies **crop**, **border**
(radius/thickness/colour) and **surface reflection** (reused from Studio Mate's Clipboard engine).

---

## 5. The UI

Files: [client/src/flash/FlashApp.tsx](../client/src/flash/FlashApp.tsx) and
[client/src/flash/panels/](../client/src/flash/panels/).

Repositionable **react-mosaic** panels (layout persisted to `localStorage`):

- **Library** — the containment **tree**: a symbol expands (click ▸) to the symbols instanced inside
  it, e.g. `Scene 1 › Object 1 › Object 2`. Plus imported media. Buttons: **+ Symbol**, **Import**;
  per-symbol hover actions **Place** (instance into the current timeline), duplicate, delete.
- **Stage** — the 1920×1080 canvas (scaled to the panel, clipped like Flash). Direct manipulation:
  click to select (real-pixel hit-testing), drag to move, 8 resize handles + rotate, wheel and
  Ctrl-gestures (§6).
- **Timeline** — layers × frames grid. Keyframes are dots; held frames a bar; tweens a tinted span
  with an arrow. Scrub the ruler, drag keyframes, right-click for keyframe ops, **+ Layer** / 🗑.
- **Properties** — a **contextual** inspector: a selected object shows its Transform (each channel
  with a ⏸ **hold** toggle) + type props + Border + Crop + Reflection + Video; a selected keyframe
  shows its tween + an **easing bezier graph** (Studio Mate's `BezierEditor`); otherwise the document.

Above the panels: a header (document picker, undo/redo, transport, frame counter, **Shortcuts**) and
the **breadcrumb scope tabs** (`Main › Object A › Object B`). Right-click a crumb to duplicate /
rename / delete that object.

---

## 6. Editing gestures

| Do | Gesture |
|---|---|
| Select | Click the object (hit-tests the rendered pixels, so it never misses) |
| Move | Drag the object or its selection box |
| Resize | Drag a handle — the **opposite edge stays pinned**; corner + **Ctrl** = uniform |
| Rotate | Drag the round handle above the box |
| Scale (Z position) | **Shift + wheel** |
| Perspective (Z depth) | **Ctrl + wheel**, or **Ctrl + drag** the body (Studio Mate `tumble`: yaw/pitch) |
| Dive into a nested object | **Double-click** the instance on stage (or double-click it in the Library) |

Right-click a stage object → assign settings: Edit, **Replace image/video…** (type-locked — an image
slot accepts only images), Convert to Object Timeline, Loop mode, z-order, **Duplicate to New Layer /
Same Layer**, Delete.

**Duplicating** an object copies it onto its **own new layer** by default, because tweens are
per-layer — two objects that must animate independently need separate layers. "Duplicate on Same
Layer" is available for a plain second copy.

The selection box is **measured from the real rendered element**, so it always covers exactly what's
on screen regardless of aspect, crop or reflection.

---

## 7. Commands & the canonical Shortcut Manager

Files: [client/src/flash/commands.ts](../client/src/flash/commands.ts) (the catalogue),
[client/src/flash/keymap.ts](../client/src/flash/keymap.ts) (dispatch + persistence),
[client/src/flash/ShortcutManager.tsx](../client/src/flash/ShortcutManager.tsx) (editor).

**Every feature is a Command** with a stable id, label, category and default binding. The keymap maps
key combos → command ids; a key event becomes a command in exactly one place, so the menus, the
dispatcher and the shortcut editor can never disagree. The **Shortcut Manager** (header button, or
`Ctrl+/`) lists every command, records a new combo per command, flags conflicts, and resets to
defaults; overrides persist in `localStorage`.

### Default shortcuts

| Category | Command | Keys |
|---|---|---|
| File | New / Save / Export | `Ctrl+Alt+N` · `Ctrl+S` · `Ctrl+Alt+E` |
| Edit | Undo / Redo | `Ctrl+Z` · `Ctrl+Shift+Z`, `Ctrl+Y` |
| Edit | Duplicate to New Layer / Delete | `Ctrl+D` · `Delete`, `Backspace` |
| Playback | Play/Pause · Stop | `Space` · `Shift+Space` |
| Playback | Go to Start / End | `Ctrl+Home`, `Home` · `Ctrl+End`, `End` |
| Playback | Prev / Next Frame | `,` `ArrowLeft` · `.` `ArrowRight` |
| Playback | Prev / Next **Keyframe** | `Ctrl+ArrowLeft` · `Ctrl+ArrowRight` |
| Timeline | New Object Timeline (nest here) | `Ctrl+Shift+K` |
| Timeline | Selection → Object Timeline | `Ctrl+Shift+F8` |
| Timeline | Insert Keyframe / Blank / Frame | `Ctrl+Alt+K`, `F6` · `F7` · `F5` |
| Timeline | Remove Frame / Clear Keyframe | `Shift+F5` · `Shift+F6` |
| Timeline | Motion Tween · New / Delete Layer | `Ctrl+Alt+M` · `Ctrl+Shift+L` · `Ctrl+Shift+Delete` |
| Library | New Symbol · Convert · Import · Edit | `Ctrl+F8` · `F8` · `Ctrl+R` · `Ctrl+E` |
| Library | Add Text / Rect / Ellipse | `T` · `R` · `O` |
| Arrange | Raise / Lower Layer | `Ctrl+Up` · `Ctrl+Down` |
| Selection | Nudge L/R/U/D | `Alt+Arrow…` |
| View | Zoom In/Out/Fit · Shortcuts | `Ctrl+=` · `Ctrl+-` · `Ctrl+0` · `Ctrl+/` |

(Any of these are rebindable in the Shortcut Manager.)

---

## 8. Persistence & undo

- **100-level undo/redo** over the whole document ([client/src/lib/history.ts](../client/src/lib/history.ts)).
  Continuous edits (a slider drag, a chip drag) coalesce into one step via a key; discrete edits are
  separate steps.
- **Autosave** ~0.8 s after the last change writes the whole tree to SQL. Opening a document starts a
  fresh history.

---

## 9. Module map

```
client/src/flash/
├── model.ts            document/symbol/layer/keyframe/node/asset types + lookups
├── resolve.ts          resolveDocument/resolveSymbol — keyframes, tweens, hold, nesting
├── mutations.ts        pure doc edits (add/patch/duplicate/move… ; nest; replace asset)
├── DisplayNode.tsx     recursive DOM renderer (transform, crop, border, reflection)
├── FlashStage.tsx      the Stage: hit-test selection + transform handles + wheel gestures
├── commands.ts         the command catalogue (every feature)
├── keymap.ts           key→command dispatch, load/save overrides
├── ShortcutManager.tsx the canonical shortcut editor
├── ContextMenu.tsx     reusable right-click menu (portalled)
├── FlashApp.tsx        the shell: Mosaic layout, breadcrumb, state, command handlers, autosave
├── api.ts              /api/doc client
├── flash.css           Mosaic dark theme + control classes
└── panels/
    ├── LibraryPanel.tsx    symbol containment tree + media (with replace)
    ├── TimelinePanel.tsx   layers × frames grid, keyframe drag, right-click, +Layer
    └── InspectorPanel.tsx  contextual props: transform+hold, style, crop, reflection, video, easing

server/src/
├── db.ts               SQLite schema + migrations
└── documents.ts        nested-tree read / atomic write / create / delete
```

Entry: [client/flash.html](../client/flash.html) → [client/src/flash-main.tsx](../client/src/flash-main.tsx)
(a Vite input alongside `main` and `render`).

---

## 10. Rendering to video

The Flash document renders through the **same** headless-Chromium → ffmpeg pipeline as the intro
maker ([server/src/render.ts](../server/src/render.ts), documented in the [README](../README.md)):
the resolver is pure, so the exporter steps `frame = 0 … fps×seconds`, screenshots the DOM per frame,
and pipes to ffmpeg (mp4 · mpg · mov/alpha · webm/alpha · png). **Wiring the Flash document id into
the export driver is the remaining step** — the renderer and resolver are ready; only the "load this
document, step its frames" glue is pending.

---

## 11. Status

**Working & browser-verified:** SQL create/read/save roundtrip · nested object timelines
(`Ctrl+Shift+K`) with breadcrumb + Library tree · keyframes (add/blank/drag/right-click) · tweens +
per-parameter hold + easing bezier · pixel-accurate selection · move/resize (opposite-edge anchored)
/ rotate / Shift-wheel scale / Ctrl-wheel & Ctrl-drag perspective · border (radius/thickness/colour +
swatches) · crop · surface reflection · image/video import · media replace (type-locked) · place
instance onto a timeline · +Layer / delete layer · duplicate-to-new-layer · contextual inspector ·
100-level undo · Mosaic panels · canonical Shortcut Manager.

**Coded, not fully click-through-verified:** crop render, reflection render, video trim/mute/fade
fields, object-tab context menu.

**Pending / next:** frame-synced video playback in-editor (needs a video clock) · wiring the Flash
document into the video export · copy/cut/paste (`Ctrl+C/X/V`) · marquee multi-select · Import type
filter · the ActionScript/logic layer (frame scripts, independent MovieClip playheads) with its VM
and backward-seek re-simulation.
