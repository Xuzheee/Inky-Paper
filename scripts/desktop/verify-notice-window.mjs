import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Launch an isolated acceptance build first; no production connection is accepted.
const out = path.resolve('output/notice-window-20260915');
const shots = path.resolve('output/playwright/notice-window-20260915');
await mkdir(shots, { recursive: true });
const pid = Number(await readFile(path.join(out, 'paper-test.pid'), 'utf8'));
assert(Number.isSafeInteger(pid) && pid > 0);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9251');
const pages = browser.contexts().flatMap(context => context.pages());
const main = pages.find(page => !/[?&](coachPrompt|paperNotice)=/.test(page.url()));
const popup = pages.find(page => page.url().includes('paperNotice=1'));
assert(main && popup, 'Main and independent notice webviews must both exist');
main.setDefaultTimeout(12000); popup.setDefaultTimeout(12000);
const invoke = (command, args = {}) => main.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const api = (action, input = {}) => invoke('paper_execute', { action, input });
const state = async () => (await api('get_state')).state;
const button = name => main.getByRole('button', { name, exact: true });
const checks = [], errors = [];
for (const page of [main, popup]) page.on('pageerror', error => errors.push(error.message));
const pass = message => { checks.push(message); console.log('PASS', message); };
const nativeWindows = () => JSON.parse(execFileSync('python', ['-c', String.raw`
import ctypes, ctypes.wintypes as w, json, sys
u=ctypes.WinDLL('user32',use_last_error=True)
u.GetForegroundWindow.restype=w.HWND
u.IsWindowVisible.argtypes=[w.HWND];u.IsWindowVisible.restype=w.BOOL
u.GetWindowThreadProcessId.argtypes=[w.HWND,ctypes.POINTER(w.DWORD)]
u.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,ctypes.c_int]
result=[]
@ctypes.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
def collect(hwnd,_):
    process=w.DWORD();u.GetWindowThreadProcessId(hwnd,ctypes.byref(process))
    if process.value==int(sys.argv[1]):
        title=ctypes.create_unicode_buffer(512);u.GetWindowTextW(hwnd,title,512)
        result.append({'hwnd':int(hwnd),'title':title.value,'visible':bool(u.IsWindowVisible(hwnd))})
    return True
u.EnumWindows(collect,0)
print(json.dumps({'foreground':int(u.GetForegroundWindow() or 0),'windows':result},ensure_ascii=True))
`, String(pid)], { encoding: 'utf8', windowsHide: true }));
const noticeWindow = () => nativeWindows().windows.find(window => window.title === 'Inky Paper · 提醒');
const show = async (message, id = crypto.randomUUID()) => {
  await invoke('paper_show_notice', { id, message });
  await popup.getByRole('status').filter({ hasText: message }).waitFor();
  assert(noticeWindow()?.visible, 'Actual Win32 notice window must be visible');
  return id;
};
const waitClosed = async () => {
  await popup.waitForFunction(() => !document.querySelector('.paper-notice-card'));
  assert.equal(noticeWindow()?.visible, false, 'Actual Win32 notice window must hide');
};

