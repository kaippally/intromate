# IntroMate

Two authoring surfaces on one server (**:4040**, client **:5200**):

- **Intro maker** (`/`) — this document, below.
- **Flash** (`/flash.html`) — a Macromedia-Flash-style timeline authoring tool (Stage, Display List,
  Symbols/Library, keyframes, nested timelines) backed by SQLite.

**Documentation is hierarchical and canonical** — start at **[CLAUDE.md](CLAUDE.md)** (the router),
which points to [docs/](docs/): the Flash reference [docs/FLASH.md](docs/FLASH.md), the
[docs/ARCHITECTURE/](docs/ARCHITECTURE/) canonical definitions (data model, SQL schema, renderer),
the [docs/MODULES/](docs/MODULES/) pages (Stage, Timeline, Library, Inspector, Commands), and the
development philosophy + **bug-tracker workflow** in
[docs/SYSTEM_DIRECTIONS/DIRECTIVE_PRINCIPLES.md](docs/SYSTEM_DIRECTIONS/DIRECTIVE_PRINCIPLES.md).
Agents must register and resolve bugs in the shared tracker (:4010, module `intromate`) — see the
router.

---

## Intro maker

Animated intro / opener maker. Authors a short timed composition on a stage, previews it with
frame-accurate scrubbing, and renders it to video (**mp4 · mpg · mov(alpha) · webm(alpha) · png**).

It is a **separate app** — Studio Mate is never modified. IntroMate imports Studio Mate's motion
engine directly from its working tree (read-only) and adds the one thing Studio Mate does not have:
a **seekable clock**.

```
c:\KC_Assets\IntroMate      this app        server :4040   client :5200
c:\KC_Assets\StudioMate     read-only       motion engine, fonts, media libraries
```

## Run

IntroMate is **PM2-managed** as part of the Studio Mate stack — `intromate-server` (:4040, `tsx
watch`) and `intromate-client` (:5200, Vite). Both are `pm2 save`d, so they come back on boot and
are normally **already running**. HMR and server auto-reload work through PM2.

```powershell
npx pm2 restart intromate-server      # after a server change that needs a hard reload
npx pm2 logs intromate-server         # tail the server
npx pm2 status                        # is it up?
```

`npm run dev` still works, but only if PM2 is **not** already serving those ports — otherwise the two
fight over 4040/5200. Stop the PM2 pair first (`npx pm2 stop intromate-server intromate-client`).

```powershell
cd C:\KC_Assets\IntroMate
npm install          # once
npx playwright install chromium chromium-headless-shell   # once — used by the renderer
npm run dev          # only when the PM2 processes are stopped
```

> `better-sqlite3` is a native module compiled for the Node major in use (currently **20.16.0**,
> matching the PM2 daemon). Switching Node majors means `npm rebuild better-sqlite3`, or the server
> crashes on an ABI mismatch at startup.

Open <http://localhost:5200/>. The render page (what the exporter screenshots, also a clean 1:1
preview) is <http://localhost:5200/render.html?project=ID>.

## What is reused from Studio Mate (never copied)

Everything under `@sm/…` is a live import from `C:/KC_Assets/StudioMate/client/src` (Vite alias in
[client/vite.config.ts](client/vite.config.ts); override with `SM_SRC`).

| Reused | From |
|---|---|
| IN / HOLD / OUT effect modules (keyframes, easing, reflection mirrors) | `@sm/lib/animations` |
| L3 track model + `ANIMATION_PRESETS` | `@sm/titles/types` |
| Track content renderer, world↔px coords, font loading | `@sm/titles/render/*` |
| Surface reflection (coplanar flip + feather mask) | `@sm/clipboard/reflection` |
| Slide poses, stage surface, mirror transforms, waft keyframes, slab/border/shadow CSS | `@sm/components/slideStyles` |
| 3D slab card with crop | `@sm/components/SlideObject`, `slideCrop` |
| Perspective floor grid | `@sm/components/PerspectiveGrid` |
| Timeline ruler | `@sm/components/timeline/TimelineRuler` |
| Fonts (`data/fonts`), images, SFX, Music, videos, StreamCapture clips | served read-only by this server |

