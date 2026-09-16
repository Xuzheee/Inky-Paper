import assert from "node:assert/strict";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, realpath } from "node:fs/promises";
import { createServer } from "node:http";

export const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
export const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
export function within(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  assert(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    `Path must remain inside the isolated case: ${target}`,
  );
  return path.resolve(target);
}
export function options(argv) {
  const parsed = {
    run: null,
    cases: null,
    repeat: "auto",
    execute: false,
    retryIncomplete: false,
    port: 9254,
    timeout: 600000,
    exe: path.resolve("src-tauri/target/debug/inky-paper.exe"),
    buildCommit: null,
  };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === "--execute") parsed.execute = true;
    else if (key === "--retry-incomplete") parsed.retryIncomplete = true;
    else if (
      [
        "--run",
        "--cases",
        "--repeat",
        "--port",
        "--timeout",
        "--exe",
        "--build-commit",
      ].includes(key)
    ) {
      const value = argv[++index];
      assert(value && !value.startsWith("--"), `Missing value for ${key}`);
      parsed[{ "--build-commit": "buildCommit" }[key] || key.slice(2)] = value;
    } else throw Error(`Unknown argument ${key}`);
  }
  assert.match(parsed.run || "", /^p0p1-m5-eval-[A-Za-z0-9_-]+$/);
  parsed.port = Number(parsed.port);
  parsed.timeout = Number(parsed.timeout);
  assert(
    Number.isInteger(parsed.port) && parsed.port > 1024 && parsed.port < 65536,
  );
  assert(
    Number.isInteger(parsed.timeout) &&
      parsed.timeout >= 1000 &&
      parsed.timeout <= 1800000,
  );
  if (parsed.execute)
    assert.match(
      parsed.buildCommit || "",
      /^[a-f0-9]{40}$/,
      "Pass the full commit used for the debug build",
    );
  return parsed;
}
export function selectSamples(dataset, selectedIds, repeat = "auto") {
  const ids = selectedIds
    ? selectedIds.split(",")
    : dataset.cases.map((item) => item.id);
  assert(new Set(ids).size === ids.length, "Duplicate --cases ids");
  assert(
    ids.every((id) => dataset.cases.some((item) => item.id === id)),
    "Unknown --cases id",
  );
  const repeats = repeat === "auto" ? null : repeat.split(",").map(Number);
  if (repeats)
    assert(
      repeats.length &&
        new Set(repeats).size === repeats.length &&
        repeats.every((n) => n === 1 || n === 2),
      "--repeat must use canonical indices 1 and/or 2",
    );
  return ids.flatMap((id) => {
    const item = dataset.cases.find((value) => value.id === id);
    if (repeats?.includes(2))
      assert(item.repeatSample, `${id} is not a designated repeat sample`);
    return (repeats || (item.repeatSample ? [1, 2] : [1])).map((n) => ({
      caseId: id,
      repeat: n,
      key: `${id}-r${n}`,
    }));
  });
}
export function formalState(state) {
  const planning = state.planning || {};
  return {
    tasks: state.tasks,
    steps: planning.steps,
    dayItems: planning.dayItems,
    sessions: state.sessions,
    notes: state.notes,
    sessionLinks: planning.sessionLinks,
    intervals: planning.intervals,
    manualStepChanges: planning.manualStepChanges,
    planChanges: planning.planChanges,
    prepared: planning.prepared,
    context: planning.context,
    coachBlocks: state.coach?.blocks,
  };
}
export function stateDiff(before, after) {
  const changes = [];
  for (const [type, previous] of Object.entries(formalState(before))) {
    const next = formalState(after)[type];
    if (Array.isArray(previous) && Array.isArray(next)) {
      const old = new Map(
        previous.map((item) => [item.id || item.sessionId || hash(item), item]),
      );
      const current = new Map(
        next.map((item) => [item.id || item.sessionId || hash(item), item]),
      );
      for (const id of new Set([...old.keys(), ...current.keys()]))
        if (JSON.stringify(old.get(id)) !== JSON.stringify(current.get(id)))
          changes.push({
            operation: !old.has(id)
              ? "create"
              : !current.has(id)
                ? "remove"
                : "update",
            objectType: type,
            objectId: id,
            before: old.get(id) ?? null,
            after: current.get(id) ?? null,
          });
    } else if (JSON.stringify(previous) !== JSON.stringify(next))
      changes.push({
        operation: "update",
        objectType: type,
        objectId: type,
        before: previous ?? null,
        after: next ?? null,
      });
  }
  return changes;
}
export function normalizeTools(events) {
  const calls = new Map();
  for (const [index, event] of events.entries()) {
    const update = event.update;
    if (!["tool_call", "tool_call_update"].includes(update?.sessionUpdate))
      continue;
    const id = update.toolCallId || `visible-event-${index}`;
    const call = calls.get(id) || {
      id,
      name: update.title || "unknown-visible-tool",
      arguments: null,
      result: null,
      status: "unknown",
      requestId: event.requestId,
      events: [],
    };
    if (update.title) call.name = update.title;
    if (update.rawInput !== undefined) call.arguments = update.rawInput;
    if (update.rawOutput !== undefined) call.result = update.rawOutput;
    else if (update.content !== undefined) call.result = update.content;
    if (update.status === "completed") call.status = "success";
    else if (update.status === "failed") call.status = "error";
    call.events.push(event);
    calls.set(id, call);
  }
  return [...calls.values()];
}
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(authorization|headers|api.?key|access.?token|refresh.?token|token|password|secret)$/i.test(
          key,
        )
          ? "[redacted]"
          : redact(item),
      ]),
    );
  return typeof value === "string"
    ? value.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
    : value;
}
/** Only a verified per-case bridge file is changed. Every actual response is forwarded byte-for-byte. */
export async function toolProxy({
  caseRoot,
  connectionFile,
  onRecordRead,
  assertIsolated = true,
}) {
  within(caseRoot, connectionFile);
  if (assertIsolated)
    assert.match(path.resolve(caseRoot), /p0p1-m5-eval-[^\\/]+[\\/]cases[\\/]/);
  const resolved = await realpath(connectionFile);
  within(await realpath(caseRoot), resolved);
  const original = await readFile(connectionFile, "utf8"),
    connection = JSON.parse(original),
    target = new URL(connection.url);
  assert(
    connection.app === "inky-paper" &&
      target.protocol === "http:" &&
      target.hostname === "127.0.0.1" &&
      target.pathname === "/" &&
      !target.username &&
      !target.password &&
      !target.search &&
      !target.hash,
  );
  const calls = [];
  let edited = false;
  const server = createServer(async (request, response) => {
    const id = randomUUID(),
      at = new Date().toISOString();
    let input;
    try {
      assert(request.method === "POST" && /^\/[a-z_]+$/.test(request.url));
      assert.equal(request.headers.authorization, `Bearer ${connection.token}`);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      input = JSON.parse(body.toString("utf8"));
      const actual = await fetch(new URL(request.url, target), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${connection.token}`,
          "Content-Type": "application/json",
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      const bytes = Buffer.from(await actual.arrayBuffer());
      let result;
      try {
        result = JSON.parse(bytes.toString("utf8"));
      } catch {
        result = { unparsed: true };
      }
      const call = {
        id,
        name: `inky_paper_${request.url.slice(1)}`,
        action: request.url.slice(1),
        arguments: input,
        result: result.data ?? result,
        status: actual.ok && result.data !== undefined ? "success" : "error",
        httpStatus: actual.status,
        at,
        actor: "model",
        transport: "real-loopback-MCP-proxy",
      };
      calls.push(call);
      if (
        !edited &&
        onRecordRead &&
        call.action === "get_daily_record" &&
        call.status === "success"
      ) {
        edited = true;
        await onRecordRead(call);
        call.responseHeldForMarkdownEdit = true;
      }
      response.writeHead(actual.status, {
        "Content-Type":
          actual.headers.get("content-type") || "application/json",
      });
      response.end(bytes);
    } catch (error) {
      calls.push({
        id,
        name: request.url,
        arguments: input ?? null,
        result: String(error),
        status: "unknown",
        at,
        actor: "harness",
        transport: "proxy-failure",
      });
      response.writeHead(502, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: "Evaluation proxy could not forward the real response",
        }),
      );
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await writeFile(
      connectionFile,
      JSON.stringify({
        ...connection,
        url: `http://127.0.0.1:${server.address().port}`,
      }),
    );
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    calls,
    get edited() {
      return edited;
    },
    async close() {
      try {
        await writeFile(connectionFile, original);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    },
  };
}
