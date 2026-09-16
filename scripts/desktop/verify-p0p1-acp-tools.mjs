// Real installed Hermes ACP inventory, without a model prompt or Paper database.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
const root=path.resolve('output/p0p1-m2-policy');
await mkdir(root,{recursive:true});
const child=spawn(path.join(process.env.USERPROFILE,'Documents/hermes/venv/Scripts/python.exe'),[path.resolve('integrations/inky-workbench/acp_host.py')],{
 cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',INKY_WORKBENCH_STATE_DIR:root},
});
let serial=0,answer='',diagnostics='';
const pending=new Map();
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{
 let m;try{m=JSON.parse(line)}catch{return}
 if(!m.method&&m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}
 if(m.method==='session/update'&&m.params?.update?.sessionUpdate==='agent_message_chunk')answer+=m.params.update.content?.text||'';
 if(m.method==='session/request_permission')child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{outcome:{outcome:'cancelled'}}})+'\n');
 else if(m.method&&m.id)child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Unsupported test-client method'}})+'\n');
});
child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-6000)});
child.on('exit',code=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(`Hermes ACP exited (${code})`))}pending.clear()});
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`ACP timeout: ${method}`))},120000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
try {
 await rpc('initialize',{protocolVersion:1,clientInfo:{name:'inky-policy-verification',version:'1'},clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}});
 const session=await rpc('session/new',{cwd:root,mcpServers:[{name:'inky_workbench',command:process.execPath,args:[path.resolve('src-tauri/resources/paper-mcp.mjs')],env:[{name:'INKY_PAPER_CONNECTION_FILE',value:path.join(root,'no-paper-connection.json')}]}]});
 assert(session.sessionId);
 await rpc('session/prompt',{sessionId:session.sessionId,prompt:[{type:'text',text:'/tools'}]});
 const names=[...answer.matchAll(/^\s+(mcp__[^: ]+):/gm)].map(m=>m[1]);
 assert.equal(names.length,12,answer);
 assert(names.every(name=>name.startsWith('mcp__inky_workbench__inky_paper_')));
 assert(!/\b(?:terminal|read_file|write_file|memory|delegate_task)\s*:|inky_paper_(?:create_task|update_task|adopt|start_session)/.test(answer));
 const report={realHermesProcess:true,modelCalls:0,paperDatabaseAccess:false,isolatedHermesHistory:path.join(root,'hermes-state.sqlite3'),tools:names,answer};
 await mkdir('docs/verification/p0p1/M2',{recursive:true});
 await writeFile('docs/verification/p0p1/M2/acp-tools.json',JSON.stringify(report,null,2));
 console.log('PASS actual Hermes ACP exposes only the 12 scoped Paper read/proposal tools; no model calls');
} catch(error) {
 console.error(diagnostics.replace(/(token|api[_-]?key|authorization|secret)([=: ]+)[^\s,]+/gi,'$1$2[redacted]'));
 throw error;
} finally {child.stdin.end();child.kill();lines.close();for(const p of pending.values())clearTimeout(p.timer);}
