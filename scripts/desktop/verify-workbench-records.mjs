import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright";

const run = process.argv[2] || "workbench-records-062";
if (!/^[a-zA-Z0-9_-]+$/.test(run)) throw Error("Invalid run name");
const root = path.resolve("output", run, "paper-test");
const out = path.resolve("docs/verification/0.6.2");
await mkdir(out, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9254");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((p) => p.url().includes("workbench"));
const main = pages.find((p) => p.url() === "http://tauri.localhost/");
assert(page && main);
page.setDefaultTimeout(15000);
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
main.on("pageerror", (e) => errors.push(e.message));
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const api = (action, input = {}) =>
  main.evaluate(
    ({ action, input }) =>
      window.__TAURI_INTERNALS__.invoke("paper_execute", { action, input }),
    {
      action,
      input: {
        ...input,
        ...(action.startsWith("get_") ? {} : { requestId: randomUUID() }),
      },
    },
  );
const state = async () => (await api("get_state")).state;
const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dateKey(d);
};
const today = dateKey(),
  yesterday = shift(-1),
  emptyDate = shift(5);
assert.equal(
  path.resolve((await invoke("get_paper_bridge_status")).connectionFile),
  path.join(root, "paper-agent-bridge.json"),
);
assert.equal(
  (await state()).tasks.length,
  0,
  "Use a fresh isolated test database",
);
const pass = (message) => {
  checks.push(message);
  console.log("PASS", message);
};

await page
  .getByRole("button", { name: "添加任务", exact: true })
  .first()
  .click();
const dialog = page.getByRole("dialog");
await dialog.getByLabel("任务名称", { exact: true }).fill("整理工作台需求");
await dialog.getByLabel("具体这一步").fill("核对每日记录");
await dialog.getByLabel("安排日期", { exact: true }).fill(yesterday);
await dialog.getByLabel("开始时间", { exact: true }).fill("09:30");
await dialog.getByRole("button", { name: "保存计划", exact: true }).click();
await dialog.waitFor({ state: "hidden" });
let s = await state();
const plannedTask = s.tasks[0].id,
  plannedStep = s.planning.steps[0].id;
const changeStep = async (completed) => {
  s = await state();
  await api("set_step_completed", {
    taskId: plannedTask,
    stepId: plannedStep,
    expectedTaskRevision: s.tasks.find((t) => t.id === plannedTask).revision,
    expectedStepRevision: s.planning.steps.find((p) => p.id === plannedStep)
      .revision,
    completed,
  });
};
await changeStep(true);
await page.getByRole("button", { name: yesterday, exact: true }).click();
await page.getByRole("tab", { name: "日程", exact: true }).click();
await page.locator(".wk-calendar-event.done").waitFor();
await page.screenshot({ path: path.join(out, "calendar-records.png") });
await page
  .getByRole("button", { name: `查看 ${yesterday} 每日记录`, exact: true })
  .click();
await page
  .locator(".wk-record-plan")
  .filter({ hasText: "当前已完成" })
  .waitFor();
assert.match(
  await page.locator(".wk-record-stats > div").nth(1).innerText(),
  /^0\s*步/,
);
pass(
  "Historical plan shows current completion, while actual completion stays on its operation date",
);
await page.getByRole("button", { name: "今天", exact: true }).click();
await page
  .locator(".wk-record-manual")
  .filter({ hasText: "手动完成" })
  .waitFor();
await changeStep(false);
await page
  .locator(".wk-record-manual")
  .filter({ hasText: "撤销完成" })
  .waitFor();
await page.waitForFunction(() =>
  document
    .querySelectorAll(".wk-record-stats > div")[1]
    ?.textContent.startsWith("0"),
);
await changeStep(true);
pass(
  "Paper-window manual completion and undo update the open workbench without reloading",
);

