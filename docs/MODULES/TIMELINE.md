# Module — Timeline

The layers × frames grid for the symbol currently being edited. File:
[../../client/src/flash/panels/TimelinePanel.tsx](../../client/src/flash/panels/TimelinePanel.tsx).
Reuses `@sm/components/timeline/TimelineRuler` and `@sm/lib/bulltrackConstants` for frame width /
ruler units.

## Structure

- **Ruler** — frame numbers; click/scrub to move the playhead. A `+ Layer` button and 🗑 (delete
  selected layer) sit in the top-left gutter.
- **Layer rows** — top-of-z first. Each row: show/hide 👁, lock 🔒, editable name; then the frame
  track.
- **Frame track markers:**
  | Marker | Means |
  |---|---|
  | filled dot | a `key` keyframe |
  | hollow dot | a `blank` keyframe |
  | grey bar to next dot | held frames (state carries) |
  | tinted span + arrow | a tween span |
  | amber line | the playhead |

## Interactions

- **Scrub** — click the ruler or a track; sets the frame (and selects that layer).
- **Drag a keyframe dot** → move it to another frame (`moveKeyframe`; frame 0 is pinned, occupied
  frames rejected). Selecting a keyframe shows its easing in the Inspector.
- **Select a keyframe → `Delete`** → removes the objects sitting on that keyframe (only that one —
  each keyframe holds its own copy). The keyframe itself stays; use the right-click menu to remove
  it. → [COMMANDS.md](COMMANDS.md) §What `Delete` acts on
- **Right-click a frame** → keyframe context menu (built in `FlashApp.openFrameMenu`): Insert Keyframe
  (`Ctrl+Alt+K`/`F6`) · Insert Blank Keyframe (`F7`) · Create Motion Tween · Delete Keyframe — each
  enabled/disabled by whether a keyframe exists there.
- **+ Layer** (`Ctrl+Shift+L`) adds a `normal` layer; 🗑 deletes the selected one (never the last).

## Playhead & navigation (commands)

Playhead position is app state (`frame`), reset to 0 on context change. Navigation commands
(rebindable — see [COMMANDS.md](COMMANDS.md)):

| Command | Default | Behaviour |
|---|---|---|
| Go to Start / End | `Ctrl+Home` · `Ctrl+End` | frame 0 / last frame of the symbol |
| Prev / Next Frame | `,`/`←` · `.`/`→` | ±1 frame |
| Prev / Next **Keyframe** | `Ctrl+←` · `Ctrl+→` | jump to the neighbouring keyframe frame — on the selected layer if one is selected, else the union across all layers |

## The per-layer tween rule (important)

A tween pairs nodes by `token` **within one layer** across its keyframes. Two objects that must
animate independently therefore need **separate layers**. This is why **Duplicate** defaults to
copying an object onto its **own new layer** (see [LIBRARY.md](LIBRARY.md) / [STAGE.md](STAGE.md)),
and why **placed media always gets its own layer** — a nested timeline holds many layers, but only
one media object may occupy a layer.

## Playback

`Play` (`Space`) advances `frame` by `1000/fps` via rAF, looping over the editing symbol's length
(`symbolLength`). Stop (`Shift+Space`) resets to 0.
