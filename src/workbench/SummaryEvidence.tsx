import type { State } from "../paper/paperTypes";
import type { Row } from "./model";
import {
  durationLabel,
  summaryContinuation,
  type DailySummary,
  type SummarySource,
} from "./dailyRecord";
import "./summary-evidence.css";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const at = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toLocaleString("zh-CN", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "未记录";
const sourceNames: Record<SummarySource["kind"], string> = {
  session: "番茄钟记录",
  step: "计划步骤",
  manualChange: "手动完成与撤销",
  note: "随手记",
  planChange: "安排变更",
  personalNote: "个人笔记原句",
};
const outcome = (value: unknown) =>
  ({
    step_completed: "已确认完成这一步",
    stopped: "本轮结束，未确认步骤完成",
    rest_ended: "休息结束",
  })[text(value)] || "未填写完成情况";
const plan = (value: unknown) => {
  if (!value) return "没有这条安排";
  const item = object(value);
  const minute = item.startMinute;
  const clock =
    typeof minute === "number"
      ? `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
      : "未定时刻";
  return `${text(item.date)} · ${clock} · ${typeof item.durationMinutes === "number" ? `预留 ${item.durationMinutes} 分钟` : "未填预留时长"} · ${item.removedAt != null ? "已取消" : item.resolvedAt != null ? "旧安排已处理" : "有效安排"}${typeof item.order === "number" ? ` · 顺序 ${item.order + 1}` : ""}`;
};

function SourceSnapshot({ source }: { source: SummarySource }) {
  const snapshot = source.snapshot;
  const action = object(snapshot.action);
  const feedback = object(snapshot.feedback);
  let fields: [string, string][];
  switch (source.kind) {
    case "session":
      fields = [
        ["原任务", text(snapshot.taskTitle)],
        ["本轮步骤", text(action.text)],
        [
          "时间",
          `${at(snapshot.startedAt)} — ${snapshot.endedAt == null ? "读取时尚未结束" : at(snapshot.endedAt)}`,
        ],
        [
          snapshot.kind === "rest" ? "当日休息计时" : "当日工作计时",
          typeof snapshot.dailySeconds === "number"
            ? durationLabel(snapshot.dailySeconds)
            : "未记录",
        ],
        ["完成记录", outcome(feedback.outcome)],
        ["产出", text(feedback.output)],
        ["报告的卡点", text(feedback.blocker)],
        ["下次起点", text(feedback.nextCue) || text(snapshot.resumeCue)],
        ["原安排日期", text(snapshot.planDate) || "计划外 / 未关联安排"],
      ];
      break;
    case "step":
      fields = [
        ["步骤", text(snapshot.text)],
        [
          "读取时的状态",
          snapshot.completed === true
            ? "已完成"
            : snapshot.completed === false
              ? "未完成"
              : "未记录",
        ],
        [
          "首轮时长",
          typeof snapshot.plannedSeconds === "number"
            ? durationLabel(snapshot.plannedSeconds)
            : "未记录",
        ],
        ["预期产出", text(snapshot.expectedResult)],
      ];
      break;
    case "manualChange":
      fields = [
        ["原任务", text(snapshot.taskTitle)],
        ["步骤", text(snapshot.stepText)],
        [
          "操作",
          snapshot.completed === true
            ? "手动完成"
            : snapshot.completed === false
              ? "撤销完成"
              : "未记录",
        ],
        ["记录时间", at(snapshot.recordedAt)],
      ];
      break;
    case "note":
      fields = [
        ["原文", text(snapshot.text)],
        ["记录时间", at(snapshot.createdAt)],
        ["来源任务", text(snapshot.taskTitle)],
        ["来源步骤", text(action.text)],
      ];
      break;
    case "planChange":
      fields = [
        ["变更前", plan(snapshot.before)],
        ["变更后", plan(snapshot.after)],
        ["记录时间", at(snapshot.recordedAt)],
      ];
      break;
    case "personalNote":
      fields = [
        ["日期", text(snapshot.date)],
        ["原句", text(snapshot.quote)],
      ];
      break;
  }
  return (
    <>
      <dl>
        {fields
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {source.kind === "step" && (
        <p className="wk-record-help">
          这是读取时的计划状态；过去做过什么，以会话和手动记录为准。
        </p>
      )}
      {source.kind === "session" && (
        <p className="wk-record-help">
          计时只表示记录的时间，不代表注意力或精力。
        </p>
      )}
    </>
  );
}

export default function SummaryEvidence({
  summary,
  date,
  state,
  blocked = false,
  onContinue,
  onPrepareToday,
}: {
  summary: DailySummary;
  date: string;
  state?: State;
  blocked?: boolean;
  onContinue?: (row: Row) => void | Promise<void>;
  onPrepareToday?: (summary: DailySummary) => void;
}) {
  const evidence = summary.evidence || [];
  const continuation = summaryContinuation(summary, state);
  const reason =
    continuation.reason || (blocked ? "当前操作还未完成，请稍后再试。" : "");
  const descriptionId = `summary-next-${summary.id}`;
  return (
    <section
      className="wk-record-item wk-summary"
      data-summary-id={summary.id}
      aria-label={`${date}的总结`}
    >
      <p className="wk-summary-body">{summary.body}</p>
      <p className="wk-record-time">读取截至 {at(summary.sourceAsOf)}</p>
      {summary.hasNewRecords && (
        <p className="wk-summary-stale" role="status">
          此后已有新记录或个人笔记变化，这份总结尚未更新。
        </p>
      )}
      {evidence.length ? (
        <details className="wk-summary-sources">
          <summary>查看依据 · {evidence.length} 条</summary>
          <p className="wk-record-help">
            下面保留生成总结时读取的来源快照，不会被当前任务信息替换。
          </p>
          {evidence.map((source) => (
            <details
              key={JSON.stringify([
                source.kind,
                source.id,
                source.kind === "personalNote" ? source.snapshot.quote : null,
              ])}
              data-evidence-id={source.id}
            >
              <summary>
                {sourceNames[source.kind]} · {source.label}
              </summary>
              <SourceSnapshot source={source} />
            </details>
          ))}
        </details>
      ) : (
        <p className="wk-record-help">这份总结未附依据；旧总结不会补造来源。</p>
      )}
      {summary.nextStart && (
        <div className="wk-summary-next">
          <strong>下次起点</strong>
          {summary.nextStart.cue && <p>总结建议：{summary.nextStart.cue}</p>}
          {continuation.row && (
            <p className="wk-record-help">
              当前步骤：{continuation.row.step?.text} ·{" "}
              {continuation.row.item
                ? `当前安排 ${continuation.row.item.date}`
                : "原步骤未关联安排"}
            </p>
          )}
          <button
            disabled={!!reason || !continuation.row || !onContinue}
            aria-describedby={descriptionId}
            onClick={() => {
              const latest = summaryContinuation(summary, state);
              if (!blocked && latest.row && !latest.reason)
                void onContinue?.(latest.row);
            }}
          >
            继续原步骤
          </button>
          <p className="wk-record-help" id={descriptionId}>
            {reason || "只把这一步准备到 Inky，点击 start 才开始计时。"}
          </p>
        </div>
      )}
      {onPrepareToday && (
        <div className="wk-summary-actions">
          <button disabled={blocked} onClick={() => onPrepareToday(summary)}>
            为今天准备候选
          </button>
          <small>先放入 Coach 输入框，发送后再讨论。</small>
        </div>
      )}
    </section>
  );
}
