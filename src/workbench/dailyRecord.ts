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
import { dateKey, type Row } from "./model";

export type SummarySource = {
  kind:
    | "session"
    | "step"
    | "manualChange"
    | "note"
    | "planChange"
    | "personalNote";
  id: string;
  label: string;
  snapshot: Record<string, unknown>;
};
export type DailySummary = {
  id: string;
  body: string;
  sourceAsOf: number;
  hasNewRecords: boolean;
  evidence?: SummarySource[];
  nextStart?: {
    taskId: string;
    stepId: string;
    dayItemId: string | null;
    cue: string | null;
  } | null;
};

export function summaryContinuation(
  summary: DailySummary,
  state?: State,
): { row?: Row; reason?: string } {
  const target = summary.nextStart;
  if (!target) return {};
  if (!state) return { reason: "正在读取当前任务，请稍后再试。" };
  const task = state.tasks.find((task) => task.id === target.taskId);
  const step = state.planning?.steps.find(
    (step) => step.id === target.stepId && step.taskId === target.taskId,
  );
  if (!task || !step) return { reason: "原任务或步骤已不可用，请重新选择。" };
  if (task.completed) return { reason: "整个任务已完成，请重新选择下一步。" };
  if (step.completed) return { reason: "原步骤已完成，请重新选择下一步。" };
  const item = target.dayItemId
    ? state.planning?.dayItems.find((item) => item.id === target.dayItemId)
    : undefined;
  if (
    target.dayItemId &&
    (!item ||
      item.removedAt != null ||
      item.taskId !== task.id ||
      item.stepId !== step.id)
  )
    return { reason: "原安排已取消或变化，请重新选择；不会改为计划外执行。" };
  if (item?.resolvedAt != null)
    return { reason: "原安排已处理，请选择当前安排继续；历史来源保持不变。" };
  if (state.sessions.some((session) => session.status !== "finished"))
    return { reason: "当前一轮还未保存，请先回 Inky 结束本轮。" };
  return { row: { task, step, item } };
}

export function summaryCandidatePrompt(
  date: string,
  summary: DailySummary,
  today: string,
) {
  const excerpt =
    summary.body.length > 600
      ? `${summary.body.slice(0, 600)}…（摘要节选）`
      : summary.body;
  return `请为今天（${today}）准备下一步候选。参考 ${date} 的总结（标识 ${summary.id}；读取截至 ${new Date(summary.sourceAsOf).toLocaleString("zh-CN")}）：\n${excerpt}\n\n请先读取今天的最新任务和记录，核对旧总结之后的变化；总结中的建议不代表已经完成的事实。只生成候选，采用后再修改计划。`;
}

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
  summaries: DailySummary[];
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
