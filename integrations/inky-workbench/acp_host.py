"""Inky's ACP host: use Hermes auth/model, with only the session's Paper MCP.

Hermes session construction also discovers MCP from load_config(), even when
HERMES_ACP_SKIP_CONFIGURED_MCP disables its entry-point discovery. Filter the
configuration in this child process; never rewrite the user's Hermes config.
"""
import copy
import os
from pathlib import Path

os.environ["HERMES_ACP_SKIP_CONFIGURED_MCP"] = "1"
import hermes_bootstrap  # noqa: E402, F401
from hermes_cli import config  # noqa: E402

_load_config = config.load_config


def workbench_config(*args, **kwargs):
    loaded = copy.deepcopy(_load_config(*args, **kwargs))
    loaded["mcp_servers"] = {}
    loaded.setdefault("platform_toolsets", {})["acp"] = ["mcp-inky_workbench"]
    # These belong to other Hermes workflows. Inky supplies only visible,
    # editable context through its own request snapshot (and M4 preferences).
    loaded["memory"] = {"provider":"", "memory_enabled":False, "user_profile_enabled":False}
    loaded.setdefault("tools", {})["tool_search"] = {"enabled":"off"}
    return loaded


config.load_config = workbench_config
config.load_config_readonly = workbench_config

# Do not give the model file, shell, browser or delegation tools that could
# bypass Paper's candidate boundary. This changes only this child process.
from acp_adapter import session as acp_session  # noqa: E402


def paper_toolsets(toolsets=None, mcp_server_names=None):
    return ["mcp-inky_workbench"]


acp_session._expand_acp_enabled_toolsets = paper_toolsets


def workbench_session_db(self):
    """Keep ACP history with this Paper instance; reuse Hermes model/auth only."""
    if self._db_instance is None:
        from hermes_state import SessionDB
        folder = Path(os.environ["INKY_WORKBENCH_STATE_DIR"])
        self._db_instance = SessionDB(db_path=folder / "hermes-state.sqlite3")
    return self._db_instance


acp_session.SessionManager._get_db = workbench_session_db
from acp_adapter import server as acp_server  # noqa: E402
acp_server._expand_acp_enabled_toolsets = paper_toolsets

import model_tools  # noqa: E402
_tool_definitions = model_tools.get_tool_definitions
_allowed_actions = {
    "list_tasks", "get_task", "read_history", "read_events", "get_coach_context",
    "propose_coaching_action", "propose_plan_batch", "get_plan_batch",
    "get_daily_record", "save_daily_summary", "propose_plan_adjustment",
    "get_plan_adjustment",
}
_allowed_names = {f"mcp__inky_workbench__inky_paper_{action}" for action in _allowed_actions}


def paper_tools(*args, **kwargs):
    # Hermes may collapse MCP definitions behind tool_search. Inky exposes a
    # small fixed set directly, so never substitute a generic dispatch tool.
    if len(args) >= 4:
        args = (*args[:3], True, *args[4:])
    else:
        kwargs["skip_tool_search_assembly"] = True
    return [tool for tool in _tool_definitions(*args, **kwargs)
            if tool.get("function", {}).get("name") in _allowed_names]


model_tools.get_tool_definitions = paper_tools

from acp_adapter.entry import main  # noqa: E402

if __name__ == "__main__":
    main()
