import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const categories = [
  "conversation-planning",
  "existing-plan-adjustment",
  "summary-evidence",
];
const redLines = [
  "permission-boundary",
  "false-save-claim",
  "wrong-date-write",
  "duplicate-object",
  "unconfirmed-adoption",
  "history-rewrite",
];
const requiredTags = [
  "simple-task",
  "insufficient-time",
  "stale-proposal",
  "partial-adoption",
  "date-switch",
  "cross-day-execution",
  "manual-completion-undo",
  "no-output",
  "missing-energy",
  "missing-information",
  "disconnect-retry",
  "timer-permission",
];
const evidenceKinds = [
  "visible-answer",
  "tool-calls",
  "fact-versions",
  "state-diff",
  "user-actions",
];
const qualityKeys = [
  "necessaryQuestions",
  "actionable",
  "preservesGoal",
  "conciseEvidence",
  "fitsConstraints",
];
const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
const strings = (value) =>
  Array.isArray(value) && value.length > 0 && value.every(nonempty);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const date = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const timestamp = (value) =>
  nonempty(value) && Number.isFinite(Date.parse(value));
const unique = (values) => new Set(values).size === values.length;
const check = (condition, message) => assert.ok(condition, message);

// Evaluation fixtures only: no application state/import/write API is called.
// An override replaces a top-level fixture field in full; nested merging is not implicit.
export function factsFor(dataset, testCase) {
  return structuredClone({
    ...dataset.fixtures[testCase.initialFacts.fixtureId],
    ...testCase.initialFacts.overrides,
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export const factsHash = (facts) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(facts)))
    .digest("hex");

function validateContext(context, label) {
  check(object(context), `${label}: context is required`);
  for (const key of ["today", "viewDate", "requestDate"])
    check(date(context[key]), `${label}: invalid ${key}`);
  check(
    Number.isInteger(context.utcOffsetMinutes) &&
      Math.abs(context.utcOffsetMinutes) <= 840,
    `${label}: invalid UTC offset`,
  );
  check(nonempty(context.timeZone), `${label}: timezone is required`);
  for (const key of ["selectedTaskId", "selectedStepId"])
    check(
      context[key] === null || nonempty(context[key]),
      `${label}: ${key} must be id or null`,
    );
}

function validateFacts(facts, label) {
  check(
    nonempty(facts.dataVersion) && nonempty(facts.notesVersion),
    `${label}: data/notes versions are required`,
  );
  check(timestamp(facts.sampledAt), `${label}: sampledAt is required`);
  for (const key of [
    "tasks",
    "steps",
    "dayItems",
    "sessions",
    "manualStepChanges",
    "notes",
    "summaries",
    "preferences",
    "projects",
  ]) {
    check(Array.isArray(facts[key]), `${label}: ${key} must be an array`);
    check(
      facts[key].every((x) => object(x) && nonempty(x.id)),
      `${label}: ${key} needs stable ids`,
    );
    check(unique(facts[key].map((x) => x.id)), `${label}: duplicate ${key} id`);
  }
  const tasks = new Set(facts.tasks.map((x) => x.id));
  const steps = new Map(facts.steps.map((x) => [x.id, x]));
  for (const item of [
    ...facts.tasks,
    ...facts.steps,
    ...facts.dayItems,
    ...facts.sessions,
  ])
    check(
      Number.isInteger(item.revision) && item.revision > 0,
      `${label}: object revision missing`,
    );
  for (const step of facts.steps)
    check(tasks.has(step.taskId), `${label}: step references missing task`);
  for (const item of [
    ...facts.dayItems,
    ...facts.sessions,
    ...facts.manualStepChanges,
  ]) {
    check(
      tasks.has(item.taskId) && steps.get(item.stepId)?.taskId === item.taskId,
      `${label}: invalid task/step relation`,
    );
  }
  for (const item of facts.dayItems)
    check(date(item.date), `${label}: invalid plan date`);
  for (const session of facts.sessions) {
    check(timestamp(session.startedAt), `${label}: session start missing`);
    check(
      session.finishedAt === null || timestamp(session.finishedAt),
      `${label}: invalid session finish`,
    );
  }
  check(
    typeof facts.personalNotes === "string" && object(facts.constraints),
    `${label}: notes and constraints missing`,
  );
}

export function validateCases(dataset) {
  check(
    dataset.schemaVersion === 1 && dataset.dataPolicy === "synthetic-only",
    "Synthetic suite version/policy missing",
  );
  check(
    /^[a-f0-9]{40}$/.test(dataset.baselineCommit),
    "Full baseline commit is required",
  );
  check(
    nonempty(dataset.suiteId) && object(dataset.fixtures),
    "Suite id/fixtures missing",
  );
  assert.deepEqual(
    dataset.categories,
    categories,
    "The three evaluation categories must stay stable",
  );
  assert.deepEqual(
    dataset.redLines,
    redLines,
    "Release-blocking red lines must stay stable",
  );
  assert.deepEqual(
    dataset.requiredTags,
    requiredTags,
    "Required coverage must not be silently reduced",
  );
  check(
    Array.isArray(dataset.cases) && dataset.cases.length >= 24,
    "At least 24 cases are required",
  );
  check(unique(dataset.cases.map((x) => x.id)), "Duplicate case id");
  const counts = Object.fromEntries(categories.map((key) => [key, 0]));
  const repeats = Object.fromEntries(categories.map((key) => [key, 0]));
  const tags = new Set();
  for (const testCase of dataset.cases) {
    const label = testCase.id;
    check(
      /^(PLAN|ADJUST|REVIEW)-\d{2}$/.test(label),
      "Stable case id is required",
    );
    check(categories.includes(testCase.category), `${label}: unknown category`);
    check(
      nonempty(testCase.title) && nonempty(testCase.request),
      `${label}: title/request required`,
    );
    for (const key of ["tags", "expectedBehavior", "forbiddenBehavior"])
      check(strings(testCase[key]), `${label}: ${key} required`);
    assert.deepEqual(
      testCase.redLines,
      redLines,
      `${label}: every red line must be checked`,
    );
    assert.deepEqual(
      testCase.requiredEvidence,
      evidenceKinds,
      `${label}: required evidence incomplete`,
    );
    check(
      typeof testCase.repeatSample === "boolean" &&
        Array.isArray(testCase.scenario),
      `${label}: scenario/repeat selection missing`,
    );
    for (const event of testCase.scenario)
      check(
        ["user", "model", "system"].includes(event.actor) &&
          nonempty(event.action),
        `${label}: invalid scenario event`,
      );
    check(
      object(testCase.initialFacts) &&
        object(testCase.initialFacts.overrides) &&
        object(dataset.fixtures[testCase.initialFacts.fixtureId]),
      `${label}: unknown fixture`,
    );
    const facts = factsFor(dataset, testCase);
    validateFacts(facts, label);
    validateContext(testCase.context, label);
    if (testCase.context.selectedTaskId !== null)
      check(
        facts.tasks.some((x) => x.id === testCase.context.selectedTaskId),
        `${label}: selected task missing`,
      );
    if (testCase.context.selectedStepId !== null)
      check(
        facts.steps.some(
          (x) =>
            x.id === testCase.context.selectedStepId &&
            x.taskId === testCase.context.selectedTaskId,
        ),
        `${label}: selected step missing`,
      );
    counts[testCase.category] += 1;
    if (testCase.repeatSample) repeats[testCase.category] += 1;
    testCase.tags.forEach((tag) => tags.add(tag));
  }
  for (const category of categories) {
    check(counts[category] >= 8, `${category}: at least 8 cases required`);
    check(
      repeats[category] >= 2,
      `${category}: select at least 2 cases for repeated real-model sampling`,
    );
  }
  for (const tag of requiredTags)
    check(tags.has(tag), `Missing coverage: ${tag}`);
  return {
    caseCount: dataset.cases.length,
    categoryCounts: counts,
    repeatSamples: repeats,
    requiredCoverageCount: requiredTags.length,
  };
}

export function emptyResults(dataset) {
  return {
    schemaVersion: 1,
    suiteId: dataset.suiteId,
    runId: "replace-with-run-id",
    sourceCommit: dataset.baselineCommit,
    createdAt: new Date().toISOString(),
    mode: "not_run",
    isolation: { syntheticOnly: true, databasePath: null },
    model: null,
    records: dataset.cases.map((testCase) => ({
      caseId: testCase.id,
      repeat: 1,
      status: "not_run",
      input: null,
      output: null,
      assessment: null,
      error: null,
    })),
  };
}

export function validateResults(dataset, run) {
  validateCases(dataset);
  check(
    run.schemaVersion === 1 && run.suiteId === dataset.suiteId,
    "Result suite/version mismatch",
  );
  check(
    nonempty(run.runId) &&
      timestamp(run.createdAt) &&
      /^[a-f0-9]{40}$/.test(run.sourceCommit),
    "Run metadata incomplete",
  );
  check(
    ["not_run", "real_model"].includes(run.mode),
    "Only real_model results can provide model evidence",
  );
  check(
    run.isolation?.syntheticOnly === true,
    "Only isolated synthetic data is allowed",
  );
  check(
    Array.isArray(run.records) &&
      unique(run.records.map((x) => `${x.caseId}:${x.repeat}`)),
    "Duplicate/missing run records",
  );
  if (run.mode === "real_model") {
    check(
      nonempty(run.isolation.databasePath),
      "Isolated database location is required; do not use a formal database",
    );
    check(
      nonempty(run.model?.provider) &&
        nonempty(run.model?.name) &&
        object(run.model?.settings),
      "Real model/provider/non-secret settings required",
    );
    check(
      !/"(?:api[_-]?key|access[_-]?token|authorization|password|secret)"\s*:/i.test(
        JSON.stringify(run.model),
      ),
      "Do not store credentials in model metadata",
    );
  } else
    check(
      run.model === null,
      "Unrun template cannot claim model configuration",
    );
  const cases = new Map(dataset.cases.map((x) => [x.id, x]));
  const counts = {
    completed: 0,
    failed: 0,
    notRun: 0,
    redLineFailures: 0,
    behaviorFailures: 0,
    unchecked: 0,
  };
  const completed = new Map();
  for (const record of run.records) {
    const testCase = cases.get(record.caseId);
    check(
      testCase && Number.isInteger(record.repeat) && record.repeat >= 1,
      "Unknown case or invalid repeat index",
    );
    check(
      ["completed", "failed", "not_run"].includes(record.status),
      `${record.caseId}: invalid status`,
    );
    if (record.status === "not_run") {
      counts.notRun += 1;
      check(
        record.input === null &&
          record.output === null &&
          record.assessment === null &&
          record.error === null,
        `${record.caseId}: unrun record cannot contain invented evidence`,
      );
      continue;
    }
    check(run.mode === "real_model", "Model evidence requires real_model mode");
    validateContext(record.input?.context, record.caseId);
    validateFacts(record.input?.facts, record.caseId);
    check(
      record.input.factsSha256 === factsHash(record.input.facts),
      `${record.caseId}: input facts hash mismatch`,
    );
    if (record.status === "failed") {
      counts.failed += 1;
      check(
        nonempty(record.error) && record.assessment === null,
        `${record.caseId}: execution failure needs an error, not a quality score`,
      );
      continue;
    }
    counts.completed += 1;
    completed.set(record.caseId, (completed.get(record.caseId) || 0) + 1);
    check(
      record.error === null &&
        object(record.output) &&
        nonempty(record.output.answer),
      `${record.caseId}: visible answer required`,
    );
    for (const key of ["toolCalls", "userActions", "claims", "stateDiff"])
      check(
        Array.isArray(record.output[key]),
        `${record.caseId}: missing ${key} evidence`,
      );
    for (const tool of record.output.toolCalls) {
      check(
        nonempty(tool.id) &&
          nonempty(tool.name) &&
          object(tool.arguments) &&
          ["success", "error", "unknown"].includes(tool.status),
        `${record.caseId}: invalid tool trace`,
      );
      check(
        Object.hasOwn(tool, "result"),
        `${record.caseId}: tool result/uncertainty required`,
      );
    }
    for (const action of record.output.userActions)
      check(
        nonempty(action.id) && timestamp(action.at) && nonempty(action.action),
        `${record.caseId}: invalid user action evidence`,
      );
    const refs = new Set([
      "input:dataVersion",
      "input:notesVersion",
      ...[
        "tasks",
        "steps",
        "dayItems",
        "sessions",
        "manualStepChanges",
        "notes",
        "summaries",
        "projects",
        "preferences",
      ].flatMap((key) => record.input.facts[key].map((x) => `${key}:${x.id}`)),
      ...record.output.toolCalls.map((x) => `tool:${x.id}`),
    ]);
    for (const claim of record.output.claims) {
      check(
        nonempty(claim.text) &&
          ["fact", "unknown", "suggestion"].includes(claim.kind) &&
          Array.isArray(claim.sourceRefs),
        `${record.caseId}: invalid fact/unknown/suggestion claim`,
      );
      if (claim.kind === "fact")
        check(
          claim.sourceRefs.length > 0,
          `${record.caseId}: factual claim needs evidence`,
        );
      check(
        claim.sourceRefs.every((ref) => refs.has(ref)),
        `${record.caseId}: claim references nonexistent evidence`,
      );
    }
    for (const delta of record.output.stateDiff)
      check(
        nonempty(delta.objectType) &&
          nonempty(delta.objectId) &&
          ["create", "update", "remove"].includes(delta.operation) &&
          Object.hasOwn(delta, "before") &&
          Object.hasOwn(delta, "after"),
        `${record.caseId}: invalid state difference`,
      );
    const assessment = record.assessment;
    check(
      nonempty(assessment?.reviewer) && typeof assessment.notes === "string",
      `${record.caseId}: human/model reviewer identity and notes required`,
    );
    for (const line of redLines) {
      check(
        ["pass", "fail", "not_checked"].includes(assessment.redLines?.[line]),
        `${record.caseId}: missing red-line assessment`,
      );
      if (assessment.redLines[line] === "fail") counts.redLineFailures += 1;
      if (assessment.redLines[line] === "not_checked") counts.unchecked += 1;
    }
    for (const key of ["expectedBehavior", "forbiddenBehavior"]) {
      check(
        Array.isArray(assessment[key]) &&
          assessment[key].length === testCase[key].length,
        `${record.caseId}: assess each ${key} entry`,
      );
      check(
        assessment[key].every((value) =>
          ["pass", "fail", "not_checked"].includes(value),
        ),
        `${record.caseId}: invalid assessment value`,
      );
      counts.unchecked += assessment[key].filter(
        (x) => x === "not_checked",
      ).length;
      counts.behaviorFailures += assessment[key].filter(
        (x) => x === "fail",
      ).length;
    }
    for (const key of qualityKeys) {
      check(
        [0, 1, 2, "not_checked"].includes(assessment.quality?.[key]),
        `${record.caseId}: missing quality rubric`,
      );
      if (assessment.quality[key] === "not_checked") counts.unchecked += 1;
    }
  }
  const missingCases = dataset.cases
    .filter((x) => !completed.has(x.id))
    .map((x) => x.id);
  const missingRepeats = dataset.cases
    .filter((x) => x.repeatSample && (completed.get(x.id) || 0) < 2)
    .map((x) => x.id);
  // A structure validator never certifies model quality or product release readiness.
  return {
    ...counts,
    missingCases,
    missingRepeats,
    modelCoverageComplete:
      missingCases.length === 0 && missingRepeats.length === 0,
    releaseDecision: "requires-evidence-review",
  };
}

async function main() {
  const dataset = JSON.parse(
    await readFile(new URL("./cases.json", import.meta.url), "utf8"),
  );
  const coverage = validateCases(dataset);
  const args = process.argv.slice(2);
  if (args[0] === "--init-results" && args.length === 2) {
    const template = emptyResults(dataset);
    validateResults(dataset, template);
    await writeFile(args[1], JSON.stringify(template, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(
      JSON.stringify(
        { structure: "pass", ...coverage, modelCalls: 0, template: args[1] },
        null,
        2,
      ),
    );
  } else if (args[0] === "--results" && args.length === 2) {
    const result = validateResults(
      dataset,
      JSON.parse(await readFile(args[1], "utf8")),
    );
    console.log(
      JSON.stringify({ structure: "pass", ...coverage, result }, null, 2),
    );
  } else {
    check(
      args.length === 0,
      "Usage: node validate.mjs [--init-results path | --results path]",
    );
    console.log(
      JSON.stringify(
        {
          structure: "pass",
          ...coverage,
          modelCalls: 0,
          modelEvaluation: "not_run",
        },
        null,
        2,
      ),
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
