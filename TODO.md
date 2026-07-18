# TODO — Socratic Chess Coach redesign

Milestone task list. Each milestone is independently shippable. See `SPEC.md`
for the *what* and *why* behind each item; see `ARCHITECTURE.md` for design
rationale and architectural decisions.

Status legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked

---

## M1 — Vite + Preact scaffold  `[~]` priority: high

Replace the single-file architecture with Vite + Preact + chessground.
**No behavior change** — the app must work identically before and after.

### Scaffold & dependencies
- [x] Scaffold Vite + Preact project in the repo root
- [x] Move `stockfish.js` from `prototype/` into `public/`
- [x] Initialize git repo + baseline commit (done 2026-07-18)
- [x] Add ESLint 9 flat config + Prettier, Preact-compatible (done 2026-07-18)

### Centralized state (do before M4 — cheap now, expensive to retrofit)
- [ ] Add `useReducer` + Preact Context at App level. Single state shape:
  ```
  { board: { fen, orientation, lastMove },
    engine: { status: 'idle'|'loading'|'ready'|'thinking' },
    session: { targetMove, analysis, hintStage, stage } | null,
    ui: { activeTab } }
  ```
- [ ] Pass dispatch via Context; components read only the slice they need.
      No prop drilling through Board → Trainpanel → socratic.js.

### Engine module (Promise-based API)
- [ ] `src/engine.js` — rewrite as a clean module with an explicit lifecycle:
  ```js
  createEngine() → { analyze(fen, movetime) → Promise<{move, fen}> }
  ```
  - Sends `stop` + `ucinewgame` + `position fen` + `go movetime`
  - Returns Promise that resolves on `bestmove`, rejects on timeout
  - Cancels in-flight search on next call (no global `analyzing` flag)
  - Worker path: `new Worker(new URL('stockfish.js', import.meta.url))`

### Analyzer module (tested before ported) — DONE 2026-07-18
- [x] Add vitest: `npm install -D vitest`, add `"test": "vitest"` to package.json
- [x] Port `analyzer.js` from `prototype/app.js` into `src/lib/analyzer.js`:
      `analyzeMove`, `attackedSquares`, `findPinOrSkewer`, `isSquareDefended`,
      `fileRank`, `toSquare`, `findKingSquare` — logic unchanged, relocated and
      ported to chess.js 1.4 (`in_check()` → `inCheck()`).
- [x] Write `src/lib/analyzer.test.js` — 15 tests covering all tactic types
      (direct/discovered check, fork, pin, skewer, capture, threat, positional)
      plus edge cases (promotion, empty from-square, illegal move, mate).
      **Porting note discovered via tests:** chess.js 1.4 *throws* on invalid
      moves (0.10.3 returned `null`). `analyzeMove` wraps `sim.move()` in
      `try/catch` to preserve the null-on-illegal contract callers expect.

### UI components
- [ ] `src/app.css` — all styles (dark theme, layout, tabs)
- [ ] `src/app.jsx` — top-level component, tab routing, Context provider
- [ ] `src/Board.jsx` — chessground wrapper (already implemented; verify wiring)
- [ ] `src/TrainPanel.jsx` — FEN input, side toggle, flip button, hint button

### Error boundary
- [ ] Add `<ErrorBoundary>` at App root using `preact/compat` (or a 15-line
      class component). Fallback: "Something went wrong. Reload the page."
      Prevents white-screen on chessground init failure or worker crash.

### Cleanup
- [ ] **Fix `applySideOverride` FEN padding** (prototype/REVIEW §3.1) — rewrite
      to construct the padded FEN explicitly field-by-field.
- [ ] Delete old `index.html`, `app.js` once the Vite version is confirmed working.
- [ ] Verify: `npm run dev`, load a FEN, get hints, find the move — every
      behavior from the original app still works.

**Definition of done:** behavior-identical to current app, but Preact + Vite +
chessground, with centralized state, tested analyzer, clean engine API,
and an error boundary. No new features. Safety checkpoint before all later work.

---

## M2 — Cburnett piece theme  `[x]` priority: medium

chessground ships with Cburnett built in — this is now a CSS import.

- [x] Import `chessground/assets/chessground.cburnett.css` in `Board.jsx`
- [x] Remove `pieceDataUri` and `PIECE_GLYPHS` from the new codebase (never
      ported — only existed in `prototype/app.js`)
- [x] Add Cburnett attribution (CC-BY-SA) to README (done — verified 2026-07-18)
- [ ] Verify rendering at the board's display size; check both colors

