# Chess Tactics Coach — Agent Handoff

Every claim in this document was checked against the actual code in this
directory before being written down (file line numbers, function names, and
exact env var names below were grepped, not recalled). Treat this as the
current source of truth; if you make code changes, please keep this file
honest by re-checking rather than editing from memory.

## What This Is

A single-user web app that turns static chess positions (pasted as FEN) into
Socratic coaching sessions. The student loads a position, answers open-ended
questions from an LLM coach, and is guided toward discovering the best move
themselves — the coach never gives the answer unless the student is stuck.
Stockfish provides ground truth; the LLM provides the pedagogy.

The app supports **multi-ply combinations** (after the student finds a move,
the opponent's reply is auto-played and they're prompted for the next move,
up to 6 plies) and **genuine candidate-move analysis** (comparing 2-4
candidate moves head-to-head, or verifying a multi-move line the student
calculated themselves) — this second part matters a lot: it's not a nice-to-
have, it's how a student actually solves a tactic in practice (generate
candidates, calculate each a little, compare, then commit), and earlier
versions of this app only supported checking one move at a time.

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend | Python 3.12 + FastAPI | Single-file `main.py`, ~620 lines |
| Engine | Stockfish (UCI via `python-chess`) | Single persistent process, pooled across requests, crash-recovering |
| LLM | Anthropic Claude or Z.ai (GLM), per-role config | Two roles: `coach` (Socratic dialogue) and `nl_interpreter` (move parsing fallback) |
| DB | SQLite via SQLAlchemy | Tables exist (positions, sessions, turns, tags) but nothing is written to them yet at runtime |
| Frontend | Single HTML file + cm-chessboard (CDN) | Minimal SPA, dark theme, no build step |
| Chess logic | `python-chess` | FEN parsing, legality, SAN parsing, pin/hanging-piece/undervalued-target detection |

## File Map

```
chess_coach/
├── main.py            # FastAPI app: routes, session state, LLM tool loop, move extraction
├── engine_service.py  # Stockfish wrapper: analysis, refutation, candidate comparison, line exploration
├── llm_client.py      # Provider-agnostic LLM client (Anthropic + Z.ai), tool call normalization
├── database.py        # SQLAlchemy models + tag seeding (schema ready, not used at runtime yet)
└── static/index.html  # Frontend SPA (board + chat panel + rotate button)
```

