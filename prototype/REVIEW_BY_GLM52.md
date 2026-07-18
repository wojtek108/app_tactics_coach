# Code Review — by GLM-5.2

> **Note (2026-07-18):** This review applies to the original v0.1 single-file
> codebase (`index.html` + `app.js` + `stockfish.js`). The project is being
> migrated to Preact + Vite + chessground — see `SPEC.md` §5 for the current
> architecture. Findings below are preserved as a historical reference;
> several have been addressed in the redesigned TODO.md milestones.

Date: 2026-07-18
Scope: Whole project (`index.html`, `app.js`, `README.md`, `stockfish.js`, `files.zip`).

## 1. Project summary

**Socratic Chess Coach** — a local, single-page web app for chess tactics
training. Paste a FEN, Stockfish finds the best move, and the user has to find
it themselves on the board. A four-stage Socratic hint ladder (general
reminder → tactic category → key piece → full move + explanation) replaces the
usual "just show me the answer" pattern.

| File          | Size    | Role                                                        |
|---------------|---------|-------------------------------------------------------------|
| `index.html`  | 3.2 KB  | Page structure, dark-theme CSS                              |
| `app.js`      | 18.7 KB | All app logic: board wiring, engine comms, tactical analyzer|
| `stockfish.js`| 1.6 MB  | Stockfish 10 (GPLv3), unmodified, loaded as a Web Worker    |
| `README.md`   | 3.5 KB  | Usage + licensing                                           |
| `files.zip`   | 340 KB  | Archive of the four files above                             |

External dependencies (all from cdnjs, require internet): jQuery 3.5.1,
chessboard.js 1.0.0, chess.js 0.10.3.

---

## 2. What's good

- **Clean separation of concerns.** Board geometry/attack helpers, engine
  comms, session handling, and the hint ladder are each in their own clearly
  delimited section of `app.js`. The file is easy to navigate top-to-bottom.
- **Defensive engine wiring.** The `file://` detection in `initEngine`
  (`app.js:81`) and the watchdog in `wireEngine` (`app.js:147`) proactively
  catch the two failure modes that silently kill Web Worker apps — blocked
  workers and unresponsive engines — and surface a real message instead of
  leaving the user staring at "Loading engine…".
- **No external image dependency.** `pieceDataUri` (`app.js:31`) renders pieces
  as inline SVG data-URIs of Unicode glyphs. The app is fully self-contained
  apart from the three CDN libraries.
- **Analysis is done on a scratch board.** `analyzeMove` (`app.js:270`)
  constructs its own `new Chess(fen)` so the player's live `game` is never
  disturbed by the tactical breakdown. Good discipline.
- **Documented limitations.** The README honestly calls out that the hint
  engine only sees tactics created by the moved piece's final square, and that
  the search is time-bounded, not depth-bounded. Setting expectations like
  this is rare and welcome.
- **Honest licensing.** Stockfish's GPLv3 status and provenance are spelled
  out, including the exact npm package version.

---

## 3. Findings

Ordered roughly by impact. None of these are show-stoppers; the app works as
described. They're opportunities.

### 3.1 `applySideOverride` FEN padding is fragile — `app.js:330`

```js
function applySideOverride(fen, side) {
    if (side === 'fen') return fen;
    const fields = fen.split(/\s+/);
    while (fields.length < 6) fields.push(fields.length === 3 ? '-' : (fields.length === 2 ? '-' : (fields.length === 4 ? '0' : '1')));
    fields[1] = side;
    fields[3] = '-';
    return fields.join(' ');
}
```

The `while` loop uses a nested ternary to guess the right padding token for
each missing field. This is hard to read and almost certainly wrong for some
inputs:

- It only inspects `fields.length` at the moment of evaluation, so as the loop
  pushes tokens the "what field am I on?" check drifts.
- The guess for field index 5 (fullmove number) uses `'1'` regardless of
  whether the user actually omitted the halfmove clock, which could land the
  `"1"` in the halfmove slot.
- The default-`'1'` branch is also used for any length not specifically tested
  (e.g. `length === 5`), which would write a move number into the halfmove
  clock slot.

**Recommendation:** construct the padded FEN explicitly:

```js
function applySideOverride(fen, side) {
    if (side === 'fen') return fen;
    const fields = fen.split(/\s+/);
    while (fields.length < 4) fields.push(fields.length === 2 ? '-' : '0');
    if (fields.length === 4) fields.push('1');   // halfmove clock default
    if (fields.length === 5) fields.push('1');   // fullmove number default
    fields[1] = side;
    fields[3] = '-';
    return fields.join(' ');
}
```

Or — simpler and more robust — let `chess.js` validate the FEN first and only
flip the side token once we know we have a 6-field FEN.

### 3.2 `files.zip` is committed alongside its own contents

`files.zip` (340 KB) is a compressed archive of the four other files in the
repo, sitting next to those same files. It serves no purpose in the working
tree — it's redundant weight, will drift out of sync the first time any
source file is edited, and confuses anyone trying to figure out "which is the
real `app.js`?".

