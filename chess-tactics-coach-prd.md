# Chess Tactics Coach — Product Blueprint / PRD

## 1. Problem & Goal

Wojtek wants to convert static tactical positions (pasted as FEN) into an
active, Socratic training loop instead of passively reading engine lines.
Goal: build pattern recognition by being *questioned* into the solution,
not told it — mirroring the coaching session that produced this spec.

**Success criteria (v1):** paste a FEN, get engine ground-truth, get walked
through a dynamic question chain toward the best move, and have every
session logged so weak tactical themes become visible over time.

---

## 2. Core User Flow

1. User pastes a FEN string into the app.
2. Backend validates FEN, runs Stockfish (depth ~20-22), extracts:
   - best move + eval (centipawns/mate)
   - top 2-3 candidate lines (MultiPV)
   - basic structural signals (see §5)
3. App opens with a neutral opener: *"What do you notice about the position?"*
4. User answers in free text.
5. Claude API receives: FEN, engine output, structural signals, full
   conversation so far, and the user's last answer — and generates the
   *next* Socratic question, narrowing toward the best move.
6. Loop continues until the user states the correct move (or gives up and
   asks for the answer).
7. Session is logged: FEN, tags (tactical themes involved), number of
   questions to solve, whether user got there unaided, final move accuracy.
8. Dashboard shows trends: which themes (weak back rank, hanging piece,
   overloaded defender, weak dark squares, etc.) the user solves fast vs.
   struggles with.

---

## 3. Architecture

Single VPS deployment, reusing your existing stack conventions (Python,
n8n-adjacent, no new cloud dependency).

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Frontend    │◄────►│  Backend (FastAPI) │◄───►│  Stockfish (UCI)│
│  (simple SPA)│      │  - session state   │      │  subprocess pool │
└─────────────┘      │  - Claude API calls│      └─────────────────┘
                      │  - SQLite/Postgres │
                      └──────────────────┘
```

**Backend:** Python + FastAPI
- `python-chess` for FEN parsing/validation and move legality checks
- Stockfish invoked via `python-chess`'s `SimpleEngine` (UCI), pooled/reused
  process rather than spawning per request
- Claude API call per turn (Sonnet is plenty; this isn't reasoning-heavy,
  it's instruction-following against structured engine data)

**Frontend:** minimal single-page app
- Chessboard rendering (chessboard.js, cm-chessboard, or similar,
  read-only + FEN input)
- Chat panel for the Socratic dialogue
- **Square highlighting driven by the backend.** When Claude references
  specific squares in a question ("look at the weak dark squares around
  the king"), the backend passes the relevant square list (e.g. `["f6",
  "g7", "h6"]`) to the frontend for highlighting. Cheap to implement since
  the backend already has this data from the engine analysis layer, and
  it turns a text hint into something the eye can actually follow.
- Session history / dashboard view

**Storage:** SQLite is enough at single-user scale; migrate to Postgres
only if you add multi-user later.

**Deployment:** same VPS pattern you already use (systemd service + your
existing Cloudflare/reverse-proxy setup for HTTPS).

---

## 4. Data Model (minimal)

```sql
positions(
  id, fen, created_at, source_note  -- e.g. "own game", "puzzle site"
)

sessions(
  id, position_id, started_at, finished_at,
  solved boolean, questions_asked int, hints_used int,
  final_user_move text, best_move text, eval_cp int
)

turns(
  id, session_id, turn_number, role,  -- 'assistant' | 'user'
  content text, created_at
)

tags(
  id, name  -- 'weak back rank', 'overloaded piece', 'hanging piece',
            -- 'weak dark squares', 'fork', 'pin', 'discovered attack', ...
)

