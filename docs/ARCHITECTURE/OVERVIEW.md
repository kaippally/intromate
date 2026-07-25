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

```powershell
cd C:\KC_Assets\IntroMate
npm install                                            # once
npx playwright install chromium chromium-headless-shell # once (renderer)
npm run dev                                            # server :4040 + client :5200
```

Ports across the KC_Assets machine (avoid collisions): IntroMate 4040/5200 · StudioMate content 4000
· ObsApi 4015 · BugTracker 4010 · LOGOS 4020/5180 · SARF 4030/5190.

## Toolchain

- Node 20 (better-sqlite3 has prebuilds for it; verified working). Server runs `tsx watch`.
- SQLite via `better-sqlite3` (synchronous). CLI `sqlite3` installed for inspecting `data/flash.db`.
- No Rust/wasm, no SWF — an earlier exploration was dropped in favour of DOM + SQL.
