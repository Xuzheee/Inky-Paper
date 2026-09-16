import { useEffect, useRef, useState } from "react";
import type { DayItem } from "../paper/paperTypes";
import {
  AdjustmentAction,
  AdjustmentData,
  AdjustmentGroup,
  AdjustmentSnapshot,
  getError,
  paper,
  validDate,
} from "./model";
import "./adjustments.css";

type Draft = {
  selected: string[];
  edits: Record<string, AdjustmentAction[]>;
  baseRevision?: number;
  conflict?: boolean;
};
type Pending = {
  action: "adopt_plan_adjustment" | "revise_plan_adjustment";
  input: Record<string, unknown> & { batchId: string; requestId: string };
};
const emptyDraft = (): Draft => ({ selected: [], edits: {} });
const conflictMessage =
  "相关计划或候选已变化。选择和参数已保留，请让 Coach 读取最新计划后重新提出调整。";
const definitive =
  /^(CONFLICT|INVALID_INPUT|FORBIDDEN|REQUEST_ID_REUSED|NOT_FOUND|ACTIVE_SESSION|ACTION_COMPLETED|TASK_COMPLETED|BUSY)(:|\b)/;
const clockTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const arrangement = (item?: DayItem) =>
  item
    ? `${item.date} · ${item.startMinute == null ? "未设时刻" : clockTime(item.startMinute)} · ${item.durationMinutes == null ? "未设预留" : `预留 ${item.durationMinutes} 分钟`}${item.removedAt ? " · 已取消" : ""}`
    : "未安排";
const stepName = (snapshot: AdjustmentSnapshot, stepId: string) =>
  snapshot.steps.find((step) => step.id === stepId)?.text || "原步骤当前不可用";
const actionName = (group: AdjustmentGroup, action: AdjustmentAction) =>
  action.kind === "reorder"
    ? `${action.date} 的顺序`
    : group.before.steps.find((step) => step.id === action.stepId)?.text ||
      group.after.steps.find((step) => step.id === action.stepId)?.text ||
      "原步骤当前不可用";

function ActionPreview({
  group,
  action,
}: {
  group: AdjustmentGroup;
  action: AdjustmentAction;
}) {
  const title = actionName(group, action);
  const fromItem =
    action.kind === "reschedule" || action.kind === "reservation"
      ? group.before.dayItems.find((item) => item.id === action.itemId)
      : undefined;
  const toItem =
    action.kind === "reschedule" || action.kind === "reservation"
      ? group.after.dayItems.find((item) => item.id === action.itemId)
      : undefined;
  if (action.kind === "reorder") {
    const ordered = (snapshot: AdjustmentSnapshot) =>
      snapshot.dayItems
        .filter((item) => item.date === action.date && !item.removedAt)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        .map((item) => stepName(snapshot, item.stepId))
        .join(" → ");
    return (
      <div className="wk-adjust-action">
        <strong>调整顺序 · {action.date}</strong>
        <p>原来：{ordered(group.before) || "无安排"}</p>
        <p>改为：{ordered(group.after) || "无安排"}</p>
      </div>
    );
  }
  if (action.kind === "narrow")
    return (
      <div className="wk-adjust-action">
        <strong>拆出更小的一步</strong>
        <p>原步骤保留：{title}</p>
        <p>新增：{action.text}</p>
        {action.expectedResult && <p>做到：{action.expectedResult}</p>}
        <p>
          {action.date || "暂不安排日期"} · 首轮{" "}
          {Math.round(action.plannedSeconds / 60)} 分钟
        </p>
      </div>
    );
  if (action.kind === "continue")
    return (
      <div className="wk-adjust-action">
        <strong>继续 · {title}</strong>
        <p>
          从：
          {action.items
            .map(
              ({ id }) =>
                group.before.dayItems.find((item) => item.id === id)?.date,
            )
            .filter(Boolean)
            .join("、") || "原安排"}
        </p>
        <p>继续到：{action.date}</p>
        <p>原安排保留为已处理记录；目标日已有安排时继续使用。</p>
      </div>
    );
  return (
    <div className="wk-adjust-action">
      <strong>
        {action.kind === "reschedule" ? "改期" : "调整预留"} · {title}
      </strong>
      <p>原来：{arrangement(fromItem)}</p>
      <p>改为：{arrangement(toItem)}</p>
      {action.kind === "reservation" && action.durationMinutes === null && (
        <p>取消预留与开始时刻，保留日期。</p>
      )}
    </div>
  );
}

