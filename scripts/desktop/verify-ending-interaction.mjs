import assert from 'node:assert/strict';
import path from 'node:path';

export async function verifyPaperEnding(page,shots,pass) {
  const position = () => page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|outer_position',{label:'main'}));
  const scale = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|scale_factor',{label:'main'}));
  const drags=[];
  for (const [selector,blank] of [['.feedback-heading h1',false],['.end-task > span',false],['.end-task',true]]) {
    const box=await page.locator(selector).boundingBox();
    const x=blank?box.x+box.width-60:box.x+box.width/2;
    const y=blank?box.y+10:box.y+box.height/2;
    const before=await position();
    await page.mouse.move(x,y);await page.mouse.down();
    await page.mouse.move(x+40,y);
    await page.waitForFunction(async x=>(await window.__TAURI_INTERNALS__.invoke('plugin:window|outer_position',{label:'main'})).x!==x,before.x);
    await page.mouse.up();
    const after=await position();
    assert(Math.abs(after.x-before.x-40*scale)<=2,JSON.stringify({selector,before,after,scale}));
    assert.equal(after.y,before.y);
    drags.push({selector,deltaX:after.x-before.x,scale});
  }
  pass(`Native title, handwritten task and blank area move the real window: ${JSON.stringify(drags)}`);
  const base=await position();
  const radio=name=>page.getByRole('radio',{name,exact:true});
  await radio('已完成').locator('..').click();
  assert.deepEqual(await position(),base);
  const drawing=await page.locator('.end-outcome label[data-selected="true"] .outcome-shading').evaluate(svg=>{
    const animations=[...svg.querySelectorAll('g > path')].flatMap(p=>p.getAnimations());
    const states=animations.map(a=>a.playState);
    animations.forEach(a=>{a.pause();a.currentTime=140;});
    return states;
  });
  assert.equal(drawing.length,2,'Both pencil passes have a real drawing transition');
  await page.mouse.move(0,0);
  await page.screenshot({path:path.join(shots,'end-shading-drawing.png'),animations:'allow'});
  await page.locator('.outcome-shading').evaluateAll(svgs=>svgs.forEach(svg=>svg.querySelectorAll('g > path').forEach(p=>p.getAnimations().forEach(a=>a.finish()))));
  await page.screenshot({path:path.join(shots,'end-shading-selected.png')});
  await radio('已完成').focus();await page.keyboard.press('ArrowLeft');
  assert(await radio('还没完成').isChecked());
  await page.keyboard.press('ArrowRight');assert(await radio('已完成').isChecked());
  await page.emulateMedia({reducedMotion:'reduce'});
  await radio('还没完成').locator('..').click();
  assert.equal(await page.locator('.end-outcome label[data-selected="true"] .pencil-shade-soft').evaluate(p=>getComputedStyle(p).transitionDuration),'0s');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'补充记录（可选）',exact:true}).click();
  const note=page.getByLabel('产出',{exact:true});await note.fill('保留文字选择和输入');
  const box=await note.boundingBox();
  await page.mouse.move(box.x+10,box.y+15);await page.mouse.down();await page.mouse.move(box.x+60,box.y+15);await page.mouse.up();
  assert.deepEqual(await position(),base);
  await page.mouse.move(8,200);await page.mouse.wheel(0,250);
  await page.waitForFunction(()=>document.querySelector('main').scrollTop>0);
  await page.getByRole('button',{name:'收起记录',exact:true}).click();
  await page.locator('main').evaluate(el=>el.scrollTop=0);
  assert(await radio('还没完成').isChecked());
  assert.match(await page.locator('.end-task > span').evaluate(el=>getComputedStyle(el).fontFamily),/Xiaolai/);
  assert.match(await page.locator('.end-task > span').evaluate(el=>getComputedStyle(el).backgroundImage),/task-pencil-underline/);
  pass('Handwritten radios support mouse and arrow keys; pencil shading draws, reduced-motion skips it, controls and notes never move the window, expanded page scrolls');
}
