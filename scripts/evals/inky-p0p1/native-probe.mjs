// Real installed ACP inventory. /tools is a local command; this never sends a model prompt.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { within } from "./native-run-utils.mjs";

export async function inventory({
  caseRoot,
  connectionFile,
  hostFile,
  helperFile,
}) {
  within(caseRoot, hostFile);
  within(caseRoot, helperFile);
  within(caseRoot, connectionFile);
  const cwd = within(caseRoot, path.join(caseRoot, "inventory-probe"));
  await mkdir(cwd);
  const child = spawn(
    path.join(
      process.env.USERPROFILE,
      "Documents/hermes/venv/Scripts/python.exe",
    ),
    [hostFile],
    {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        INKY_WORKBENCH_STATE_DIR: cwd,
      },
    },
  );
  let serial = 0,
    answer = "";
  const pending = new Map(),
    lines = createInterface({ input: child.stdout });
  const rejectPending = (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  child.on("error", () =>
    rejectPending(Error("ACP inventory process could not start")),
  );
  child.stdin.on("error", () =>
    rejectPending(Error("ACP inventory input closed")),
  );
  child.on("exit", (code) =>
    rejectPending(Error(`ACP inventory exited (${code})`)),
  );
  // Drain but never persist arbitrary stderr, which can contain configuration diagnostics.
  child.stderr.resume();
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message.method && message.id && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(item.timer);
      message.error
        ? item.reject(Error("ACP inventory RPC failed"))
        : item.resolve(message.result);
    }
    if (
      message.method === "session/update" &&
      message.params?.update?.sessionUpdate === "agent_message_chunk"
    )
      answer += message.params.update.content?.text || "";
    if (message.method === "session/request_permission")
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { outcome: { outcome: "cancelled" } },
        }) + "\n",
      );
    else if (message.method && message.id)
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32601,
            message: "Unsupported inventory-client method",
          },
        }) + "\n",
      );
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++serial,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error(`ACP inventory timeout: ${method}`));
        }, 120000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  try {
    const initialized = await rpc("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "inky-c05-inventory", version: "1" },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
    const session = await rpc("session/new", {
      cwd,
      mcpServers: [
        {
          name: "inky_workbench",
          command: process.execPath,
          args: [helperFile],
          env: [{ name: "INKY_PAPER_CONNECTION_FILE", value: connectionFile }],
        },
      ],
    });
    assert(session.sessionId, "Actual inventory session id is required");
    await rpc("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "/tools" }],
    });
    const tools = [...answer.matchAll(/^\s+(mcp__[^: ]+):/gm)].map(
      (match) => match[1],
    );
    assert.equal(
      tools.length,
      12,
      "Actual ACP inventory must expose exactly 12 scoped tools",
    );
    assert(
      tools.every((name) =>
        name.startsWith("mcp__inky_workbench__inky_paper_"),
      ),
      "Unexpected tool namespace",
    );
    assert(
      !/\b(?:terminal|read_file|write_file|memory|delegate_task)\s*:|inky_paper_(?:create_task|update_task|adopt|start_session)/.test(
        answer,
      ),
      "Unexpected mutable or non-Paper tool",
    );
    const current = session.models?.currentModelId ?? null;
    const selected = session.models?.availableModels?.find(
      (model) => model.modelId === current,
    );
    return {
      sampledAt: new Date().toISOString(),
      actualAcpProcess: true,
      modelCalls: 0,
      tools,
      model: {
        currentModelId: current,
        displayName: selected?.name ?? null,
        providerIds: (initialized.authMethods || [])
          .map((method) => method.id)
          .filter((id) => typeof id === "string" && !id.includes("setup")),
        settings: "installed Hermes defaults; no override",
        source: "ACP initialize and session/new metadata; credentials not read",
      },
      isolation: { cwd, hermesState: path.join(cwd, "hermes-state.sqlite3") },
    };
  } finally {
    child.stdin.end();
    lines.close();
    rejectPending(Error("Inventory closed"));
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 2000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}
