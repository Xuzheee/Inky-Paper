import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright";

// Launch a fresh isolated debug build separately with launch-p0p1.ps1.
// This script uses real Tauri commands and visible UI; it never supplies mock application state.
const run = process.argv[2];
assert.match(run || "", /^p0p1-m4-[A-Za-z0-9_-]+$/);
const root = path.resolve("output", run);
const out = path.resolve("docs/verification/p0p1/M4");
await mkdir(out, { recursive: true });
const pid = Number(await readFile(path.join(root, "paper-test.pid"), "utf8"));
assert(Number.isSafeInteger(pid) && pid > 0, "Isolated launcher PID required");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9254");
const checks = [],
  errors = [],
  referenceRequests = [];
const reference = "https://example.invalid/m4-native-reference";
const report = {
  isolatedRun: run,
  pid,
  checks,
  errors,
  referenceRequests,
  modelCalls: 0,
  desktopPassed: false,
  complete: false,
};
let wb;
const visible = () => {
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
    windows.some(
      (window) => window.title === "Inky · 工作台" && window.visible,
    ),
    "The real native workbench window must be visible",
  );
};
const shot = async (name) => {
  visible();
  await wb.screenshot({ path: path.join(out, `${name}.png`) });
};
const pass = (text) => {
  checks.push(text);
  console.log("PASS", text);
};
try {
  const pages = browser.contexts().flatMap((context) => context.pages());
  wb = pages.find((page) => page.url().includes("workbench=1"));
  assert(wb && pages.some((page) => page.url() === "http://tauri.localhost/"));
  assert.equal(new URL(wb.url()).origin, "http://tauri.localhost");
  for (const page of pages) {
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
  }
  for (const context of browser.contexts())
    context.on("request", (request) => {
      if (request.url().startsWith("https://example.invalid/"))
        referenceRequests.push(request.url());
    });
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
  const initial = await get();
  assert.equal(initial.tasks.length, 0, "Fresh isolated M4 data required");
  assert.equal(initial.sessions.length, 0);
  assert.equal(initial.planning.context.projects.length, 0);
  assert.equal(initial.planning.context.preferences.length, 0);
  assert.equal(initial.planning.context.days.length, 0);
  const today = await wb.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  report.today = today;
  await invoke("open_workbench");
  visible();
  const seed = (
    title,
    text,
    category,
    plannedSeconds,
    startMinute,
    durationMinutes,
  ) =>
    api("workbench_save_step", {
      taskId: randomUUID(),
      stepId: randomUUID(),
      title,
      text,
      category,
      plannedSeconds,
      date: today,
      startMinute,
      durationMinutes,
    });
  const first = await seed("M4 合成甲任务", "M4 核对甲", "study", 900, 600, 60);
  const second = await seed(
    "M4 合成乙任务",
    "M4 核对乙",
    "work",
    2700,
    630,
    60,
  );
  const unknown = await seed(
    "M4 合成未估计任务",
    "M4 未估计步骤",
    "life",
    1500,
    null,
    null,
  );
  const seeded = await get();
  const button = (name) => wb.getByRole("button", { name, exact: true });
  await button("本周").click();
  const capacity = wb.locator("details.wk-capacity");
  await capacity
    .locator("summary")
    .filter({ hasText: /全日预留 120 分钟.*1 项未估计/ })
    .waitFor();
  await capacity.locator("summary").click();
  await capacity
    .getByText("可投入 未填写 · 日历占用 90 分钟", { exact: true })
    .waitFor();
  assert.match(await capacity.locator("summary").textContent(), /1 项未估计/);
  const overlapMessage = capacity
    .locator("p.wk-error")
    .filter({ hasText: "日程重叠：" });
  await overlapMessage.waitFor();
  assert.match(await overlapMessage.textContent(), /M4 核对甲/);
  assert.match(await overlapMessage.textContent(), /M4 核对乙/);
  let totals = (await api("get_day_capacity", { date: today })).capacity;
  assert.equal(totals.availableMinutes, null);
  assert.equal(totals.reservedMinutes, 120);
  assert.equal(totals.calendarOccupiedMinutes, 90);
  assert.equal(totals.unestimatedCount, 1);
  assert.equal(totals.fullyEstimated, false);
  assert.equal(totals.overBudget, null);
  assert.equal(totals.overlapPairs.length, 1);
  assert.deepEqual(
    [totals.overlapPairs[0].first, totals.overlapPairs[0].second].sort(),
    [first.item.id, second.item.id].sort(),
  );
  await shot("capacity-unknown-overlap");
  pass(
    "Unknown budget remains null; first-round timers do not estimate work; 120 reserved minutes and 90 calendar minutes remain distinct with one unknown estimate and one overlap",
  );

  await capacity.getByRole("button", { name: "自己调整", exact: true }).click();
  await capacity
    .getByLabel("当天可投入分钟（可不填）", { exact: true })
    .fill("0");
  await capacity
    .getByRole("button", { name: "添加不可用时间", exact: true })
    .click();
  await capacity.getByLabel("不可用开始 1", { exact: true }).fill("10:15");
  await capacity.getByLabel("不可用结束 1", { exact: true }).fill("10:45");
  await capacity
    .getByRole("button", { name: "保存当天约束", exact: true })
    .click();
  await capacity.locator("form").waitFor({ state: "hidden" });
  await capacity
    .getByText("可投入 0 分钟 · 日历占用 90 分钟", { exact: true })
    .waitFor();
  await capacity
    .getByText("2 条安排占用了明确的不可用时间。", { exact: true })
    .waitFor();
  totals = (await api("get_day_capacity", { date: today })).capacity;
  assert.equal(totals.availableMinutes, 0);
  assert.equal(totals.overBudget, true);
  assert.equal(totals.unavailableConflicts.length, 2);
  const dayZero = (await get()).planning.context.days.find(
    (day) => day.date === today,
  );
  assert.deepEqual(dayZero.unavailable, [{ startMinute: 615, endMinute: 645 }]);
  await shot("capacity-explicit-zero");
  await capacity.getByRole("button", { name: "自己调整", exact: true }).click();
  await capacity
    .getByLabel("当天可投入分钟（可不填）", { exact: true })
    .fill("");
  await capacity
    .getByRole("button", { name: "保存当天约束", exact: true })
    .click();
  await capacity.locator("form").waitFor({ state: "hidden" });
  await capacity
    .getByText("可投入 未填写 · 日历占用 90 分钟", { exact: true })
    .waitFor();
  totals = (await api("get_day_capacity", { date: today })).capacity;
  assert.equal(totals.availableMinutes, null);
  assert.equal(totals.overBudget, null);
  assert.equal(totals.fullyEstimated, false);
  const dayUnknown = (await get()).planning.context.days.find(
    (day) => day.date === today,
  );
  assert.equal(dayUnknown.revision, dayZero.revision + 1);
  assert.deepEqual(dayUnknown.unavailable, dayZero.unavailable);
  pass(
    "Visible daily editing preserves explicit zero separately from blank/unknown, saves unavailable intervals, and truthfully shows over-budget and unavailable-time conflicts",
  );

  await button("管理项目与偏好").click();
  const projects = wb.getByRole("region", { name: "项目管理", exact: true });
  const newProject = projects.locator('[data-project-id="new"]');
  await newProject
    .getByRole("button", { name: "新建项目", exact: true })
    .click();
  await newProject
    .getByLabel("项目名称", { exact: true })
    .fill("M4 原生合成项目");
  await newProject
    .getByRole("textbox", { name: "项目目标（可不填）", exact: true })
    .fill("整理三个可检查的示例");
  await newProject
    .getByRole("textbox", { name: "完成标准（可不填）", exact: true })
    .fill("每个示例有明确结果");
  await newProject
    .getByRole("textbox", {
      name: "参考链接（每行一条，最多 10 条）",
      exact: true,
    })
    .fill(reference);
  await newProject
    .getByRole("button", { name: "保存项目", exact: true })
    .click();
  await newProject.locator("form").waitFor({ state: "hidden" });
  await projects
    .getByRole("heading", { name: "M4 原生合成项目", exact: true })
    .waitFor();
  let state = await get();
  let project = state.planning.context.projects.find(
    (project) => project.title === "M4 原生合成项目",
  );
  assert(project);
  assert.equal(project.revision, 1);
  assert.deepEqual(project.referenceLinks, [reference]);
  const projectId = project.id;
  const projectCard = projects.locator(`[data-project-id="${projectId}"]`);
  await projectCard
    .getByText("参考链接 · 仅保存，未读取", { exact: true })
    .waitFor();
  await projectCard
    .getByRole("button", { name: `打开参考链接 1：${reference}`, exact: true })
    .waitFor();
  await projectCard
    .getByRole("button", { name: "编辑项目", exact: true })
    .click();
  await projectCard
    .getByLabel("项目名称", { exact: true })
    .fill("M4 已更新的项目");
  await projectCard
    .getByRole("textbox", { name: "项目目标（可不填）", exact: true })
    .fill("先核对合成甲，再整理示例");
  await projectCard
    .getByRole("button", { name: "保存项目", exact: true })
    .click();
  await projectCard.locator("form").waitFor({ state: "hidden" });
  await projectCard
    .getByRole("heading", { name: "M4 已更新的项目", exact: true })
    .waitFor();
  project = (await get()).planning.context.projects.find(
    (project) => project.id === projectId,
  );
  assert.equal(project.revision, 2);
  assert.equal(project.goal, "先核对合成甲，再整理示例");
  assert.equal(project.criteria, "每个示例有明确结果");
  assert.deepEqual(
    referenceRequests,
    [],
    "Saving references must not fetch their contents",
  );
  await shot("project-created-edited");
  pass(
    "Native project create/edit persists goal, completion criteria and references through named transactions; links are explicitly marked unread and never automatically opened",
  );

  await button("本周").click();
  const firstRow = wb.locator(`[data-row-id="${first.item.id}"]`);
  await firstRow
    .getByRole("button", { name: "M4 核对甲", exact: true })
    .click();
  const taskProject = firstRow.getByRole("region", {
    name: "任务所属项目",
    exact: true,
  });
  await taskProject
    .getByRole("button", { name: "修改项目", exact: true })
    .click();
  await taskProject
    .getByRole("combobox", { name: "关联项目", exact: true })
    .selectOption(projectId);
  await taskProject
    .getByRole("button", { name: "保存项目关联", exact: true })
    .click();
  await taskProject.locator("form").waitFor({ state: "hidden" });
  await taskProject
    .getByText("项目：M4 已更新的项目", { exact: true })
    .waitFor();
  state = await get();
  assert.equal(
    state.tasks.find((task) => task.id === first.task.id).projectId,
    projectId,
  );
  assert.equal(
    state.tasks.find((task) => task.id === first.task.id).category,
    "study",
  );
  assert.equal(
    state.tasks.find((task) => task.id === second.task.id).projectId,
    null,
  );
  const projectFilters = wb.locator('[aria-label="项目筛选"]');
  await projectFilters
    .getByRole("button", { name: "M4 已更新的项目", exact: true })
    .click();
  await firstRow.waitFor();
  assert.equal(
    await wb.locator(`[data-row-id="${second.item.id}"]`).count(),
    0,
  );
  assert.equal(
    await wb.locator(`[data-row-id="${unknown.item.id}"]`).count(),
    0,
  );
  await capacity
    .locator("summary")
    .filter({ hasText: "全日预留 120 分钟" })
    .waitFor();
  assert.match(await capacity.locator("summary").textContent(), /1 项未估计/);
  await shot("project-filter-full-day-capacity");
  pass(
    "Task association leaves category intact; project filtering shows only its task while the clearly labelled all-day capacity remains complete",
  );

  await button("管理项目与偏好").click();
  const preferences = wb.getByRole("region", {
    name: "偏好和背景",
    exact: true,
  });
  await preferences
    .getByRole("button", { name: "添加偏好", exact: true })
    .click();
  await preferences
    .getByRole("textbox", { name: "偏好内容", exact: true })
    .fill("M4 先做一件事");
  await preferences
    .getByRole("button", { name: "确认保存偏好", exact: true })
    .click();
  await preferences.locator("form").waitFor({ state: "hidden" });
  await preferences.getByText("M4 先做一件事", { exact: true }).waitFor();
  state = await get();
  let preference = state.planning.context.preferences.find(
    (p) => p.text === "M4 先做一件事",
  );
  assert(preference && preference.enabled && preference.confirmedAt > 0);
  assert.equal(preference.scope, "global");
  assert.equal(preference.date, null);
  assert.equal(preference.projectId, null);
  const preferenceId = preference.id;
  const prefCard = (text) =>
    preferences
      .locator("article.wk-context")
      .filter({ has: wb.getByText(text, { exact: true }) });
  await prefCard("M4 先做一件事")
    .getByRole("button", { name: "修改偏好", exact: true })
    .click();
  await preferences
    .getByRole("textbox", { name: "偏好内容", exact: true })
    .fill("M4 先检查合成甲的结果");
  await preferences
    .getByRole("combobox", { name: "生效范围", exact: true })
    .selectOption("project");
  await preferences
    .getByRole("combobox", { name: "生效项目", exact: true })
    .selectOption(projectId);
  await preferences
    .getByRole("button", { name: "确认保存偏好", exact: true })
    .click();
  await preferences.locator("form").waitFor({ state: "hidden" });
  await prefCard("M4 先检查合成甲的结果").waitFor();
  preference = (await get()).planning.context.preferences.find(
    (p) => p.id === preferenceId,
  );
  assert.equal(preference.revision, 2);
  assert.equal(preference.scope, "project");
  assert.equal(preference.projectId, projectId);
  assert.equal(preference.date, null);
  await prefCard("M4 先检查合成甲的结果")
    .getByRole("button", { name: "修改偏好", exact: true })
    .click();
  await preferences.getByLabel("用于相关请求", { exact: true }).uncheck();
  await preferences
    .getByRole("button", { name: "确认保存偏好", exact: true })
    .click();
  await preferences.locator("form").waitFor({ state: "hidden" });
  await prefCard("M4 先检查合成甲的结果")
    .getByText("项目：M4 已更新的项目 · 已停用", { exact: true })
    .waitFor();
  preference = (await get()).planning.context.preferences.find(
    (p) => p.id === preferenceId,
  );
  assert.equal(preference.enabled, false);
  assert.equal(preference.revision, 3);
  await shot("preference-edited-disabled");
  await prefCard("M4 先检查合成甲的结果")
    .getByRole("button", { name: "删除偏好", exact: true })
    .click();
  await prefCard("M4 先检查合成甲的结果").waitFor({ state: "hidden" });
  assert.equal(
    (await get()).planning.context.preferences.some(
      (p) => p.id === preferenceId,
    ),
    false,
  );
  assert.match(
    await preferences.textContent(),
    /已有对话、事件记录及 Hermes\s*独立历史不会一并删除/,
  );
  pass(
    "Explicitly confirmed preference creation, edit to project scope, disable and delete persist versioned facts; the UI accurately preserves the historical-record boundary",
  );

  await preferences
    .getByRole("button", { name: "添加偏好", exact: true })
    .click();
  await preferences
    .getByRole("textbox", { name: "偏好内容", exact: true })
    .fill("M4 仅今天先看草稿");
  await preferences
    .getByRole("combobox", { name: "生效范围", exact: true })
    .selectOption("day");
  await preferences.getByLabel("生效日期", { exact: true }).fill(today);
  await preferences
    .getByRole("button", { name: "确认保存偏好", exact: true })
    .click();
  await preferences.locator("form").waitFor({ state: "hidden" });
  await prefCard("M4 仅今天先看草稿").waitFor();
  const dailyPreference = (await get()).planning.context.preferences.find(
    (p) => p.text === "M4 仅今天先看草稿",
  );
  assert.equal(dailyPreference.scope, "day");
  assert.equal(dailyPreference.date, today);
  assert.equal(dailyPreference.projectId, null);
  await shot("preference-date-scope");

  // Re-enter management to edit from the latest persisted project revision.
  await button("本周").click();
  await button("管理项目与偏好").click();
  await projectCard
    .getByRole("button", { name: "编辑项目", exact: true })
    .click();
  await projectCard.getByLabel("归档项目", { exact: true }).check();
  await projectCard
    .getByRole("button", { name: "保存项目", exact: true })
    .click();
  await projectCard.locator("form").waitFor({ state: "hidden" });
  await projectCard
    .getByText("项目已归档，已有任务和记录保留。", { exact: true })
    .waitFor();
  state = await get();
  assert.equal(
    state.planning.context.projects.find((p) => p.id === projectId).archived,
    true,
  );
  assert.equal(
    state.tasks.find((task) => task.id === first.task.id).projectId,
    projectId,
  );
  assert.equal(state.tasks.length, 3);
  await shot("project-archived");
  await projectFilters
    .getByRole("button", { name: "M4 已更新的项目（已归档）", exact: true })
    .click();
  await firstRow
    .getByRole("button", { name: "M4 核对甲", exact: true })
    .click();
  await taskProject
    .getByText("项目：M4 已更新的项目（已归档）", { exact: true })
    .waitFor();
  await taskProject
    .getByRole("button", { name: "修改项目", exact: true })
    .click();
  assert(
    await taskProject
      .getByRole("option", { name: "M4 已更新的项目（已归档）", exact: true })
      .evaluate(
        (option) => option instanceof HTMLOptionElement && option.disabled,
      ),
  );
  assert(
    await taskProject
      .getByRole("button", { name: "保存项目关联", exact: true })
      .isDisabled(),
  );
  await shot("archived-association-retained");
  await taskProject
    .getByRole("combobox", { name: "关联项目", exact: true })
    .selectOption("");
  await taskProject
    .getByRole("button", { name: "保存项目关联", exact: true })
    .click();
  await firstRow.waitFor({ state: "hidden" });
  state = await get();
  assert.equal(
    state.tasks.find((task) => task.id === first.task.id).projectId,
    null,
  );
  assert.equal(
    state.tasks.find((task) => task.id === first.task.id).category,
    "study",
  );
  assert.deepEqual(state.planning.steps, seeded.planning.steps);
  assert.deepEqual(state.planning.dayItems, seeded.planning.dayItems);
  assert.equal(state.tasks.length, 3);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.notes.length, 0);
  assert.equal(state.planning.context.projects.length, 1);
  assert.deepEqual(referenceRequests, []);
  await button("本周").click();
  await firstRow.waitFor();
  await wb.locator(`[data-row-id="${second.item.id}"]`).waitFor();
  await wb.locator(`[data-row-id="${unknown.item.id}"]`).waitFor();
  await shot("final-unchanged-plans");
  pass(
    "Project archive retains its tasks and existing association, prevents new archived association, and explicit unlink leaves task categories, steps, plans and all clocks unchanged",
  );
  assert.deepEqual(errors, []);
  report.desktopPassed = true;
  report.finalFacts = {
    tasks: state.tasks.length,
    sessions: state.sessions.length,
    projects: state.planning.context.projects.length,
    preferences: state.planning.context.preferences.length,
    preferencesRevision: state.planning.context.preferencesRevision,
    capacity: totals,
  };
  report.pending = [
    "Real model context behavior is separate from this model-free native UI check",
    "Overall M4 release remains with the root task",
  ];
  await writeFile(
    path.join(root, "m4-native-fixture.json"),
    JSON.stringify(
      {
        run,
        today,
        projectId,
        dailyPreferenceId: dailyPreference.id,
        taskIds: {
          first: first.task.id,
          second: second.task.id,
          unknown: unknown.task.id,
        },
        stepIds: {
          first: first.step.id,
          second: second.step.id,
          unknown: unknown.step.id,
        },
        itemIds: {
          first: first.item.id,
          second: second.item.id,
          unknown: unknown.item.id,
        },
        finalProjectArchived: true,
        finalTaskAssociations: null,
        finalBudget: null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  report.failure = String(error);
  if (wb) await shot("failure-workbench").catch(() => {});
  throw error;
} finally {
  await writeFile(
    path.join(out, "desktop-verification.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
