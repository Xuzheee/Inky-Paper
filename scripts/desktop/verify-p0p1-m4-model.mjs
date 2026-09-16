// Run AFTER verify-p0p1-m4.mjs in the same isolated native instance.
// Four real UI sends use the existing Hermes provider. No provider/config edits.
// Usage: node scripts/desktop/verify-p0p1-m4-model.mjs p0p1-m4-<run>
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const run = process.argv[2];
const correctionOnly = process.argv.includes("--time-correction");
assert.match(run || "", /^p0p1-m4-[A-Za-z0-9_-]+$/);
const root = path.resolve("output", run);
const fixture = JSON.parse(
  await readFile(path.join(root, "m4-native-fixture.json"), "utf8"),
);
assert.equal(fixture.run, run);
const pid = Number(await readFile(path.join(root, "paper-test.pid"), "utf8"));
assert(
  Number.isSafeInteger(pid) && pid > 0,
  "An isolated native launcher PID is required",
);
const out = path.resolve(
  "docs/verification/p0p1/M4",
  run,
  `model-${Date.now()}`,
);
await mkdir(out, { recursive: true });
const report = {
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  run,
  pid,
  fixture,
  startedAt: new Date().toISOString(),
  modelCalls: 0,
  preparation: [],
  rounds: [],
  checks: [],
  errors: [],
  complete: false,
  semanticReview: {
    status: "pending",
    note: "Automated checks verify actual context, versions, tool evidence, and non-adoption. A reviewer must read the four actual answers; no model quality score is fabricated.",
  },
};
const browser = await chromium.connectOverCDP("http://127.0.0.1:9254");
const pages = browser.contexts().flatMap((context) => context.pages());
const wb = pages.find((page) => page.url().includes("workbench=1"));
assert(
  wb && new URL(wb.url()).origin === "http://tauri.localhost",
  "Use the native workbench webview",
);
wb.setDefaultTimeout(15000);
for (const page of pages)
  page.on("pageerror", (error) => report.errors.push(error.message));
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
      ...(action.startsWith("get_") ? {} : { requestId: randomUUID() }),
    },
  });
const get = async () => (await api("get_state")).state;
const save = () =>
  writeFile(
    path.join(out, "model-context-evidence.json"),
    JSON.stringify(report, null, 2),
  );
