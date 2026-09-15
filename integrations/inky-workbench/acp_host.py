"""Inky's ACP host: use Hermes auth/model, with only the session's Paper MCP.

Hermes session construction also discovers MCP from load_config(), even when
HERMES_ACP_SKIP_CONFIGURED_MCP disables its entry-point discovery. Filter the
configuration in this child process; never rewrite the user's Hermes config.
"""
import copy
import os

os.environ["HERMES_ACP_SKIP_CONFIGURED_MCP"] = "1"
import hermes_bootstrap  # noqa: E402, F401
from hermes_cli import config  # noqa: E402

_load_config = config.load_config


def workbench_config(*args, **kwargs):
    loaded = copy.deepcopy(_load_config(*args, **kwargs))
    loaded["mcp_servers"] = {}
    return loaded


config.load_config = workbench_config

from acp_adapter.entry import main  # noqa: E402

if __name__ == "__main__":
    main()
