# Socratic Chess Coach — Redesign Spec

Status: Draft for implementation
Author: GLM-5.2 (synthesizing design conversation with the user)
Last updated: 2026-07-18

> **Architecture decision (2026-07-18):** Preact + Vite + chessground replaces
> the original single-file jQuery/chessboard.js stack. See §5 for the updated
> architecture and `prototype/` for a working spike.

> **Companion files:** `TODO.md` (milestone task list), `ARCHITECTURE.md`
> (design rationale and decisions), and `prototype/REVIEW_BY_GLM52.md`
> (review of the original v0.1 codebase). This spec describes *what* and
> *why*; `ARCHITECTURE.md` records *how* and *why we chose that way*;
> `TODO.md` tracks *what to do next*.

## 1. Background

The current app (`index.html` + `app.js` + `stockfish.js`) works as a
"match-the-engine" trainer: Stockfish picks the best move, you try to find it,
and a four-stage hint ladder walks you toward the answer. The hint ladder
*looks* Socratic but three of its four stages are reveals, not prompts. That
trains answer-matching, not pattern recognition — the opposite of what a
tactics tool should do.

This spec captures a redesign agreed across several design rounds. The goal is
to re-center the app on the student *doing the work*: generating candidates,
enumerating forcing moves, labeling patterns themselves, and accumulating a
personal library of positions whose attempt history they can self-direct
review over.

## 2. Goals

- Train tactics through **questioning**, not answer-revealing.
- Build a **pattern vocabulary** — the student learns motif names by labeling
  tactics themselves, with a reference tab to look up what they don't know.
- Let positions and attempts **accumulate** so the learner can revisit work,
  surface neglected material, and self-direct review.
- **Nicer piece visuals** — now possible since the single-file constraint is
  lifted.
- Stay **local-first, dependency-light** — npm install + npm run dev, nothing else.

## 3. Non-goals (explicit, do not build these)

- No spaced-repetition scheduling. No due dates, no intervals, no SM-2.
  (Decision recorded: SR structurally collapses into answer-recall for chess,
  which fights the training goal.)
- No streaks, no daily goals, no XP, no mastery scores. Anything that shifts
  the user's goal from "learn patterns" to "feed the metric."
- No automatic promotion/demotion of positions based on performance.
- No evaluation bar. Reinforces calculation-first; we want board-vision-first.
- No LLM- or engine-PV-generated move explanations shown by default. The
  student's own words matter; if explanations are always given, the student
  never practices producing them.
- No graded "what do you notice?" free-text step. That step stays journaling.

## 4. Design philosophy: ask, don't tell

Every stage of the training flow should require the student to *produce*
something — a list of candidate moves, a motif label, a committed move.
Revealing the answer is the failure mode, reserved behind an explicit
"I give up." The app's job is to slow the student down and surface what they
missed, not to deliver conclusions.

## 5. Architecture

### 5.1 Project layout

```
app_tactics_coach/
  index.html              Vite entry point, single <div id="app">
  package.json            dependencies: preact, chessground, chess.js, vite
  vite.config.js
  src/
    main.jsx              Preact render entry
    app.jsx               top-level component, tabs, global state
    app.css               all styles
    Board.jsx             chessground wrapper component
    TrainPanel.jsx        Train tab: FEN input, side toggle, hint flow
    engine.js             Stockfish worker comms (extracted from app.js)
    analyzer.js           tactic detection (existing analyzeMove etc.)
    socratic.js           Train-mode staged flow (Stages 0–4)
    motifs.js             motif definitions + example FENs (data)
    motifs-view.js        Motifs reference tab rendering
    storage.js            localStorage CRUD: positions + attempts
    library.js            Library view rendering
  public/
    stockfish.js          unchanged, served as static asset (move from prototype/)
  prototype/              the original v0.1 single-file app (preserved for reference)
    index.html            old page shell, jQuery + chessboard.js
    app.js                old app logic
    stockfish.js          Stockfish 10 (same file, will be copied to public/)
    REVIEW_BY_GLM52.md    code review of the v0.1 codebase
  README.md
  SPEC.md                 this file
```

