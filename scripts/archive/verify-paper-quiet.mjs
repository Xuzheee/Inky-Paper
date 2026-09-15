import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
const output = 'output/playwright/focus-quiet';
await mkdir(output, {recursive:true});
const checks = [];
const pass = text => { checks.push(text); console.log('PASS', text); };
const run = (action, input = {}) => page.evaluate(({action,input}) =>
  window.__TAURI_INTERNALS__.invoke('paper_execute', {action,input}),
  {action,input:action === 'get_state' ? input : {...input,requestId:randomUUID()}});
const button = name => page.getByRole('button', {name,exact:true});
const quiet = () => page.locator('main').evaluate(e=>e.classList.contains('focus-quiet'));
try {
  const connection = await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_paper_bridge_status'));
  assert(connection.connectionFile.includes('focus-quiet-data'));
  const prior = (await run('get_state')).state.sessions.find(s=>s.status !== 'finished');
  if (prior) await run('finish_session', {sessionId:prior.id,expectedRevision:prior.revision,outcome:'stopped'});
  const {task} = await run('create_task', {taskId:randomUUID(),title:'透明专注验收',nextAction:'检查铅笔进度与静置恢复'});
  await run('start_session', {taskId:task.id,expectedRevision:task.revision,kind:'focus',plannedSeconds:60});
  await button('暂停').waitFor();
  console.log(await page.locator('body').innerText());
  await page.mouse.move(100,80);
  const before = await page.getByRole('progressbar').getAttribute('aria-valuenow');
  await page.waitForTimeout(9000);
  assert.equal(await quiet(),false);
  await page.screenshot({path:`${output}/01-pencil.png`,omitBackground:true});
  await page.waitForTimeout(1800);
  assert.equal(await quiet(),true);
  const visuals = await page.evaluate(()=>({
    sheet: getComputedStyle(document.querySelector('main'),'::before').opacity,
    background: getComputedStyle(document.querySelector('main')).backgroundColor,
    title: getComputedStyle(document.querySelector('.focus-heading')).visibility,
    pause: getComputedStyle(document.querySelector('.timer-row button')).visibility,
    animation: getComputedStyle(document.querySelector('.pencil-tip')).animationName,
    overflow: document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight,
  }));
  assert.equal(visuals.sheet,'0'); assert.equal(visuals.background,'rgba(0, 0, 0, 0)');
  assert.equal(visuals.title,'hidden'); assert.equal(visuals.pause,'hidden');
  assert.equal(visuals.animation,'pencil-writing'); assert.equal(visuals.overflow,false);
  assert(Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'))>Number(before));
  await page.screenshot({path:`${output}/02-transparent.png`,omitBackground:true});
  pass('10 seconds idle fades sheet and controls; timer and pencil continue without overflow');
  await page.mouse.move(104,80); assert.equal(await quiet(),false);
  await button('暂停').click();
  await button('继续').waitFor();
  await page.waitForTimeout(11000); assert.equal(await quiet(),false);
  assert.equal(await page.locator('.pencil-progress').evaluate(e=>e.classList.contains('is-drawing')),false);
  pass('Pointer wakes full controls; pause stays visible and stops pencil animation');
  await button('继续').click();
  await button('随手记').click();
  await page.getByRole('textbox',{name:'本轮随手记'}).fill('验收草稿');
  await page.waitForTimeout(11000); assert.equal(await quiet(),false);
  pass('Quick note editing stays visible after 10 seconds');
  await button('收起').click();
  await page.waitForTimeout(11000); assert.equal(await quiet(),true);
  await page.keyboard.press('Tab'); assert.equal(await quiet(),false);
  pass('Keyboard wakes transparent mode');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.pencil-tip').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  pass('Reduced motion disables pencil wobble');
  await button('这一步完成了').waitFor({timeout:35000});
  assert.equal(await quiet(),false);
  await page.screenshot({path:`${output}/03-finished.png`,omitBackground:true});
  pass('Real timer expiration restores completion screen');
  await writeFile(`${output}/verification.json`,JSON.stringify({result:'PASS',checks,visuals},null,2));
} finally { await browser.close(); }
