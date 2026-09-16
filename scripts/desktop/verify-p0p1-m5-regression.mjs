import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// Run only after launch-p0p1.ps1 creates a fresh isolated debug instance.
// No DOM state mocks, SQL edits, model calls, synthetic clock or viewport emulation.
// The 60-second focus round expires naturally; the five-minute rest is ended by UI.
const run = process.argv[2];
assert.match(run || "", /^p0p1-m5-[A-Za-z0-9_-]+$/);
const root = path.resolve("output", run);
const outputParent = path.resolve("docs/verification/p0p1/M5");
const out = path.join(outputParent, run);
const pid = Number(await readFile(path.join(root, "paper-test.pid"), "utf8"));
assert(Number.isSafeInteger(pid) && pid > 0, "Isolated launcher PID required");
await mkdir(outputParent, { recursive: true });
await mkdir(out); // Keep each attempted run's evidence; refuse overwriting it.

const report = {
  isolatedRun: run,
  pid,
  checks: [],
  errors: [],
  screenshots: [],
  geometry: {},
  modelCalls: 0,
  desktopPassed: false,
  complete: false,
  boundaries: [
    "Fresh synthetic tasks and notes, real native Tauri transactions and visible WebViews.",
    "60-second focus expires by real wall time; no time acceleration or state injection.",
    "Chinese text uses Playwright fill; Tab/Enter/Escape use WebView keyboard events, not an OS IME composition test.",
    "Workbench is resized through Win32, not an emulated browser viewport. Original outer size is restored.",
    "Transparency checks renderer styles and geometry, not every desktop wallpaper or display configuration.",
    "Only the validated isolated personal Markdown file is externally edited.",
  ],
  pending: [
    "C-03 summary evidence/version checks and C-05 real-model evaluation are separate acceptance work.",
    "Real Windows IME composition, candidate selection and composition Enter/Escape.",
    "Actual cross-midnight execution and timezone change; no synthetic boundary is reported as real midnight.",
    "Natural five-minute rest expiration and reminder timing under system suspension.",
    "Full-process restart, disconnect, lost-response retry and stale-version conflicts on the final integrated build.",
    "Multi-monitor/DPI transitions, physical drag/strike gestures and transparency over real varied wallpapers.",
    "Release executable, migration/rollback replay and final full-suite checks.",
  ],
};
const pass = (message) => {
  report.checks.push(message);
  console.log("PASS", message);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Only enumerate/resize a window belonging to the launcher PID. Window sizes
// come from Win32 client rectangles at the window's real DPI, not CSS alone.
const nativeWindows = (change = null) =>
  JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        String.raw`
import ctypes, ctypes.wintypes as w, json, sys
u=ctypes.WinDLL('user32',use_last_error=True)
u.SetProcessDpiAwarenessContext.argtypes=[w.HANDLE]
u.SetProcessDpiAwarenessContext(w.HANDLE(-4))
u.IsWindowVisible.argtypes=[w.HWND];u.IsWindowVisible.restype=w.BOOL
u.GetWindowThreadProcessId.argtypes=[w.HWND,ctypes.POINTER(w.DWORD)]
u.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,ctypes.c_int]
u.GetWindowRect.argtypes=[w.HWND,ctypes.POINTER(w.RECT)]
u.GetClientRect.argtypes=[w.HWND,ctypes.POINTER(w.RECT)]
u.GetDpiForWindow.argtypes=[w.HWND];u.GetDpiForWindow.restype=w.UINT
u.SetWindowPos.argtypes=[w.HWND,w.HWND,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,w.UINT]
u.SetWindowPos.restype=w.BOOL
pid=int(sys.argv[1]);change=json.loads(sys.argv[2]);windows=[]
def inspect(hwnd,title):
    outer=w.RECT();client=w.RECT()
    assert u.GetWindowRect(hwnd,ctypes.byref(outer))
    assert u.GetClientRect(hwnd,ctypes.byref(client))
    dpi=u.GetDpiForWindow(hwnd);assert dpi
    return {'hwnd':int(hwnd),'title':title,'visible':bool(u.IsWindowVisible(hwnd)),
      'dpi':dpi,'outer':{'x':outer.left,'y':outer.top,'width':outer.right-outer.left,'height':outer.bottom-outer.top},
      'client':{'width':client.right-client.left,'height':client.bottom-client.top},
      'logicalClient':{'width':(client.right-client.left)*96/dpi,'height':(client.bottom-client.top)*96/dpi}}
@ctypes.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
def collect(hwnd,_):
    process=w.DWORD();u.GetWindowThreadProcessId(hwnd,ctypes.byref(process))
    if process.value==pid:
        title=ctypes.create_unicode_buffer(512);u.GetWindowTextW(hwnd,title,512)
        windows.append(inspect(hwnd,title.value))
    return True
u.EnumWindows(collect,0)
if change:
    targets=[v for v in windows if v['title']==change['title']]
    assert len(targets)==1, 'Expected exactly one PID-owned native target'
    target=targets[0]
    if change['mode']=='client':
        width=round(change['width']*target['dpi']/96)+target['outer']['width']-target['client']['width']
        height=round(change['height']*target['dpi']/96)+target['outer']['height']-target['client']['height']
    else:
        assert change['mode']=='outer'
        width=change['width'];height=change['height']
    assert width>0 and height>0
    assert u.SetWindowPos(target['hwnd'],None,0,0,width,height,0x0002|0x0004|0x0010), ctypes.get_last_error()
    windows=[inspect(v['hwnd'],v['title']) for v in windows]
print(json.dumps(windows,ensure_ascii=True))
`,
        String(pid),
        JSON.stringify(change),
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );

