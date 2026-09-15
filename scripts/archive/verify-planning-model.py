"""Bounded real-model acceptance against the explicit Paper test bridge only.

Preparation is side-effect-free by default. Pass --execute only after desktop
execution acceptance finishes. No production config or task data is modified.
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import datetime as dt
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import sys
import urllib.parse
import uuid
from unittest.mock import patch


PROJECT = Path(__file__).resolve().parents[1]
OUTPUT = PROJECT / "output" / "implementation-20260913"
BRIDGE = OUTPUT / "paper-test" / "paper-agent-bridge.json"
OPERATIONS = {
    "list_tasks", "get_task", "create_task", "update_task", "read_history",
    "read_events", "get_coach_context", "propose_coaching_action",
    "propose_plan_batch", "get_plan_batch", "get_daily_record", "save_daily_summary",
}
PERMITTED_WRITES = {"save_daily_summary"}
READS = {"list_tasks", "get_task", "read_history", "read_events",
         "get_coach_context", "get_plan_batch", "get_daily_record"}


def digest(value):
    if isinstance(value, dict):
        value = {key: item for key, item in value.items() if key != "journal"}
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def unwrap(value):
    """Decode Hermes' registry envelope without exposing authentication details."""
    for _ in range(6):
        if isinstance(value, str):
            value = json.loads(value)
            continue
        assert isinstance(value, dict), "Unexpected tool response"
        assert not value.get("error") and not value.get("is_error") and not value.get("isError"), "Tool returned an error"
        if "structuredContent" in value:
            value = value["structuredContent"]
        elif "result" in value:
            value = value["result"]
        elif isinstance(value.get("content"), list):
            blocks = [item.get("text") for item in value["content"] if item.get("type") == "text"]
            assert len(blocks) == 1, "Unexpected tool content"
            value = blocks[0]
        else:
            return value
    raise AssertionError("Tool response nesting is unsupported")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--date", default=dt.datetime.now().astimezone().date().isoformat())
    parser.add_argument("--note-evidence", default="", help="Short phrase that must be read from test personal notes; never included in the model prompt")
    args = parser.parse_args()
    dt.date.fromisoformat(args.date)
    if not args.execute:
        print("PREPARED: no model, MCP or bridge operation ran. Use --execute after execution acceptance.")
        return

    report = {"result": "FAIL", "date": args.date, "stage": "validate_test_boundary"}
    registration_started = False
    model_phase = False
    audited_calls = []
    report_path = OUTPUT / "planning-model-verification.json"
    OUTPUT.mkdir(parents=True, exist_ok=True)
    try:
        assert BRIDGE.resolve().parent == (OUTPUT / "paper-test").resolve(), "Test bridge path changed"
        connection = json.loads(BRIDGE.read_text(encoding="utf-8"))
        url = urllib.parse.urlparse(connection["url"])
        assert connection["app"] == "inky-paper" and connection["protocolVersion"] == 1, "Wrong app connection"
        assert url.scheme == "http" and url.hostname == "127.0.0.1" and not url.username and not url.password, "Non-local bridge"
        assert isinstance(connection.get("token"), str) and connection["token"], "Missing bridge authentication"
        del connection

        roots = [Path.home() / ".hermes" / "hermes-agent", Path.home() / "Documents" / "hermes"]
        hermes = next(root for root in roots if (root / "run_agent.py").is_file())
        node = Path(r"C:\Program Files\nodejs\node.exe")
        assert node.is_file(), "Node runtime is unavailable"
        sys.path.insert(0, str(hermes))
        os.chdir(OUTPUT)
        os.environ["PYTHONIOENCODING"] = "utf-8"
        os.environ["PYTHONUTF8"] = "1"
        logging.disable(logging.CRITICAL)
        # Provider setup can print account details: discard all SDK diagnostics.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            from hermes_cli.config import load_config_readonly
            from hermes_cli.runtime_provider import resolve_runtime_provider
            import hermes_cli.config as config_module
            import hermes_cli.plugins as plugins_module
            config = load_config_readonly()
            model_config = config.get("model", {})
            model = model_config.get("default", "") if isinstance(model_config, dict) else str(model_config)
            model = model or "gpt-5.6-sol"
            runtime = resolve_runtime_provider(target_model=model)
            report.update(model=model, provider=runtime.get("provider"), stage="register_test_tools")
            from tools import mcp_tool
            from tools.registry import registry
            # The actual installed runtime is used. Only its in-process optional
            # discovery/configuration is isolated; no saved settings are edited.
            isolated_config = {
                "model": copy.deepcopy(model_config),
                "context": {"engine": "compressor"},
                "compression": {"enabled": False},
                "memory": {"enabled": False},
                "skills": {"enabled": False},
                "mcp_servers": {},
            }
            with contextlib.ExitStack() as stack:
                stack.enter_context(patch.object(plugins_module, "discover_plugins", lambda *a, **k: None))
                stack.enter_context(patch.object(config_module, "load_config", lambda: copy.deepcopy(isolated_config)))
                stack.enter_context(patch.object(config_module, "load_config_readonly", lambda: copy.deepcopy(isolated_config)))
                stack.enter_context(patch.object(mcp_tool, "discover_mcp_tools", lambda *a, **k: []))
                server_name = "paper_planning_acceptance"
                registration_started = True
                names = mcp_tool.register_mcp_servers({server_name: {
                    "command": str(node),
                    "args": [str(PROJECT / "integrations" / "inky-paper-mcp-server" / "index.mjs")],
                    "env": {"INKY_PAPER_CONNECTION_FILE": str(BRIDGE)},
                }})
                by_operation = {operation: next((name for name in names if name.endswith("inky_paper_" + operation)), None) for operation in OPERATIONS}
                assert len(names) == 12 and all(by_operation.values()), "Expected exactly the 12 test MCP tools"
                assert all(server_name in name for name in names), "Unexpected MCP server registration"
                allowed_names = set(names)
                original_dispatch = registry.dispatch

                def guarded_dispatch(name, arguments, **kwargs):
                    operation = next((op for op, tool in by_operation.items() if tool == name), None)
                    assert name in allowed_names and operation in READS | PERMITTED_WRITES, "Operation outside this summary acceptance"
                    value = original_dispatch(name, arguments, **kwargs)
                    if model_phase:
                        audited_calls.append({"operation": operation, "name": name,
                                              "arguments": copy.deepcopy(arguments), "response": unwrap(value)})
                    return value

                stack.enter_context(patch.object(registry, "dispatch", guarded_dispatch))
                def call(operation, arguments):
                    return unwrap(registry.dispatch(by_operation[operation], arguments))

                offset = int(dt.datetime.now().astimezone().utcoffset().total_seconds() // 60)
                date_input = {"date": args.date, "utcOffsetMinutes": offset}
                before = call("get_daily_record", date_input)
                parents = [item["task"] for item in before.get("planItems", [])
                           if item.get("step", {}).get("completed") and item.get("task") and not item["task"]["completed"]]
                assert before.get("sessions") and parents, "Finish an execution step while its parent task remains incomplete first"
                notes = before.get("personalNotes", "")
                assert notes and (not args.note_evidence or args.note_evidence in notes), "Expected handwritten note evidence is unavailable"
                outputs = [item.get("feedback", {}).get("output", "") for item in before["sessions"] if item.get("feedback")]
                assert any(outputs), "Execution feedback must include a real saved output"
                task_baselines = {task["id"]: call("get_task", {"taskId": task["id"]}) for task in parents}

                import model_tools
                import run_agent
                toolsets = sorted({registry.get_toolset_for_tool(name) for name in names})
                definitions = model_tools.get_tool_definitions(enabled_toolsets=toolsets, quiet_mode=True, skip_tool_search_assembly=True)
                assert {item["function"]["name"] for item in definitions} == allowed_names, "Model tool catalog differs from test catalog"
                stack.enter_context(patch.object(run_agent, "get_tool_definitions", lambda *a, **k: copy.deepcopy(definitions)))
                stack.enter_context(patch.object(mcp_tool, "refresh_agent_mcp_tools", lambda *a, **k: set()))
                skill = (PROJECT / "integrations/inky-coach-hermes-plugin/skills/coach/SKILL.md").read_text(encoding="utf-8")
                agent = run_agent.AIAgent(
                    model=model, provider=runtime.get("provider"), base_url=runtime.get("base_url"),
                    api_key=runtime.get("api_key"), api_mode=runtime.get("api_mode"),
                    enabled_toolsets=toolsets, max_iterations=10, max_tokens=1800,
                    quiet_mode=True, skip_context_files=True, load_soul_identity=False,
                    skip_memory=True, skip_background_review=True, save_trajectories=False,
                    checkpoints_enabled=False, session_db=None, run_budget_seconds=150,
                    ephemeral_system_prompt=skill, reasoning_config={"effort": "low"},
                )
                agent._skip_mcp_refresh = True
                agent._dump_api_request_debug = lambda *a, **k: None
                agent._save_session_log = lambda *a, **k: None
                assert {item["function"]["name"] for item in agent.tools} == allowed_names, "Agent gained an unexpected tool"
                assert agent._session_db is None and not agent.save_trajectories and agent.skip_background_review
                report.update(stage="model_requested_summary", catalog=sorted(names),
                              contextFiles=False, memory=False, backgroundReview=False, trajectories=False,
                              configurationModified=False, onlySummaryWriteAllowed=True)
                model_phase = True
                result = agent.run_conversation(
                    f"我现在主动请你总结 {args.date} 的工作，时区偏移为 {offset} 分钟，并保存每日总结。"
                    "请先通过 Inky Paper 工具读取这一天的最新真实计划、执行反馈和个人笔记，再写总结。"
                    "正文请包含实际产出、哪些步骤完成但父任务尚未完成、个人笔记提到的具体情况和下一次起点；"
                    "为便于复盘，请用引号保留个人笔记里一句具体安排或提醒，并保留已记录产出的名称。"
                    "只保存总结，不更改任务、计划、卡片或时钟，也不设置任何自动行动。"
                    "使用读取结果中的 dataVersion、notesVersion、sampledAt 保存；有冲突就重新读取后修订。"
                    "保存成功后用两句话告诉我结果，计时只能称为记录时间。"
                )
                model_phase = False
                report["stage"] = "verify_saved_summary"
                calls = [item["operation"] for item in audited_calls]
                assert "get_daily_record" in calls and "save_daily_summary" in calls, "Required real tool calls were not made"
                saved_call = next(item for item in reversed(audited_calls) if item["operation"] == "save_daily_summary")
                prior_read = next(item for item in reversed(audited_calls[:audited_calls.index(saved_call)]) if item["operation"] == "get_daily_record")
                arguments = saved_call["arguments"]
                source = prior_read["response"]
                assert arguments["expectedDataVersion"] == source["dataVersion"]
                assert arguments["expectedNotesVersion"] == source["notesVersion"]
                assert arguments["sourceAsOf"] == source["sampledAt"]
                after = call("get_daily_record", date_input)
                summary_id = saved_call["response"]["summary"]["id"]
                summary = next(item for item in after["summaries"] if item["id"] == summary_id)
                body = summary["body"]
                assert not summary["hasNewRecords"], "Saved summary already has newer facts"
                for task_id, baseline in task_baselines.items():
                    assert digest(call("get_task", {"taskId": task_id})) == digest(baseline), "Parent task or execution snapshot changed"
                assert after["notesVersion"] == before["notesVersion"], "Personal notes were modified"
                markdown = OUTPUT / "paper-test" / "工作记录" / "每日" / f"{args.date}.md"
                assert body in markdown.read_text(encoding="utf-8"), "Saved summary is not visible in Markdown"
                checks = {
                    "noteEvidencePresent": args.note_evidence in body if args.note_evidence else any(line.strip() in body for line in notes.splitlines() if len(line.strip()) >= 4 and not line.startswith("#")),
                    "savedOutputPresent": any(output and output in body for output in outputs),
                    "distinguishesStepAndParent": any(term in body for term in ("父任务", "整体任务", "整个任务")) and any(term in body for term in ("未完成", "尚未完成", "没有完成", "不等于")),
                    "versionsMatchRead": True, "parentTasksUnchanged": True,
                    "personalNotesUnchanged": True, "markdownContainsSavedBody": True,
                }
                report.update(result="PASS" if all(checks.values()) else "NEEDS_CONTENT_REVIEW",
                              stage="complete", checks=checks, toolCalls=calls,
                              summary=summary, finalResponse=result.get("final_response", result.get("response", "")),
                              readVersions={key: source[key] for key in ("dataVersion", "notesVersion", "sampledAt")},
                              modelMessagesWithTools=sum(bool(message.get("tool_calls")) for message in result.get("messages", [])),
                              markdownPath=str(markdown))
    except Exception as exc:
        report.update(errorType=type(exc).__name__)
        # Only assertions authored in this harness are safe to include. SDK errors
        # may contain account details and are deliberately not written or printed.
        if isinstance(exc, AssertionError):
            report["checkFailure"] = str(exc)
        raise
    finally:
        if registration_started:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                try:
                    mcp_tool.shutdown_mcp_servers()
                except Exception:
                    pass
        report["toolCalls"] = [item["operation"] for item in audited_calls]
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print("PLANNING_MODEL_" + report["result"], "stage=" + report["stage"], str(report_path))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("PLANNING_MODEL_STOPPED", type(error).__name__)
        sys.exit(1)
