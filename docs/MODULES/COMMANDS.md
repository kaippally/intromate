# Module — Commands, Keymap, Shortcut Manager & Undo

The canonical action layer. Every user action is a **Command**; keys map to commands; the Shortcut
Manager edits that map. Files:
[../../client/src/flash/commands.ts](../../client/src/flash/commands.ts) (catalogue),
[../../client/src/flash/keymap.ts](../../client/src/flash/keymap.ts) (dispatch + persistence),
[../../client/src/flash/ShortcutManager.tsx](../../client/src/flash/ShortcutManager.tsx) (editor),
[../../client/src/lib/history.ts](../../client/src/lib/history.ts) (undo).

## Invariant: every feature is a Command

A `CommandDef` is `{ id, label, category, defaultKeys[], when? }`. The catalogue in `commands.ts` is
the **single list of features**. To add a feature: add a `CommandDef` there **and** a handler in
`FlashApp`'s `H` map. Do not bind a key ad hoc — the catalogue, the menus and the Shortcut Manager all
read from this one place, so they can never disagree.

## Dispatch

`useKeymap(handlers)` attaches one `keydown` listener. A key event is normalised to a combo
(`comboFromEvent`, e.g. `Ctrl+Shift+K`, `F6`, `Ctrl+ArrowLeft`), looked up in the effective map
(user override ?? default), and the matching handler runs. Events inside text fields are ignored
except a small allowlist (undo/redo/save/shortcuts). One key event becomes a command in exactly this
one place.

## Shortcut Manager (canonical, user-editable)

Header **⌨ Shortcuts** button or `Ctrl+/`. Lists every command by category with its current binding;
**Record** captures the next combo for a command; conflicts are flagged (amber); per-command ↺ and
global reset restore defaults. Overrides persist in `localStorage` (`flash:keymap`). It edits the
same map the dispatcher reads.

## Default shortcuts

| Category | Command | Keys |
|---|---|---|
| File | New / Save / Export | `Ctrl+Alt+N` · `Ctrl+S` · `Ctrl+Alt+E` |
| Edit | Undo / Redo | `Ctrl+Z` · `Ctrl+Shift+Z`, `Ctrl+Y` |
| Edit | Duplicate to New Layer / Delete | `Ctrl+D` · `Delete`, `Backspace` |
| Playback | Play/Pause · Stop | `Space` · `Shift+Space` |
| Playback | Go to Start / End | `Ctrl+Home`,`Home` · `Ctrl+End`,`End` |
| Playback | Prev / Next Frame | `,`/`←` · `.`/`→` |
| Playback | Prev / Next Keyframe | `Ctrl+←` · `Ctrl+→` |
| Timeline | New Object Timeline (nest) | `Ctrl+Shift+K` |
| Timeline | Selection → Object Timeline | `Ctrl+Shift+F8` |
| Timeline | Insert Keyframe / Blank / Frame | `Ctrl+Alt+K`,`F6` · `F7` · `F5` |
| Timeline | Remove Frame / Clear Keyframe | `Shift+F5` · `Shift+F6` |
| Timeline | Motion Tween · New / Delete Layer | `Ctrl+Alt+M` · `Ctrl+Shift+L` · `Ctrl+Shift+Delete` |
| Library | New Symbol · Convert · Import · Edit | `Ctrl+F8` · `F8` · `Ctrl+R` · `Ctrl+E` |
| Library | Add Text / Rect / Ellipse | `Alt+T` · `Alt+R` · `Alt+O` |
| Arrange | Raise / Lower Layer | `Ctrl+↑` · `Ctrl+↓` |
| Selection | Nudge L/R/U/D | `Alt+Arrow…` |
| View | Zoom In/Out/Fit · Shortcuts | `Ctrl+=` · `Ctrl+-` · `Ctrl+0` · `Ctrl+/` |

## What `Delete` acts on

`edit.delete` deletes **whatever is selected**, in this order:

1. **Stage objects** — every node in the multi-selection (`Ctrl+click` to extend it).
2. **Otherwise, the selected keyframe's objects** — selecting a keyframe in the timeline clears the
   stage selection, so the two can never collide.

Because each keyframe holds its **own copy** of an object (same `token`, fresh `id` — see
[../ARCHITECTURE/DATA_MODEL.md](../ARCHITECTURE/DATA_MODEL.md)), deleting from a keyframe empties
only *that* keyframe; the object survives on its other keyframes. To remove the keyframe itself, use
the frame right-click menu → **Delete Keyframe** (frame 0 is pinned).

## Undo / redo (100 levels)

`useHistory` holds the document with 100 past + future states. `commit(nextOrUpdater, key?)` records a
step; a `key` **coalesces** consecutive edits of the same thing (a slider drag, a chip drag) into one
step, while discrete edits (a toggle, a preset) are separate. `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`,
plus header ↶/↷. Opening a document resets history. **Every edit must go through `commit`** — never
mutate the document in place.

## Known behaviour / gaps

- `Ctrl+D` was previously a no-op — now duplicates onto a new layer. *(Bug fixed.)*
- Pending commands (not yet in the catalogue): copy/cut/paste (`Ctrl+C/X/V`), marquee multi-select.
  Add them as Commands + handlers per the invariant above.
