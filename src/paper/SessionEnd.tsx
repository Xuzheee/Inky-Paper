import { useState, type ReactNode } from "react";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import type { Session } from "./paperTypes";
import { PencilShading } from "./PencilShading";
import { EndTask } from "./EndTask";

type Feedback = { output: string; blocker: string; nextCue: string };

export function SessionEnd({
  session,
  busy,
  completed,
  chooseCompleted,
  expanded,
  setExpanded,
  feedback,
  setFeedback,
  stuck,
  setStuck,
  returnToTasks,
  returnToTimer,
  save,
  workControls,
  footer,
}: {
  session: Session;
  busy: boolean;
  completed: boolean;
  chooseCompleted: (completed: boolean) => void;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  feedback: Feedback;
  setFeedback: (feedback: Feedback) => void;
  stuck: boolean;
  setStuck: (stuck: boolean) => void;
  returnToTasks: () => void;
  returnToTimer: () => void;
  save: () => void;
  workControls?: ReactNode;
  footer: ReactNode;
}) {
  const [moreRecords, setMoreRecords] = useState(false);
  const primaryField: keyof Feedback = stuck
    ? "blocker"
    : completed
      ? "output"
      : "nextCue";
  const questions: Record<keyof Feedback, { title: string; label: string }> = {
    output: { title: "留下了什么？", label: "产出" },
    blocker: { title: "主要卡在哪里？", label: "卡点" },
    nextCue: { title: "下次从哪里开始？", label: "下次起点" },
  };
  const field = (key: keyof Feedback) => (
    <label key={key}>
      {questions[key].title}
      <textarea
        rows={1}
        maxLength={key === "nextCue" ? 500 : 2000}
        aria-label={questions[key].label}
        disabled={busy}
        value={feedback[key]}
        onChange={(event) =>
          setFeedback({ ...feedback, [key]: event.target.value })
        }
      />
    </label>
  );
  return (
    <>
      <nav className="focus-navigation" aria-label="结束页导航">
        <button aria-label="返回任务列表" onClick={returnToTasks}>
          <ArrowLeft size={13} />
          任务列表
        </button>
        {session.status === "paused" && (
          <button aria-label="返回番茄钟" onClick={returnToTimer}>
            返回番茄钟
          </button>
        )}
      </nav>
      <div className="feedback-heading">
        <div>
          <h1>结束番茄钟</h1>
          <p className="muted">
            {session.status === "waiting" ? "已到时" : "已暂停"} ·{" "}
            {Math.floor(session.elapsedSeconds / 60)} 分{" "}
            {session.elapsedSeconds % 60} 秒
          </p>
        </div>
      </div>
      <EndTask text={session.action?.text || session.taskTitle} />
      <section className="end-records" aria-label="本轮补充记录">
        <button
          className="end-record-toggle"
          aria-label={expanded ? "收起记录" : "补充记录（可选）"}
          aria-expanded={expanded}
          aria-controls="session-end-fields"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minus size={16} /> : <Plus size={16} />}
          {expanded ? "收起记录" : "补充记录"}
          <small>可选</small>
        </button>
        {expanded && (
          <div className="feedback-fields" id="session-end-fields">
            {field(primaryField)}
            <div className="end-record-options">
              <button
                className="text-button"
                aria-pressed={stuck}
                disabled={busy}
                onClick={() => setStuck(!stuck)}
              >
                {stuck ? "按完成情况记录" : "这轮卡住了"}
              </button>
              <button
                className="text-button"
                aria-expanded={moreRecords}
                aria-controls="session-end-more-fields"
                onClick={() => setMoreRecords(!moreRecords)}
              >
                {moreRecords ? "收起其他记录" : "其他记录（可选）"}
              </button>
            </div>
            {moreRecords && (
              <div className="feedback-fields" id="session-end-more-fields">
                {(["output", "blocker", "nextCue"] as const)
                  .filter((key) => key !== primaryField)
                  .map(field)}
              </div>
            )}
            <p className="end-record-skip">都可以留空，直接保存。</p>
          </div>
        )}
      </section>
      <fieldset
        className="end-outcome"
        disabled={busy}
        aria-describedby="end-outcome-hint"
      >
        <legend>这一步完成了吗？</legend>
        <div>
          {([false, true] as const).map((value) => (
            <label key={String(value)} data-selected={completed === value}>
              <input
                type="radio"
                name="session-outcome"
                value={String(value)}
                checked={completed === value}
                onChange={() => chooseCompleted(value)}
              />
              <PencilShading />
              <span>{value ? "已完成" : "还没完成"}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="end-outcome-hint" id="end-outcome-hint" aria-live="polite">
        {completed
          ? "保存后划掉这一步，再选择回到列表或休息。"
          : "保存后回到任务列表，这一步留待下次继续。"}
      </p>
      <button className="primary end-save" disabled={busy} onClick={save}>
        保存并结束
      </button>
      {workControls}
      {footer}
    </>
  );
}
