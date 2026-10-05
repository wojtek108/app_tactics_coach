Two things stand out — one confirms what I suspected, one is a new and more serious bug I need to verify before flagging confidently.Found something more serious than a missing feature — and I verified it against real, extensively-documented Anthropic API behavior before flagging it, since this is a big claim. **This is a session-breaking bug**, not a style issue.

## Critical bug: dangling `tool_use` blocks with no `tool_result`

When the model calls `respond_with_coaching`, their code appends `final_raw_assistant_message` (containing that `tool_use` block) to `session.messages` — but **never appends a matching `tool_result`** for it. Since history is now server-owned and persists across turns, the *next* `/chat` call sends this malformed history back to the API. I confirmed this exact scenario is a extremely well-documented, hard failure: Anthropic's API rejects any request where a `tool_use` isn't immediately followed by a matching `tool_result` — `400: tool_use ids were found without tool_result blocks immediately after`. This isn't a rare edge case; it would break **every session on the second turn**, which is the core use case of the entire app.

That debug `print` statement left in `ZaiClient.call()` (dumping `model_extra` on every call) makes me suspect they were actively chasing symptoms of this exact bug without finding the root cause.

Let me fix this properly — the fix needs a new small piece: a way to close out a tool call with a synthetic result when there's no "real" tool execution (because `respond_with_coaching` is a structured-output tool, not something with an actual side effect to report back).
