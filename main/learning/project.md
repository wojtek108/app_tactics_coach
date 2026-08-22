# Chess Tactics Coach — Project

## About me

- Knows some Python; wants to learn more through this project.
- Wants to learn the full cycle of AI-assisted software development.
- Goal: deploy the app online and use it personally.
- The app was built by an AI tool (unrecalled which one). Minimal hands-on typing during creation.

## The idea

A web-based chess tactics coach for chess improvers. You paste a position in FEN notation, and an LLM-powered coach guides you through finding the best tactical move via conversation — backed by Stockfish engine analysis.

## MVP

### In (working today)
- Load a chess position from FEN
- Socratic chat coaching via LLM to find the best move
- Multi-ply tactical lines (coach keeps you solving your side's moves)
- Stockfish analysis for correct/incorrect move detection and refutation
- Board visualization with square highlighting
- Natural language move interpretation ("I'll take the rook with my pawn")
- In-memory game sessions

### Frozen (exists but not in active use)
- `database.py` — full SQLAlchemy models for positions, sessions, turns, tags (tables are created at startup but the chat route doesn't write to them)
- Tag taxonomy for tactical themes (pin, fork, skewer, etc. — seeded at startup but never queried during a session)
- `test_loop.py`, `test_zai.py` — manual test scripts (not a test suite)

### Parking lot
- Old React/Vite version (archived in `../old-version/` — preserved, not deleted)
- Git history contains deleted React-era files (not yet cleaned up)

## Triage decision

**Adopt.** The app runs, the codebase is small (5 Python files + 1 HTML), and the MVP is coherent. The main improvement area (coaching quality) is an iteration target, not a rebuild signal. No trimming or rebuilding needed.