try {
  const bridge = await invoke('get_paper_bridge_status');
  assert.equal(path.resolve(bridge.connectionFile), path.join(out, 'paper-test/paper-agent-bridge.json'));
  assert.equal((await state()).tasks.length, 0, 'Fresh isolated fixture required');
  await writeFile(path.join(out, 'initial-ui.txt'), await main.locator('body').ariaSnapshot());
  const taskId = crypto.randomUUID(), batchId = crypto.randomUUID(), cardId = crypto.randomUUID();
  const cards = [{ id: cardId, taskId, taskTitle: '复习', text: '复习', plannedSeconds: 1500 }];
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const batch = await api('propose_plan_batch', { requestId: crypto.randomUUID(), batchId, cards });
  await api('adopt_plan_cards', { requestId: crypto.randomUUID(), batchId, expectedRevision: batch.batch.revision, date, cardIds: [cardId] });
  await main.reload();
  await main.getByRole('heading', { name: '就从这一步开始' }).waitFor();
  await button('start').click();
  await button('结束番茄钟').click();
  await button('保存并结束').click();
  await main.getByRole('heading', { name: '就从这一步开始' }).waitFor();
  await popup.getByRole('status').filter({ hasText: '番茄钟已结束' }).waitFor();
  assert(noticeWindow()?.visible);
  assert.equal(await main.locator('.paper > .notice').count(), 0);
  const geometry = await popup.locator('.paper-notice-card').evaluate(element => ({
    width: innerWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight,
    cardHeight: element.getBoundingClientRect().height,
    messageScrollHeight: element.querySelector('p').scrollHeight,
    messageClientHeight: element.querySelector('p').clientHeight,
  }));
  assert.equal(geometry.width, 300); assert.equal(geometry.height, 156);
  assert(geometry.scrollHeight <= 156); assert(geometry.messageScrollHeight <= geometry.messageClientHeight);
  await popup.screenshot({ path: path.join(shots, 'saved-notice.png') });
  await main.screenshot({ path: path.join(shots, 'task-page.png') });
  let saved = await state();
  assert(saved.sessions.every(session => session.status === 'finished'));
  assert(!saved.tasks[0].completed && !saved.tasks[0].nextAction.completed);
  const homeTop = await main.locator('.home-body').evaluate(element => element.getBoundingClientRect().top);
  await popup.getByRole('button', { name: '知道了', exact: true }).click();
  await waitClosed();
  assert.deepEqual(await state(), saved);
  assert.equal(await main.locator('.home-body').evaluate(element => element.getBoundingClientRect().top), homeTop);
  pass('Saving unfinished work opens a separate 300x156 native notice; task layout and saved facts are unchanged by acknowledgement');

  await api('start_session', { requestId: crypto.randomUUID(), kind: 'rest', plannedSeconds: 300 });
  await main.reload();
  await button('结束休息').click();
  await popup.getByRole('status').filter({ hasText: '休息结束，下一步由你决定。' }).waitFor();
  saved = await state();
  await main.keyboard.press('Escape');
  await waitClosed();
  assert.deepEqual(await state(), saved);
  pass('Ending a real rest session produces the same native notice; Escape works in the main window that retained keyboard focus');

  const foreground = nativeWindows().foreground;
  await show('休息结束，下一步由你决定。');
  assert.equal(nativeWindows().foreground, foreground);
  await popup.getByRole('button', { name: '关闭提醒' }).click();
  await waitClosed();
  pass('Showing does not steal foreground focus; X closes the actual native window');

  await show('这一轮已保存。下一步有变化，请看过后再开始。');
  await popup.keyboard.press('Escape');
  await waitClosed();
  pass('Escape dismisses the notice without exiting Paper');

  const first = await show('工作目标已切换，本轮尚未开始。看过错误提示后可重试 start。');
  await new Promise(resolve => setTimeout(resolve, 4500));
  const second = await show('新的操作已保存。');
  await invoke('paper_dismiss_notice', { id: first });
  assert.equal((await invoke('paper_current_notice')).id, second);
  await new Promise(resolve => setTimeout(resolve, 3900));
  assert(noticeWindow()?.visible, 'Previous expiry must not close the new notice');
  assert.equal(nativeWindows().windows.filter(window => window.title === 'Inky Paper · 提醒').length, 1);
  await waitClosed();
  pass('Notices reuse one window; stale dismiss/expiry preserve the latest message, which automatically closes after eight seconds');

  await show('窗口重载后仍保留当前提醒。');
  await popup.reload();
  await popup.getByRole('status').filter({ hasText: '窗口重载后仍保留当前提醒' }).waitFor();
  await popup.getByRole('button', { name: '知道了', exact: true }).click();
  await waitClosed();
  assert.deepEqual(await state(), saved);
  assert.deepEqual(errors, []);
  pass('A webview reload restores the pending message; all notice interactions leave tasks and timing untouched');
  const markdown = await readFile(path.join(out, 'paper-test/工作记录/每日', `${date}.md`), 'utf8');
  assert(markdown.includes('复习'));
  await writeFile(path.join(out, 'verification.json'), JSON.stringify({ result: 'PASS', checks, geometry, errors, isolatedData: true }, null, 2));
} catch (error) {
  await popup.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally { process.exit(process.exitCode || 0); }
