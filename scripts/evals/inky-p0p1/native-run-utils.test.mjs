// Pure orchestration tests. The loopback server below is a unit-test stub, not model evidence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  options,
  selectSamples,
  within,
  formalState,
  stateDiff,
  normalizeTools,
  redact,
  toolProxy,
} from "./native-run-utils.mjs";
import { loadCanonicalSuite } from "./native-fixture.mjs";

test("canonical selection is 24 independent cases plus exactly six designated repeats", async () => {
  const suite = await loadCanonicalSuite(),
    samples = selectSamples(suite);
  assert.equal(samples.length, 30);
  assert.equal(samples.filter((sample) => sample.repeat === 1).length, 24);
  assert.deepEqual(
    samples
      .filter((sample) => sample.repeat === 2)
      .map((sample) => sample.caseId),
    ["PLAN-01", "PLAN-05", "ADJUST-01", "ADJUST-04", "REVIEW-01", "REVIEW-04"],
  );
  assert.deepEqual(selectSamples(suite, "PLAN-01", "2"), [
    { caseId: "PLAN-01", repeat: 2, key: "PLAN-01-r2" },
  ]);
  assert.throws(() => selectSamples(suite, "PLAN-02", "2"), /not a designated/);
  assert.throws(
    () => selectSamples(suite, "PLAN-01", "3"),
    /canonical indices/,
  );
  assert.throws(() => selectSamples(suite, "PLAN-01,PLAN-01"), /Duplicate/);
  assert.throws(() => selectSamples(suite, "OTHER"), /Unknown/);
});

test("execute requires an explicit build commit and otherwise remains plan-only", () => {
  assert.equal(options(["--run", "p0p1-m5-eval-unit"]).execute, false);
  assert.throws(
    () => options(["--run", "p0p1-m5-eval-unit", "--execute"]),
    /commit/,
  );
  assert.equal(
    options([
      "--run",
      "p0p1-m5-eval-unit",
      "--execute",
      "--build-commit",
      "a".repeat(40),
    ]).execute,
    true,
  );
  assert.throws(() => options(["--run", "../formal"]), /match/);
  assert.throws(
    () => options(["--run", "p0p1-m5-eval-unit", "--repeat"]),
    /Missing/,
  );
});

test("path guard refuses sibling, root and traversal paths", () => {
  const root = path.resolve("output/p0p1-m5-eval-unit/cases/PLAN-01-r1");
  assert.equal(
    within(root, path.join(root, "evidence", "raw.json")),
    path.join(root, "evidence", "raw.json"),
  );
  assert.throws(() => within(root, root));
  assert.throws(() =>
    within(root, path.resolve(root, "../formal/paper.sqlite3")),
  );
});

test("formal diff separates candidate/summaries from task and history changes", () => {
  const before = {
    tasks: [{ id: "a", title: "before" }],
    sessions: [],
    notes: [],
    planning: { steps: [], dayItems: [], adjustments: [], summaries: [] },
  };
  const candidates = structuredClone(before);
  candidates.planning.adjustments.push({ id: "candidate" });
  candidates.planning.summaries.push({ id: "summary" });
  assert.deepEqual(formalState(candidates), formalState(before));
  assert.deepEqual(stateDiff(before, candidates), []);
  candidates.tasks[0].title = "after";
  candidates.planning.dayItems.push({ id: "item", date: "2026-09-16" });
  assert.deepEqual(
    stateDiff(before, candidates).map((change) => [
      change.operation,
      change.objectType,
      change.objectId,
    ]),
    [
      ["update", "tasks", "a"],
      ["create", "dayItems", "item"],
    ],
  );
});

