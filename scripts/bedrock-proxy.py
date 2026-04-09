"""
Lightweight OpenAI-compatible proxy for AWS Bedrock Converse API.

Translates /v1/chat/completions requests into Bedrock converse/converse_stream
calls, using inference profile ARNs so on-demand models work correctly.

Supports: text, tool definitions, tool_calls responses, tool result messages,
streaming and non-streaming.

Usage:
    python3 scripts/bedrock-proxy.py [--port 4000]
"""

import argparse
import json
import os
import sys
import time
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

os.environ.setdefault("HTTP_PROXY", "http://127.0.0.1:7890")
os.environ.setdefault("HTTPS_PROXY", "http://127.0.0.1:7890")
os.environ.setdefault("http_proxy", "http://127.0.0.1:7890")
os.environ.setdefault("https_proxy", "http://127.0.0.1:7890")

import boto3
from botocore.config import Config as BotoConfig

REGION = "us-east-1"
ACCOUNT_ID = "493919098970"

MODEL_ALIASES = {
    "claude-opus-4-6": "us.anthropic.claude-opus-4-6-v1",
    "claude-sonnet-4-6": "us.anthropic.claude-sonnet-4-6",
    "claude-sonnet-4-5": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "claude-opus-4-5": "us.anthropic.claude-opus-4-5-20251101-v1:0",
    "claude-opus-4-1": "us.anthropic.claude-opus-4-1-20250805-v1:0",
    "claude-opus-4": "us.anthropic.claude-opus-4-20250514-v1:0",
    "claude-sonnet-4": "us.anthropic.claude-sonnet-4-20250514-v1:0",
    "claude-haiku-4-5": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "claude-3-7-sonnet": "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    "claude-3-5-haiku": "us.anthropic.claude-3-5-haiku-20241022-v1:0",
}


def resolve_model_id(model_input: str) -> str:
    cleaned = model_input.removeprefix("bedrock/").removeprefix("converse/")
    if cleaned in MODEL_ALIASES:
        cleaned = MODEL_ALIASES[cleaned]
    if cleaned.startswith("arn:"):
        return cleaned
    if cleaned.startswith("us.") or cleaned.startswith("global."):
        return (
            f"arn:aws:bedrock:{REGION}:{ACCOUNT_ID}:"
            f"inference-profile/{cleaned}"
        )
    if cleaned.startswith("anthropic.") or cleaned.startswith("amazon."):
        return (
            f"arn:aws:bedrock:{REGION}:{ACCOUNT_ID}:"
            f"inference-profile/us.{cleaned}"
        )
    return (
        f"arn:aws:bedrock:{REGION}:{ACCOUNT_ID}:"
        f"inference-profile/{cleaned}"
    )


# ---------------------------------------------------------------------------
# OpenAI tools -> Bedrock toolConfig
# ---------------------------------------------------------------------------

def openai_tools_to_bedrock(tools: list | None) -> dict | None:
    if not tools:
        return None
    bedrock_tools = []
    for tool in tools:
        if tool.get("type") != "function":
            continue
        fn = tool.get("function", {})
        spec = {
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
        }
        params = fn.get("parameters")
        if params:
            spec["inputSchema"] = {"json": params}
        bedrock_tools.append({"toolSpec": spec})
    if not bedrock_tools:
        return None
    return {"tools": bedrock_tools}


# ---------------------------------------------------------------------------
# OpenAI messages -> Bedrock messages
# ---------------------------------------------------------------------------

def openai_messages_to_bedrock(messages: list) -> tuple[list, list | None]:
    system_prompts = []
    converse_messages = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if role == "system":
            if isinstance(content, str) and content:
                system_prompts.append({"text": content})
            continue

        if role == "tool":
            tool_call_id = msg.get("tool_call_id", "")
            result_content = content if isinstance(content, str) else json.dumps(content)
            converse_messages.append({
                "role": "user",
                "content": [{
                    "toolResult": {
                        "toolUseId": tool_call_id,
                        "content": [{"text": result_content}],
                    }
                }],
            })
            continue

        if role == "assistant":
            blocks = []
            if isinstance(content, str) and content:
                blocks.append({"text": content})
            elif isinstance(content, list):
                for item in content:
                    if isinstance(item, str):
                        blocks.append({"text": item})
                    elif isinstance(item, dict) and item.get("type") == "text":
                        blocks.append({"text": item.get("text", "")})

            tool_calls = msg.get("tool_calls", [])
            for tc in tool_calls:
                fn = tc.get("function", {})
                args_str = fn.get("arguments", "{}")
                try:
                    args_obj = json.loads(args_str)
                except (json.JSONDecodeError, TypeError):
                    args_obj = {}
                blocks.append({
                    "toolUse": {
                        "toolUseId": tc.get("id", f"tool_{uuid.uuid4().hex[:8]}"),
                        "name": fn.get("name", ""),
                        "input": args_obj,
                    }
                })

            if blocks:
                converse_messages.append({"role": "assistant", "content": blocks})
            continue

        # user role
        if isinstance(content, str):
            converse_messages.append(
                {"role": "user", "content": [{"text": content or " "}]}
            )
        elif isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, str):
                    parts.append({"text": item})
                elif isinstance(item, dict) and item.get("type") == "text":
                    parts.append({"text": item.get("text", "")})
            if parts:
                converse_messages.append({"role": "user", "content": parts})

    # Bedrock requires alternating user/assistant. Merge consecutive same-role.
    merged = _merge_consecutive_roles(converse_messages)
    return merged, system_prompts or None


