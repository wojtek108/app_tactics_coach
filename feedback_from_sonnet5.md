This is a well-organized handoff doc, and most of it checks out against what I actually know of this codebase — but there's one significant thing missing that I want to flag before anything else, since it directly contradicts what you told me a few messages ago.

## The important concern: the tool list is missing `compare_candidate_moves` and `explore_line`

Section 2e lists only three tools: `check_square`, `try_hypothetical_move`, `respond_with_coaching`. Those two dedicated comparison tools we just built — specifically because you said branch exploration is "the basis of the solution finding process" — aren't mentioned anywhere.

Their change #3 instead enhances `try_hypothetical_move` to call `refute_move()` internally, returning `engine_eval_after_move_cp_white_pov` and `engine_best_reply_san`. That's a real improvement on its own (mine only did static material counting, not a real engine search), but it's not the same capability: `try_hypothetical_move` checks *one* move at a time. `compare_candidate_moves` was specifically built to evaluate 2-4 candidates *head-to-head in one call*, using `root_moves` to force the engine to genuinely analyze each one rather than just report its single favorite — that's what let us see `e3` at +2.42 vs. immediate `Qb1` at -∞ side by side. A single-move tool, even an engine-verified one, doesn't reproduce that.

Two possibilities: either this other session branched off an older `main.py` before I added those tools, or they were consolidated away during this "grilling session." Either way, I'd want to know which before treating this doc as the current source of truth — worth checking whether `compare_candidate_moves` and `explore_line` still exist in the actual file.

## What's genuinely good here

- **Full engine analysis flowing to `prompt_context` every turn** (change #1) is a real fix to a real gap — my version only ever passed the bare `best_move_san` string, not eval/multipv/structural signals. Good catch on their part, this should improve the coach's grounding meaningfully.
- **Server-owned conversation history** (change #2) is a legitimate architectural improvement — removes the fragile assumption that the frontend faithfully replays the full transcript every turn, and centralizes state where it belongs.
- The engine service description, structural signals section, and known-gaps list all match reality precisely — nothing fabricated there.

## Two smaller things worth double-checking

1. **"Three-stage extraction pipeline"** in section 2b only lists two numbered items. Minor, but worth tightening in the doc — either the count is off or a stage got dropped from the list.
2. **Config example shows `COACH_MODEL=glm-5.1`** — we specifically decided on `glm-4.7` over 5.1 for this app's shape (lightweight tool calls, not long-horizon coding-agent workload). Probably just an illustrative example in the doc rather than their actual `.env`, but worth a quick check that it didn't drift back.

One more thing I'd actually want confirmed rather than assumed: does the server-owned `session.messages` history preserve the **provider-native message shapes** (Anthropic's `tool_use`/`tool_result` content blocks vs. OpenAI-compatible `tool_calls`/`role: "tool"`)? That distinction was load-bearing — `llm_client.py`'s `raw_assistant_message` and `format_tool_results` exist specifically because those two shapes aren't interchangeable. If the other session stored history in some unified/simplified shape instead, switching `COACH_PROVIDER` mid-session (or just using it fresh with `zai`) could break in a way that wouldn't show up until you actually tried it.

