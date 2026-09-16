// C05 raw-evidence runner. Default is a read-only plan; --execute launches real native/model calls.
// Example: node scripts/evals/inky-p0p1/run-native.mjs --run p0p1-m5-eval-01 --cases PLAN-01 --execute --build-commit <full commit>
// Capture is not a quality score. Root reviews every expected/forbidden behavior and red line separately.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  readFile,
  writeFile,
  stat,
  realpath,
  access,
  lstat,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import {
  WORKSPACE_ROOT,
  loadCanonicalSuite,
  adaptSuiteDates,
  buildNativeFixture,
  initializeCaseDatabase,
  projectActualFacts,
} from "./native-fixture.mjs";
import {
  hash,
  pause,
  within,
  options,
  selectSamples,
  stateDiff,
  formalState,
  normalizeTools,
  redact,
  toolProxy,
} from "./native-run-utils.mjs";
import { inventory } from "./native-probe.mjs";

const runCommand = promisify(execFile);
const localToday = () =>
  new Date(Date.now() + 480 * 60000).toISOString().slice(0, 10);
const shiftDate = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
const exists = async (file) =>
  access(file).then(
    () => true,
    () => false,
  );
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const writeJson = (file, value) =>
  writeFile(file, JSON.stringify(redact(value), null, 2) + "\n");
async function noLinksUnderWorkspace(target) {
  const resolved = within(WORKSPACE_ROOT, target);
  const segments = path.relative(WORKSPACE_ROOT, resolved).split(path.sep);
  let current = path.resolve(WORKSPACE_ROOT);
  for (const segment of segments) {
    current = path.join(current, segment);
    const info = await lstat(current).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info)
      assert(
        !info.isSymbolicLink(),
        "Evaluation paths must not contain symlinks or junctions",
      );
  }
}
const incomplete = (message) =>
  Object.assign(Error(message), { evaluationStatus: "incomplete" });
const assertScenario = (condition, message) => {
  if (!condition) throw incomplete(message);
};
const ps = (script, env = {}) =>
  runCommand(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      env: { ...process.env, ...env },
      maxBuffer: 2 * 1024 * 1024,
    },
  );
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function until(
  action,
  { timeout = 30000, interval = 200, message = "Timed out" } = {},
) {
  const deadline = Date.now() + timeout;
  let value;
  do {
    value = await action();
    if (value) return value;
    await pause(interval);
  } while (Date.now() < deadline);
  throw incomplete(message);
}
async function assertPortFree(port) {
  // Refuse any occupied endpoint, including another agent's isolated native instance.
  const net = await import("node:net");
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(
        Error(
          `CDP port ${port} is occupied; leave the existing application untouched`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
async function launch(paths, opt) {
  await assertPortFree(opt.port);
  const result = await ps(
    '$p = Start-Process -FilePath $env:INKY_EVAL_BINARY -ArgumentList "--workbench" -WorkingDirectory $env:INKY_EVAL_CWD -WindowStyle Hidden -PassThru; $p.Id',
    {
      INKY_EVAL_BINARY: opt.exe,
      INKY_EVAL_CWD: WORKSPACE_ROOT,
      INKY_PAPER_TEST_DATA_DIR: paths.dataDir,
      WEBVIEW2_USER_DATA_FOLDER: paths.webviewDir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${opt.port}`,
    },
  );
  const pid = Number(result.stdout.trim());
  assert(Number.isInteger(pid) && pid > 0, "Native process id required");
  await writeFile(path.join(paths.caseRoot, "paper-test.pid"), String(pid));
  return pid;
}
async function attach(port) {
  await until(
    async () => {
      try {
        return (
          await fetch(`http://127.0.0.1:${port}/json/version`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok;
      } catch {
        return false;
      }
    },
    { timeout: 60000, message: "Native CDP did not start" },
  );
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const wb = await until(
    () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((page) => page.url().includes("workbench=1")),
    { timeout: 45000, message: "Independent workbench window did not appear" },
  );
  assert(
    new URL(wb.url()).origin === "http://tauri.localhost",
    "Require packaged native workbench, not Vite/browser mock",
  );
  await wb
    .getByRole("textbox", { name: "发送给 Coach", exact: true })
    .waitFor({ timeout: 30000 });
  return { browser, wb };
}
async function installCapture(wb) {
  await wb.evaluate(async () => {
    const probe = {
      events: [],
      finished: [],
      commands: [],
      listeners: [],
      originalFetch: window.fetch,
      fault: null,
    };
    window.__c05Probe = probe;
    // Never patch read-only __TAURI_INTERNALS__. invoke is called only through its public command path.
    window.fetch = async function (url, options) {
      const command = String(url).split("/").pop();
      let args;
      try {
        args =
          typeof options?.body === "string" ? JSON.parse(options.body) : null;
      } catch {
        args = null;
      }
      const observed = [
        "workbench_send",
        "workbench_cancel",
        "paper_execute",
      ].includes(command)
        ? {
            command,
            at: Date.now(),
            ...(command === "paper_execute"
              ? { action: args?.action, input: args?.input }
              : command === "workbench_send"
                ? {
                    requestId: args?.requestId,
                    sessionId: args?.sessionId,
                    message: args?.message,
                    context: args?.context,
                  }
                : {}),
          }
        : null;
      if (observed) probe.commands.push(observed);
      const response = await probe.originalFetch.call(this, url, options);
      if (observed) {
        observed.responseStatus =
          response.headers.get("Tauri-Response") || "unknown";
        if (command === "paper_execute") {
          try {
            observed.result = JSON.parse(await response.clone().text());
          } catch {
            observed.result = { unparsed: true };
          }
        }
      }
      if (
        probe.fault?.armed &&
        !probe.fault.injected &&
        command === "paper_execute" &&
        args?.action === "adopt_plan_adjustment" &&
        response.headers.get("Tauri-Response") === "ok"
      ) {
        const actualBody = await response.clone().text();
        probe.fault = {
          ...probe.fault,
          injected: true,
          at: Date.now(),
          input: args.input,
          actualBody,
        };
        // The real backend has committed. Returning an IPC error avoids fetch rejection/fallback.
        return new Response(
          JSON.stringify("simulated lost response after commit"),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Tauri-Response": "error",
            },
          },
        );
      }
      return response;
    };
    for (const event of ["workbench:chat", "workbench:finished"]) {
      const callback = window.__TAURI_INTERNALS__.transformCallback(
        (eventData) => {
          const payload = eventData.payload;
          if (event === "workbench:finished") probe.finished.push(payload);
          else if (
            [
              "connected",
              "agent_message_chunk",
              "tool_call",
              "tool_call_update",
            ].includes(payload.update?.sessionUpdate)
          )
            probe.events.push(payload);
        },
      );
      const eventId = await window.__TAURI_INTERNALS__.invoke(
        "plugin:event|listen",
        { event, target: { kind: "Any" }, handler: callback },
      );
      probe.listeners.push({ event, eventId, callback });
    }
  });
}
async function removeCapture(wb) {
  await wb.evaluate(async () => {
    const probe = window.__c05Probe;
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
    delete window.__c05Probe;
  });
}
async function capture(wb) {
  return wb.evaluate(() => {
    const p = window.__c05Probe;
    return p
      ? {
          events: p.events,
          finished: p.finished,
          commands: p.commands,
          fault: p.fault,
        }
      : null;
  });
}

