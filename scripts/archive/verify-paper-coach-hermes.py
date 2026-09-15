"""Verify the installed Hermes MCP registry against an explicitly supplied test bridge."""
import sys, json, os, uuid
from pathlib import Path
project = Path(__file__).resolve().parents[1]
bridge = Path(sys.argv[1]).resolve()
if not bridge.is_relative_to(project / 'output'):
    raise SystemExit('Only project-local test data is permitted')
root = Path.home() / '.hermes' / 'hermes-agent'
sys.path.insert(0, str(root))
from tools.mcp_tool import register_mcp_servers, shutdown_mcp_servers
from tools.registry import registry
config={'command':r'C:\Program Files\nodejs\node.exe','args':[str(project / 'integrations/inky-paper-mcp-server/index.mjs')],'env':{'INKY_PAPER_CONNECTION_FILE':str(bridge)}}
try:
    names = register_mcp_servers({'paper_coach_test': config})
    assert len(names) == 8, names
    def call(suffix,args):
        name=next(n for n in names if n.endswith('inky_paper_'+suffix))
        r=registry.dispatch(name,args)
        r=json.loads(r) if isinstance(r,str) else r
        assert not r.get('error') and not r.get('is_error'),r
        r=r.get('result',r)
        return json.loads(r) if isinstance(r,str) else r
    c=call('get_coach_context',{})
    assert c['block']['status']=='active' and c['recentSessions']
    assert c['block']['energy']=='medium'
    report={'result':'PASS','registeredTools':names,'checks':['8 named Hermes MCP tools','active work goal and reported energy readable','prior execution snapshots readable','clock controls absent'],'sessionCount':len(c['recentSessions'])}
    assert not any('start_session' in n or 'set_work_mode' in n for n in names)
    (project / 'output/coach-implementation-20260909/hermes-mcp-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('HERMES_COACH_MCP_PASS')
finally:
    shutdown_mcp_servers()
