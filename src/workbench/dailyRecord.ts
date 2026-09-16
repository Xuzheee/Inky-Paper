import type { WorkBlock } from "../paper/CoachUI";
import type {
  DayItem,
  ManualStepChange,
  PlanStep,
  PlanChange,
  Session,
  State,
  Task,
} from "../paper/paperTypes";
import { dateKey } from "./model";

export type DailyRecord = {
  date: string;
  utcOffsetMinutes: number;
  planItems: (DayItem & { task: Task | null; step: PlanStep | null })[];
  sessions: (Session & {
    dailySeconds: number;
    timePrecision: string;
    dayItemId?: string | null;
    planDate?: string | null;
  })[];
  manualStepChanges?: ManualStepChange[];
  planChanges?: PlanChange[];
  notes: State["notes"];
  workBlocks: WorkBlock[];
  summaries: {
    id: string;
    body: string;
    sourceAsOf: number;
    hasNewRecords: boolean;
  }[];
  personalNotes: string;
  sampledAt: number;
  journal?: { synced: boolean; error?: string };
};

export function dailyStats(record: DailyRecord) {
  const completions: { id: string; at: number; completed: boolean }[] = [];
  let workSeconds = 0,
    restSeconds = 0;
  for (const session of record.sessions) {
    if (session.kind === "rest") restSeconds += session.dailySeconds;
    else workSeconds += session.dailySeconds;
    // A cross-midnight session can appear on both days; completion belongs to its end day.
    if (
      session.kind !== "rest" &&
      session.feedback?.outcome === "step_completed" &&
      session.endedAt != null &&
      new Date(session.endedAt + record.utcOffsetMinutes * 60_000)
        .toISOString()
        .slice(0, 10) === record.date
    ) {
      completions.push({
        id: session.action?.id || session.id,
        at: session.endedAt,
        completed: true,
      });
    }
  }
  for (const change of record.manualStepChanges || []) {
    completions.push({
      id: change.stepId,
      at: change.recordedAt,
      completed: change.completed,
    });
  }
  const latest = new Map<string, boolean>();
  for (const change of completions.sort((a, b) => a.at - b.at))
    latest.set(change.id, change.completed);
  return {
    planned: record.planItems.length,
    planDone: record.planItems.filter((item) => item.step?.completed).length,
    completed: [...latest.values()].filter(Boolean).length,
    workSeconds,
    restSeconds,
  };
}

export function datesWithRecords(state: State | null | undefined) {
  const days = new Set<string>();
  const add = (at: number | null | undefined) => {
    if (at != null) days.add(dateKey(new Date(at)));
  };
  state?.sessions.forEach((session) => {
    add(session.startedAt);
    add(session.endedAt);
  });
  state?.notes.forEach((note) => add(note.createdAt));
  state?.coach.blocks.forEach((block) => {
    add(block.startedAt);
    add(block.endedAt);
  });
  state?.planning?.manualStepChanges?.forEach((change) =>
    add(change.recordedAt),
  );
  state?.planning?.planChanges?.forEach((change) => {
    add(change.recordedAt);
    if (change.before) days.add(change.before.date);
    if (change.after) days.add(change.after.date);
  });
  return days;
}

export function durationLabel(seconds: number) {
  if (seconds === 0) return "0 分钟";
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分钟${seconds % 60 ? ` ${seconds % 60} 秒` : ""}`;
}
