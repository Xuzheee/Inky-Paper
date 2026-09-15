import { useState } from "react";
import { Check, ChevronDown, Pencil } from "lucide-react";
import type { DayItem, PlanStep, State, Task } from "./paperTypes";
import { localDate } from "./DayPlan";
import { PencilStrike } from "./PencilStrike";

export function TaskSheet({
  data,
  selectedTaskId,
  busy,
  hasSession,
  choose,
  selectTask,
  edit,
  complete,
  completeStep,
}: {
  data: State;
  selectedTaskId?: string;
  busy: boolean;
  hasSession: boolean;
  choose: (step: PlanStep, item?: DayItem) => Promise<void>;
  selectTask: (task: Task) => void;
  edit: (task: Task) => void;
  complete: (task: Task) => Promise<void>;
  completeStep: (step: PlanStep) => Promise<void>;
}) {
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const locked = busy || hasSession;
  const itemFor = (step: PlanStep) =>
    data.planning?.dayItems.find(
      (item) =>
        item.date === localDate() && item.stepId === step.id && !item.removedAt,
    );
  const stepRow = (task: Task, step: PlanStep) => {
    const current =
      selectedTaskId === task.id && task.nextAction?.id === step.id;
    return (
      <div
        key={step.id}
        className={`sheet-step${step.completed ? " is-done" : ""}`}
        data-current={current}
        data-strike-row
        data-strike-enabled={!locked && !task.completed && !step.completed}
      >
        <button
          className="sheet-mark"
          disabled={locked || task.completed}
          aria-label={`${step.completed ? "撤销步骤完成" : "完成步骤"}：${step.text}`}
          aria-pressed={step.completed}
          onClick={() => void completeStep(step)}
        >
          {step.completed && <Check size={12} strokeWidth={2.2} />}
        </button>
        <span className="sheet-step-body">
          <PencilStrike
            text={step.text}
            revision={step.revision}
            completed={step.completed}
            disabled={locked || task.completed}
            className="sheet-step-name"
            complete={() => completeStep(step)}
          />
          <span className="sheet-step-meta">
            {step.completed
              ? "已划掉"
              : `${Math.round(step.plannedSeconds / 60)} 分钟${current ? " · 当前这步" : ""}`}
          </span>
        </span>
        {!step.completed && !task.completed && (
          <button
            className="sheet-use"
            disabled={locked}
            aria-label={`Do this：${step.text}`}
            aria-pressed={current}
            onClick={() => void choose(step, itemFor(step))}
          >
            Do this
          </button>
        )}
      </div>
    );
  };
  return (
    <section className="task-sheet" aria-label="任务清单">
      <div className="sheet-heading">
        <h2>任务</h2>
        <span>
          {data.tasks.filter((task) => !task.completed).length} 件待办
        </span>
      </div>
      <p className="sheet-hint">Do this 放到便签；横划文字或勾选可完成。</p>
      {data.tasks.map((task, index) => {
        const steps =
          data.planning?.steps.filter((step) => step.taskId === task.id) || [];
        const done = steps.filter((step) => step.completed).length;
        const expanded = expandedTask === task.id;
        const onlyStep = steps[0];
        const simpleDone =
          onlyStep?.completed ?? task.nextAction?.completed ?? false;
        return (
          <article
            className="sheet-task"
            key={task.id}
            data-current={selectedTaskId === task.id}
            data-completed={task.completed}
          >
            <div className="sheet-task-heading">
              <button
                className="sheet-task-toggle"
                data-strike-row
                data-strike-enabled={!locked && !task.completed}
                aria-expanded={expanded}
                aria-controls={`task-steps-${task.id}`}
                onClick={() => setExpandedTask(expanded ? null : task.id)}
              >
                <span className="sheet-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <PencilStrike
                  text={task.title}
                  revision={task.revision}
                  completed={task.completed}
                  disabled={locked}
                  className="sheet-task-name"
                  complete={() => complete(task)}
                />
                {steps.length > 0 && (
                  <span
                    className="sheet-count"
                    aria-label={`${done} 步已完成，共 ${steps.length} 步`}
                  >
                    {done}/{steps.length}
                  </span>
                )}
                <ChevronDown
                  data-strike-ignore
                  size={13}
                  className={expanded ? "turned" : ""}
                  aria-hidden="true"
                />
              </button>
              {task.completed ? (
                <button
                  className="sheet-undo"
                  disabled={locked}
                  aria-label={`撤销完成：${task.title}`}
                  onClick={() => void complete(task)}
                >
                  撤销
                </button>
              ) : (
                <button
                  className="sheet-edit"
                  aria-label={`编辑任务：${task.title}`}
                  disabled={busy}
                  onClick={() => edit(task)}
                >
                  <Pencil size={13} />
                </button>
              )}
            </div>
            {expanded && (
              <div className="sheet-steps" id={`task-steps-${task.id}`}>
                {steps.map((step) => stepRow(task, step))}
                {steps.length === 0 && (
                  <div
                    className={`sheet-simple-detail${simpleDone ? " is-done" : ""}`}
                  >
                    {task.nextAction?.text && (
                      <span className="pencil-line">
                        {task.nextAction.text}
                      </span>
                    )}
                    {simpleDone ? (
                      <span> · 已划掉</span>
                    ) : (
                      !task.completed && (
                        <button
                          className="sheet-use"
                          disabled={locked}
                          aria-label={`Do this：${task.title}`}
                          onClick={() => selectTask(task)}
                        >
                          Do this
                        </button>
                      )
                    )}
                  </div>
                )}
                {hasSession && (
                  <p className="sheet-session-hint">
                    这一轮结束后，再调整步骤。
                  </p>
                )}
                {!task.completed && (
                  <button
                    className="sheet-finish-task"
                    disabled={locked}
                    aria-label={`整个任务完成了：${task.title}`}
                    onClick={() => void complete(task)}
                  >
                    整个任务完成了
                  </button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
