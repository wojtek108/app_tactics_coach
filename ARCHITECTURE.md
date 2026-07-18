# Architecture Review — Socratic Chess Coach

Date: 2026-07-18
Author: Claude (design review of the Preact + Vite + chessground migration)

> **Companion files:** `SPEC.md` (what & why), `TODO.md` (milestone task list),
> `README.md` (user-facing docs). This document records architectural decisions,
> tradeoffs, and rationale that don't fit cleanly into the spec or task list.

---

## 0. Stack decision (resolved)

**Preact + Vite + chessground + chess.js + Stockfish 10.**

The original single-file jQuery/chessboard.js app (`prototype/`) was a good
v0.1. Moving to a component-based architecture was inevitable once the scope
grew beyond ~300 lines. The spike proved chessground integrates cleanly with
Preact — no jQuery fights, no CDN `<script>` tags, everything is `import`.

| What we left behind | Why |
|---|---|
| Single-file architecture | 9 milestones won't fit in one file |
| jQuery + chessboard.js | jQuery fights virtual DOM; chessground is GPL-3.0, 10 KB, no deps |
| CDN `<script>` tags | npm imports give version pinning, tree-shaking, HMR |
| "No build step" | Vite gives HMR + static build with zero config cost |

---

## 1. Centralized state: useReducer + Context

**Decision:** Single `useReducer` at App level, exposed via Preact Context.

**Why:** The Socratic flow (M4) involves 5 stages that all read and write
shared state — the board FEN, the engine's best move, the current hint stage,
session progress. Prop-drilling this through Board → TrainPanel → socratic
stages would create a spiderweb of 15+ prop passthroughs.

**State shape:**

```js
{
  board: {
    fen: string,
    orientation: 'white' | 'black',
    lastMove: [string, string] | null,
  },
  engine: {
    status: 'idle' | 'loading' | 'ready' | 'thinking',
  },
  session: {
    targetMove: string | null,
    analysis: object | null,
    hintStage: number,          // 1-4
    socraticStage: number,       // 0-4
  } | null,
  ui: {
    activeTab: 'train' | 'motifs' | 'library',
  },
}
```

**Cost:** ~30 lines of boilerplate (reducer + Context provider + one custom
hook). **Benefit:** prevents ~200 lines of prop-wiring and state-sync bugs.
Do in M1 while the component tree is flat.

---

## 2. Milestone reordering: training loop first

**Decision:** M1 → M2 → M4 → M5 → M3 → M6 → M7 → M8 → M9

**Why the original order was risky:** M3 (Motifs reference), M6 (Storage),
M7 (Logging), M8 (Library), M9 (Export) are all supporting features. They
have zero value if the training loop doesn't work. Building them before M4
bets 5 milestones of work on an untested pedagogical design.

The Socratic flow (M4) is where you learn whether:
- Stage 1 CCT enumeration is too friction-heavy with click-to-move
- Stage 2 candidate evaluation with engine replies feels useful or tedious
- Stage 3 wrong-move coaching is actually helpful
- The whole flow is too long and students drop off at Stage 2

If any of those fail, you iterate on M4. If M4 fails while M3/M6/M7/M8 are
already built, you have 5 milestones of code that need rework.

**M5 dependency on M3:** The recognition step needs motif labels for
multiple-choice. Hardcode 4 motifs for M5 testing (fork, pin, skewer,
hanging piece). Full M3 content work comes after the training loop is solid.

---

## 3. Confirmed motif tags (defensive against analyzer blind spots)

**Decision:** Add `motifConfirmed` field to Position. The recognition step
(M5) only runs against positions with confirmed tags.

**Problem:** The analyzer (`analyzeMove`) only detects tactics created by
the moved piece's own final square. It misses:
- Clearance sacrifices (piece moves, different piece delivers the tactic)
- Interference moves
- Decoys where the first move is quiet and the second is the tactic
- Multi-move combinations

If the app quizzes the student on a label the analyzer got wrong, it damages
trust. "Why did it say this was a fork? It's clearly a deflection."

**Solution:**

1. On save, show the analyzer's detected `motif` and let the student pick
   from the full motif list to confirm or override.
2. Store both `motif` (auto-detected) and `motifConfirmed` (student's choice,
   or null if not yet confirmed).
3. The recognition step (M5) only runs if `motifConfirmed` is set.
4. Over time, the student's library accumulates verified labels. The app
   never quizzes on a label it's not confident about.

This also teaches the student to evaluate the analyzer's judgment — which is
itself a pattern-recognition exercise.

---

## 4. Analyzer tests (vitest)

**Decision:** `src/analyzer.test.js` with 8 FENs, set up before porting the
analyzer in M1.

**Why now:** The analyzer is ~150 lines of pure functions — deterministic,
no DOM, no engine. It's the easiest code in the project to test and the most
consequential when it breaks. If `analyzeMove` misclassifies a fork as
"positional", every downstream feature (auto-tagging, recognition step, hint
category) silently degrades.

**Test cases:**

| Test | FEN characteristic |
|---|---|
| Knight fork | Knight lands on a square attacking two pieces |
| Bishop pin (absolute) | Bishop pins a piece to the king |
| Rook skewer | Rook attacks a piece with a more valuable piece behind |
| Discovered check | Moving piece uncovers check from another |
| Double check | Moving piece gives check while uncovering a second check |
| Hanging piece threat | Move creates an undefended threat |
| Capture with check | Simple capture that also delivers check |
| Quiet positional move | No tactic detected — verifies the "no tactic" path |

**Setup:** `npm install -D vitest`, add `"test": "vitest"` to package.json.
Run with `npm test`. Each test: construct a `Chess` instance from FEN, make
the tactic move, call `analyzeMove(newFen, move)`, assert the expected
tactic category.