test("visible tool normalization preserves unknown completion and explicit failed result", () => {
  const events = [
    {
      requestId: "r",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t",
        title: "read",
        rawInput: { date: "today" },
      },
    },
    {
      requestId: "r",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "t",
        status: "in_progress",
      },
    },
    {
      requestId: "r",
      update: { sessionUpdate: "tool_call", toolCallId: "u", title: "save" },
    },
    {
      requestId: "r",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "u",
        status: "failed",
        rawOutput: { error: "CONFLICT" },
      },
    },
    {
      requestId: "r",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { text: "not collected" },
      },
    },
  ];
  const calls = normalizeTools(events);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].status, "unknown");
  assert.equal(calls[1].status, "error");
  assert.deepEqual(calls[1].result, { error: "CONFLICT" });
});

test("evidence serialization removes authentication fields and bearer strings", () => {
  assert.deepEqual(
    redact({
      token: "unit-secret",
      nested: { Authorization: "Bearer abc", text: "Bearer foo.bar-123" },
      headers: { x: "secret" },
      requestId: "keep",
    }),
    {
      token: "[redacted]",
      nested: { Authorization: "[redacted]", text: "Bearer [redacted]" },
      headers: "[redacted]",
      requestId: "keep",
    },
  );
});

test("isolated tool proxy preserves real bytes, holds one read for a local edit, then restores connection", async () => {
  const workspace = fileURLToPath(new URL("../../../", import.meta.url)),
    output = path.join(workspace, "output");
  await mkdir(output, { recursive: true });
  const root = await mkdtemp(path.join(output, "p0p1-m5-eval-unit-")),
    caseRoot = path.join(root, "cases", "REVIEW-05-r1");
  await mkdir(caseRoot, { recursive: true });
  const connectionFile = path.join(caseRoot, "paper-agent-bridge.json");
  const bytes =
    ' { "data": { "date": "2026-09-16", "notesVersion": "old" } }\n';
  let forwarded = 0,
    edits = 0,
    proxy;
  const bridge = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    assert.deepEqual(JSON.parse(body), { date: "2026-09-16" });
    assert.equal(request.headers.authorization, "Bearer unit-test-secret");
    forwarded++;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(bytes);
  });
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  const original = JSON.stringify({
    app: "inky-paper",
    protocolVersion: 1,
    url: `http://127.0.0.1:${bridge.address().port}`,
    token: "unit-test-secret",
  });
  await writeFile(connectionFile, original);
  try {
    proxy = await toolProxy({
      caseRoot,
      connectionFile,
      onRecordRead: async (call) => {
        assert.equal(call.result.notesVersion, "old");
        edits++;
        await writeFile(path.join(caseRoot, "personal.md"), "new notes");
      },
    });
    const connection = JSON.parse(await readFile(connectionFile, "utf8"));
    for (let index = 0; index < 2; index++) {
      const response = await fetch(`${connection.url}/get_daily_record`, {
        method: "POST",
        headers: {
          Authorization: "Bearer unit-test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ date: "2026-09-16" }),
      });
      assert.equal(await response.text(), bytes);
      assert.equal(
        await readFile(path.join(caseRoot, "personal.md"), "utf8"),
        "new notes",
      );
    }
    assert.equal(forwarded, 2);
    assert.equal(edits, 1);
    assert.equal(proxy.calls.length, 2);
    assert.equal(proxy.calls[0].responseHeldForMarkdownEdit, true);
    assert(!JSON.stringify(proxy.calls).includes("unit-test-secret"));
    await proxy.close();
    proxy = null;
    assert.equal(await readFile(connectionFile, "utf8"), original);
  } finally {
    await proxy?.close();
    await new Promise((resolve) => bridge.close(resolve));
    // This path came from mkdtemp in this workspace and is checked before recursive cleanup.
    within(output, root);
    assert(path.basename(root).startsWith("p0p1-m5-eval-unit-"));
    await rm(root, { recursive: true });
  }
});

test("tool proxy rejects a connection outside its case before reading or modifying it", async () => {
  const root = path.resolve("output/p0p1-m5-eval-unit/cases/a");
  await assert.rejects(
    toolProxy({
      caseRoot: root,
      connectionFile: path.resolve("output/formal-connection.json"),
    }),
    /inside the isolated case/,
  );
});
