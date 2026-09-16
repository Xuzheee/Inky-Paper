"""A narrow server-side proxy; the Paper token never enters chat or the UI."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter

router = APIRouter()
MAX_BODY = 524288
MAX_ERROR = 32768


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _connection_file(action):
    if action == "adopt_plan_cards":
        override = os.environ.get("INKY_PAPER_USER_CONNECTION_FILE")
        if override:
            return Path(override)
        model_file = os.environ.get("INKY_PAPER_CONNECTION_FILE")
        if model_file:
            return Path(model_file).with_name("paper-user-bridge.json")
        return Path(os.environ.get("APPDATA", "")) / "com.inky.paper" / "paper-user-bridge.json"
    override = os.environ.get("INKY_PAPER_CONNECTION_FILE")
    if override:
        return Path(override)
    return Path(os.environ.get("APPDATA", "")) / "com.inky.paper" / "paper-agent-bridge.json"


def _error(message, definitive=False):
    return {"ok": False, "error": message, "definitive": definitive}


def paper_request(action, payload):
    if action not in {"get_plan_batch", "adopt_plan_cards"}:
        return _error("INVALID_INPUT: unsupported action", True)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(body) > MAX_BODY:
        return _error("INVALID_INPUT: 所选卡片内容过长，请减少本批卡片。", True)
    try:
        connection = json.loads(_connection_file(action).read_text(encoding="utf-8"))
        if action == "adopt_plan_cards" and connection.get("capability") != "user-adoption":
            return _error("FORBIDDEN: 需要 Paper 提供的本地用户采用连接，请更新并重启 Paper。", True)
        url = urlsplit(connection["url"])
        token = connection.get("token")
        if (
            connection.get("app") != "inky-paper"
            or connection.get("protocolVersion") != 1
            or url.scheme != "http"
            or url.hostname != "127.0.0.1"
            or url.username or url.password
            or url.path not in {"", "/"}
            or url.query or url.fragment
            or url.port is None
            or not isinstance(token, str) or not token or "\r" in token or "\n" in token
        ):
            return _error("连接文件不是有效的 Inky Paper 本机连接。")
    except (OSError, ValueError, KeyError, TypeError):
        return _error("尚未连接 Inky Paper，请先打开 Paper；选择与草稿仍保留。")

    request = urllib.request.Request(
        f"http://127.0.0.1:{url.port}/{action}", data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    # Ignore OS proxy settings for this explicit local-only connection.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=6) as response:
            result = json.load(response)
        if not isinstance(result, dict) or "data" not in result:
            return _error("Paper 未返回可核实的保存结果，请保留原提交重试。")
        return {"ok": True, "data": result["data"]}
    except urllib.error.HTTPError as exc:
        try:
            message = json.loads(exc.read(MAX_ERROR)).get("error", "")
        except (ValueError, AttributeError):
            message = ""
        # Only Paper's known validation/conflict failures confirm no mutation.
        known = isinstance(message, str) and message.startswith(
            ("CONFLICT:", "INVALID_INPUT:", "NOT_FOUND:", "BUSY:", "FORBIDDEN:", "ACTIVE_SESSION:", "REQUEST_ID_REUSED:")
        )
        return _error(message if known else "Paper 暂未确认保存；可用原提交重试。", known)
    except (OSError, ValueError, TypeError):
        return _error("未收到 Paper 的确认；保留本次提交，重连后重试以核实保存。")


@router.get("/batches/{batch_id}")
def get_batch(batch_id: str):
    try:
        UUID(batch_id)
    except ValueError:
        return _error("INVALID_INPUT: batchId", True)
    return paper_request("get_plan_batch", {"batchId": batch_id})


@router.post("/adopt")
def adopt(body: dict):
    # Selection is submitted by an explicit user click, never a model hook.
    allowed = {"requestId", "batchId", "expectedRevision", "date", "cardIds", "cardOverrides"}
    if not isinstance(body, dict) or set(body) - allowed:
        return _error("INVALID_INPUT: adopt fields", True)
    return paper_request("adopt_plan_cards", body)