---

## M4 — Socratic Train flow  `[ ]` priority: high  ← MOVED UP

The training loop *is* the product. Build it before the supporting features.
Replace the current guess-the-move UI with the staged flow (SPEC F1).

- [ ] **Stage 0 — Board vision (ungraded).** Free-text input: *"What stands
      out? Name two or three things."* Stored on attempt, never scored.
      Decide: every-session or first-encounter-only (Open Question).
- [ ] **Stage 1 — CCT enumeration.** *"List every check and every capture."*
  - Decide entry UI (Open Question): click-from/click-to on board, or typed.
    **Recommendation:** click-to (discoverable); typed as stretch goal.
  - On submit, show found vs. missed forcing moves. Missing a check is the
    most common tactical blindness — surfacing the miss is the point.
- [ ] **Stage 2 — Candidate evaluation.** *"Which creates the strongest
      threat? What does the opponent do after?"*
  - Let student play a candidate; engine replies with opponent's best move
  - Use fresh `movetime` search (~2s) — simpler, correct for arbitrary moves
- [ ] **Stage 3 — Commit.** *"Play the move you think is strongest."*
  - Correct → flow to M5 (recognition step)
  - Wrong-but-legal → **wrong-move coaching**: show opponent's punishing
    reply instead of snapping back with "try again." Make the cost visible.
- [ ] **Stage 4 — Earned reveal** (behind "I give up" button). Reuses the
      current `categoryHint` / `explainMove` text, telescoped:
      motif → piece → move + explanation.
- [ ] **Promotion picker:** wire chessground's `events.promotion` callback.
      When a pawn reaches the 8th rank, show a small overlay with 4 piece
      buttons (Q/R/B/N). Default to Queen if the user clicks off. ~40 lines.
      Don't defer — chessground makes this easy and underpromotion puzzles
      are pedagogically valuable.
- [ ] Delete the old single-pass `onMove` / `startSession` UI once the staged
      flow replaces it.

---

## M5 — Recognition step  `[ ]` priority: medium

The labeling muscle. Depends on M4 (Stage 3 commit). Motif vocabulary needed
for multiple-choice — hardcode 4 motifs for testing; full M3 comes later.

- [ ] After correct Stage 3 commit, before any explanation, prompt:
      *"What kind of tactic was that?"*
- [ ] Multiple-choice options: the correct motif (from `analyzeMove`) plus
      2–3 plausible distractors from the motif list
- [ ] **Confirmed motif tags:** the analyzer has known blind spots (see README).
      Add `motifConfirmed` field to Position. The recognition step only runs
      if the position has a confirmed tag. On save, show analyzer's guess
      and let the student pick from the full motif list to confirm/override.
- [ ] Log `labelCorrect` (true/false) on the attempt
- [ ] Only after the student answers (or skips), show the move explanation
- [ ] Resist: don't reveal the answer if the student gets it wrong — let
      them try once more, then move on. The point is producing the label,
      not being graded on it.

---

## M3 — Tactics motifs reference  `[ ]` priority: high  ← MOVED DOWN

Build the reference tab *after* the training loop is solid. The training loop
tells you what motifs students actually need help with.

- [ ] Decide provenance of example FENs (Open Question): hand-author for
      control, or pull from Lichess open puzzle database (verify license).
      **Recommendation:** hand-author the first 6, ship, add more as content
      work pays off.
- [ ] Author ~12 motifs in `src/motifs.js`, each with:
  `id`, `name`, `category` (tactical|checkmating), `summary`,
  `description`, `exampleFen`, `exampleMoveUci`
- [ ] **Initial set:** fork, knight-fork, pin-absolute, pin-relative, skewer,
      discovered-attack, discovered-check, double-check, deflection,
      hanging-piece, back-rank-mate, smothered-mate
- [ ] Validate each example FEN with python-chess: the side to move matches,
      the `exampleMoveUci` is legal, and `analyzeMove` (the existing detector)
      classifies it as that motif. **Do not ship an example where the
      analyzer disagrees with the label** — that's a bug in either the
      example or the analyzer, fix it before shipping.
- [ ] Build Motifs tab UI: list with summary, click to expand definition +
      mini board diagram
- [ ] Mini diagrams: small 8×8 boards using chessground at reduced size,
      read-only: `Chessground(el, { viewOnly: true, coordinates: false })`
