# IntroMate — CLAUDE.md (router)

**IntroMate** is a Windows-only, standalone Node/React/SQLite project at `C:\KC_Assets\IntroMate`
(server **:4040**, client **:5200**). It has two surfaces on one server:

1. **Intro maker** (`/`) — a seekable-clock animated opener maker that renders to video. → [README.md](README.md)
2. **Flash** (`/flash.html`) — a Macromedia-Flash-style timeline authoring tool (Stage, Display List,
   Symbols/Library, keyframes, nested timelines) backed by SQLite. → [docs/FLASH.md](docs/FLASH.md)

It reuses the Studio Mate motion engine **read-only** via a Vite alias (`@sm/…` →
`C:/KC_Assets/StudioMate/client/src`). **Studio Mate is never modified from here.**

**This file is a router, not the manual.** Read the hard rules below, then read only the docs for the
area you're working on (routing table). Reading everything overloads context — don't.

---

## Hard always-on rules (do not violate)

1. **Never modify Studio Mate.** Everything under `@sm/…` is a live, read-only import. If you need a
   change there, surface it — don't edit `C:/KC_Assets/StudioMate/**` from this project. → [docs/ARCHITECTURE/OVERVIEW.md](docs/ARCHITECTURE/OVERVIEW.md)
2. **The resolver is pure.** `resolveDocument(doc, frame)` must stay a pure function of the document
   and the frame — no wall clock, no playback history, no external state. Preview, scrub and export
   depend on it; breaking purity breaks all three. → [docs/ARCHITECTURE/RENDERER.md](docs/ARCHITECTURE/RENDERER.md)
3. **DOM is the renderer.** Draw the display list as nested transformed `<div>`s; never introduce a
   second rendering path (canvas/WebGL/SWF) — the exporter screenshots the same DOM the editor shows.
4. **One edit path.** Every document change goes through a pure mutation in
   [client/src/flash/mutations.ts](client/src/flash/mutations.ts) and is committed through the
   100-level history (`commit`). Never mutate the document in place or bypass history. → [docs/MODULES/COMMANDS.md](docs/MODULES/COMMANDS.md)
5. **Every feature is a Command.** User actions are defined once in
   [client/src/flash/commands.ts](client/src/flash/commands.ts) and dispatched via the keymap. Add a
   feature = add a Command + a handler; never bind a key ad hoc. The Shortcut Manager is canonical.
6. **Media on disk, never inline.** Images/video/audio are `url`s into the media server; never store
   `data:`/`blob:` in the document or DB. → [docs/ARCHITECTURE/SQL_SCHEMA.md](docs/ARCHITECTURE/SQL_SCHEMA.md)
7. **No duplication.** Shared logic lives in `flash/mutations.ts`, `flash/resolve.ts`, `flash/model.ts`
   or `flash/keymap.ts` and is imported. Don't reinvent per-panel.
8. **Restart/verify after edits.** The server runs `tsx watch` (auto-reload); the client is Vite HMR.
   After server edits, confirm the reload; after client edits, verify in the browser or say it's
   **unverified**. Typecheck the client (`cd client && npx tsc --noEmit`) before claiming done.
9. **Dev artifacts → `review/` only.** Screenshots, probes and throwaway scripts go in the gitignored
   `review/` folder, never the repo root or a module folder.

---

## Session startup checklist

1. **Ask which surface/module** the user is working on (routing table below); read only those docs.
2. **Query the bug tracker (non-blocking)** — the shared tracker at **:4010**, module **`intromate`**:
   `GET http://localhost:4010/api/bugs?status=open&module=intromate` and `…&status=investigating&module=intromate`.
   If :4010 is down, skip silently. → full workflow: [docs/SYSTEM_DIRECTIONS/DIRECTIVE_PRINCIPLES.md](docs/SYSTEM_DIRECTIONS/DIRECTIVE_PRINCIPLES.md)
3. **Confirm the servers are up** — `curl -s localhost:4040/api/intro/health`; client at :5200.

### Bug tracker quick-ref (port 4010, module `intromate`)

- **The tracker is the agent's tool — the agent owns the lifecycle end to end** (including
  `resolved`/`wont-fix`).
- **Register first, work second.** On any reported bug/feature: `POST /api/bugs` (set
  `type`, `module:"intromate"`, `files`, `tags`, `title`, `symptom`, `cause`, `severity`) →
  immediately `PATCH …{status:"investigating"}` — before reading code.
