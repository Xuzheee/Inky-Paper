import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";

// Run only after the root task fully stops/relaunches the same isolated native data directory.
const run = process.argv[2];
assert.match(run || "", /^p0p1-m3-[A-Za-z0-9_-]+$/);
const root = path.resolve("output", run);
const out = path.resolve("docs/verification/p0p1/M3");
const expected = JSON.parse(
  await readFile(path.join(root, "m3-restart-expectation.json"), "utf8"),
);
const report = JSON.parse(
  await readFile(path.join(out, "desktop-flow.json"), "utf8"),
);
assert.equal(expected.run, run);
assert.equal(report.isolatedRun, run);
assert.equal(
  report.flowPassed,
  true,
  "The native M3 flow must pass before restart verification",
);
const pid = Number(await readFile(path.join(root, "paper-test.pid"), "utf8"));
assert(Number.isSafeInteger(pid) && pid > 0);
assert(Number.isSafeInteger(expected.pid) && expected.pid > 0);
assert.notEqual(
  pid,
  expected.pid,
  "A webview reload is not a full native process restart",
);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9254");
const errors = [];
report.restartPassed = false;
report.complete = false;
try {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const main = pages.find((page) => page.url() === "http://tauri.localhost/");
  const wb = pages.find((page) => page.url().includes("workbench=1"));
  assert(main && wb, "Both native webviews are required");
  assert.equal(new URL(wb.url()).origin, "http://tauri.localhost");
  for (const page of pages) {
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
  }
  const invoke = (command, args = {}) =>
    wb.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    );
  assert.equal(
    path.resolve((await invoke("get_paper_bridge_status")).connectionFile),
    path.join(root, "paper-test/paper-agent-bridge.json"),
  );
  const visible = (title) => {
    const windows = JSON.parse(
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
        windows.append({'title':title.value,'visible':bool(u.IsWindowVisible(hwnd))})
    return True
u.EnumWindows(collect,0)
print(json.dumps(windows,ensure_ascii=True))
`,
          String(pid),
        ],
        { encoding: "utf8", windowsHide: true },
      ),
    );
    assert(
      windows.some((window) => window.title === title && window.visible),
      `The restarted native ${title} window must be visible`,
    );
  };
  const state = (
    await invoke("paper_execute", { action: "get_state", input: {} })
  ).state;
  assert.deepEqual(state.planning.prepared, {
    taskId: expected.taskId,
    stepId: expected.stepId,
    dayItemId: expected.dayItemId,
  });
  const item = state.planning.dayItems.find(
    (item) => item.id === expected.dayItemId,
  );
  assert(item && item.removedAt === null);
  assert.equal(item.taskId, expected.taskId);
  assert.equal(item.stepId, expected.stepId);
  assert.equal(item.date, expected.planDate);
  assert.equal(
    state.planning.sessionLinks.find(
      (link) => link.sessionId === expected.sessionId,
    )?.planDate,
    expected.planDate,
  );
  assert.equal(
    state.planning.steps.find((step) => step.id === expected.stepId)?.completed,
    expected.preparedStepCompleted,
  );
  assert.equal(
    state.tasks.find((task) => task.id === expected.taskId)?.completed,
    false,
  );
  assert.deepEqual(
    state.planning.taskCompletionAcknowledgements.find(
      (ack) => ack.taskId === expected.taskId,
    ),
    expected.acknowledgement,
  );
  const note = state.notes.find((note) => note.id === expected.noteId);
  assert.deepEqual(
    note,
    expected.note,
    "The original note and conversion/source relationships must persist unchanged",
  );
  assert.equal(note.convertedTaskId, expected.convertedTaskId);
  assert.equal(
    state.tasks.filter((task) => task.id === expected.convertedTaskId).length,
    1,
  );
  assert.equal(state.tasks.length, expected.taskCount);
  assert.deepEqual(
    state.sessions,
    expected.sessions,
    "Restart must not change old session snapshots or create new clocks",
  );
  assert(state.sessions.every((session) => session.status === "finished"));

  await invoke("coach_show_main", { view: "home" });
  await main
    .locator(".next-card h2")
    .filter({ hasText: expected.stepText })
    .waitFor();
  visible("Inky Paper");
  await main
    .getByText("原来准备的任务或步骤已完成，请重新选择下一步。", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await main.getByRole("button", { name: "start", exact: true }).count(),
    0,
  );
  assert.equal(
    await main.getByRole("region", { name: "父任务收尾", exact: true }).count(),
    0,
  );
  assert.equal(
    await main.getByRole("button", { name: "保留后续", exact: true }).count(),
    0,
  );
  await main.screenshot({ path: path.join(out, "restart-paper.png") });

  await invoke("open_workbench");
  visible("Inky · 工作台");
  await wb.getByRole("button", { name: "随手记整理", exact: true }).click();
  const inbox = wb.getByRole("region", { name: "随手记整理", exact: true });
  await inbox.getByRole("button", { name: "全部", exact: true }).click();
  const entry = inbox.locator(`.wk-note[data-note-id="${expected.noteId}"]`);
  await entry.waitFor();
  assert.equal(
    await entry.locator(".wk-note-text").textContent(),
    expected.note.text,
  );
  await entry.getByText("已转任务", { exact: true }).waitFor();
  assert.equal(
    await entry
      .getByRole("button", { name: "转为新任务", exact: true })
      .count(),
    0,
  );
  await entry.getByRole("button", { name: "打开任务", exact: true }).waitFor();
  await wb.screenshot({ path: path.join(out, "restart-notes.png") });
  const after = (
    await invoke("paper_execute", { action: "get_state", input: {} })
  ).state;
  assert.deepEqual(after.sessions, expected.sessions);
  assert.equal(after.tasks.length, expected.taskCount);
  assert.deepEqual(errors, []);
  report.checks.push(
    "A different native process PID restores the exact prepared source, original session snapshots, acknowledged parent prompt and unique note conversion without starting a clock",
  );
  report.restartPid = pid;
  report.restartPassed = true;
  report.restartErrors = errors;
  // Root still owns overall M3 acceptance and before/after timing conclusions.
  console.log(
    "PASS full native restart: prepared source, parent acknowledgement, note conversion, no active clock",
  );
} catch (error) {
  report.restartFailure = String(error);
  report.restartErrors = errors;
  throw error;
} finally {
  await writeFile(
    path.join(out, "desktop-verification.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
