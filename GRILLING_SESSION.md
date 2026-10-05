# Grilling Session: Coaching Quality & Engine Data Flow

**Date:** 2025-07-14
**Scope:** Why the LLM coach produces low-quality guidance and how to fix it.

## Problems Identified

1. **Structural signals computed but never forwarded to the LLM.** `analyze_position()` returns `hanging_pieces`, `undervalued_targets`, and `pins`, but `prompt_context` only passes `best_move_san` (a bare string like "Qf6"). The model has no idea *why* that move is best.
2. **Opening message is hardcoded in the frontend.** `"Position loaded. What do you notice about this position?"` never touches the LLM. The model's first real `/chat` call sees an empty `conversation_history` and no context about what question the student is answering.
3. **Engine context does not persist across turns.** The `[Engine Context: {...}]` block is injected server-side per-turn but never stored. By turn 3+, the model has forgotten the FEN, the best move, and all engine data — it only has the chat transcripts the frontend sends back.
4. **`try_hypothetical_move` is a fake verification tool.** It checks legality and material balance on a scratch board but runs no Stockfish search. The model *looks* like it can answer "does this move work?" but only gives static material math, not a real engine evaluation.

## Decisions Made

### Q1 — Should the full engine analysis be injected every turn?
**Settled:** Yes. Full analysis (structural signals, eval, MultiPV) every turn. The model can only coach as well as what it can see.

### Q2 — Should the opening message go through the LLM?
**Settled:** No. Keep the hardcoded opener ("What do you notice about this position?"). The guiding starts when the student replies. The logic: student types what they notice, and from that point the LLM guides based on engine evaluation.

### Q3 — Should engine context persist across turns?
**Settled:** Yes. The model needs the current position's full tactical picture every turn AND needs to remember what it already told the student in prior turns.

### Q4 — Who owns the conversation history?
**Settled:** Server (`main.py` / `GameSession` in-memory object). The frontend stops sending `conversation_history`. The server stores the complete message list (including engine context blocks) and the frontend just sends `{session_id, user_message}`. The frontend already trusts the server for board state — conversation state is the same kind of trust boundary.

### Q5 — What exactly goes into the per-turn engine context?
**Settled:** Everything raw. `best_move_san`, `eval_cp_white_pov`, full `multipv` table (top 3 lines with move + eval), `hanging_pieces`, `undervalued_targets`, `pins`. The system prompt can be tuned later to control *how* the model uses this data.

### Q6 — Should `try_hypothetical_move` run a real engine search?
**Settled:** Yes. Wire the existing `refute_move` method into the `execute_tool` handler for `try_hypothetical_move` so the model gets an engine-backed answer (with eval swing and best refutation move) instead of just static material counts.

## Implementation Plan

1. **Add `messages` list to `GameSession`** — stores the full LLM conversation history including engine context blocks.
2. **Drop `conversation_history` from `ChatRequest`** — frontend just sends `{session_id, user_message}`.
3. **Inject full `analysis` dict into `prompt_context`** — not just `best_move_san`. Include `eval_cp_white_pov`, `multipv`, `hanging_pieces`, `undervalued_targets`, `pins`.
4. **Append both the engine-context-augmented user message and the assistant's reply** to the server-side `GameSession.messages` list each turn.
5. **Wire `refute_move` into `execute_tool` for `try_hypothetical_move`** — run a quick engine search on the scratch board after applying the hypothetical move, return eval swing and best refutation.
6. **Frontend change** — stop sending `conversation_history`, just send `{session_id, user_message}`.

## Files Involved

- `main.py` — `GameSession` dataclass, `ChatRequest` model, `handle_chat_turn`, `execute_tool`
- `static/index.html` — `sendMessage()` function, remove `conversation_history` from fetch body
