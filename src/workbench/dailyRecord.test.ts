import { describe, expect, it } from "vitest";
import { dailyStats, type DailyRecord } from "./dailyRecord";
const base = (): DailyRecord => ({
  date: "2026-09-15",
  utcOffsetMinutes: 480,
  planItems: [],
  sessions: [],
  manualStepChanges: [],
  notes: [],
  workBlocks: [],
  summaries: [],
  personalNotes: "",
  sampledAt: 0,
});
describe("daily completion and time facts", () => {
  it("counts an end-of-session completion on the end day only and separates rest", () => {
    const record = base();
    record.sessions = [
      {
        id: "cross",
        action: { id: "step-a" },
        kind: "focus",
        dailySeconds: 90,
        endedAt: Date.parse("2026-09-16T00:01:00+08:00"),
        feedback: { outcome: "step_completed" },
      },
      { id: "rest", kind: "rest", dailySeconds: 60 },
    ] as DailyRecord["sessions"];
    expect(dailyStats(record)).toMatchObject({
      workSeconds: 90,
      restSeconds: 60,
      completed: 0,
    });
    expect(dailyStats({ ...record, date: "2026-09-16" }).completed).toBe(1);
  });
  it("deduplicates repeated completions and applies the last manual undo without inferring completion from clock time", () => {
    const record = base();
    const at = Date.parse("2026-09-15T10:00:00+08:00");
    record.sessions = [
      {
        id: "one",
        action: { id: "step-a" },
        kind: "focus",
        dailySeconds: 600,
        endedAt: at,
        feedback: { outcome: "step_completed" },
      },
      {
        id: "two",
        action: { id: "step-b" },
        kind: "focus",
        dailySeconds: 1200,
        endedAt: at,
        feedback: { outcome: "continue" },
      },
    ] as DailyRecord["sessions"];
    record.manualStepChanges = [
      { id: "first", stepId: "step-a", recordedAt: at + 1, completed: true },
      { id: "last", stepId: "step-a", recordedAt: at + 2, completed: false },
    ] as DailyRecord["manualStepChanges"];
    expect(dailyStats(record)).toMatchObject({
      completed: 0,
      workSeconds: 1800,
    });
    record.manualStepChanges?.push({
      id: "again",
      stepId: "step-a",
      recordedAt: at + 3,
      completed: true,
    } as NonNullable<DailyRecord["manualStepChanges"]>[number]);
    expect(dailyStats(record).completed).toBe(1);
  });
});