def _merge_consecutive_roles(messages: list) -> list:
    if not messages:
        return messages
    merged = [messages[0]]
    for msg in messages[1:]:
        if msg["role"] == merged[-1]["role"]:
            merged[-1]["content"].extend(msg["content"])
        else:
            merged.append(msg)
    return merged


# ---------------------------------------------------------------------------
# Bedrock response -> OpenAI response (non-streaming)
# ---------------------------------------------------------------------------

def bedrock_to_openai_response(result: dict, model: str) -> dict:
    output = result.get("output", {})
    message = output.get("message", {})
    content_blocks = message.get("content", [])

    text_parts = [b["text"] for b in content_blocks if "text" in b]
    text = "".join(text_parts) or None

    tool_calls = []
    for block in content_blocks:
        if "toolUse" in block:
            tu = block["toolUse"]
            tool_calls.append({
                "id": tu.get("toolUseId", f"call_{uuid.uuid4().hex[:8]}"),
                "type": "function",
                "function": {
                    "name": tu.get("name", ""),
                    "arguments": json.dumps(tu.get("input", {})),
                },
            })

    stop_reason = result.get("stopReason", "end_turn")
    usage = result.get("usage", {})

    oai_message = {"role": "assistant", "content": text}
    if tool_calls:
        oai_message["tool_calls"] = tool_calls

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": oai_message,
                "finish_reason": _map_stop_reason(stop_reason),
            }
        ],
        "usage": {
            "prompt_tokens": usage.get("inputTokens", 0),
            "completion_tokens": usage.get("outputTokens", 0),
            "total_tokens": usage.get("inputTokens", 0)
            + usage.get("outputTokens", 0),
        },
    }


def _map_stop_reason(reason: str) -> str:
    mapping = {
        "end_turn": "stop",
        "max_tokens": "length",
        "stop_sequence": "stop",
        "tool_use": "tool_calls",
        "content_filtered": "content_filter",
    }
    return mapping.get(reason, "stop")


# ---------------------------------------------------------------------------
# Bedrock stream -> OpenAI SSE chunks (with tool call support)
# ---------------------------------------------------------------------------

