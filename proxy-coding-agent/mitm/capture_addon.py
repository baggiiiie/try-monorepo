"""mitmproxy addon: capture LLM-provider traffic as JSONL.

Reads two env vars:
  CAPTURE_JSONL     Path to the JSONL file to append to (required).
  CAPTURE_AGENT     Tag to embed in every record (optional, default "unknown").

Only flows whose request host matches LLM_HOSTS are captured. SSE responses
(``content-type: text/event-stream``) are parsed: ``data:`` lines are JSON-
decoded when possible and returned as a list of events under ``sse_events``;
the raw body is also kept under ``resp_body_raw``.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

from mitmproxy import http


LLM_HOSTS = (
    "api.openai.com",
    "chatgpt.com",
    "codex-api.openai.com",
    "api.anthropic.com",
    "api.cursor.sh",
    "api2.cursor.sh",
    "api.x.ai",
    "generativelanguage.googleapis.com",
    "api.groq.com",
    "api.deepseek.com",
    "api.mistral.ai",
    "openrouter.ai",
)


def _host_matches(host: str) -> bool:
    host = host.lower()
    return any(host == h or host.endswith("." + h) for h in LLM_HOSTS)


def _try_json(data: bytes) -> Any:
    if not data:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        try:
            return data.decode("utf-8", errors="replace")
        except Exception:
            return f"<{len(data)} bytes>"


def _parse_sse(raw: bytes) -> list[Any]:
    events: list[Any] = []
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        return events
    for chunk in text.split("\n\n"):
        data_lines = [
            line[len("data:"):].lstrip()
            for line in chunk.splitlines()
            if line.startswith("data:")
        ]
        if not data_lines:
            continue
        payload = "\n".join(data_lines)
        if payload.strip() == "[DONE]":
            events.append("[DONE]")
            continue
        try:
            events.append(json.loads(payload))
        except json.JSONDecodeError:
            events.append(payload)
    return events


class JsonlCapture:
    def __init__(self) -> None:
        self.path = os.environ.get("CAPTURE_JSONL")
        self.agent = os.environ.get("CAPTURE_AGENT", "unknown")
        if not self.path:
            raise RuntimeError("CAPTURE_JSONL env var is required")
        # Truncate / create.
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        open(self.path, "a").close()

    def _write(self, record: dict[str, Any]) -> None:
        record.setdefault("ts", time.time())
        record.setdefault("agent", self.agent)
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")

    def response(self, flow: http.HTTPFlow) -> None:
        if not _host_matches(flow.request.host):
            return

        req = flow.request
        resp = flow.response
        record: dict[str, Any] = {
            "kind": "http",
            "host": req.host,
            "port": req.port,
            "method": req.method,
            "scheme": req.scheme,
            "path": req.path,
            "url": req.pretty_url,
            "http_version": req.http_version,
            "req_headers": list(req.headers.items()),
            "req_body": _try_json(req.raw_content or b""),
            "resp_status": resp.status_code if resp else None,
            "resp_headers": list(resp.headers.items()) if resp else None,
        }

        if resp is not None:
            content_type = resp.headers.get("content-type", "")
            raw = resp.raw_content or b""
            if "text/event-stream" in content_type:
                record["resp_body"] = None
                record["sse_events"] = _parse_sse(raw)
            else:
                record["resp_body"] = _try_json(raw)

        self._write(record)

    # ----- WebSocket support ----------------------------------------------
    # Codex (ChatGPT account) streams LLM responses over a WebSocket at
    # wss://chatgpt.com/backend-api/codex/responses. mitmproxy delivers each
    # frame to websocket_message; we dump them on websocket_end as a single
    # record per connection so the conversation order is preserved.

    def websocket_end(self, flow: http.HTTPFlow) -> None:
        if not _host_matches(flow.request.host):
            return
        ws = flow.websocket
        if ws is None:
            return

        messages = []
        for msg in ws.messages:
            content = msg.content
            try:
                text = content.decode("utf-8")
                parsed: Any
                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError:
                    parsed = text
            except UnicodeDecodeError:
                parsed = f"<binary {len(content)} bytes>"
            messages.append({
                "from_client": msg.from_client,
                "type": "text" if msg.is_text else "binary",
                "ts": msg.timestamp,
                "data": parsed,
            })

        self._write({
            "kind": "websocket",
            "host": flow.request.host,
            "path": flow.request.path,
            "url": flow.request.pretty_url,
            "req_headers": list(flow.request.headers.items()),
            "resp_headers": list(flow.response.headers.items()) if flow.response else None,
            "messages": messages,
            "closed_by_client": ws.closed_by_client,
            "close_code": ws.close_code,
            "close_reason": ws.close_reason,
        })


addons = [JsonlCapture()]
