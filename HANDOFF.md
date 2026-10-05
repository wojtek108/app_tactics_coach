# Chess Tactics Coach — Agent Handoff

## What This Is

A single-user web app that turns static chess positions (pasted as FEN) into
Socratic coaching sessions. The student loads a position, answers open-ended
questions from an LLM coach, and is guided toward discovering the best move
themselves — the coach never gives the answer unless asked. The engine
(Stockfish) provides ground truth; the LLM provides the pedagogy.

The app supports **multi-ply combinations**: after the student finds the
first move, the opponent's reply is auto-played, and the student is prompted
for the next move in the line (up to 6 plies).

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend | Python 3.13 + FastAPI | Single-file `main.py` |
| Engine | Stockfish (UCI via `python-chess`) | Single persistent process, pooled across requests |
| LLM | Anthropic Claude or Z.ai (configurable per role) | Two roles: `coach` (Socratic dialogue) and `nl_interpreter` (move parsing fallback) |
| DB | SQLite via SQLAlchemy | Tables exist (positions, sessions, turns, tags) but are not yet written to during sessions |
| Frontend | Single HTML file + cm-chessboard (CDN) | Minimal SPA, dark theme, no build step |
| Chess logic | `python-chess` library | FEN parsing, move legality, SAN parsing, pin/hanging-piece detection |

## File Map

```
main/chess_coach_v2/
├── main.py            # FastAPI app: routes, session state, LLM tool loop, move extraction
├── engine_service.py  # Stockfish wrapper: analyze_position(), refute_move(), structural signals
├── llm_client.py      # Provider-agnostic LLM client (Anthropic + Z.ai), tool call normalization
├── database.py        # SQLAlchemy models + tag seeding (schema ready, not yet used at runtime)
├── static/index.html  # Frontend SPA (board + chat panel)
├── .env               # API keys and model config
├── start.sh           # uvicorn launcher
└── pyproject.toml     # Python dependencies
```

## How the Coaching Loop Works

### 1. Student loads a position

- Frontend sends `POST /session/start { fen }`
- Backend validates FEN, runs Stockfish (depth 20, MultiPV 3), creates an
  in-memory `GameSession` keyed by `session_id`
- Frontend shows the board and a hardcoded opener: *"What do you notice about
  this position?"*
- The LLM is NOT involved in the opener — coaching starts on the student's
  first reply

### 2. Student types an answer

- Frontend sends `POST /chat { session_id, user_message }`
- Backend does these things in order:

  **a) Engine analysis (every turn)**
  - Runs Stockfish fresh against the current board state (depth 18, 1s cap)
  - Extracts: best move, eval (White POV, centipawns), top 3 candidate lines,
    hanging pieces, undervalued targets, pins
  - All of this is injected into the LLM prompt as `prompt_context`

  **b) Move extraction (in code, never by the LLM)**
  - Three-stage extraction pipeline:
    1. `extract_candidate_move()` — regex-based SAN parsing + bare-square
       disambiguation (e.g. student types "d3" and only one piece can reach d3)
    2. `interpret_natural_language_move()` — LLM fallback for free-form
       English ("I'll take the rook with my pawn"), constrained via enum to
       actual legal moves so it structurally cannot return an illegal move
  - The extracted candidate is compared to Stockfish's `best_move_san`
    in plain Python — **move correctness is never delegated to the LLM**

  **c) If the student found the best move:**
  - The move is applied to the board, material delta is recorded
  - The opponent's best reply is auto-played (Stockfish depth 18)
  - The student is prompted for their next move in the line
  - After 6 solved plies or game-over, the line is marked complete

  **d) If the student proposed a wrong move:**
  - `refute_move()` runs a quick Stockfish search on the resulting position
    and returns the opponent's best reply + eval swing
  - This refutation data goes into `prompt_context` so the coach can explain
    *why* the move fails

  **e) LLM coaching call**
  - The full `prompt_context` (engine analysis + move validation results +
    plies solved so far) is prepended to the student's message and appended
    to the server-side conversation history (`session.messages`)
  - The LLM receives: system prompt + full accumulated message history + tools
  - Three tools are offered:
    - `check_square` — returns attackers/defenders for a given square
      (runs on a scratch board copy, never the real board)
    - `try_hypothetical_move` — applies a move hypothetically, returns material
      info **and runs a real Stockfish search** on the result (via `refute_move`)
    - `respond_with_coaching` — must be called last, returns the coaching text
      + squares to highlight on the board
  - The tool loop runs up to 5 iterations: the LLM can call verification
    tools first, then `respond_with_coaching` to produce the final reply
  - All intermediate tool calls and results are persisted in `session.messages`

  **f) Response**
  - Returns: `assistant_reply`, `highlight_squares`, `user_solved_this_turn`,
    `fen` (current board state), `line_complete`
  - Frontend redraws the board from the returned FEN and highlights squares

