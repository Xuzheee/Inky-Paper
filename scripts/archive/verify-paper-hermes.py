import sys,json,uuid,os
from pathlib import Path
root=Path(r'C:\Users\31009\Documents\hermes');sys.path.insert(0,str(root));os.chdir(root)
from tools.mcp_tool import register_mcp_servers,shutdown_mcp_servers
from tools.registry import registry
config={'command':r'C:\Program Files\nodejs\node.exe','args':[r'C:\Users\31009\clauddd\Inky-Paper\integrations\inky-paper-mcp-server\index.mjs'],'env':{'INKY_PAPER_CONNECTION_FILE':r'C:\Users\31009\clauddd\Inky-Paper\output\smoke-data\paper-agent-bridge.json'}}
try:
 names=register_mcp_servers({'inky_paper_smoke':config});print('TOOLS',json.dumps(names))
 def call(suffix,args):
  name=next(n for n in names if n.endswith('inky_paper_'+suffix));r=registry.dispatch(name,args);r=json.loads(r) if isinstance(r,str) else r
  if r.get('is_error') or r.get('error'):raise Exception(r)
  r=r.get('result',r)
  if isinstance(r,str):r=json.loads(r)
  return r
 task_id=str(uuid.uuid4());created=call('create_task',{'requestId':str(uuid.uuid4()),'taskId':task_id,'title':'Hermes registry 实际往返','nextAction':'检查执行记录读取'})
 print('CREATE_KEYS',list(created))
 task=created['task'];updated=call('update_task',{'requestId':str(uuid.uuid4()),'taskId':task_id,'expectedRevision':task['revision'],'patch':{'nextAction':'已通过 Hermes 工具层更新'}})
 read=call('get_task',{'taskId':task_id});assert read['task']['nextAction']['text']=='已通过 Hermes 工具层更新'
 history=call('read_history',{});assert any(s['feedback'] and s['feedback'].get('output')=='完成待开始草图' for s in history['items'])
 report={'result':'PASS','registeredTools':names,'checks':['Hermes registry discovery','create/update/read persisted Paper task','read real desktop feedback'],'taskId':task_id}
 Path(r'C:\Users\31009\clauddd\Inky-Paper\output\hermes-registry-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print('HERMES_REGISTRY_PASS')
finally:shutdown_mcp_servers()
