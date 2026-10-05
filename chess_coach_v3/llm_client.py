"""
Provider-agnostic LLM client for tool-using calls.

Two providers implement the same interface:
- AnthropicClient: native Anthropic SDK (Messages API, tool_use blocks)
- ZaiClient: Z.ai's OpenAI-compatible endpoint (chat completions, tool_calls)

Verified against Z.ai's own docs (docs.z.ai/api-reference/introduction):
  base_url = "https://api.z.ai/api/paas/v4/" (general) or
             "https://api.z.ai/api/coding/paas/v4/" (Coding Plan)
  auth     = "Authorization: Bearer <key>" header
  Works via the standard `openai` SDK by pointing base_url there --
  confirmed by Z.ai's own curl/Python examples, not assumed.

Both implementations return a normalized ToolCallResult so the calling code
(main.py) never has to branch on which provider is active.
"""

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from anthropic import AsyncAnthropic
from openai import AsyncOpenAI


@dataclass
class ToolCall:
    id: str
    name: str
    input: Dict[str, Any]


@dataclass
class ToolCallResult:
    """Normalized result regardless of provider. Exactly one of
    tool_calls (model wants to call tool(s)) or text (model is done and
    replied directly) will be meaningfully populated, depending on
    whether tools were offered and whether the model used one.
    raw_assistant_message is the provider-native message to append to
    history verbatim -- needed because Anthropic and OpenAI-compatible
    providers structure "the assistant called a tool" differently, and
    only the provider implementation knows its own shape."""
    tool_calls: List[ToolCall] = field(default_factory=list)
    text: Optional[str] = None
    raw_assistant_message: Optional[Dict[str, Any]] = None


class LLMClient:
    """Interface both provider implementations satisfy."""

    async def call(
        self,
        system: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        force_tool: Optional[str] = None,
        max_tokens: int = 1200,
    ) -> ToolCallResult:
        raise NotImplementedError

    def format_tool_results(self, tool_calls: List[ToolCall], results: List[Any]) -> List[Dict[str, Any]]:
        """Given the tool calls the model just made and their execution
        results, return the message(s) to append to history so the next
        call() sees them -- in whatever shape this provider expects."""
        raise NotImplementedError

    def format_assistant_text(self, text: str) -> Dict[str, Any]:
        """Build a plain assistant text message in this provider's native
        shape, for cases where we need to inject a synthetic assistant
        reply into history that didn't come from a real call() response
        (e.g. the iteration-cap fallback message). Needed because Anthropic
        wants a content-block list and OpenAI-compatible wants a plain
        string -- getting this wrong produces the same malformed-history
        class of bug as leaving a tool_use unresolved."""
        raise NotImplementedError


