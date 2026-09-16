// C03 native local-user acceptance only. This is NOT a model evaluation.
// First launch a FRESH debug instance with:
//   powershell -File scripts/desktop/launch-p0p1.ps1 -RunName p0p1-m5-c03-01
// Then (only when native acceptance is authorized):
//   node scripts/desktop/verify-p0p1-c03.mjs p0p1-m5-c03-01
// No clock overrides, offline database writes, bridge credentials or Hermes config reads.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, realpath, lstat } from "node:fs/promises";
import { chromium } from "playwright";
import {
  hash,
  within,
  pause,
  redact,
} from "../evals/inky-p0p1/native-run-utils.mjs";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const run = process.argv[2];
assert.match(run || "", /^p0p1-m5-[A-Za-z0-9_-]+$/);
assert.equal(
  path.resolve(process.cwd()).toLowerCase(),
  path.resolve(workspace).toLowerCase(),
  "Run only from this independent Paper checkout",
);
const root = path.resolve(workspace, "output", run),
  dataDir = path.join(root, "paper-test");
within(path.join(workspace, "output"), root);
for (const folder of [path.join(workspace, "output"), root, dataDir])
  assert(
    !(await lstat(folder)).isSymbolicLink(),
    "Isolated run paths must not use symlinks or junctions",
  );
within(await realpath(root), await realpath(dataDir));
const pid = Number(await readFile(path.join(root, "paper-test.pid"), "utf8"));
assert(
  Number.isSafeInteger(pid) && pid > 0,
  "Fresh isolated launcher PID required",
);
const out = path.join(
  workspace,
  "docs/verification/p0p1/M5",
  run,
  `c03-native-${Date.now()}`,
);
await mkdir(out, { recursive: true });
const report = {
  kind: "c03-native-local-user-acceptance",
  run,
  pid,
  startedAt: new Date().toISOString(),
  modelCalls: 0,
  modelEvaluation: false,
  desktopPassed: false,
  checks: [],
  errors: [],
  actions: [],
  screenshots: [],
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  isolation: { root, dataDir },
  note: "Only real local-user named operations and native UI actions. Summary text is authored by the test harness, never attributed to a model.",
};
const writeReport = () =>
  writeFile(
    path.join(out, "c03-native-evidence.json"),
    JSON.stringify(redact(report), null, 2) + "\n",
  );
let browser, wb, main, invoke, get, api, ownSessionId;
const pageErrors = [];
const nowDate = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
const waitFor = async (predicate, message, timeout = 20000) => {
  const end = Date.now() + timeout;
  do {
    const value = await predicate();
    if (value) return value;
    await pause(150);
  } while (Date.now() < end);
  throw Error(message);
};
const pass = (message) => {
  report.checks.push({ message, at: new Date().toISOString() });
  console.log("PASS", message);
};
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
const shot = async (name, page = wb) => {
  const windows = nativeWindows();
  assert(
    windows.some(
      (window) =>
        window.visible &&
        window.title === (page === wb ? "Inky · 工作台" : "Inky Paper"),
    ),
    "The actual native window must be visible",
  );
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.screenshots.push({ name, file, windows });
  await writeReport();
};
const summaryBox = (id) =>
  wb.locator(`section.wk-summary[data-summary-id="${id}"]`);
