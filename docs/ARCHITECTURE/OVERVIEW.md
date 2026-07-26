# Architecture — Overview

## The app

IntroMate is one Express server (**:4040**) + one Vite React client (**:5200**) with two authoring
surfaces:

| Surface | URL | What | Doc |
|---|---|---|---|
| **Intro maker** | `/` | seekable-clock opener maker → video | [../../README.md](../../README.md) |
| **Flash** | `/flash.html` | Flash-style timeline authoring tool | [../FLASH.md](../FLASH.md) |
| **Render page** | `/render.html` | the page the exporter screenshots | [../../README.md](../../README.md) |

Both surfaces share the server, the media/font routes, and the Studio Mate motion engine.

## Repo layout

```
C:\KC_Assets\IntroMate\
├── CLAUDE.md                 # router (read first)
├── README.md                 # intro maker + how to run
├── docs/                     # this hierarchy
├── data/
│   ├── flash.db              # SQLite — Flash documents (gitignored data)
│   ├── projects/             # intro-maker JSON projects
│   ├── media/                # uploaded media + .cache (thumbs, peaks)
│   └── exports/              # rendered video output
├── review/                   # gitignored dev artifacts (screenshots, probes)
├── server/src/
│   ├── index.ts              # routes: /api/intro/*, /api/doc/*, /api/media/*, /api/render/*
│   ├── db.ts                 # SQLite schema + migrations
│   ├── documents.ts          # Flash document read/write (nested tree ↔ tables)
│   ├── media.ts              # media/font libraries, peaks, thumbs, duration
│   ├── projects.ts           # intro-maker JSON projects
│   ├── render.ts             # headless-Chromium → ffmpeg exporter
│   └── paths.ts / ffmpegPath.ts
└── client/src/
    ├── flash/                # the Flash tool (see docs/FLASH.md §9 for the module map)
    ├── components/           # intro-maker UI + shared MediaPicker, Waveform
    ├── lib/                  # clock, history, motion, audioBed
    └── flash-main.tsx / main.tsx / render-main.tsx  (three Vite entries)
```

## Studio Mate reuse (`@sm`)

The Vite alias `@sm` → `C:/KC_Assets/StudioMate/client/src` (see
[../../client/vite.config.ts](../../client/vite.config.ts); override with `SM_SRC`). Imported
**read-only**:

- `@sm/lib/animations` — IN/HOLD/OUT effect registry (intro maker)
- `@sm/titles/render/*` — L3 track renderer + coords (intro maker)
- `@sm/clipboard/reflection` — surface-reflection engine (Flash + intro)
- `@sm/components/slideStyles`, `SlideObject`, `slideCrop` — 3D slab, poses (intro maker)
- `@sm/components/timeline/TimelineRuler`, `@sm/lib/bulltrackConstants` — timeline units
- `@sm/titles/components/BezierEditor` — easing graph (Flash inspector)
- `@sm/lib/tumble` — Ctrl-drag perspective gesture (Flash stage)

**Never edit the Studio Mate tree from here.** → [../SYSTEM_DIRECTIONS/DIRECTIVE_PRINCIPLES.md](../SYSTEM_DIRECTIONS/DIRECTIVE_PRINCIPLES.md) §3

## How to run

Normally **already running under PM2** as part of the Studio Mate stack: `intromate-server` (:4040,
`tsx watch`) + `intromate-client` (:5200, Vite), both `pm2 save`d so they resurrect on boot. Server
auto-reload and client HMR work through PM2, so most edits need nothing.

A third PM2 process, **`intromate-monitor`** (:4041), supervises that pair — it is the only thing
that restarts them. Don't restart by hand; ask the monitor.

```powershell
npm run monitor:status                # both services, with a reason per service
npm run live                          # force an immediate check + restart of whatever is down
npx pm2 logs intromate-server         # tail
```

First-time setup, or a standalone run **with the PM2 pair stopped** (they collide on 4040/5200):

```powershell
cd C:\KC_Assets\IntroMate
npm install                                            # once
npx playwright install chromium chromium-headless-shell # once (renderer)
npx pm2 stop intromate-server intromate-client         # release the ports first
npm run dev                                            # server :4040 + client :5200
```

`better-sqlite3` is native and compiled for the running Node major (**20.16.0**, same as the PM2
daemon). Changing Node majors requires `npm rebuild better-sqlite3`.

## Edits are live — and the screen proves it

**Do not restart to see a change.** Vite HMR (client) and `tsx watch` (server) apply edits in place;
restarting on every edit throws that away and costs seconds each time. Restart only when a process is
actually down.

The **build stamp** in the Flash header is the ground truth for what is running on screen:

```
v0.1.0 · 2026-07-26 01:46 · hmr 3
└ package version  └ build   └ hot updates applied since this page loaded
```

- **version / build** come from `define` in [../../client/vite.config.ts](../../client/vite.config.ts)
  (`__APP_VERSION__`, `__APP_BUILD__`). `build` is minted when the Vite server starts or a production
  build runs — a *new* build time means the dev server restarted, so a full reload is warranted.
- **hmr N** ticks on every `vite:afterUpdate`
  ([../../client/src/flash/BuildStamp.tsx](../../client/src/flash/BuildStamp.tsx)). Edit a client
  file and the counter increments **without a reload** — that is the change landing on your screen.
  **If it does not move, HMR did not reach the page and it needs a reload.** Verified end to end:
  an edit took the counter 0 → 1, reverting it 1 → 2, with no navigation.

Bump `version` in [../../client/package.json](../../client/package.json) when you want a version both
sides can name; the header picks it up on the next dev-server start.

### Keeping the servers up

`scripts/monitor.mjs` — PM2 process **`intromate-monitor`** — polls every 15s and restarts **only** a
process that fails, through the PM2 programmatic API. Healthy ones are left alone so HMR keeps
working.

Health is the **port answering HTTP**, never PM2's status. Under `tsx watch` and Vite the pid PM2
supervises is the watcher, and the child owning the port can die while the watcher lives on — PM2
reports `online` forever against a dead port. PM2 status is checked first only to catch
`stopped`/`errored`. Guards: a 20s settle window after a restart, and a 3-per-10min storm limit
after which it reports `storm: true` instead of hammering.

- `GET :4041/api/monitor/health` — per-service `healthy` / `pm2Status` / `reason` (503 if any is down)
- `POST :4041/api/monitor/check` — force a check now; returns the names it restarted

`scripts/ensure-live.sh` is just a POST to that endpoint (plus reviving the monitor itself if :4041
is silent). It runs after every edit via the `PostToolUse` hook in `.claude/settings.json` (async, so
it never blocks), and by hand as `npm run live`.

Scope is IntroMate-only, deliberately: StudioMate's `watchdog` (:4013) supervises its own stack, and
two supervisors on one process race each other's backoff.

Ports across the KC_Assets machine (avoid collisions): IntroMate 4040/5200/**4041** · StudioMate
content 4000 · watchdog 4013 · ObsApi 4015 · BugTracker 4010 · LOGOS 4020/5180 · SARF 4030/5190.

## Toolchain

- Node 20 (better-sqlite3 has prebuilds for it; verified working). Server runs `tsx watch`.
- SQLite via `better-sqlite3` (synchronous). CLI `sqlite3` installed for inspecting `data/flash.db`.
- No Rust/wasm, no SWF — an earlier exploration was dropped in favour of DOM + SQL.