- Update `cause`/`files` as you learn. When the fix is deployed, `PATCH …{status:"review", cause, fix,
  files}`; once verified (browser/Playwright), `PATCH …{status:"resolved"}`.
- Check for duplicates before filing; one bug per root cause. IntroMate's umbrella feature is
  **BUG-837**.

---

## Fix workflow — follow this order for every bug or feature

1. **Register** in the tracker (above), status → `investigating`.
2. **Read the relevant files** — every file in the tracker entry / routing table before writing code.
3. **Fix the root cause** — the simplest change; name the real constraint first, don't patch symptoms.
4. **Typecheck** — `cd client && npx tsc --noEmit -p tsconfig.json` (and `cd server && npx tsc --noEmit`).
5. **Verify** — reload the browser; confirm on screen (Playwright when asked). If you can't, say
   **unverified**.
6. **Tracker** → `review` (with `cause`, `fix`, `files`), then `resolved` once confirmed.
7. **Update the docs** in [docs/](docs/) for anything that changed the canonical behaviour.

---

## Routing table — read these for the area you're working on

| Working on… | Read |
|---|---|
| **App overview / repo layout / ports / Studio Mate reuse** | [docs/ARCHITECTURE/OVERVIEW.md](docs/ARCHITECTURE/OVERVIEW.md) |
| **Document model** (symbol / layer / keyframe / node / instance / asset) | [docs/ARCHITECTURE/DATA_MODEL.md](docs/ARCHITECTURE/DATA_MODEL.md) |
| **Database / tables / migrations / read-write flow** | [docs/ARCHITECTURE/SQL_SCHEMA.md](docs/ARCHITECTURE/SQL_SCHEMA.md) |
| **Frame resolver / tweens / hold / nesting / DOM render / video export** | [docs/ARCHITECTURE/RENDERER.md](docs/ARCHITECTURE/RENDERER.md) |
| **Stage** (selection, transform handles, wheel, perspective) | [docs/MODULES/STAGE.md](docs/MODULES/STAGE.md) |
| **Timeline** (layers, keyframes, tweens, playhead, drag) | [docs/MODULES/TIMELINE.md](docs/MODULES/TIMELINE.md) |
| **Library** (symbols, instances, nesting tree, assets, replace) | [docs/MODULES/LIBRARY.md](docs/MODULES/LIBRARY.md) |
| **Inspector** (contextual props, per-parameter hold, easing, style) | [docs/MODULES/INSPECTOR.md](docs/MODULES/INSPECTOR.md) |
| **Commands / keymap / Shortcut Manager / undo** | [docs/MODULES/COMMANDS.md](docs/MODULES/COMMANDS.md) |
| **Whole-tool reference (single page)** | [docs/FLASH.md](docs/FLASH.md) |
| **Intro maker (seekable clock, video render)** | [README.md](README.md) |
| **Dev philosophy, bug workflow, canonical directives** | [docs/SYSTEM_DIRECTIONS/DIRECTIVE_PRINCIPLES.md](docs/SYSTEM_DIRECTIONS/DIRECTIVE_PRINCIPLES.md) |

---

## docs/ index

```
docs/
├── FLASH.md                     # single-page reference for the Flash tool
├── ARCHITECTURE/
│   ├── OVERVIEW.md              # two surfaces, repo layout, ports, @sm reuse, how to run
│   ├── DATA_MODEL.md            # CANONICAL: FlashDoc → Symbol → Layer → Keyframe → Node · Asset
│   ├── SQL_SCHEMA.md            # tables, FKs, migrations, atomic write, API
│   └── RENDERER.md              # resolver purity, tweens, hold, slaved nesting, DOM, export
├── MODULES/
│   ├── STAGE.md                 # pixel hit-test selection, transform handles, wheel/perspective
│   ├── TIMELINE.md              # layers × frames, keyframes, tween spans, drag, +Layer
│   ├── LIBRARY.md               # symbols, instance = node, containment tree, media + replace
│   ├── INSPECTOR.md             # contextual props, hold toggles, easing bezier, border/crop/reflection
│   └── COMMANDS.md              # command catalogue, keymap dispatch, Shortcut Manager, history
└── SYSTEM_DIRECTIONS/
    └── DIRECTIVE_PRINCIPLES.md  # design/dev philosophy, bug lifecycle, canonical rules
```