- [ ] Click-a-diagram → loads `exampleFen` into Train mode
- [ ] **Open issue:** the user-provided FEN `K7/4R3/3r4/p7/1k6/3Pb3/2B5/8 b`
      was proposed as an example. Analysis shows it is **not a clean tactic**
      — `1...Rd8+ 2.Kb7` and black has nothing (the would-be skewer
      `2...Rb8+` just loses to `Kxb8`). Do NOT use it as a motif example.
      Consider using it later as a Stage 0 "what do you notice?" drill or a
      false-pattern CCT exercise.

---

## M6 — Position storage  `[ ]` priority: high

- [ ] `src/storage.js`: CRUD over `localStorage['scc.positions']`
- [ ] Position record: `{ id, fen, side, motif, motifConfirmed, notes,
      createdAt, source }` (SPEC F5). `motifConfirmed` is set when the
      student confirms/overrides the auto-detected `motif` on save.
- [ ] ID generation: `crypto.randomUUID()` (available in all modern browsers)
- [ ] At end of Train run, explicit "Save to library" button (never auto-save)
- [ ] On save: auto-tag `motif` from `analyzeMove` result, prompt student to
      confirm or override (dropdown of all motif labels), set `motifConfirmed`.
      This is what makes the recognition step (M5) trustworthy.
- [ ] `source` field: `'manual'` for pasted FENs, `'motif:<id>'` for examples
      loaded from the Motifs tab

---

## M7 — Attempt logging  `[ ]` priority: medium

Depends on M6 (positions must exist to attach attempts to).

- [ ] Extend `storage.js`: CRUD over `localStorage['scc.attempts']`
- [ ] Attempt record: `{ id, positionId, date, foundClean, hintsUsed,
      labelCorrect, boardVisionNote, note }` (SPEC F6)
- [ ] `foundClean` = true iff `hintsUsed === 0` AND Stage 3 reached
- [ ] `hintsUsed`: 0 (clean) · 1 (CCT reminder) · 2 (motif name) · 3 (piece) ·
      4 (full reveal / gave up)
- [ ] Log one attempt per Train run against a saved position (not against
      ad-hoc FENs that weren't saved)
- [ ] **No computed mastery score.** History is the mark.

---

## M8 — Library view  `[ ]` priority: medium

Depends on M6 + M7.

- [ ] Table of saved positions: thumbnail board, motif tag, last-attempted
      date, attempt count, notes preview
- [ ] **Default sort: longest-unseen** (most recent attempt date, or
      `createdAt` if never attempted). The gentle nudge that replaces SR.
- [ ] Filters:
  - by motif (dropdown, populated from distinct tags in library)
  - "needs work" — last attempt gave up (`hintsUsed === 4`) or needed ≥3 hints
  - free-text over FEN / notes
- [ ] Row actions: Train (loads position into Train tab), Edit (motif/notes),
      Delete (with confirm)
- [ ] Empty state: "No positions yet. Train on a FEN and save it, or click a
      motif in the Motifs tab."

---

## M9 — Export / import  `[ ]` priority: medium

- [ ] Export: download `scc-library-YYYY-MM-DD.json` containing both
      `positions` and `attempts` arrays
- [ ] Import: file picker, parse JSON, validate shape, offer merge-by-id or
      replace-all
- [ ] Add Export/Import buttons to Library view
- [ ] Document the format in README so it's not a black box

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
- [x] **Promotion picker:** included in M4. chessground's `events.promotion`
      callback makes it straightforward. See ARCHITECTURE.md §6.
- [x] **Test/lint/format tooling:** Vitest (Vite-native) + ESLint 9 flat
      config + Prettier. Decided 2026-07-18. Preact is treated as
      React-compatible for the react/react-hooks plugins; JSX runtime is
      automatic (no `import React`). Added before porting the analyzer so the
      port could be test-first.

## Open questions (decide at the relevant milestone)

- [ ] **M3** — motif example provenance: hand-author vs. Lichess DB
- [ ] **M3** — what to do with the user-provided FEN
      `K7/4R3/3r4/p7/1k6/3Pb3/2B5/8 b` (false-pattern drill? drop?)
- [ ] **M4** — Stage 1 entry UI: click-to vs. typed
- [ ] **M4** — Stage 2 opponent reply: fresh search vs. precomputed PV
- [ ] **M4** — Stage 0 placement: every-session vs. first-encounter-only

---

## Stretch / out of current scope

Recorded so they're not forgotten; not in any milestone above.

- Defensive tactics mode ("what is the opponent threatening?") — proposed
  during design, deferred to a possible follow-up spec.
- Position library seeding: a small curated, difficulty-graded starter pack
  beyond the motif examples.
