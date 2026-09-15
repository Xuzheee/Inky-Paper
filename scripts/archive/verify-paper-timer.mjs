import assert from 'node:assert/strict';import {chromium} from 'playwright';import {randomUUID} from 'node:crypto';import {writeFile} from 'node:fs/promises';
const b=await chromium.connectOverCDP('http://127.0.0.1:9225');const p=b.contexts()[0].pages()[0];
const run=(action,input={})=>p.evaluate(({action,input})=>window.__TAURI_INTERNALS__.invoke('paper_execute',{action,input}),{action,input:{...input,requestId:randomUUID()}});
try{
 const status=await p.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_paper_bridge_status'));assert(status.connectionFile.includes('smoke-data'));
 const s=(await run('start_session',{kind:'rest',plannedSeconds:60})).session;await p.getByRole('button',{name:'结束休息',exact:true}).waitFor();console.log('Timer started in isolated desktop data');
 await p.waitForTimeout(30000);console.log('Halfway; timer running');await p.waitForTimeout(32000);
 const data=await p.evaluate(()=>window.__TAURI_INTERNALS__.invoke('paper_execute',{action:'get_state',input:{}}));const current=data.state.sessions.find(x=>x.id===s.id);assert.equal(current.status,'waiting');assert.equal(current.elapsedSeconds,60);assert.equal(current.lastResumedAt,null);assert(current.endedAt);await p.getByRole('heading',{name:'这一轮，结束了',exact:true}).waitFor();await p.screenshot({path:'output/playwright/timer-elapsed.png'});await p.getByRole('button',{name:'结束休息',exact:true}).click();await p.getByRole('heading',{name:'就从这一步开始',exact:true}).waitFor();
 await writeFile('output/playwright/timer-verification.json',JSON.stringify({result:'PASS',checks:['real 60-second timer expiration','waiting state saved once','recorded seconds capped','rest completion returns home']},null,2));console.log('TIMER_PASS');
}finally{await b.close()}
