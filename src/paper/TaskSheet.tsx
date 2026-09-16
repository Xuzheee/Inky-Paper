import { useState } from "react";
import { Check, ChevronDown, Pencil } from "lucide-react";
import type { DayItem, PlanStep, State, Task } from "./paperTypes";
import { localDate } from "./DayPlan";
import { PencilStrike } from "./PencilStrike";
import { planningViews, type PlanRow } from "../shared/planning";

export function TaskSheet({
  data,
  selectedTaskId,
  selectedStepId,
  busy,
  hasSession,
  choose,
  selectTask,
  edit,
  complete,
  completeStep,
  date = localDate(),
}: {
  data: State;
  selectedTaskId?: string;
  selectedStepId?: string;
  busy: boolean;
  hasSession: boolean;
  choose: (step: PlanStep, item?: DayItem) => Promise<void>;
  selectTask: (task: Task) => void;
  edit: (task: Task) => void;
  complete: (task: Task) => Promise<void>;
  completeStep: (step: PlanStep) => Promise<void>;
  date?: string;
}) {
  const [scope, setScope] = useState<"today" | "all">("today");
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const locked = busy || hasSession;
  const plans = planningViews(data, date);
  const itemFor = (step: PlanStep) =>
    plans.today.find((row) => row.step?.id === step.id)?.item;
  const metadata = (task: Task, step?: PlanStep) => (
    <div className="sheet-metadata">
      <span>
        优先级：
        {{ high: "高", medium: "中", low: "低" }[task.priority] ||
          task.priority}
      </span>
      {task.due && <span>截止备注：{task.due}</span>}
      {task.dueDate && <span>截止日期：{task.dueDate}</span>}
      {step?.expectedResult && <span>做到：{step.expectedResult}</span>}
    </div>
  );
  const queueRow = ({ task, step, item }: PlanRow, index: number) => {
    if (!step) return null;
    const key = item?.id || step.id;
    const expanded = expandedItem === key;
    const current =
      selectedTaskId === task.id &&
      (selectedStepId ?? task.nextAction?.id) === step.id;
    return (
      <article
        key={key}
        className="sheet-task sheet-queue-item"
        data-plan-item-id={item?.id}
        data-step-id={step.id}
        data-current={current}
        data-completed={step.completed}
      >
        <div className="sheet-task-heading">
          <button
            className="sheet-task-toggle"
            data-strike-row
            data-strike-enabled={!locked && !task.completed && !step.completed}
            aria-expanded={expanded}
            aria-controls={`queue-step-${key}`}
            onClick={() => setExpandedItem(expanded ? null : key)}
          >
            <span className="sheet-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <PencilStrike
              text={step.text}
              revision={step.revision}
              completed={step.completed}
              disabled={locked || task.completed}
              className="sheet-task-name"
              complete={() => completeStep(step)}
            />
            <span className="sheet-count">
              {Math.round(step.plannedSeconds / 60)} 分
            </span>
            <ChevronDown
              data-strike-ignore
              size={13}
              className={expanded ? "turned" : ""}
              aria-hidden="true"
            />
          </button>
          <button
            className="sheet-mark"
            disabled={locked || task.completed}
            aria-label={`${step.completed ? "撤销步骤完成" : "完成步骤"}：${step.text}`}
            aria-pressed={step.completed}
            onClick={() => void completeStep(step)}
          >
            {step.completed && <Check size={12} strokeWidth={2.2} />}
          </button>
        </div>
        {expanded && (
          <div
            className="sheet-steps sheet-queue-detail"
            id={`queue-step-${key}`}
          >
            {task.title !== step.text && (
              <p className="sheet-parent-name">{task.title}</p>
            )}
            {metadata(task, step)}
            <p className="sheet-step-meta">
              {step.completed
                ? "这一步已划掉"
                : task.completed
                  ? "所属任务已完成"
                  : current
                    ? "便签当前这步"
                    : "先放到便签，start 才开始计时"}
            </p>
            {!step.completed && !task.completed && (
              <button
                className="sheet-use"
                disabled={locked}
                aria-label={`Do this：${step.text}`}
                aria-pressed={current}
                onClick={() => void choose(step, item)}
              >
                Do this
              </button>
            )}
            {hasSession && (
              <p className="sheet-session-hint">这一轮结束后，再调整步骤。</p>
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
  };
  const stepRow = (task: Task, step: PlanStep) => {
    const current =
      selectedTaskId === task.id &&
      (selectedStepId ?? task.nextAction?.id) === step.id;
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
          {step.expectedResult && (
            <span className="sheet-step-meta">做到：{step.expectedResult}</span>
          )}
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
        <h2>{scope === "today" ? "今日步骤" : "全部任务"}</h2>
        <span>
          {scope === "today"
            ? `${plans.today.filter((row) => row.step?.completed).length}/${plans.today.length} 步已完成`
            : `${data.tasks.filter((task) => !task.completed).length} 件待办`}
        </span>
      </div>
      <div className="sheet-scopes" aria-label="任务清单范围">
        <button
          aria-pressed={scope === "today"}
          onClick={() => setScope("today")}
        >
          今天
        </button>
        <span aria-hidden="true">·</span>
        <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>
          全部任务
        </button>
      </div>
      <p className="sheet-hint">Do this 放到便签；横划文字或勾选可完成。</p>
      {scope === "today" && (
        <>
          {plans.today.map(queueRow)}
          {!plans.today.length && (
            <div className="sheet-empty">
              <p>今天还没有安排。可以从未安排事项开始，也可以临时做一件。</p>
              {!!plans.unplanned.length && (
                <details className="sheet-unplanned">
                  <summary>未安排事项 · {plans.unplanned.length}</summary>
                  {plans.unplanned.map((row, index) =>
                    row.step ? (
                      queueRow(row, index)
                    ) : (
                      <div key={row.task.id} className="sheet-simple-detail">
                        <span>{row.task.title}</span>
                        <button
                          className="sheet-use"
                          disabled={locked}
                          aria-label={`Do this：${row.task.title}`}
                          onClick={() => selectTask(row.task)}
                        >
                          Do this
                        </button>
                      </div>
                    ),
                  )}
                </details>
              )}
            </div>
          )}
        </>
      )}
      {scope === "all" &&
        data.tasks.map((task, index) => {
          const steps =
            data.planning?.steps.filter((step) => step.taskId === task.id) ||
            [];
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
                  {metadata(task)}
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
