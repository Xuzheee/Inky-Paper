import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const runName = process.argv[2] || 'paper-chrome-acceptance';
assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(runName));
const out = path.resolve('output', runName);
const shots = path.join(out, 'screenshots');
await mkdir(shots, {recursive:true});
let browser;
for (let attempt=0; attempt<12; attempt++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9252'); break; }
  catch(error) { if(attempt===11) throw error; await new Promise(resolve=>setTimeout(resolve,1000)); }
}
const page = browser.contexts().flatMap(context=>context.pages()).find(p=>!/[?&](coachPrompt|paperNotice)=/.test(p.url()));
assert(page); page.setDefaultTimeout(12000);
await page.locator('main.paper').waitFor();
const errors=[], checks=[];
page.on('pageerror', error=>errors.push(error.message));
page.on('console', message=>{ if(message.type()==='error') errors.push(message.text()); });
const invoke = (command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const api = (action,input={})=>invoke('paper_execute',{action,input:action==='get_state'?input:{requestId:crypto.randomUUID(),...input}});
const state = async()=>(await api('get_state')).state;
const button = name=>page.getByRole('button',{name,exact:true});
const scrollbar = page.getByRole('scrollbar');
const position = ()=>invoke('plugin:window|outer_position',{label:'main'});
const pass = message=>{checks.push(message);console.log('PASS',message);};
const shot = name=>page.screenshot({path:path.join(shots,`${name}.png`),animations:'disabled'});
const dimensions = ()=>page.evaluate(()=>{
  const main=document.querySelector('main.paper'), home=document.querySelector('.home-body');
  const target=home||main, thumb=document.querySelector('.paper-scrollbar-thumb');
  return {width:innerWidth,height:innerHeight,gutter:target.offsetWidth-target.clientWidth,
    scroll:target.scrollTop,maximum:target.scrollHeight-target.clientHeight,
    documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,
    mainHeight:main.getBoundingClientRect().height,
    thumbWidth:thumb?.getBoundingClientRect().width,trackWidth:document.querySelector('[role="scrollbar"]')?.getBoundingClientRect().width};
});
async function dragEdge(selector) {
  const rect=await page.locator(selector).boundingBox(), before=await position();
  const scale=await invoke('plugin:window|scale_factor',{label:'main'});
  const x=rect.x+rect.width/2, y=rect.y+rect.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+24,y+10);
  await page.waitForFunction(async before=>{const now=await window.__TAURI_INTERNALS__.invoke('plugin:window|outer_position',{label:'main'});return now.x!==before.x||now.y!==before.y;},before);
  await page.mouse.up();
  const after=await position();
  assert(Math.abs(after.x-before.x-24*scale)<=2,JSON.stringify({before,after,scale}));
  assert(Math.abs(after.y-before.y-10*scale)<=2,JSON.stringify({before,after,scale}));
  await invoke('move_window_by',{deltaX:(before.x-after.x)/scale,deltaY:(before.y-after.y)/scale});
}

