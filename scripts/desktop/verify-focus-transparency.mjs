import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const runName = process.argv[2] || 'focus-strip-acceptance';
assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(runName));
const out = path.resolve('output', runName);
const shots = path.resolve('output/playwright/focus-strip');
await mkdir(shots, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9252');
const page = browser.contexts().flatMap(context => context.pages())
  .find(page => !/[?&](coachPrompt|paperNotice)=/.test(page.url()));
assert(page, 'Isolated main webview required');
page.setDefaultTimeout(15000);
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const pass = message => { checks.push(message); console.log('PASS', message); };
const invoke = (command, args = {}) => page.evaluate(({ command, args }) =>
  window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const api = (action, input = {}) => invoke('paper_execute', { action, input: action === 'get_state' ? input : { requestId: crypto.randomUUID(), ...input } });
const state = async () => (await api('get_state')).state;
const button = name => page.getByRole('button', { name, exact: true });
const quiet = () => page.locator('main').evaluate(element => element.classList.contains('focus-quiet'));
const waitQuiet = async () => {
  await page.waitForFunction(() => document.querySelector('main')?.classList.contains('focus-quiet'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('main'), '::before').opacity === '0');
};
const snapshot = () => page.evaluate(() => {
  const sheet = document.querySelector('main');
  const style = selector => getComputedStyle(document.querySelector(selector));
  const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
  return {
    width: innerWidth, height: innerHeight,
    timer: rect('.timer'), progress: rect('.pencil-progress'), titleBounds: rect('.focus-heading'),
    taskFont: style('.focus-heading h2').fontFamily,
    taskSize: style('.focus-heading h2').fontSize,
    clockSize: style('.timer').fontSize,
    sheetOpacity: getComputedStyle(sheet, '::before').opacity,
    sheetBackground: style('main').backgroundColor,
    navBackground: style('.focus-navigation').backgroundColor,
    clockBackground: style('.focus-clock').backgroundColor,
    clockShadow: style('.focus-clock').boxShadow,
    title: style('.focus-heading').visibility,
    controls: style('.focus-bottom').visibility,
    nav: style('.focus-navigation').visibility,
    timerStroke: style('.timer').webkitTextStrokeWidth,
    overflow: sheet.scrollHeight > sheet.clientHeight || sheet.scrollWidth > sheet.clientWidth,
  };
});

try {
  const bridge = await invoke('get_paper_bridge_status');
  assert.equal(path.resolve(bridge.connectionFile), path.join(out, 'paper-test/paper-agent-bridge.json'));
  assert.equal((await state()).tasks.length, 0, 'Fresh isolated fixture required');
  await writeFile(path.join(out, 'initial-ui.txt'), await page.locator('body').ariaSnapshot());
  const { task } = await api('create_task', { taskId: crypto.randomUUID(), title: '整理产品思路', nextAction: '整理产品思路' });
  await api('start_session', { taskId: task.id, expectedRevision: task.revision, kind: 'focus', plannedSeconds: 803 });
  await page.reload();
  await button('暂停').waitFor();
  await page.mouse.move(150, 70);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('main'), '::before').opacity === '1');
  const normal = await snapshot();
  assert.equal(normal.width, 400); assert.equal(normal.height, 210);
  assert(normal.titleBounds.x + normal.titleBounds.width <= normal.timer.x);
  assert.equal(normal.taskSize, '24px'); assert(normal.taskFont.includes('Xiaolai'));
  assert.equal(normal.clockSize, '52px');
  assert.equal(await page.locator('.focus-state').innerText(), '正在专注');
  assert.equal(normal.overflow, false);
  await page.screenshot({ path: path.join(shots, 'paper.png'), omitBackground: true });
  const beforeDrag = await invoke('plugin:window|outer_position', { label: 'main' });
  await page.mouse.move(170, 50);
  await page.mouse.down();
  await page.mouse.move(194, 64, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(async before => {
    const after = await window.__TAURI_INTERNALS__.invoke('plugin:window|outer_position', { label: 'main' });
    return Math.abs(after.x - before.x) + Math.abs(after.y - before.y) > 8;
  }, beforeDrag);
  const afterDrag = await invoke('plugin:window|outer_position', { label: 'main' });
  await invoke('move_window_by', { deltaX: beforeDrag.x - afterDrag.x, deltaY: beforeDrag.y - afterDrag.y });
  pass('Dragging paper space moves the actual native focus window');
  const elapsed = Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'));
  await waitQuiet();
  const transparent = await snapshot();
  for (const field of ['sheetBackground', 'navBackground', 'clockBackground']) assert.equal(transparent[field], 'rgba(0, 0, 0, 0)', field);
  assert.equal(transparent.clockShadow, 'none');
  assert.equal(transparent.title, 'hidden'); assert.equal(transparent.controls, 'hidden');
  assert.equal(transparent.nav, 'visible'); assert.equal(transparent.overflow, false);
  assert.equal(transparent.timerStroke, '1px');
  assert.deepEqual(transparent.timer, normal.timer); assert.deepEqual(transparent.progress, normal.progress);
  assert(Number(await page.getByRole('progressbar').getAttribute('aria-valuenow')) > elapsed);
  await page.screenshot({ path: path.join(shots, 'transparent.png'), omitBackground: true });
  pass('Native 400x210 horizontal strip uses handwritten task left and time right; transparent mode keeps coordinates, timer progression and navigation');

  // These temporary backgrounds exercise the real renderer only; no product or
  // desktop wallpaper setting is changed. Restored before testing interactions.
  for (const [name, background] of [['dark', '#142c39'], ['light', '#f1ede4'], ['mixed', 'linear-gradient(115deg, #eceddd 0%, #b9c4aa 40%, #23414a 65%, #142432 100%)']]) {
    await page.locator('body').evaluate((element, value) => { element.style.background = value; }, background);
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
    assert.equal(await quiet(), true);
  }
  await page.locator('body').evaluate(element => { element.style.background = ''; });
  pass('Captured transparent rendering on light, dark and mixed backgrounds without changing desktop settings');

  await page.mouse.move(156, 70);
  await button('暂停').click();
  await button('继续').waitFor();
  await page.waitForFunction(() => innerWidth === 400 && innerHeight === 304);
  await page.waitForFunction(() => !document.querySelector('.focus-toggle').disabled);
  assert.equal(await quiet(), false);
  assert.equal((await state()).sessions[0].status, 'paused');
  assert.equal(await page.locator('.focus-state').innerText(), '已暂停');
  assert.equal((await snapshot()).overflow, false, 'Paused note must fit without a scrollbar');
  await page.screenshot({ path: path.join(shots, 'paused.png'), omitBackground: true });
  await button('继续').click();
  await button('随手记').click();
  await page.getByRole('textbox', { name: '本轮随手记' }).fill('下次整理成三点');
  await page.waitForFunction(() => innerWidth === 400 && innerHeight === 398);
  await page.screenshot({ path: path.join(shots, 'note.png'), omitBackground: true });
  await page.waitForTimeout(10500);
  assert.equal(await quiet(), false);
  await button('记下，回到这一轮').click();
  assert((await state()).notes.some(note => note.text === '下次整理成三点'));
  pass('Pointer restores paper and controls; pause/resume and note editing remain usable with the draft visible');

  await waitQuiet();
  await page.keyboard.press('Tab');
  assert.equal(await quiet(), false);
  await page.waitForTimeout(10500);
  assert.equal(await quiet(), false, 'Keyboard-focused control must stay visible');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.pencil-tip').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  pass('Keyboard wakes the sheet and keeps focused controls visible; reduced motion stops decorative pencil movement');

  await button('返回任务列表').click();
  assert.equal((await state()).sessions[0].status, 'running');
  await page.getByRole('heading', { name: '就从这一步开始' }).waitFor();
  await page.reload();
  await button('结束番茄钟').click();
  await button('保存并结束').click();
  const final = await state();
  assert.equal(final.sessions[0].status, 'finished');
  assert.equal(final.tasks[0].completed, false);
  pass('Return-to-list preserves the active timer; ending and saving still records time without completing the parent task');

  const { task: longTask } = await api('create_task', { taskId: crypto.randomUUID(), title: '整理复杂的产品需求与方案并写出下一次可以继续的三条关键结论', nextAction: '整理复杂的产品需求与方案并写出下一次可以继续的三条关键结论' });
  await api('start_session', { taskId: longTask.id, expectedRevision: longTask.revision, kind: 'focus', plannedSeconds: 7200 });
  await page.reload();
  await button('暂停').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const long = await snapshot();
  assert.equal(long.clockSize, '42px'); assert.equal(long.overflow, false);
  assert(long.titleBounds.x + long.titleBounds.width <= long.timer.x);
  assert(long.titleBounds.y + long.titleBounds.height <= long.progress.y);
  await page.screenshot({ path: path.join(shots, 'long-task.png'), omitBackground: true });
  await button('切换迷你宠物').click();
  await page.waitForFunction(() => innerWidth === 160 && innerHeight === 160);
  await button('返回 Inky Paper').click();
  await page.waitForFunction(() => innerWidth === 400 && innerHeight === 210);
  assert.equal((await state()).sessions.find(session => session.taskId === longTask.id).status, 'running');
  pass('Two-line long task and three-digit minutes stay separate; mini pet returns to the horizontal timer without stopping it');
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'verification.json'), JSON.stringify({ result: 'PASS', checks, normal, transparent, long, errors, isolatedData: true }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(shots, 'failure.png'), omitBackground: true }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally { process.exit(process.exitCode || 0); }
