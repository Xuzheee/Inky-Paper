import {chromium} from 'playwright';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {writeFile} from 'node:fs/promises';import path from 'node:path';
const b=await chromium.connectOverCDP('http://127.0.0.1:9226');const p=b.contexts()[0].pages()[0];
try{
 await p.getByRole('heading',{name:'留一件想做的小事',exact:true}).waitFor();
 const result=await p.evaluate(async()=>{const invoke=window.__TAURI_INTERNALS__.invoke;return {status:await invoke('get_paper_bridge_status'),state:await invoke('paper_execute',{action:'get_state',input:{}})}});
 assert.equal(path.resolve(result.status.connectionFile),path.join(process.env.APPDATA,'com.inky.paper','paper-agent-bridge.json'));assert.equal(result.state.state.tasks.length,0);assert.equal(result.state.state.sessions.length,0);assert.equal(result.state.state.notes.length,0);
 const badAssets=await p.locator('img').evaluateAll(xs=>xs.filter(x=>!x.complete||x.naturalWidth===0).map(x=>x.src));assert.deepEqual(badAssets,[]);await p.screenshot({path:'output/playwright/release-empty.png'});
 const visible=()=>p.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'}));
 const toggle=()=>execFileSync('powershell.exe',['-NoProfile','-Command',"(New-Object -ComObject WScript.Shell).SendKeys('%+f')"],{windowsHide:true});
 try{assert(await visible());toggle();await p.waitForTimeout(400);assert.equal(await visible(),false);toggle();await p.waitForTimeout(400);assert.equal(await visible(),true)}finally{if(!(await visible()))toggle()}
 await p.getByRole('button',{name:'切换迷你宠物',exact:true}).click();await p.getByRole('button',{name:'返回 Inky Paper',exact:true}).waitFor();assert.equal(await p.locator('body').innerText(),'');await p.waitForFunction(()=>innerWidth===160 && innerHeight===160 && document.querySelector('img')?.naturalWidth>0); await p.waitForTimeout(700); await p.screenshot({path:'output/playwright/release-mini.png',omitBackground:true});await p.getByRole('button',{name:'返回 Inky Paper',exact:true}).click();
 await writeFile('output/release-verification.json',JSON.stringify({result:'PASS',connectionFile:result.status.connectionFile,url:p.url(),checks:['standalone release renders bundled Paper UI and pet','normal independent data directory','fresh empty production database','Alt+Shift+F hides/restores','transparent mini returns to task page']},null,2));console.log('RELEASE_PASS',p.url());
}finally{await b.close()}
