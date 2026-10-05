"""
Run this locally (same folder as llm_client.py, with ZAI_API_KEY set):
    uv run test_tool_loop.py

Tests a REAL tool-calling round trip against GLM-4.7: asks it a question
that requires calling a tool to answer, executes the tool, feeds the
result back, and checks it uses that result correctly in its final reply.
This is the piece we haven't verified at all yet -- message shape
construction was tested locally, but not a live multi-turn tool call.
"""
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()
os.environ.setdefault("ZAI_PROVIDER", "zai")

from llm_client import build_client_from_env, ToolCall


async def main():
    client = build_client_from_env("coach")  # will use COACH_PROVIDER=zai per your .env
    print(f"Using: {type(client).__name__}, model={client.model}")

    tools = [{
        "name": "get_square_info",
        "description": "Look up what's on a chess square. Call this to answer questions about square contents.",
        "input_schema": {
            "type": "object",
            "properties": {"square": {"type": "string", "description": "e.g. 'e4'"}},
            "required": ["square"],
        },
    }]

    messages = [{"role": "user", "content": "What piece is on square e4? Use the tool to check, don't guess."}]

    result = await client.call(
        system="You are a helpful assistant with access to a chess board lookup tool.",
        messages=messages,
        tools=tools,
    )

    print("\n--- First response ---")
    print("tool_calls:", [(tc.name, tc.input) for tc in result.tool_calls])
    print("text:", result.text)

    if not result.tool_calls:
        print("\n!! Model did not call the tool -- stopping here.")
        return

    # Simulate executing the tool: pretend e4 has a black pawn
    fake_result = {"square": "e4", "piece": "black pawn"}
    messages.append(result.raw_assistant_message)
    messages.extend(client.format_tool_results(result.tool_calls, [fake_result]))

    result2 = await client.call(
        system="You are a helpful assistant with access to a chess board lookup tool.",
        messages=messages,
        tools=tools,
    )

    print("\n--- Second response (after tool result fed back) ---")
    print("text:", result2.text)
    print("\nDid it correctly report 'black pawn'?", "pawn" in (result2.text or "").lower())


asyncio.run(main())
