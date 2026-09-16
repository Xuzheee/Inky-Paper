import type { DayItem, PlanStep, State, Task } from "./paperTypes";
import { planningViews } from "../shared/planning";

export type ExecutionChoice = {
  task?: Task;
  step?: PlanStep;
  item?: DayItem;
  issue?: string;
};

const displayTask = (task: Task, step?: PlanStep): Task =>
  step
    ? {
        ...task,
        nextAction: {
          id: step.id,
          text: step.text,
          completed: step.completed,
          source: task.nextAction?.source || "user",
        },
      }
    : task;

/** Resolve the same explicit step for the sticky note and start_session input. */
export function executionChoice(
  data: State,
  today: string,
  legacySelected: string,
): ExecutionChoice {
  const steps = data.planning?.steps || [];
  const prepared = data.planning?.prepared;
  if (prepared) {
    const task = data.tasks.find((task) => task.id === prepared.taskId);
    const step = steps.find(
      (step) => step.id === prepared.stepId && step.taskId === prepared.taskId,
    );
    const item = prepared.dayItemId
      ? data.planning?.dayItems.find((item) => item.id === prepared.dayItemId)
      : undefined;
    const issue =
      !task || !step
        ? "原来准备的任务或步骤已不可用，请重新选择下一步。"
        : task.completed || step.completed
          ? "原来准备的任务或步骤已完成，请重新选择下一步。"
          : prepared.dayItemId &&
              (!item ||
                item.removedAt != null ||
                item.taskId !== task.id ||
                item.stepId !== step.id)
            ? "原来的安排已取消或变化，请重新选择下一步；不会自动改成计划外执行。"
            : undefined;
    return {
      task: task ? displayTask(task, step) : undefined,
      step,
      item,
      issue,
    };
  }
  const plans = planningViews(data, today);
  const explicit = data.tasks.find(
    (task) => task.id === legacySelected && !task.completed,
  );
  const firstToday = plans.today.find(
    (row) => !row.task.completed && !row.step?.completed,
  );
  if (!explicit && firstToday)
    return {
      ...firstToday,
      task: displayTask(firstToday.task, firstToday.step),
    };
  const task = explicit || data.tasks.find((task) => !task.completed);
  const step =
    task &&
    steps.find(
      (step) => step.id === task.nextAction?.id && step.taskId === task.id,
    );
  return {
    task: task ? displayTask(task, step) : undefined,
    step,
    item: plans.today.find(
      (row) => row.task.id === task?.id && row.step?.id === step?.id,
    )?.item,
  };
}
