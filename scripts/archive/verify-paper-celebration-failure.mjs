import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
const b=await chromium.connectOverCDP('http://127.0.0.1:9226');
const p=b.contexts()[0].pages()[0];
const ui=name=>p.getByRole('button',{name,exact:true});
let db;
try {
 const status=await p.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_paper_bridge_status'));
 assert(status.connectionFile.includes('celebration-test-data'));
 if(await ui('刚才点错了，撤销完成').count()) await ui('刚才点错了，撤销完成').click();
 await p.reload();
 await ui('整个任务都完成了').waitFor();
 await p.evaluate(()=>{
  window.failureTones=0;
  const start=OscillatorNode.prototype.start;
  OscillatorNode.prototype.start=function(...args){window.failureTones++;return start.apply(this,args)};
 });
 db=new DatabaseSync('output/celebration-test-data/paper.sqlite3');
 db.exec('BEGIN IMMEDIATE');
 await ui('整个任务都完成了').click();
 await p.getByRole('alert').waitFor();
 assert.equal(await p.getByRole('region',{name:'任务完成庆祝'}).count(),0);
 assert.equal(await p.evaluate(()=>window.failureTones),0);
 db.exec('ROLLBACK');db.close();db=undefined;
 await ui('整个任务都完成了').click();
 await p.getByRole('region',{name:'任务完成庆祝'}).waitFor();
 await p.waitForTimeout(1500);
 assert.equal(await p.evaluate(()=>window.failureTones),4);
 const path='output/playwright/celebration/verification.json';
 const evidence=JSON.parse(await readFile(path,'utf8'));
 evidence.checks.push('Failed save shows an error without celebration or audio; successful retry celebrates exactly once');
 await writeFile(path,JSON.stringify(evidence,null,2));
 console.log('PASS failed save and retry');
}finally{if(db){db.exec('ROLLBACK');db.close()}await b.close()}
