// Real Windows process/job lifecycle tests with synthetic Python/Node sleepers.
// No ACP/Hermes imports, native Inky, CDP connection or model calls occur here.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import {
  closeProbeHost,
  spawnProbeHost,
  windowsJobBootstrap,
} from "./native-probe.mjs";

const windows = process.platform === "win32";
const python = path.join(
  process.env.USERPROFILE || "",
  "Documents/hermes/venv/Scripts/python.exe",
);
const output = path.resolve("output");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
};
async function waitDead(pids) {
  const deadline = Date.now() + 5000;
  while (pids.some(alive) && Date.now() < deadline) await pause(50);
  assert(
    pids.every((pid) => !alive(pid)),
    `Owned descendants must exit: ${pids.join(", ")}`,
  );
}
function ready(child) {
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  child.stdin.on("error", () => {});
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(Error("Synthetic host did not become ready")),
      5000,
    );
    const finish = (error, value) => {
      clearTimeout(timer);
      lines.close();
      child.off("error", onError);
      child.off("exit", onExit);
      error ? reject(error) : resolve(value);
    };
    const onError = () => finish(Error("Synthetic host spawn failed"));
    const onExit = (code) =>
      finish(Error(`Synthetic host exited early: ${code}`));
    child.once("error", onError);
    child.once("exit", onExit);
    lines.once("line", (line) => {
      try {
        finish(null, JSON.parse(line));
      } catch (error) {
        finish(error);
      }
    });
  });
}
async function removeOwned(root) {
  assert.equal(path.dirname(root), output);
  assert(path.basename(root).startsWith("probe-job-unit-"));
  await rm(root, { recursive: true, force: true });
}

for (const forced of [false, true]) {
  test(
    `Windows job reaps child and grandchild on ${forced ? "forced timeout" : "normal EOF"}, preserving a sibling probe`,
    { skip: !windows },
    async () => {
      await access(python);
      await mkdir(output, { recursive: true });
      const root = await mkdtemp(path.join(output, "probe-job-unit-"));
      let child, sibling;
      try {
        const hostFile = path.join(root, "host with spaces.py");
        const siblingFile = path.join(root, "sibling.py");
        const grandchildCode = "setTimeout(() => process.exit(0), 30000)";
        const childCode = `const {spawn}=require('node:child_process');const leaf=spawn(process.execPath,['-e',${JSON.stringify(grandchildCode)}],{windowsHide:true,stdio:'ignore'});console.log(JSON.stringify({child:process.pid,grandchild:leaf.pid}));setTimeout(()=>process.exit(0),30000);`;
        await writeFile(
          hostFile,
          `import json,os,subprocess,sys,time\nchild=subprocess.Popen([os.environ['PROBE_TEST_NODE'],'-e',${JSON.stringify(childCode)}],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW,text=True)\nchildren=json.loads(child.stdout.readline())\nprint(json.dumps(dict(host=os.getpid(),**children)),flush=True)\nsys.stdin.read()\n${forced ? "time.sleep(30)" : "sys.exit(0)"}\n`,
        );
        await writeFile(
          siblingFile,
          "import json,os,sys\nprint(json.dumps({'host':os.getpid()}),flush=True)\nsys.stdin.read()\n",
        );
        const args = {
          python,
          cwd: root,
          env: {
            ...process.env,
            PROBE_TEST_NODE: process.execPath,
            PYTHONUTF8: "1",
          },
        };
        sibling = spawnProbeHost({ ...args, hostFile: siblingFile });
        const siblingPids = await ready(sibling);
        child = spawnProbeHost({ ...args, hostFile });
        const pids = await ready(child);
        assert(
          [pids.host, pids.child, pids.grandchild].every(
            (pid) => Number.isSafeInteger(pid) && alive(pid),
          ),
        );
        const result = await closeProbeHost(child, {
          graceMs: forced ? 150 : 2000,
        });
        assert.equal(result.forced, forced);
        await waitDead([pids.host, pids.child, pids.grandchild]);
        assert(
          alive(siblingPids.host),
          "Another independently owned probe must remain alive",
        );
        assert.equal(sibling.exitCode, null);
        await closeProbeHost(sibling);
        await waitDead([siblingPids.host]);
      } finally {
        if (child)
          await closeProbeHost(child, { graceMs: 100 }).catch(() => {});
        if (sibling)
          await closeProbeHost(sibling, { graceMs: 100 }).catch(() => {});
        await removeOwned(root);
      }
    },
  );
}

test(
  "Windows job assignment failure refuses to execute the host",
  { skip: !windows },
  async () => {
    await mkdir(output, { recursive: true });
    const root = await mkdtemp(path.join(output, "probe-job-unit-"));
    let child;
    try {
      const marker = path.join(root, "host-ran.txt");
      const hostFile = path.join(root, "must-not-run.py");
      await writeFile(
        hostFile,
        "from pathlib import Path\nPath(__file__).with_name('host-ran.txt').write_text('unsafe')\n",
      );
      // Fault injection replaces only AssignProcessToJobObject with failure;
      // other job APIs are real. No model or application state is mocked.
      const failAssignment = String.raw`
import ctypes
original=ctypes.WinDLL
class RefuseAssignment:
    def __init__(self,*args,**kwargs):
        self.delegate=original(*args,**kwargs)
        self.AssignProcessToJobObject=lambda *args: 0
    def __getattr__(self,name): return getattr(self.delegate,name)
ctypes.WinDLL=RefuseAssignment
`;
      child = spawn(
        python,
        [
          "-c",
          failAssignment + windowsJobBootstrap,
          hostFile,
          String(process.pid),
        ],
        { cwd: root, windowsHide: true, stdio: ["pipe", "ignore", "ignore"] },
      );
      const [code] = await once(child, "exit");
      assert.notEqual(code, 0);
      await assert.rejects(access(marker), { code: "ENOENT" });
    } finally {
      if (child) await closeProbeHost(child, { graceMs: 100 }).catch(() => {});
      await removeOwned(root);
    }
  },
);
