# Chess Training App — Session Handoff

## Context
Personal chess training app for a ~1700 ELO player. Focuses on **calculation training** — identifying candidate moves, working through lines, and evaluating positions. Uses spaced repetition to target weaknesses. V1 is calculation mode only; tactics drills come later.

## Tech Stack
- **Framework:** React + Vite
- **Chess logic:** `chess.js`
- **Board:** `react-chessboard`
- **Engine:** Lozza (v1, single JS file, trivial integration, 1900+ strength). Upgrade to stockfish-nnue.wasm if deeper analysis needed later.
- **Storage:** IndexedDB (puzzle history, spaced repetition state, weakness database)
- **Project dir:** `/home/wga/Documents/ai-applied/00_ai_agency/05-vibecoding_apps/09_chess_app` (currently empty)

## Puzzle Sources
1. **Lichess puzzle API** — used in calculation mode (not "find one move" tactics; instead: multiple candidates + line evaluation). Infinite supply, difficulty-tagged.
2. **Manual PGN input** — user pastes or uploads PGN files (positions from own games, study material). chess.js parses natively.

## Calculation Mode Flow (v1)
1. Position appears on the board (larger, left side of screen)
2. User types candidate moves in algebraic notation (e.g., `Nf3, d5, Rad1`) — one at a time into an input field at the bottom
3. **Candidate feedback:** Engine checks top N moves. If user missed a **forcing move** (check/capture/threat) in the top 3 engine moves, app flags it immediately: "You missed Bg5 — add it to your candidates." Non-forcing misses are revealed only in final feedback.
4. User works through each candidate line **one move at a time** by typing moves. Each move updates the board.
5. User signals line is done (types `done` or similar command).
6. After all lines, user selects eval from quick-select buttons: =, ±, ±±, +−, −+
7. **Full engine feedback:** Side-by-side comparison — user's lines vs engine lines, eval comparison, where user deviated, what was missed.
8. Interaction/feedback panel on the right side of the screen.

## Screen Layout
```
┌─────────────────────────────────────────┐
│  Chess Training          [Session] [DB] │
├──────────────────────┬──────────────────┤
│                      │  Candidates:      │
│                      │  Nf3, d5, Rad1    │
│     Chess Board      │                  │
│     (large)          │  Current line:    │
│                      │  1. Nf3 d5       │
│                      │  2. g3 Bf5       │
│                      │                  │
│                      │  [Done] [Eval]   │
│                      │                  │
│                      │  Engine feedback  │
│                      │  (after eval)     │
├──────────────────────┴──────────────────┤
│  Input: [type move here] [Enter]        │
└─────────────────────────────────────────┘
```

## Weakness Database (Cross-Cutting)
Tracks blind spots across all training modes (calculation now, tactics later):
- Motif weaknesses (missed intermezzo, back-rank, etc.)
- Calculation errors (stopped too early, wrong candidate priority)
- Evaluation errors (undervalued bishop pairs, misevaluated pawn structures, etc.)
- Feeds spaced repetition — positions with higher failure weight resurface sooner.
- Tags are metadata on every interaction, regardless of mode.

## Spaced Repetition
- Priority: spaced repetition first, speed drills later (add time pressure in v2+)
- Algorithm not yet decided: SM-2 vs simple interval scaling

## Move Input
- **Algebraic notation with fuzzy matching** — lenient on formatting (`O-O` vs `0-0`, `Nf3` vs `N-f3`). Only prompt for clarification when genuinely ambiguous (e.g., two rooks can go to d1). A typo should not cost a correct calculation line.

## What's NOT in v1
- Tactics drill mode (user already uses Chesstempo + Lichess for this)
- Speed/time pressure
- Chesstempo export integration
- Engine-generated positions
- Multi-user support

---

## Remaining Open Questions (Answer These Before Building)

### 1. Session structure
- How many positions per session? Fixed count (e.g., 10 positions)? Timed? User chooses?
- Aagaard recommends starting with easier ones — should the session automatically start with 5–10 easier positions before ramping up, or does the user manually select difficulty?

### 2. Move parsing edge cases
- **Castling:** Accept both `O-O`/`0-0` and `O-O-O`/`0-0-0`?
- **Pawn promotion:** Type `e8=Q`? Or does the app auto-promote to queen with an option to change?
- **Disambiguation:** When two knights can go to f3, does the user type `Ngf3`/`N1f3` (standard algebraic) or does the app ask "which knight?"
- **Corrections:** Can the user delete/undo a typed move mid-line, or is each typed move committed?

### 3. Spaced repetition algorithm
- SM-2 (Anki-style, well-proven, handles item difficulty)?
- Simple interval scaling (e.g., fail → retry tomorrow, pass → double interval)?
- Something custom weighted by the weakness database?

### 4. Weakness DB schema
- What's the tag taxonomy? Free-text tags the user assigns? Predefined categories (motif, phase, piece type, eval error type)? Auto-detected by the engine?
- Example: a failed calculation — does the app tag it as "missed forcing move" automatically, or does the user self-tag after seeing feedback?

### 5. PGN import UX
- Paste PGN text into a textarea?
- File upload (.pgn file)?
- Both?
- How to handle PGN with multiple games — import all positions or let user select?

### 6. "Done" command during calculation
- User types `done` in the move input? Or is there a button?
- What if the user wants to go back and continue a line they marked "done"? Undo capability?
- Can the user reorder their candidate priority after seeing the engine's feedback on candidates?

### 7. Candidate move input UX
- Type all candidates at once, comma-separated (`Nf3, d5, Rad1`)? Or one at a time with an "add" button?
- Can the user remove a candidate before submitting?
- Is there a minimum/maximum number of candidates expected?

---

## Next Session Focus
Build v1 — calculation mode MVP. Scaffold the React app, integrate Lozza, implement the core calculation flow, set up IndexedDB for storing sessions and weaknesses.