const expand = async (details) => {
  if ((await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
};
const openSources = async (summary) => {
  const box = summaryBox(summary.id);
  await box.waitFor();
  await expand(box.locator("details.wk-summary-sources"));
  return box;
};
const openSource = async (summary, sourceId) => {
  const box = await openSources(summary),
    source = box.locator(`details[data-evidence-id="${sourceId}"]`);
  assert.equal(
    await source.count(),
    1,
    "Source ids must locate actual summary evidence",
  );
  await expand(source);
  return source;
};
const probe = () =>
  wb.evaluate(() => {
    const probe = window.__c03Probe;
    return probe
      ? { commands: probe.commands, chatEvents: probe.chatEvents }
      : null;
  });
const noModel = async () => {
  const capture = await probe();
  assert(capture, "Native command observer must remain mounted");
  const sends = capture.commands.filter(
    (command) => command.command === "workbench_send",
  );
  report.modelCalls = sends.length;
  assert.equal(
    sends.length,
    0,
    "C03 local-user script must not send a model prompt",
  );
  assert.equal(
    capture.chatEvents.length,
    0,
    "No unsolicited Coach events are permitted",
  );
  assert.equal(
    (await invoke("workbench_history", { sessionId: null })).sessions.length,
    0,
    "No model conversation may be created",
  );
};
const refreshRecords = async (date) => {
  await invoke("open_workbench");
  await wb.getByRole("button", { name: date, exact: true }).click();
  await wb.getByRole("button", { name: "每日记录", exact: true }).click();
  await wb.getByRole("button", { name: "刷新", exact: true }).click();
  await wb
    .getByRole("article", { name: `${date}每日记录`, exact: true })
    .waitFor();
};

try {
  const processInfo = JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        '$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$env:INKY_C03_PID); if (!$p) {throw "Isolated PID is no longer running"}; [pscustomobject]@{pid=$p.ProcessId; executable=$p.ExecutablePath; parent=$p.ParentProcessId} | ConvertTo-Json -Compress',
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, INKY_C03_PID: String(pid) },
      },
    ),
  );
  const expectedExe = path.resolve(
    workspace,
    "src-tauri/target/debug/inky-paper.exe",
  );
  assert.equal(
    path.resolve(processInfo.executable).toLowerCase(),
    expectedExe.toLowerCase(),
    "Launcher PID must be this checkout debug build",
  );
  report.build = {
    ...processInfo,
    sha256: hash(await readFile(expectedExe)),
    configuration: "debug",
  };
  browser = await chromium.connectOverCDP("http://127.0.0.1:9254");
  const pages = browser.contexts().flatMap((context) => context.pages());
  wb = pages.find((page) => page.url().includes("workbench=1"));
  main = pages.find((page) => page.url() === "http://tauri.localhost/");
  assert(wb && main, "Require the real separate workbench and Paper windows");
  assert.equal(new URL(wb.url()).origin, "http://tauri.localhost");
  for (const page of pages) {
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => pageErrors.push(error.message));
  }
  invoke = (command, args = {}) =>
    wb.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    );
  const bridge = await invoke("get_paper_bridge_status");
  assert(bridge.available);
  assert.equal(
    path.resolve(bridge.connectionFile).toLowerCase(),
    path.join(dataDir, "paper-agent-bridge.json").toLowerCase(),
    "Never connect this script to formal or another run data",
  );
  within(await realpath(dataDir), await realpath(bridge.connectionFile));
  report.isolation.connectionFile = bridge.connectionFile;
  report.isolation.scope = (await invoke("workbench_storage_scope")).scopeId;
  const profiles = JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        '$all=@(Get-CimInstance Win32_Process); $ids=@([int]$env:INKY_C03_PID); for($n=0;$n -lt 6;$n++) {$ids+=@($all | Where-Object {$ids -contains $_.ParentProcessId} | ForEach-Object {$_.ProcessId}); $ids=@($ids | Select-Object -Unique)}; @($all | Where-Object {$ids -contains $_.ProcessId -and $_.Name -eq "msedgewebview2.exe"} | ForEach-Object {[pscustomobject]@{pid=$_.ProcessId; profileMatched=$_.CommandLine.Contains($env:INKY_C03_PROFILE); portMatched=$_.CommandLine.Contains("--remote-debugging-port=9254")}}) | ConvertTo-Json -Compress',
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          INKY_C03_PID: String(pid),
          INKY_C03_PROFILE: path.join(root, "webview"),
        },
      },
    ) || "[]",
  );
  assert(
    [profiles].flat().some((item) => item?.profileMatched && item?.portMatched),
    "Actual WebView profile must belong to the launcher run",
  );
  report.isolation.webviewProcesses = profiles;
  api = async (action, input = {}) => {
    const parameters = {
      ...input,
      ...(!action.startsWith("get_") && !input.requestId
        ? { requestId: randomUUID() }
        : {}),
    };
    const event = {
      actor: "local-user-test-harness",
      action,
      input: parameters,
      at: new Date().toISOString(),
      status: "unknown",
    };
    report.actions.push(event);
    try {
      event.result = await invoke("paper_execute", {
        action,
        input: parameters,
      });
      event.status = "success";
      return event.result;
    } catch (error) {
      event.status = "error";
      event.error = String(error);
      throw error;
    }
  };
  get = async () => (await api("get_state")).state;
  const initial = await get();
  report.initial = initial;
  for (const list of [
    initial.tasks,
    initial.sessions,
    initial.notes,
    initial.planning.steps,
    initial.planning.dayItems,
    initial.planning.summaries,
  ])
    assert.equal(
      list.length,
      0,
      "Use a fresh isolated C03 database, never resume a seeded run",
    );
  assert.equal(
    (await invoke("workbench_history", { sessionId: null })).sessions.length,
    0,
  );
  await wb.evaluate(async () => {
    const probe = {
      commands: [],
      chatEvents: [],
      originalFetch: window.fetch,
      listeners: [],
    };
    window.__c03Probe = probe;
    window.fetch = async function (url, options) {
      const command = String(url).split("/").pop();
      let args;
      try {
        args =
          typeof options?.body === "string" ? JSON.parse(options.body) : null;
      } catch {
        args = null;
      }
      let observed;
      if (
        [
          "workbench_send",
          "workbench_cancel",
          "workbench_prepare_step",
        ].includes(command) ||
        (command === "paper_execute" &&
          [
            "start_session",
            "start_work",
            "prepare_step",
            "save_daily_summary",
          ].includes(args?.action))
      )
        observed = {
          command,
          at: Date.now(),
          ...(command === "workbench_send"
            ? { requestId: args?.requestId }
            : command === "paper_execute"
              ? { action: args?.action, input: args?.input }
              : { input: args?.input, itemId: args?.itemId }),
        };
      if (observed) probe.commands.push(observed);
      const response = await probe.originalFetch.call(this, url, options);
      if (observed)
        observed.responseStatus =
          response.headers.get("Tauri-Response") || "unknown";
      return response;
    };
    const callback = window.__TAURI_INTERNALS__.transformCallback((event) => {
      if (
        [
          "connected",
          "agent_message_chunk",
          "tool_call",
          "tool_call_update",
        ].includes(event.payload.update?.sessionUpdate)
      )
        probe.chatEvents.push(event.payload);
    });
    const eventId = await window.__TAURI_INTERNALS__.invoke(
      "plugin:event|listen",
      { event: "workbench:chat", target: { kind: "Any" }, handler: callback },
    );
    probe.listeners.push({ event: "workbench:chat", eventId, callback });
  });
  const today = await wb.evaluate(() =>
    [
      new Date().getFullYear(),
      String(new Date().getMonth() + 1).padStart(2, "0"),
      String(new Date().getDate()).padStart(2, "0"),
    ].join("-"),
  );
  assert.equal(today, nowDate());
  report.today = today;
  const offset = -new Date().getTimezoneOffset();
  report.utcOffsetMinutes = offset;
  const daily = () =>
    api("get_daily_record", { date: today, utcOffsetMinutes: offset });
  const title = "C03 原任务：核对数字",
    stepText = "C03 核对首行",
    cue = "从第二行的原始数字开始核对";
  const created = await api("workbench_save_step", {
    taskId: randomUUID(),
    stepId: randomUUID(),
    title,
    text: stepText,
    category: "work",
    priority: "high",
    plannedSeconds: 900,
    expectedResult: "首行数字与原始表一致",
    date: today,
    startMinute: null,
    durationMinutes: 15,
  });
  report.fixture = {
    taskId: created.task.id,
    stepId: created.step.id,
    dayItemId: created.item.id,
    title,
    stepText,
    cue,
  };
  const started = (
    await api("start_session", {
      taskId: created.task.id,
      expectedRevision: created.task.revision,
      stepId: created.step.id,
      expectedStepRevision: created.step.revision,
      dayItemId: created.item.id,
      kind: "focus",
      plannedSeconds: 900,
    })
  ).session;
  ownSessionId = started.id;
  report.fixture.sessionId = started.id;
  report.realClock = {
    startedAt: started.startedAt,
    scriptStartObservedAt: Date.now(),
    plannedSeconds: started.plannedSeconds,
  };
  const note = (
    await api("capture_note", {
      sessionId: started.id,
      text: "C03 随手记：首行已核对；第二行原始资料还没补齐。",
    })
  ).note;
  report.fixture.noteId = note.id;
  // Only actual elapsed wall-clock time is recorded; no setSystemTime or database fixture clock is used.
  await pause(1800);
  const running = (await get()).sessions.find(
    (session) => session.id === started.id,
  );
  const finished = (
    await api("finish_session", {
      sessionId: started.id,
      expectedRevision: running.revision,
      outcome: "stopped",
      output: "已核对首行，整步尚未完成。",
      blocker: "第二行原始资料未齐。",
      nextCue: cue,
    })
  ).session;
  assert(
    finished.elapsedSeconds >= 1 &&
      finished.elapsedSeconds <=
        Math.ceil((Date.now() - started.startedAt) / 1000),
  );
  assert.equal(finished.feedback.outcome, "stopped");
  assert.equal(finished.feedback.nextCue, cue);
  assert.equal(finished.action.text, stepText);
  report.realClock.finished = finished;
  for (const completed of [true, false]) {
    const state = await get(),
      task = state.tasks.find((task) => task.id === created.task.id),
      step = state.planning.steps.find((step) => step.id === created.step.id);
    await api("set_step_completed", {
      taskId: task.id,
      stepId: step.id,
      expectedTaskRevision: task.revision,
      expectedStepRevision: step.revision,
      completed,
    });
  }
  const read = await daily();
  report.readBeforeFirstSummary = read;
  assert.equal(read.sessions.length, 1);
  assert.equal(read.sessions[0].planDate, today);
  assert.equal(read.sessions[0].dayItemId, created.item.id);
  assert.equal(read.manualStepChanges.length, 2);
  assert.deepEqual(
    read.manualStepChanges.map((change) => change.completed),
    [true, false],
  );
  assert.equal(read.notes.find((item) => item.id === note.id).text, note.text);
  const planChange = read.planChanges.find(
    (change) => change.after?.id === created.item.id,
  );
  assert(planChange, "The real creation must provide plan-change evidence");
  const evidenceRefs = [
    { kind: "session", id: started.id },
    { kind: "step", id: created.step.id },
    ...read.manualStepChanges.map((change) => ({
      kind: "manualChange",
      id: change.id,
    })),
    { kind: "note", id: note.id },
    { kind: "planChange", id: planChange.id },
  ];
  const body = `## 实际推进\n实际计时 ${finished.elapsedSeconds} 秒；用户报告已核对首行，整步尚未完成。\n\n## 与计划的差异\n原计划预留 15 分钟，本次只进行了短时测试；步骤曾手动完成又撤销，目前仍未完成。\n\n## 已报告卡点与未知\n用户报告第二行原始资料未齐；计时之外的工作与注意力未知。\n\n## 下次起点\n建议${cue}，这一步尚未开始。`;
  const summaryInput = {
    date: today,
    utcOffsetMinutes: offset,
    expectedDataVersion: read.dataVersion,
    expectedNotesVersion: read.notesVersion,
    sourceAsOf: read.sampledAt,
    body,
    evidenceRefs,
    nextStart: {
      taskId: created.task.id,
      stepId: created.step.id,
      dayItemId: created.item.id,
      cue,
    },
  };
  const first = (await api("save_daily_summary", summaryInput)).summary;
  report.firstSummary = first;
  assert.equal(first.source, "user");
  assert.equal(first.evidence.length, evidenceRefs.length);
  assert.equal(first.nextStart.stepId, created.step.id);
  const originalEvidence = structuredClone(first.evidence);
  const afterFirst = await daily();
  report.afterFirstSummary = afterFirst;
  assert.equal(
    afterFirst.summaries.find((summary) => summary.id === first.id)
      .hasNewRecords,
    false,
  );
  assert(
    (await get()).sessions.every((session) => session.status === "finished"),
  );
  await noModel();
  pass(
    "Real short focus, stopped feedback, note, complete/undo and versioned source-backed summary were saved through local-user named operations; no model or fabricated clock",
  );

  await refreshRecords(today);
  await openSources(first);
  const sessionSource = await openSource(first, started.id);
  assert((await sessionSource.locator("dl").innerText()).includes(stepText));
  assert((await sessionSource.locator("dl").innerText()).includes(cue));
  assert((await sessionSource.innerText()).includes("计时只表示记录的时间"));
  const noteSource = await openSource(first, note.id);
  assert((await noteSource.locator("dl").innerText()).includes(note.text));
  for (const change of read.manualStepChanges) {
    const source = await openSource(first, change.id);
    assert(
      (await source.locator("dl").innerText()).includes(
        change.completed ? "手动完成" : "撤销完成",
      ),
    );
  }
  await openSource(first, planChange.id);
  await shot("01-summary-source-snapshots");
  pass(
    "Daily record expands actual session, note, manual-change and arrangement snapshots with read-as-of information",
  );

  const documents = await invoke("workbench_read_documents", { date: today });
  const personal = documents.documents.find(
    (document) => document.kind === "personal",
  );
  assert(personal?.path);
  within(dataDir, personal.path);
  await mkdir(path.dirname(personal.path), { recursive: true });
  within(await realpath(dataDir), await realpath(path.dirname(personal.path)));
  const beforePersonal = personal.exists
    ? await readFile(personal.path, "utf8")
    : "";
  const quote = "C03 外部复盘原句：第二行原始资料已经补齐，接下来核对第二行。";
  const afterPersonal = beforePersonal + `\n\n${quote}\n`;
  await writeFile(personal.path, afterPersonal, "utf8");
  report.externalMarkdownEdit = {
    actor: "harness-external-file-edit",
    path: personal.path,
    before: beforePersonal,
    after: afterPersonal,
    beforeHash: hash(beforePersonal),
    afterHash: hash(afterPersonal),
    at: new Date().toISOString(),
  };
  const changed = await daily();
  report.afterExternalMarkdown = changed;
  assert.equal(
    changed.dataVersion,
    read.dataVersion,
    "Only personal Markdown changed in this phase",
  );
  assert.notEqual(changed.notesVersion, read.notesVersion);
  assert.equal(
    changed.summaries.find((summary) => summary.id === first.id).hasNewRecords,
    true,
  );
  const beforeConflict = await get();
  await assert.rejects(
    api("save_daily_summary", { ...summaryInput, requestId: randomUUID() }),
    /CONFLICT/,
  );
  assert.deepEqual(
    (await get()).planning.summaries,
    beforeConflict.planning.summaries,
    "Rejected stale versions may not append a summary",
  );
  await refreshRecords(today);
  await summaryBox(first.id)
    .getByText("此后已有新记录或个人笔记变化，这份总结尚未更新。", {
      exact: true,
    })
    .waitFor();
  await shot("02-personal-markdown-conflict");
  pass(
    "Real external personal-Markdown edit marks the old summary stale; saving with the old data/notes versions is rejected without append",
  );

  const reread = await daily();
  report.readBeforeSecondSummary = reread;
  const second = (
    await api("save_daily_summary", {
      ...summaryInput,
      requestId: randomUUID(),
      expectedDataVersion: reread.dataVersion,
      expectedNotesVersion: reread.notesVersion,
      sourceAsOf: reread.sampledAt,
      body: `## 实际推进\n沿用原会话记录的短时核对；后写个人复盘报告资料已补齐。\n\n## 与计划的差异\n整步仍未完成，未新增计时记录。\n\n## 已报告卡点与未知\n原会话报告资料未齐；最新个人复盘原句为“${quote}”。尚无新的执行结果。\n\n## 下次起点\n建议${cue}，等待用户开始。`,
      evidenceRefs: [
        ...evidenceRefs,
        { kind: "personalNote", id: today, quote },
      ],
      nextStart: summaryInput.nextStart,
    })
  ).summary;
  report.secondSummary = second;
  assert.equal(
    second.evidence.find((source) => source.kind === "personalNote").snapshot
      .quote,
    quote,
  );
  const afterSecond = await daily();
  assert.equal(
    afterSecond.summaries.find((summary) => summary.id === second.id)
      .hasNewRecords,
    false,
  );
  assert.deepEqual(
    (await get()).planning.summaries.find((summary) => summary.id === first.id)
      .evidence,
    originalEvidence,
  );
  assert.equal(
    await readFile(personal.path, "utf8"),
    afterPersonal,
    "Saving the summary may not overwrite personal notes",
  );
  await refreshRecords(today);
  const personalSource = await openSource(second, today);
  assert.equal(await personalSource.locator("dd").last().innerText(), quote);
  await shot("03-personal-quote-source");
  pass(
    "Reread versions permit a new summary with the exact personal-note quote; the original summary evidence and user Markdown remain intact",
  );

  const beforeContinue = await get();
  report.beforeContinue = beforeContinue;
  await summaryBox(second.id)
    .getByRole("button", { name: "继续原步骤", exact: true })
    .click();
  await waitFor(
    async () =>
      (await probe()).commands.some(
        (command) =>
          command.command === "workbench_prepare_step" &&
          command.responseStatus === "ok",
      ),
    "The actual versioned handoff has not returned success",
  );
  await main.getByRole("button", { name: "start", exact: true }).waitFor();
  await main.getByText(stepText, { exact: true }).first().waitFor();
  const afterContinue = await get();
  report.afterContinue = afterContinue;
  assert.equal(afterContinue.planning.prepared.taskId, created.task.id);
  assert.equal(afterContinue.planning.prepared.stepId, created.step.id);
  assert.equal(afterContinue.planning.prepared.dayItemId, created.item.id);
  assert.deepEqual(
    afterContinue.sessions,
    beforeContinue.sessions,
    "Continuation only prepares; no clock is started or changed",
  );
  assert.equal(afterContinue.tasks.length, beforeContinue.tasks.length);
  assert.equal(
    afterContinue.planning.steps.length,
    beforeContinue.planning.steps.length,
  );
  const continuationCommand = (await probe()).commands.findLast(
    (command) => command.command === "workbench_prepare_step",
  );
  assert(continuationCommand);
  assert.equal(continuationCommand.input.stepId, created.step.id);
  assert.equal(continuationCommand.itemId, created.item.id);
  report.continuationCommand = continuationCommand;
  await shot("04-continue-original-in-paper", main);
  await noModel();
  pass(
    "Continue original step returns to native Inky with the same task/step/arrangement prepared, without starting a timer or adding an object",
  );

  await refreshRecords(today);
  if (await wb.getByRole("button", { name: "收起 Coach", exact: true }).count())
    await wb.getByRole("button", { name: "收起 Coach", exact: true }).click();
  const beforePrefill = await get();
  await summaryBox(second.id)
    .getByRole("button", { name: "为今天准备候选", exact: true })
    .click();
  const composer = wb.getByRole("textbox", {
    name: "发送给 Coach",
    exact: true,
  });
  await composer.waitFor();
  const prefill = await composer.inputValue();
  assert(prefill.includes(today) && prefill.includes(second.id));
  assert((await wb.getByLabel("Coach 讨论范围").innerText()).includes(today));
  await pause(700);
  await noModel();
  assert.deepEqual(
    await get(),
    beforePrefill,
    "Candidate entry only changes the UI composer and selection",
  );
  report.prefill = {
    text: prefill,
    scope: await wb.getByLabel("Coach 讨论范围").innerText(),
  };
  await shot("05-candidate-prefill-only");
  pass(
    "Prepare candidates opens Coach and prefills the actual summary/date, without sending or adopting",
  );

  const latest = await get(),
    currentTask = latest.tasks.find((task) => task.id === created.task.id),
    currentStep = latest.planning.steps.find(
      (step) => step.id === created.step.id,
    ),
    currentItem = latest.planning.dayItems.find(
      (item) => item.id === created.item.id,
    );
  const updatedText = "C03 现在改为核对前两行";
  await api("workbench_save_step", {
    taskId: currentTask.id,
    stepId: currentStep.id,
    itemId: currentItem.id,
    expectedTaskRevision: currentTask.revision,
    expectedStepRevision: currentStep.revision,
    expectedItemRevision: currentItem.revision,
    title: "C03 当前任务已改名",
    text: updatedText,
    category: currentTask.category,
    plannedSeconds: currentStep.plannedSeconds,
    expectedResult: currentStep.expectedResult,
    date: today,
    startMinute: currentItem.startMinute,
    durationMinutes: currentItem.durationMinutes,
  });
  const afterEdit = await daily();
  report.afterCurrentTaskEdit = afterEdit;
  const stored = (await get()).planning.summaries.find(
    (summary) => summary.id === second.id,
  );
  assert.deepEqual(stored.evidence, second.evidence);
  assert.deepEqual(stored.nextStart, second.nextStart);
  assert.equal(
    afterEdit.summaries.find((summary) => summary.id === second.id)
      .hasNewRecords,
    true,
  );
  assert.equal(
    (await get()).sessions[0].action.text,
    stepText,
    "Historical execution text must remain its actual start snapshot",
  );
  await refreshRecords(today);
  const oldStepSource = await openSource(second, created.step.id);
  assert((await oldStepSource.locator("dl").innerText()).includes(stepText));
  assert(
    !(await oldStepSource.locator("dl").innerText()).includes(updatedText),
  );
  await openSource(second, started.id);
  await summaryBox(second.id)
    .getByText(new RegExp(`当前步骤：${updatedText}`))
    .waitFor();
  assert(
    (await summaryBox(second.id).innerText()).includes(
      `当前步骤：${updatedText}`,
    ),
  );
  await shot("06-old-evidence-current-step");
  pass(
    "Editing current task/step makes the summary stale while saved step/session/manual/note evidence keeps its original data",
  );

  report.documents = await invoke("workbench_read_documents", { date: today });
  for (const document of report.documents.documents) {
    within(dataDir, document.path);
    if (document.exists)
      within(await realpath(dataDir), await realpath(document.path));
  }
  report.final = await get();
  report.capture = await probe();
  report.pageErrors = pageErrors;
  assert.equal(
    nowDate(),
    today,
    "Midnight invalidates this same-day acceptance scenario",
  );
  await noModel();
  assert.deepEqual(pageErrors, []);
  assert.equal(report.final.sessions.length, 1);
  assert(
    report.final.sessions.every((session) => session.status === "finished"),
  );
  assert.equal(report.final.planning.summaries.length, 2);
  report.desktopPassed = true;
  report.completedAt = new Date().toISOString();
  await writeReport();
  console.log(
    `PASS C03 native local-user acceptance; 0 model calls; evidence ${out}`,
  );
} catch (error) {
  report.errors.push({
    message: String(error),
    stack: error.stack,
    at: new Date().toISOString(),
  });
  report.pageErrors = pageErrors;
  if (wb) {
    report.capture = await probe().catch(() => null);
    report.modelCalls =
      report.capture?.commands?.filter(
        (command) => command.command === "workbench_send",
      ).length ?? 0;
    await shot("failure").catch(() => {});
  }
  if (get) report.failureState = await get().catch(() => null);
  throw error;
} finally {
  if (wb && invoke) {
    try {
      if (report.modelCalls) {
        await invoke("workbench_cancel");
        report.actions.push({
          actor: "harness-cleanup",
          action: "cancel-unexpected-model-request",
        });
      }
    } catch {}
    try {
      if (ownSessionId) {
        const current = (await get()).sessions.find(
          (session) => session.id === ownSessionId,
        );
        if (current?.status !== "finished")
          await api("finish_session", {
            sessionId: current.id,
            expectedRevision: current.revision,
            outcome: "stopped",
            output: null,
            blocker: null,
            nextCue: null,
          });
      }
    } catch (error) {
      report.errors.push({
        stage: "owned-session-cleanup",
        message: String(error),
      });
      report.desktopPassed = false;
    }
    try {
      await wb.evaluate(async () => {
        const probe = window.__c03Probe;
        if (!probe) return;
        window.fetch = probe.originalFetch;
        for (const { event, eventId, callback } of probe.listeners) {
          window.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener(
            event,
            eventId,
          );
          await window.__TAURI_INTERNALS__.invoke("plugin:event|unlisten", {
            event,
            eventId,
          });
          window.__TAURI_INTERNALS__.unregisterCallback?.(callback);
        }
        delete window.__c03Probe;
      });
    } catch {}
  }
  report.finishedAt = new Date().toISOString();
  await writeReport();
  await browser?.close();
}
