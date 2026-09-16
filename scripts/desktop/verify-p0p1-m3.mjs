import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
const run = process.argv[2];
assert.match(run || "", /^p0p1-m3-[\w-]+$/);
const root = path.resolve("output", run);
const pid = Number(await readFile(path.join(root, "paper-test.pid"), "utf8"));
assert(
  Number.isSafeInteger(pid) && pid > 0,
  "An isolated native launcher PID is required",
);
const out = path.resolve("docs/verification/p0p1/M3");
await mkdir(out, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9254");
const pages = browser.contexts().flatMap((c) => c.pages()),
  wb = pages.find((p) => p.url().includes("workbench=1")),
  main = pages.find((p) => p.url() === "http://tauri.localhost/");
assert(wb && main);
assert.equal(new URL(wb.url()).origin, "http://tauri.localhost");
const invoke = (command, args = {}) =>
  wb.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const api = (action, input = {}) =>
  invoke("paper_execute", {
    action,
    input: {
      ...input,
      ...(!action.startsWith("get_") ? { requestId: randomUUID() } : {}),
    },
  });
assert.equal(
  path.resolve((await invoke("get_paper_bridge_status")).connectionFile),
  path.resolve("output", run, "paper-test/paper-agent-bridge.json"),
);
const get = async () => (await api("get_state")).state;
const today = await wb.evaluate(() => new Date().toLocaleDateString("en-CA"));
assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
const nativeWindows = () =>
  JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        String.raw`
import ctypes, ctypes.wintypes as w, json, sys
u=ctypes.WinDLL('user32',use_last_error=True)
u.IsWindowVisible.argtypes=[w.HWND];u.IsWindowVisible.restype=w.BOOL
u.GetWindowThreadProcessId.argtypes=[w.HWND,ctypes.POINTER(w.DWORD)]
u.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,ctypes.c_int]
windows=[]
@ctypes.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
def collect(hwnd,_):
    process=w.DWORD();u.GetWindowThreadProcessId(hwnd,ctypes.byref(process))
    if process.value==int(sys.argv[1]):
        title=ctypes.create_unicode_buffer(512);u.GetWindowTextW(hwnd,title,512)
        windows.append({'hwnd':int(hwnd),'title':title.value,'visible':bool(u.IsWindowVisible(hwnd))})
    return True
u.EnumWindows(collect,0)
print(json.dumps(windows,ensure_ascii=True))
`,
        String(pid),
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
const assertVisible = (page) => {
  const title = page === main ? "Inky Paper" : "Inky · 工作台";
  assert(
    nativeWindows().some((window) => window.title === title && window.visible),
    `The real native ${title} window must be visible`,
  );
};
const checks = [],
  errors = [];
for (const page of pages) {
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
}
const pass = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
const shot = async (page, name) => {
  assertVisible(page);
  return page.screenshot({ path: path.join(out, `${name}.png`) });
};
const report = {
  isolatedRun: run,
  pid,
  checks,
  errors,
  complete: false,
  modelCalls: 0,
  baselineTiming: null,
};
try {
  const initial = await get();
  assert.equal(initial.tasks.length, 0, "fresh M3 data required");
  const prepared = await api("workbench_save_step", {
    taskId: randomUUID(),
    stepId: randomUUID(),
    title: "M3 原生合成任务",
    text: "核对第三项",
    category: "work",
    plannedSeconds: 900,
    date: today,
  });
  await invoke("workbench_prepare_step", {
    input: {
      taskId: prepared.task.id,
      stepId: prepared.step.id,
      expectedRevision: prepared.task.revision,
      expectedStepRevision: prepared.step.revision,
      requestId: randomUUID(),
    },
    itemId: prepared.item.id,
  });
  await main.getByRole("button", { name: "start", exact: true }).waitFor();
  assertVisible(main);
  await main.getByRole("button", { name: "start", exact: true }).click();
  await main.getByRole("button", { name: "结束番茄钟", exact: true }).waitFor();
  await main.mouse.move(170, 110);
  const captureAt = performance.now();
  await main.getByRole("button", { name: "随手记", exact: true }).click();
  await main
    .getByLabel("本轮随手记")
    .fill("M3 临时想到的事项：明天问清接口要求");
  await main
    .getByRole("button", { name: "记下，回到这一轮", exact: true })
    .click();
  await main.getByLabel("本轮随手记").waitFor({ state: "hidden" });
  const captureMs = performance.now() - captureAt;
  let state = await get();
  let session = state.sessions.find((s) => s.status !== "finished");
  assert(session);
  const note = state.notes[0];
  assert.equal(note.sessionId, session.id);
  assert.equal(note.action.id, prepared.step.id);
  assert.equal(session.status, "running");
  const endAt = performance.now();
  await main.getByRole("button", { name: "结束番茄钟", exact: true }).click();
  await main.getByRole("button", { name: "保存并结束", exact: true }).waitFor();
  assert.equal(await main.getByRole("textbox").count(), 0);
  await shot(main, "end-default");
  const saveAt = performance.now();
  await main.getByRole("button", { name: "保存并结束", exact: true }).click();
  await main.getByRole("button", { name: "start", exact: true }).waitFor();
  report.actions = {
    captureNote: { clicks: 2, textEntry: 1, elapsedMs: captureMs },
    finishWithoutFeedback: {
      clicks: 2,
      endToHomeMs: performance.now() - endAt,
      saveClickToHomeMs: performance.now() - saveAt,
    },
  };
  state = await get();
  const saved = state.sessions.find((s) => s.id === session.id);
  assert.equal(saved.status, "finished");
  assert.deepEqual(saved.feedback, {
    outcome: "stopped",
    output: null,
    blocker: null,
    nextCue: null,
  });
  assert.equal(state.tasks[0].completed, false);
  assert(state.sessions.every((s) => s.status === "finished"));
  pass(
    "Native focus captures the original note and source; two-click end/save needs no feedback, keeps task pending and starts no next clock",
  );
  await main.getByRole("button", { name: "继续这一步", exact: true }).click();
  await main
    .getByRole("button", { name: "继续这一步", exact: true })
    .waitFor({ state: "hidden" });
  await main.getByRole("button", { name: "start", exact: true }).waitFor();
  state = await get();
  assert.equal(state.planning.prepared.stepId, prepared.step.id);
  assert.equal(state.planning.prepared.dayItemId, prepared.item.id);
  assert(state.sessions.every((s) => s.status === "finished"));
  await main.getByRole("button", { name: "打开工作台", exact: true }).click();
  assertVisible(wb);
  await wb.getByRole("button", { name: "随手记整理", exact: true }).click();
  const inbox = wb.getByRole("region", { name: "随手记整理", exact: true });
  const entry = inbox.locator(`.wk-note[data-note-id="${note.id}"]`);
  await entry.waitFor();
  await shot(wb, "note-inbox");
  await entry.getByRole("button", { name: "转为新任务", exact: true }).click();
  await entry
    .getByRole("button", { name: "创建任务并保留笔记", exact: true })
    .click();
  await entry
    .getByText("已转为任务，原笔记与来源已保留。", { exact: true })
    .waitFor();
  await inbox.getByRole("button", { name: "全部", exact: true }).click();
  assert.equal(
    await entry
      .getByRole("button", { name: "转为新任务", exact: true })
      .count(),
    0,
  );
  state = await get();
  const converted = state.notes.find((n) => n.id === note.id);
  assert.equal(converted.text, note.text);
  assert.equal(converted.sessionId, session.id);
  assert.equal(converted.taskId, note.taskId);
  assert.deepEqual(converted.action, note.action);
  assert(converted.convertedTaskId);
  assert.equal(state.tasks.length, 2);
  assert(state.sessions.every((s) => s.status === "finished"));
  pass(
    "Workbench organizes the captured note into one task while keeping original text, note id, session and action source",
  );
  await invoke("coach_show_main", { view: "home" });
  await main.getByRole("button", { name: "start", exact: true }).click();
  await main.getByRole("button", { name: "结束番茄钟", exact: true }).waitFor();
  await main.getByRole("button", { name: "结束番茄钟", exact: true }).click();
  await main
    .getByRole("button", { name: "补充记录（可选）", exact: true })
    .click();
  assert(await main.getByLabel("下次起点", { exact: true }).isVisible());
  assert.equal(await main.getByRole("textbox").count(), 1);
  assert.equal(await main.getByLabel("产出", { exact: true }).count(), 0);
  await main
    .getByRole("radio", { name: "已完成", exact: true })
    .locator("..")
    .click();
  assert(
    await main.getByRole("radio", { name: "已完成", exact: true }).isChecked(),
  );
  await main.getByLabel("产出", { exact: true }).fill("合成记录已核对");
  assert.equal(await main.getByRole("textbox").count(), 1);
  assert.equal(await main.getByLabel("下次起点", { exact: true }).count(), 0);
  await shot(main, "end-contextual");
  await main.getByRole("button", { name: "保存并结束", exact: true }).click();
  await main.getByRole("button", { name: "保留后续", exact: true }).waitFor();
  await shot(main, "parent-confirmation");
  await main.getByRole("button", { name: "保留后续", exact: true }).click();
  await main
    .getByRole("button", { name: "保留后续", exact: true })
    .waitFor({ state: "hidden" });
  state = await get();
  assert.equal(
    state.tasks.find((t) => t.id === prepared.task.id).completed,
    false,
  );
  assert(state.planning.steps.find((s) => s.id === prepared.step.id).completed);
  assert.equal(state.planning.taskCompletionAcknowledgements.length, 1);
  assert(state.sessions.every((s) => s.status === "finished"));
  pass(
    "Contextual feedback shows one question; completed step prompts once for its parent, and keeping follow-up never completes the parent or starts a clock",
  );
  await main.reload();
  await invoke("coach_show_main", { view: "home" });
  await main
    .locator(".next-card h2")
    .filter({ hasText: prepared.step.text })
    .waitFor();
  assert.equal(
    await main.getByRole("button", { name: "保留后续", exact: true }).count(),
    0,
  );
  await invoke("open_workbench");
  assertVisible(wb);
  await wb.getByRole("button", { name: "本周", exact: true }).click();
  await wb
    .getByRole("button", { name: "添加任务", exact: true })
    .first()
    .click();
  const dialog = wb.getByRole("dialog");
  await dialog
    .getByLabel("任务名称", { exact: true })
    .fill("M3 丢响应的新任务");
  await wb.evaluate(() => {
    // Fault injection delegates to the real Rust transaction first. It never supplies fake state.
    const actual = window.fetch;
    window.__m3FaultInjected = false;
    window.fetch = async (url, options) => {
      const response = await actual(url, options);
      if (String(url).includes('/paper_execute') && typeof options?.body === 'string' && JSON.parse(options.body).action === 'workbench_save_step') {
        if (response.headers.get('Tauri-Response') !== 'ok') throw Error('Expected a successful real native commit before injecting loss');
        window.fetch = actual;
        window.__m3FaultInjected = true;
        return new Response(JSON.stringify('M3 simulated lost response after commit'), {headers: {'Content-Type':'application/json','Tauri-Response':'error'}});
      }
      return response;
    };
  });
  report.faultInjection =
    "One deliberately lost workbench_save_step response after the real native transaction committed";
  await dialog.getByRole("button", { name: "保存计划", exact: true }).click();
  await dialog
    .getByRole("button", { name: "核实并重试", exact: true })
    .waitFor();
  assert.equal(await wb.evaluate(() => window.__m3FaultInjected), true);
  state = await get();
  assert.equal(
    state.tasks.filter((t) => t.title === "M3 丢响应的新任务").length,
    1,
  );
  await wb.reload();
  await wb.getByRole("button", { name: /核实保存：M3 丢响应的新任务/ }).click();
  await wb
    .getByRole("dialog")
    .getByRole("button", { name: "核实并重试", exact: true })
    .click();
  await wb.getByRole("dialog").waitFor({ state: "hidden" });
  state = await get();
  assert.equal(
    state.tasks.filter((t) => t.title === "M3 丢响应的新任务").length,
    1,
  );
  pass(
    "A real committed title-only add with a deliberately lost response restores its original request after webview reload without duplicating the task",
  );
  await shot(wb, "restored-write");
  assert.deepEqual(errors, []);
  assert(state.sessions.every((s) => s.status === "finished"));
  assert.deepEqual(state.planning.prepared, {
    taskId: prepared.task.id,
    stepId: prepared.step.id,
    dayItemId: prepared.item.id,
  });
  assert(
    state.planning.taskCompletionAcknowledgements.some(
      (ack) => ack.taskId === prepared.task.id,
    ),
  );
  report.flowPassed = true;
  report.complete = false; // A separate process restart and root milestone review are still required.
  await writeFile(
    path.resolve("output", run, "m3-restart-expectation.json"),
    JSON.stringify(
      {
        taskId: prepared.task.id,
        stepId: prepared.step.id,
        stepText: prepared.step.text,
        dayItemId: prepared.item.id,
        planDate: prepared.item.date,
        sessionId: session.id,
        noteId: note.id,
        convertedTaskId: converted.convertedTaskId,
        note: converted,
        acknowledgement: state.planning.taskCompletionAcknowledgements.find(
          (ack) => ack.taskId === prepared.task.id,
        ),
        sessions: state.sessions,
        taskCount: state.tasks.length,
        run,
        pid,
        preparedStepCompleted: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  report.failure = String(error);
  await shot(wb, "failure-workbench").catch(() => {});
  await shot(main, "failure-paper").catch(() => {});
  throw error;
} finally {
  await writeFile(
    path.join(out, "desktop-flow.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