An intro element **is** an L3 `Track`: `delay` = start, `animInMs` = IN, `duration` = HOLD,
`animOutMs` = OUT. The timeline chip is a view over those fields — no parallel timing model.

## The seekable clock

Studio Mate schedules motion with `setTimeout` + CSS transitions, which cannot scrub or render.
IntroMate expresses **every** motion as a *paused* Web Animation carrying its own absolute delay
([client/src/lib/motion.ts](client/src/lib/motion.ts)), so the whole composition is a pure function
of one number. [client/src/lib/clock.ts](client/src/lib/clock.ts) writes that number into
`root.getAnimations({subtree:true})` each frame:

* **Play** — rAF drives the number.
* **Scrub** — the number is set by hand.
* **Render** — the number is stepped `1/fps` at a time.

Preview and export are therefore the same code path and cannot drift. Videos and audio cues are
seeked to the same time; the two JS-driven char effects (typeWriter, letterBlurIn) get a seek
adapter over the shared grapheme splitter.

## Rendering

`POST /api/render {projectId, format, fps, scale}` launches headless Chromium on `render.html`,
waits for `window.introReady`, then for each frame calls `window.introSeek(t)` → `page.screenshot()`
→ pipes PNG into one ffmpeg pass that also muxes the audio cues (`adelay` + `volume` + `afade` +
`amix`). Progress streams over SSE at `/api/render/:id/events`; output lands in `data/exports/`.

| Format | Codec | Alpha | Use |
|---|---|---|---|
| `mp4` | H.264 / AAC | no | upload, editing |
| `mpg` | MPEG-2 PS / MP2 | no | classic `.mpg`, plays anywhere |
| `mov` | ProRes 4444 / PCM | **yes** | OBS stinger, NLE |
| `webm` | VP9 / Opus | **yes** | small alpha file |
| `png` | PNG sequence | **yes** | frame-exact hand-off |

Alpha only makes sense with **Background → Transparent**.

> Never pass `animations: 'disabled'` to `page.screenshot()` — Playwright implements it by
> fast-forwarding animations to their end state, which captures every element post-OUT (empty).

## Audio

`+ Audio` opens the library: Studio Mate's SFX (`data/media/audio`), the Music folder (`data/Music`)
and anything uploaded here, each row with a **waveform** and an audition button at a settable level.
A cue has start / level / fade-in / fade-out / mute, editable in the inspector or straight off the
timeline lane. Video pickers show ffmpeg-generated poster frames. Waveforms reuse Studio Mate's
`.peaks.json` sidecars where they exist (StreamCapture clips), else decode once and cache in
`data/media/.cache`.

The preview bed applies exactly the levels and fades ffmpeg gets at render time, times the project
**master volume**.

## Storage

Projects are JSON in `data/projects/<id>.json` (last 15 versions in `.versions/`) — no database, no
native modules. Autosaves ~1s after the last edit.

## Keys

`Space` play/pause · `Home`/`End` · `←`/`→` ±100 ms (`Shift` ±1 s) · `Delete` removes the selected
element · `Alt`-drag on the timeline disables snapping.

## Optional: run under PM2 with the rest of the stack

Not wired up (it would mean editing Studio Mate's `services.json`). When wanted, add:

```json
{
  "name": "intromate", "pm2Name": "intromate", "colour": "DarkCyan",
  "command": "node node_modules/tsx/dist/cli.mjs watch server/src/index.ts",
  "cwd": "../IntroMate",
  "env": { "NODE_ENV": "development", "INTROMATE_PORT": "4040" },
  "autorestart": true, "waitFor": "http://localhost:4040/api/intro/health"
}
```

…plus a second entry for the Vite client on 5200, exactly like `content-client`.