const unscheduled = (
  await api("create_task", {
    taskId: randomUUID(),
    title: "临时核对材料",
    nextAction: "检查一份材料",
  })
).task;
let session = (
  await api("start_session", {
    taskId: unscheduled.id,
    expectedRevision: unscheduled.revision,
    kind: "focus",
    plannedSeconds: 60,
  })
).session;
await new Promise((resolve) => setTimeout(resolve, 1400));
await api("finish_session", {
  sessionId: session.id,
  expectedRevision: session.revision,
  outcome: "step_completed",
  output: "核对了材料和任务清单",
  nextCue: "继续核对下一份",
});
await api("capture_note", { text: "今天先把已有记录整理清楚。" });
await page.getByText("核对了材料和任务清单", { exact: false }).waitFor();
await page.getByText("今天先把已有记录整理清楚。", { exact: true }).waitFor();
await page.waitForFunction(() =>
  document
    .querySelectorAll(".wk-record-stats > div")[1]
    ?.textContent.startsWith("2"),
);
assert(
  (
    await api("get_daily_record", {
      date: today,
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
    })
  ).sessions[0].dailySeconds >= 1,
);
await page.screenshot({ path: path.join(out, "daily-record.png") });
pass(
  "Unscheduled focus work, completion, feedback and notes appear in the day's actual record",
);

const blockTask = (
  await api("create_task", {
    taskId: randomUUID(),
    title: "阅读说明文档",
    nextAction: "整理关键概念",
  })
).task;
await api("start_work", {
  taskId: blockTask.id,
  expectedRevision: blockTask.revision,
  plannedEndAt: Date.now() + 600000,
  plannedSeconds: 0,
  energy: null,
  goal: "理清同步方式",
});
const block = (await state()).coach.blocks.at(-1);
await api("end_work", {
  blockId: block.id,
  expectedRevision: block.revision,
  progress: "advanced",
  output: "整理出了关键概念",
  finishSession: false,
});
await page.getByText("推进了一些", { exact: true }).waitFor();
pass(
  "Work-block progress uses the saved Coach progress values without creating a timer",
);

await page.getByRole("tab", { name: "Markdown", exact: true }).click();
const source = page.getByLabel("Markdown 原始内容", { exact: true });
await source.waitFor();
const documents = await invoke("workbench_read_documents", { date: today });
const dayDocument = documents.documents.find((d) => d.kind === "day");
assert.equal(
  await source.textContent(),
  await readFile(dayDocument.path, "utf8"),
);
assert.match(await source.textContent(), /核对了材料和任务清单/);
await page.screenshot({ path: path.join(out, "markdown.png") });
pass(
  "Markdown page contains the exact saved daily file, including completion and feedback",
);
await page
  .getByRole("combobox", { name: "文件", exact: true })
  .selectOption("personal");
const personal = documents.documents.find((d) => d.kind === "personal");
assert(path.resolve(personal.path).startsWith(root + path.sep));
const note =
  "# 我的复盘\n\n今天完成了两小步，明天继续。\n<script>这行也是原文</script>\n";
await writeFile(personal.path, note);
await page.waitForFunction(
  (text) =>
    document.querySelector(".wk-markdown-source code")?.textContent === text,
  note,
  { timeout: 10000 },
);
assert.equal(await page.locator(".wk-markdown-source script").count(), 0);
assert.equal(await readFile(personal.path, "utf8"), note);
pass(
  "Externally edited personal Markdown refreshes automatically and remains literal, unmodified text",
);

await page.getByRole("button", { name: emptyDate, exact: true }).click();
await page
  .getByRole("combobox", { name: "文件", exact: true })
  .selectOption("day");
await page
  .getByText("这一天还没有对应的 Markdown 文件。记录产生后会自动同步到这里。", {
    exact: true,
  })
  .waitFor();
assert.equal(
  (
    await invoke("workbench_read_documents", { date: emptyDate })
  ).documents.find((d) => d.kind === "day").exists,
  false,
);
await page.getByRole("button", { name: "今天", exact: true }).click();
await source.waitFor();
await page
  .getByRole("combobox", { name: "文件", exact: true })
  .selectOption("tasks");
