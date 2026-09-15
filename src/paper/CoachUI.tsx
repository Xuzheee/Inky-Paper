import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MoreHorizontal } from "lucide-react";
import "./coach.css";

export type CoachTask = {
  id: string;
  title: string;
  revision: number;
  completed: boolean;
  nextAction: { id: string; text: string; completed: boolean } | null;
};
export type WorkBlock = {
  id: string;
  taskId: string;
  taskTitle: string;
  action: { id: string; text: string } | null;
  goal: string;
  status: string;
  mode: string;
  revision: number;
  energy: string | null;
  plannedEndAt: number;
  startedAt: number;
  endedAt: number | null;
  resumeCue: string | null;
  phases?: { mode: string; at: number }[];
  sessionIds: string[];
  progress: string | null;
  output: string | null;
  blocker: string | null;
  focus: string | null;
};
export type Proposal = {
  id: string;
  blockId: string;
  text: string;
  reason: string;
  status: string;
  expiresAt: number;
  kind: string;
};
export type CoachState = {
  blocks: WorkBlock[];
  proposals: Proposal[];
  analysisStatus: string;
  settings: { enabled: boolean; hermes: boolean; revision: number };
  activities: {
    key: string;
    blockId: string;
    app: string;
    title: string;
    startedAt: number;
    endedAt: number;
  }[];
};
export const emptyCoach: CoachState = {
  blocks: [],
  proposals: [],
  analysisStatus: "",
  settings: { enabled: false, hermes: false, revision: 1 },
  activities: [],
};
export type Mutate = (
  action: string,
  input?: Record<string, unknown>,
) => Promise<Record<string, unknown> | null>;
export const workTime = (t: number) =>
  new Date(t).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
