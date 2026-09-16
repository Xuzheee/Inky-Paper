import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright";

const run = process.argv[2] || "workbench-context-063";
if (!/^[A-Za-z0-9_-]+$/.test(run)) throw Error("Invalid run name");
const out = path.resolve("docs/verification/0.6.3");
await mkdir(out, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9254");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((p) => p.url().includes("workbench"));
const main = pages.find((p) => p.url() === "http://tauri.localhost/");
assert(page && main);
page.setDefaultTimeout(15000);
main.setDefaultTimeout(15000);
const continuing = process.argv[3] === "finish";
const checks = continuing
    ? JSON.parse(await readFile(path.join(out, "desktop-checks.json"), "utf8"))
        .checks
    : [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
main.on("pageerror", (e) => errors.push(e.message));
const invoke = (command, args = {}) =>
  page.evaluate(
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
const state = async () => (await api("get_state")).state;
const key = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = key(new Date());
const next = new Date();
next.setDate(next.getDate() + 1);
const tomorrow = key(next);
const scope = page.getByLabel("Coach 讨论范围");
const pass = (message) => {
  checks.push(message);
  console.log("PASS", message);
};
assert.equal(
  path.resolve((await invoke("get_paper_bridge_status")).connectionFile),
  path.resolve("output", run, "paper-test/paper-agent-bridge.json"),
);
if (!continuing)
  assert.equal(
    (await state()).tasks.length,
    0,
    "Requires a fresh isolated database",
  );

try {
  if (!continuing) {
    await page
      .getByRole("button", { name: "添加任务", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("任务名称", { exact: true }).fill("工作台日期验收");
    await dialog.getByLabel("具体这一步").fill("核对初始安排");
    await dialog.getByLabel("安排日期", { exact: true }).fill(tomorrow);
    await dialog.getByRole("button", { name: "保存计划", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "核对初始安排", exact: true })
      .click();
    assert.match(await scope.innerText(), new RegExp(tomorrow));
    assert.match(await scope.innerText(), /核对初始安排/);
    pass(
      "Selecting a row in the second day uses that row's actual date and step",
    );
    await page
      .getByRole("button", { name: "取消任务选择，讨论当天记录" })
      .click();
    assert.match(await scope.innerText(), new RegExp(today));
    assert.match(await scope.innerText(), /当天计划与记录/);
    await page
      .getByRole("button", { name: "核对初始安排", exact: true })
      .click();
    await page
      .getByLabel("发送给 Coach")
      .fill(
        "这是隔离验收。请为当前选中任务“工作台日期验收”提出一张新候选卡片，动作“检查日期与返回入口”，首轮 10 分钟，安排日期按本次讨论范围。读取最新任务与该日期日计划后，调用 inky_paper_propose_plan_batch 保存并输出卡片。不要采用，不开始计时。信息已足够，无需追问。",
      );
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByRole("button", { name: today, exact: true }).click();
    assert.match(await scope.innerText(), new RegExp(`本次回复 · ${tomorrow}`));
    assert.match(await scope.innerText(), new RegExp(`下次发送：${today}`));
    pass(
      "An in-flight reply retains its original task/date while navigation changes the next-send scope",
    );
    console.log("Waiting for live Hermes ACP…");
    await page
      .getByRole("button", { name: "停止回复", exact: true })
      .waitFor({ state: "hidden", timeout: 420000 });
    const candidate = page
      .getByRole("region", { name: "Coach 候选计划" })
      .last();
    await candidate.waitFor();
    assert.equal(
      await candidate.getByLabel("建议安排日期").inputValue(),
      tomorrow,
    );
    assert.match(await scope.innerText(), new RegExp(`讨论范围 · ${today}`));
    assert.match(await scope.innerText(), /当天计划与记录/);
    let s = await state();
    assert.equal(s.sessions.length, 0);
    assert(
      !s.planning.steps.some((step) => step.text === "检查日期与返回入口"),
    );
    await page.screenshot({ path: path.join(out, "request-date.png") });
    await candidate.getByRole("button", { name: /^采用这一步 · 加入/ }).click();
    await candidate
      .getByRole("button", { name: "已加入计划", exact: true })
      .waitFor();
    s = await state();
    const step = s.planning.steps.find(
      (step) => step.text === "检查日期与返回入口",
    );
    assert(step);
    const item = s.planning.dayItems.find(
      (item) => !item.removedAt && item.stepId === step.id,
    );
    assert.equal(item.date, tomorrow);
    assert(
      !s.planning.dayItems.some(
        (item) => item.stepId === step.id && item.date === today,
      ),
    );
    pass(
      "Live Hermes suggestion and adoption use the request date, not the current browsing day",
    );
    await candidate
      .getByRole("button", { name: "设为下一步并回到 Inky", exact: true })
      .click();
    await main
      .locator(".next-card h2")
      .filter({ hasText: "检查日期与返回入口" })
      .waitFor();
    await main.getByRole("button", { name: "start", exact: true }).waitFor();
    assert.equal(await main.getByLabel("专注时长").inputValue(), "10");
    assert.equal((await state()).sessions.length, 0);
    await main.screenshot({ path: path.join(out, "back-to-inky.png") });
    pass(
      "Adopted card returns to Inky with the exact step and duration selected, without starting a timer",
    );

    await page
      .getByRole("button", { name: "核对初始安排", exact: true })
      .click();
    await page
      .locator(".wk-detail-actions")
      .getByRole("button", { name: "设为下一步并回到 Inky", exact: true })
      .click();
    await main
      .locator(".next-card h2")
      .filter({ hasText: "核对初始安排" })
      .waitFor();
    assert.equal((await state()).sessions.length, 0);
    pass(
      "The task-row action also returns to the selected step without starting a timer",
    );
    await page.getByRole("tab", { name: "每日记录", exact: true }).click();
    assert.match(await scope.innerText(), /当天计划与记录/);
    await page.getByRole("tab", { name: "任务", exact: true }).click();
    assert.match(await scope.innerText(), /当天计划与记录/);
    pass(
      "Opening daily records clears the old task scope even after returning to tasks",
    );
    await main.getByRole("button", { name: "start", exact: true }).click();
    await main
      .getByRole("button", { name: "返回任务列表", exact: true })
      .waitFor();
    const active = (await state()).sessions.find(
      (session) => session.status !== "finished",
    );
    assert(active);
    await candidate
      .getByRole("button", { name: "设为下一步并回到 Inky", exact: true })
      .click();
    await candidate.getByText(/本轮番茄钟还未结束/).waitFor();
    assert.equal(
      (await state()).sessions.find((session) => session.status !== "finished")
        .action.id,
      active.action.id,
    );
    await page.getByRole("button", { name: "回到 Inky", exact: true }).click();
    await main
      .getByRole("button", { name: "返回番茄钟", exact: true })
      .waitFor();
    assert.equal(
      (await state()).sessions.find((session) => session.status !== "finished")
        .status,
      "running",
    );
    pass(
      "An active timer blocks step replacement; ordinary return to Inky leaves it running",
    );
  }
  const active = (await state()).sessions.find(
    (session) => session.status !== "finished",
  );
  if (active)
    await api("finish_session", {
      sessionId: active.id,
      expectedRevision: active.revision,
      outcome: "stopped",
      output: "隔离验证完成",
    });

  const history = await invoke("workbench_history", { sessionId: null });
  const conversation = await invoke("workbench_history", {
    sessionId: history.sessions[0].id,
  });
  assert.equal(conversation.messages.at(-1).context.date, tomorrow);
  assert.equal(conversation.messages.at(-1).context.stepText, "核对初始安排");
  await page.reload();
  await page.getByRole("button", { name: "已加入计划", exact: true }).waitFor();
  assert.equal(await page.getByLabel("建议安排日期").inputValue(), tomorrow);
  pass("Reload restores the adopted card and the persisted request date");
  await page.getByLabel("建议安排日期").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "adopted-date.png") });
  assert.deepEqual(errors, []);
  const step = (await state()).planning.steps.find(
    (step) => step.text === "检查日期与返回入口",
  );
  await writeFile(
    path.join(out, "desktop-verification.json"),
    JSON.stringify(
      {
        run,
        today,
        tomorrow,
        checks,
        errors,
        sessionId: history.sessions[0].id,
        candidateStepId: step.id,
      },
      null,
      2,
    ),
  );
} finally {
  await writeFile(
    path.join(out, "desktop-checks.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
}