---

## 5. Engine module: Promise-based API

**Decision:** Rewrite the engine communication as a clean module with an
explicit Promise-based API, rather than the current event-driven approach.

**Current problems with the event-driven approach:**

- Global `analyzing` flag that multiple event handlers toggle
- Watchdog timers scattered across `wireEngine` and `startSession`
- Session state (`targetMove`, `analysis`) lives in module scope, not in the
  component tree
- Hard to test — you can't `await` an engine analysis, you have to set up
  callbacks and wait

**Proposed API:**

```js
// src/engine.js
export function createEngine() {
  const worker = new Worker(new URL('stockfish.js', import.meta.url));

  // Initialization: send uci, wait for uciok + readyok
  const ready = initWorker(worker);

  return {
    ready,  // Promise<void> — resolves when engine is initialized
    analyze(fen, movetime = 4000) {
      // 1. Send stop (abort any in-flight search)
      // 2. Send ucinewgame + position fen + go movetime
      // 3. Return Promise that resolves with { move, fen } on bestmove
      // 4. Reject if no response within movetime + 5000ms
      return new Promise((resolve, reject) => { ... });
    },
  };
}
```

**Usage in TrainPanel:**

```js
const engine = useEngine();  // from Context

async function loadPosition(fen) {
  dispatch({ type: 'ENGINE_STATUS', status: 'thinking' });
  try {
    const { move } = await engine.analyze(fen);
    const analysis = analyzeMove(fen, move);
    dispatch({ type: 'SESSION_START', targetMove: move, analysis });
  } catch (err) {
    dispatch({ type: 'ENGINE_ERROR', error: err.message });
  }
}
```

This collapses `initEngine`, `wireEngine`, `startSession`, and the watchdog
logic into a single module with a clear contract. The Promise naturally
handles the async flow that currently lives in scattered `onmessage`
handlers.

---

## 6. Promotion picker

**Decision:** Wire chessground's `events.promotion` callback in M4. Do not
defer.

**Why:** chessground has a built-in promotion mechanism — you supply a
callback that returns the chosen piece. This was impractical with
chessboard.js (hardcoded `'q'`), but chessground makes it straightforward.

**Implementation (~40 lines):**

```js
// In chessground config
events: {
  promotion: (orig, dest, piece) => {
    // Show overlay with 4 buttons (Q, R, B, N)
    // Return a Promise that resolves when the user picks
    return new Promise((resolve) => {
      showPromotionOverlay(dest, resolve);
    });
  },
}
```

Default to Queen if the user clicks off the overlay. This removes a real
training defect — underpromotion puzzles (stalemate tricks, knight-promotion
mates) exist and are pedagogically valuable.

---

## 7. Error boundary

**Decision:** Add an `<ErrorBoundary>` at the App root in M1.

**Why:** If chessground fails to initialize (missing CSS, DOM collision) or
the Stockfish worker throws an unhandled error, Preact unmounts the entire
component tree. The user sees a white screen with no indication of what
happened.

**Implementation:** Use `preact/compat`'s `ComponentDidCatch` or write a
15-line class component:

```jsx
class ErrorBoundary extends Component {
  state = { error: null };
  componentDidCatch(error) { this.setState({ error }); }
  render() {
    if (this.state.error) {
      return <div class="panel"><p>Something went wrong. Reload the page.</p></div>;
    }
    return this.props.children;
  }
}
```

Cost: ~15 lines. Risk of not having it: unrecoverable white screen on an
unhandled error in any component.

---

## 8. File layout (current state)

```
app_tactics_coach/
  index.html              Vite entry point
  package.json            preact, chessground, chess.js, vite
  vite.config.js
  src/
    main.jsx              Preact render entry
    app.jsx               top-level component, tabs, Context provider
    app.css               all styles (dark theme, layout, tabs)
    index.css             reset / base styles
    Board.jsx             chessground wrapper component
    TrainPanel.jsx        Train tab: FEN input, side toggle, hint flow
    engine.js             Promise-based Stockfish worker API
    analyzer.js           tactic detection (ported from v0.1)
    analyzer.test.js      vitest test suite (8 FENs)
    socratic.js           Train-mode staged flow (Stages 0–4)
    motifs.js             motif definitions + example FENs (data)
    motifs-view.js        Motifs reference tab rendering
    storage.js            localStorage CRUD: positions + attempts
    library.js            Library view rendering
  public/
    stockfish.js          Stockfish 10 (GPL-3.0), served as static asset
  prototype/              original v0.1 single-file app (preserved for reference)
    index.html            old jQuery + chessboard.js app
    app.js                old app logic
    stockfish.js          Stockfish 10 (same file as public/)
    REVIEW_BY_GLM52.md    code review of the v0.1 codebase
  ARCHITECTURE.md         this file
  README.md               user-facing docs
  SPEC.md                 what & why
  TODO.md                 milestone task list
```

---

## 9. Non-decisions (things we're deliberately not doing)

- **No React.** Preact gives us the same component model at 3 KB vs 40 KB.
  We don't need React's full ecosystem (Server Components, Suspense, etc.)
  for a local single-page app with 10 components.
- **No TypeScript.** The app is small, the analyzer is the only complex pure
  logic, and vitest tests cover it. TS would add a build complexity layer
  without proportional benefit at this scale. Revisit if the codebase exceeds
  ~2,000 lines.
- **No CSS framework.** Dark theme is ~100 lines of hand-written CSS. Tailwind
  or similar adds a build step and configuration for a styling problem we
  don't have.
- **No router.** Three tabs with `useState` is simpler than pulling in
  `preact-router` for what is effectively a tab bar.