position_tags(position_id, tag_id)
```

**Seed a fixed taxonomy rather than letting tags emerge freely** — pure
LLM-assigned tags drift over time into near-duplicates ("weak back rank"
vs. "back-rank mate" vs. "back rank weakness"), which quietly kills the
usefulness of the aggregate dashboard in §7. Seed `tags` with ~15-20 core
themes up front (pin, fork, skewer, back rank, overloaded defender,
removed defender, discovered attack, deflection, attraction, weak dark
squares, hanging piece, zwischenzug, etc.), and instruct Claude to select
1-3 existing tag IDs when closing a session, falling back to a new custom
tag only when nothing in the list genuinely fits.

---

## 5. Engine Analysis Layer

Beyond raw eval, extract signals the LLM can reference so questions stay
grounded in facts, not guesses:

- Best move + eval, top 3 candidate moves (MultiPV 3)
- Hanging/under-defended pieces for both sides — use `python-chess`'s
  built-in `board.attackers(color, square)` / `board.defenders(color,
  square)` rather than hand-rolled heuristics; this covers most of what
  was previously listed as custom logic
- King safety: pawn shield integrity (has a pawn left its home square
  near the king), open files/diagonals toward the king
- Piece alignment: pieces sharing a file/rank/diagonal with either king
  (pin/skewer candidates)

This doesn't need to be exhaustive — its job is to give the LLM real
anchors ("bishop on d2 is attacked along the d-file by queen+rook") so it
can't hallucinate a tactic that isn't there.

**The "why not X?" case.** A coaching dialogue routinely hits: *"why can't
I just play Bg5?"* — a move outside the top-3 MultiPV lines. The engine
layer needs an on-demand refutation query: given the current FEN and a
proposed move, run a short search on the resulting position and return
why it fails (Black's best reply, and the resulting eval swing). Without
this, the coach goes silent exactly when the student is testing their own
idea — arguably the most valuable moment in the dialogue. Implementation:
apply the user's move to the `python-chess` board, run a quick
lower-depth Stockfish search on the resulting position, hand that back to
the LLM as context for its next question.

---

## 6. LLM Prompting Strategy (the coaching core)

System prompt encodes the behavior we just demonstrated:

- **Never state the answer unprompted.** Ask, don't tell.
- **One question at a time**, building on the user's last answer —
  acknowledge what they got right before probing what's missing.
- **Correct gently, don't lecture.** If the user makes a factual slip
  (e.g., miscounts material), point at *where* to look, not the fact
  itself.
- **Escalate specificity if stuck.** If the user is off-track after 2-3
  questions, narrow the question (e.g., from "what's weak?" to "look at
  this specific file/diagonal").
- **Stop condition:** user states the correct move (verified against
  engine bestmove) → confirm, then briefly explain *why* it works and
  name the transferable pattern (as in the closing summary above).
- **Escape hatch:** user can ask for the answer directly at any point —
  don't force the Socratic loop past the point of usefulness.

Each API call receives: FEN, engine JSON, tags-so-far, and the full turn
history (or a summarized version once sessions get long) — no client-side
state needed beyond the session ID.

**Move validation belongs in code, not in the model.** Do not ask Claude
to judge whether the user's proposed move matches the engine's best move
— LLMs are unreliable at parsing/validating algebraic notation against a
board state, and this is exactly the kind of check that should fail
loudly, not silently. Instead: the FastAPI backend parses the user's
message for a candidate move (via `python-chess`'s SAN parser), validates
it against the engine's best move (or an acceptable-alternatives list),
and passes an explicit `user_solved_this_turn: true/false` boolean into
the Claude prompt. Claude's job is purely the coaching dialogue —
deciding *what to ask next* — never verifying correctness itself.

---

## 7. Dashboard / Progress Tracking (v1 lightweight version)

- List of past sessions: position thumbnail, tags, solved Y/N, # questions
  needed
- Aggregate by tag: solve rate and average questions-to-solve per theme
  → surfaces your weak spots (e.g., "you consistently need 4+ questions
  on weak-back-rank positions but solve pins in 1-2")
- No spaced-repetition scheduling in v1 — just visibility. Add later if
  useful.

---

## 8. Phased Build Plan

**Phase 1 (MVP):**
FEN input → engine analysis → single-threaded Socratic chat → session
saved to DB, no dashboard yet, no auth (single user).

**Phase 2:**
Session history list + per-tag aggregate stats. Tagging via LLM at
session-close.

**Phase 3 (optional):**
- Import positions directly from your own games (PGN upload → auto-split
  into critical moments via engine eval swings)
- Spaced repetition on unsolved/struggled positions
- Export weak-theme report to your Obsidian vault

---

## 9. Open Decisions Before Build

- **Auth:** since every chat turn triggers a Claude API call, an open
  endpoint invites unauthorized token burn if discovered. Given your
  existing Cloudflare setup, gate the app at the proxy layer —
  Cloudflare Zero Trust or basic auth in front of the app — rather than
  building app-level auth. Simpler and keeps the FastAPI app itself
  unaware of auth entirely.
- Stockfish depth/time budget per position — depth 20-22 took ~1-1.5s in
  testing just now, fine for interactive use. Cap via
  `chess.engine.Limit(depth=20, time=2.0)` so a pathological position
  can't stall a request.
- Claude model choice: Sonnet is sufficient; no need for extended
  thinking on this task type.

---

## 10. Implementation Roadmap

1. **Backend skeleton** (`main.py`, FastAPI + `python-chess` + Stockfish
   UCI wrapper):
   - `POST /analyze` — FEN in, returns best move, MultiPV-3, attacker/
     defender metadata, king-safety signals
   - `POST /refute` — FEN + proposed move in, returns why it fails
     (§5, on-demand refutation)
   - `POST /chat` — parses user move from message via SAN parser,
     validates against engine ground truth, sets `user_solved_this_turn`,
     calls Claude API, returns next question + squares to highlight.
     **Reference implementation:** `chat_route.py` (attached). Two bugs
     caught by testing against real session data: (1) the move extractor
     didn't resolve bare destination squares like "d3" — the exact answer
     given mid-session to "which square?" — since SAN requires piece
     disambiguation for non-pawn moves; fixed via legal-move lookup when
     exactly one piece can reach the stated square. (2) response parsing
     assumed `response.content[0]` was always the tool_use block; Claude
     Sonnet 5 runs adaptive thinking on by default, which can insert a
     thinking block first even under forced tool_choice — fixed by
     finding the block by `type` instead of position.
   - **Reference implementation:** `engine_service_v2.py` (attached
     alongside this doc) implements `/analyze` and `/refute` logic —
     verified end-to-end against the test position from this session.
     Two bugs caught by running it rather than trusting it on read:
     `python-chess` has no `board.defenders()` method (use
     `board.attackers(piece.color, square)` instead), and naive
     rank/file/diagonal matching for pin detection produces near-total
     false positives (~20 flagged pieces out of 19 on the board) — use
     `board.is_pinned()` instead, which correctly returns only real pins.
2. **Database layer** (SQLite via SQLAlchemy): `positions`, `sessions`,
   `turns`, `tags`, `position_tags` — seed `tags` with the fixed taxonomy
   from §4 before first use.
3. **Frontend:** board + FEN input + chat panel + highlight support.
4. **Dashboard:** aggregate solve rate / avg-questions-to-solve by tag.
5. **Auth:** Cloudflare Zero Trust in front of the whole app, added
   before it's reachable from the open internet — not after.
