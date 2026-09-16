import type { DayItem, PlanStep, State, Task } from "../paper/paperTypes";

export type PlanRow = { task: Task; step?: PlanStep; item?: DayItem };
export type LeftoverPlan = {
  task: Task;
  step: PlanStep;
  items: DayItem[];
  rescheduled: boolean;
};
export type PlanningViews = {
  rows: PlanRow[];
  today: PlanRow[];
  unplanned: PlanRow[];
  leftovers: LeftoverPlan[];
};

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const stepKey = (taskId: string, stepId: string) =>
  JSON.stringify([taskId, stepId]);

/** Shared current-state views. Objects are the original references, not historical snapshots. */
export function planningViews(state: State, today: string): PlanningViews {
  const tasks = new Map(state.tasks.map((task) => [task.id, task]));
  const steps = new Map(
    (state.planning?.steps || []).map((step) => [step.id, step]),
  );
  const rows: PlanRow[] = [];
  const planned = new Set<string>();
  const rescheduled = new Set<string>();
  for (const item of state.planning?.dayItems || []) {
    if (item.removedAt != null) continue;
    const task = tasks.get(item.taskId);
    const step = steps.get(item.stepId);
    // A dangling or mismatched reference is not an executable arrangement.
    if (!task || !step || step.taskId !== task.id) continue;
    rows.push({ task, step, item });
    const key = stepKey(task.id, step.id);
    planned.add(key);
    if (item.date >= today) rescheduled.add(key);
  }
  rows.sort(
    (a, b) =>
      compareText(a.item!.date, b.item!.date) ||
      a.item!.order - b.item!.order ||
      compareText(a.item!.id, b.item!.id),
  );

  const byTask = new Map<string, PlanStep[]>();
  for (const step of steps.values()) {
    const siblings = byTask.get(step.taskId) || [];
    siblings.push(step);
    byTask.set(step.taskId, siblings);
  }
  const unplanned: PlanRow[] = [];
  for (const task of state.tasks) {
    if (task.completed) continue;
    const siblings = byTask.get(task.id) || [];
    if (siblings.length === 0) unplanned.push({ task });
    for (const step of siblings) {
      if (!step.completed && !planned.has(stepKey(task.id, step.id))) {
        unplanned.push({ task, step });
      }
    }
  }

  const groups = new Map<string, LeftoverPlan>();
  for (const { task, step, item } of rows) {
    if (
      !step ||
      !item ||
      task.completed ||
      step.completed ||
      item.date >= today ||
      item.resolvedAt != null
    )
      continue;
    const key = stepKey(task.id, step.id);
    let group = groups.get(key);
    if (!group) {
      group = { task, step, items: [], rescheduled: rescheduled.has(key) };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return {
    rows,
    today: rows.filter((row) => row.item!.date === today),
    unplanned,
    leftovers: [...groups.values()],
  };
}

/** Only the latest finished focus session for this exact step can provide its next cue. */
export function latestStepCue(
  state: State,
  taskId: string,
  stepId: string,
): { text: string; sessionId: string } | null {
  let latest: State["sessions"][number] | undefined;
  for (const session of state.sessions) {
    if (
      session.taskId !== taskId ||
      session.action?.id !== stepId ||
      session.kind !== "focus" ||
      session.status !== "finished"
    )
      continue;
    const at = session.endedAt ?? session.startedAt;
    const latestAt = latest ? (latest.endedAt ?? latest.startedAt) : -Infinity;
    if (
      at > latestAt ||
      (at === latestAt && latest && compareText(session.id, latest.id) > 0)
    )
      latest = session;
  }
  if (!latest) return null;
  const text = latest.feedback?.nextCue?.trim() || latest.resumeCue?.trim();
  return text ? { text, sessionId: latest.id } : null;
}
