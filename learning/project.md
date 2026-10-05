# Chess Tactics Coach — Project

## About me

- Knows some Python; wants to learn more through this project.
- Wants to learn the full cycle of AI-assisted software development.
- Goal: deploy the app online and use it personally.
- `chess_coach_v2` was built by an AI tool (unrecalled which one), minimal hands-on typing.
- `chess_coach_v3` (the current target) was produced in a **chat conversation with claude.ai** (not this coding tool) — the learner uploaded some of `chess_coach_v2`'s files and had it write a rewrite. **Not run or tested even once** — this is generated code, not yet demonstrated to work.

## The idea

A web-based chess tactics coach for chess improvers. You paste a position in FEN notation, and an LLM-powered coach guides you through finding the best tactical move via conversation — backed by Stockfish engine analysis. `chess_coach_v3` extends this with multi-ply combinations and head-to-head candidate-move comparison, because the learner wants those to better serve personal use.

## MVP

**Important caveat:** everything under "In" below is a claim from the generated code and its own `HANDOFF.md`, not a verified fact — nothing in `chess_coach_v3` has been executed yet. Section 1 of the forward plan exists specifically to find out which of these claims survive contact with a real run.

### In (claimed, not yet verified)
- Load a chess position from FEN
- Socratic chat coaching via LLM to find the best move
- Multi-ply tactical combinations (auto-plays the opponent's reply, up to 6 plies)
- Candidate-move comparison (2–4 candidate moves compared head-to-head) — new vs. v2
- Server-owned conversation history, with `tool_use`/`tool_result` pairing that (on reading) appears to correctly fix the dangling-tool_use bug that was an open, unresolved issue in `chess_coach_v2`
- Stockfish analysis for correct/incorrect move detection and refutation
- Natural language move interpretation ("I'll take the rook with my pawn")
- Board visualization with square highlighting
- In-memory game sessions

### Frozen (exists but not in active use)
- `database.py` — identical byte-for-byte to `chess_coach_v2`'s copy. Full SQLAlchemy models for positions, sessions, turns, tags; tables created at startup but chat route doesn't write to them.
- Tag taxonomy for tactical themes (pin, fork, skewer, etc.) — seeded, never queried.

### Parking lot
- **`chess_coach_v2/`** — the previous working version, now superseded by v3. Preserved, not deleted; it's how you'll cross-check v3's claims and it's your fallback if v3 turns out to be broken.
- `chess_coach_v2/test_loop.py`, `test_zai.py` — manual test scripts, not carried into v3.
- `bugs_to_fix.md` — flagged the dangling-`tool_use` bug in v2; on first read, v3's code appears to already handle this correctly (unverified — needs a real run to confirm).
- `feedback_from_sonnet5.md` — flagged that `compare_candidate_moves`/`explore_line` tools mentioned in an old `HANDOFF.md` weren't found in v2's `main.py`. v3 claims candidate comparison — worth checking whether this closes that old question.
- Old React/Vite version (archived in `../old-version/`)
- Git history contains deleted React-era files (not yet cleaned up)

## Triage decision

**Adopt.** Same boring, proven stack as v2 (FastAPI, Stockfish via python-chess, SQLAlchemy/SQLite, Anthropic/Z.ai) — nothing exotic, and v2 already proved this stack runs on this machine. The codebase is a coherent rewrite (not a pile of half-built, disconnected features), and the new scope — multi-ply, candidate comparison — was already in the original PRD, not invented scope creep. The one real gap is that it has never been run: that's not a rebuild signal, it's exactly what Section 1 ("make the ground solid") is for.
