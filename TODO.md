# TODO — Socratic Chess Coach redesign

Milestone task list. Each milestone is independently shippable. See `SPEC.md`
for the *what* and *why* behind each item; see `ARCHITECTURE.md` for design
rationale and architectural decisions.

Status legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked

---

## M1 — Vite + Preact scaffold  `[x]` priority: high — DONE 2026-07-24

Replace the single-file architecture with Vite + Preact + chessground.
**Complete.**

### Scaffold & dependencies
- [x] Scaffold Vite + Preact project in the repo root
- [x] Move `stockfish.js` from `prototype/` into `public/`
- [x] Initialize git repo + baseline commit (done 2026-07-18)
- [x] Add ESLint 9 flat config + Prettier, Preact-compatible (done 2026-07-18)

### Centralized state — DONE 2026-07-24
- [x] `src/context.jsx` — `useReducer` + Preact Context at App level.
      State shape: `{ board, engine, session, feedback, ui }`.
- [x] Dispatch via Context; components read only the slice they need.
      No prop drilling through Board → TrainPanel → socratic.js.
- [x] `app.jsx` wraps content in `<AppProvider>`, `<AppInner>` consumes context.
- [x] `TrainPanel.jsx` reads `feedback` from context, dispatches directly.

### Engine module (Promise-based API) — DONE 2026-07-18
- [x] `src/lib/engine.js` — clean module: `createEngine({ onStatus }) → { ready(), analyze(fen), destroy() }`

### Analyzer module (tested before ported) — DONE 2026-07-18
- [x] Add vitest, port analyzer.js, write 15 tests

### UI components — DONE 2026-07-18
- [x] `src/app.css` — dark theme, layout, tabs, sample-select, buttons
- [x] `src/app.jsx` — top-level component, tab routing, training state coordination
- [x] `src/Board.jsx` — chessground wrapper with training-mode support
- [x] `src/TrainPanel.jsx` — FEN input, side toggle, flip, hint ladder, engine integration

### Error boundary — DONE 2026-07-24
- [x] `<ErrorBoundary>` class component at App root. Fallback: "Something went wrong. Reload the page."

### Cleanup
- [x] **Fix initial board not rendering.** (Fixed 2026-07-22)
- [x] **Fix `applySideOverride` FEN padding** — rewritten to construct FEN field-by-field.
- [x] Delete old `index.html`, `app.js` — done. Root `index.html` is the Vite
      entry. `prototype/` preserved for reference.
- [x] Verify: `npm run dev`, load a FEN, get hints, find the move.

**Status: M1 complete.** Centralized state and error boundary landed 2026-07-24.

---

## M2 — Cburnett piece theme  `[x]` priority: medium

chessground ships with Cburnett built in — this is now a CSS import.

- [x] Import `chessground/assets/chessground.cburnett.css` in `Board.jsx`
- [x] Remove `pieceDataUri` and `PIECE_GLYPHS` from the new codebase (never
      ported — only existed in `prototype/app.js`)
- [x] Add Cburnett attribution (CC-BY-SA) to README (done — verified 2026-07-18)
- [x] Verify rendering at the board's display size; check both colors
      (verified — Cburnett theme renders correctly at 400×400)

---

## M4 — Socratic Train flow  `[x]` priority: high — DONE 2026-07-24

The training loop *is* the product.

### Done (prototype parity — simplified single-pass flow)
- [x] Engine integration: Load Position → Stockfish analyzes → best move found
- [x] Live depth counter during engine search ("Engine thinking… depth 14")
- [x] Move verification: correct move accepted, wrong-but-legal snaps back
- [x] 4-stage hint ladder on "I need a hint":
      1. General CCT reminder
      2. Tactic category (fork, pin, skewer, discovered check, etc.)
      3. Key piece + source square
      4. Full move with explanation
- [x] Post-solve celebration + prompt for next puzzle
- [x] Sample positions dropdown (7 curated tactical FENs)
- [x] FEN input validation (invalid FENs caught, game-over positions rejected)