await page
  .getByText(
    "全部任务的当前状态，不按日期筛选。 任务和完成状态随 Inky 同步。",
    { exact: true },
  )
  .waitFor();
assert.match(await source.textContent(), /临时核对材料/);
pass(
  "Date selection handles empty history, while all-tasks Markdown explicitly shows current global state",
);

await page.setViewportSize({ width: 1060, height: 720 });
await page.getByRole("tab", { name: "每日记录", exact: true }).click();
await page.locator(".wk-record-stats").waitFor();
const size = await page.evaluate(() => ({
  width: innerWidth,
  height: innerHeight,
  scroll: document.documentElement.scrollWidth,
  main: document.querySelector(".wk-main").getBoundingClientRect().width,
}));
assert(size.scroll <= size.width);
await page.screenshot({ path: path.join(out, "narrow-record.png") });
await page.getByRole("tab", { name: "Markdown", exact: true }).click();
await source.waitFor();
assert(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
);
assert.deepEqual(errors, []);
pass(
  "1060px records and Markdown views remain usable with the Coach pane visible",
);

// Exercise the integrated Paper ending page and observe the same saved result
// in both workbench views, without reloading the workbench.
const integratedTask = (
  await api("create_task", {
    taskId: randomUUID(),
    title: "核对同步结果",
    nextAction: "保存这次验收",
  })
).task;
await main.reload();
const integratedRow = main.locator(".sheet-task").filter({
  has: main.locator(".sheet-task-name", { hasText: "核对同步结果" }),
});
await integratedRow.locator(".sheet-task-toggle").click();
await main.getByRole("button", { name: "Do this：保存这次验收", exact: true }).click();
await main.getByRole("button", { name: "start", exact: true }).click();
await main.getByRole("button", { name: "结束番茄钟", exact: true }).click();
await main.getByRole("button", { name: "保存并结束", exact: true }).waitFor();
await main.waitForFunction(() => innerHeight === 528);
assert(await main.getByRole("radio", { name: "还没完成", exact: true }).isChecked());
await main.getByRole("radio", { name: "已完成", exact: true }).locator("..").click();
await main.getByRole("button", { name: "补充记录（可选）", exact: true }).click();
await main.getByLabel("产出", { exact: true }).fill("结束页保存的结果已经同步到工作台");
assert.equal(await main.evaluate(() => innerHeight), 528);
assert.equal((await state()).tasks.find((task) => task.id === integratedTask.id).completed, false);
await main.screenshot({ path: path.join(out, "integrated-end-page.png") });
await main.getByRole("button", { name: "保存并结束", exact: true }).click();
await main.getByRole("button", { name: "回到任务页", exact: true }).waitFor();
s = await state();
assert.equal(s.tasks.find((task) => task.id === integratedTask.id).completed, false);
assert(s.planning.steps.some((step) => step.taskId === integratedTask.id && step.completed));
assert(!s.sessions.some((item) => item.status !== "finished"));
await page.getByRole("tab", { name: "每日记录", exact: true }).click();
await page.getByText("结束页保存的结果已经同步到工作台", { exact: false }).waitFor();
await page.getByRole("tab", { name: "Markdown", exact: true }).click();
await page.getByRole("combobox", { name: "文件", exact: true }).selectOption("day");
await page.waitForFunction(() =>
  document.querySelector(".wk-markdown-source code")?.textContent.includes("结束页保存的结果已经同步到工作台"),
);
assert.deepEqual(errors, []);
pass("Integrated 320x528 Paper ending saves step-only completion and output into daily records and exact Markdown without reloading or starting another timer");
await writeFile(
  path.join(out, "desktop-verification.json"),
  JSON.stringify(
    {
      version: "0.6.2",
      testData: root,
      checks,
      narrow: size,
      pageErrors: errors,
    },
    null,
    2,
  ),
);
await browser.close();