class AnthropicClient(LLMClient):
    def __init__(self, model: str):
        self.model = model
        self.client = AsyncAnthropic()

    def _to_anthropic_tools(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        # Anthropic tool shape: {"name", "description", "input_schema"}
        # -- already the shape we define tools in, in main.py, so no
        # translation needed here. Kept as a pass-through for symmetry
        # with ZaiClient's translation step.
        return tools

    async def call(
        self,
        system: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        force_tool: Optional[str] = None,
        max_tokens: int = 1200,
    ) -> ToolCallResult:
        kwargs: Dict[str, Any] = dict(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        )
        if tools:
            kwargs["tools"] = self._to_anthropic_tools(tools)
            if force_tool:
                kwargs["tool_choice"] = {"type": "tool", "name": force_tool}
            else:
                kwargs["tool_choice"] = {"type": "auto"}

        response = await self.client.messages.create(**kwargs)

        tool_calls = [
            ToolCall(id=b.id, name=b.name, input=b.input)
            for b in response.content if b.type == "tool_use"
        ]
        text_blocks = [b.text for b in response.content if b.type == "text"]
        text = "\n".join(text_blocks) if text_blocks else None

        # Anthropic wants the assistant's own content blocks (as returned)
        # appended verbatim to history for the next turn.
        raw_assistant_message = {"role": "assistant", "content": response.content}

        return ToolCallResult(tool_calls=tool_calls, text=text, raw_assistant_message=raw_assistant_message)

    def format_tool_results(self, tool_calls: List[ToolCall], results: List[Any]) -> List[Dict[str, Any]]:
        # Anthropic expects one user-role message containing all
        # tool_result blocks, matched by tool_use_id.
        content = [
            {
                "type": "tool_result",
                "tool_use_id": tc.id,
                "content": str(result),
            }
            for tc, result in zip(tool_calls, results)
        ]
        return [{"role": "user", "content": content}]

    def format_assistant_text(self, text: str) -> Dict[str, Any]:
        return {"role": "assistant", "content": [{"type": "text", "text": text}]}


class ZaiClient(LLMClient):
    def __init__(self, model: str):
        self.model = model
        # Z.ai has TWO distinct OpenAI-compatible base URLs depending on
        # account type -- confirmed via docs.z.ai and a working real-world
        # example using this exact setup (Coding Plan + glm-4.7):
        #   general pay-per-token account -> https://api.z.ai/api/paas/v4/
        #   Coding Plan subscription       -> https://api.z.ai/api/coding/paas/v4/
        # Using the wrong one for your account type fails outright, so
        # this is configurable rather than hardcoded to either.
        base_url = os.environ.get("ZAI_BASE_URL", "https://api.z.ai/api/coding/paas/v4/")
        self.client = AsyncOpenAI(
            api_key=os.environ.get("ZAI_API_KEY"),
            base_url=base_url,
        )

    def _to_openai_tools(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        # Anthropic shape {"name", "description", "input_schema"} ->
        # OpenAI shape {"type": "function", "function": {"name",
        # "description", "parameters"}}. This is the one mechanical
        # translation needed to keep tool definitions provider-agnostic
        # in main.py.
        return [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t["input_schema"],
                },
            }
            for t in tools
        ]

    async def call(
        self,
        system: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        force_tool: Optional[str] = None,
        max_tokens: int = 1200,
    ) -> ToolCallResult:
        openai_messages = [{"role": "system", "content": system}] + messages

        kwargs: Dict[str, Any] = dict(
            model=self.model,
            max_tokens=max_tokens,
            messages=openai_messages,
        )
        if tools:
            kwargs["tools"] = self._to_openai_tools(tools)
            if force_tool:
                kwargs["tool_choice"] = {"type": "function", "function": {"name": force_tool}}
            else:
                kwargs["tool_choice"] = "auto"

        response = await self.client.chat.completions.create(**kwargs)
        message = response.choices[0].message

        tool_calls = []
        if message.tool_calls:
            import json as _json
            for tc in message.tool_calls:
                try:
                    args = _json.loads(tc.function.arguments)
                except (ValueError, TypeError):
                    args = {}
                tool_calls.append(ToolCall(id=tc.id, name=tc.function.name, input=args))

        # OpenAI-compatible providers want the assistant message (including
        # its raw tool_calls field) appended verbatim for the next turn.
        raw_assistant_message = {
            "role": "assistant",
            "content": message.content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in (message.tool_calls or [])
            ] or None,
        }

        return ToolCallResult(tool_calls=tool_calls, text=message.content, raw_assistant_message=raw_assistant_message)

    def format_tool_results(self, tool_calls: List[ToolCall], results: List[Any]) -> List[Dict[str, Any]]:
        # OpenAI-compatible shape: one separate role="tool" message PER
        # tool call, each tagged with tool_call_id to match it up.
        return [
            {"role": "tool", "tool_call_id": tc.id, "content": str(result)}
            for tc, result in zip(tool_calls, results)
        ]

    def format_assistant_text(self, text: str) -> Dict[str, Any]:
        return {"role": "assistant", "content": text}


def build_client_from_env(role: str) -> LLMClient:
    """role is 'coach' or 'tool_orchestrator' or 'nl_interpreter' --
    lets different parts of the app use different providers/models via
    env vars, e.g. cheap model for tool orchestration + NL interpretation,
    stronger model for the final coaching reply, per the hybrid split
    discussed. Falls back to sane defaults if unset."""
    prefix = role.upper()
    provider = os.environ.get(f"{prefix}_PROVIDER", os.environ.get("LLM_PROVIDER", "anthropic")).lower()
    model = os.environ.get(f"{prefix}_MODEL")

    if provider == "zai":
        return ZaiClient(model=model or "glm-4.7")
    elif provider == "anthropic":
        return AnthropicClient(model=model or "claude-sonnet-5")
    else:
        raise ValueError(f"Unknown LLM provider '{provider}' for role '{role}' -- expected 'anthropic' or 'zai'")