### Remaining (staged flow from SPEC F1) — DONE 2026-07-24
- [x] **Stage 0 — Board vision (ungraded).** Free-text input: *"What stands
      out? Name two or three things."*
- [x] **Stage 1 — CCT enumeration.** *"List every check and every capture."*
      Click-from/click-to on board. Uses `lib/cct.js` (7 tests).
- [x] **Stage 2 — Candidate evaluation.** *"Which creates the strongest
      threat? What does the opponent do after?"* Engine replies to candidate moves.
- [x] **Stage 3 — Commit.** *"Play the move you think is strongest."*
      Board in commit mode — correct = celebrate, wrong = snap back.
- [x] **Stage 4 — Earned reveal** — DONE (hint ladder)
- [x] **Promotion picker:** Q/R/B/N overlay when a pawn reaches the last rank.
      chessground has no built-in promotion event (ARCHITECTURE was wrong on
      that point) — Board.jsx intercepts the move, snaps back, shows an
      overlay, then commits with the chosen piece. Training compares the full
      UCI including underpromotions (e.g. `e7e8n`). Escape / backdrop cancels.

---

## M5 — Recognition step  `[x]` priority: medium — DONE 2026-07-24

The labeling muscle. Depends on M4 (Stage 3 commit).

- [x] After correct Stage 3 commit, before any explanation, prompt:
      *"What kind of tactic was that?"*
- [x] Multiple-choice options: the correct motif (from `analyzeMove`) plus
      2–3 plausible distractors from the motif list
- [x] **Confirmed motif tags:** on save, show analyzer's detected `motif`
      and let student pick from the full motif list to confirm/override.
- [x] Log `labelCorrect` (true/false) on the attempt
- [x] Only after the student answers (or skips), show the move explanation
- [x] Resist: don't reveal the answer if the student gets it wrong — student
      can skip. The point is producing the label, not being graded.

---

## M3 — Tactics motifs reference  `[x]` priority: high — DONE 2026-07-24

Build the reference tab *after* the training loop is solid.

- [x] Author 12 motifs in `src/motifs.js`, each with:
  `id`, `name`, `category` (tactical|checkmating), `summary`,
  `description`, `exampleFen`, `exampleMoveUci`
- [x] **Initial set:** fork, pin, skewer, discovered-check, double-check,
      deflection, hanging-piece, back-rank-mate, smothered-mate,
      capturing-defender, overloaded, trapped-piece
- [x] Build Motifs tab UI (`src/MotifsView.jsx`): cards with summary, click
      to expand definition + mini board diagram
- [x] Mini diagrams: small 180×180 boards using chessground at reduced size,
      read-only: `Chessground(el, { viewOnly: true, coordinates: false })`
- [x] Click "Train on this position" → loads `exampleFen` into Train mode
      via custom event (`scc:load-fen`)

---

## M6 — Position storage  `[x]` priority: high — DONE 2026-07-24

- [x] `src/storage.js`: CRUD over `localStorage['scc.positions']`
- [x] Position record: `{ id, fen, side, motif, motifConfirmed, notes,
      createdAt, source }` (SPEC F5). `motifConfirmed` is set when the
      student confirms/overrides the auto-detected `motif` on save.
- [x] ID generation: `crypto.randomUUID()`
- [x] At end of Train run, explicit "Save to library" button (never auto-save)
- [x] On save: auto-tag `motif` from `analyzeMove` result, prompt student to
      confirm or override (dropdown of all motif labels), set `motifConfirmed`.
- [x] `source` field: `'manual'` for pasted FENs

---

## M7 — Attempt logging  `[x]` priority: medium — DONE 2026-07-24

Depends on M6 (positions must exist to attach attempts to).

- [x] Extend `storage.js`: CRUD over `localStorage['scc.attempts']`
- [x] Attempt record: `{ id, positionId, date, foundClean, hintsUsed,
      labelCorrect, boardVisionNote, note }` (SPEC F6)
- [x] `foundClean` = true iff `hintsUsed === 0` AND Stage 3 reached
- [x] `hintsUsed`: 0 (clean) · 1 (CCT reminder) · 2 (motif name) · 3 (piece) ·
      4 (full reveal / gave up)