def stream_bedrock_to_openai(response_stream, model: str):
    chunk_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"

    first_chunk = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": {"role": "assistant", "content": ""},
                "finish_reason": None,
            }
        ],
    }
    yield f"data: {json.dumps(first_chunk)}\n\n"

    # Track tool use blocks by their content block index
    tool_index_map = {}  # bedrock contentBlockIndex -> openai tool_calls array index
    next_tool_index = 0

    for event in response_stream.get("stream", []):
        if "contentBlockStart" in event:
            start = event["contentBlockStart"]
            block_idx = start.get("contentBlockIndex", 0)
            if "toolUse" in start.get("start", {}):
                tu = start["start"]["toolUse"]
                tool_idx = next_tool_index
                tool_index_map[block_idx] = tool_idx
                next_tool_index += 1
                chunk = {
                    "id": chunk_id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "delta": {
                            "tool_calls": [{
                                "index": tool_idx,
                                "id": tu.get("toolUseId", f"call_{uuid.uuid4().hex[:8]}"),
                                "type": "function",
                                "function": {
                                    "name": tu.get("name", ""),
                                    "arguments": "",
                                },
                            }],
                        },
                        "finish_reason": None,
                    }],
                }
                yield f"data: {json.dumps(chunk)}\n\n"

        elif "contentBlockDelta" in event:
            cbd = event["contentBlockDelta"]
            block_idx = cbd.get("contentBlockIndex", 0)
            delta = cbd.get("delta", {})

            if "text" in delta and delta["text"]:
                chunk = {
                    "id": chunk_id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "delta": {"content": delta["text"]},
                        "finish_reason": None,
                    }],
                }
                yield f"data: {json.dumps(chunk)}\n\n"

            elif "toolUse" in delta:
                input_chunk = delta["toolUse"].get("input", "")
                tool_idx = tool_index_map.get(block_idx, 0)
                chunk = {
                    "id": chunk_id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "delta": {
                            "tool_calls": [{
                                "index": tool_idx,
                                "function": {
                                    "arguments": input_chunk,
                                },
                            }],
                        },
                        "finish_reason": None,
                    }],
                }
                yield f"data: {json.dumps(chunk)}\n\n"

        elif "messageStop" in event:
            stop_reason = event["messageStop"].get("stopReason", "end_turn")
            chunk = {
                "id": chunk_id,
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {},
                    "finish_reason": _map_stop_reason(stop_reason),
                }],
            }
            yield f"data: {json.dumps(chunk)}\n\n"

        elif "metadata" in event:
            usage = event["metadata"].get("usage", {})
            if usage:
                usage_chunk = {
                    "id": chunk_id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [],
                    "usage": {
                        "prompt_tokens": usage.get("inputTokens", 0),
                        "completion_tokens": usage.get("outputTokens", 0),
                        "total_tokens": usage.get("inputTokens", 0)
                        + usage.get("outputTokens", 0),
                    },
                }
                yield f"data: {json.dumps(usage_chunk)}\n\n"

    yield "data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class BedrockProxyHandler(BaseHTTPRequestHandler):
    client = None

    def setup(self):
        super().setup()
        self.wfile = self.request.makefile("wb", 0)

    def log_message(self, format, *args):
        print(f"[bedrock-proxy] {args[0]}", file=sys.stderr, flush=True)

    def do_GET(self):
        if self.path == "/v1/models" or self.path == "/models":
            models_data = {
                "object": "list",
                "data": [
                    {
                        "id": alias,
                        "object": "model",
                        "owned_by": "aws-bedrock",
                    }
                    for alias in MODEL_ALIASES
                ],
            }
            self._json_response(200, models_data)
            return

        if self.path == "/health" or self.path == "/":
            self._json_response(200, {"status": "ok"})
            return

        self._json_response(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in (
            "/v1/chat/completions",
            "/chat/completions",
        ):
            self._json_response(404, {"error": "not found"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length))

        model_input = body.get("model", "claude-sonnet-4-6")
        model_arn = resolve_model_id(model_input)
        messages = body.get("messages", [])
        stream = body.get("stream", False)
        raw_max = body.get("max_tokens") or body.get("max_completion_tokens") or 16384
        max_tokens = max(raw_max, 16384)
        temperature = body.get("temperature")
        top_p = body.get("top_p")
        tools = body.get("tools")
        tool_choice = body.get("tool_choice")
        print(f"[bedrock-proxy] model={model_input} stream={stream} "
              f"raw_max_tokens={raw_max} -> effective={max_tokens} "
              f"tools={len(tools) if tools else 0}",
              file=sys.stderr, flush=True)

        converse_messages, system_prompts = openai_messages_to_bedrock(messages)

        kwargs = {
            "modelId": model_arn,
            "messages": converse_messages,
        }
        if system_prompts:
            kwargs["system"] = system_prompts

        inference_config = {"maxTokens": max_tokens}
        if temperature is not None:
            inference_config["temperature"] = temperature
        if top_p is not None:
            inference_config["topP"] = top_p
        kwargs["inferenceConfig"] = inference_config

        tool_config = openai_tools_to_bedrock(tools)
        if tool_config:
            if tool_choice == "none":
                tool_config["toolChoice"] = {"auto": {}}
            elif tool_choice == "auto" or tool_choice is None:
                tool_config["toolChoice"] = {"auto": {}}
            elif tool_choice == "required":
                tool_config["toolChoice"] = {"any": {}}
            elif isinstance(tool_choice, dict) and tool_choice.get("type") == "function":
                tool_config["toolChoice"] = {"tool": {"name": tool_choice["function"]["name"]}}
            kwargs["toolConfig"] = tool_config

        try:
            if stream:
                response = self.__class__.client.converse_stream(**kwargs)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                for chunk_data in stream_bedrock_to_openai(
                    response, model_input
                ):
                    self.wfile.write(chunk_data.encode())
                    self.wfile.flush()
                self.close_connection = True
            else:
                response = self.__class__.client.converse(**kwargs)
                result = bedrock_to_openai_response(response, model_input)
                self._json_response(200, result)

        except Exception as e:
            error_msg = str(e)
            print(f"[bedrock-proxy] ERROR: {error_msg}", file=sys.stderr, flush=True)
            self._json_response(
                500, {"error": {"message": error_msg, "type": "server_error"}}
            )

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def _json_response(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Bedrock OpenAI proxy")
    parser.add_argument("--port", type=int, default=4000)
    args = parser.parse_args()

    BedrockProxyHandler.client = boto3.client(
        "bedrock-runtime",
        region_name=REGION,
        config=BotoConfig(
            read_timeout=600,
            connect_timeout=10,
            retries={"max_attempts": 2, "mode": "adaptive"},
        ),
    )

    server = ThreadedHTTPServer(("0.0.0.0", args.port), BedrockProxyHandler)
    print(f"[bedrock-proxy] Listening on http://0.0.0.0:{args.port}", file=sys.stderr, flush=True)
    print(f"[bedrock-proxy] Available models: {', '.join(MODEL_ALIASES.keys())}", file=sys.stderr, flush=True)
    print(f"[bedrock-proxy] OpenAI endpoint: http://localhost:{args.port}/v1/chat/completions", file=sys.stderr, flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[bedrock-proxy] Shutting down.", file=sys.stderr, flush=True)
        server.shutdown()


if __name__ == "__main__":
    main()
