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
8. **Edits are live — don't restart to see them.** The server runs `tsx watch` (auto-reload); the
   client is Vite HMR. Restart only a process that is actually **down** — and you don't do that by
   hand: **`intromate-monitor` owns every restart** (rule 10). The **build stamp** in the Flash
   header — `v0.1.0 · <build> · hmr N` — is the ground truth: the `hmr` counter ticking means your
   edit reached the screen; if it doesn't move, the page needs a reload. Typecheck
   (`cd client && npx tsc --noEmit`) before claiming done, and say **unverified** if you didn't see
   it. → [docs/ARCHITECTURE/OVERVIEW.md](docs/ARCHITECTURE/OVERVIEW.md)
9. **Dev artifacts → `review/` only.** Screenshots, probes and throwaway scripts go in the gitignored
   `review/` folder, never the repo root or a module folder.
10. **Never restart a process by hand — ask the monitor.** [scripts/monitor.mjs](scripts/monitor.mjs)
    (PM2 process `intromate-monitor`, port **:4041**) is the only thing that restarts
    `intromate-server` / `intromate-client`, and it does so through the **PM2 programmatic API**.
    Don't run `pm2 restart`, `pm2 stop` or `npm run dev` yourself — you'd race the supervisor and
    fight its storm backoff. Never touch a PM2 process outside those two: the StudioMate stack has
    its own watchdog (:4013) and two supervisors on one process is a restart loop. → PM2 supervision
    below

---

## PM2 supervision — `intromate-monitor` (:4041)

**What it is.** A service that health-checks IntroMate's PM2 processes every 15s and restarts any
that are unhealthy, via the PM2 programmatic API (`pm2.connect` / `pm2.list` / `pm2.restart`) — not
by shelling out. It watches **`intromate-server`** (probe `:4040/api/intro/health`) and
**`intromate-client`** (probe `:5200/flash.html`), and nothing else.

**Why health = the port, not PM2 status.** `intromate-server` runs under `tsx watch` and the client
under Vite, so the pid PM2 supervises is the *watcher*; the child that owns the port can die while
the watcher lives on. PM2 keeps reporting `online` and never restarts. Verified on this box:
PM2 supervised pid 45528 while :4040 was owned by pid 232132 — killing 232132 left PM2 reporting
`online` against a dead port. So a service is healthy only when its **port answers HTTP**; PM2
status is checked first merely to catch `stopped`/`errored`.

**Guards.** A 20s settle window after each restart (Vite and tsx take seconds to rebind — probing
inside it would restart a process that is coming up fine), and a storm limit of 3 restarts per 10min
after which it stops and reports `storm: true` rather than hammering something restarting won't fix.

**Use it like this:**

| Need | Do |
|---|---|
| Are the servers up? | `npm run monitor:status` → `GET :4041/api/monitor/health` (200 healthy, 503 not) |
| Something looks down | `npm run live` — forces an immediate check + restart, don't wait 15s |
| A service is genuinely broken | Read `reason` in the health JSON, then `npx pm2 logs <name> --nostream` |
| Monitor itself is down | `npm run live` revives it (delete-then-start, so no duplicate entry) |
| Register after a fresh clone/reboot | `npm run pm2:setup` |

`reason` is the diagnosis — `serving`, `restarted, settling`, `online but <url> → ECONNREFUSED`,
`not registered with PM2`, `restart storm, not retrying`. Read it before touching anything.

**Version pin.** `pm2` is pinned **exact** in [package.json](package.json) to the version of the
running daemon (7.0.1). A mismatch makes the CLI print an "In-memory PM2 is out-of-date" banner that
corrupts `pm2 jlist` JSON. If you must change it, match the daemon — never run `pm2 update`, which
restarts every process on the machine including the StudioMate stack.

---

## Session startup checklist

1. **Ask which surface/module** the user is working on (routing table below); read only those docs.
2. **Query the bug tracker (non-blocking)** — the shared tracker at **:4010**, module **`intromate`**:
   `GET http://localhost:4010/api/bugs?status=open&module=intromate` and `…&status=investigating&module=intromate`.
   If :4010 is down, skip silently. → full workflow: [docs/SYSTEM_DIRECTIONS/DIRECTIVE_PRINCIPLES.md](docs/SYSTEM_DIRECTIONS/DIRECTIVE_PRINCIPLES.md)
3. **Confirm the servers are up** — `npm run monitor:status` (one call, covers both). If :4041 is
   silent the monitor is down: `npm run live`.

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
| **Process health / PM2 / restarts / a server is down** | PM2 supervision above · [scripts/monitor.mjs](scripts/monitor.mjs) |
| **Document model** (symbol / layer / keyframe / node / instance / asset) | [docs/ARCHITECTURE/DATA_MODEL.md](docs/ARCHITECTURE/DATA_MODEL.md) |
| **Database / tables / migrations / read-write flow** | [docs/ARCHITECTURE/SQL_SCHEMA.md](docs/ARCHITECTURE/SQL_SCHEMA.md) |
| **Frame resolver / tweens / hold / nesting / DOM render / video export** | [docs/ARCHITECTURE/RENDERER.md](docs/ARCHITECTURE/RENDERER.md) |
| **Stage** (selection, transform handles, wheel, perspective) | [docs/MODULES/STAGE.md](docs/MODULES/STAGE.md) |
| **Timeline** (layers, keyframes, tweens, playhead, drag) | [docs/MODULES/TIMELINE.md](docs/MODULES/TIMELINE.md) |
| **Library** (symbols, instances, nesting tree, assets, replace) | [docs/MODULES/LIBRARY.md](docs/MODULES/LIBRARY.md) |
| **Inspector** (contextual props, per-parameter hold, easing, style) | [docs/MODULES/INSPECTOR.md](docs/MODULES/INSPECTOR.md) |
| **Commands / keymap / Shortcut Manager / undo** | [docs/MODULES/COMMANDS.md](docs/MODULES/COMMANDS.md) |
| **Macros** (animation generators, Video Carousel, Macro panel) | [docs/MODULES/MACROS.md](docs/MODULES/MACROS.md) |
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
│   ├── COMMANDS.md              # command catalogue, keymap dispatch, Shortcut Manager, history
│   └── MACROS.md                # macro contract, Video Carousel (Slides IN/HOLD/OUT as keyframes)
└── SYSTEM_DIRECTIONS/
    └── DIRECTIVE_PRINCIPLES.md  # design/dev philosophy, bug lifecycle, canonical rules
```