try {
  const bridge=await invoke('get_paper_bridge_status');
  assert.equal(path.resolve(bridge.connectionFile),path.join(out,'paper-test/paper-agent-bridge.json'));
  await page.bringToFront();
  assert.equal((await state()).tasks.length,0,'Use a fresh isolated fixture');
  const taskIds=Array.from({length:6},()=>crypto.randomUUID());
  const cards=taskIds.flatMap((taskId,index)=>['读一节内容','写下三条笔记','做两道练习'].map((text,step)=>({id:crypto.randomUUID(),taskId,taskTitle:`复习任务 ${index+1}`,text:`${text} ${index+1}-${step+1}`,plannedSeconds:1500})));
  const batchId=crypto.randomUUID(),date=new Date().toLocaleDateString('en-CA');
  const batch=await api('propose_plan_batch',{batchId,cards});
  await api('adopt_plan_cards',{batchId,expectedRevision:batch.batch.revision,date,cardIds:cards.map(card=>card.id)});
  await page.reload(); await page.getByRole('heading',{name:'就从这一步开始'}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await scrollbar.waitFor();
  const home=page.locator('.home-body');
  const beforeMoves=await state();
  for(const fraction of [0,0.5,1]) {
    await home.evaluate((element,fraction)=>element.scrollTop=(element.scrollHeight-element.clientHeight)*fraction,fraction);
    await dragEdge('.paper-drag-left'); await dragEdge('.paper-drag-bottom');
  }
  assert.deepEqual(await state(),beforeMoves,'Moving or scrolling paper must not write business data');
  const homeGeometry=await dimensions();
  assert.equal(homeGeometry.gutter,0); assert.equal(homeGeometry.thumbWidth,3); assert.equal(homeGeometry.trackWidth,10);
  assert(homeGeometry.documentWidth<=homeGeometry.width&&homeGeometry.documentHeight<=homeGeometry.height);
  pass('Real window moves from left/bottom paper edges at top, middle and bottom; no task, plan or session changes');

  await home.evaluate(el=>el.scrollTop=0);
  await page.mouse.move(120,80); await page.mouse.wheel(0,120);
  await page.waitForFunction(()=>document.querySelector('.home-body').scrollTop>0);
  await page.mouse.move(14,18);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.paper-scrollbar-thumb')).opacity==='0');
  const textWidth=await page.locator('.sheet-task-name').first().evaluate(el=>el.getBoundingClientRect().width);
  const trackRect=await scrollbar.boundingBox();
  await page.mouse.move(trackRect.x+5,trackRect.y+30);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.paper-scrollbar-thumb')).opacity==='1');
  assert.equal(await page.locator('.sheet-task-name').first().evaluate(el=>el.getBoundingClientRect().width),textWidth);
  await shot('home-scrollbar');
  const beforeScroll=await position();
  await home.evaluate(el=>el.scrollTop=0);
  await page.waitForFunction(()=>document.querySelector('[role="scrollbar"]').getAttribute('aria-valuenow')==='0');
  const thumb=await page.locator('.paper-scrollbar-thumb').boundingBox();
  await page.mouse.move(thumb.x+1,thumb.y+thumb.height/2);await page.mouse.down();await page.mouse.move(thumb.x+1,thumb.y+thumb.height/2+70);await page.mouse.up();
  assert(await home.evaluate(el=>el.scrollTop>0));assert.deepEqual(await position(),beforeScroll);
  await scrollbar.focus();await page.keyboard.press('Home');assert.equal(await home.evaluate(el=>el.scrollTop),0);
  await page.keyboard.press('PageDown');assert(await home.evaluate(el=>el.scrollTop>0));
  await page.keyboard.press('End');assert(await home.evaluate(el=>Math.abs(el.scrollTop-(el.scrollHeight-el.clientHeight))<=1));
  const bottom=await home.evaluate(el=>el.scrollTop);
  await page.mouse.move(trackRect.x+5,trackRect.y+trackRect.height/2);await page.mouse.wheel(0,-90);
  await page.waitForFunction(before=>document.querySelector('.home-body').scrollTop<before,bottom);
  assert.deepEqual(await position(),beforeScroll);
  await page.evaluate(()=>document.activeElement.blur());await page.mouse.move(14,18);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.paper-scrollbar-thumb')).opacity==='0');
  await shot('home-idle');
  pass('Scrollbar floats with zero gutter, fades when idle, wakes on hover, and supports thumb drag, wheel and keyboard without moving the window or shifting text');

  await home.evaluate(el=>el.scrollTop=0);
  const firstRow=page.locator('.sheet-task').filter({has:page.locator('.sheet-task-name',{hasText:'复习任务 1'})});
  await firstRow.locator('.sheet-task-toggle').click();
  const step=firstRow.locator('.sheet-step').first();await step.scrollIntoViewIfNeeded();
  const stepBounds=await step.boundingBox(),beforeStrike=await position();
  await page.mouse.move(stepBounds.x+65,stepBounds.y+16);await page.mouse.down();await page.mouse.move(stepBounds.x+113,stepBounds.y+16);await page.mouse.up();
  await firstRow.locator('.sheet-step.is-done').waitFor();
  assert.deepEqual(await position(),beforeStrike);
  let changed=await state();assert.equal(changed.planning.steps.find(item=>item.text===cards[0].text).completed,true);assert.equal(changed.tasks.find(item=>item.id===taskIds[0]).completed,false);
  const parent=firstRow.locator('.sheet-task-toggle');await parent.scrollIntoViewIfNeeded();const parentBounds=await parent.boundingBox();
  await page.mouse.move(parentBounds.x+52,parentBounds.y+16);await page.mouse.down();await page.mouse.move(parentBounds.x+105,parentBounds.y+16);await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('.sheet-task[data-completed="true"]'));
  assert.deepEqual(await position(),beforeStrike);
  assert.equal((await state()).planning.steps.filter(item=>item.completed).length,1);
  pass('Handwriting gestures still complete a step or parent separately in place, with no window movement');

  const nextRow=page.locator('.sheet-task').filter({has:page.locator('.sheet-task-name',{hasText:'复习任务 2'})});
  await nextRow.locator('.sheet-task-toggle').click();await nextRow.getByRole('button',{name:`Do this：${cards[3].text}`,exact:true}).click();
  await button('start').click();await button('暂停').waitFor();
  await page.waitForFunction(()=>innerWidth===360&&Math.abs(innerHeight-189)<=1);
  await page.waitForFunction(()=>!document.querySelector('[role="scrollbar"]'));
  await dragEdge('.paper-drag-left');assert.equal((await state()).sessions[0].status,'running');
  await button('结束番茄钟').click();await button('补充记录（可选）').click();
  await page.getByRole('textbox',{name:'产出',exact:true}).fill('记录滚动后可以继续拖动');
  await page.waitForFunction(()=>innerWidth===320&&innerHeight===528);
  await scrollbar.waitFor();assert.equal(await scrollbar.getAttribute('aria-controls'),'paper-page-scroll');
  await page.locator('main.paper').evaluate(el=>el.scrollTop=120);
  await dragEdge('.paper-drag-left'); await dragEdge('.paper-drag-bottom');
  const endGeometry=await dimensions();assert.equal(endGeometry.gutter,0);
  const beforeInput=await position();
  await page.getByRole('textbox',{name:'卡点',exact:true}).fill('没有卡点');
  await page.getByRole('radio',{name:'已完成',exact:true}).locator('..').click();
  await page.getByRole('radio',{name:'还没完成',exact:true}).locator('..').click();
  assert.deepEqual(await position(),beforeInput);
  await shot('end-notes');
  await button('保存并结束').click();await page.getByRole('heading',{name:'就从这一步开始'}).waitFor();
  assert.equal((await state()).sessions[0].feedback.output,'记录滚动后可以继续拖动');
  assert.equal(await scrollbar.getAttribute('aria-controls'),'paper-home-scroll');
  await button('设置').click();await scrollbar.waitFor();assert.equal(await scrollbar.getAttribute('aria-controls'),'paper-page-scroll');
  await scrollbar.focus();await page.keyboard.press('End');await dragEdge('.paper-drag-left');
  pass('Focus has no unnecessary track; notes and settings keep working at any scroll position; navigation retargets the scrollbar and saved feedback remains correct');
  await page.reload();await page.getByRole('heading',{name:'就从这一步开始'}).waitFor();
  await button('start').click();await button('暂停').waitFor();
  await page.waitForFunction(()=>innerWidth===360&&Math.abs(innerHeight-189)<=1);
  const timerBounds=await page.locator('.timer').boundingBox();
  const miniSession=(await state()).sessions.find(session=>session.status==='running');
  assert(miniSession);
  await page.mouse.move(0,0);
  await page.waitForFunction(()=>document.querySelector('main')?.classList.contains('focus-quiet'));
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('main'),'::before').opacity==='0');
  assert.equal(await scrollbar.count(),0);
  assert.deepEqual(await page.locator('.timer').boundingBox(),timerBounds);
  assert(await page.locator('.paper-chrome').evaluate(el=>getComputedStyle(el).backgroundColor==='rgba(0, 0, 0, 0)'));
  await shot('focus-transparent');
  await page.mouse.move(150,90);await button('切换迷你宠物').click();
  await page.waitForFunction(()=>innerWidth===160&&innerHeight===160);
  assert.equal(await page.locator('.paper-chrome').count(),0);
  assert.equal(await page.locator('html.paper-window').count(),0);
  await button('返回 Inky Paper').click();
  await page.waitForFunction(()=>innerWidth===360&&Math.abs(innerHeight-189)<=1);
  await page.locator('.paper-drag-left').waitFor();
  assert.equal((await state()).sessions.find(session=>session.id===miniSession.id).status,'running');
  await button('结束番茄钟').click();await button('保存并结束').click();
  await page.getByRole('heading',{name:'就从这一步开始'}).waitFor();
  await page.locator('.home-body').evaluate(el=>el.scrollTop=240);await page.mouse.move(14,18);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.paper-scrollbar-thumb')).opacity==='0');
  assert(await page.locator('footer').evaluate(el=>{const r=el.getBoundingClientRect();return r.bottom<=innerHeight+1&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  await shot('home-idle');
  pass('Transparent timer keeps its coordinates and has no overlay background; mini pet removes the overlay and returns with timing intact; the home footer remains visible after scrolling');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(out,'verification.json'),JSON.stringify({result:'PASS',checks,homeGeometry,endGeometry,errors},null,2));
} catch(error) { await shot('failure').catch(()=>{}); console.error(error); process.exitCode=1; }
finally { process.exit(process.exitCode||0); }