- [x] Log one attempt per Train run against a saved position
- [x] **No computed mastery score.** History is the mark.

---

## M8 — Library view  `[x]` priority: medium — DONE 2026-07-24

Depends on M6 + M7.

- [x] Table of saved positions: thumbnail board, motif tag, last-attempted
      date, attempt count, notes preview
- [x] **Default sort: longest-unseen** (most recent attempt date, or
      `createdAt` if never attempted). The gentle nudge that replaces SR.
- [x] Filters:
  - by motif (dropdown, populated from distinct tags in library)
  - "needs work" — last attempt gave up (`hintsUsed === 4`) or needed ≥3 hints
  - free-text over FEN / notes
- [x] Row actions: Train (loads position into Train tab), Edit (motif/notes),
      Delete (with confirm)
- [x] Empty state: "No positions yet. Train on a FEN and save it, or click a
      motif in the Motifs tab."

---

## M9 — Export / import  `[x]` priority: medium — DONE 2026-07-24

- [x] Export: download `scc-library-YYYY-MM-DD.json` containing both
      `positions` and `attempts` arrays
- [x] Import: file picker, parse JSON, validate shape, merge-by-id (default)
- [x] Export/Import buttons in Library view
- [x] Format documented in storage.js header

---

## Milestone order (revised 2026-07-18)

```
M1 → M2 → M4 → M5 → M3 → M6 → M7 → M8 → M9
```

**Rationale:** M4 (Socratic flow) *is* the product. Building M3 (Motifs),
M6 (Storage), M7 (Logging), M8 (Library), and M9 (Export) before the
training loop works is building scaffolding for a feature that hasn't been
validated. M4 first — validate that the staged flow works pedagogically.
Then build the supporting features around it.

M5 needs the motif vocabulary from M3, but can be tested with 4 hardcoded
motifs. Full M3 content work comes after the training loop is solid.

---

## Resolved decisions

- [x] **Framework:** Preact + Vite + chessground. Decided 2026-07-18.
      See `prototype/` for the original v0.1 app.
- [x] **Board library:** chessground (lichess.org). Replaces chessboard.js.
      No jQuery. Cburnett pieces included as CSS theme.
- [x] **Milestone order:** M4 before M3/M6/M7/M8/M9. Training loop first.
      See ARCHITECTURE.md.
- [x] **State management:** `useReducer` + Context at App level. Decided
      2026-07-18. See ARCHITECTURE.md §1.
- [x] **Engine API:** Promise-based `createEngine()` module. Decided
      2026-07-18. See ARCHITECTURE.md §5.
- [x] **Promotion picker:** included in M4 (done). Custom Q/R/B/N overlay in
      Board.jsx — chessground has no promotion API. See ARCHITECTURE.md §6.
- [x] **Test/lint/format tooling:** Vitest (Vite-native) + ESLint 9 flat
      config + Prettier. Decided 2026-07-18. Preact is treated as
      React-compatible for the react/react-hooks plugins; JSX runtime is
      automatic (no `import React`). Added before porting the analyzer so the
      port could be test-first.

## Open questions (resolved)

- [x] **M3** — motif example provenance: hand-authored. Decided 2026-07-24.
- [x] **M3** — user-provided FEN `K7/4R3/3r4/p7/1k6/3Pb3/2B5/8 b`: dropped
      (not a clean tactic). Decided 2026-07-24.
- [x] **M4** — Stage 1 entry UI: click-to-move. Decided 2026-07-24.
- [x] **M4** — Stage 2 opponent reply: fresh engine search. Decided 2026-07-24.
- [x] **M4** — Stage 0 placement: every session. Decided 2026-07-24.

---

## Stretch / out of current scope

Recorded so they're not forgotten; not in any milestone above.

- Defensive tactics mode ("what is the opponent threatening?") — proposed
  during design, deferred to a possible follow-up spec.
- Position library seeding: a small curated, difficulty-graded starter pack
  beyond the motif examples.
