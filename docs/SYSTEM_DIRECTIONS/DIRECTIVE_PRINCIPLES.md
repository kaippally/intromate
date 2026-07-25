# Directive Principles — design & development philosophy

Canonical for how work is done in IntroMate. Mirrors the Studio Mate philosophy: name the real
constraint, fix root causes, keep one source of truth, and drive everything through the bug tracker.

---

## 1. The problem-solving directive

1. **Name the real constraint first.** Before writing code, state the actual invariant the bug
   violates (e.g. "the selection box is computed from stored geometry, which drifts from the rendered
   pixels"). A fix that doesn't name the constraint patches a symptom.
2. **Fix the root cause, simplest change.** Prefer the smallest edit that restores the invariant over
   a broad refactor. Don't add abstractions, features or error handling beyond what's asked.
3. **One source of truth.** Shared logic lives in exactly one place (`model.ts`, `resolve.ts`,
   `mutations.ts`, `keymap.ts`). Two copies that can drift is itself a bug.
4. **Purity is sacred.** The renderer path (`resolve*`) must be a pure function of `(document,
   frame)`. Anything that reads time, randomness or history outside it is forbidden — it breaks
   scrubbing and export at once.
5. **Verify or say unverified.** Typecheck, then confirm in the browser. If you can't run it, label
   the claim **unverified** — never imply a visual result you didn't see.

## 2. The four architectural invariants

These are the load-bearing decisions; violating one is always a bug, never a style choice.

| Invariant | Where | Why |
|---|---|---|
| **Resolver is pure** | [../ARCHITECTURE/RENDERER.md](../ARCHITECTURE/RENDERER.md) | preview == scrub == export |
| **DOM is the only renderer** | [../ARCHITECTURE/RENDERER.md](../ARCHITECTURE/RENDERER.md) | keeps `@sm` engine usable + exportable |
| **Instance is a Node** | [../ARCHITECTURE/DATA_MODEL.md](../ARCHITECTURE/DATA_MODEL.md) | nesting with no parallel model |
| **Every feature is a Command** | [../MODULES/COMMANDS.md](../MODULES/COMMANDS.md) | menus, keys, editor can't drift |

## 3. Studio Mate is read-only

`@sm/…` resolves to `C:/KC_Assets/StudioMate/client/src`. It is imported, never edited. Reuse it
(effects, `BezierEditor`, `tumble`, reflection engine, coords). If a genuine change is needed there,
surface it to the user as a Studio Mate task — do not edit that tree from IntroMate.

## 4. Bug tracker lifecycle (the agent owns it end to end)

Shared tracker at **`http://localhost:4010`**, module **`intromate`**. The agent manages the full
lifecycle — the user does not triage.

```
open ──▶ investigating ──▶ review ──▶ resolved
                    └──▶ wont-fix
```

1. **Register first, work second.** The instant a bug/feature is reported:
   ```
   POST /api/bugs
   { "type":"bug|feature", "module":"intromate", "severity":"low|medium|high",
     "title":"…", "symptom":"what the user sees", "cause":"best current guess",
     "files":["client/src/flash/…"], "tags":["stage","timeline",…] }
   ```
   then immediately `PATCH /api/bugs/BUG-### { "status":"investigating" }` — before reading code.
2. **Learn in place.** Update `cause` and `files` as you understand the root cause.
3. **Deploy → review.** When the fix is in and typechecks:
   `PATCH … { "status":"review", "cause":"root cause", "fix":"what changed", "files":[…] }`.
4. **Verify → resolved.** After confirming on screen (Playwright when asked):
   `PATCH … { "status":"resolved" }`.
5. **One bug per root cause.** Search existing `intromate` bugs (including resolved) before filing;
   don't duplicate. IntroMate's umbrella feature entry is **BUG-837**.

Report bugs even when you also fix them in the same session — the trail is the point. If :4010 is
down, proceed but note that the tracker was unavailable.

## 5. Fix workflow (canonical order)

1. Register in the tracker → `investigating`.
2. Read every relevant file (routing table / tracker `files`).
3. Fix the root cause (§1).
4. `cd client && npx tsc --noEmit -p tsconfig.json`; `cd server && npx tsc --noEmit`.
5. Verify in the browser (Playwright when asked) or label **unverified**.
6. Tracker → `review` → `resolved`.
7. Update the affected [docs/](../) page so the canonical definition stays true.

## 6. Communication & scope

- Provide fixes with minimal preamble; no post-hoc essays. One or two sentence end-of-turn summary.
- Do exactly the requested scope. Flag a concern in a sentence, then deliver under a stated
  assumption; don't silently widen or narrow the task.
- Confirm before destructive git ops or anything visible to others.

## 7. Dev artifacts

Screenshots, probes, one-off scripts → the gitignored `review/` folder only. Never the repo root, a
module folder, or committed.
