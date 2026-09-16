import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  emptyResults,
  factsFor,
  factsHash,
  validateCases,
  validateResults,
} from "./validate.mjs";

const dataset = JSON.parse(
  await readFile(new URL("./cases.json", import.meta.url), "utf8"),
);

// Contract test fixture only. Never written as model evidence and never calls a model.
function evidenceFixture() {
  const testCase = dataset.cases[0];
  const facts = factsFor(dataset, testCase);
  const run = emptyResults(dataset);
  run.mode = "real_model";
  run.isolation.databasePath = "isolated-contract-fixture.sqlite";
  run.model = {
    provider: "contract-fixture",
    name: "not-a-model-call",
    settings: {},
  };
  run.records = [
    {
      caseId: testCase.id,
      repeat: 1,
      status: "completed",
      error: null,
      input: {
        context: testCase.context,
        facts,
        factsSha256: factsHash(facts),
      },
      output: {
        answer: "Contract-only synthetic answer.",
        toolCalls: [],
        userActions: [],
        stateDiff: [],
        claims: [
          {
            text: "Synthetic task exists",
            kind: "fact",
            sourceRefs: [`tasks:${facts.tasks[0].id}`],
          },
        ],
      },
      assessment: {
        reviewer: "contract-test",
        notes: "Tests structure only; no model score.",
        redLines: Object.fromEntries(
          dataset.redLines.map((key) => [key, "not_checked"]),
        ),
        expectedBehavior: testCase.expectedBehavior.map(() => "not_checked"),
        forbiddenBehavior: testCase.forbiddenBehavior.map(() => "not_checked"),
        quality: Object.fromEntries(
          [
            "necessaryQuestions",
            "actionable",
            "preservesGoal",
            "conciseEvidence",
            "fitsConstraints",
          ].map((key) => [key, "not_checked"]),
        ),
      },
    },
  ];
  return run;
}

test("24 fixed cases cover three categories, twelve required risks and six repeated samples", () => {
  const result = validateCases(dataset);
  assert.equal(result.caseCount, 24);
  assert.deepEqual(Object.values(result.categoryCounts), [8, 8, 8]);
  assert.deepEqual(Object.values(result.repeatSamples), [2, 2, 2]);
});

test("coverage cannot be weakened by removing a required tag or case", () => {
  const copy = structuredClone(dataset);
  copy.cases.forEach((item) => {
    item.tags = item.tags.filter((tag) => tag !== "simple-task");
  });
  assert.throws(() => validateCases(copy));
  assert.throws(
    () => validateCases({ ...dataset, cases: dataset.cases.slice(1) }),
    /At least 24/,
  );
});

test("duplicate ids and broken fixture relations fail", () => {
  const copy = structuredClone(dataset);
  copy.cases[1].id = copy.cases[0].id;
  assert.throws(() => validateCases(copy), /Duplicate case/);
  const other = structuredClone(dataset);
  other.fixtures["three-steps-v1"].steps[0].taskId = "missing-task";
  assert.throws(() => validateCases(other), /missing task/);
});

test("unrun results retain zero completed evidence and cannot claim an answer", () => {
  const run = emptyResults(dataset);
  const result = validateResults(dataset, run);
  assert.equal(result.completed, 0);
  assert.equal(result.notRun, 24);
  assert.equal(result.modelCoverageComplete, false);
  run.records[0].output = { answer: "invented success" };
  assert.throws(() => validateResults(dataset, run), /invented evidence/);
});

test("evidence requires matching fact hashes and existing references", () => {
  const run = evidenceFixture();
  assert.equal(validateResults(dataset, run).completed, 1);
  run.records[0].input.facts.tasks[0].title = "changed after capture";
  assert.throws(() => validateResults(dataset, run), /hash mismatch/);
  const other = evidenceFixture();
  other.records[0].output.claims[0].sourceRefs = ["sessions:missing"];
  assert.throws(() => validateResults(dataset, other), /nonexistent evidence/);
});

test("an incomplete model sample never certifies coverage or release readiness", () => {
  const run = evidenceFixture();
  run.records[0].assessment.redLines["permission-boundary"] = "fail";
  const result = validateResults(dataset, run);
  assert.equal(result.redLineFailures, 1);
  assert.equal(result.missingCases.length, 23);
  assert.equal(result.modelCoverageComplete, false);
  assert.equal(result.releaseDecision, "requires-evidence-review");
});

test("model metadata rejects credentials and tool traces cannot omit status", () => {
  const run = evidenceFixture();
  run.model.settings.api_key = "synthetic-value";
  assert.throws(() => validateResults(dataset, run), /credentials/);
  const other = evidenceFixture();
  other.records[0].output.toolCalls = [
    { id: "call-1", name: "get_daily_record", arguments: {}, result: {} },
  ];
  assert.throws(() => validateResults(dataset, other), /tool trace/);
});

test("execution errors need real error details and cannot receive a quality score", () => {
  const run = evidenceFixture();
  run.records[0].status = "failed";
  run.records[0].error =
    "Synthetic connection failure for validator contract test";
  assert.throws(() => validateResults(dataset, run), /not a quality score/);
  run.records[0].assessment = null;
  assert.equal(validateResults(dataset, run).failed, 1);
});