export default function AdjustmentCards({
  id,
  streaming,
  onSaved,
}: {
  id: string;
  streaming: boolean;
  onSaved: () => void;
}) {
  const key = `inky-wb-adjust-${id}`;
  const [stored] = useState(() => {
    try {
      const draft: Draft =
        JSON.parse(localStorage.getItem(key) || "null") || emptyDraft();
      const pending: Pending | null = JSON.parse(
        localStorage.getItem(`${key}-pending`) || "null",
      );
      if (
        !Array.isArray(draft.selected) ||
        !draft.edits ||
        (pending &&
          (pending.input?.batchId !== id ||
            !pending.input.requestId ||
            !["adopt_plan_adjustment", "revise_plan_adjustment"].includes(
              pending.action,
            )))
      )
        throw Error("草稿格式不可用");
      return { draft, pending, error: "" };
    } catch {
      return {
        draft: emptyDraft(),
        pending: null,
        error: "本地调整草稿无法读取。为避免重复提交，请先保留并检查这份草稿。",
      };
    }
  });
  const [draft, setDraft] = useState(stored.draft);
  const draftRef = useRef(draft);
  const [pending, setPending] = useState(stored.pending);
  const [storageError, setStorageError] = useState(stored.error);
  const [data, setData] = useState<AdjustmentData>();
  const readGeneration = useRef(0);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [notice, setNotice] = useState(
    stored.draft.conflict ? conflictMessage : "",
  );
  const [editing, setEditing] = useState<string>();
  const persist = (next: Draft) => {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      draftRef.current = next;
      setDraft(next);
      return true;
    } catch {
      setStorageError(
        "无法保存本地调整草稿，暂未发送新操作。请检查本地存储后重新打开对话。",
      );
      return false;
    }
  };
  const load = async () => {
    const generation = ++readGeneration.current;
    try {
      const result = await paper<AdjustmentData>("get_plan_adjustment", {
        batchId: id,
      });
      if (generation !== readGeneration.current) return;
      setData(result);
      const current = draftRef.current;
      if (current.baseRevision == null)
        persist({ ...current, baseRevision: result.batch.revision });
      else if (current.baseRevision !== result.batch.revision && !pending) {
        persist({ ...current, conflict: true });
        setNotice(conflictMessage);
      }
    } catch (error) {
      if (generation === readGeneration.current) setNotice(getError(error));
    }
  };
  useEffect(() => {
    if (!streaming) void load();
    return () => {
      readGeneration.current++;
    };
  }, [id, streaming]);

  const clearPending = () => {
    try {
      localStorage.removeItem(`${key}-pending`);
      setPending(null);
    } catch {
      setStorageError(
        "无法更新本地请求记录。请检查本地存储后重新打开对话，原请求仍保留用于核实。",
      );
    }
  };

  const execute = async (request: Pending) => {
    if (running.current || storageError) return;
    readGeneration.current++;
    running.current = true;
    setBusy(true);
    setNotice("");
    // Persist before IPC so remounts and restarts keep the exact id and parameters.
    try {
      localStorage.setItem(`${key}-pending`, JSON.stringify(request));
    } catch {
      setStorageError(
        "无法保存待核实的请求，暂未发送。请检查本地存储后重新打开对话。",
      );
      running.current = false;
      setBusy(false);
      return;
    }
    setPending(request);
    try {
      const result = await paper<AdjustmentData>(request.action, request.input);
      setData(result);
      const current = draftRef.current;
      const revisedIds =
        request.action === "revise_plan_adjustment"
          ? (request.input.groups as { id: string }[]).map((group) => group.id)
          : [];
      const next = {
        ...current,
        baseRevision: result.batch.revision,
        conflict: false,
        selected: current.selected.filter((groupId) =>
          result.batch.groups.some(
            (group) => group.id === groupId && group.adoptedAt == null,
          ),
        ),
        edits: Object.fromEntries(
          Object.entries(current.edits).filter(
            ([groupId]) => !revisedIds.includes(groupId),
          ),
        ),
      };
      if (persist(next)) clearPending();
      setEditing(undefined);
      setNotice(
        request.action === "adopt_plan_adjustment"
          ? "所选调整已采用。原目标和已有执行记录保留。"
          : "候选预览已更新，计划尚未改变。核对后可采用所选调整。",
      );
      if (request.action === "adopt_plan_adjustment") onSaved();
    } catch (error) {
      const message = getError(error);
      setNotice(message);
      if (definitive.test(message)) {
        clearPending();
        if (
          /^(CONFLICT|NOT_FOUND|TASK_COMPLETED|ACTION_COMPLETED)/.test(message)
        ) {
          persist({ ...draftRef.current, conflict: true });
          setNotice(`${message}\n${conflictMessage}`);
        }
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const locked = busy || !!pending || !!storageError || !!draft.conflict;
  const editedIds = Object.keys(draft.edits);
  const groups = data?.batch.groups || [];
  const selected = groups.filter(
    (group) => draft.selected.includes(group.id) && group.adoptedAt == null,
  );
  const editAction = (
    group: AdjustmentGroup,
    index: number,
    changes: Partial<AdjustmentAction>,
  ) => {
    if (locked || group.adoptedAt != null) return;
    const actions = (draft.edits[group.id] || group.actions).map((action, i) =>
      i === index ? ({ ...action, ...changes } as AdjustmentAction) : action,
    );
    const edits = { ...draft.edits, [group.id]: actions };
    if (JSON.stringify(actions) === JSON.stringify(group.actions))
      delete edits[group.id];
    persist({ ...draft, edits });
  };
  const revise = () => {
    if (!data || locked || !editedIds.length) return;
    const changed = groups
      .filter(
        (group) => editedIds.includes(group.id) && group.adoptedAt == null,
      )
      .map((group) => ({
        id: group.id,
        reason: group.reason,
        actions: draft.edits[group.id],
      }));
    for (const group of changed)
      for (const action of group.actions) {
        if (
          "date" in action &&
          !(action.kind === "narrow" && action.date === null) &&
          !validDate(action.date)
        ) {
          setNotice("请填写有效的安排日期。");
          return;
        }
        if (
          "durationMinutes" in action &&
          action.durationMinutes !== undefined &&
          action.durationMinutes !== null &&
          (!Number.isInteger(action.durationMinutes) ||
            action.durationMinutes < 1 ||
            action.durationMinutes > 1440)
        ) {
          setNotice("预留时间请填写 1–1440 的整数分钟，或留空取消预留。");
          return;
        }
      }
    void execute({
      action: "revise_plan_adjustment",
      input: {
        requestId: crypto.randomUUID(),
        batchId: id,
        expectedRevision: draft.baseRevision,
        groups: changed,
      },
    });
  };
  if (streaming)
    return <div className="wk-adjustments muted">正在整理调整建议…</div>;
  return (
    <section className="wk-adjustments" aria-label="Coach 调整建议">
      <header>
        <strong>建议调整</strong>
        <span>核对并采用后才改变计划</span>
      </header>
      {!data && <p>{notice || "正在读取调整建议…"}</p>}
      {groups.map((group, index) => {
        const actions = draft.edits[group.id] || group.actions;
        const adopted = group.adoptedAt != null;
        const taskNames = [
          ...new Set(
            [...group.before.tasks, ...group.after.tasks].map(
              (task) => task.title,
            ),
          ),
        ];
        return (
          <article key={group.id} data-group-id={group.id}>
            <label className="wk-adjust-choice">
              <input
                type="checkbox"
                aria-label={`选择调整组 ${index + 1}`}
                checked={!adopted && draft.selected.includes(group.id)}
                disabled={locked || adopted}
                onChange={(event) =>
                  persist({
                    ...draft,
                    selected: event.target.checked
                      ? [...draft.selected, group.id]
                      : draft.selected.filter((value) => value !== group.id),
                  })
                }
              />
              <strong>
                调整 {index + 1}
                {adopted ? " · 已采用" : ""}
              </strong>
            </label>
            <p className="wk-adjust-reason">原因：{group.reason}</p>
            <p className="wk-adjust-preserved">
              保留：{taskNames.length ? taskNames.join("、") : "原任务"}
              的目标、原步骤和已有执行记录。
            </p>
            {group.actions.length > 1 && (
              <small>
                这 {group.actions.length} 项改动一起采用，保持依赖关系。
              </small>
            )}
            {group.actions.map((action, i) => (
              <ActionPreview key={i} group={group} action={action} />
            ))}
            {!adopted &&
              group.actions.some((action) => action.kind !== "reorder") && (
                <button
                  className="wk-adjust-edit-toggle"
                  disabled={locked}
                  onClick={() =>
                    setEditing(editing === group.id ? undefined : group.id)
                  }
                >
                  {editing === group.id ? "收起参数" : "修改参数"}
                </button>
              )}
            {(editing === group.id || !!draft.edits[group.id]) && !adopted && (
              <fieldset className="wk-adjust-editor" disabled={locked}>
                <legend>调整 {index + 1} 的参数</legend>
                {actions.map((action, i) =>
                  action.kind === "reorder" ? null : (
                    <div key={i}>
                      <strong>{actionName(group, action)}</strong>
                      {"date" in action && (
                        <label>
                          安排日期{action.kind === "narrow" ? "（可留空）" : ""}
                          <input
                            type="date"
                            aria-label={`调整 ${index + 1} 动作 ${i + 1} 安排日期`}
                            value={action.date || ""}
                            onChange={(event) =>
                              editAction(group, i, {
                                date:
                                  event.target.value ||
                                  (action.kind === "narrow" ? null : ""),
                              })
                            }
                          />
                        </label>
                      )}
                      {(action.kind === "reschedule" ||
                        action.kind === "reservation") && (
                        <label>
                          预留分钟（留空取消）
                          <input
                            type="number"
                            min={1}
                            max={1440}
                            step={1}
                            aria-label={`调整 ${index + 1} 动作 ${i + 1} 预留分钟`}
                            value={
                              (action.durationMinutes === undefined
                                ? group.before.dayItems.find(
                                    (item) => item.id === action.itemId,
                                  )?.durationMinutes
                                : action.durationMinutes) ?? ""
                            }
                            onChange={(event) =>
                              editAction(group, i, {
                                durationMinutes:
                                  event.target.value === ""
                                    ? null
                                    : Number(event.target.value),
                              })
                            }
                          />
                        </label>
                      )}
                    </div>
                  ),
                )}
                <p>保存后会重新生成预览；尚未采用前，正式计划保持原样。</p>
              </fieldset>
            )}
          </article>
        );
      })}
      {!!editedIds.length && (
        <div className="wk-adjust-save">
          <p>参数有未保存的修改。上方仍是原预览，先保存参数再核对。</p>
          <button disabled={locked} onClick={revise}>
            保存参数并更新预览
          </button>
        </div>
      )}
      {pending ? (
        <div className="wk-adjust-pending">
          <p>
            上次提交尚未核实。已保留原请求；先核实并重试，再修改参数或选择。
          </p>
          <button
            disabled={busy || !!storageError}
            onClick={() => void execute(pending)}
          >
            {busy ? "正在核实…" : "核实并重试原提交"}
          </button>
        </div>
      ) : (
        data && (
          <button
            className="wk-primary"
            disabled={locked || !selected.length || !!editedIds.length}
            onClick={() =>
              void execute({
                action: "adopt_plan_adjustment",
                input: {
                  requestId: crypto.randomUUID(),
                  batchId: id,
                  expectedRevision: draft.baseRevision,
                  groupIds: selected.map((group) => group.id),
                },
              })
            }
          >
            {busy
              ? "正在保存…"
              : groups.every((group) => group.adoptedAt != null)
                ? "已采用全部调整"
                : `采用所选 ${selected.length} 组调整`}
          </button>
        )
      )}
      <button
        className="wk-adjust-reload"
        disabled={busy}
        onClick={() => void load()}
      >
        重新读取候选
      </button>
      {(notice || storageError) && (
        <p className="wk-adjust-notice" role="status">
          {storageError || notice}
        </p>
      )}
    </section>
  );
}
