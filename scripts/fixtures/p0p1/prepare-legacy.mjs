// Synthetic 0.6.4 migration input. Run only from this repository root.
// No production database is opened. Output is fixed and must not already exist.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

function inside(root, target) {
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Refusing path outside the allowed directory: ${target}`);
  }
  return target;
}

function rejectLinks(root, target) {
  inside(root, target);
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing symbolic link or junction: ${current}`);
    }
  }
}

function validateFixture(fixture) {
  const { metadata, state, events, requests } = fixture;
  assert.equal(metadata.source, "synthetic-only");
  assert.equal(metadata.applicationVersion, "0.6.4");
  assert.equal(metadata.fixtureToday, "2030-03-04");
  assert.equal(metadata.utcOffsetMinutes, 480);
  assert.equal(metadata.timeZone, "Asia/Shanghai");
  const tasks = new Map(state.tasks.map((task) => [task.id, task]));
  const steps = new Map(state.planning.steps.map((step) => [step.id, step]));
  const items = new Map(state.planning.dayItems.map((item) => [item.id, item]));
  const sessions = new Map(
    state.sessions.map((session) => [session.id, session]),
  );
  const counts = {
    tasks: tasks.size,
    steps: steps.size,
    dayItems: items.size,
    sessions: sessions.size,
    manualStepChanges: state.planning.manualStepChanges.length,
    notes: state.notes.length,
    events: events.length,
    requests: requests.length,
  };
  assert.deepEqual(counts, metadata.expectedCounts);
  for (const task of tasks.values()) {
    assert(!Object.hasOwn(task, "dueDate"));
    assert(!Object.hasOwn(task, "projectId"));
    if (task.nextAction)
      assert.equal(steps.get(task.nextAction.id)?.taskId, task.id);
  }
  assert(!Object.hasOwn(state.planning, "prepared"));
  for (const step of steps.values()) assert(tasks.has(step.taskId));
  for (const item of items.values()) {
    assert.equal(steps.get(item.stepId)?.taskId, item.taskId);
  }
  for (const session of sessions.values()) {
    assert.equal(
      session.status,
      "finished",
      "Fixture must not start a live clock",
    );
    assert.equal(steps.get(session.action.id)?.taskId, session.taskId);
    assert.equal(
      session.elapsedSeconds,
      (session.endedAt - session.startedAt) / 1000,
    );
  }
  for (const link of state.planning.sessionLinks) {
    assert(sessions.has(link.sessionId));
    assert.equal(items.get(link.dayItemId)?.date, link.planDate);
    assert.equal(
      items.get(link.dayItemId)?.stepId,
      sessions.get(link.sessionId)?.action.id,
    );
  }
  const valid = [...items.values()].filter((item) => item.removedAt === null);
  assert(valid.some((item) => item.date < metadata.fixtureToday));
  assert(valid.some((item) => item.date === metadata.fixtureToday));
  assert(valid.some((item) => item.date > metadata.fixtureToday));
  assert(
    [...steps.values()].some(
      (step) =>
        !step.completed && !valid.some((item) => item.stepId === step.id),
    ),
  );
  const futureSession = state.sessions.find(
    (session) =>
      session.action.id === metadata.scenarios.futureStepExecutedEarly,
  );
  const futureLink = state.planning.sessionLinks.find(
    (link) => link.sessionId === futureSession.id,
  );
  assert(futureLink.planDate > metadata.fixtureToday);
  assert.equal(
    new Date(futureSession.startedAt + metadata.utcOffsetMinutes * 60_000)
      .toISOString()
      .slice(0, 10),
    metadata.fixtureToday,
  );
  const changes = state.planning.manualStepChanges;
  assert.deepEqual(
    changes.map((change) => change.completed),
    [true, false],
  );
  assert.equal(steps.get(changes.at(-1).stepId).completed, false);
  assert(tasks.get(metadata.scenarios.completedParentTask).completed);
  assert(
    state.notes.some((note) => note.sessionId && note.action && note.taskTitle),
  );
  const converted = state.notes.find(
    (note) => note.id === metadata.scenarios.convertedNote,
  );
  assert(tasks.has(converted.convertedTaskId));
  return counts;
}

function logicalSnapshot(db) {
  return {
    state: JSON.parse(
      db.prepare("SELECT data FROM paper_state WHERE id=1").get().data,
    ),
    events: db
      .prepare("SELECT seq,data FROM paper_events ORDER BY seq")
      .all()
      .map((row) => ({ seq: row.seq, data: JSON.parse(row.data) })),
    requests: db
      .prepare("SELECT id,fingerprint,result FROM paper_requests ORDER BY id")
      .all()
      .map((row) => ({ ...row })),
  };
}

function checkDb(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const integrity = db
      .prepare("PRAGMA integrity_check")
      .all()
      .map((row) => row.integrity_check);
    assert.deepEqual(integrity, ["ok"]);
    const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
    assert.deepEqual(foreignKeys, []);
    return { integrity: "ok", snapshot: logicalSnapshot(db) };
  } finally {
    db.close();
  }
}

