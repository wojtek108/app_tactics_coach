# Socratic Chess Coach

A local, single-purpose training tool: paste a FEN, the engine (Stockfish 10)
finds the best move, and you have to find it on the board yourself — with a
graduated hint ladder that walks through real chess reasoning (checks,
captures, pins, forks, threats) instead of just naming a piece.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Preact** (~3 KB) | Lightweight React-compatible UI. Just enough structure for tabs, state, and components — no more. |
| Build | **Vite** | HMR in dev, static build in production. Zero config. |
| Board | **chessground** (lichess.org) | No jQuery. Built-in move dots, last-move highlight, Cburnett piece theme. GPL-3.0. |
| Game logic | **chess.js** | Move validation, FEN parsing, in_check, game_over. MIT. |
| Engine | **Stockfish 10** (stockfish.js, Web Worker) | GPL-3.0. Unmodified. |
| Tests | **Vitest** | Vite-native test runner. Covers the tactic analyzer. |
| Lint/format | **ESLint 9 + Prettier** | Flat config, Preact-compatible. |

No CDN dependencies, no jQuery. Everything is `npm install` + `import`.

## Running it

**Prerequisites:** Node.js ≥ 18 (for Vite and ES module support).

```bash
cd app_tactics_coach
npm install        # first time only — installs preact, chessground, chess.js, vite
npm run dev        # start dev server with hot reload
```

Open **http://localhost:5173** in your browser.

Changes to any file in `src/` are reflected instantly (HMR). The page
preserves state across reloads — no need to re-paste FENs while tweaking
styles or logic.

**Production build:**

```bash
npm run build      # outputs static files to dist/
```

Serve `dist/` with any HTTP server:

```bash
python3 -m http.server 8000 -d dist/
# or: npx serve dist/
```

The engine (`stockfish.js`) is loaded as a Web Worker — browsers block
workers on `file://`, so always serve over HTTP.

## Development

```bash
npm test           # run the vitest suite in watch mode
npm run test:run   # run once (for CI)
npm run lint       # eslint on src/
npm run format     # prettier --write on src/
```

The tactic analyzer (`src/lib/analyzer.js`) is the only code with test
coverage today — 15 tests across all detected tactic types. Run them before
touching anything chess-logic-related.

## Current status

M1 (Vite + Preact scaffold) is **complete**. M2 (Cburnett piece theme) is
**complete**. M4 (Socratic Train flow) is **complete** — the full staged
flow works: board vision journaling (Stage 0), CCT enumeration via
click-to-move (Stage 1), candidate evaluation with engine replies
(Stage 2), commit to the best move (Stage 3), and the 4-stage hint
ladder as earned reveal (Stage 4). The rewrite has centralized state
(`context.jsx`), an error boundary, a Promise-based engine module, a
tested tactic analyzer (15 tests), a CCT helper (7 tests), and a
promotion picker for underpromotion puzzles.

Still to do: the Motifs tab
(tactical pattern reference), the Library tab (saved positions), and
mobile-responsive layout.

The **"Using it"** flow below describes the current UX. The `prototype/`
has the full jQuery-based v0.1 for reference.

## Using it

1. Wait for **Status: Engine ready**.
2. Pick a sample puzzle from the dropdown, or paste a FEN (from Lichess,
   Chess.com, or anywhere else).
3. Pick whose move it is with the **From FEN / White / Black** toggle if you
   want to override what the FEN says (useful when practicing a position
   from both sides).
4. Click **Load Position** (sample puzzles auto-load). The engine analyzes
   for up to ~4 seconds. The status line shows live depth as it searches.
5. Try to find the best move on the board. Legal-but-wrong moves snap back
   with a nudge to keep looking.
6. Stuck? Click **I need a hint** — it escalates through four stages:
   1. A general reminder to check for checks, captures, and undefended pieces
   2. The specific *category* of tactic present (fork, pin, skewer, etc.)
   3. Which piece is the key one
   4. The full move, with an explanation of why it works
7. When you find it, a celebration message appears and you can pick another
   puzzle.
8. **⇅ Flip** flips the board orientation at any time.

## Licensing

- **stockfish.js** — Stockfish 10, compiled to JS/WebAssembly by Niklas
  Fiekas, distributed under **GPL-3.0**. Included as-is from the npm package
  (`stockfish.js@10.0.2`).
- **chessground** — the Lichess board UI library, **GPL-3.0** (or any later
  version). The Cburnett piece theme is included with chessground (originally
  CC-BY-SA by Colin M.L. Burnett).
- **chess.js** — **MIT**. Game logic only; no board rendering.

Because chessground and Stockfish are both GPL-3.0, the combined work is
distributed under GPL-3.0.

## Known limitations

- The hint engine only recognizes tactics created directly by the moved
  piece's own final square (a fork/pin/direct or discovered check from that
  piece) — it won't catch tactics arising purely from clearing space for a
  *different* piece already on the board, beyond the simple discovered-check
  case, or multi-move combinations.
- Engine search is time-bounded (`movetime`), not depth-bounded, so move
  quality is consistent but not maximal — this is a coaching tool, not a
  full analysis board.