### 5.2 Module loading

All dependencies are npm packages imported as ES modules via Vite. No CDN
`<script>` tags, no globals, no jQuery. `chess.js` and `chessground` are
imported directly:

```js
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
```

`stockfish.js` lives in `public/` and is loaded as a Web Worker at runtime:

```js
new Worker(new URL('stockfish.js', import.meta.url));
```

The Board component (`Board.jsx`) wraps chessground's imperative API in a
declarative Preact component. See `src/Board.jsx` for the implementation.

### 5.3 Development workflow

```bash
npm install        # first time — installs all dependencies
npm run dev        # start Vite dev server at http://localhost:5173
```

- **Hot reload:** changes to any file in `src/` update instantly in the
  browser. No full page reload — component state survives.
- **Stockfish worker:** loaded from `public/stockfish.js` via
  `new Worker(new URL('stockfish.js', import.meta.url))`. Vite serves
  `public/` files as-is without processing.
- **No environment variables, no API keys, no backend.** The entire app
  runs in the browser. `npm run build` produces static files that work
  from any HTTP server.

### 5.4 Persistence

localStorage, two keys:
- `scc.positions` → `Position[]`
- `scc.attempts` → `Attempt[]`

JSON export/import (see F8) is the backup story; localStorage is not durable
across browser data clears.

### 5.5 Build tooling

**Vite** for both development and production:

- `npm run dev` — dev server with HMR at localhost:5173
- `npm run build` — static build to `dist/`, serve with any HTTP server

No transpile step to configure. Vite handles JSX transformation for Preact
automatically. The production build is a set of static files (HTML, JS, CSS,
and `stockfish.js`) — identical to the original single-file app in deployment
model, just with a one-time `npm run build`.

### 5.6 Board library