No `.env`, `start.sh`, or `pyproject.toml` are checked in here — set env vars
yourself (see **LLM Provider Configuration** below) and run with
`uv run --env-file .env uvicorn main:app --host 0.0.0.0 --port 8000 --reload`
(or plain `uvicorn` if you're not using `uv`). Stockfish must be installed
separately (`apt install stockfish`) — it's a system binary, not a Python
package.

## How the Coaching Loop Works

### 1. Student loads a position

- Frontend sends `POST /session/start { fen }`
- Backend validates the FEN, runs Stockfish (depth 20, MultiPV 3 — see
  `analyze_position()` in `engine_service.py`), and creates an in-memory
  `GameSession` keyed by a fresh `session_id` (see `GameSession` dataclass,
  `main.py` line ~29)
- Frontend shows the board and a hardcoded opener: *"What do you notice about
  this position?"*
- The LLM is NOT involved in this opener — coaching starts on the student's
  first reply. (The system prompt separately tells the model to ask something
  similarly open-ended and non-leading on turn 1 — see `is_opening_turn`
  below — this is a belt-and-suspenders thing: the hardcoded frontend opener
  covers turn 0, the prompt guideline covers what the model itself should ask
  once the student responds.)

### 2. Student types an answer

- Frontend sends `POST /chat { session_id, user_message }` — **note there is
  no `conversation_history` field**. The server owns conversation state
  (`GameSession.messages`); the frontend does not replay the transcript.
  This matters — see "Server-owned conversation history" below for why.

- Backend does these things in order, all inside `handle_chat_turn()`:

  **a) Engine analysis (every turn)**
  - Runs Stockfish fresh against the **current** board state (depth 18, 1s
    cap) — recomputed every turn, never cached from session start, because
    the "correct" move changes at every ply in a multi-move line
  - Extracts: best move, eval (White POV, centipawns), top 3 candidate lines
    (`multipv`), and structural signals: `hanging_pieces`,
    `undervalued_targets`, `pins`
  - **All of this is injected into `prompt_context`**, not just
    `best_move_san` — this used to be a real gap (an earlier version only
    passed the bare best-move string, discarding eval/multipv/signals that
    were already being computed) and was fixed specifically because it
    starves the coach of exactly the grounding it needs to answer "why does
    this work" well

  **b) Move extraction (in code, never by the LLM)**
  - `extract_candidate_move()` — regex-based SAN parsing, then bare-square
    disambiguation (student types "d3" and exactly one legal piece can reach
    d3 → that's the move)
  - `interpret_natural_language_move()` — LLM fallback for free-form English
    ("I'll take the rook with my pawn"). Constrained via a JSON schema
    **enum** to the position's actual legal moves, so it is structurally
    impossible for this to return an illegal move even if the model
    misreads intent — verified by testing that the enum constraint actually
    holds and by double-checking membership in code afterward regardless
    (never trust a model output as legal without checking it against the
    real board)
  - The extracted candidate is compared to Stockfish's `best_move_san` in
    **plain Python** — move correctness is never delegated to the LLM. This
    is a deliberate, load-bearing design principle, not an oversight: LLMs
    are unreliable at exact move/notation validation, so that decision stays
    deterministic no matter what else changes in this app.

  **c) If the student found the best move**
  - Move is applied to the real board, material delta recorded
  - `session.wrong_attempts_this_ply` resets to 0 (see hint calibration,
    below)
  - The opponent's best reply is auto-played (fresh Stockfish search)
  - Student is prompted for their next move in the line
  - After 6 solved plies or game-over, `line_complete = True`

  **d) If the student proposed a wrong (but legal) move**
  - `refute_move()` runs a quick search (depth 12, 0.5s) on the resulting
    position and returns the opponent's best reply + eval swing, so the
    coach can explain *why* it fails rather than just saying "no"
  - `session.wrong_attempts_this_ply += 1`

  **e) If the student's message didn't resolve to any move at all**
  - This is common and expected — e.g. "I'd love to play Qf1 but Rc8+ ruins
    it" is *reasoning about a different hypothetical move*, not a move
    submission. `candidate_move_detected` stays `None`, no refutation runs
    automatically, and `wrong_attempts_this_ply` still increments (used as a
    general "turns stuck on this ply" signal, not literally a count of wrong
    guesses). The coach is expected to reach for `try_hypothetical_move` or
    `explore_line` on whatever the student actually described — see the
    system prompt guideline about this specifically, and the tool
    descriptions.

  **f) LLM coaching call**
  - `prompt_context` (all of 2a-2e above) is JSON-dumped and prepended to
    the student's raw message, then appended to `session.messages`
  - The coach client (`build_client_from_env("coach")`) is called with the
    full system prompt, the full accumulated `session.messages`, and 5 tools
  - Tool-use loop: up to 5 iterations. The model can call verification tools
    first, then must call `respond_with_coaching` to produce the actual
    reply. See **Tool Inventory** below for what each one does.

  **g) Response**
  - Returns `assistant_reply`, `highlight_squares`, `user_solved_this_turn`,
    `fen` (current board state — may have advanced by up to 2 plies since
    the opponent's reply gets auto-played), `line_complete`
  - Frontend redraws the board from the returned FEN and highlights squares

## Tool Inventory

All five defined in `handle_chat_turn()`, `main.py` lines ~388-486:

| Tool | Purpose | Touches real board? |
|------|---------|---------------------|
| `check_square` | Attackers/defenders of a given square right now | No — scratch copy |
| `try_hypothetical_move` | Legality/check/material for ONE hypothetical move, **plus a real engine search** of the opponent's best reply (via `refute_move`) | No — scratch copy |
| `compare_candidate_moves` | Evaluates 2-4 candidate first moves **head-to-head**, each forced via `root_moves` so the engine genuinely analyzes it rather than reporting only its single favorite; returns eval + short continuation per candidate | No — scratch copy |
| `explore_line` | Plays out a specific multi-move sequence the student calculated themselves; stops and reports exactly where it breaks if illegal; returns the engine's own suggested continuation past where the student's calculation ends | No — scratch copy |
| `respond_with_coaching` | The actual reply text + squares to highlight. Must be called last. | N/A — output tool |

**Why both `try_hypothetical_move` and `compare_candidate_moves` exist**:
they answer different questions. "Does this one move work?" (single-move
verification, now engine-backed) vs. "which of these options is actually
best?" (genuine head-to-head comparison — this is what makes an
engine-forced-analysis of 2+ candidates meaningfully different from just
calling the single-move tool twice, since the engine's own top-choice
reasoning doesn't naturally surface a fair comparison of a move it *wouldn't*
have picked on its own).