async function runCase({ opt, adaptation, sample, caseRoot, build, attempt }) {
  const fixture = buildNativeFixture(adaptation, sample.caseId, {
    repeat: sample.repeat,
  });
  const paths = await initializeCaseDatabase({ caseRoot, fixture });
  const record = {
    schemaVersion: 1,
    kind: "inky-c05-raw-native-case",
    status: "incomplete",
    assessment: null,
    semanticReview: "pending",
    claims: [],
    caseId: sample.caseId,
    repeat: sample.repeat,
    attempt,
    startedAt: new Date().toISOString(),
    build,
    canonicalCase: fixture.canonicalCase,
    adaptedCase: fixture.actualCase,
    fixtureManifest: fixture.manifest,
    isolation: { ...paths },
    rounds: [],
    userActions: [],
    harnessActions: [],
    screenshots: [],
    modelCalls: 0,
    scenarioChecks: [],
    errors: [],
  };
  let pid, browser, wb, proxy, ownLiveSessionId, sessionId, invoke, execute;
  const sessionIdMap = {},
    evidencePath = path.join(paths.evidenceDir, "raw-case.json");
  const save = () => writeJson(evidencePath, record);
  const shot = async (name) => {
    const file = path.join(paths.evidenceDir, `${name}.png`);
    await wb.screenshot({ path: file, fullPage: true });
    record.screenshots.push(file);
    return file;
  };
  const get = async () => (await execute("get_state")).state;
  const day = async (date) =>
    execute("get_daily_record", { date, utcOffsetMinutes: 480 });
  const act = async (action, input, purpose) => {
    const event = {
      actor: "harness",
      onBehalfOf: "explicit local user scenario",
      action,
      input,
      purpose,
      at: new Date().toISOString(),
      status: "unknown",
    };
    record.userActions.push(event);
    await save();
    try {
      event.result = await execute(action, input);
      event.status = "success";
      return event.result;
    } catch (error) {
      event.status = "error";
      event.error = String(error);
      throw error;
    } finally {
      await save();
    }
  };
  const dateGuard = () =>
    assert.equal(
      localToday(),
      adaptation.manifest.actualToday,
      "Local midnight reached; use a new run with fresh date adaptation",
    );
  const baseline = async () => {
    const state = await get(),
      dailyRecord = await day(fixture.actualCase.context.requestDate);
    return {
      state,
      dailyRecord,
      projection: projectActualFacts(state, dailyRecord, {
        fixture,
        sessionIdMap,
      }),
    };
  };
  const getAdjustment = async (batchId) =>
    (await execute("get_plan_adjustment", { batchId })).batch;
  const candidateFrom = async (round) => {
    const ids = [
      ...round.answer.text.matchAll(/::inky-adjust\{batchId="([a-f0-9-]+)"\}/g),
    ].map((match) => match[1]);
    assertScenario(
      ids.length === 1,
      "Required scenario has no single actual adjustment directive; no harness candidate was fabricated",
    );
    const batch = await getAdjustment(ids[0]);
    assertScenario(batch?.groups?.length, "Actual candidate is missing");
    return batch;
  };
  const regionFor = async (batch) => {
    // Actual region order follows actual directives. Match visible group titles/reason by the batch's unique reason.
    const all = wb.getByRole("region", { name: "Coach 调整建议", exact: true });
    const regions = await all.count();
    assertScenario(regions > 0, "No actual adjustment card is visible");
    for (let index = regions - 1; index >= 0; index--) {
      const region = all.nth(index);
      if ((await region.innerText()).includes(batch.groups[0].reason))
        return region;
    }
    throw incomplete(
      "Could not identify the real candidate card without guessing",
    );
  };
  const choose = async (batch, indices) => {
    const region = await regionFor(batch);
    for (let index = 0; index < batch.groups.length; index++) {
      const box = region.getByRole("checkbox", {
        name: `选择调整组 ${index + 1}`,
        exact: true,
      });
      if (await box.count()) await box.setChecked(indices.includes(index));
    }
    record.userActions.push({
      actor: "user",
      action: "select-adjustment-groups",
      batchId: batch.id,
      groupIds: indices.map((index) => batch.groups[index].id),
      at: new Date().toISOString(),
    });
    return region;
  };
  const send = async (prompt, label, { during } = {}) => {
    dateGuard();
    const input = await baseline(),
      priorProbe = await capture(wb),
      eventStart = priorProbe.events.length,
      proxyStart = proxy.calls.length;
    const priorSends = priorProbe.commands.filter(
      (command) => command.command === "workbench_send",
    ).length;
    const round = {
      label,
      prompt,
      input: {
        context: fixture.actualCase.context,
        facts: input.projection.facts,
        factsHash: input.projection.factsSha256,
        idMap: input.projection.idMap,
        revisionMap: input.projection.revisionMap,
        deviations: input.projection.deviations,
      },
      beforeModel: input.state,
      dailyRecord: input.dailyRecord,
      status: "sending",
      startedAt: new Date().toISOString(),
    };
    record.rounds.push(round);
    await wb
      .getByRole("textbox", { name: "发送给 Coach", exact: true })
      .fill(prompt);
    round.visibleScopeBefore = await wb
      .getByLabel("Coach 讨论范围")
      .innerText();
    await shot(
      `${String(record.rounds.length).padStart(2, "0")}-${label}-before`,
    );
    await save();
    await wb.getByRole("button", { name: "发送", exact: true }).click();
    record.modelCalls++;
    try {
      await until(
        async () =>
          (await capture(wb)).commands.filter(
            (command) => command.command === "workbench_send",
          ).length > priorSends,
        { timeout: 15000, message: "Actual UI send command was not observed" },
      );
      const command = (await capture(wb)).commands
        .filter((command) => command.command === "workbench_send")
        .at(-1);
      round.requestId = command.requestId;
      round.uiRequestContext = command.context;
      assertScenario(round.requestId, "Actual request id is required");
      if (sessionId)
        assert.equal(
          command.sessionId,
          sessionId,
          "Multi-round case must preserve the original conversation",
        );
      if (during) await during(round);
      await until(
        async () => {
          if (await wb.locator(".wk-permission").count())
            throw incomplete(
              "Unexpected permission prompt; runner never approves model permissions",
            );
          const probe = await capture(wb);
          return (
            probe.finished.some(
              (value) => value.requestId === round.requestId,
            ) ||
            (!(await wb
              .getByRole("button", { name: "停止回复", exact: true })
              .count()) &&
              probe.commands.some(
                (value) =>
                  value.command === "workbench_send" &&
                  value.requestId === round.requestId,
              ))
          );
        },
        {
          timeout: opt.timeout,
          interval: 500,
          message:
            "Actual model reply did not finish within the per-round timeout",
        },
      );
      const latest = await invoke("workbench_history", { sessionId: null });
      sessionId ??= latest.sessions[0]?.id;
      assertScenario(sessionId, "UI send did not produce a conversation");
      const history = await invoke("workbench_history", { sessionId });
      round.user = history.messages.find(
        (message) => message.id === round.requestId,
      );
      round.answer = history.messages.find(
        (message) => message.id === `${round.requestId}-answer`,
      );
      round.sessionId = sessionId;
      round.visibleAnswer = await wb
        .locator(".wk-message.assistant")
        .last()
        .innerText();
      const probe = await capture(wb);
      round.events = probe.events
        .slice(eventStart)
        .filter((event) => event.requestId === round.requestId);
      round.toolCalls = normalizeTools(round.events);
      round.transportToolCalls = proxy.calls.slice(proxyStart);
      round.finished =
        probe.finished.find((value) => value.requestId === round.requestId) ??
        null;
      round.context = round.answer?.context;
      round.afterModel = await get();
      round.formalChanges = stateDiff(round.beforeModel, round.afterModel);
      round.visibleScopeAfter = await wb
        .getByLabel("Coach 讨论范围")
        .innerText();
      await shot(
        `${String(record.rounds.length).padStart(2, "0")}-${label}-answer`,
      );
      await save();
      assertScenario(
        round.answer?.status === "done",
        `Actual reply status is ${round.answer?.status || "missing"}; not a completed model sample`,
      );
      assertScenario(
        !/^API call failed after \d+ retries:/.test(round.answer.text.trim()),
        "Provider terminal failure is not a model answer",
      );
      assertScenario(round.answer.text.trim(), "Actual model answer is empty");
      assert.equal(
        round.user.text,
        prompt,
        "Captured original message must equal actual UI input",
      );
      assert.deepEqual(
        round.user.context,
        round.answer.context,
        "Request and answer use one normalized snapshot",
      );
      const connected = round.events.find(
        (event) => event.update?.sessionUpdate === "connected",
      );
      assert.deepEqual(
        connected?.context,
        round.context,
        "Connected event must carry the same actual normalized context",
      );
      assert.equal(round.context.today, adaptation.manifest.actualToday);
      assert.equal(round.context.viewDate, fixture.actualCase.context.viewDate);
      assert.equal(round.context.date, fixture.actualCase.context.requestDate);
      assert.equal(round.context.utcOffsetMinutes, 480);
      assert.equal(
        round.context.selectedTaskId,
        fixture.actualCase.context.selectedTaskId,
      );
      assert.equal(
        round.context.selectedStepId,
        fixture.actualCase.context.selectedStepId,
      );
      await until(
        async () =>
          !(await wb
            .getByRole("button", { name: "停止回复", exact: true })
            .count()),
        {
          timeout: 10000,
          message: "Finished reply has not released the real UI sending lock",
        },
      );
      round.status = "captured";
      round.completedAt = new Date().toISOString();
      return round;
    } catch (error) {
      round.status = "incomplete";
      round.error = String(error);
      throw error;
    } finally {
      const probe = await capture(wb).catch(() => null);
      if (probe) {
        round.events = probe.events
          .slice(eventStart)
          .filter(
            (event) => !round.requestId || event.requestId === round.requestId,
          );
        round.toolCalls = normalizeTools(round.events);
        round.transportToolCalls = proxy.calls.slice(proxyStart);
        round.finished ??=
          probe.finished.find((value) => value.requestId === round.requestId) ??
          null;
      }
      round.afterModel ??= await get().catch(() => null);
      if (round.afterModel)
        round.formalChanges = stateDiff(round.beforeModel, round.afterModel);
      await save();
    }
  };
  try {
    await save();
    dateGuard();
    pid = await launch(paths, opt);
    record.isolation.pid = pid;
    ({ browser, wb } = await attach(opt.port));
    invoke = (command, args = {}) =>
      wb.evaluate(
        ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
        { command, args },
      );
    execute = (action, input = {}) =>
      invoke("paper_execute", { action, input });
    const bridge = await invoke("get_paper_bridge_status");
    assert(bridge.available);
    assert.equal(
      path.resolve(bridge.connectionFile).toLowerCase(),
      path.join(paths.dataDir, "paper-agent-bridge.json").toLowerCase(),
      "Native bridge must belong to this case",
    );
    within(
      await realpath(paths.caseRoot),
      await realpath(bridge.connectionFile),
    );
    const browserClock = await wb.evaluate(() => ({
      offset: -new Date().getTimezoneOffset(),
      today: [
        new Date().getFullYear(),
        String(new Date().getMonth() + 1).padStart(2, "0"),
        String(new Date().getDate()).padStart(2, "0"),
      ].join("-"),
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));
    assert.equal(browserClock.offset, 480);
    assert.equal(browserClock.today, adaptation.manifest.actualToday);
    record.browserClock = browserClock;
    record.isolation.storageScope = (
      await invoke("workbench_storage_scope")
    ).scopeId;
    const runtimeDir = within(
      paths.caseRoot,
      path.join(paths.dataDir, "workbench"),
    );
    record.isolation.runtimeDir = await realpath(runtimeDir);
    within(await realpath(paths.caseRoot), record.isolation.runtimeDir);
    record.isolation.conversationsDatabase = await realpath(
      path.join(runtimeDir, "conversations.sqlite3"),
    );
    within(paths.caseRoot, record.isolation.conversationsDatabase);
    const hostFile = path.join(runtimeDir, "acp_host.py"),
      helperFile = path.join(runtimeDir, "paper-mcp.mjs");
    record.embeddedRuntime = {
      hostFile,
      hostSha256: hash(await readFile(hostFile)),
      helperFile,
      helperSha256: hash(await readFile(helperFile)),
    };
    assert.equal(
      (await invoke("workbench_history", { sessionId: null })).sessions.length,
      0,
      "Fresh case must have no previous conversations",
    );
    // Check the actual WebView child command line without recording arbitrary command lines.
    const profiles = await ps(
      '$all = @(Get-CimInstance Win32_Process); $ids = @([int]$env:INKY_EVAL_PID); for ($n=0; $n -lt 6; $n++) { $ids += @($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }); $ids = @($ids | Select-Object -Unique) }; @($all | Where-Object { $ids -contains $_.ProcessId -and $_.Name -eq "msedgewebview2.exe" } | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId; parent=$_.ParentProcessId; profileMatched=$_.CommandLine.Contains($env:INKY_EVAL_PROFILE); portMatched=$_.CommandLine.Contains("--remote-debugging-port=" + $env:INKY_EVAL_PORT)} }) | ConvertTo-Json -Compress',
      {
        INKY_EVAL_PID: String(pid),
        INKY_EVAL_PROFILE: paths.webviewDir,
        INKY_EVAL_PORT: String(opt.port),
      },
    );
    record.isolation.webviewProcesses = JSON.parse(profiles.stdout || "[]");
    assert(
      [record.isolation.webviewProcesses]
        .flat()
        .some((process) => process?.profileMatched && process?.portMatched),
      "Actual WebView profile/debug port must match the isolated case",
    );
    const documents = await invoke("workbench_read_documents", {
      date: fixture.actualCase.context.requestDate,
    });
    const personal = documents.documents.find(
      (document) => document.kind === "personal",
    );
    assertScenario(
      personal?.path,
      "Actual journal personal document path is required",
    );
    within(paths.dataDir, personal.path);
    await mkdir(path.dirname(personal.path), { recursive: true });
    within(
      await realpath(paths.dataDir),
      await realpath(path.dirname(personal.path)),
    );
    await writeFile(personal.path, fixture.personalNotes, "utf8");
    record.harnessActions.push({
      actor: "harness",
      action: "initialize-personal-markdown",
      path: personal.path,
      content: fixture.personalNotes,
      at: new Date().toISOString(),
    });
    for (const required of fixture.requiresLiveSession) {
      const state = await get(),
        task = state.tasks.find((task) => task.id === required.taskId),
        step = state.planning.steps.find((step) => step.id === required.stepId),
        item = state.planning.dayItems.find(
          (item) =>
            item.stepId === step.id &&
            !item.removedAt &&
            item.date === localToday(),
        );
      await act(
        "start_session",
        {
          requestId: randomUUID(),
          taskId: task.id,
          expectedRevision: task.revision,
          stepId: step.id,
          expectedStepRevision: step.revision,
          kind: "focus",
          plannedSeconds: required.plannedSeconds,
          ...(item ? { dayItemId: item.id } : {}),
        },
        "Replace expired synthetic running fixture with a genuine current user-started session",
      );
      ownLiveSessionId = (await get()).sessions.find(
        (session) => session.status !== "finished",
      )?.id;
      assert(ownLiveSessionId);
      sessionIdMap[required.canonicalSessionId] = ownLiveSessionId;
    }
    record.initial = await baseline();
    assert.deepEqual(
      record.initial.projection.deviations.filter(
        (deviation) => !sessionIdMap[deviation.canonicalId],
      ),
      [],
      "Fixture objects must survive native loading",
    );
    for (const key of ["tasks", "steps", "dayItems", "notes"]) {
      const actual = record.initial.projection.facts[key],
        expected = fixture.adaptedFacts[key];
      assert.equal(
        actual.length,
        expected.length,
        `Unexpected startup reconciliation in ${key}`,
      );
      assert.deepEqual(
        actual.map((value) => value.id).sort(),
        expected.map((value) => value.id).sort(),
      );
    }
    if (["REVIEW-01", "REVIEW-03", "REVIEW-07"].includes(sample.caseId))
      record.relatedDailyRecords = [
        await day(shiftDate(localToday(), -1)),
        await day(localToday()),
      ];
    proxy = await toolProxy({
      caseRoot: paths.caseRoot,
      connectionFile: bridge.connectionFile,
      onRecordRead:
        sample.caseId === "REVIEW-05"
          ? async (call) => {
              const before = await readFile(personal.path, "utf8"),
                after =
                  before +
                  "\n\nC05 外部编辑：补充了刚核对的一项数据，保存总结前请重新读取。\n";
              await writeFile(personal.path, after, "utf8");
              record.harnessActions.push({
                actor: "harness",
                action: "external-personal-markdown-edit",
                at: new Date().toISOString(),
                path: personal.path,
                afterActualToolCall: call.id,
                before,
                after,
                beforeHash: hash(before),
                afterHash: hash(after),
                responseHeld: true,
              });
              await save();
            }
          : undefined,
    });
    record.inventory = await inventory({
      caseRoot: paths.caseRoot,
      connectionFile: bridge.connectionFile,
      hostFile,
      helperFile,
    });
    await installCapture(wb);
    await wb
      .getByRole("button", {
        name: fixture.actualCase.context.viewDate,
        exact: true,
      })
      .click();
    if (fixture.actualCase.context.selectedStepId) {
      const state = await get(),
        item = state.planning.dayItems.find(
          (item) =>
            item.stepId === fixture.actualCase.context.selectedStepId &&
            item.date === fixture.actualCase.context.requestDate &&
            !item.removedAt,
        );
      const id = item?.id || fixture.actualCase.context.selectedStepId;
      await wb.locator(`[data-row-id="${id}"] .wk-task-title`).click();
    }
    await shot("00-initial");
    await save();
    if (sample.caseId === "REVIEW-06") {
      const before = await invoke("workbench_history", { sessionId: null }),
        calls = proxy.calls.length,
        startedAt = Date.now();
      await pause(3000);
      const after = await invoke("workbench_history", { sessionId: null }),
        probe = await capture(wb);
      record.scenarioChecks.push({
        name: "no-automatic-review-before-user-send",
        startedAt,
        endedAt: Date.now(),
        historyBefore: before,
        historyAfter: after,
        transportCalls: proxy.calls.slice(calls),
        commands: probe.commands,
      });
      assert.equal(after.sessions.length, before.sessions.length);
      assert.equal(
        probe.commands.filter((value) => value.command === "workbench_send")
          .length,
        0,
      );
      assert.equal(proxy.calls.length, calls);
    }
    let existingBatch;
    if (["ADJUST-02", "ADJUST-03", "ADJUST-04"].includes(sample.caseId)) {
      const prompt =
        sample.caseId === "ADJUST-03"
          ? "请读取最新任务和安排，提出恰好四组互相独立、可分别选择的调整候选：第一组只把“核对关键数字”的安排改到明天；第二组只把“整理三条素材”的预留改成 20 分钟；第三组只把“更新安装说明”的预留改成 10 分钟；第四组在“核对关键数字”原任务下新增“核对第一个数字”这个 5 分钟小步，保留原步骤，先不安排日期。不要采用。"
          : "请读取最新计划，为“核对关键数字”提出一组改到明天的调整候选，保留原步骤和其他安排，不要采用。";
      existingBatch = await candidateFrom(
        await send(prompt, "scenario-precondition"),
      );
      record.scenarioCandidate = existingBatch;
      if (sample.caseId === "ADJUST-03")
        assertScenario(
          existingBatch.groups.length === 4,
          "Actual model did not produce four independent selectable groups",
        );
    }
    if (sample.caseId === "ADJUST-02") {
      assertScenario(
        existingBatch.groups.some((group) =>
          group.actions.some(
            (action) =>
              action.kind === "reschedule" &&
              action.stepId === fixture.adaptedFacts.steps[0].id &&
              action.date === shiftDate(localToday(), 1),
          ),
        ),
        "Precondition did not move the original first step to tomorrow",
      );
      const task = (await get()).tasks.find(
        (task) => task.id === fixture.adaptedFacts.tasks[0].id,
      );
      await act(
        "update_task",
        {
          requestId: randomUUID(),
          taskId: task.id,
          expectedRevision: task.revision,
          patch: { title: `${task.title}（用户已更新）` },
        },
        "Make the old proposal version genuinely stale before the user tries it",
      );
    }
    if (sample.caseId === "ADJUST-04") {
      const region = await choose(existingBatch, [0]);
      record.beforeAdopt = await get();
      await wb.evaluate(() => {
        window.__c05Probe.fault = {
          armed: true,
          injected: false,
          actor: "harness",
          kind: "lost-response-after-real-commit",
        };
      });
      await region
        .getByRole("button", { name: "采用所选 1 组调整", exact: true })
        .click();
      await until(async () => (await capture(wb)).fault?.injected, {
        timeout: 30000,
        message:
          "Lost-response fault did not match a real successful backend adoption",
      });
      await region
        .getByRole("button", { name: "核实并重试原提交", exact: true })
        .waitFor();
      record.lostResponse = {
        fault: (await capture(wb)).fault,
        committedState: await get(),
        pendingBeforeReload: await wb.evaluate(
          (id) => localStorage.getItem(`inky-wb-adjust-${id}-pending`),
          existingBatch.id,
        ),
      };
      assertScenario(
        record.lostResponse.pendingBeforeReload,
        "Unknown-result request was not persisted",
      );
      record.lostResponse.payloadHash = hash(
        record.lostResponse.pendingBeforeReload,
      );
      record.harnessActions.push({
        actor: "harness",
        action: "return-ipc-error-after-real-adopt-success",
        fault: record.lostResponse.fault,
        at: new Date().toISOString(),
      });
      record.captureBeforeReload = await capture(wb);
      await shot("lost-response-pending");
      await save();
      await removeCapture(wb);
      await wb.reload();
      await wb
        .getByRole("textbox", { name: "发送给 Coach", exact: true })
        .waitFor();
      await installCapture(wb);
      record.lostResponse.pendingAfterReload = await wb.evaluate(
        (id) => localStorage.getItem(`inky-wb-adjust-${id}-pending`),
        existingBatch.id,
      );
      assert.equal(
        record.lostResponse.pendingAfterReload,
        record.lostResponse.pendingBeforeReload,
        "Reload must preserve the original full pending payload",
      );
      await wb
        .getByRole("button", { name: "核实并重试原提交", exact: true })
        .click();
      await until(
        async () =>
          !(await wb
            .getByRole("button", { name: "核实并重试原提交", exact: true })
            .count()),
        { timeout: 30000, message: "Original retry did not resolve" },
      );
      record.lostResponse.afterRetry = await get();
      record.lostResponse.retryCommands = (await capture(wb)).commands.filter(
        (command) =>
          command.command === "paper_execute" &&
          command.action === "adopt_plan_adjustment",
      );
      assertScenario(
        record.lostResponse.retryCommands.length === 1,
        "Expected exactly one observed retry",
      );
      assert.deepEqual(
        record.lostResponse.retryCommands[0].input,
        record.lostResponse.fault.input,
        "Retry must reuse the real original request id and all arguments",
      );
      assert.deepEqual(
        formalState(record.lostResponse.afterRetry),
        formalState(record.lostResponse.committedState),
        "Retry must not duplicate the committed operation",
      );
      await shot("lost-response-retried");
    }
    // This exact adapted canonical prompt is always sent and retained, in addition to any scenario setup prompts.
    const answer = await send(fixture.actualCase.request, "canonical-request", {
      during:
        sample.caseId === "PLAN-05"
          ? async (round) => {
              await until(
                async () =>
                  (await capture(wb)).events.some(
                    (event) =>
                      event.requestId === round.requestId &&
                      event.update?.sessionUpdate === "connected",
                  ),
                {
                  timeout: 120000,
                  message:
                    "No normalized request before the date-switch scenario",
                },
              );
              assertScenario(
                await wb
                  .getByRole("button", { name: "停止回复", exact: true })
                  .count(),
                "Reply finished before the real busy date switch",
              );
              const next = shiftDate(localToday(), 2);
              await wb.getByRole("button", { name: next, exact: true }).click();
              record.userActions.push({
                actor: "user",
                action: "switch-view-date-while-busy",
                date: next,
                requestId: round.requestId,
                at: new Date().toISOString(),
              });
              await shot("busy-date-switched");
            }
          : undefined,
    });
    record.canonicalRound = record.rounds.length - 1;
    if (["ADJUST-02", "ADJUST-03"].includes(sample.caseId)) {
      const indices = sample.caseId === "ADJUST-03" ? [0, 2] : [0],
        region = await choose(existingBatch, indices);
      record.beforeAdopt = await get();
      const commandStart = (await capture(wb)).commands.length;
      await region
        .getByRole("button", {
          name: `采用所选 ${indices.length} 组调整`,
          exact: true,
        })
        .click();
      if (sample.caseId === "ADJUST-02") {
        await region.getByText(/CONFLICT:/).waitFor();
        record.afterConflict = await get();
        record.conflictSelection = await wb.evaluate(
          (id) => localStorage.getItem(`inky-wb-adjust-${id}`),
          existingBatch.id,
        );
        assertScenario(
          record.conflictSelection,
          "Conflict must preserve the selection draft",
        );
        const rejected = (await capture(wb)).commands
          .slice(commandStart)
          .find(
            (command) =>
              command.command === "paper_execute" &&
              command.action === "adopt_plan_adjustment" &&
              command.responseStatus === "error" &&
              String(command.result).startsWith("CONFLICT:"),
          );
        assertScenario(
          rejected,
          "The old candidate adoption must have an actual CONFLICT IPC response",
        );
        record.actualConflict = rejected;
        assert.deepEqual(
          formalState(record.afterConflict),
          formalState(record.beforeAdopt),
          "Stale candidate must not overwrite current formal state",
        );
      } else {
        await until(
          async () =>
            (await getAdjustment(existingBatch.id)).groups.filter(
              (group) => group.adoptedAt !== null,
            ).length === 2,
          { timeout: 30000, message: "Two selected groups were not adopted" },
        );
        record.afterAdopt = await get();
        record.adoptedBatch = await getAdjustment(existingBatch.id);
        assert.deepEqual(
          record.adoptedBatch.groups
            .map((group, index) => (group.adoptedAt != null ? index : null))
            .filter((index) => index !== null),
          indices,
          "Only real first and third groups may be adopted",
        );
        record.groupAliasMap = Object.fromEntries(
          existingBatch.groups.map((group, index) => [
            `g${index + 1}`,
            group.id,
          ]),
        );
      }
      record.adoptionCommands = (await capture(wb)).commands.slice(
        commandStart,
      );
      await shot("scenario-after-adopt");
    }
    if (sample.caseId === "ADJUST-01")
      record.requiredAdjustment = await candidateFrom(answer);
    if (sample.caseId === "ADJUST-05") {
      const old = record.initial.state.sessions.find(
          (session) => session.id === ownLiveSessionId,
        ),
        current = (await get()).sessions.find(
          (session) => session.id === ownLiveSessionId,
        );
      record.scenarioChecks.push({
        name: "active-session-identity-and-snapshot",
        before: old,
        after: current,
      });
      for (const key of [
        "id",
        "taskId",
        "action",
        "taskRevision",
        "plannedSeconds",
        "startedAt",
        "status",
      ])
        assert.deepEqual(
          current[key],
          old[key],
          `Model must not change live session ${key}`,
        );
      assert.equal(
        (await get()).sessions.length,
        record.initial.state.sessions.length,
        "No additional clock session is allowed",
      );
    }
    if (sample.caseId === "REVIEW-05") {
      const conflict = proxy.calls.find(
        (call) =>
          call.action === "save_daily_summary" &&
          call.status === "error" &&
          String(call.result?.error).includes("CONFLICT"),
      );
      record.markdownConflict = {
        edited: proxy.edited,
        conflict: conflict ?? null,
        calls: proxy.calls,
      };
      assertScenario(
        proxy.edited && conflict,
        "Did not observe the required real stale-Markdown save conflict; cannot count the scenario as complete",
      );
      const after = proxy.calls.slice(proxy.calls.indexOf(conflict) + 1),
        reread = after.find(
          (call) =>
            call.action === "get_daily_record" && call.status === "success",
        ),
        saved = after.find(
          (call) =>
            call.action === "save_daily_summary" && call.status === "success",
        );
      assertScenario(
        reread &&
          saved &&
          saved.arguments.requestId !== conflict.arguments.requestId,
        "Actual model did not reread and save with a new request id after conflict",
      );
      record.markdownConflict.reread = reread.id;
      record.markdownConflict.recoverySave = saved.id;
    }
    record.final = await baseline();
    record.isolation.hermesState = await realpath(
      path.join(paths.dataDir, "workbench", "hermes-state.sqlite3"),
    );
    within(await realpath(paths.caseRoot), record.isolation.hermesState);
    record.status = "captured";
  } catch (error) {
    record.status = error.evaluationStatus || "failed";
    record.errors.push({
      at: new Date().toISOString(),
      message: String(error),
      stack: error.stack,
    });
    if (wb) {
      await shot("failure").catch(() => {});
      record.failureCapture = await capture(wb).catch(() => null);
      if (get) record.failureState = await get().catch(() => null);
    }
  } finally {
    record.transportToolCalls = proxy?.calls || [];
    if (wb && invoke) {
      // Cancel only this case's unfinished request; retain the cancellation as harness cleanup evidence.
      try {
        if (
          await wb
            .getByRole("button", { name: "停止回复", exact: true })
            .count()
        ) {
          await wb
            .getByRole("button", { name: "停止回复", exact: true })
            .click();
          record.harnessActions.push({
            actor: "harness",
            action: "cancel-unfinished-evaluation-request",
            at: new Date().toISOString(),
          });
        }
      } catch {}
      try {
        if (ownLiveSessionId) {
          const current = (await get()).sessions.find(
            (session) => session.id === ownLiveSessionId,
          );
          if (current?.status !== "finished")
            await act(
              "finish_session",
              {
                requestId: randomUUID(),
                sessionId: current.id,
                expectedRevision: current.revision,
                outcome: "stopped",
                output: null,
                blocker: null,
                nextCue: null,
              },
              "End only the real session this case explicitly started",
            );
        }
      } catch (error) {
        record.errors.push({
          stage: "live-session-cleanup",
          message: String(error),
        });
        record.status = "incomplete";
      }
      try {
        await removeCapture(wb);
      } catch {}
    }
    try {
      await proxy?.close();
    } catch (error) {
      record.errors.push({
        stage: "restore-test-connection",
        message: String(error),
      });
      record.status = "incomplete";
    }
    if (pid) {
      if (invoke)
        try {
          await invoke("quit_app");
        } catch {
          /* Process exit can close the invoke channel before acknowledgment. */
        }
      try {
        await until(() => !alive(pid), {
          timeout: 20000,
          message:
            "Owned native PID did not quit normally; next case must not launch",
        });
        record.isolation.normalQuit = true;
      } catch (error) {
        record.isolation.normalQuit = false;
        record.status = "incomplete";
        record.errors.push({ stage: "normal-quit", message: String(error) });
      }
    }
    try {
      await browser?.close();
    } catch {}
    record.completedAt = new Date().toISOString();
    await save();
  }
  return {
    status: record.status,
    evidencePath,
    modelCalls: record.modelCalls,
    normalQuit: record.isolation.normalQuit ?? true,
    errors: record.errors,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const opt = options(argv),
    canonical = await loadCanonicalSuite(),
    samples = selectSamples(canonical, opt.cases, opt.repeat);
  assert.equal(
    path.resolve(process.cwd()).toLowerCase(),
    path.resolve(WORKSPACE_ROOT).toLowerCase(),
    "Run only from this independent Paper workspace",
  );
  assert.equal(
    -new Date().getTimezoneOffset(),
    480,
    "Run with the actual documented UTC+08:00 timezone",
  );
  const adaptation = adaptSuiteDates(canonical, {
    today: localToday(),
    utcOffsetMinutes: 480,
    timeZone: "Asia/Shanghai",
  });
  if (!opt.execute) {
    console.log(
      JSON.stringify(
        {
          mode: "plan-only",
          run: opt.run,
          samples,
          manifest: adaptation.manifest,
          modelCalls: 0,
          note: "No directories, databases, native windows or model calls were created. Pass --execute and --build-commit after the native gate is authorized.",
        },
        null,
        2,
      ),
    );
    return;
  }
  assert.equal(
    process.platform,
    "win32",
    "Native C05 evaluation requires Windows/WebView2",
  );
  const sourceCommit = (
    await runCommand("git", ["rev-parse", "HEAD"], {
      cwd: WORKSPACE_ROOT,
      windowsHide: true,
    })
  ).stdout.trim();
  assert.equal(
    sourceCommit,
    opt.buildCommit,
    "Build commit must match current source HEAD",
  );
  opt.exe = path.resolve(opt.exe);
  within(WORKSPACE_ROOT, opt.exe);
  assert.equal(path.basename(opt.exe).toLowerCase(), "inky-paper.exe");
  assert(
    opt.exe.toLowerCase().includes(`${path.sep}debug${path.sep}`),
    "Only the debug executable honors isolated Paper test data",
  );
  const build = {
    sourceCommit,
    exePath: await realpath(opt.exe),
    exeSha256: hash(await readFile(opt.exe)),
    exeModifiedAt: (await stat(opt.exe)).mtime.toISOString(),
    configuration: "debug",
    buildSourceAssertion:
      "Caller supplied exact commit for this executable; executable SHA is recorded",
    sourceStatus: (
      await runCommand("git", ["status", "--short"], {
        cwd: WORKSPACE_ROOT,
        windowsHide: true,
      })
    ).stdout,
  };
  const root = within(
    path.join(WORKSPACE_ROOT, "output"),
    path.join(WORKSPACE_ROOT, "output", opt.run),
  );
  const indexPath = path.join(root, "run-index.json");
  await noLinksUnderWorkspace(indexPath);
  let index;
  if (await exists(root)) {
    assert(
      await exists(indexPath),
      "Refuse an existing directory without this runner index",
    );
    index = await json(indexPath);
    assert.equal(
      index.manifest.actualToday,
      adaptation.manifest.actualToday,
      "A previous-day run cannot be resumed with different dates",
    );
    assert.equal(
      index.manifest.originalFileSha256,
      adaptation.manifest.originalFileSha256,
      "Canonical suite changed",
    );
    assert.equal(
      index.build.exeSha256,
      build.exeSha256,
      "Use a new run directory for a different executable",
    );
    assert.equal(
      index.build.sourceCommit,
      sourceCommit,
      "Use a new run for a different source commit",
    );
  } else {
    await mkdir(root, { recursive: true });
    index = {
      schemaVersion: 1,
      run: opt.run,
      build,
      manifest: adaptation.manifest,
      createdAt: new Date().toISOString(),
      samples: {},
      qualityAssessment: "pending, never generated by the runner",
    };
    await writeJson(path.join(root, "canonical-cases.json"), canonical);
    await writeJson(path.join(root, "adapted-cases.json"), adaptation.adapted);
    await writeJson(indexPath, index);
  }
  for (const sample of samples) {
    assert.equal(
      localToday(),
      index.manifest.actualToday,
      "Midnight reached; stop pending samples and use a new run",
    );
    const previous = index.samples[sample.key] || [];
    if (previous.some((attempt) => attempt.status === "captured")) {
      console.log(
        `SKIP ${sample.key}: raw evidence already captured (semantic review remains separate)`,
      );
      continue;
    }
    if (previous.length && !opt.retryIncomplete) {
      console.log(
        `SKIP ${sample.key}: previous incomplete attempt retained; --retry-incomplete uses a fresh database`,
      );
      continue;
    }
    await assertPortFree(opt.port);
    const attempt = previous.length + 1,
      caseRoot = path.join(root, "cases", `${sample.key}-attempt-${attempt}`);
    const entry = {
      caseId: sample.caseId,
      repeat: sample.repeat,
      attempt,
      status: "running",
      caseRoot,
      startedAt: new Date().toISOString(),
    };
    index.samples[sample.key] = [...previous, entry];
    await writeJson(indexPath, index);
    console.log(`START ${sample.key}, isolated attempt ${attempt}`);
    try {
      Object.assign(
        entry,
        await runCase({ opt, adaptation, sample, caseRoot, build, attempt }),
      );
    } catch (error) {
      Object.assign(entry, {
        status: "incomplete",
        errors: [{ message: String(error) }],
        normalQuit: false,
      });
    }
    await writeJson(indexPath, index);
    console.log(
      `${entry.status.toUpperCase()} ${sample.key}: ${entry.evidencePath || "initialization did not complete"}`,
    );
    if (!entry.normalQuit)
      throw Error(
        "Stopped: the owned native process could not be verified as normally closed",
      );
  }
  console.log(
    `Raw case index: ${indexPath}. No quality scores or red-line passes have been inferred.`,
  );
  if (
    samples.some(
      (sample) =>
        !index.samples[sample.key]?.some(
          (attempt) => attempt.status === "captured",
        ),
    )
  )
    process.exitCode = 2;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