const pass = (text) => {
  report.checks.push(text);
  console.log("PASS", text);
};
const formal = (state) => ({
  tasks: state.tasks,
  sessions: state.sessions,
  notes: state.notes,
  steps: state.planning.steps,
  dayItems: state.planning.dayItems,
  sessionLinks: state.planning.sessionLinks,
  planChanges: state.planning.planChanges,
  manualStepChanges: state.planning.manualStepChanges,
  prepared: state.planning.prepared,
  taskCompletionAcknowledgements: state.planning.taskCompletionAcknowledgements,
  context: state.planning.context,
  coachBlocks: state.coach.blocks,
  coachSettings: state.coach.settings,
});
const noClock = (state) => {
  assert(
    state.sessions.every((session) => session.status === "finished"),
    "No active focus/break session may be started",
  );
  assert(
    (state.coach.blocks || []).every((block) => block.endedAt != null),
    "No active work block may be started",
  );
};
const visibleNative = () => {
  const visible = execFileSync(
    "python",
    [
      "-c",
      String.raw`
import ctypes, ctypes.wintypes as w, sys
u=ctypes.WinDLL('user32',use_last_error=True)
u.IsWindowVisible.argtypes=[w.HWND];u.IsWindowVisible.restype=w.BOOL
u.GetWindowThreadProcessId.argtypes=[w.HWND,ctypes.POINTER(w.DWORD)]
u.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,ctypes.c_int]
found=[]
@ctypes.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
def collect(hwnd,_):
    pid=w.DWORD();u.GetWindowThreadProcessId(hwnd,ctypes.byref(pid))
    if pid.value==int(sys.argv[1]) and u.IsWindowVisible(hwnd):
        title=ctypes.create_unicode_buffer(512);u.GetWindowTextW(hwnd,title,512)
        if title.value=='Inky · 工作台':found.append(True)
    return True
u.EnumWindows(collect,0)
print('visible' if found else 'hidden')
`,
      String(pid),
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  assert.equal(
    visible,
    "visible",
    "The isolated native workbench must be visible",
  );
};
const shot = async (name) => {
  visibleNative();
  await wb.screenshot({ path: path.join(out, `${name}.png`) });
};
// Credentials never enter evidence. The bridge status is used only to verify the data directory.
assert.equal(
  path.resolve((await invoke("get_paper_bridge_status")).connectionFile),
  path.join(root, "paper-test/paper-agent-bridge.json"),
);
const today = await wb.evaluate(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});
assert.equal(
  today,
  fixture.today,
  "Re-seed the isolated UI fixture if the local date changed",
);
const projectId = fixture.projectId;
const taskIds = Object.values(fixture.taskIds);
assert.equal(
  new Set(taskIds).size,
  3,
  "Three existing fixture tasks are required",
);
const preference15 =
  "长期偏好：建议下一步时，首轮先做 15 分钟；这不是总工时或当天预算。";
const preference5 =
  "长期偏好：建议下一步时，首轮先做 5 分钟；此前 15 分钟偏好已替换。这不是总工时或当天预算。";
const newGoal =
  "先交付一份可复核的最小草稿：优先核对甲的关键结论，乙只补支撑材料，未估计步骤先保留。";
let preferenceId;
let conversationId;
let listening = false;
let currentRound;
const probe = () => wb.evaluate(() => window.__m4ModelProbe?.events || []);
const waitState = async (test, label) => {
  for (let attempt = 0; attempt < 80; attempt++) {
    const state = await get();
    if (test(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw Error(`Timed out waiting for ${label}`);
};
const projectFrom = (state) =>
  state.planning.context.projects.find((project) => project.id === projectId);
const preferenceFrom = (state) =>
  state.planning.context.preferences.find(
    (preference) => preference.id === preferenceId,
  );
const selectProject = async () => {
  await wb.getByRole("button", { name: today, exact: true }).click();
  const project = projectFrom(await get());
  const button = wb
    .getByLabel("项目筛选", { exact: true })
    .getByRole("button", { name: project.title, exact: true });
  if (!/(^|\s)active(\s|$)/.test((await button.getAttribute("class")) || ""))
    await button.click();
  if (
    await wb
      .getByRole("button", { name: "展开 Coach", exact: true })
      .isVisible()
  )
    await wb.getByRole("button", { name: "展开 Coach", exact: true }).click();
  assert.match(
    await wb.getByLabel("Coach 讨论范围").innerText(),
    new RegExp(project.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
};
const expectedPreferences = (state) =>
  state.planning.context.preferences.filter(
    (preference) =>
      preference.enabled &&
      (preference.scope === "global" ||
        (preference.scope === "day" && preference.date === today) ||
        (preference.scope === "project" &&
          preference.projectId === projectId &&
          !projectFrom(state).archived)),
  );
function checkContext(context, before, availableMinutes) {
  assert.equal(context.schemaVersion, 2);
  assert.equal(context.date, today);
  assert.equal(context.today, today);
  assert.equal(context.viewDate, today);
  assert.equal(context.resolvedIntent, "plan");
  assert.equal(context.selectedProjectId, projectId);
  assert.equal(context.projectTitle, projectFrom(before).title);
  assert.equal(
    context.selectedTaskId,
    null,
    "Select the project, not one task",
  );
  const facts = context.latestFacts;
  assert.equal(facts.capacity.availableMinutes, availableMinutes);
  assert.equal(
    facts.dayConstraints?.availableMinutes ?? null,
    availableMinutes,
  );
  const current = projectFrom(before),
    snapshot = facts.projects.find((project) => project.id === projectId);
  assert.deepEqual(
    snapshot,
    current,
    "Project context must be the latest saved revision",
  );
  const expectedItems = before.planning.dayItems.filter(
    (item) =>
      item.date === today &&
      item.removedAt == null &&
      taskIds.includes(item.taskId),
  );
  assert.deepEqual(
    facts.dayPlan.map((row) => row.item.id).sort(),
    expectedItems.map((item) => item.id).sort(),
  );
  for (const row of [...facts.dayPlan, ...facts.unplanned]) {
    assert.equal(
      row.task.projectId,
      projectId,
      "Project filtering must not inject another project's tasks",
    );
    assert.equal(
      context.versions.tasks[row.task.id],
      before.tasks.find((task) => task.id === row.task.id).revision,
    );
    if (row.step)
      assert.equal(
        context.versions.steps[row.step.id],
        before.planning.steps.find((step) => step.id === row.step.id).revision,
      );
    if (row.item)
      assert.equal(
        context.versions.dayItems[row.item.id],
        before.planning.dayItems.find((item) => item.id === row.item.id)
          .revision,
      );
  }
  assert.equal(
    facts.currentPreferences.revision,
    before.planning.context.preferencesRevision,
  );
  assert.deepEqual(
    [...facts.currentPreferences.items].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    expectedPreferences(before).sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.deepEqual(
    facts.currentPreferences.items.find(
      (preference) => preference.id === preferenceId,
    ),
    preferenceFrom(before),
  );
}
async function round(id, label, availableMinutes, reviewQuestions) {
  await selectProject();
  const before = await get();
  noClock(before);
  const eventStart = (await probe()).length;
  currentRound = {
    id,
    label,
    expectedAvailableMinutes: availableMinutes,
    reviewQuestions,
    semanticReview: "pending",
    before,
    completed: false,
  };
  report.rounds.push(currentRound);
  await save();
  // Keeping the shortcut text intact preserves intent=plan. Editing its wording intentionally resets intent to auto.
  await wb.getByRole("button", { name: "安排一下", exact: true }).click();
  currentRound.prompt = await wb
    .getByLabel("发送给 Coach", { exact: true })
    .inputValue();
  currentRound.scopeBeforeSend = await wb
    .getByLabel("Coach 讨论范围")
    .innerText();
  assert.deepEqual(
    formal(await get()),
    formal(before),
    "Prefill must not mutate formal state",
  );
  await shot(`${id}-before-send`);
  visibleNative();
  await wb.getByRole("button", { name: "发送", exact: true }).click();
  report.modelCalls++;
  await wb.getByRole("button", { name: "停止回复", exact: true }).waitFor();
  if (id === "01-unknown-time") {
    const sent = await wb.evaluate(() =>
      window.__m4ModelProbe.commands.findLast(
        (call) => call.command === "workbench_send",
      ),
    );
    assert(
      sent?.requestId,
      "Capture the actual UI request id before collapsing",
    );
    await wb.waitForFunction(
      (requestId) =>
        window.__m4ModelProbe.events.some(
          (event) =>
            event.requestId === requestId &&
            event.update?.sessionUpdate === "connected",
        ),
      sent.requestId,
      { timeout: 120000 },
    );
    await wb.getByRole("button", { name: "收起 Coach", exact: true }).click();
    const rail = wb.locator(".wk-coach-rail");
    await rail.getByText("正在回复", { exact: true }).waitFor();
    currentRound.collapseEvidence = {
      requestId: sent.requestId,
      railText: await rail.innerText(),
      collapsedWhileBusy: true,
    };
    await shot("01-stream-collapsed");
    await wb.getByRole("button", { name: "展开 Coach", exact: true }).click();
    currentRound.collapseEvidence.expanded = true;
  }
  console.log(`Waiting for real Hermes response ${id}: ${label}`);
  await wb.waitForFunction(
    () =>
      !document.querySelector('button[aria-label="停止回复"]') ||
      !!document.querySelector(".wk-permission"),
    null,
    { timeout: 600000 },
  );
  assert.equal(
    await wb.locator(".wk-permission").count(),
    0,
    "Unexpected permission request: manual review required; this script never approves tools",
  );
  const history = await invoke("workbench_history", { sessionId: null });
  const latest = history.sessions[0];
  assert(latest, "The UI send must create a real conversation");
  conversationId ??= latest.id;
  assert.equal(
    latest.id,
    conversationId,
    "All four rounds must remain in the same conversation",
  );
  const conversation = await invoke("workbench_history", {
    sessionId: conversationId,
  });
  const answer = conversation.messages.findLast(
    (message) => message.role === "assistant",
  );
  const user = conversation.messages.findLast(
    (message) => message.role === "user",
  );
  assert(answer && user);
  assert.equal(user.text, currentRound.prompt);
  currentRound.requestId = user.id;
  currentRound.sessionId = conversationId;
  currentRound.answer = answer;
  currentRound.commands = await wb.evaluate(
    () => window.__m4ModelProbe.commands,
  );
  assert(
    !currentRound.commands.some((call) => call.command === "workbench_cancel"),
    "Collapsing and all four model turns must not cancel the reply",
  );
  if (currentRound.collapseEvidence) {
    assert.equal(
      currentRound.collapseEvidence.requestId,
      user.id,
      "The same request must complete after collapse/expand",
    );
    currentRound.collapseEvidence.sameRequestCompleted =
      answer.status === "done";
    currentRound.collapseEvidence.cancelCalls = 0;
  }
  currentRound.context = answer.context;
  currentRound.userContext = user.context;
  currentRound.events = (await probe())
    .slice(eventStart)
    .filter((event) => event.requestId === user.id);
  currentRound.toolCalls = currentRound.events.filter((event) =>
    ["tool_call", "tool_call_update"].includes(event.update?.sessionUpdate),
  );
  currentRound.visibleAnswer = await wb
    .locator(".wk-message.assistant")
    .last()
    .innerText();
  assert.equal(currentRound.answer.status, 'done', 'A cancelled or failed model reply cannot pass');
  assert(!/^API call failed after \d+ retries:/.test(currentRound.answer.text.trim()), 'Hermes provider transport failure is not a model answer');
  currentRound.visibleScope = await wb.getByLabel("Coach 讨论范围").innerText();
  const after = await get();
  currentRound.after = after;
  await shot(`${id}-answer`);
  await save();
  assert.equal(answer.status, "done", answer.text);
  assert(answer.text.trim(), "A visible model answer is required");
  assert.deepEqual(
    user.context,
    answer.context,
    "User and assistant must share the normalized request snapshot",
  );
  checkContext(answer.context, before, availableMinutes);
  const connected = currentRound.events.find(
    (event) => event.update?.sessionUpdate === "connected",
  );
  assert(connected?.context, "Capture the actual connected request snapshot");
  assert.deepEqual(connected.context, answer.context);
  assert.deepEqual(
    formal(after),
    formal(before),
    "A model reply must not adopt, change formal tasks/context, or start a clock",
  );
  noClock(after);
  currentRound.newAdjustments = (after.planning.adjustments || []).filter(
    (batch) =>
      !(before.planning.adjustments || []).some((old) => old.id === batch.id),
  );
  currentRound.newBatches = (after.planning.batches || []).filter(
    (batch) =>
      !(before.planning.batches || []).some((old) => old.id === batch.id),
  );
  for (const batch of currentRound.newAdjustments)
    for (const group of batch.groups) assert.equal(group.adoptedAt, null);
  for (const batch of currentRound.newBatches)
    for (const card of batch.cards)
      assert(!card.adoptedStepId, "A new candidate must remain unadopted");
  currentRound.completed = true;
  pass(
    `${id}: actual latest scope/versions captured; formal state unchanged; no clock or automatic adoption`,
  );
  await save();
}

try {
  visibleNative();
  const initial = await get();
  noClock(initial);
  assert.equal(
    (await invoke("workbench_history", { sessionId: null })).sessions.length,
    0,
    "Use an M4 native fixture with no earlier model conversations; partial evidence is preserved on failure",
  );
  for (const name of ["first", "second", "unknown"]) {
    assert(initial.tasks.some((task) => task.id === fixture.taskIds[name]));
    assert(
      initial.planning.steps.some(
        (step) =>
          step.id === fixture.stepIds[name] &&
          step.taskId === fixture.taskIds[name],
      ),
    );
    assert(
      initial.planning.dayItems.some(
        (item) =>
          item.id === fixture.itemIds[name] &&
          item.date === today &&
          item.removedAt == null,
      ),
    );
  }
  assert.equal(
    initial.planning.context.days.find((day) => day.date === today)
      ?.availableMinutes ?? null,
    null,
    "The M4 UI fixture must leave total available time unknown",
  );
  report.initial = initial;
  // The UI fixture deliberately ends archived/unlinked. Model scenario preparation is explicit and recorded.
  const project = projectFrom(initial);
  assert(project);
  const restored = await api("save_project", {
    projectId,
    expectedRevision: project.revision,
    title: project.title,
    goal: project.goal,
    criteria: project.criteria,
    referenceLinks: project.referenceLinks,
    archived: false,
  });
  report.preparation.push({
    action: "save_project",
    purpose: "Restore the already-tested archived project for four model turns",
    result: restored,
  });
  for (const taskId of taskIds) {
    const current = await get(),
      task = current.tasks.find((item) => item.id === taskId);
    if (task.projectId !== projectId) {
      const result = await api("set_task_project", {
        taskId,
        expectedTaskRevision: task.revision,
        projectId,
        expectedProjectRevision: projectFrom(current).revision,
      });
      report.preparation.push({ action: "set_task_project", taskId, result });
    }
  }
  preferenceId = randomUUID();
  report.preparation.push({
    action: "save_preference",
    purpose: "Initial explicit long-term 15-minute preference",
    result: await api("save_preference", {
      preferenceId,
      expectedRevision: 0,
      text: preference15,
      scope: "global",
      date: null,
      projectId: null,
      enabled: true,
    }),
  });
  report.preferenceId = preferenceId;
  await save();
  await wb.getByRole("button", { name: "刷新", exact: true }).click();
  await wb.evaluate(async () => {
    const probe = {
      events: [],
      commands: [],
      listener: null,
      handler: null,
      originalFetch: window.fetch,
    };
    window.__m4ModelProbe = probe;
    // Record command names/request ids only; no arguments, credentials, or provider configuration.
    window.fetch = function (url, options) {
      const command = decodeURIComponent(new URL(String(url), location.href).pathname.slice(1));
      if (command === 'workbench_send' || command === 'workbench_cancel') {
        const args = typeof options?.body === 'string' ? JSON.parse(options.body) : {};
        probe.commands.push({command, requestId: command === 'workbench_send' ? args.requestId : undefined, at: Date.now()});
      }
      return probe.originalFetch.call(this, url, options);
    };
    probe.handler = window.__TAURI_INTERNALS__.transformCallback((event) => {
      const p = event.payload;
      if (p.update?.sessionUpdate !== "agent_message_chunk")
        probe.events.push(p);
    });
    probe.listener = await window.__TAURI_INTERNALS__.invoke(
      "plugin:event|listen",
      {
        event: "workbench:chat",
        target: { kind: "Any" },
        handler: probe.handler,
      },
    );
  });
  listening = true;
  if (!correctionOnly) await round("01-unknown-time", "可投入总时长未知", null, [
    "有没有把未填写的总时长和未估计的任务当成未知？",
    "是否区分明确不可用时段、计划预留与15分钟首轮偏好？",
  ]);
  await selectProject();
  const capacity = wb.locator(".wk-capacity");
  if ((await capacity.getAttribute("open")) === null)
    await capacity.locator("summary").click();
  await capacity.getByRole("button", { name: "自己调整", exact: true }).click();
  await capacity.getByLabel("当天可投入分钟（可不填）").fill("45");
  await capacity
    .getByRole("button", { name: "保存当天约束", exact: true })
    .click();
  const afterBudget = await waitState(
    (state) =>
      state.planning.context.days.find((day) => day.date === today)
        ?.availableMinutes === 45,
    "the UI-saved 45-minute budget",
  );
  report.budgetUpdate = afterBudget.planning.context.days.find(
    (day) => day.date === today,
  );
  if (!correctionOnly) await round("02-explicit-45", "明确可投入45分钟", 45, [
    "是否依据45分钟总预算对现有安排取舍，而非把每个首轮15分钟解释成全部工时？",
    "未估计事项是否仍明确未知？",
  ]);
  await wb.getByRole("button", { name: "管理项目与偏好", exact: true }).click();
  const card = wb.locator(`[data-project-id="${projectId}"]`);
  await card.getByRole("button", { name: "编辑项目", exact: true }).click();
  await card.getByRole("textbox", { name: "项目目标（可不填）", exact: true }).fill(newGoal);
  await card.getByRole("button", { name: "保存项目", exact: true }).click();
  const afterGoal = await waitState(
    (state) => projectFrom(state).goal === newGoal,
    "the changed project goal",
  );
  report.projectUpdate = projectFrom(afterGoal);
  await round("03-project-goal", "同项目目标已改变", 45, [
    "是否按新目标优先核对甲的关键结论，没有沿用旧目标？",
    "是否仍在同项目的三个现有任务内规划？",
  ]);
  await wb.getByRole("button", { name: "管理项目与偏好", exact: true }).click();
  const preferences = wb.getByRole("region", {
    name: "偏好和背景",
    exact: true,
  });
  const preference = preferences
    .locator("article")
    .filter({ has: wb.getByText(preference15, { exact: true }) });
  await preference
    .getByRole("button", { name: "修改偏好", exact: true })
    .click();
  await preferences.getByRole("textbox", { name: "偏好内容", exact: true }).fill(preference5);
  await preferences
    .getByRole("button", { name: "确认保存偏好", exact: true })
    .click();
  const afterPreference = await waitState(
    (state) => preferenceFrom(state).text === preference5,
    "the replacement 5-minute preference",
  );
  assert(
    preferenceFrom(afterPreference).revision >
      preferenceFrom(report.rounds.find(item=>item.id === "03-project-goal").before).revision,
  );
  report.preferenceUpdate = preferenceFrom(afterPreference);
  await round("04-preference-five", "长期偏好由15改为5分钟", 45, [
    "是否按最新5分钟首轮偏好给下一步，而非沿用本对话旧的15分钟偏好？",
    "是否保留45分钟总预算及新项目目标，不混淆首轮和总工时？",
  ]);
  assert.equal(report.modelCalls, correctionOnly ? 2 : 4);
  assert.equal(report.rounds.length, correctionOnly ? 2 : 4);
  assert(report.rounds.every((item) => item.completed));
  report.timeCorrection = correctionOnly;
  for (const item of report.rounds) {
    const local = new Date(item.context.sampledAt + 480*60000);
    const minute = local.getUTCHours()*60 + local.getUTCMinutes();
    for (const batch of item.newAdjustments) for (const group of batch.groups) for (const action of group.actions) {
      if (action.date === today && action.startMinute != null) assert(action.startMinute >= minute, 'A new forward plan must not schedule an already-past clock time');
    }
  }
  assert.deepEqual(report.errors, []);
  report.complete = true;
  report.completedAt = new Date().toISOString();
  report.acceptance =
    "All requested real calls passed mechanical checks; answer semantics remain pending human review.";
} catch (error) {
  report.failure = String(error);
  report.failedRound = currentRound?.id || "preparation";
  if (currentRound) {
    currentRound.events = await probe().catch(() => []);
    currentRound.afterFailure = await get().catch(() => null);
    currentRound.visibleOnFailure = await wb
      .locator(".wk-coach")
      .innerText()
      .catch(() => "");
  }
  await shot("failure").catch(() => {});
  throw error;
} finally {
  await save();
  if (listening)
    await wb
      .evaluate(async () => {
        const probe = window.__m4ModelProbe;
        if (!probe) return;
        window.fetch = probe.originalFetch;
        window.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener(
          "workbench:chat",
          probe.listener,
        );
        await window.__TAURI_INTERNALS__.invoke("plugin:event|unlisten", {
          event: "workbench:chat",
          eventId: probe.listener,
        });
        window.__TAURI_INTERNALS__.unregisterCallback?.(probe.handler);
        delete window.__m4ModelProbe;
      })
      .catch(() => {});
  console.log("Evidence:", out);
  await browser.close();
}
