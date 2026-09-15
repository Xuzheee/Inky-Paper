import sys,json,os,yaml
from pathlib import Path
root=Path(r'C:\Users\31009\.hermes\hermes-agent');sys.path.insert(0,str(root));os.chdir(root)
from tools.mcp_tool import register_mcp_servers,shutdown_mcp_servers
from tools.registry import registry
config=yaml.safe_load(Path(r'C:\Users\31009\.hermes\config.yaml').read_text(encoding='utf-8'))['mcp_servers']['inky_paper']
try:
 names=register_mcp_servers({'inky_paper':config});assert len(names)==6
 name=next(x for x in names if x.endswith('inky_paper_list_tasks'));r=registry.dispatch(name,{});r=json.loads(r) if isinstance(r,str) else r;assert not r.get('error'),r;result=r.get('result',r);result=json.loads(result) if isinstance(result,str) else result;assert result['totalCount']==0,result
 Path(r'C:\Users\31009\clauddd\Inky-Paper\output\hermes-production-verification.json').write_text(json.dumps({'result':'PASS','runtime':str(root),'registeredTools':names,'savedConfigUsed':True,'productionTaskCount':result['totalCount']},indent=2),encoding='utf-8');print('INSTALLED_HERMES_PRODUCTION_PASS')
finally:shutdown_mcp_servers()
