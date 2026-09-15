import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
const run = process.argv[2] || "workbench-acceptance";
if (!/^[a-zA-Z0-9_-]+$/.test(run)) throw Error("Invalid acceptance directory");
const out = path.resolve("output/playwright", run);
await mkdir(out, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9254");
const pages = browser.contexts()[0].pages();
const p = pages.find((p) => p.url().includes("workbench"));
const main = pages.find((p) => !p.url().includes("index.html?"));
const checks = [],
  errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.setDefaultTimeout(12000);
const api = (action, input = {}) =>
  p.evaluate(
    ({ action, input }) =>
      window.__TAURI_INTERNALS__.invoke("paper_execute", { action, input }),
    { action, input },
  );
const state = async () => (await api("get_state")).state;
const pass = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = dateKey();
const next = new Date();
next.setDate(next.getDate() + 1);
const tomorrow = dateKey(next);
const bridge = await p.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke("get_paper_bridge_status"),
);
assert.equal(
  path.resolve(bridge.connectionFile),
  path.resolve(`output/${run}/paper-test/paper-agent-bridge.json`),
);
assert.equal(
  (await state()).tasks.length,
  0,
  "Only a fresh isolated database may be seeded",
);
try {
  await p
    .getByRole("button", { name: "添加任务", exact: true })
    .first()
    .click();
  const dialog = p.getByRole("dialog");
  await dialog.getByLabel("任务名称", { exact: true }).fill("工作台验收");
  await dialog.getByLabel("具体这一步", { exact: false }).fill("检查计划同步");
  await dialog.getByLabel("首轮时长（分钟）", { exact: true }).fill("15");
  await dialog.getByLabel("开始时间", { exact: true }).fill("09:30");
  await dialog.getByLabel("日程时长（分钟）", { exact: true }).fill("30");
  await dialog.getByRole("button", { name: "保存计划", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await p.getByRole("button", { name: "检查计划同步", exact: true }).waitFor();
  let s = await state();
  assert.equal(s.tasks.length, 1);
  assert.equal(s.planning.dayItems[0].startMinute, 570);
  assert.equal(s.sessions.length, 0);
  pass("UI create persists task/step/schedule with no timer");
  assert.equal(
    (
      await main.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("paper_execute", {
          action: "get_state",
          input: {},
        }),
      )
    ).state.tasks[0].id,
    s.tasks[0].id,
  );
  pass("Workbench and Paper share the same task");
  await p
    .getByRole("button", { name: "完成 检查计划同步", exact: true })
    .click();
  await p
    .getByRole("button", { name: "撤销完成 检查计划同步", exact: true })
    .waitFor();
  s = await state();
  assert(s.planning.steps[0].completed);
  assert(!s.tasks[0].completed);
  assert.equal(s.sessions.length, 0);
  pass("Manual completion does not complete parent or create time");
  await p
    .getByRole("button", { name: "撤销完成 检查计划同步", exact: true })
    .click();
  await p
    .getByRole("button", { name: "完成 检查计划同步", exact: true })
    .waitFor();
  const item = (await state()).planning.dayItems[0];
  await p
    .locator(`[data-row-id="${item.id}"]`)
    .dragTo(p.locator(`[data-date="${tomorrow}"]`));
  await p
    .locator(`[data-date="${tomorrow}"] [data-row-id="${item.id}"]`)
    .waitFor();
  s = await state();
  assert.equal(s.planning.dayItems[0].date, tomorrow);
  pass("Drag across days saves a versioned move");
  await p.getByRole("tab", { name: "日程", exact: true }).click();
  await p.locator(".wk-calendar-event").waitFor();
  assert.match(
    await p.locator(".wk-calendar-event").innerText(),
    /09:30–10:00/,
  );
  await p.screenshot({ path: path.join(out, "calendar.png") });
  pass("Calendar displays persisted schedule");
  await p.getByRole("tab", { name: "任务", exact: true }).click();
  await p.getByRole("button", { name: "检查计划同步", exact: true }).click();
  await p.getByRole("button", { name: "设为下一步", exact: true }).click();
  await p.getByRole("status").filter({ hasText: "已设为下一步" }).waitFor();
  assert.equal((await state()).sessions.length, 0);
  pass("Selecting next step leaves clock user-controlled");
  await p
    .getByLabel("发送给 Coach", { exact: true })
    .fill(
      `这是隔离验收对话。请读取 ${today} 的日计划和已有任务，为已有任务“工作台验收”提出一张新候选卡片，动作“检查对话恢复”，首轮 10 分钟。使用 inky_paper_propose_plan_batch 保存候选并输出 ::inky-plan 指令，不采用，不开始计时，不写其他项目。信息已足够，无需追问。`,
    );
  await p.getByRole("button", { name: "发送", exact: true }).click();
  console.log("Waiting for live Hermes ACP and Paper MCP…");
  await p
    .getByRole("button", { name: "停止回复", exact: true })
    .waitFor({ state: "hidden", timeout: 420000 });
  if (await p.locator(".wk-chat-error").count())
    console.log("CHAT_ERROR", await p.locator(".wk-chat-error").innerText());
  await p
    .getByRole("region", { name: "Coach 候选计划" })
    .waitFor({ timeout: 15000 });
  s = await state();
  assert.equal(s.tasks.length, 1);
  assert.equal(s.sessions.length, 0);
  assert(!s.planning.steps.some((s) => s.text === "检查对话恢复"));
  pass("Live Hermes reads Paper and returns an unadopted candidate");
  await p.screenshot({ path: path.join(out, "coach-candidate.png") });
  await p.getByRole("button", { name: "采用这一步", exact: true }).click();
  await p.getByRole("button", { name: "已加入计划", exact: true }).waitFor();
  s = await state();
  assert(s.planning.steps.some((s) => s.text === "检查对话恢复"));
  assert.equal(s.sessions.length, 0);
  assert(
    s.planning.dayItems.some(
      (i) =>
        i.date === today &&
        i.stepId === s.planning.steps.find((s) => s.text === "检查对话恢复").id,
    ),
  );
  pass("Explicit adoption saves the model candidate into the shared day plan");
  await p.reload();
  await p.getByRole("button", { name: "已加入计划", exact: true }).waitFor();
  pass("Reload restores conversation and adopted plan");
  await p.screenshot({ path: path.join(out, "tasks-final.png") });
  const geometry = await p.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    overflow: document.documentElement.scrollWidth > innerWidth,
    columns: [
      ...document.querySelectorAll(".wk-sidebar,.wk-main,.wk-coach"),
    ].map((e) => ({ width: e.clientWidth, scrollWidth: e.scrollWidth })),
  }));
  assert(!geometry.overflow);
  assert.equal(errors.length, 0, errors.join("\n"));
  pass("No page errors or horizontal page overflow");
  await writeFile(
    path.join(out, "verification.json"),
    JSON.stringify(
      { checks, errors, geometry, bridgeFile: bridge.connectionFile },
      null,
      2,
    ),
  );
} finally {
  await writeFile(
    path.join(out, "partial-checks.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
}
