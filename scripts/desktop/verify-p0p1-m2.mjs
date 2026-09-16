import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
const run=process.argv[2];assert.match(run||'',/^p0p1-m2-[A-Za-z0-9_-]+$/);
const root=path.resolve('output',run,'paper-test'),out=path.resolve('docs/verification/p0p1/M2');
await mkdir(out,{recursive:true});
const browser=await chromium.connectOverCDP('http://127.0.0.1:9254');
const pages=browser.contexts().flatMap(c=>c.pages());
const wb=pages.find(p=>p.url().includes('workbench=1')),paper=pages.find(p=>p.url()==='http://tauri.localhost/');assert(wb&&paper);
const invoke=(command,args={})=>wb.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const api=(action,input={})=>invoke('paper_execute',{action,input:{...input,...(action.startsWith('get_')?{}:{requestId:randomUUID()})}});
const state=async()=>(await api('get_state')).state;
assert.equal(path.resolve((await invoke('get_paper_bridge_status')).connectionFile),path.join(root,'paper-agent-bridge.json'));
const day=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=day(),nextDate=new Date();nextDate.setDate(nextDate.getDate()+1);const tomorrow=day(nextDate);
const report={run,today,checks:[],modelCalls:0,errors:[],complete:false};
const pass=message=>{report.checks.push(message);console.log('PASS',message)};
for(const page of pages)page.on('pageerror',e=>report.errors.push(e.message));
try {
 if(process.argv[3]!=='seeded'){
  assert.equal((await state()).tasks.length,0,'Use a fresh isolated M2 instance');
  for(const [title,text,priority,durationMinutes] of [['M2 周报','核对关键数字','high',45],['M2 素材','分类已有素材','medium',45],['M2 文档','补齐说明文字','low',30]])await api('workbench_save_step',{taskId:randomUUID(),stepId:randomUUID(),title,text,priority,category:'work',plannedSeconds:900,date:today,durationMinutes});
 }
 const baseline=await state();
 await paper.getByText('核对关键数字',{exact:true}).first().waitFor();
 pass('Three existing steps with 120 explicit reserved minutes appear in both native windows');
 // Credentials remain only in this test process, never in saved evidence.
 for(const [file,actions] of [['paper-agent-bridge.json',['create_task','update_task','adopt_plan_cards','adopt_plan_adjustment','start_session']],['paper-user-bridge.json',['create_task','start_work']]]){
  const connection=JSON.parse(await readFile(path.join(root,file),'utf8'));
  for(const action of actions){const r=await fetch(new URL('/'+action,connection.url),{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID()})});assert.equal(r.status,403,action)}
 }
 pass('Real native HTTP bridge rejects model task writes, adoption and clocks; click capability also cannot create tasks or start work');
 await wb.getByRole('button',{name:'安排一下',exact:true}).click();
 assert.equal((await invoke('workbench_history',{sessionId:null})).sessions.length,0);
 await wb.getByRole('button',{name:'我卡住了',exact:true}).click();
 await wb.getByRole('button',{name:'回顾一下',exact:true}).click();
 assert.deepEqual((await state()).tasks,baseline.tasks);
 pass('All three persistent Coach entries prefill without sending or changing the plan');
 const prompt='今天只有 60 分钟，先推进最重要的部分。请基于今天已有的三个步骤给出可供我选择的调整。当前任务信息已齐全，不要替我采用或开始计时。';
 await wb.evaluate(async()=>{window.__m2events=[];const handler=window.__TAURI_INTERNALS__.transformCallback(e=>{const p=e.payload;if(p.update?.sessionUpdate!=='agent_message_chunk')window.__m2events.push(p)});await window.__TAURI_INTERNALS__.invoke('plugin:event|listen',{event:'workbench:chat',target:{kind:'Any'},handler})});
 await wb.getByLabel('发送给 Coach',{exact:true}).fill(prompt);
 await wb.getByRole('button',{name:'发送',exact:true}).click();report.modelCalls++;
 await wb.getByRole('button',{name:'停止回复',exact:true}).waitFor();
 await wb.getByRole('button',{name:tomorrow,exact:true}).click();
 assert.match(await wb.getByLabel('Coach 讨论范围').innerText(),new RegExp(today));
 console.log('Waiting for actual Hermes model adjustment…');
 await wb.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden',timeout:600000});
 const history=await invoke('workbench_history',{sessionId:null});
 const conversation=await invoke('workbench_history',{sessionId:history.sessions[0].id});
 report.messages=conversation.messages;report.toolEvents=await wb.evaluate(()=>window.__m2events);report.input=prompt;
 await writeFile(path.join(out,'model-adjustment.json'),JSON.stringify({sourceCommit:'3fd2af9',...report},null,2));
 const answer=conversation.messages.findLast(m=>m.role==='assistant');
 assert.equal(answer.status,'done',answer.text);
 assert.equal(answer.context.date,today);assert.equal(answer.context.today,today);assert.equal(answer.context.schemaVersion,2);
 const afterModel=await state();
 for(const field of ['tasks','sessions','notes'])assert.deepEqual(afterModel[field],baseline[field],field);
 assert.deepEqual(afterModel.planning.steps,baseline.planning.steps);
 assert.deepEqual(afterModel.planning.dayItems,baseline.planning.dayItems);
 assert(afterModel.planning.adjustments?.length>0,answer.text);
 pass('Real model produced an unadopted structured adjustment with a frozen request scope and no formal task/plan/clock writes');
 const region=wb.getByRole('region',{name:'Coach 调整建议'}).last();await region.waitFor();
 await wb.screenshot({path:path.join(out,'model-candidate.png')});
 report.beforeAdoption=afterModel;
 const checkboxes=region.getByRole('checkbox');const count=await checkboxes.count();assert(count>0);
 for(let i=0;i<count;i++)await checkboxes.nth(i).check();
 await region.getByRole('button',{name:`采用所选 ${count} 组调整`,exact:true}).click();
 await region.getByText('所选调整已采用。原目标和已有执行记录保留。',{exact:true}).waitFor();
 const adopted=await state();report.afterAdoption=adopted;
 assert.equal(adopted.tasks.length,3);assert.equal(adopted.sessions.length,0);
 for(const step of baseline.planning.steps)assert(adopted.planning.steps.some(s=>s.id===step.id&&s.text===step.text));
 await wb.getByRole('button',{name:today,exact:true}).click();
 const expected=adopted.planning.dayItems.filter(i=>i.date===today&&!i.removedAt).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
 await paper.waitForFunction(ids=>JSON.stringify([...document.querySelectorAll('.sheet-queue-item')].map(n=>n.dataset.planItemId))===JSON.stringify(ids),expected.map(i=>i.id));
 report.plannedReservedMinutes=expected.reduce((n,i)=>n+(i.durationMinutes??0),0);
 report.unestimatedCount=expected.filter(i=>i.durationMinutes==null).length;
 await wb.screenshot({path:path.join(out,'adopted.png')});
 await paper.screenshot({path:path.join(out,'paper-after-adoption.png')});
 pass('Explicit UI adoption reused the original three tasks/steps, changed only selected plan groups, synchronized Paper order and started no clock');
 assert.deepEqual(report.errors,[]);
 report.complete=true;
} finally {
 await writeFile(path.join(out,'desktop-model-partial.json'),JSON.stringify(report,null,2));
 await browser.close();
}
