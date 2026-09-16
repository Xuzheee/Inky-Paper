import { describe, expect, it } from "vitest";
import type {
  DayItem,
  PlanStep,
  Session,
  State,
  Task,
} from "../paper/paperTypes";
import { latestStepCue, planningViews, taskCompletionPrompt } from "./planning";

const TODAY = "2030-03-04";
const task = (id: string): Task => ({
  id,
  title: `Task ${id}`,
  due: null,
  category: "work",
  priority: "medium",
  completed: false,
  nextAction: null,
  revision: 1,
  source: "user",
  updatedAt: 1,
});
const step = (id: string, taskId = "A"): PlanStep => ({
  id,
  taskId,
  text: `Step ${id}`,
  expectedResult: null,
  plannedSeconds: 900,
  completed: false,
  revision: 1,
});
const item = (
  id: string,
  stepId: string,
  order: number,
  date = TODAY,
  taskId = "A",
): DayItem => ({
  id,
  stepId,
  taskId,
  order,
  date,
  revision: 1,
  removedAt: null,
});
const state = (): State => ({
  tasks: [task("A"), task("B")],
  notes: [],
  sessions: [],
  coach: {
    blocks: [],
    proposals: [],
    analysisStatus: "",
    settings: { enabled: false, hermes: false, revision: 1 },
    activities: [],
  },
  planning: { steps: [step("a1"), step("a2"), step("b1", "B")], dayItems: [] },
});
const session = (
  id: string,
  stepId: string,
  endedAt: number,
  cue: string | null,
): Session => ({
  id,
  taskId: "A",
  taskTitle: "Task A",
  action: {
    id: stepId,
    text: `Step ${stepId}`,
    completed: false,
    source: "user",
  },
  kind: "focus",
  status: "finished",
  revision: 1,
  plannedSeconds: 900,
  elapsedSeconds: 900,
  lastResumedAt: null,
  startedAt: endedAt - 900000,
  endedAt,
  pauseCount: 0,
  resumeCue: null,
  feedback: { outcome: "continue", output: null, blocker: null, nextCue: cue },
});

describe("shared planning views", () => {
  it("keeps global A → B → A order, deterministic ties and original references without mutation", () => {
    const data = state();
    const items = [
      item("three", "a2", 3),
      item("two", "b1", 2, TODAY, "B"),
      item("one", "a1", 1),
      item("zero", "a1", 0, "2030-03-03"),
    ];
    data.planning!.dayItems = items;
    const before = structuredClone(data);
    const result = planningViews(data, TODAY);
    expect(result.today.map((row) => row.task.id)).toEqual(["A", "B", "A"]);
    expect(result.rows.map((row) => row.item!.id)).toEqual([
      "zero",
      "one",
      "two",
      "three",
    ]);
    expect(result.today[0].task).toBe(data.tasks[0]);
    expect(result.today[0].step).toBe(data.planning!.steps[0]);
    expect(result.today[0].item).toBe(items[2]);
    expect(data).toEqual(before);
    data.planning!.dayItems = [item("z", "a1", 1), item("a", "a2", 1)];
    expect(planningViews(data, TODAY).today.map((row) => row.item!.id)).toEqual(
      ["a", "z"],
    );
  });

  it("does not treat future arrangements as unplanned or move them into today", () => {
    const data = state();
    data.planning!.dayItems = [item("future", "a1", 1, "2030-03-06")];
    const result = planningViews(data, TODAY);
    expect(result.today).toEqual([]);
    expect(result.unplanned.map((row) => row.step?.id)).toEqual(["a2", "b1"]);
    expect(result.rows[0].item!.date).toBe("2030-03-06");
  });

  it("retains manually completed steps and completed parents in today's positions but not leftovers", () => {
    const data = state();
    data.planning!.steps[0].completed = true;
    data.tasks[1].completed = true;
    data.planning!.dayItems = [
      item("a-today", "a1", 0),
      item("a-past", "a1", 0, "2030-03-03"),
      item("b-today", "b1", 1, TODAY, "B"),
      item("b-past", "b1", 1, "2030-03-03", "B"),
    ];
    const result = planningViews(data, TODAY);
    expect(result.today.map((row) => row.item!.id)).toEqual([
      "a-today",
      "b-today",
    ]);
    expect(result.leftovers).toEqual([]);
    expect(result.unplanned.map((row) => row.step!.id)).toEqual(["a2"]);
    expect(data.sessions).toEqual([]);
  });

  it("canceling only one of several arrangements does not return the step to unplanned", () => {
    const data = state();
    const canceled = {
      ...item("removed", "a1", 0, "2030-03-03"),
      removedAt: 100,
    };
    const remaining = item("remaining", "a1", 0, "2030-03-05");
    data.planning!.dayItems = [canceled, remaining];
    expect(
      planningViews(data, TODAY).unplanned.some((row) => row.step?.id === "a1"),
    ).toBe(false);
    remaining.removedAt = 101;
    expect(
      planningViews(data, TODAY).unplanned.some((row) => row.step?.id === "a1"),
    ).toBe(true);
  });

  it("groups past arrangements once per task/step and marks today or future rescheduling", () => {
    const data = state();
    data.planning!.dayItems = [
      item("old-two", "a1", 1, "2030-03-03"),
      item("old-one", "a1", 0, "2030-03-02"),
      item("today", "a1", 0),
      item("other-old", "a2", 2, "2030-03-03"),
    ];
    const result = planningViews(data, TODAY);
    expect(result.leftovers).toHaveLength(2);
    expect(result.leftovers[0].items.map((row) => row.id)).toEqual([
      "old-one",
      "old-two",
    ]);
    expect(result.leftovers[0].rescheduled).toBe(true);
    expect(result.leftovers[1].rescheduled).toBe(false);
    data.planning!.dayItems[2].date = "2030-03-06";
    expect(planningViews(data, TODAY).leftovers[0].rescheduled).toBe(true);
  });

  it("keeps resolved past arrangements available for history but not the unresolved queue", () => {
    const data = state();
    data.planning!.dayItems = [
      {
        ...item("handled", "a1", 1, "2030-03-03"),
        resolvedAt: 0,
        resolution: "continued",
        continuedTo: "today",
      },
      item("today", "a1", 1),
    ];
    const result = planningViews(data, TODAY);
    expect(result.rows.map((row) => row.item!.id)).toEqual([
      "handled",
      "today",
    ]);
    expect(result.leftovers).toEqual([]);
    expect(result.unplanned.some((row) => row.step?.id === "a1")).toBe(false);
  });

  it("supports old states without planning and excludes dangling arrangements", () => {
    const data = state();
    delete data.planning;
    expect(
      planningViews(data, TODAY).unplanned.map((row) => row.task.id),
    ).toEqual(["A", "B"]);
    data.planning = {
      steps: [step("a1")],
      dayItems: [
        item("wrong-parent", "a1", 0, TODAY, "B"),
        item("missing-step", "gone", 1),
      ],
    };
    const result = planningViews(data, TODAY);
    expect(result.rows).toEqual([]);
    expect(result.unplanned.map((row) => [row.task.id, row.step?.id])).toEqual([
      ["A", "a1"],
      ["B", undefined],
    ]);
  });
});

