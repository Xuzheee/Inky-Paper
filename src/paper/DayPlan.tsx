import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DayItem, PlanStep, Session, State, Task } from "./paperTypes";
import { planningViews } from "../shared/planning";
import "./day-plan.css";

export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
type Mutate = (
  action: string,
  input: Record<string, unknown>,
) => Promise<Record<string, unknown> | null>;
type DailyRecord = {
  date: string;
  sessions: (Session & { dailySeconds: number; timePrecision: string })[];
  summaries: {
    id: string;
    body: string;
    sourceAsOf: number;
    hasNewRecords: boolean;
  }[];
  personalNotes: string;
  manualStepChanges?: {
    id: string;
    taskTitle: string;
    stepText: string;
    completed: boolean;
    recordedAt: number;
  }[];
};

export function TaskSteps({
  task,
  data,
  busy,
  choose,
}: {
  task: Task;
  data: State;
  busy: boolean;
  choose: (step: PlanStep) => Promise<void>;
}) {
  const steps = data.planning?.steps.filter((s) => s.taskId === task.id) || [];
  if (steps.length < 2) return null;
  return (
    <details className="plan-steps">
      <summary>
        完整步骤 · {steps.filter((s) => s.completed).length}/{steps.length}
      </summary>
      {steps.map((step) => (
        <button
          key={step.id}
          type="button"
          className={`plan-step ${step.completed ? "crossed" : ""}`}
          disabled={busy || step.completed || task.nextAction?.id === step.id}
          onClick={() => void choose(step)}
        >
          <span>
            {step.completed ? "✓" : task.nextAction?.id === step.id ? "→" : "○"}
          </span>
          <span>{step.text}</span>
        </button>
      ))}
    </details>
  );
}

