import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const run=process.argv[2];
assert.match(run||"",/^p0p1-m1-[A-Za-z0-9_-]+$/);
const root=path.resolve("output",run);
const out=path.resolve("docs/verification/p0p1/M1");
const expected=JSON.parse(await readFile(path.join(root,"restart-expectation.json"),"utf8"));
const report=JSON.parse(await readFile(path.join(out,"desktop-partial.json"),"utf8"));
assert.equal(report.run,run);
const browser=await chromium.connectOverCDP("http://127.0.0.1:9254");
try {
  const pages=browser.contexts().flatMap(context=>context.pages());
  const main=pages.find(page=>page.url()==="http://tauri.localhost/");
  const wb=pages.find(page=>page.url().includes("workbench=1"));
  assert(main&&wb);
  const invoke=(command,args={})=>wb.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  assert.equal(path.resolve((await invoke("get_paper_bridge_status")).connectionFile),path.join(root,"paper-test/paper-agent-bridge.json"));
  const s=(await invoke("paper_execute",{action:"get_state",input:{}})).state;
  assert.deepEqual(s.planning.prepared,{taskId:expected.taskId,stepId:expected.stepId,dayItemId:expected.dayItemId});
  assert(s.sessions.every(session=>session.status==="finished"));
  assert.equal(s.planning.sessionLinks.find(link=>link.sessionId===expected.sessionId).planDate,expected.planDate);
  await invoke("coach_show_main",{view:"home"});
  await main.locator(".next-card h2").filter({hasText:"提前执行未来步骤"}).waitFor();
  await main.getByRole("button",{name:"start",exact:true}).waitFor();
  await main.screenshot({path:path.join(out,"restart-prepared.png")});
  report.checks.push("Full isolated native restart retains exact prepared task/step/day-item source and past session link without starting a clock");
  report.restartPassed=true;
  // Root adds the full leftover/editor and narrow-window checks before milestone release.
  report.complete=false;
  await writeFile(path.join(out,"desktop-verification.json"),JSON.stringify(report,null,2));
  console.log("PASS persisted prepared source after a full native process restart");
} finally { await browser.close(); }
