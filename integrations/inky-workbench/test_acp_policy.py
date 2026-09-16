"""Check the child-process adapter with fake providers; no model/auth/data access."""
import runpy
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class PolicyTest(unittest.TestCase):
    def test_limits_discovery_refresh_and_tool_surface_without_mutating_provider_config(self):
        original = {"model":{"default":"fixture"},"mcp_servers":{"old":{"command":"never"}},"platform_toolsets":{"acp":["all"],"cli":["all"]}}
        config=types.ModuleType("hermes_cli.config")
        config.load_config=lambda: original
        cli=types.ModuleType("hermes_cli");cli.config=config
        session=types.ModuleType("acp_adapter.session")
        session.SessionManager=type("SessionManager",(),{})
        server=types.ModuleType("acp_adapter.server")
        entry=types.ModuleType("acp_adapter.entry");entry.main=lambda: None
        adapter=types.ModuleType("acp_adapter");adapter.session=session;adapter.server=server
        model_tools=types.ModuleType("model_tools")
        names=["terminal","read_file","write_file","memory","delegate_task","mcp__other__inky_paper_list_tasks","mcp__inky_workbench__inky_paper_create_task","mcp__inky_workbench__inky_paper_adopt_plan_cards","mcp__inky_workbench__inky_paper_get_daily_record","mcp__inky_workbench__inky_paper_propose_plan_adjustment"]
        model_tools.get_tool_definitions=lambda *a,**kw:[{"function":{"name":name}} for name in names]
        fake={"hermes_bootstrap":types.ModuleType("hermes_bootstrap"),"hermes_cli":cli,"hermes_cli.config":config,"acp_adapter":adapter,"acp_adapter.session":session,"acp_adapter.server":server,"acp_adapter.entry":entry,"model_tools":model_tools}
        with patch.dict(sys.modules,fake):
            module=runpy.run_path(str(Path(__file__).with_name("acp_host.py")),run_name="policy_test")
            filtered=config.load_config()
            self.assertEqual(filtered["mcp_servers"],{})
            self.assertEqual(filtered["platform_toolsets"]["acp"],["mcp-inky_workbench"])
            self.assertEqual(config.load_config_readonly()["memory"],{"provider":"", "memory_enabled":False, "user_profile_enabled":False})
            self.assertEqual(config.load_config_readonly()["tools"]["tool_search"],{"enabled":"off"})
            self.assertEqual(original["platform_toolsets"]["acp"],["all"])
            for surface in [session,server]:
                self.assertEqual(surface._expand_acp_enabled_toolsets(["all"],["foreign"]),["mcp-inky_workbench"])
            self.assertEqual([tool["function"]["name"] for tool in model_tools.get_tool_definitions()],["mcp__inky_workbench__inky_paper_get_daily_record","mcp__inky_workbench__inky_paper_propose_plan_adjustment"])
            self.assertIs(session.SessionManager._get_db,module["workbench_session_db"])


if __name__ == "__main__":
    unittest.main()