let browser, wb, main, originalWorkbenchSize;
const titleFor = (page) =>
  page === wb
    ? "Inky · 工作台"
    : page === main
      ? "Inky Paper"
      : "Inky Paper · 提醒";
const visible = (page) => {
  const target = nativeWindows().find((win) => win.title === titleFor(page));
  assert(
    target?.visible,
    `Real native ${titleFor(page)} window must be visible`,
  );
  return target;
};
const shot = async (page, name) => {
  visible(page);
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, omitBackground: true });
  report.screenshots.push(file);
};
const size = async (page, width, height, label) => {
  await page.waitForFunction(
    ({ width, height }) =>
      Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1,
    { width, height },
  );
  const win = visible(page);
  assert(Math.abs(win.logicalClient.width - width) <= 1, label);
  assert(Math.abs(win.logicalClient.height - height) <= 1, label);
  report.geometry[label] = win;
};

try {
  browser = await chromium.connectOverCDP("http://127.0.0.1:9254");
  const pages = browser.contexts().flatMap((context) => context.pages());
  wb = pages.find((page) => page.url().includes("workbench=1"));
  main = pages.find((page) => page.url() === "http://tauri.localhost/");
  assert(wb && main, "Both real native WebViews are required");
  assert.equal(new URL(wb.url()).origin, "http://tauri.localhost");
  const track = (page) => {
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => report.errors.push(error.message));
  };
  pages.forEach(track);
  browser.contexts().forEach((context) => context.on("page", track));
  const invoke = (command, args = {}) =>
    wb.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    );
  assert.equal(
    path.resolve((await invoke("get_paper_bridge_status")).connectionFile),
    path.join(root, "paper-test/paper-agent-bridge.json"),
  );
  const api = (action, input = {}) =>
    invoke("paper_execute", {
      action,
      input: {
        ...input,
        ...(action.startsWith("get_") ? {} : { requestId: randomUUID() }),
      },
    });
  const get = async () => (await api("get_state")).state;
  const stateUntil = async (predicate, description, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    do {
      const state = await get();
      if (predicate(state)) return state;
      await delay(250);
    } while (Date.now() < deadline);
    assert.fail(description);
  };
  const button = (name) => main.getByRole("button", { name, exact: true });
  const noClock = (state) =>
    assert(state.sessions.every((session) => session.status === "finished"));
  let state = await get();
  assert.equal(state.tasks.length, 0, "Fresh isolated M5 data required");
  assert.equal(state.sessions.length, 0);
  assert.equal(state.notes.length, 0);
  const { today, offset } = await wb.evaluate(() => {
    const date = new Date();
    return {
      today: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      offset: -date.getTimezoneOffset(),
    };
  });
  report.today = today;
  await invoke("open_workbench");
  originalWorkbenchSize = visible(wb).outer;
  nativeWindows({
    title: titleFor(wb),
    mode: "client",
    width: 1060,
    height: 640,
  });
  await size(wb, 1060, 640, "workbench-minimum");
  const layout = await wb.evaluate(() => {
    const regions = [".wk-sidebar", ".wk-main", ".wk-coach"].map((selector) => {
      const element = document.querySelector(selector);
      if (!element) throw Error(`Missing ${selector}`);
      const rect = element.getBoundingClientRect();
      return { selector, x: rect.x, right: rect.right, width: rect.width };
    });
    return {
      regions,
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  assert(layout.scrollWidth <= layout.width + 1);
  for (const region of layout.regions)
    assert(
      region.width > 0 && region.x >= -1 && region.right <= layout.width + 1,
    );
  report.minimumLayout = layout;
  await shot(wb, "workbench-minimum");
  pass(
    "Real workbench client is 1060×640 with all three regions in the native viewport",
  );

  const title = "M5 键盘草稿与手动记录";
  const add = wb
    .locator(`.wk-day-column[data-date="${today}"]`)
    .getByRole("button", { name: "添加任务", exact: true });
  await add.focus();
  await wb.keyboard.press("Enter");
  const dialog = wb.getByRole("dialog");
  const titleInput = dialog.getByRole("textbox", {
    name: "任务名称",
    exact: true,
  });
  await titleInput.fill(title); // Direct Unicode input, explicitly not an IME test.
  await titleInput.focus();
  await wb.keyboard.press("Tab");
  assert.equal(
    await titleInput.evaluate((element) => element === document.activeElement),
    false,
  );
  assert(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  );
  await wb.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await get()).tasks.length, 0);
  await wb.reload(); // Draft persists beyond a component close and WebView reload.
  await add.focus();
  await wb.keyboard.press("Enter");
  assert.equal(await titleInput.inputValue(), title);
  await dialog.getByRole("button", { name: "保存计划", exact: true }).focus();
  await wb.keyboard.press("Enter");
  await dialog.waitFor({ state: "hidden" });
  state = await stateUntil(
    (value) => value.tasks.some((task) => task.title === title),
    "Keyboard submit must create the task",
  );
  const manualTask = state.tasks.find((task) => task.title === title);
  const manualStep = state.planning.steps.find(
    (step) => step.taskId === manualTask.id,
  );
  const manualItem = state.planning.dayItems.find(
    (item) => item.stepId === manualStep.id,
  );
  assert.equal(manualItem.date, today);
  noClock(state);
  pass(
    "Enter opens/saves, Tab stays in dialog, Escape closes, and Chinese draft survives WebView reload without creating a task early",
  );

  const fixture = await api("workbench_save_step", {
    taskId: randomUUID(),
    stepId: randomUUID(),
    title: "M5 原生短工作段",
    text: "等待真实一分钟并保存",
    category: "work",
    plannedSeconds: 60,
    date: today,
  });
  report.fixture = {
    taskId: fixture.task.id,
    stepId: fixture.step.id,
    itemId: fixture.item.id,
    manualTaskId: manualTask.id,
    manualStepId: manualStep.id,
    manualItemId: manualItem.id,
  };
  const focusRow = wb.locator(`[data-row-id="${fixture.item.id}"]`);
  await focusRow
    .getByRole("button", { name: fixture.step.text, exact: true })
    .click();
  await focusRow
    .getByRole("button", { name: "设为下一步并回到 Inky", exact: true })
    .click();
  await main
    .locator(".next-card h2")
    .filter({ hasText: fixture.step.text })
    .waitFor();
  await size(main, 320, 520, "paper-home");
  state = await get();
  assert.equal(state.planning.prepared.stepId, fixture.step.id);
  assert.equal(state.planning.prepared.dayItemId, fixture.item.id);
  noClock(state);
  await shot(main, "paper-home");
  await button("start").click();
  await button("暂停").waitFor();
  const startedAt = performance.now();
  await size(main, 360, 189, "focus");
  state = await get();
  const focus = state.sessions.find((session) => session.status === "running");
  assert.equal(focus.action.id, fixture.step.id);
  assert.equal(focus.plannedSeconds, 60);
  assert.equal(
    state.planning.sessionLinks.find((link) => link.sessionId === focus.id)
      .dayItemId,
    fixture.item.id,
  );
  await button("切换迷你宠物").click();
  await size(main, 160, 160, "mini");
  await shot(main, "mini");
  await button("返回 Inky Paper").focus();
  await main.keyboard.press("Enter");
  await size(main, 360, 189, "focus-from-mini");
  assert.equal(
    (await get()).sessions.find((session) => session.id === focus.id).status,
    "running",
  );
  await main.mouse.move(170, 70);
  await main.evaluate(() => document.fonts.ready);
  await main.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("main"), "::before").opacity ===
      "1",
  );
  const strip = () =>
    main.evaluate(() => {
      const style = (selector) =>
        getComputedStyle(document.querySelector(selector));
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return {
          x: value.x,
          y: value.y,
          width: value.width,
          height: value.height,
        };
      };
      return {
        timer: rect(".timer"),
        progress: rect(".pencil-progress"),
        sheet: style("main").backgroundColor,
        nav: style(".focus-navigation").backgroundColor,
        clock: style(".focus-clock").backgroundColor,
        shadow: style(".focus-clock").boxShadow,
        title: style(".focus-heading").visibility,
        controls: style(".focus-bottom").visibility,
        navigation: style(".focus-navigation").visibility,
        timerStroke: style(".timer").webkitTextStrokeWidth,
      };
    });
  const normal = await strip();
  await main.waitForFunction(() =>
    document.querySelector("main")?.classList.contains("focus-quiet"),
  );
  await main.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("main"), "::before").opacity ===
      "0",
  );
  const quiet = await strip();
  for (const field of ["sheet", "nav", "clock"])
    assert.equal(quiet[field], "rgba(0, 0, 0, 0)");
  assert.equal(quiet.shadow, "none");
  assert.equal(quiet.title, "hidden");
  assert.equal(quiet.controls, "hidden");
  assert.equal(quiet.navigation, "visible");
  assert.equal(quiet.timerStroke, "1px");
  assert.deepEqual(quiet.timer, normal.timer);
  assert.deepEqual(quiet.progress, normal.progress);
  report.transparent = { normal, quiet };
  await shot(main, "focus-transparent");
  await main.keyboard.press("Tab");
  await main.waitForFunction(
    () => !document.querySelector("main")?.classList.contains("focus-quiet"),
  );
  pass(
    "Handoff waits for explicit start; mini retains the same session; natural idle transparency keeps timer/navigation geometry and Tab restores controls",
  );

  await button("暂停").click();
  await button("继续").waitFor();
  await size(main, 360, 274, "focus-paused");
  const paused = (await get()).sessions.find(
    (session) => session.id === focus.id,
  );
  assert.equal(paused.status, "paused");
  await delay(1500);
  assert.equal(
    (await get()).sessions.find((session) => session.id === focus.id)
      .elapsedSeconds,
    paused.elapsedSeconds,
  );
  await shot(main, "focus-paused");
  await button("继续").click();
  await button("暂停").waitFor();
  await button("返回任务列表").click();
  await size(main, 320, 520, "home-with-running-focus");
  assert.equal(
    (await get()).sessions.find((session) => session.id === focus.id).status,
    "running",
  );
  await button("返回番茄钟").click();
  await size(main, 360, 189, "focus-return");
  pass(
    "Pause freezes recorded seconds; resume and list navigation keep the same active clock and original arrangement",
  );

  // Bounded waits keep progress visible; the backend clock is never altered.
  const deadline = Date.now() + 85000;
  let nextProgress = Date.now();
  for (;;) {
    const current = (await get()).sessions.find(
      (session) => session.id === focus.id,
    );
    if (current.status === "waiting") break;
    assert.equal(current.status, "running");
    assert(Date.now() < deadline, "Real 60-second focus must reach waiting");
    if (Date.now() >= nextProgress) {
      console.log(
        "WAIT natural focus expiry",
        Math.round((performance.now() - startedAt) / 1000),
        "wall seconds",
      );
      nextProgress = Date.now() + 15000;
    }
    await delay(2000);
  }
  await button("保存并结束").waitFor();
  await size(main, 320, 528, "expired-end");
  assert.match(await main.locator(".feedback-heading").innerText(), /已到时/);
  const expired = (await get()).sessions.find(
    (session) => session.id === focus.id,
  );
  assert.equal(expired.elapsedSeconds, 60);
  report.realFocusElapsedWallMs = Math.round(performance.now() - startedAt);
  assert(
    report.realFocusElapsedWallMs >= 58000,
    "Expiry must be natural, not accelerated",
  );
  assert.equal(await main.getByRole("textbox").count(), 0);
  await button("补充记录（可选）").click();
  await main.getByRole("textbox", { name: "下次起点", exact: true }).waitFor();
  await size(main, 320, 528, "expanded-end");
  await button("收起记录").click();
  await main
    .getByRole("radio", { name: "已完成", exact: true })
    .locator("..")
    .click();
  await shot(main, "expired-end");
  await button("保存并结束").click();
  await button("休息 5 分钟").waitFor();
  state = await get();
  noClock(state);
  assert.equal(
    state.planning.steps.find((step) => step.id === fixture.step.id).completed,
    true,
  );
  assert.equal(
    state.tasks.find((task) => task.id === fixture.task.id).completed,
    false,
  );
  assert.equal(
    state.sessions.find((session) => session.id === focus.id).feedback.outcome,
    "step_completed",
  );
  await button("保留后续").click();
  await button("保留后续").waitFor({ state: "hidden" });
  pass(
    "Natural expiry opens the fixed 320×528 end page; optional records keep its size; saving completes only the step and starts no next clock",
  );

  await button("休息 5 分钟").click();
  await button("结束休息").waitFor();
  await size(main, 320, 430, "rest");
  state = await get();
  const rest = state.sessions.find((session) => session.status === "running");
  assert.equal(rest.kind, "rest");
  assert.equal(rest.plannedSeconds, 300);
  await shot(main, "rest");
  await button("返回任务列表").click();
  await size(main, 320, 520, "home-with-rest");
  assert.equal(
    (await get()).sessions.find((session) => session.id === rest.id).status,
    "running",
  );
  await button("返回休息计时").click();
  await size(main, 320, 430, "rest-return");
  await button("结束休息").click();
  await main
    .getByRole("heading", { name: "就从这一步开始", exact: true })
    .waitFor();
  state = await get();
  noClock(state);
  assert.equal(state.sessions.length, 2);
  assert.equal(
    state.sessions.find((session) => session.id === rest.id).feedback.outcome,
    "rest_ended",
  );
  pass(
    "Explicit rest uses 320×430, navigation preserves it, and ending rest creates no focus session",
  );

  const sessionsBeforeManual = state.sessions;
  const paperRow = main.locator(
    `.sheet-queue-item[data-plan-item-id="${manualItem.id}"]`,
  );
  await paperRow
    .getByRole("button", { name: `完成步骤：${manualStep.text}`, exact: true })
    .click();
  await invoke("open_workbench");
  const manualRow = wb.locator(`[data-row-id="${manualItem.id}"]`);
  await manualRow
    .getByRole("button", { name: `撤销完成 ${manualStep.text}`, exact: true })
    .waitFor();
  state = await get();
  assert.equal(
    state.tasks.find((task) => task.id === manualTask.id).completed,
    false,
  );
  await manualRow
    .getByRole("button", { name: `撤销完成 ${manualStep.text}`, exact: true })
    .click();
  await paperRow
    .getByRole("button", { name: `完成步骤：${manualStep.text}`, exact: true })
    .waitFor();
  state = await get();
  assert.deepEqual(state.sessions, sessionsBeforeManual);
  const changes = state.planning.manualStepChanges.filter(
    (change) => change.stepId === manualStep.id,
  );
  assert.equal(changes.length, 2);
  assert.deepEqual(
    changes.map((change) => change.completed),
    [true, false],
  );
  assert.equal(
    state.planning.steps.find((step) => step.id === manualStep.id).completed,
    false,
  );
  pass(
    "Paper completion reaches workbench and workbench undo reaches Paper; parent and recorded sessions remain separate",
  );

  await wb.getByRole("tab", { name: "每日记录", exact: true }).click();
  await wb
    .getByRole("article", { name: `${today}每日记录`, exact: true })
    .waitFor();
  assert.match(await wb.locator(".wk-journal").innerText(), /手动完成/);
  assert.match(await wb.locator(".wk-journal").innerText(), /撤销完成/);
  await shot(wb, "daily-record");
  await wb.getByRole("button", { name: "Markdown 原文", exact: true }).click();
  await wb
    .getByLabel("Markdown 原始内容")
    .filter({ hasText: manualStep.text })
    .waitFor();
  const beforeNotes = await api("get_daily_record", {
    date: today,
    utcOffsetMinutes: offset,
  });
  const documents = await invoke("workbench_read_documents", { date: today });
  const personal = documents.documents.find(
    (document) => document.kind === "personal",
  );
  assert(personal?.exists && !personal.error);
  const isolatedPath = await realpath(path.join(root, "paper-test"));
  const personalPath = await realpath(personal.path);
  const relative = path.relative(isolatedPath, personalPath);
  assert(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    "Never edit a personal note outside this isolated test directory",
  );
  const original = await readFile(personalPath, "utf8");
  const note = "M5 合成个人笔记：外部改动保持原文，不作为自动完成事实。";
  const edited = `${original}\n${note}\n`;
  await writeFile(personalPath, edited, "utf8");
  await wb.locator(".wk-document-tools select").selectOption("personal");
  await wb
    .getByRole("button", { name: "重新读取 Markdown", exact: true })
    .click();
  await wb.getByLabel("Markdown 原始内容").filter({ hasText: note }).waitFor();
  const afterNotes = await api("get_daily_record", {
    date: today,
    utcOffsetMinutes: offset,
  });
  assert.notEqual(afterNotes.notesVersion, beforeNotes.notesVersion);
  assert.equal(afterNotes.dataVersion, beforeNotes.dataVersion);
  assert(afterNotes.personalNotes.includes(note));
  await shot(wb, "external-personal-markdown");
  await wb.getByRole("tab", { name: "任务", exact: true }).click();
  await manualRow
    .getByRole("button", { name: `完成 ${manualStep.text}`, exact: true })
    .click();
  await stateUntil(
    (value) =>
      value.planning.steps.find((step) => step.id === manualStep.id)?.completed,
    "A real task export must complete after the external note edit",
  );
  assert.equal(await readFile(personalPath, "utf8"), edited);
  report.personalMarkdown = {
    path: personalPath,
    beforeNotesVersion: beforeNotes.notesVersion,
    afterNotesVersion: afterNotes.notesVersion,
    dataVersion: afterNotes.dataVersion,
  };
  pass(
    "Daily records and raw Markdown retain manual history; external personal-note edits change only notesVersion and survive the next real task export",
  );

  const beforeNotice = await get();
  await invoke("paper_show_notice", {
    id: randomUUID(),
    message: "M5 合成操作提醒：没有新增工作或计时。",
  });
  let popup;
  for (let attempt = 0; attempt < 30 && !popup; attempt++) {
    popup = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url().includes("paperNotice=1"));
    if (!popup) await delay(100);
  }
  assert(popup, "Native notice WebView required");
  await popup
    .getByRole("status")
    .filter({ hasText: "M5 合成操作提醒" })
    .waitFor();
  await size(popup, 300, 156, "notice");
  await shot(popup, "notice");
  await popup.getByRole("button", { name: "知道了", exact: true }).click();
  await popup.waitForFunction(
    () => !document.querySelector(".paper-notice-card"),
  );
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!nativeWindows().find((win) => win.title === titleFor(popup))?.visible)
      break;
    await delay(100);
  }
  assert.equal(
    nativeWindows().find((win) => win.title === titleFor(popup))?.visible,
    false,
  );
  assert.deepEqual(await get(), beforeNotice);
  pass(
    "Independent 300×156 notice is really visible, dismisses natively and does not mutate tasks or clocks",
  );

  const final = await get();
  noClock(final);
  assert.equal(final.sessions.length, 2);
  assert.equal(final.tasks.length, 2);
  assert.equal(final.notes.length, 0);
  assert.equal(
    await wb.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }),
    today,
    "This non-midnight scenario must stay on its captured local date",
  );
  assert.deepEqual(report.errors, []);
  report.final = {
    tasks: final.tasks.length,
    sessions: final.sessions.length,
    activeClocks: 0,
  };
  report.desktopPassed = true;
} catch (error) {
  report.errors.push(String(error?.stack || error));
  for (const page of [wb, main].filter(Boolean))
    await shot(page, `failure-${page === wb ? "workbench" : "paper"}`).catch(
      () => {},
    );
  console.error(error);
  process.exitCode = 1;
} finally {
  if (originalWorkbenchSize) {
    try {
      nativeWindows({
        title: "Inky · 工作台",
        mode: "outer",
        width: originalWorkbenchSize.width,
        height: originalWorkbenchSize.height,
      });
      report.workbenchSizeRestored = true;
    } catch (error) {
      report.errors.push(`Restore native workbench size: ${String(error)}`);
      report.desktopPassed = false;
      process.exitCode = 1;
    }
  }
  await writeFile(
    path.join(out, "desktop-regression.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close(); // Disconnect CDP; leave the isolated native process for inspection.
  console.log("REPORT", path.join(out, "desktop-regression.json"));
}