### 3. Conversation history is server-owned

- The `GameSession.messages` list stores the complete LLM conversation
  history, including engine context blocks and all intermediate tool call/result
  pairs
- The frontend only sends `{ session_id, user_message }` — no history
- This ensures engine context persists across turns (the model always sees
  the current position's full tactical picture) and eliminates the fragile
  coupling of the frontend having to faithfully replay the entire transcript

## LLM Provider Configuration

Set via env vars (see `.env`): each role (`coach`, `nl_interpreter`) can use
a different provider/model:

```
COACH_PROVIDER=anthropic|zai
COACH_MODEL=claude-sonnet-5|glm-5.1
NL_INTERPRETER_PROVIDER=zai
NL_INTERPRETER_MODEL=glm-4.7
```

`llm_client.py` abstracts both providers behind a normalized `ToolCallResult`.
Anthropic uses the native Messages API with tool_use blocks; Z.ai uses the
OpenAI-compatible chat completions endpoint (two distinct base URLs depending
on account type — configured via `ZAI_BASE_URL`).

## Engine Service Details

- **Single persistent Stockfish process** (started at app startup, reused
  across requests — no per-request `popen_uci`/`quit`)
- **Crash recovery**: `_analyse_with_retry` catches `EngineTerminatedError`
  and restarts the engine once before retrying (pre-flight health checks via
  `transport.is_closing()` don't work — verified against actual SIGKILL)
- **Structural signals** (computed by `python-chess`, not hand-rolled):
  - `hanging_pieces` — pieces where attackers > defenders
  - `undervalued_targets` — pieces attacked by something worth less (catches
    cases like a pawn attacking a defended rook where attacker/defender counts
    are equal but the trade is still winning)
  - `pins` — uses `board.is_pinned()` (not naive rank/file/diagonal matching,
    which flagged nearly every piece)
- **`refute_move(fen, move_san)`** — applies the proposed move, runs a quick
  search (depth 12, 0.5s), returns the opponent's best reply + eval

## Database

Tables exist (`positions`, `sessions`, `turns`, `tags`, `position_tags`) with
a seeded tag taxonomy of 20 core tactical themes. **Sessions are not yet
written to the database** — this is a known gap for the future dashboard
(Phase 2 in the PRD). See `chess-tactics-coach-prd.md` for the full schema
and planned dashboard.

## What Was Just Changed (Grilling Session)

See `GRILLING_SESSION.md` for the full decision log. Summary of what changed
and why:

1. **Full engine analysis now flows to the LLM every turn.** Previously only
   `best_move_san` (a bare string) was injected. Now `eval_cp_white_pov`,
   `multipv` (top 3 lines), and all `structural_signals` (hanging pieces,
   undervalued targets, pins) are included in `prompt_context`.

2. **Conversation history is server-owned.** `GameSession` now has a `messages`
   field. The frontend no longer sends `conversation_history` — it just sends
   `{ session_id, user_message }`. Engine context blocks persist across turns
   because they're stored in `session.messages` alongside the dialogue.

3. **`try_hypothetical_move` runs a real engine search.** Previously it only
   returned static material balance. Now it also calls `engine_svc.refute_move()`
   and returns `engine_eval_after_move_cp_white_pov` and
   `engine_best_reply_san` — so the model can give engine-grounded answers
   to student "what if" questions.

## Known Gaps / Future Work

- **Sessions not persisted to DB** — the schema is ready but nothing writes to
  it yet. Needed for the dashboard (per-tag solve rates, session history).
- **No auth** — PRD says to gate at the proxy layer (Cloudflare Zero Trust)
  before exposing to the open internet.
- **No dashboard** — Phase 2 in the PRD: session history list + per-tag
  aggregate stats.
- **Tagging not implemented** — the LLM doesn't yet assign tactical theme
  tags at session close. The tag taxonomy is seeded in the DB.
- **No spaced repetition** — Phase 3 in the PRD.
