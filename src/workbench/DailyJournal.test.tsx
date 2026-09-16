// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DailyJournal from "./DailyJournal";
import { datesWithRecords, type DailyRecord } from "./dailyRecord";
import type { DayItem, PlanChange, State } from "../paper/paperTypes";
afterEach(cleanup);
const before: DayItem = {
  id: "arrangement",
  taskId: "task",
  stepId: "step",
  date: "2030-03-03",
  revision: 1,
  order: 0,
  removedAt: null,
  startMinute: 540,
  durationMinutes: 30,
};
const after: DayItem = {
  ...before,
  date: "2030-03-06",
  revision: 2,
  startMinute: null,
  durationMinutes: null,
};
const changes: PlanChange[] = [
  {
    id: "move",
    operation: "workbench_move_item",
    source: "user",
    recordedAt: new Date(2030, 2, 4, 10).getTime(),
    before,
    after,
  },
  {
    id: "cancel",
    operation: "cancel_plan_items",
    source: "user",
    recordedAt: new Date(2030, 2, 4, 11).getTime(),
    before: after,
    after: { ...after, revision: 3, removedAt: 1 },
  },
];
const base = (): DailyRecord => ({
  date: "2030-03-04",
  utcOffsetMinutes: 480,
  planItems: [],
  sessions: [],
  planChanges: changes,
  manualStepChanges: [],
  notes: [],
  workBlocks: [],
  summaries: [],
  personalNotes: "",
  sampledAt: 1,
});

it("shows date, reservation and cancellation snapshots without replacing them with current state", () => {
  const record = base();
  render(
    <DailyJournal
      date={record.date}
      entry={{ record }}
      openMarkdown={vi.fn()}
    />,
  );
  expect(screen.getByText("安排变更")).toBeTruthy();
  expect(
    screen.getByText(/2030-03-03 · 09:00 · 预留 30 分钟 · 有效安排/),
  ).toBeTruthy();
  expect(
    screen.getAllByText(/2030-03-06 · 未定时刻 · 未填预留时长 · 有效安排/),
  ).toHaveLength(2);
  expect(
    screen.getByText(/2030-03-06 · 未定时刻 · 未填预留时长 · 已取消/),
  ).toBeTruthy();
  expect(screen.getAllByText("原步骤当前不可用")).toHaveLength(2);
  expect(screen.queryByText("step")).toBeNull();
});

it("marks original plan dates separately from actual execution, and identifies unlinked work", () => {
  const record = base();
  record.sessions = [
    {
      id: "planned",
      kind: "focus",
      taskTitle: "核对数字",
      status: "finished",
      action: { id: "step", text: "核对第三项" },
      startedAt: Date.parse("2030-03-04T09:00:00+08:00"),
      endedAt: Date.parse("2030-03-04T09:15:00+08:00"),
      dailySeconds: 900,
      timePrecision: "interval",
      planDate: "2030-03-06",
      dayItemId: "arrangement",
      feedback: null,
    },
    {
      id: "unplanned",
      kind: "focus",
      taskTitle: "临时事项",
      status: "finished",
      startedAt: Date.parse("2030-03-04T10:00:00+08:00"),
      endedAt: Date.parse("2030-03-04T10:15:00+08:00"),
      dailySeconds: 900,
      timePrecision: "interval",
      planDate: null,
      dayItemId: null,
      feedback: null,
    },
  ] as DailyRecord["sessions"];
  render(
    <DailyJournal
      date={record.date}
      entry={{ record }}
      openMarkdown={vi.fn()}
    />,
  );
  expect(screen.getByText("原安排：2030-03-06")).toBeTruthy();
  expect(screen.getByText("原安排：计划外 / 未关联安排")).toBeTruthy();
});

it("calendar record dots include the change day and both affected schedule days", () => {
  const state = {
    tasks: [],
    sessions: [],
    notes: [],
    coach: { blocks: [] },
    planning: { steps: [], dayItems: [], planChanges: changes },
  } as unknown as State;
  expect([...datesWithRecords(state)].sort()).toEqual([
    "2030-03-03",
    "2030-03-04",
    "2030-03-06",
  ]);
  expect(before.date).toBe("2030-03-03");
});