const energyOptions = [
  ["high", "充足"],
  ["medium", "一般"],
  ["low", "偏低"],
];
const progressOptions = [
  ["achieved", "完成预期"],
  ["advanced", "推进了一些"],
  ["blocked", "卡住了"],
];
const modeNames: Record<string, string> = {
  working: "工作中",
  paused: "已暂停",
  rest: "休息中",
  waiting_ai: "等待 AI",
};
export function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: React.ReactNode;
  value: string;
  options: string[][];
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="coach-choice">
      <legend>{label}</legend>
      <div>
        {options.map(([v, title]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(value === v ? "" : v)}
          >
            {title}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
export function WorkStart({
  task,
  currentTask,
  reviewTask,
  settings,
  initialSeconds,
  busy,
  mutate,
  done,
}: {
  task: CoachTask;
  currentTask?: CoachTask;
  reviewTask: (task: CoachTask) => void;
  settings: CoachState["settings"];
  initialSeconds?: number;
  busy: boolean;
  mutate: Mutate;
  done: (timed: boolean) => void;
}) {
  const stale =
    !currentTask ||
    currentTask.completed ||
    currentTask.revision !== task.revision;
  const draftKey = `paper-work-start-${task.id}-${task.revision}`;
  const [draft] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey) || "null") || {};
    } catch {
      return {};
    }
  });
  const [minutes, setMinutes] = useState<number>(draft.minutes || 60),
    [energy, setEnergy] = useState<string>(draft.energy || ""),
    [seconds, setSeconds] = useState<number>(
      draft.seconds ?? initialSeconds ?? 1500,
    ),
    [goal, setGoal] = useState<string>(
      draft.goal || task.nextAction?.text || task.title,
    ),
    [edit, setEdit] = useState(false);
  const [at, setAt] = useState<number>(() =>
      draft.at > Date.now() + 60000 ? draft.at : Date.now() + 60 * 60000,
    ),
    [custom, setCustom] = useState<boolean>(!!draft.custom);
  const [editTime, setEditTime] = useState(false);
  useEffect(() => {
    localStorage.setItem(
      draftKey,
      JSON.stringify({ minutes, energy, seconds, goal, at, custom }),
    );
  }, [draftKey, minutes, energy, seconds, goal, at, custom]);
  return (
    <section className="coach-panel coach-start">
      <h1>开始这段工作</h1>
      {stale && (
        <div className="notice" role="status">
          <p>
            {!currentTask || currentTask.completed
              ? "这件任务已完成，请返回选择其他任务。"
              : "任务已有更新。确认最新内容后再开始。"}
          </p>
          {currentTask && !currentTask.completed && (
            <>
              <p>
                {currentTask.title} ·{" "}
                {currentTask.nextAction?.text || "尚无下一步"}
              </p>
              <button
                className="outline"
                onClick={() => reviewTask(currentTask)}
              >
                使用最新任务内容
              </button>
            </>
          )}
        </div>
      )}
      <div className="coach-goal">
        <div className="coach-goal-heading">
          <span className="eyebrow">{task.title}</span>
          <button className="text-button" onClick={() => setEdit(!edit)}>
            调整
          </button>
        </div>
        {edit ? (
          <textarea
            aria-label="本段目标"
            maxLength={500}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        ) : (
          <h2>{goal}</h2>
        )}
      </div>
      <Choice
        label={
          <span>
            预计工作到 {workTime(at)}{" "}
            <button
              className="coach-time-edit"
              onClick={() => setEditTime(!editTime)}
            >
              改时间
            </button>
          </span>
        }
        value={custom ? "" : String(minutes)}
        options={[
          ["30", "30 分钟"],
          ["60", "1 小时"],
          ["90", "1.5 小时"],
        ]}
        onChange={(v) => {
          if (v) {
            setMinutes(Number(v));
            setAt(Date.now() + Number(v) * 60000);
            setCustom(false);
          }
        }}
      />
      {editTime && (
        <input
          type="time"
          aria-label="工作结束时间"
          value={`${new Date(at).getHours().toString().padStart(2, "0")}:${new Date(at).getMinutes().toString().padStart(2, "0")}`}
          onChange={(e) => {
            const [h, m] = e.target.value.split(":").map(Number);
            const end = new Date();
            end.setHours(h, m, 0, 0);
            if (end.getTime() < Date.now()) end.setDate(end.getDate() + 1);
            setAt(end.getTime());
            setCustom(true);
          }}
        />
      )}
      <Choice
        label="现在状态 · 可跳过"
        value={energy}
        options={energyOptions}
        onChange={setEnergy}
      />
      <label className="coach-timer-option">
        本轮计时
        <select
          aria-label="本轮计时"
          value={seconds}
          onChange={(e) => setSeconds(Number(e.target.value))}
        >
          {![0, 900, 1500, 2700].includes(seconds) && (
            <option value={seconds}>
              {seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`}
            </option>
          )}
          <option value={900}>15 分钟</option>
          <option value={1500}>25 分钟</option>
          <option value={2700}>45 分钟</option>
          <option value={0}>暂不计时</option>
        </select>
      </label>
      <p className="coach-small">
        {settings.enabled
          ? "本地活动记录已开：仅在本段保存应用名、窗口标题与停留时间。"
          : "本地观察已关闭，本段不收集窗口活动。"}
        Coach 只在你询问时提供建议。可在设置调整本地活动记录。
      </p>
      <button
        className="primary coach-bottom"
        disabled={busy || stale || !goal.trim() || at < Date.now() + 60000}
        onClick={async () => {
          if (
            await mutate("start_work", {
              taskId: task.id,
              expectedRevision: task.revision,
              plannedEndAt: at,
              energy: energy || null,
              goal,
              plannedSeconds: seconds,
            })
          ) {
            localStorage.removeItem(draftKey);
            done(seconds > 0);
          }
        }}
      >
        {busy ? "正在保存…" : seconds ? "开始工作并计时" : "开始工作"}
      </button>
    </section>
  );
}
export function WorkCard({
  block,
  open,
}: {
  block: WorkBlock;
  open: () => void;
}) {
  return (
    <button className="work-strip" onClick={open}>
      <span>
        本段工作 ·{" "}
        {block.status === "expired"
          ? "已到预计结束时间"
          : `到 ${workTime(block.plannedEndAt)}`}
      </span>
      <span>
        {modeNames[block.mode]} <MoreHorizontal size={15} />
      </span>
    </button>
  );
}
export function WorkMenu({
  block,
  busy,
  mutate,
  open,
  close,
}: {
  block: WorkBlock;
  busy: boolean;
  mutate: Mutate;
  open: (view: "work" | "coach-help") => void;
  close: () => void;
}) {
  return (
    <section className="work-menu" aria-label="更多工作操作">
      <button
        disabled={busy}
        onClick={async () => {
          if (
            await mutate("set_work_mode", {
              blockId: block.id,
              expectedRevision: block.revision,
              mode: block.mode === "waiting_ai" ? "working" : "waiting_ai",
            })
          )
            close();
        }}
      >
        {block.mode === "waiting_ai" ? "回来继续" : "等待 AI"}
      </button>
      <button onClick={() => open("coach-help")}>卡住了</button>
      <button onClick={() => open("work")}>
        本段工作 · 到 {workTime(block.plannedEndAt)}
      </button>
    </section>
  );
}
export function WorkOverview({
  block,
  coach,
  busy,
  mutate,
  open,
  hasSession,
  startSession,
  nextAction,
  taskCompleted,
}: {
  block: WorkBlock;
  coach: CoachState;
  busy: boolean;
  mutate: Mutate;
  open: (v: "work-end" | "coach-help" | "focus") => void;
  hasSession: boolean;
  startSession: () => void;
  nextAction?: string;
  taskCompleted: boolean;
}) {
  const [cue, setCue] = useState(block.resumeCue || ""),
    [energy, setEnergy] = useState(block.energy || "");
  const changeMode = async (mode: string) =>
    mutate("set_work_mode", {
      blockId: block.id,
      expectedRevision: block.revision,
      mode,
      resumeCue: cue || null,
    });
  return (
    <section className="coach-panel">
      <div>
        <h1>{block.status === "expired" ? "这段时间到了" : "本段工作"}</h1>
        <p className="muted">
          {workTime(block.startedAt)} — {workTime(block.plannedEndAt)} ·{" "}
          {modeNames[block.mode]}
        </p>
      </div>
      <div className="coach-goal">
        <span className="eyebrow">{block.taskTitle}</span>
        <h2>{nextAction || block.goal}</h2>
        {nextAction && nextAction !== block.goal && (
          <details>
            <summary>本段目标</summary>
            <p>{block.goal}</p>
          </details>
        )}
      </div>
      {block.status === "active" ? (
        <>
          {block.mode === "waiting_ai" && (
            <p className="coach-inline-note">
              正在等待结果。回来后先看刚才的回复；这里不会推断 AI
              是否已经生成完成。
            </p>
          )}
          <label>
            {block.mode === "waiting_ai"
              ? "回来先检查什么？"
              : "回来先做什么？"}
            <input
              aria-label="本段恢复线索"
              maxLength={500}
              placeholder="可选，留下一句就好"
              value={cue}
              onChange={(e) => setCue(e.target.value)}
            />
          </label>
          {cue !== (block.resumeCue || "") && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void mutate("update_work", {
                  blockId: block.id,
                  expectedRevision: block.revision,
                  resumeCue: cue || null,
                })
              }
            >
              保存这句线索
            </button>
          )}
          {taskCompleted && (
            <p className="coach-inline-note">
              这件任务已完成。本段仍保留，可在下方收好工作，或回任务页切换目标。
            </p>
          )}
          <div className="coach-actions">
            <button
              className="primary"
              disabled={busy || (taskCompleted && !hasSession)}
              onClick={async () => {
                if (block.mode !== "working") {
                  if (!(await changeMode("working"))) return;
                }
                if (hasSession) open("focus");
                else startSession();
              }}
            >
              {hasSession ? "继续这一轮" : "开始一轮计时"}
            </button>
            <button className="outline" onClick={() => open("coach-help")}>
              卡住了，帮我理一下
            </button>
          </div>
          <div className="coach-actions compact">
            <button
              className="outline"
              disabled={busy}
              onClick={() =>
                void changeMode(
                  block.mode === "waiting_ai" ? "working" : "waiting_ai",
                )
              }
            >
              {block.mode === "waiting_ai" ? "结束等待" : "等待 AI"}
            </button>
            <button
              className="outline"
              disabled={busy}
              onClick={() =>
                void changeMode(
                  block.mode === "paused" || block.mode === "rest"
                    ? "working"
                    : "paused",
                )
              }
            >
              {block.mode === "paused" || block.mode === "rest"
                ? "恢复工作"
                : "暂停工作"}
            </button>
          </div>
          <details>
            <summary>调整状态与时间</summary>
            <Choice
              label="现在状态 · 可跳过"
              value={energy}
              options={energyOptions}
              onChange={setEnergy}
            />
            <button
              className="outline"
              disabled={busy}
              onClick={() =>
                void mutate("update_work", {
                  blockId: block.id,
                  expectedRevision: block.revision,
                  energy: energy || null,
                })
              }
            >
              保存状态
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void mutate("update_work", {
                  blockId: block.id,
                  expectedRevision: block.revision,
                  plannedEndAt:
                    Math.max(Date.now(), block.plannedEndAt) + 15 * 60000,
                })
              }
            >
              延长 15 分钟
            </button>
          </details>
          {coach.analysisStatus && (
            <p className="coach-small" role="status">
              {coach.analysisStatus}
            </p>
          )}
        </>
      ) : (
        <>
          <p>本段提醒已停止。可以收好这一段，或再给自己一点时间。</p>
          <button
            className="outline"
            disabled={busy}
            onClick={() =>
              void mutate("update_work", {
                blockId: block.id,
                expectedRevision: block.revision,
                plannedEndAt: Date.now() + 15 * 60000,
              })
            }
          >
            延长 15 分钟
          </button>
        </>
      )}
      <button
        className="text-button coach-bottom"
        onClick={() => open("work-end")}
      >
        结束本段工作
      </button>
    </section>
  );
}
export function WorkEnd({
  block,
  busy,
  hasSession,
  mutate,
  done,
}: {
  block: WorkBlock;
  busy: boolean;
  hasSession: boolean;
  mutate: Mutate;
  done: () => void;
}) {
  const key = `paper-work-feedback-${block.id}`;
  const [form, setForm] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(key) || "null") || {
          progress: "",
          blocker: "",
          output: "",
          focus: "",
          cue: block.resumeCue || "",
        }
      );
    } catch {
      return {
        progress: "",
        blocker: "",
        output: "",
        focus: "",
        cue: block.resumeCue || "",
      };
    }
  });
  const [finishSession, setFinishSession] = useState(true);
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(form));
  }, [form, key]);
  return (
    <section className="coach-panel">
      <div>
        <h1>收好这段工作</h1>
        <p className="muted">留下进展，不必写一份报告。</p>
      </div>
      <div className="coach-goal">
        <span className="eyebrow">这一段原本想</span>
        <h2>{block.goal}</h2>
      </div>
      <Choice
        label="推进得怎么样？· 可跳过"
        value={form.progress}
        options={progressOptions}
        onChange={(progress) => setForm({ ...form, progress })}
      />
      {form.progress === "blocked" && (
        <Choice
          label="主要卡在哪里？"
          value={form.blocker}
          options={[
            ["下一步不清楚", "下一步不清楚"],
            ["遇到问题", "遇到问题"],
            ["被打断", "被打断"],
            ["状态下降", "状态下降"],
          ]}
          onChange={(blocker) => setForm({ ...form, blocker })}
        />
      )}
      <details>
        <summary>补一句 / 留下次起点</summary>
        <label>
          留下了什么？
          <textarea
            maxLength={2000}
            aria-label="本段产出"
            value={form.output}
            onChange={(e) => setForm({ ...form, output: e.target.value })}
          />
        </label>
        <label>
          下次从哪里开始？
          <input
            maxLength={500}
            aria-label="本段下次起点"
            value={form.cue}
            onChange={(e) => setForm({ ...form, cue: e.target.value })}
          />
        </label>
      </details>
      {parseInt(block.id[0], 16) % 3 === 0 && (
        <Choice
          label="这一段的投入感 · 可跳过"
          value={form.focus}
          options={[
            ["engaged", "比较投入"],
            ["mixed", "时断时续"],
            ["difficult", "很难投入"],
          ]}
          onChange={(focus) => setForm({ ...form, focus })}
        />
      )}
      {hasSession && (
        <label className="coach-checkbox">
          <input
            type="checkbox"
            checked={finishSession}
            onChange={(e) => setFinishSession(e.target.checked)}
          />
          同时结束当前计时轮次
        </label>
      )}
      <p className="coach-small">
        结束本段不自动完成步骤或整件任务。所有反馈都可以跳过。
      </p>
      <button
        className="primary coach-bottom"
        disabled={busy}
        onClick={async () => {
          if (
            await mutate("end_work", {
              blockId: block.id,
              expectedRevision: block.revision,
              progress: form.progress || null,
              blocker: form.blocker || null,
              output: form.output || null,
              focus: form.focus || null,
              resumeCue: form.cue || null,
              finishSession,
            })
          ) {
            localStorage.removeItem(key);
            done();
          }
        }}
      >
        {busy
          ? "正在保存…"
          : hasSession && finishSession
            ? "结束工作并结束本轮"
            : "保存，结束本段工作"}
      </button>
    </section>
  );
}
export function CoachHelp({
  block,
  coach,
  busy,
  mutate,
  refresh,
  hasSession,
  adopt,
  openWork,
}: {
  block: WorkBlock;
  coach: CoachState;
  busy: boolean;
  mutate: Mutate;
  refresh: () => Promise<void>;
  hasSession: boolean;
  adopt: (input: Record<string, unknown>) => Promise<unknown>;
  openWork: () => void;
}) {
  const [kind, setKind] = useState("step"),
    [blocker, setBlocker] = useState(""),
    [asking, setAsking] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [edited, setEdited] = useState("");
  const proposal = [...coach.proposals]
    .reverse()
    .find((p) => p.blockId === block.id && p.status === "pending");
  const latest = [...coach.proposals]
    .reverse()
    .find((p) => p.blockId === block.id);
  const request = async () => {
    setAsking(true);
    setError("");
    try {
      await invoke("request_coaching", { kind, blocker });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setAsking(false);
    }
  };
  return (
    <section className="coach-panel">
      <div>
        <h1>把下一步理清楚</h1>
        <p className="muted">围绕这件事，找一个能推进的动作。</p>
      </div>
      <div className="coach-goal">
        <h2>{block.goal}</h2>
      </div>
      {!proposal && latest && ["accept", "edit"].includes(latest.status) && (
        <div className="coach-inline-note">
          <p>已采用：{latest.text}</p>
          <button className="text-button" onClick={openWork}>
            回到工作
          </button>
        </div>
      )}
      {!proposal && (
        <>
          <Choice
            label="想得到哪种帮助？"
            value={kind}
            options={[
              ["goal", "选好这段目标"],
              ["step", "解决卡点"],
              ["recovery", "找回起点"],
              ["pace", "调整节奏"],
            ]}
            onChange={(v) => setKind(v || "step")}
          />
          <Choice
            label="现在的情况 · 可跳过"
            value={blocker}
            options={[
              ["下一步不清楚", "下一步不清楚"],
              ["遇到技术问题", "遇到问题"],
              ["精力不够", "状态下降"],
            ]}
            onChange={setBlocker}
          />
          <button
            className="outline"
            disabled={asking || busy || block.status !== "active"}
            onClick={() => void request()}
          >
            {asking ? "Hermes 正在想…" : "请 Hermes 给一个建议"}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
          <br />
          已有任务、计时和记录仍可使用。
        </p>
      )}
      {proposal && (
        <article className="coach-proposal">
          <span className="eyebrow">Hermes 建议 · 由你决定</span>
          {editing ? (
            <textarea
              aria-label="调整建议"
              maxLength={300}
              value={edited}
              onChange={(e) => setEdited(e.target.value)}
            />
          ) : (
            <h2>{proposal.text}</h2>
          )}
          <p>{proposal.reason}</p>
          {hasSession && (
            <p className="coach-small">
              采用时会一并收好当前一轮；原步骤与计时记录会保留。
            </p>
          )}
          <div className="coach-actions compact">
            <button
              className="primary"
              disabled={busy || (editing && !edited.trim())}
              onClick={() =>
                void adopt({
                  proposalId: proposal.id,
                  response: editing ? "edit" : "accept",
                  ...(editing ? { text: edited } : {}),
                })
              }
            >
              {hasSession
                ? "结束本轮并采用"
                : proposal.kind === "goal"
                  ? "采用目标"
                  : "采用"}
            </button>
            <button
              className="outline"
              onClick={() => {
                setEdited(proposal.text);
                setEditing(!editing);
              }}
            >
              调整
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void mutate("respond_coach_proposal", {
                  proposalId: proposal.id,
                  response: "reject",
                })
              }
            >
              暂不
            </button>
          </div>
        </article>
      )}
      {!proposal && (
        <p className="coach-small">
          {asking
            ? "不必等在这里，可以继续工作，建议会留在本页。"
            : coach.analysisStatus ||
              "建议会结合已报告状态、剩余时间和执行记录；信息不足时不会假装知道。"}
        </p>
      )}
    </section>
  );
}
export function WorkHistory({
  coach,
  renderSessions,
  limit = 20,
}: {
  coach: CoachState;
  limit?: number;
  renderSessions: (ids: string[]) => React.ReactNode;
}) {
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  return (
    <div className="history-list work-history">
      {[...coach.blocks]
        .reverse()
        .slice(0, limit)
        .map((b) => (
          <article key={b.id}>
            <span className="eyebrow">
              {new Date(b.startedAt).toLocaleDateString("zh-CN")} ·{" "}
              {workTime(b.startedAt)} — {workTime(b.endedAt || b.plannedEndAt)}
            </span>
            <h2>{b.goal}</h2>
            <p>
              {progressOptions.find(([v]) => v === b.progress)?.[1] ||
                (b.status === "ended" ? "未填写进展" : "本段尚未收好")}
            </p>
            {b.output && <p>留下：{b.output}</p>}
            {b.blocker && <p>卡点：{b.blocker}</p>}
            {b.resumeCue && <p>下次：{b.resumeCue}</p>}
            <p className="coach-small">
              {b.sessionIds.length} 轮记录 · 状态：
              {energyOptions.find(([v]) => v === b.energy)?.[1] || "未填写"}
            </p>
            {b.sessionIds.length > 0 && (
              <details
                onToggle={(event) => {
                  const open = event.currentTarget.open;
                  setOpened((previous) =>
                    previous[b.id] === open
                      ? previous
                      : { ...previous, [b.id]: open },
                  );
                }}
              >
                <summary>展开本段轮次</summary>
                {(b.phases || [])
                  .filter((p) =>
                    ["waiting_ai", "rest", "paused"].includes(p.mode),
                  )
                  .map((p, i) => (
                    <p className="coach-small" key={`${p.at}-${i}`}>
                      {workTime(p.at)} · {modeNames[p.mode]}
                    </p>
                  ))}
                {opened[b.id] && renderSessions(b.sessionIds)}
              </details>
            )}
          </article>
        ))}
    </div>
  );
}
export function CoachSettings({
  coach,
  busy,
  mutate,
}: {
  coach: CoachState;
  busy: boolean;
  mutate: Mutate;
}) {
  const latest = coach.activities[coach.activities.length - 1];
  const b = [...coach.blocks].reverse().find((b) => b.status === "active");
  return (
    <section className="settings-group">
      <h2>工作辅助</h2>
      <label className="coach-checkbox">
        <input
          type="checkbox"
          checked={coach.settings.enabled}
          disabled={busy}
          onChange={(e) =>
            void mutate("coach_settings", {
              expectedRevision: coach.settings.revision,
              enabled: e.target.checked,
            })
          }
        />
        工作时段内保存本地活动记录
      </label>
      <p className="coach-small">
        应用名、窗口标题与停留区间只在工作时段记录。原始活动最多保留 24
        小时，建议保留 30 天。活动记录不代表专注程度，也不会触发建议或提醒。
      </p>
      <p className="coach-small">
        Coach
        只在你询问时调用。手动请求建议时，本段目标、状态、执行记录和已保存的相关活动会交给
        Hermes 已配置的模型。番茄钟和工作结束的到点提示照常保留。
      </p>
      <details>
        <summary>查看最近观察</summary>
        {latest ? (
          <>
            <p>{latest.app}</p>
            <p className="coach-small">{latest.title || "标题未知"}</p>
            {b && latest.blockId === b.id && (
              <div className="coach-actions compact">
                <button
                  disabled={busy}
                  className="outline"
                  onClick={() =>
                    void mutate("label_activity", {
                      blockId: b.id,
                      expectedRevision: b.revision,
                      key: latest.key,
                      relation: "related",
                    })
                  }
                >
                  与任务有关
                </button>
                <button
                  disabled={busy}
                  className="outline"
                  onClick={() =>
                    void mutate("label_activity", {
                      blockId: b.id,
                      expectedRevision: b.revision,
                      key: latest.key,
                      relation: "unrelated",
                    })
                  }
                >
                  与任务无关
                </button>
              </div>
            )}
          </>
        ) : (
          <p>尚无工作时段内的观察。</p>
        )}
      </details>
    </section>
  );
}
type Prompt = { kind: "work_end"; block: WorkBlock };
export function CoachPrompt() {
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    const receivePrompt = (value: Prompt | null) => {
      setPrompt(value?.kind === "work_end" ? value : null);
      setError("");
    };
    void listen<Prompt | null>("coach:prompt", (e) => {
      receivePrompt(e.payload);
    }).then((f) => {
      if (cancelled) f();
      else off = f;
    });
    void invoke<Prompt | null>("paper_execute", {
      action: "get_coach_prompt",
      input: {},
    }).then(receivePrompt);
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);
  const act = async (
    action: string,
    input: Record<string, unknown>,
    navigate?: string,
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await invoke("paper_execute", {
        action,
        input: { ...input, requestId: crypto.randomUUID() },
      });
      if (navigate) await invoke("coach_show_main", { view: navigate });
      else await invoke("coach_hide_prompt");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!prompt)
    return (
      <main className="paper coach-prompt">
        <p>工作提示</p>
      </main>
    );
  return (
    <main className="paper coach-prompt">
      <div
        className="coach-prompt-heading"
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target as HTMLElement).closest("button")
          )
            return;
          event.preventDefault();
          drag.current = { x: event.screenX, y: event.screenY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const previous = drag.current;
          if (!previous) return;
          const deltaX = event.screenX - previous.x;
          const deltaY = event.screenY - previous.y;
          if (!deltaX && !deltaY) return;
          drag.current = { x: event.screenX, y: event.screenY };
          void invoke("move_window_by", { deltaX, deltaY }).catch((e) =>
            setError(String(e)),
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <span className="eyebrow">Inky Paper · 工作提示</span>
        <button
          aria-label="关闭到点提示"
          disabled={busy}
          onClick={() =>
            void invoke("coach_hide_prompt").catch((e) => setError(String(e)))
          }
        >
          ×
        </button>
      </div>
      <h1>这段时间到了</h1>
      <p className="prompt-step">{prompt.block.goal}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="coach-actions compact">
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            void invoke("coach_show_main", { view: "work-end" }).catch((e) =>
              setError(String(e)),
            )
          }
        >
          收好这段工作
        </button>
        <button
          className="outline"
          disabled={busy}
          onClick={() =>
            void act("update_work", {
              blockId: prompt.block.id,
              expectedRevision: prompt.block.revision,
              plannedEndAt: Date.now() + 15 * 60000,
            })
          }
        >
          延长 15 分钟
        </button>
      </div>
    </main>
  );
}