describe("shared step continuation cue", () => {
  it("resolves A → B → A by exact step and latest finished focus, ignoring rest or active sessions", () => {
    const data = state();
    data.sessions = [
      session("a-old", "a1", 1000000, "旧起点"),
      session("b", "a2", 2000000, "B 的起点"),
      session("a-new", "a1", 3000000, "  从第三项开始  "),
      { ...session("rest", "a1", 4000000, "休息不应覆盖"), kind: "rest" },
      { ...session("active", "a1", 5000000, "草稿不能覆盖"), status: "paused" },
    ];
    expect(latestStepCue(data, "A", "a1")).toEqual({
      text: "从第三项开始",
      sessionId: "a-new",
    });
    expect(latestStepCue(data, "A", "a2")).toEqual({
      text: "B 的起点",
      sessionId: "b",
    });
    expect(latestStepCue(data, "B", "a1")).toBeNull();
  });

  it("uses the latest session's resume cue and never revives an older cue when the latest has none", () => {
    const data = state();
    data.sessions = [
      session("old", "a1", 1000000, "旧起点"),
      { ...session("new", "a1", 2000000, " "), resumeCue: " 暂停前的位置 " },
    ];
    expect(latestStepCue(data, "A", "a1")).toEqual({
      text: "暂停前的位置",
      sessionId: "new",
    });
    data.sessions[1].resumeCue = null;
    expect(latestStepCue(data, "A", "a1")).toBeNull();
  });
});

describe("parent completion acknowledgement", () => {
  it("survives text edits but reappears after new completion facts or new steps", () => {
    const data=state();
    data.planning!.steps.forEach(s=>{if(s.taskId==="A")s.completed=true;});
    const prompt=taskCompletionPrompt(data,"A")!;
    expect(prompt.completionKey).toBe('["A",[["a1",[],[]],["a2",[],[]]]]');
    data.planning!.taskCompletionAcknowledgements=[{taskId:"A",completionKey:prompt.completionKey,acknowledgedAt:1}];
    data.tasks[0].title="新标题"; data.tasks[0].revision++;
    expect(taskCompletionPrompt(data,"A")).toBeNull();
    data.planning!.manualStepChanges=[{id:"redo",taskId:"A",stepId:"a1",taskTitle:"旧标题",stepText:"原步骤",completed:true,recordedAt:2}];
    expect(taskCompletionPrompt(data,"A")).not.toBeNull();
    data.planning!.steps.push(step("new"));
    expect(taskCompletionPrompt(data,"A")).toBeNull();
    data.planning!.steps.at(-1)!.completed=true;
    expect(taskCompletionPrompt(data,"A")).not.toBeNull();
  });
});