export function DayPlan({
  data,
  busy,
  hasSession,
  mutate,
  choose,
  reportError,
}: {
  data: State;
  busy: boolean;
  hasSession: boolean;
  mutate: Mutate;
  choose: (step: PlanStep, item?: DayItem) => Promise<void>;
  reportError: (message: string) => void;
}) {
  const [date, setDate] = useState(localDate);
  const [record, setRecord] = useState<DailyRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const serial = useRef(0);
  const stateKey = JSON.stringify([data.planning, data.sessions, data.notes]);
  useEffect(() => {
    if (!date) return;
    const id = ++serial.current;
    setLoading(true);
    setLoadError("");
    setRecord(null);
    void invoke<DailyRecord>("paper_execute", {
      action: "get_daily_record",
      input: { date, utcOffsetMinutes: -new Date().getTimezoneOffset() },
    })
      .then((result) => {
        if (id === serial.current) setRecord(result);
      })
      .catch((error) => {
        if (id === serial.current) setLoadError(String(error));
      })
      .finally(() => {
        if (id === serial.current) setLoading(false);
      });
    return () => {
      serial.current++;
    };
  }, [date, stateKey]);
  const prepared = planningViews(data, date).today;
  const items = prepared.map((row) => row.item!);
  const done = prepared.filter((x) => x.step?.completed).length;
  const open = async (personal = false) => {
    try {
      await invoke("open_work_journal", { date, personal });
    } catch (e) {
      reportError(String(e));
    }
  };
  return (
    <section className="day-plan-view">
      <h1>一天的安排</h1>
      <label className="plan-date">
        日期
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <div className="plan-day-heading">
        <h2>{date === localDate() ? "今日卡片" : "这一天的卡片"}</h2>
        <span>
          {done}/{items.length} 步完成
        </span>
      </div>
      {items.length === 0 && (
        <p className="empty">
          还没有安排卡片。在 Hermes 询问 Coach，选择想做的卡片后，会出现在这里。
        </p>
      )}
      <div className="plan-card-list">
        {prepared.map(({ item, step, task }) => (
          <article className="plan-card" key={item!.id}>
            <small>{task?.title || "任务暂不可用"}</small>
            <h2 className={step?.completed ? "crossed" : ""}>
              {step?.text || "步骤暂不可用"}
            </h2>
            {step?.expectedResult && <p>做到：{step.expectedResult}</p>}
            <div className="plan-card-state">
              <span>
                {step?.completed
                  ? "这一步已完成"
                  : task?.completed
                    ? "所属任务已完成"
                    : "待继续"}
              </span>
              <span>
                首轮 {Math.round((step?.plannedSeconds || 1500) / 60)} 分钟
              </span>
            </div>
            {step && !step.completed && task && !task.completed && (
              <button
                className="outline"
                disabled={busy || hasSession}
                onClick={() => void choose(step, item)}
              >
                {hasSession ? "先完成当前一轮" : "准备这一轮"}
              </button>
            )}
            <button
              className="text-button tiny"
              disabled={busy}
              onClick={() =>
                void mutate("remove_plan_item", {
                  planItemId: item!.id,
                  expectedRevision: item!.revision,
                })
              }
            >
              移出这一天
            </button>
          </article>
        ))}
      </div>
      <div className="plan-day-heading">
        <h2>实际记录</h2>
        <button
          className="text-button tiny"
          disabled={!date}
          onClick={() => void open()}
        >
          打开 Markdown
        </button>
      </div>
      {loading && <p role="status">正在读取这一天…</p>}
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {record && (
        <>
          <p className="muted">
            {record.sessions.length} 条计时记录 · 本日计时{" "}
            {Math.floor(
              record.sessions.reduce((n, s) => n + s.dailySeconds, 0) / 60,
            )}{" "}
            分钟（含休息）
          </p>
          {record.sessions.map((session) => (
            <details className="plan-session" key={session.id}>
              <summary>
                {session.action?.text || session.taskTitle} ·{" "}
                {Math.floor(session.dailySeconds / 60)} 分
              </summary>
              <p>
                {session.feedback?.outcome === "step_completed"
                  ? "这一步完成了"
                  : session.status === "finished"
                    ? "本轮已结束"
                    : "本轮未结束"}
              </p>
              {session.feedback?.output && (
                <p>产出：{session.feedback.output}</p>
              )}
              {session.feedback?.blocker && (
                <p>卡点：{session.feedback.blocker}</p>
              )}
              {session.feedback?.nextCue && (
                <p>下次：{session.feedback.nextCue}</p>
              )}
              <p className="caption">
                {session.timePrecision === "legacy_start_date"
                  ? "早期记录按开始日期归档，无法还原跨日分配。"
                  : "按实际计时区间计入这一天，暂停时间不计入。"}
              </p>
            </details>
          ))}
          {!!record.manualStepChanges?.length && (
            <section aria-label="手动步骤记录">
              <h2>手动记录</h2>
              {record.manualStepChanges.map((change) => (
                <details className="plan-session" key={change.id}>
                  <summary>
                    {change.completed ? "手动完成" : "撤销完成"} ·{" "}
                    {change.stepText}
                  </summary>
                  <p>
                    {change.taskTitle} ·{" "}
                    {new Date(change.recordedAt).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </details>
              ))}
            </section>
          )}
          <h2>每日工作总结</h2>
          {!record.summaries.length && (
            <p className="muted">
              在 Hermes 询问“总结 {date} 的工作”，Coach
              会读取这里的记录。不会自动发起总结。
            </p>
          )}
          {[...record.summaries].reverse().map((summary) => (
            <details key={summary.id} className="plan-summary" open>
              <summary>
                Coach 总结 · 截至{" "}
                {new Date(summary.sourceAsOf).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </summary>
              <p className="plan-summary-body">{summary.body}</p>
              {summary.hasNewRecords && (
                <p className="muted">
                  此后有新记录；需要时可以询问 Coach 更新。
                </p>
              )}
            </details>
          ))}
        </>
      )}
      <button
        className="outline"
        disabled={!date}
        onClick={() => void open(true)}
      >
        写个人复盘
      </button>
      <p className="caption">个人笔记单独保存，自动同步不会改写。</p>
    </section>
  );
}