**Every one of the first four runs on `board.copy()` — a scratch board —
never the real `session.board`.** This is the boundary that makes it safe for
the student to say "what if I played X instead" without corrupting the actual
line they're solving.

## The tool_use / tool_result Bug (read this before touching the tool loop)

An earlier version of this code appended the assistant's `respond_with_coaching`
tool-call message to `session.messages` but never appended a matching
`tool_result` for it. Since history is server-owned and persists across
turns, the **next** `/chat` call would send this malformed history back to
the API.

This is not a theoretical concern — it's Anthropic's most-reported API error
by a wide margin (`400: tool_use ids were found without tool_result blocks
immediately after ... Each tool_use block must have a corresponding
tool_result block in the next message`), and it would have broken **every
session on its second turn**, since turn 1 always ends by calling
`respond_with_coaching`.

The fix, in the `respond_call` branch of the tool loop (`main.py`, inside
`handle_chat_turn`):

```python
session.messages.append(result.raw_assistant_message)
session.messages.extend(
    coach_client.format_tool_results([respond_call], ["(shown to the student)"])
)
```

`respond_with_coaching` has no real "result" to report (it's a
structured-output tool, not something with a side effect) — the string is a
placeholder, but the message still has to be there or history is malformed
for provider APIs.

**The same principle applies to the iteration-cap fallback path** (if the
model doesn't call any tool within `MAX_TOOL_ITERATIONS`): that synthetic
"sorry, I got stuck" reply never came from a real `call()` response, so
there's no `raw_assistant_message` to reuse. `llm_client.py` has a
`format_assistant_text(text)` method on both provider classes specifically
for this — build a plain assistant message in the provider's native shape
(a content-block list for Anthropic, a plain string for OpenAI-compatible)
and append that, so this turn doesn't just silently vanish from history.

**If you add a new tool or a new way for the loop to exit, check that every
exit path leaves `session.messages` well-formed before the function
returns.** The three current exit paths (plain-text-no-tool-call,
`respond_with_coaching`, iteration-cap-exhausted) all handle this correctly
as of this version — verified by constructing the actual message list after
a simulated turn and checking every `tool_use` has a matching `tool_result`
in the following message, then separately confirming the *old* buggy version
of the same check genuinely fails it (both directions tested, not just
patched and assumed working).

## Server-owned conversation history

`GameSession.messages: List[Dict[str, Any]]` stores the complete LLM
conversation history **in whatever provider-native shape the active coach
client wrote it** — Anthropic's `tool_use`/`tool_result` content blocks, or
OpenAI-compatible's `tool_calls` field + separate `role: "tool"` messages.

Why server-owned instead of the frontend sending `conversation_history` each
turn (which an earlier version did): it removes the fragile assumption that
the frontend faithfully replays the *entire* transcript, including every
intermediate tool call/result pair, every turn. The frontend now only ever
sends `{ session_id, user_message }`.

**One real, currently-undocumented-elsewhere risk**: if `COACH_PROVIDER`
changes mid-session (e.g. you restart the server with a different provider
while a session is still in memory — unlikely in practice since sessions are
in-memory and die with the process anyway, but worth knowing), the stored
message shapes wouldn't match what the new provider's client expects to
receive back. This hasn't been an issue in testing because provider is fixed
per-process, but if you ever add hot provider-switching, this is where it
would break.

## Hint Calibration

Two signals feed into `prompt_context` specifically to make the coaching
*feel* like an actual tutor rather than a fixed script, both distilled from
watching this exact loop run against real hand-solved positions:

- `is_opening_turn` (`len(session.messages) == 0`) — tells the model this is
  the very first question of the session, so it should ask something broad
  and non-leading ("what do you notice") rather than already pointing at the
  tactic
- `wrong_attempts_or_discussion_turns_on_this_ply`
  (`GameSession.wrong_attempts_this_ply`) — increments on any turn that
  doesn't solve the current ply (wrong guess OR pure discussion), resets to
  0 on solve. The system prompt tells the model to narrow hint specificity
  sharply after 2+ stuck turns rather than repeating the same broad question

## LLM Provider Configuration

Per-role env vars — each of `coach` and `nl_interpreter` can use a different
provider/model independently (verified exact var names via `llm_client.py`):

```
COACH_PROVIDER=anthropic|zai
COACH_MODEL=claude-sonnet-5|glm-4.7           # falls back to claude-sonnet-5 (anthropic) or glm-4.7 (zai) if unset
NL_INTERPRETER_PROVIDER=anthropic|zai
NL_INTERPRETER_MODEL=...
LLM_PROVIDER=anthropic                         # fallback if a role-specific *_PROVIDER isn't set
ANTHROPIC_API_KEY=...
ZAI_API_KEY=...
ZAI_BASE_URL=https://api.z.ai/api/coding/paas/v4/   # Z.ai Coding Plan endpoint (default).
                                                      # General pay-per-token accounts need
                                                      # https://api.z.ai/api/paas/v4/ instead --
                                                      # using the wrong one for your account
                                                      # type fails outright. Verified against
                                                      # a real Coding Plan account.
```

**On model choice**: GLM-4.7 was deliberately chosen over GLM-5.1/5.2 for
this app. The 5.x flagships are priced and built for long-horizon autonomous
coding agents (huge context, hundreds of tool calls per session); this app's
actual workload per turn is a handful of small tool calls plus one
conversational reply, closer to what 4.7 is priced for. If coaching quality
or tool-use reliability ever proves inadequate on 4.7 in practice, the
upgrade path is GLM-5.2 specifically (skip 5.1 — at Z.ai's own pricing, 5.2
costs the same as 5.1 but is newer with a much larger context window, so
5.1 is dominated by 5.2 at that price point).

`llm_client.py` abstracts both providers behind `ToolCallResult`
(`tool_calls`, `text`, `raw_assistant_message`) so `main.py` never branches
on which provider is active — the one mechanical difference (tool schema
shape: Anthropic's `input_schema` vs. OpenAI's `parameters`-wrapped-in-
`function`) is handled once, in `ZaiClient._to_openai_tools()`.

## Engine Service Details (`engine_service.py`)

- **Single persistent Stockfish process**, started at app startup via
  `lifespan()`, reused across every request — no per-request
  `popen_uci`/`quit()`
- **Crash recovery**: `_analyse_with_retry()` catches `EngineTerminatedError`
  and restarts the engine once before retrying. Pre-flight health checks via
  `transport.is_closing()` do **not** work for this — verified against an
  actual `SIGKILL`: the flag stayed `False` the entire time, since it only
  reflects a deliberate `.close()` call, not process death. Recovery has to
  be reactive (catch-and-restart on actual use), not proactive.
- **Structural signals** — all via `python-chess`'s own APIs, not hand-rolled
  geometry:
  - `hanging_pieces` — `attackers > defenders`, simple count
  - `undervalued_targets` — catches what the count-based check above misses:
    a piece attacked by something worth *less*, even if defender count looks
    "even" (e.g. a rook attacked once by a pawn and defended once by a
    bishop looks fine by count, but the pawn can still take the rook for a
    huge material swing regardless of the recapture)
  - `pins` — `board.is_pinned()`. An earlier naive rank/file/diagonal-matching
    version of this flagged nearly every piece on the board as "pinned"
    (no check for a blocking piece or that the attacker was actually a
    slider) — this is why it uses the library's built-in check instead.
- **`refute_move(fen, move_san)`** — applies the move, quick search (depth
  12, 0.5s), returns opponent's best reply + eval
- **`compare_candidates(fen, candidate_moves_san, depth=16, pv_length=6)`** —
  the engine is forced to analyze each candidate via `root_moves`, not just
  report its single favorite. Verified against a real position: comparing
  `e3` (correct) vs. an immediate `Qb1` (tempting but premature) correctly
  showed `e3` at +2.42 and `Qb1` at essentially -∞ — walking into a real
  forced mate — matching hand analysis exactly.
- **`explore_line(fen, moves_san)`** — plays out a specific sequence,
  reports exactly where it breaks if illegal, returns the engine's own
  continuation past where the student's calculation ends

## Database

Tables exist (`positions`, `sessions`, `turns`, `tags`, `position_tags`) with
a seeded taxonomy of 20 core tactical themes (`database.py`). **Nothing
writes to these tables during a live session yet** — this is the known gap
for the future Phase 2 dashboard (per-tag solve rates, session history).

## Known Gaps / Future Work

- **Sessions not persisted to DB** — schema ready, nothing writes to it at
  runtime yet
- **No branching for the auto-played opponent line** — the session tracks
  exactly one canonical line (the engine's top choice, auto-played for the
  opponent at every ply). If the student wants to explore "what if White had
  replied differently," `try_hypothetical_move`/`compare_candidate_moves`/
  `explore_line` all handle *checking* that single-branch, but none of them
  let the student **commit to and continue playing out** an alternate
  opponent-reply branch as the new "real" line. Scoping that properly would
  probably mean a tree of `GameSession` states rather than one linear one —
  bigger change, only worth it if single-ply hypothetical checks turn out to
  not be enough in practice.
- **No auth** — gate at the proxy layer (Cloudflare Zero Trust or similar)
  before exposing to the open internet; every `/chat` turn costs a real API
  call, so an open endpoint risks token burn if discovered
- **No dashboard, no tagging, no spaced repetition** — all Phase 2/3 items,
  same status as before
- **In-memory session store** (`game_sessions: Dict[str, GameSession]`) —
  fine for single-user/single-process; would need Redis or a DB-backed store
  for multi-worker deployment, since this dict only lives in one process's
  memory

## What's Verified vs. What Isn't

Everything deterministic in this codebase — move extraction, the material/
eval math, scratch-board isolation (hypothetical exploration never touches
the real session board), `compare_candidates`/`explore_line` against real
positions, the tool_use/tool_result fix (both the bug reproduced and the fix
confirmed, via constructing message histories and checking well-formedness
directly) — has been tested against a running Stockfish and, for the FastAPI
layer, via `TestClient` in-process calls reaching the real Anthropic API up
to the authentication boundary.

**What has never been verified**: an actual live model response, end to end,
through a real API key, through more than one or two manually-triggered
turns. Every test so far confirms the request builds correctly and reaches
the API — none of them confirm the model's actual coaching *behavior* is
good in practice (does it really ask non-leading opening questions, does it
really reach for `compare_candidate_moves` instead of intuiting an answer,
does the hint-narrowing actually feel calibrated). That can only be checked
by someone with real API access actually running full sessions.