**Recommendation:** delete `files.zip` from the project. If an archive is
needed for distribution, generate it as a release artifact, not as a tracked
file.

### 3.3 No test coverage for the tactic detector

The pure-logic core of the app — `attackedSquares`, `findPinOrSkewer`,
`isSquareDefended`, `analyzeMove`, `categoryHint`, `explainMove` — is exactly
the kind of code that unit-tests well: deterministic, no DOM, no engine. There
are no tests, no `package.json`, and no test runner configured.

The README explicitly lists the tactic detector's blind spots as "known
limitations." Without tests, regressions in that logic will be invisible.

**Recommendation:** add a tiny Node + `vitest` (or plain `node:test`) setup
and pin a handful of FENs with known tactics — a knight fork, a bishop pin, a
rook skewer, a discovered check, a simple hanging-piece threat. Even five
tests would catch most future breakage in this code.

### 3.4 jQuery is loaded but `app.js` doesn't appear to use it

`index.html:46` loads jQuery 3.5.1 from cdnjs. Scanning `app.js`, every DOM
interaction uses `document.getElementById` / `document.querySelector`, not
`$()`. chessboard.js v1.0.0 does require jQuery internally, so the dependency
is currently load-bearing — but this is worth a comment in the HTML so nobody
"cleans up" jQuery without realizing.

**Recommendation:** add a one-line comment near the jQuery `<script>` tag in
`index.html` noting that it's a transitive dependency of chessboard.js, not
used directly.

### 3.5 Promotion moves: hard-coded `'q'` for the player

In `onMove` (`app.js:463`, `app.js:468`) the player's move always promotes to
a queen:

```js
game.move({ from: source, to: target, promotion: 'q' });
```

If the engine's `targetMove` is an underpromotion (e.g. `e7e8n` for a knight
promotion — rare but real, especially in stalemate-trick positions), the
player has no way to match it: they can only ever underpromote by luck, since
the only legal move they can produce is `e2e8`-style which matches on
from/to squares anyway. So this is mostly fine — the comparison at
`app.js:461` only compares the first four characters — but it does mean the
player can never *play* an underpromotion on the board, only match one.

**Recommendation:** low priority. If touched, consider a small promotion
picker that appears when a pawn reaches the last rank.

### 3.6 `isSquareDefended` is O(board) per call, called inside loops

`isSquareDefended` (`app.js:220`) iterates all 64 squares and calls
`attackedSquares` for each. It's invoked inside the `threat` loop in
`analyzeMove` (`app.js:302`), which itself iterates `attacked` (~up to 27
squares for a queen). So a queen move can trigger ~27 × 64 × ~27 ≈ 47k attack
computations.

For a single-move analysis on a human timescale this is completely fine
(sub-millisecond to a few ms). Mentioning only because if the analyzer is ever
extended to scan candidate moves at depth 1, this will get slow fast.

**Recommendation:** none for now. Revisit if the analyzer is ever used to
score multiple candidate moves.

### 3.7 Watchdog on `startSession` allows generous slack

```js
watchdog = setTimeout(function () { /* timed out */ },
                      MOVETIME_MS + WATCHDOG_MS);  // 4000 + 20000 = 24000ms
```

If Stockfish honors `go movetime 4000`, the 24-second watchdog is 6× the
expected wall-clock. That's a fine safety margin — but a stuck engine means
the user waits almost half a minute before seeing an error. Consider a tighter
bound like `MOVETIME_MS * 2` for the per-position watchdog; keep the 20 s
watchdog only for engine startup.

### 3.8 Minor: `engine.postMessage("stop")` before `ucinewgame` is correct but uncommented

`startSession` (`app.js:373-376`) sends `stop`, then `ucinewgame`, then
`position`, then `go`. The `stop` is there to abort any in-flight search from
a previous session, which is right — but it's the kind of line that looks
redundant and tempts future deletion. A one-line comment ("abort any prior
search before starting a new one") would protect it.

---

## 4. Security / safety

- No user input is passed to `innerHTML` — `setMessage` and `updateStatus`
  both use `innerText`, so FENs pasted by the user are rendered as text, not
  HTML. Good.
- `pieceDataUri` builds an SVG string with `encodeURIComponent` before
  embedding it as a `data:` URI. No injection surface.
- No network calls are made by the app itself; only the CDN libraries and the
  (local, file-served) Stockfish worker are loaded.
- No cookies, localStorage, or service workers are used. There is nothing to
  clear or leak between sessions.

No security concerns found.

---

## 5. Verdict

A small, well-scoped tool that does what it claims. The code is readable, the
failure modes that matter (worker blocked, engine silent) are handled with
real messages, and the README is unusually honest about limitations. The main
improvements available are: tighten `applySideOverride`, delete `files.zip`,
add a handful of unit tests for the tactic detector, and add a couple of
clarifying comments. None of this is urgent — the app works.

Suggested priority order, if any of this is to be acted on:

1. Delete `files.zip` (one command, zero risk).
2. Rewrite `applySideOverride` padding (small, removes a latent bug).
3. Add unit tests for the tactic detector (highest long-term value).
4. Everything else is polish.
