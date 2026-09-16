import { Check, FileText, RotateCcw } from "lucide-react";
import { dailyStats, durationLabel, type DailySummary } from "./dailyRecord";
import type { DayEntry } from "./useDailyRecords";
import TaskMetadata from "./TaskMetadata";
import type { DayItem, State } from "../paper/paperTypes";
import { planItemLabel } from "./LeftoverPlans";
import SummaryEvidence from "./SummaryEvidence";
import type { Row } from "./model";

const changeLabels: Record<string, string> = {
  workbench_save_step: "保存安排",
  workbench_move_item: "改期或调整顺序",
  continue_plan_items: "继续原步骤",
  cancel_plan_items: "取消安排",
  adopt_plan_cards: "采用候选",
  remove_plan_item: "移除安排",
};
const snapshotLabel = (item: DayItem | null) =>
  !item
    ? "尚无这条安排"
    : `${planItemLabel(item)} · ${item.removedAt != null ? "已取消" : item.resolvedAt != null ? "旧安排已处理" : "有效安排"}`;

const at = (value: number) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export default function DailyJournal({
  date,
  entry,
  openMarkdown,
  state,
  blocked,
  onContinue,
  onPrepareToday,
}: {
  date: string;
  entry?: DayEntry;
  openMarkdown: (kind?: string) => void;
  state?: State;
  blocked?: boolean;
  onContinue?: (row: Row) => void | Promise<void>;
  onPrepareToday?: (summary: DailySummary) => void;
}) {
  const record = entry?.record;
  if (entry?.error)
    return (
      <div className="wk-journal" role="alert">
        读取 {date} 的记录失败：{entry.error}
      </div>
    );
  if (!record)
    return (
      <div className="wk-journal" role="status">
        正在读取 {date} 的记录…
      </div>
    );
  const stats = dailyStats(record);
  return (
    <article className="wk-journal" aria-label={`${date}每日记录`}>
      <div className="wk-journal-heading">
        <div>
          <h3>{date} · 每日记录</h3>
          <p>与 Inky 的任务和执行记录同步</p>
        </div>
        <button onClick={() => openMarkdown("day")}>
          <FileText size={17} />
          Markdown 原文
        </button>
      </div>
      {record.journal?.synced === false && (
        <p className="wk-banner wk-error" role="alert">
          {record.journal.error || "记录已保存，Markdown 尚待同步。"}
        </p>
      )}
      <div className="wk-record-stats">
        <div>
          <strong>
            {stats.planDone}
            <small> / {stats.planned}</small>
          </strong>
          <span>计划步骤当前已完成</span>
        </div>
        <div>
          <strong>
            {stats.completed}
            <small> 步</small>
          </strong>
          <span>当日确认完成</span>
        </div>
        <div>
          <strong>{durationLabel(stats.workSeconds)}</strong>
          <span>本日工作计时</span>
        </div>
      </div>
      <section className="wk-record-section">
        <h3>当天安排</h3>
        <p className="wk-record-help">
          计划显示步骤的当前状态；当天的完成和撤销保留在下方记录中。
        </p>
        {!record.planItems.length && (
          <p className="wk-record-empty">
            这一天没有安排任务，临时完成的工作也会显示在实际记录中。
          </p>
        )}
        {record.planItems.map((item) => (
          <div className="wk-record-plan" key={item.id}>
            <span
              className={`wk-record-check ${item.step?.completed ? "complete" : ""}`}
            >
              {item.step?.completed && <Check size={14} />}
            </span>
            <div>
              <h4>{item.step?.text || item.task?.title || "步骤已不可用"}</h4>
              <p>
                {item.task?.title}
                {item.task?.completed && " · 整件事已完成"}
              </p>
              {item.task && (
                <details className="wk-record-metadata">
                  <summary>当前任务信息</summary>
                  <TaskMetadata task={item.task} step={item.step} />
                </details>
              )}
            </div>
            <span>{item.step?.completed ? "当前已完成" : "未完成"}</span>
          </div>
        ))}
      </section>
      {!!record.planChanges?.length && (
        <section className="wk-record-section">
          <h3>安排变更</h3>
          <p className="wk-record-help">
            下面保留变更前后的安排快照；步骤名称取当前信息，执行记录不会随改期变化。
          </p>
          {record.planChanges.map((change) => {
            const target = change.after || change.before;
            const current = record.planItems.find(
              (item) => item.stepId === target?.stepId,
            );
            const step =
              state?.planning?.steps.find(
                (item) => item.id === target?.stepId,
              ) || current?.step;
            return (
              <details
                className="wk-record-item wk-plan-change"
                key={change.id}
              >
                <summary>
                  <span>
                    {changeLabels[change.operation] || "调整安排"}
                    {step ? ` · ${step.text}` : ""}
                  </span>
                  <small>{at(change.recordedAt)}</small>
                </summary>
                <p>
                  <strong>变更前：</strong>
                  {snapshotLabel(change.before)}
                </p>
                <p>
                  <strong>变更后：</strong>
                  {snapshotLabel(change.after)}
                </p>
                {change.before &&
                  change.after &&
                  change.before.order !== change.after.order && (
                    <p className="wk-record-help">顺序同时调整。</p>
                  )}
                {change.after?.continuedTo && (
                  <p className="wk-record-help">
                    已关联后续安排，继续使用原步骤。
                  </p>
                )}
                <p className="wk-record-help" data-step-id={target?.stepId}>
                  {step ? `对应步骤：${step.text}` : "原步骤当前不可用"}
                </p>
              </details>
            );
          })}
        </section>
      )}
      <section className="wk-record-section">
        <h3>实际记录</h3>
        <p className="wk-record-help">
          工作与休息分别计时，暂停不计入。休息计时{" "}
          {durationLabel(stats.restSeconds)}。
        </p>
        {!record.sessions.length && (
          <p className="wk-record-empty">这一天没有番茄钟记录。</p>
        )}
        {record.sessions.map((session) => (
          <details className="wk-record-item" key={session.id} open>
            <summary>
              <span>
                {session.kind === "rest"
                  ? "休息"
                  : session.action?.text || session.taskTitle}
              </span>
              <b>{durationLabel(session.dailySeconds)}</b>
            </summary>
            <p className="wk-record-time">
              {at(session.startedAt)} —{" "}
              {session.endedAt ? at(session.endedAt) : "尚未结束"}
            </p>
            {session.kind !== "rest" && (
              <p>
                {session.taskTitle} ·{" "}
                {session.feedback?.outcome === "step_completed"
                  ? `完成于 ${session.endedAt ? at(session.endedAt) : "本轮结束时"}`
                  : session.status === "finished"
                    ? "本轮已结束，步骤未确认完成"
                    : "本轮尚未结束"}
              </p>
            )}
            {session.feedback?.output && <p>产出：{session.feedback.output}</p>}
            {session.kind !== "rest" && (
              <p className="wk-record-help">
                原安排：{session.planDate || "计划外 / 未关联安排"}
              </p>
            )}
            {session.feedback?.blocker && (
              <p>卡点：{session.feedback.blocker}</p>
            )}
            {session.feedback?.nextCue && (
              <p>下次起点：{session.feedback.nextCue}</p>
            )}
            {session.timePrecision === "legacy_start_date" && (
              <p className="wk-record-help">
                早期记录按开始日期归档，无法还原跨日时间。
              </p>
            )}
          </details>
        ))}
      </section>
      <section className="wk-record-section">
        <h3>手动完成与撤销</h3>
        {!record.manualStepChanges?.length && (
          <p className="wk-record-empty">这一天没有手动步骤记录。</p>
        )}
        {record.manualStepChanges?.map((change) => (
          <div className="wk-record-manual" key={change.id}>
            {change.completed ? <Check size={18} /> : <RotateCcw size={17} />}
            <div>
              <h4>{change.stepText}</h4>
              <p>
                {change.taskTitle} ·{" "}
                {change.completed ? "手动完成" : "撤销完成"} ·{" "}
                {at(change.recordedAt)}
              </p>
            </div>
          </div>
        ))}
      </section>
      {!!record.workBlocks.length && (
        <section className="wk-record-section">
          <h3>工作时段</h3>
          {record.workBlocks.map((block) => (
            <div className="wk-record-item" key={block.id}>
              <h4>{block.goal || block.taskTitle}</h4>
              <p>
                {at(block.startedAt)} —{" "}
                {block.endedAt ? at(block.endedAt) : "尚未结束"}
              </p>
              <p>
                {(
                  {
                    achieved: "完成本段预期",
                    advanced: "推进了一些",
                    blocked: "遇到卡点",
                  } as Record<string, string>
                )[block.progress || ""] || "未填写进展"}
              </p>
              {block.output && <p>产出：{block.output}</p>}
              {block.blocker && <p>卡点：{block.blocker}</p>}
              {block.resumeCue && <p>下次起点：{block.resumeCue}</p>}
            </div>
          ))}
        </section>
      )}
      <section className="wk-record-section">
        <h3>随手记</h3>
        {record.notes.length ? (
          record.notes.map((note) => (
            <div className="wk-record-item" key={note.id}>
              <p>{note.text}</p>
              <p className="wk-record-time">
                {at(note.createdAt)}
                {note.taskTitle && ` · ${note.taskTitle}`}
              </p>
            </div>
          ))
        ) : (
          <p className="wk-record-empty">这一天没有随手记。</p>
        )}
      </section>
      <section className="wk-record-section">
        <h3>每日总结</h3>
        {record.summaries.length ? (
          [...record.summaries]
            .reverse()
            .map((summary) => (
              <SummaryEvidence
                key={summary.id}
                summary={summary}
                date={date}
                state={state}
                blocked={blocked}
                onContinue={onContinue}
                onPrepareToday={onPrepareToday}
              />
            ))
        ) : (
          <p className="wk-record-empty">
            还没有这一天的总结。需要时，可以在右侧让 Coach 总结 {date} 的工作。
          </p>
        )}
      </section>
      <button
        className="wk-record-personal"
        onClick={() => openMarkdown("personal")}
      >
        <FileText size={17} />
        查看当天个人复盘
      </button>
    </article>
  );
}
