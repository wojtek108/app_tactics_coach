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

**Decision:** `src/lib/analyzer.test.js` with 15 tests, written test-first
before porting the analyzer from the prototype. **Done 2026-07-18.**

**Why first:** The analyzer is ~150 lines of pure functions — deterministic,
no DOM, no engine. It's the easiest code in the project to test and the most
consequential when it breaks. If `analyzeMove` misclassifies a fork as
"positional", every downstream feature (auto-tagging, recognition step, hint
category) silently degrades.

**Test coverage (current):**

| Tactic | FEN characteristic |
|---|---|
| Direct check | Move delivers check from the moved piece |
| Discovered check | Moving piece uncovers check from another |
| Knight fork | Knight lands on a square attacking two pieces |
| Pin to king | Sliding piece pins an enemy piece to the king |
| Skewer | Sliding piece attacks a weaker front piece with a stronger one behind |
| Capture | Move captures an enemy piece |
| Hanging-piece threat | Move attacks an undefended enemy piece |
| Quiet positional move | No tactic detected — verifies the "no tactic" path |

Plus edge cases: promotion move, empty from-square (returns null), illegal
move (returns null), and a checkmating move. Plus unit tests on the geometry
helpers (`attackedSquares`, `findPinOrSkewer`).

**Porting finding (chess.js 1.4 behavior change):** The test-first approach
caught a real porting hazard. chess.js 0.10.3 (used by the prototype)
returned `null` from `Chess.move()` on an illegal move; chess.js 1.4
**throws**. The analyzer's `if (!moveResult) return null` defensive path
would have silently broken on any illegal/garbage input. Fixed in
`src/lib/analyzer.js` by wrapping `sim.move()` in `try/catch` to preserve
the null-on-illegal contract callers rely on. This is the kind of finding
that justified doing foundations before the port.

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

**Decision:** Custom Q/R/B/N overlay in `Board.jsx` (M4). Done.

**Correction:** chessground has **no** `events.promotion` callback — it is
board-UI only and just moves pieces visually. Promotion is entirely the
app's job (ARCHITECTURE originally claimed otherwise).

**Implementation:**
1. On `events.move`, detect pawn-to-last-rank via chess.js.
2. Snap the board back to the pre-move FEN and open a picker overlay.
3. On piece pick, commit with `game.move({ from, to, promotion })` and
   compare the full UCI (e.g. `e7e8n`) against the engine target.
4. Escape / backdrop click cancels (user re-moves the pawn).

This removes a real training defect — underpromotion puzzles (stalemate
tricks, knight-promotion mates) exist and are pedagogically valuable.

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

## 8. File layout (current state, updated 2026-07-18)

Files marked **(M1)** exist now; files marked **(planned)** don't yet —
they're the target layout from the milestones below. See `TODO.md` for which
milestone each planned file belongs to.

```
app_tactics_coach/
  index.html              Vite entry point (M1)
  package.json            preact, chessground, chess.js, vite; vitest/eslint/prettier (M1)
  vite.config.js          (M1)
  eslint.config.js        ESLint 9 flat config, Preact-compatible (M1)
  .prettierrc.json        (M1)
  src/
    main.jsx              Preact render entry (M1)
    app.jsx               top-level component, tabs (M1; Context provider planned)
    app.css               all styles (dark theme, layout, tabs) (M1)
    index.css             reset / base styles (M1)
    Board.jsx             chessground wrapper component (M1)
    TrainPanel.jsx        Train tab: FEN input, side toggle, hint button (M1, partial)
    lib/
      analyzer.js         tactic detection, ported from v0.1 (M1)
      analyzer.test.js    vitest suite, 15 tests (M1)
    engine.js             Promise-based Stockfish worker API (planned, M1)
    socratic.js           Train-mode staged flow, Stages 0–4 (planned, M4)
    motifs.js             motif definitions + example FENs (planned, M3)
    motifs-view.js        Motifs reference tab rendering (planned, M3)
    storage.js            localStorage CRUD: positions + attempts (planned, M6)
    library.js            Library view rendering (planned, M8)
  public/
    stockfish.js          Stockfish 10 (GPL-3.0), served as static asset (M1)
  prototype/              original v0.1 single-file app (preserved for reference)
    index.html            old jQuery + chessboard.js app
    app.js                old app logic
    stockfish.js          Stockfish 10 (byte-identical to public/ — known wart)
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
