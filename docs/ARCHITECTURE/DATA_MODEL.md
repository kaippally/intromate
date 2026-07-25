# Architecture — Data Model (canonical)

The one authoritative definition of the Flash document. Types live in
[../../client/src/flash/model.ts](../../client/src/flash/model.ts); the server persists this exact
shape (normalised) via [../../server/src/documents.ts](../../server/src/documents.ts).

## Hierarchy

```
FlashDoc                       the .fla — one document
├── symbols: Symbol[]          the Library (reusable timelines)
│   └── Symbol                 type: scene | movieclip | graphic | button
│       └── layers: Layer[]    tracks, ord 0 = bottom of z-order
│           └── Layer          kind: normal | mask | masked | guide | folder
│               └── keyframes: Keyframe[]      sorted by frame
│                   └── Keyframe               state at `frame`; holds until the next
│                       └── nodes: Node[]      the display objects on this keyframe
│                           └── Node           kind: instance | shape | text | image | video | group
└── assets: Asset[]            Library media (image | video | audio | font)
```

`FlashDoc.rootSymbol` is the id of the Main Timeline (a `scene` symbol).

## Canonical definitions

### FlashDoc
`{ id, name, fps, width, height, bg, rootSymbol, symbols[], assets[], createdAt, updatedAt }`.
Fixed authoring size is `width × height` (default 1920×1080). `fps` sets the frame rate the export
steps at.

### Symbol
`{ id, name, type, regX, regY, ord, layers[] }`.

| type | Timeline behaviour |
|---|---|
| `scene` | a Main Timeline (the document root) |
| `movieclip` | independent timeline (independence needs the VM — currently resolves slaved) |
| `graphic` | **slaved** to the parent — advances/pauses with it; scrubs perfectly |
| `button` | four state frames Up/Over/Down/Hit (reserved) |

`regX/regY` is the registration point (local origin). `ord` is Library sort order.

### Layer
`{ id, name, ord, kind, parentId, locked, visible, outlined, keyframes[] }`.
`ord` ascending = **bottom → top** of the z-order (Flash: index 0 is the bottom). `kind` covers
normal / mask / masked / guide / folder; `parentId` groups masked/folder children.

### Keyframe
`{ id, frame, kind, tween, ease, label, script, soundAssetId, soundSync, nodes[] }`.
- `frame` — 0-based start; plain frames between keyframes hold the previous keyframe's state.
- `kind` — `key` (has content) or `blank` (empty).
- `tween` — `none | motion | classic | shape`; when set (and a next keyframe exists) the span
  interpolates.
- `ease` — `[x1,y1,x2,y2]` cubic-bezier for the tween.
- `label` — timeline label (a future `gotoAndPlay` target); `script` — frame script (logic layer,
  reserved).

### Node — the display object
`{ id, token, ord, kind, symbolRef, assetId, name, …Transform, alpha, blend, loopMode, firstFrame,
hold[], props }`.

- **`token`** — a per-layer stable id. A tween pairs the node in keyframe A with the node in keyframe
  B that share a `token`. This is the identity that "moves" across a tween.
- **`ord`** — z within the layer's keyframe.
- **`kind`** and its reference:
  | kind | references | props carry |
  |---|---|---|
  | `instance` | `symbolRef` → Symbol.id | loop mode, first frame |
  | `image` / `video` | `assetId` → Asset.id | `w,h`, `crop`, border, reflection, (video: mute/volume/trim/fade) |
  | `text` | — | `text, font, size, color, align, gradient`, border, reflection |
  | `shape` | — | `shape (rect\|ellipse\|line), fill, w, h, stroke…` |
  | `group` | — | children (reserved) |
- **`name`** — instance name (scriptable handle, reserved).
- **Transform** (inlined): `x, y, scaleX, scaleY, rotation, skewX, skewY, rotX, rotY, z`. `rotX/rotY`
  are 3D perspective tilt (degrees); `z` is depth.
- **`hold[]`** — the After-Effects/Resolve per-parameter freeze: channels listed here do NOT tween
  out of this keyframe. → detail in [RENDERER.md](RENDERER.md) §Hold.
- **`props`** — a loose bag narrowed by `kind` (`ShapeProps | TextProps | MediaProps`).

### The load-bearing insight — **an instance IS a node**

A Library→Stage instance is simply a `Node{ kind:'instance', symbolRef }`. There is **no separate
placement/instance table**. Consequences:
- Symbols nest by containing instance nodes → the "Russian-doll" of timelines.
- Editing a Symbol updates every instance of it everywhere (one master).
- The Library containment tree is derived by scanning each symbol's nodes for `symbolRef`s.

### Asset
`{ id, name, kind, url, meta }`. `kind` ∈ image | video | audio | font | bitmap. `url` points at the
media server (IntroMate's store or a read-only Studio Mate library) — **never inline `data:`**.

## Lookups & helpers (in model.ts)

- `findSymbol(doc, id)`, `rootSymbol(doc)`, `findAsset(doc, id)`
- `activeKeyframe(layer, frame)` → `{ kf, next }` — the keyframe in force + the following one
- `symbolLength(sym)` — last keyframe frame + 1 (the symbol's own duration)
- `IDENTITY`, `HELD_PARAMS`

## Mutations

All edits are pure functions in [../../client/src/flash/mutations.ts](../../client/src/flash/mutations.ts)
returning a new `FlashDoc`, committed through history. Never mutate in place. Families: symbols
(add/rename/duplicate/delete), assets (add/replace), layers (add/delete/patch/reorder), keyframes
(insert/delete/patch/move), nodes (addText/addShape/addImage/addInstance/patch/duplicate/delete),
nesting (`newNestedTimeline`, `selectionToTimeline`).
