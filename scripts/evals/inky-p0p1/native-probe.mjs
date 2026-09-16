// Real installed ACP inventory. /tools is a local command; this never sends a model prompt.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { within } from "./native-run-utils.mjs";

// Bind the probe BEFORE loading the host, so even an early MCP spawn belongs
// to this unnamed job. Its non-inheritable handle exists only in this Python
// process; EOF exit or termination closes it and reaps only this probe's tree.
// A failed job setup exits before runpy, never running an uncontained host.
export const windowsJobBootstrap = String.raw`
import ctypes, ctypes.wintypes as w, os, runpy, sys, threading
class BasicLimits(ctypes.Structure):
    _fields_=[('PerProcessUserTimeLimit',ctypes.c_longlong),('PerJobUserTimeLimit',ctypes.c_longlong),
      ('LimitFlags',w.DWORD),('MinimumWorkingSetSize',ctypes.c_size_t),('MaximumWorkingSetSize',ctypes.c_size_t),
      ('ActiveProcessLimit',w.DWORD),('Affinity',ctypes.c_size_t),('PriorityClass',w.DWORD),('SchedulingClass',w.DWORD)]
class IoCounters(ctypes.Structure):
    _fields_=[(name,ctypes.c_ulonglong) for name in ('ReadOperationCount','WriteOperationCount','OtherOperationCount',
      'ReadTransferCount','WriteTransferCount','OtherTransferCount')]
class ExtendedLimits(ctypes.Structure):
    _fields_=[('BasicLimitInformation',BasicLimits),('IoInfo',IoCounters),('ProcessMemoryLimit',ctypes.c_size_t),
      ('JobMemoryLimit',ctypes.c_size_t),('PeakProcessMemoryUsed',ctypes.c_size_t),('PeakJobMemoryUsed',ctypes.c_size_t)]
k=ctypes.WinDLL('kernel32',use_last_error=True)
k.CreateJobObjectW.argtypes=[ctypes.c_void_p,w.LPCWSTR];k.CreateJobObjectW.restype=w.HANDLE
k.SetInformationJobObject.argtypes=[w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.DWORD];k.SetInformationJobObject.restype=w.BOOL
k.SetHandleInformation.argtypes=[w.HANDLE,w.DWORD,w.DWORD];k.SetHandleInformation.restype=w.BOOL
k.AssignProcessToJobObject.argtypes=[w.HANDLE,w.HANDLE];k.AssignProcessToJobObject.restype=w.BOOL
k.GetCurrentProcess.argtypes=[];k.GetCurrentProcess.restype=w.HANDLE
k.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];k.OpenProcess.restype=w.HANDLE
k.WaitForSingleObject.argtypes=[w.HANDLE,w.DWORD];k.WaitForSingleObject.restype=w.DWORD
k.CloseHandle.argtypes=[w.HANDLE];k.CloseHandle.restype=w.BOOL
job=k.CreateJobObjectW(None,None)
if not job: raise OSError('ACP inventory job creation failed')
limits=ExtendedLimits();limits.BasicLimitInformation.LimitFlags=0x2000
if not k.SetHandleInformation(job,1,0) or not k.SetInformationJobObject(job,9,ctypes.byref(limits),ctypes.sizeof(limits)):
    k.CloseHandle(job)
    raise OSError('ACP inventory job limits failed')
if not k.AssignProcessToJobObject(job,k.GetCurrentProcess()):
    k.CloseHandle(job)
    raise OSError('ACP inventory job assignment failed')
# Windows venv python.exe may be a redirector with a separate interpreter PID.
# Watch handles to our actual parent and Node owner; never terminate either.
# If Node kills its exact redirector child, close OUR job to reap this interpreter.
owners=[]
for owner in {os.getppid(),int(sys.argv[2])}:
    handle=k.OpenProcess(0x00100000,False,owner)
    if not handle:
        k.CloseHandle(job)
        raise OSError('ACP inventory owner watch failed')
    owners.append(handle)
shutdown_lock=threading.Lock();job_closed=False
def owner_exited(handle):
    global job_closed
    k.WaitForSingleObject(handle,0xffffffff)
    with shutdown_lock:
        if not job_closed:
            job_closed=True
            k.CloseHandle(job)
for handle in owners:
    threading.Thread(target=owner_exited,args=(handle,),daemon=True).start()
host=os.path.abspath(sys.argv[1]);sys.argv=[host];sys.path.insert(0,os.path.dirname(host))
runpy.run_path(host,run_name='__main__')
# Do not leak the job handle to children or close it while this host is running.
# Windows closes the final handle when this process exits, including forced exit.
`;

// Exported only for the dedicated synthetic subprocess lifecycle tests.
export function spawnProbeHost({ python, hostFile, cwd, env }) {
  return spawn(
    python,
    process.platform === "win32"
      ? ["-c", windowsJobBootstrap, hostFile, String(process.pid)]
      : [hostFile],
    { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env },
  );
}

const exited = (child) =>
  child.exitCode !== null || child.signalCode !== null || child.pid == null;
const waitForExit = (child, timeout) =>
  new Promise((resolve) => {
    if (exited(child)) return resolve(true);
    const finish = (value) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
      resolve(value);
    };
    const onExit = () => finish(true);
    const onError = () => finish(exited(child));
    const timer = setTimeout(() => finish(false), timeout);
    child.once("exit", onExit);
    child.once("error", onError);
  });

export async function closeProbeHost(
  child,
  { graceMs = 2000, forceMs = 5000 } = {},
) {
  if (exited(child)) return { forced: false };
  child.stdin.end();
  if (await waitForExit(child, graceMs)) return { forced: false };
  // ChildProcess retains this exact owned process handle on Windows. Never
  // enumerate/kill by process name or use a global taskkill /T fallback.
  if (!child.kill() && !exited(child))
    throw Error("ACP inventory process termination failed");
  if (!(await waitForExit(child, forceMs)))
    throw Error("ACP inventory process did not exit after termination");
  return { forced: true };
}

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
  const child = spawnProbeHost({
    python: path.join(
      process.env.USERPROFILE,
      "Documents/hermes/venv/Scripts/python.exe",
    ),
    hostFile,
    cwd,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      INKY_WORKBENCH_STATE_DIR: cwd,
    },
  });
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
      isolation: {
        cwd,
        hermesState: path.join(cwd, "hermes-state.sqlite3"),
        processContainment:
          process.platform === "win32"
            ? "unnamed-kill-on-close-job-before-host"
            : "direct-child",
      },
    };
  } finally {
    lines.close();
    rejectPending(Error("Inventory closed"));
    await closeProbeHost(child);
  }
}