function sha256(filename) {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

function main() {
  if (process.argv.length !== 2)
    throw new Error(
      "No arguments accepted; output paths are fixed for isolation.",
    );
  const repository = realpathSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
  );
  const cwd = realpathSync(process.cwd());
  assert.equal(
    cwd,
    repository,
    "Run this script from its repository root only",
  );
  const output = inside(
    repository,
    path.resolve(repository, "output/p0p1-m0/legacy"),
  );
  const reportPath = inside(
    repository,
    path.resolve(repository, "docs/verification/p0p1/M0/legacy-fixture.json"),
  );
  rejectLinks(repository, output);
  rejectLinks(repository, reportPath);
  if (existsSync(output))
    throw new Error(
      `Refusing to overwrite existing fixture directory: ${output}`,
    );
  if (existsSync(reportPath))
    throw new Error(
      `Refusing to overwrite existing fixture report: ${reportPath}`,
    );
  // These assertions exercise the guard without reading or writing those paths.
  assert.throws(
    () => inside(output, path.resolve(output, "..", "escape.sqlite")),
    /outside/,
  );
  assert.throws(() => inside(output, repository), /outside/);
  const source = inside(
    repository,
    path.resolve(repository, "scripts/fixtures/p0p1/legacy-state.json"),
  );
  const fixture = JSON.parse(readFileSync(source, "utf8"));
  const counts = validateFixture(fixture);
  mkdirSync(path.dirname(output), { recursive: true });
  rejectLinks(repository, output);
  mkdirSync(output); // No recursive/existing-directory fallback at this boundary.
  const databasePath = inside(output, path.join(output, "paper.sqlite"));
  const backupPath = inside(
    output,
    path.join(output, "paper.pre-migration.sqlite"),
  );
  const restoredPath = inside(
    output,
    path.join(output, "paper.restored.sqlite"),
  );
  const expected = {
    state: fixture.state,
    events: fixture.events,
    requests: fixture.requests,
  };
  const db = new DatabaseSync(databasePath);
  let sqliteVersion;
  try {
    sqliteVersion = db
      .prepare("SELECT sqlite_version() AS version")
      .get().version;
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE paper_state(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL); CREATE TABLE paper_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT NOT NULL); CREATE TABLE paper_requests(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);",
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO paper_state(id,data) VALUES(1,?)").run(
        JSON.stringify(fixture.state),
      );
      const insertEvent = db.prepare(
        "INSERT INTO paper_events(seq,data) VALUES(?,?)",
      );
      for (const event of fixture.events)
        insertEvent.run(event.seq, JSON.stringify(event.data));
      const insertRequest = db.prepare(
        "INSERT INTO paper_requests(id,fingerprint,result) VALUES(?,?,?)",
      );
      for (const request of fixture.requests)
        insertRequest.run(request.id, request.fingerprint, request.result);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    assert.deepEqual(logicalSnapshot(db), expected);
    // VACUUM INTO produces a consistent SQLite snapshot, including committed WAL data.
    db.prepare("VACUUM INTO ?").run(backupPath);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  copyFileSync(backupPath, restoredPath, constants.COPYFILE_EXCL);
  const evidence = [databasePath, backupPath, restoredPath].map((filename) => {
    const checked = checkDb(filename);
    assert.deepEqual(
      checked.snapshot,
      expected,
      `${path.basename(filename)} must match every state, event and cached request`,
    );
    return {
      file: path.relative(repository, filename).replaceAll(path.sep, "/"),
      integrity: checked.integrity,
      sha256: sha256(filename),
      logicalDataEqualsFixture: true,
    };
  });
  const report = {
    status: "passed",
    scope:
      "Synthetic 0.6.4 legacy database, consistent backup and restore; not product migration or desktop acceptance",
    executedAt: new Date().toISOString(),
    nodeVersion: process.version,
    sqliteVersion,
    fixtureToday: fixture.metadata.fixtureToday,
    utcOffsetMinutes: fixture.metadata.utcOffsetMinutes,
    fixtureSha256: sha256(source),
    counts,
    checks: {
      fixtureRelations: true,
      noActiveClock: true,
      pathEscapeRejected: true,
      overwriteRefusedByExclusiveDirectory: true,
      backupIncludesStateEventsRequests: true,
      restoredDataEquivalent: true,
    },
    files: evidence,
    notValidated: ["Application migration", "Native desktop", "Real model"],
  };
  mkdirSync(path.dirname(reportPath), { recursive: true });
  rejectLinks(repository, reportPath);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      status: report.status,
      fixtureToday: report.fixtureToday,
      counts,
      report: path.relative(repository, reportPath).replaceAll(path.sep, "/"),
    }),
  );
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ status: "failed", error: error.message }));
  process.exitCode = 1;
}
