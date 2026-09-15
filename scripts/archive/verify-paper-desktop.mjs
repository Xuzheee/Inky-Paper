import assert from "node:assert/strict";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "../integrations/inky-paper-mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../integrations/inky-paper-mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import path from "node:path";
const root = process.cwd(),
  connection = path.join(root, "output/smoke-data/paper-agent-bridge.json");
const b = await chromium.connectOverCDP("http://127.0.0.1:9225");
const p = b.contexts()[0].pages()[0];
p.setDefaultTimeout(12000);
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const client = new Client({ name: "paper-acceptance", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "integrations/inky-paper-mcp-server/index.mjs")],
    env: { ...process.env, INKY_PAPER_CONNECTION_FILE: connection },
  }),
);
const checks = [];
const pass = (x) => {
  checks.push(x);
  console.log("PASS", x);
};
async function call(name, args = {}) {
  const r = await client.callTool({
    name: "inky_paper_" + name,
    arguments: args,
  });
  assert(!r.isError, JSON.stringify(r));
  return r.structuredContent;
}
const ui = (name) => p.getByRole("button", { name, exact: true });
try {
  const status = await p.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("get_paper_bridge_status"),
  );
  assert.equal(path.resolve(status.connectionFile), connection);
  await p.evaluate(()=>localStorage.removeItem("paper-selected")); await p.reload();
  assert.equal((await client.listTools()).tools.length, 6);
  pass("Independent connection and 6 named MCP tools");
  const taskId = randomUUID();
  const create = {
    requestId: randomUUID(),
    taskId,
    title: "Paper 同步验收",
    nextAction: "列出任务页的 3 个关键状态",
  };
  let t = (await call("create_task", create)).task;
  assert.equal((await call("create_task", create)).task.id, taskId);
  await p
    .getByRole("heading", { name: create.nextAction, exact: true })
    .waitFor();
  await p.screenshot({ path: "output/playwright/ready.png" });
  pass("MCP create appears in real desktop; idempotent retry");
  await ui("修改下一步").click();
  await p.getByLabel("任务名称", { exact: true }).fill("在 Paper 手动修改");
  await p.getByLabel("下一步", { exact: false }).fill("先画待开始状态");
  await ui("保存").click();
  await ui("修改下一步").waitFor();
  t = (await call("get_task", { taskId })).task;
  assert.equal(t.title, "在 Paper 手动修改");
  assert.equal(t.nextAction.text, "先画待开始状态");
  pass("Manual edits are read back through MCP");
  await ui("修改下一步").click();
  await p.getByLabel("任务名称", { exact: true }).fill("我保留的编辑草稿");
  await call("update_task", {
    requestId: randomUUID(),
    taskId,
    expectedRevision: t.revision,
    patch: { title: "Hermes 已更新标题" },
  });
  await p.waitForTimeout(600);
  assert.equal(
    await p.getByLabel("任务名称", { exact: true }).inputValue(),
    "我保留的编辑草稿",
  );
  await ui("保存").click();
  await ui("已核对，保留我的草稿").waitFor();
  assert.equal(
    (await call("get_task", { taskId })).task.title,
    "Hermes 已更新标题",
  );
  await p.screenshot({ path: "output/playwright/conflict.png" });
  await ui("已核对，保留我的草稿").click();
  await ui("保存").click();
  await ui("修改下一步").waitFor();
  t = (await call("get_task", { taskId })).task;
  assert.equal(t.title, "我保留的编辑草稿");
  pass("External update preserves draft; conflict requires explicit review");
  await ui("进行任务").click();
  await ui("暂停").waitFor();
  await p.waitForTimeout(2100);
  await ui("暂停").click();
  await p.getByLabel("回来先做什么", { exact: true }).fill("先补暂停恢复状态");
  await p.screenshot({ path: "output/playwright/paused.png" });
  await ui("继续").click();
  await ui("暂停").waitFor();
  let detail = await call("get_task", { taskId });
  assert.equal(detail.activeSession.pauseCount, 1);
  assert.equal(detail.activeSession.resumeCue, "先补暂停恢复状态");
  await p.reload();
  await ui("暂停").waitFor();
  pass("Pause cue, resume and running session survive WebView reload");
  t = detail.task;
  await call("update_task", {
    requestId: randomUUID(),
    taskId,
    expectedRevision: t.revision,
    patch: { nextAction: "Hermes 安排的下一步" },
  });
  await p.waitForTimeout(400);
  await p
    .getByRole("heading", { name: "先画待开始状态", exact: true })
    .waitFor();
  pass("In-flight action snapshot survives Agent replanning");
  await ui("切换迷你宠物").click();
  await p
    .getByRole("button", { name: "返回 Inky Paper", exact: true })
    .waitFor();
  assert.equal(await p.locator("body").innerText(), "");
  assert.equal(await p.locator("img").count(), 1);
  const bg = await p
    .locator("main")
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.equal(bg, "rgba(0, 0, 0, 0)");
  await p.screenshot({
    path: "output/playwright/mini.png",
    omitBackground: true,
  });
  await p.getByRole("button", { name: "返回 Inky Paper", exact: true }).click();
  await ui("暂停").waitFor();
  pass("Mini mode is pet-only and transparent; timer continues");
  await ui("结束这一轮").click();
  await ui("这一步完成了").waitFor();
  await p.getByRole("button", { name: /补一句/ }).click();
  await p.getByLabel("产出", { exact: true }).fill("完成待开始草图");
  await p.getByLabel("卡点", { exact: true }).fill("暂停提示还需调整");
  await p.getByLabel("下次起点", { exact: true }).fill("补暂停恢复");
  await p.screenshot({ path: "output/playwright/feedback.png" });
  await ui("这一步完成了").click();
  await ui("回到任务页").waitFor();
  detail = await call("get_task", { taskId });
  assert.equal(detail.task.completed, false);
  assert.equal(detail.task.nextAction.text, "Hermes 安排的下一步");
  assert.equal(detail.task.nextAction.completed, false);
  assert.equal(detail.activeSession, null);
  const history = await call("read_history", { taskId });
  assert.equal(history.items[0].feedback.output, "完成待开始草图");
  assert.equal(history.items[0].action.text, "先画待开始状态");
  assert(history.items[0].elapsedSeconds > 0);
  pass(
    "Feedback roundtrip; completing old action preserves new action and parent",
  );
  await ui("休息 5 分钟").click();
  await ui("结束休息").waitFor();
  await p.waitForTimeout(1100);
  await ui("结束休息").click();
  await ui("修改下一步").waitFor();
  assert.equal((await call("read_history")).items[0].kind, "rest");
  pass("Explicit rest recorded separately");
  await ui("进行任务").click();
  await ui("暂停").waitFor();
  await ui("结束这一轮").click();
  await ui("这一步完成了").click();
  await ui("回到任务页").click();
  await ui("写下下一步").waitFor();
  detail = await call("get_task", { taskId });
  assert(detail.task.nextAction.completed && !detail.task.completed);
  await p.screenshot({ path: "output/playwright/step-complete.png" });
  pass("Completed step has pencil strike; parent remains pending");
  await ui("随手记").click();
  await p
    .getByLabel("随手记", { exact: true })
    .fill("这里收集执行时的零散想法");
  await ui("记下").click();
  await p.getByText("这里收集执行时的零散想法", { exact: true }).first().waitFor();
  assert(
    (await call("read_history")).notes.some((n) => n.text.includes("零散想法")),
  );
  pass("Captured notes available to Hermes");
  const events = await call("read_events", { after: 0, limit: 100 });
  for (const name of [
    "start_session",
    "pause_session",
    "resume_session",
    "finish_session",
    "capture_note",
  ])
    assert(events.items.some((x) => x.event.kind === name));
  assert.equal(
    (await call("read_events", { after: events.nextCursor })).items.length,
    0,
  );
  pass("Event feed supports incremental cursor");
  const credential = JSON.parse(await readFile(connection));
  assert.equal(
    (
      await fetch(credential.url + "/list_tasks", {
        method: "POST",
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(credential.url + "/list_tasks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.token}`,
          Origin: "https://example.com",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(credential.url + "/start_session", {
        method: "POST",
        headers: { Authorization: `Bearer ${credential.token}` },
        body: "{}",
      })
    ).status,
    404,
  );
  pass("Authentication, Origin and Agent action boundaries");
  assert.deepEqual(errors, []);
  await writeFile(
    "output/playwright/verification.json",
    JSON.stringify(
      { result: "PASS", checks, taskId, pageErrors: errors },
      null,
      2,
    ),
  );
} finally {
  await client.close();
  await b.close();
}
