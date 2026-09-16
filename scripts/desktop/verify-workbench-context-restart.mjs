import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const run = process.argv[2] || "workbench-context-063";
if (!/^[A-Za-z0-9_-]+$/.test(run)) throw Error("Invalid run name");
const out = path.resolve("docs/verification/0.6.3");
const report = JSON.parse(
  await readFile(path.join(out, "desktop-verification.json"), "utf8"),
);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9254");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((p) => p.url().includes("workbench"));
const main = pages.find((p) => p.url() === "http://tauri.localhost/");
assert(page && main);
page.setDefaultTimeout(15000);
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
assert.equal(
  path.resolve((await invoke("get_paper_bridge_status")).connectionFile),
  path.resolve("output", run, "paper-test/paper-agent-bridge.json"),
);
try {
  await page.getByRole("button", { name: "已加入计划", exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("建议安排日期").inputValue(),
    report.tomorrow,
  );
  assert.equal(
    await page.locator(".wk-stale").count(),
    0,
    "Already adopted cards must not ask for adoption approval again",
  );
  const history = await invoke("workbench_history", {
    sessionId: report.sessionId,
  });
  assert.equal(history.messages.length, 2);
  assert.equal(history.messages[1].context.date, report.tomorrow);
  assert.equal(history.messages[1].context.stepText, "核对初始安排");
  const s = (await invoke("paper_execute", { action: "get_state", input: {} }))
    .state;
  assert.equal(s.sessions.length, 1);
  assert(s.sessions.every((session) => session.status === "finished"));
  assert.equal(
    s.planning.dayItems.find((item) => item.stepId === report.candidateStepId)
      .date,
    report.tomorrow,
  );
  await invoke("coach_show_main", { view: "home" });
  await main
    .locator(".next-card h2")
    .filter({ hasText: "核对初始安排" })
    .waitFor();
  assert.equal(
    await main.getByRole("button", { name: "start", exact: true }).count(),
    1,
  );
  await page.getByLabel("建议安排日期").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "restart-history.png") });
  report.checks.push(
    "Full application restart preserves message scope, adopted date and selected Paper step without starting a clock",
  );
  report.restartPassed = true;
  await writeFile(
    path.join(out, "desktop-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    "PASS Full application restart preserves dates, context and selection",
  );
} finally {
  await browser.close();
}