**chessground** (lichess.org's board UI) replaces chessboard.js. Key
differences:

| Capability | chessboard.js | chessground |
|---|---|---|
| jQuery dependency | Yes | No |
| Move destination dots | Manual | Built-in (`movable.dests`) |
| Last-move highlight | Manual | Built-in |
| Piece theme | `pieceTheme` callback | CSS class (`cg-wrap` + theme class) |
| Cburnett pieces | Manual SVG files | Included CSS theme |
| Arrows / circles | No | `drawable` module |
| Touch support | No | Yes |
| Bundle size | ~40 KB + jQuery | ~10 KB gzipped |

chessground is imperative (call `.set(config)` to update) — the Board
component wraps this as a Preact component with declarative props.

## 6. Features

### F1 — Socratic Train flow (replaces current single-pass guess)

Each stage is a prompt the student must answer. Revelation happens only at the
final stage, behind an explicit button.

- **Stage 0 — Board vision (ungraded journaling).**
  Prompt: *"Before looking for a move — what stands out? Name two or three
  things about this position."* Free-text input. The app stores the text in
  the attempt but never scores it.

- **Stage 1 — CCT enumeration (the forcing-move muscle).**
  Prompt: *"List every check and every capture available to the side to
  move."* The student enters moves (UI: see Open Questions). The app confirms
  which they found and — critically — **which they missed**. Missing a check
  is the most common cause of tactical blindness; surfacing the miss is the
  point.

- **Stage 2 — Candidate evaluation.**
  Prompt: *"Of those, which creates the strongest threat? What does the
  opponent do after?"* Optional: let the student play a candidate and have the
  engine reply with the opponent's best move, making the line concrete.

- **Stage 3 — Commit.**
  Prompt: *"Play the move you think is strongest."* The student plays on the
  board. Engine confirms or refutes. If refuted, surface *why* — ideally
  pointing back to a forcing move they missed at Stage 1.

- **Stage 4 — Earned reveal (only if stuck).**
  Behind an explicit "I give up" button. The current telescoping hints
  (motif → piece → move + explanation) live here. Reserved as last resort.

The student can complete Stages 0–3 and the recognition step (F2) without ever
touching Stage 4. Doing so is the rep.

### F2 — Recognition step (the labeling muscle)

After the student commits the correct move (Stage 3) — and *before* any
explanation is shown — the app asks:

> "Before I explain — what kind of tactic was that?"
> [fork / pin / skewer / discovered check / double check / hanging piece / …]

Multiple-choice, one correct answer derived from `analyzeMove`. The result is
logged as `labelCorrect` on the attempt. This is the muscle that
generalizes: labeling a fork today helps you see forks in tomorrow's
unfamiliar position.

### F3 — Tactics motifs reference

A tab/view listing tactical motifs with definitions, browsable like a
dictionary. Each entry has:

- name, one-line summary, fuller description
- a **mini diagram** (small 8×8 board) showing the canonical pattern
- the diagram is **clickable** — loads the example FEN into Train mode in one
  click, so the reference doubles as a starter curriculum

**Initial motif set (~12):** fork, knight fork, pin (absolute), pin
(relative), skewer, discovered attack, discovered check, double check,
deflection, hanging piece, back-rank mate, smothered mate. Grow over time;
don't ship all 18+ on day one.

The motif set lives in `src/motifs.js` as data (see §7). Each entry needs a
hand-picked example FEN + the tactic move in UCI. Authoring these is the main
content cost of this feature.

### F4 — Cburnett piece theme

chessground ships with the Cburnett piece theme as a CSS file
(`chessground.cburnett.css`). Enabling it is a one-line import — no SVG files
to manage, no `pieceTheme` callback. This replaces the current inline
Unicode-glyph SVGs (`pieceDataUri` in `app.js`).

The Cburnett set was created by Colin M.L. Burnett (CC-BY-SA). Attribution is
included in the README alongside the Stockfish and chessground notices.

### F5 — Position storage

Saving a position is an **explicit action** at the end of a Train run (a
"Save to library" button), never automatic. This keeps the library curated
instead of a junk drawer of every FEN ever pasted.

Position record:
```typescript
interface Position {
  id: string;          // crypto.randomUUID() or Date.now()+random
  fen: string;         // the FEN trained on (post-side-override)
  side: 'w' | 'b';     // side to move that the student played
  motif: string;       // auto-filled from analyzeMove, editable
  notes?: string;      // optional, student's own
  createdAt: string;   // ISO timestamp
  source?: string;     // 'manual' | 'motif:fork' | URL/free text
}
```

The `motif` field is **auto-tagged** from `analyzeMove`'s detected pattern at
save time. The student can correct it (e.g. analyzer said "fork" but they
disagree it's really a deflection). This tag drives the Library filter (F7)
and is the same vocabulary the recognition step (F2) trains — so getting it
right matters and is worth a confirmation step.

### F6 — Attempt logging

Every Train run on a saved position logs an **attempt** — objective facts
only, never a computed score:

```typescript
interface Attempt {
  id: string;
  positionId: string;
  date: string;                  // ISO timestamp
  foundClean: boolean;           // true iff hintsUsed === 0 and Stage 3 reached
  hintsUsed: number;             // 0–4 (Stage 4 reveal counts as 4)
  labelCorrect: boolean | null;  // null if recognition step was skipped
  boardVisionNote?: string;     // Stage 0 free text, if entered
  note?: string;                 // optional student note
}
```

The attempt history *is* the "mark of effort." The student reads it and
decides what to revisit. Resist computing a "mastery level" — that is SR with
extra steps and pulls toward metric-optimization.

### F7 — Library view

A table of saved positions. Default sort is **longest-unseen** (computed from
the most recent attempt date, or `createdAt` if never attempted) — the gentle
nudge that replaces SR's scheduling without commanding anything. Filters:

- by motif (dropdown)
- "needs work" — last attempt was a give-up (`hintsUsed === 4`) or needed
  ≥3 hints
- free-text search over FEN / notes

Row actions: load into Train, edit tags/notes, delete (with confirm). Click
row → Train mode with that position.

### F8 — Export / import

- **Export:** download `scc-library-YYYY-MM-DD.json` containing both
  `positions` and `attempts` arrays.
- **Import:** upload JSON, choose merge-by-id or replace-all.

This is the backup story and the only way out of a browser data clear. Build
it early — the library becomes valuable fast and you don't want it locked in.

## 7. Data model (consolidated)

```typescript
// src/motifs.js — static data
interface Motif {
  id: string;            // 'knight-fork'
  name: string;          // 'Knight Fork'
  category: 'tactical' | 'checkmating';
  summary: string;       // one-line definition
  description: string;   // fuller explanation
  exampleFen: string;    // canonical example position
  exampleMoveUci: string;// the tactic move in that position, e.g. 'e4f6'
}

// storage — persisted to localStorage
interface Position { /* see F5 */ }
interface Attempt  { /* see F6 */ }
```

## 8. UI structure (top-level)

Three tabs (or views — implementation choice):

- **Train** — the Socratic flow (F1, F2). Default landing.
- **Motifs** — the reference (F3).
- **Library** — saved positions + attempts (F5, F6, F7, F8).

Tab bar across the top of the panel. The board stays visible above the panel
in all tabs (board is the constant; the panel below swaps).

## 9. Ship order

The milestone-by-milestone plan, with what-to-do-next detail, lives in
**`TODO.md`**. Each milestone is independently shippable; M1 unblocks the
rest by removing the single-file constraint.

## 10. Open questions (decide before or during the relevant milestone)

- **Stage 1 entry UI.** Typed algebraic (`Nf6`), typed UCI (`e4f6`), or
  click-from-then-click-to on the board? Click-to is most discoverable; typed
  is faster for experienced users. Recommendation: click-to, with typed input
  as a stretch goal.
- **Stage 2 engine reply.** When the student plays a candidate and asks
  "what does the opponent do?", do we spin a fresh `movetime` search (~4s) or
  use the engine's already-computed PV? PV is instant but assumes the
  candidate matches the PV's first move.
- **Stage 0 placement.** Does free-text board-vision journaling happen every
  session, or only on first encounter with a position? Every session is more
  disciplined; first-encounter-only avoids fatigue.
- **Motif example provenance.** Hand-compose FENs (full control, slow) or
  pull from Lichess's open puzzle database (faster, licensing check needed)?
- **Promotion picker.** Still outstanding from the review — underpromotion
  currently impossible from the board. Decide whether to address as part of
  M4 (it touches the move handler).
- **Defensive tactics mode.** "What is the opponent threatening?" was
  proposed but not in this spec's scope. Consider a follow-up spec.

## 11. Relationship to existing code

What stays, what moves, what goes:

- `analyzeMove`, `attackedSquares`, `findPinOrSkewer`, `isSquareDefended`,
  `fileRank`, `toSquare`, `findKingSquare` → `src/analyzer.js` (unchanged
  logic, just relocated). These are the most valuable code in the repo —
  they drive auto-tagging (F5) and the recognition step's correct answer
  (F2).
- Engine comms (`initEngine`, `wireEngine`, watchdog logic) →
  `src/engine.js`.
- `startSession`, `onMove`, `giveHint`, `categoryHint`, `explainMove` →
  rewritten as the staged flow in `src/socratic.js`. The old hint ladder text
  survives largely intact inside Stage 4.
- `applySideOverride` → fix per review §3.1 during M1 (small, do it while
  touching the code).
- `pieceDataUri` and `PIECE_GLYPHS` → deleted in M2 (replaced by chessground's Cburnett CSS theme).
- `chessboard.js` + jQuery CDN scripts → removed (replaced by chessground, imported as npm package).
- `files.zip` → deleted. Review §3.2.
