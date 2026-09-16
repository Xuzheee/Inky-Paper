import type { PlanStep, Task } from "../paper/paperTypes";

export const priorityLabels: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

/** Current shared fields, never a substitute for an execution snapshot. */
export default function TaskMetadata({
  task,
  step,
  compact = false,
}: {
  task: Task;
  step?: PlanStep | null;
  compact?: boolean;
}) {
  const priority = priorityLabels[task.priority] || task.priority;
  if (compact)
    return (
      <div className="wk-metadata-brief" aria-label="任务信息">
        <span className={`wk-priority ${task.priority}`}>{priority}优先级</span>
        {task.dueDate && <span>截止 {task.dueDate}</span>}
      </div>
    );
  return (
    <dl className="wk-task-metadata" aria-label="当前任务信息">
      <div>
        <dt>优先级</dt>
        <dd>{priority}</dd>
      </div>
      {task.dueDate && (
        <div>
          <dt>截止日期</dt>
          <dd>{task.dueDate}</dd>
        </div>
      )}
      {task.due && (
        <div>
          <dt>截止备注</dt>
          <dd>{task.due}</dd>
        </div>
      )}
      {step?.expectedResult && (
        <div>
          <dt>完成标准</dt>
          <dd>{step.expectedResult}</dd>
        </div>
      )}
    </dl>
  );
}
