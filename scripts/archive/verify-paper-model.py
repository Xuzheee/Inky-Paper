import sys,os,json,uuid
from pathlib import Path
root=Path(r'C:\Users\31009\Documents\hermes');sys.path.insert(0,str(root));os.chdir(root)
from tools.mcp_tool import register_mcp_servers,shutdown_mcp_servers
from tools.registry import registry
from hermes_cli.runtime_provider import resolve_runtime_provider
from run_agent import AIAgent
server={'command':r'C:\Program Files\nodejs\node.exe','args':[r'C:\Users\31009\clauddd\Inky-Paper\integrations\inky-paper-mcp-server\index.mjs'],'env':{'INKY_PAPER_CONNECTION_FILE':r'C:\Users\31009\clauddd\Inky-Paper\output\smoke-data\paper-agent-bridge.json'}}
try:
 names=register_mcp_servers({'paper_model_smoke':server});toolsets=list({registry.get_toolset_for_tool(n) for n in names})
 runtime=resolve_runtime_provider(requested='openai-codex',target_model='gpt-5.6-sol')
 agent=AIAgent(model='gpt-5.6-sol',provider=runtime.get('provider'),base_url=runtime.get('base_url'),api_key=runtime.get('api_key'),api_mode=runtime.get('api_mode'),enabled_toolsets=toolsets,max_iterations=10,max_tokens=1200,quiet_mode=True,skip_context_files=True,skip_memory=True,skip_background_review=True,save_trajectories=False,run_budget_seconds=120,reasoning_config={'effort':'low'})
 from model_tools import get_tool_definitions
 actual=[t.get('function',{}).get('name','') for t in get_tool_definitions(enabled_toolsets=toolsets,quiet_mode=True,skip_tool_search_assembly=True)];print('CATALOG',json.dumps(actual));assert actual and all('paper_model_smoke' in n for n in actual)
 result=agent.run_conversation('请使用 Inky Paper 工具读取最近执行记录（最多3项），再读取任务列表（最多5项）。这是只读连接验收，不创建、不修改、不删除。用一句中文报告你从真实记录看到的一项内容。')
 messages=result.get('messages',[]);calls=[tc['function']['name'] for m in messages for tc in m.get('tool_calls',[])];assert 'read_history' in json.dumps(messages,ensure_ascii=False) and any(m.get('role')=='tool' for m in messages),str(result)[:300]
 report={'result':'PASS','model':'gpt-5.6-sol','calls':calls,'finalResponse':result.get('final_response',result.get('response',''))}
 Path(r'C:\Users\31009\clauddd\Inky-Paper\output\hermes-model-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print('HERMES_MODEL_PASS',report['finalResponse'])
finally:shutdown_mcp_servers()
