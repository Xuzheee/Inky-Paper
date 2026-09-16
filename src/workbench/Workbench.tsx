import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Leaf,
  Pencil,
  Plus,
  Settings,
  X,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import type { DayItem, State } from "../paper/paperTypes";
import {
  latestStepCue,
  planningViews,
  type LeftoverPlan,
} from "../shared/planning";
import CoachChat from "./CoachChat";
import ProjectsPanel from "./ProjectsPanel";
import TaskProject from "./TaskProject";
import PreferencesPanel from "./PreferencesPanel";
import DayCapacity from "./DayCapacity";
import BulkReschedule from "./BulkReschedule";
import NotesInbox from "./NotesInbox";
import DailyJournal from "./DailyJournal";
import MarkdownJournal from "./MarkdownJournal";
import TaskMetadata, { priorityLabels } from "./TaskMetadata";
import LeftoverPlans, { planItemLabel } from "./LeftoverPlans";
import { usePlanRequest } from "./usePlanRequest";
import {
  editorObjectKey,
  editorStorageKey,
  initialEditorDraft,
  listEditorDrafts,
  readEditorDraft,
  requestStorageKey,
  type EditorValues,
} from "./editorDraft";
import { dailyStats, datesWithRecords, durationLabel } from "./dailyRecord";
import { useDailyRecords } from "./useDailyRecords";
import {
  categories,
  calendarLanes,
  clock,
  dateKey,
  getError,
  minutes,
  prepareStepInInky,
  paper,
  parseDate,
  Row,
  shiftDay,
  validDate,
} from "./model";
import "./workbench.css";
import "./journal.css";

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      className="wk-dialog"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label="关闭" onClick={onClose}>
          <X size={21} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function StepEditor({
  row,
  date,
  onClose,
  onSaved,
  state,
  startMinute,
  storageScope,
}: {
  row?: Row;
  date: string | null;
  onClose: () => void;
  onSaved: () => void;
  state: State;
  startMinute?: number;
  storageScope: string;
}) {
  const objectKey = editorObjectKey(row);
  const [initial] = useState(() => {
    const fresh = initialEditorDraft(row, date, startMinute);
    try {
      if (!storageScope) throw Error("本地草稿存储尚未就绪。");
      const saved = readEditorDraft(storageScope, objectKey);
      return { draft: saved || fresh, restored: !!saved, error: "" };
    } catch {
      return {
        draft: fresh,
        restored: false,
        error: "这份编辑草稿无法读取，请保留原记录后检查。暂未发送修改。",
      };
    }
  });
  const original = initial.draft.original;
  const [values, setValues] = useState(initial.draft.values);
  const editedFields = useRef(
    new Set<keyof EditorValues>(
      initial.draft.editedFields ||
        (Object.keys(initial.draft.values) as (keyof EditorValues)[]),
    ),
  );
  const {
    title,
    text,
    category,
    priority,
    due,
    dueDate,
    expectedResult,
    day,
    time,
    duration,
    round,
  } = values;
  const touched = useRef(initial.restored);
  const editValue = <K extends keyof EditorValues>(
    key: K,
    value: EditorValues[K],
  ) => {
    touched.current = true;
    editedFields.current.add(key);
    setValues((previous) => ({ ...previous, [key]: value }));
  };
  const setTitle = (value: string) => editValue("title", value);
  const setText = (value: string) => editValue("text", value);
  const setCategory = (value: string) => editValue("category", value);
  const setPriority = (value: string) => editValue("priority", value);
  const setDue = (value: string) => editValue("due", value);
  const setDueDate = (value: string) => editValue("dueDate", value);
  const setExpectedResult = (value: string) =>
    editValue("expectedResult", value);
  const setDay = (value: string) => editValue("day", value);
  const setTime = (value: string) => editValue("time", value);
  const setDuration = (value: number) => editValue("duration", value);
  const setRound = (value: number) => editValue("round", value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(initial.error);
  const [base, setBase] = useState(initial.draft.base);
  const ids = useRef(initial.draft.ids);
  const [review, setReview] = useState(false);
  const request = usePlanRequest(
    storageScope
      ? requestStorageKey(storageScope, `editor:${objectKey}`)
      : undefined,
  );
  const persistDraft = () => {
    if (!storageScope || storageError) return false;
    try {
      localStorage.setItem(
        editorStorageKey(storageScope, objectKey),
        JSON.stringify({
          ...initial.draft,
          ids: ids.current,
          values,
          editedFields: [...editedFields.current],
          base,
          savedAt: Date.now(),
        }),
      );
      return true;
    } catch {
      setStorageError(
        "编辑草稿未能保存。请检查本地存储；内容仍留在此处，暂未发送修改。",
      );
      return false;
    }
  };
  useEffect(() => {
    if (touched.current) persistDraft();
  }, [values, base]);
  const clearDraft = () =>
    localStorage.removeItem(editorStorageKey(storageScope, objectKey));
  const save = async () => {
    if (
      !request.ready ||
      storageError ||
      busy ||
      (conflict && (!request.pending || request.definitiveFailure))
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (day && !validDate(day)) throw Error("请选择有效的安排日期。");
      if (dueDate && !validDate(dueDate)) throw Error("请选择有效的截止日期。");
      if (base?.item && !day)
        throw Error("请保留安排日期；取消安排可在任务详情中操作。");
      const input = {
        ...ids.current,
        expectedTaskRevision: base?.task.revision ?? null,
        expectedStepRevision: base?.step?.revision ?? null,
        title: title.trim(),
        text: text.trim() || title.trim(),
        category,
        // Omitted metadata keeps shared values intact, including older long criteria.
        ...(!original || editedFields.current.has("priority")
          ? { priority }
          : {}),
        ...(!original || editedFields.current.has("due")
          ? { due: due.trim() || null }
          : {}),
        ...(!original || editedFields.current.has("dueDate")
          ? { dueDate: dueDate || null }
          : {}),
        ...(!original || editedFields.current.has("expectedResult")
          ? { expectedResult: expectedResult.trim() || null }
          : {}),
        plannedSeconds: round * 60,
        date: day || null,
        itemId: base?.item?.id ?? null,
        expectedItemRevision: base?.item?.revision ?? null,
        startMinute: time && day ? minutes(time) : null,
        durationMinutes: day
          ? time
            ? duration
            : base?.item?.startMinute == null
              ? (base?.item?.durationMinutes ?? null)
              : null
          : null,
      };
      if (!persistDraft()) return;
      if (request.pending && !request.definitiveFailure) await request.retry();
      else await request.submit("workbench_save_step", input);
      clearDraft();
      touched.current = false;
      onSaved();
      onClose();
    } catch (e) {
      setError(getError(e));
      setReview(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  const latest = state.tasks.find((t) => t.id === ids.current.taskId);
  const latestStep = state.planning?.steps.find(
    (s) => s.id === ids.current.stepId,
  );
  const latestItem = state.planning?.dayItems.find(
    (item) => item.id === base?.item?.id,
  );
  const conflict =
    base &&
    (!latest ||
      latest.revision !== base.task.revision ||
      latestStep?.revision !== base.step?.revision ||
      state.planning?.dayItems.find((i) => i.id === base.item?.id)?.revision !==
        base.item?.revision);
  const closeEditor = () => {
    if (busy) return;
    if (request.pending && !request.definitiveFailure) {
      setError("保存结果尚未确认。请先点击“核实并重试”，确认后再关闭。");
      return;
    }
    if (touched.current && !persistDraft()) return;
    onClose();
  };
  return (
    <Dialog title={original ? "修改计划" : "添加任务"} onClose={closeEditor}>
      <form
        className="wk-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset
          className="wk-editor-fields"
          disabled={
            busy ||
            !request.ready ||
            !!storageError ||
            (!!request.pending && !request.definitiveFailure)
          }
        >
          <label>
            任务名称
            <input
              autoFocus
              required
              maxLength={300}
              value={title}
              placeholder="例如：准备周五的分享"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {!original && (
            <p className="muted">
              {day ? `安排到 ${day}` : "先放入待安排"}；下一步默认同标题，首轮{" "}
              {round} 分钟。
            </p>
          )}
          <details className="wk-editor-more" open={!!original}>
            <summary>
              更多选项 <small>步骤、分类与安排按需补充</small>
            </summary>
            <label>
              具体这一步 <small>可选，留空使用任务名称</small>
              <input
                maxLength={300}
                value={text}
                placeholder="例如：列出三个分享要点"
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <div className="wk-form-row">
              <label>
                分类
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {Object.entries(categories).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                首轮时长（分钟）
                <input
                  type="number"
                  min={1}
                  max={120}
                  required
                  value={round}
                  onChange={(e) => setRound(Number(e.target.value))}
                />
              </label>
            </div>
            <details
              className="wk-editor-metadata"
              open={
                !!row &&
                !!(
                  row.task.due ||
                  row.task.dueDate ||
                  row.step?.expectedResult ||
                  row.task.priority !== "medium"
                )
              }
            >
              <summary>
                优先级与完成要求 <small>按需补充</small>
              </summary>
              <div className="wk-form-row">
                <label>
                  优先级
                  <select
                    aria-label="优先级"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    {Object.entries(priorityLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  截止日期 <small>可选</small>
                  <input
                    aria-label="截止日期"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </label>
              </div>
              <p className="muted">
                截止日期是最晚完成日，与下面的安排日期分开保存。
              </p>
              <label>
                截止备注 <small>保留原有说明</small>
                <input
                  aria-label="截止备注"
                  maxLength={100}
                  value={due}
                  placeholder="例如：等对方回复后再确认"
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
              <label>
                步骤完成标准 <small>可选</small>
                <textarea
                  aria-label="步骤完成标准"
                  rows={2}
                  maxLength={2000}
                  value={expectedResult}
                  placeholder="做到什么就算这一步完成？"
                  onChange={(e) => setExpectedResult(e.target.value)}
                />
              </label>
            </details>
            <div className="wk-form-row">
              <label>
                安排日期
                <input
                  aria-label="安排日期"
                  type="date"
                  required={!!row?.item}
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </label>
              {!row?.item && (
                <button
                  className="wk-subtle"
                  type="button"
                  onClick={() => {
                    setDay("");
                    setTime("");
                  }}
                >
                  放入待安排
                </button>
              )}
            </div>
            {day && (
              <div className="wk-form-row">
                <label>
                  开始时间 <small>可选</small>
                  <input
                    aria-label="开始时间"
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </label>
                <label>
                  日程时长（分钟）
                  <input
                    type="number"
                    required={!!time}
                    min={1}
                    max={1440}
                    disabled={!time}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  />
                </label>
              </div>
            )}
            <p className="muted">
              日程表示你的安排，实际工作时间在 Inky 开始后记录。
            </p>
          </details>
          {conflict && (
            <div className="wk-stale">
              <p>原对象已变化，草稿保持原样。</p>
              <p>最新任务：{latest?.title || "任务已不可用"}</p>
              <p>最新步骤：{latestStep?.text || "步骤已不可用"}</p>
              {base?.item && (
                <p>
                  最新安排：
                  {latestItem && !latestItem.removedAt
                    ? `${latestItem.date} · ${latestItem.startMinute == null ? "未设时刻" : clock(latestItem.startMinute)} · ${latestItem.durationMinutes == null ? "未设预留" : `${latestItem.durationMinutes} 分钟`}`
                    : "安排已取消或不可用"}
                </p>
              )}
              {latest && <TaskMetadata task={latest} step={latestStep} />}
              <p>核对后保留你改过的字段，其余字段使用最新内容。</p>
              <label>
                <input
                  type="checkbox"
                  checked={review}
                  disabled={
                    !latest ||
                    (!!base?.step && !latestStep) ||
                    (!!base?.item &&
                      !state.planning?.dayItems.some(
                        (item) => item.id === base.item!.id && !item.removedAt,
                      ))
                  }
                  onChange={(e) => {
                    setReview(e.target.checked);
                    if (e.target.checked) {
                      const nextBase = {
                        task: latest!,
                        step: latestStep,
                        item: latestItem,
                      };
                      const nextValues = initialEditorDraft(
                        nextBase,
                        day || null,
                        time ? minutes(time) : undefined,
                      ).values;
                      touched.current = true;
                      setValues(
                        (current) =>
                          Object.fromEntries(
                            Object.entries(current).map(([key, value]) => [
                              key,
                              editedFields.current.has(
                                key as keyof EditorValues,
                              )
                                ? value
                                : nextValues[key as keyof EditorValues],
                            ]),
                          ) as EditorValues,
                      );
                      setBase(nextBase);
                    }
                  }}
                />
                已核对，使用当前草稿保存
              </label>
            </div>
          )}
        </fieldset>
        {initial.restored && (
          <p className="muted">
            已恢复此对象的未保存草稿；关闭后仍可继续编辑。
          </p>
        )}
        {(storageError || request.storageError) && (
          <p className="wk-error" role="alert">
            {storageError || request.storageError}
          </p>
        )}
        {error && (
          <p className="wk-error" role="alert">
            {error}
          </p>
        )}
        {request.pending && !request.definitiveFailure && (
          <p className="muted">
            保存结果尚未确认，草稿已保留。请先核实并重试，确认后再编辑或关闭。
          </p>
        )}
        <footer>
          {(!request.pending || request.definitiveFailure) &&
            touched.current && (
              <button
                type="button"
                disabled={busy || !!storageError}
                onClick={() => {
                  try {
                    if (request.pending) request.discardDefinitiveFailure();
                    clearDraft();
                    touched.current = false;
                    onClose();
                  } catch {
                    setStorageError("草稿暂时无法移除，请检查本地存储。");
                  }
                }}
              >
                放弃草稿
              </button>
            )}
          <button
            type="button"
            disabled={busy || (!!request.pending && !request.definitiveFailure)}
            onClick={closeEditor}
          >
            取消
          </button>
          <button
            className="wk-primary"
            disabled={
              busy ||
              !request.ready ||
              !!storageError ||
              (!!conflict && (!request.pending || request.definitiveFailure))
            }
            type="submit"
          >
            {busy
              ? "正在保存…"
              : request.pending && !request.definitiveFailure
                ? "核实并重试"
                : "保存计划"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

export default function Workbench() {
  const [state, setState] = useState<State>();
  const [storageScope, setStorageScope] = useState<string>();
  const [storageIssue, setStorageIssue] = useState("");
  const [drafts, setDrafts] = useState<ReturnType<typeof listEditorDrafts>>([]);
  const refreshDrafts = useCallback(
    (scope = storageScope) => {
      if (!scope) return;
      try {
        setDrafts(listEditorDrafts(scope));
      } catch {
        setStorageIssue(
          "本地编辑草稿无法读取，请保留原记录后检查。暂未发送修改。",
        );
      }
    },
    [storageScope],
  );
  const loadScope = useCallback(async () => {
    try {
      const { scopeId } = await invoke<{ scopeId: string }>(
        "workbench_storage_scope",
      );
      if (!scopeId) throw Error("未返回存储范围");
      const recovered = listEditorDrafts(scopeId);
      setDrafts(recovered);
      setStorageScope(scopeId);
      setStorageIssue("");
    } catch {
      setStorageIssue("本地草稿存储尚未就绪，暂未发送修改。请重试读取。");
    }
  }, []);
  useEffect(() => {
    void loadScope();
  }, [loadScope]);
  const [day, setDay] = useState(dateKey);
  const [coachPrefill, setCoachPrefill] = useState<{
    text: string;
    serial: number;
  }>();
  const [coachCollapsed, setCoachCollapsed] = useState(false);
  const [month, setMonth] = useState(() => dateKey().slice(0, 7));
  const [view, setView] = useState<
    "tasks" | "calendar" | "record" | "markdown"
  >("tasks");
  const [documentKind, setDocumentKind] = useState("day");
  const [recordsRevision, setRecordsRevision] = useState(0);
  const [nav, setNav] = useState<"week" | "inbox" | "notes" | "context">(
    "week",
  );
  const [projectFilter, setProjectFilter] = useState("");
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [editor, setEditor] = useState<{
    row?: Row;
    date: string | null;
    startMinute?: number;
  }>();
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showProjects, setShowProjects] = useState(true);
  const [cancelPreview, setCancelPreview] = useState<{
    row: Row;
    items: DayItem[];
    scope: "selected" | "unexecuted";
    retained: number;
  }>();
  const request = usePlanRequest(
    storageScope ? requestStorageKey(storageScope, "operations") : undefined,
  );
  const blocked =
    busy ||
    !request.ready ||
    !!storageIssue ||
    !!request.pending ||
    drafts.some((draft) => draft.unconfirmed);
  const requestEffects = useRef<{
    message?: string | ((data: Record<string, unknown>) => string);
    after?: (data: Record<string, unknown>) => void;
  }>({});
  const actionInFlight = useRef(false);
  const generation = useRef(0);
  const dragged = useRef<Row>();
  const timeline = useRef<HTMLDivElement>(null);
  const reload = useCallback(async () => {
    const id = ++generation.current;
    try {
      const r = await paper<{ state: State }>("get_state");
      if (id === generation.current) {
        setState(r.state);
        setRecordsRevision((value) => value + 1);
      }
    } catch (e) {
      setError(getError(e));
    }
  }, []);
  useEffect(() => {
    document.title = "Inky · 工作台";
    void reload();
    const off = listen("paper:changed", () => void reload());
    return () => {
      generation.current++;
      void off.then((f) => f());
    };
  }, [reload]);
  useEffect(() => {
    if (view === "calendar" && timeline.current)
      timeline.current.scrollTop = 8 * 68;
  }, [view]);
  const days = [day, shiftDay(day, 1), shiftDay(day, 2)];
  const records = useDailyRecords(days, recordsRevision);
  const recordedDates = datesWithRecords(state);
  const singleDay = view === "record" || view === "markdown";
  const openRecord = (date: string) => {
    goDay(date);
    setFilter("");
    setView("record");
  };
  const plans = state
    ? planningViews(state, dateKey())
    : { rows: [], unplanned: [], leftovers: [] };
  const rows: Row[] = plans.rows;
  const loose: Row[] = plans.unplanned;
  const key = (r: Row) => r.item?.id || r.step?.id || r.task.id;
  const selected = [...rows, ...loose].find((r) => key(r) === selectedId);
  const visible = (items: Row[]) =>
    items.filter(
      (r) =>
        (!filter || r.task.category === filter) &&
        (!projectFilter || r.task.projectId === projectFilter),
    );
  const finishAction = async (
    submit: () => Promise<Record<string, unknown>>,
  ) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await submit();
      await reload();
      requestEffects.current.after?.(data);
      const message = requestEffects.current.message;
      if (message)
        setNotice(typeof message === "string" ? message : message(data));
      else setNotice("操作已核实，计划和记录已刷新。");
    } catch (e) {
      setError(getError(e));
      await reload();
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  };
  const onAction = (
    action: string,
    input: Record<string, unknown>,
    message?: string | ((data: Record<string, unknown>) => string),
    after?: (data: Record<string, unknown>) => void,
  ) => {
    if (blocked || actionInFlight.current) return;
    requestEffects.current = { message, after };
    return finishAction(() => request.submit(action, input));
  };
  const retryAction = () => finishAction(request.retry);
  const reconsiderAction = async () => {
    await reload();
    if (request.discardDefinitiveFailure()) {
      setCancelPreview(undefined);
      setError("");
    }
  };
  const previewCancel = (row: Row, scope: "selected" | "unexecuted") => {
    if (!row.step || blocked || !state) return;
    const active = rows
      .filter((r) => r.task.id === row.task.id && r.step?.id === row.step!.id)
      .map((r) => r.item!);
    const executed = new Set(
      state.planning?.sessionLinks?.map((link) => link.dayItemId),
    );
    const items =
      scope === "selected"
        ? active.filter((item) => item.id === row.item?.id)
        : active.filter((item) => !executed.has(item.id));
    setCancelPreview({
      row,
      scope,
      items,
      retained: active.length - items.length,
    });
  };
  const cancelItems = () => {
    if (!cancelPreview || !cancelPreview.items.length) return;
    const { row, items, scope } = cancelPreview;
    void onAction(
      "cancel_plan_items",
      {
        taskId: row.task.id,
        stepId: row.step!.id,
        expectedTaskRevision: row.task.revision,
        expectedStepRevision: row.step!.revision,
        items: items.map((item) => ({ id: item.id, revision: item.revision })),
        scope,
      },
      (data) =>
        Number(data.remainingActiveCount) > 0
          ? `已取消所选安排，仍有 ${data.remainingActiveCount} 条有效安排；步骤未放回待安排。`
          : "已取消所选安排，步骤已回到待安排。任务和执行记录保留。",
      () => {
        setCancelPreview(undefined);
        setSelectedId("");
      },
    );
  };
  const continueToday = (group: LeftoverPlan) => {
    void onAction(
      "continue_plan_items",
      {
        taskId: group.task.id,
        stepId: group.step.id,
        expectedTaskRevision: group.task.revision,
        expectedStepRevision: group.step.revision,
        items: group.items.map((item) => ({
          id: item.id,
          revision: item.revision,
        })),
        date: dateKey(),
      },
      "已安排今天继续，保留同一步骤和原有记录。",
      (data) => {
        goDay(dateKey());
        setView("tasks");
        setSelectedId((data.item as DayItem).id);
      },
    );
  };
  const complete = (r: Row) =>
    r.step
      ? onAction("set_step_completed", {
          taskId: r.task.id,
          stepId: r.step.id,
          expectedTaskRevision: r.task.revision,
          expectedStepRevision: r.step.revision,
          completed: !r.step.completed,
        })
      : onAction("update_task", {
          taskId: r.task.id,
          expectedRevision: r.task.revision,
          patch: { completed: !r.task.completed },
        });
  const choose = async (r: Row) => {
    if (!r.step || blocked) return;
    setBusy(true);
    setError("");
    try {
      await prepareStepInInky(r);
      setNotice("已选好下一步，回到 Inky 后点击 start 开始。");
    } catch (e) {
      setError(getError(e));
    } finally {
      await reload();
      setBusy(false);
    }
  };
  const goDay = (s: string) => {
    setSelectedId("");
    setDay(s);
    setMonth(s.slice(0, 7));
    setNav("week");
  };
  const drop = (
    e: DragEvent,
    date: string | null,
    before?: Row,
    start?: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const r = dragged.current;
    dragged.current = undefined;
    if (!r || blocked) return;
    if (r.item && r.item.id === before?.item?.id) return;
    if (r.item) {
      if (date === null) {
        previewCancel(r, "unexecuted");
        return;
      }
      const st = start ?? r.item.startMinute ?? null;
      const duration =
        r.item.durationMinutes ||
        Math.round((r.step?.plannedSeconds || 1500) / 60);
      void onAction("workbench_move_item", {
        itemId: r.item.id,
        expectedItemRevision: r.item.revision,
        date,
        beforeItemId: before?.item?.id || null,
        startMinute: date ? st : null,
        durationMinutes:
          date && st != null
            ? Math.min(duration, 1440 - st)
            : (r.item.durationMinutes ?? null),
      });
    } else {
      setEditor({ row: r, date, startMinute: start });
    }
  };
  const dragProps = (r: Row) => ({
    draggable: !blocked,
    onDragStart: (e: DragEvent) => {
      dragged.current = r;
      e.dataTransfer.setData("text/plain", key(r));
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      dragged.current = undefined;
    },
  });
  const rowView = (r: Row, index: number) => {
    const expanded = key(r) === selectedId;
    const cue =
      state && r.step ? latestStepCue(state, r.task.id, r.step.id) : null;
    const steps =
      state?.planning?.steps.filter((s) => s.taskId === r.task.id) || [];
    return (
      <article
        data-row-id={key(r)}
        className={`wk-task ${expanded ? "selected" : ""}`}
        key={key(r)}
        {...dragProps(r)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => drop(e, r.item?.date || null, r)}
      >
        <div className="wk-task-top">
          <span className="wk-number">
            {String(index + 1).padStart(2, "0")}
          </span>
          <button
            className={`wk-check ${r.step?.completed || r.task.completed ? "checked" : ""}`}
            aria-label={`${r.step?.completed || r.task.completed ? "撤销完成" : "完成"} ${r.step?.text || r.task.title}`}
            disabled={blocked}
            onClick={() => void complete(r)}
          >
            {(r.step?.completed || r.task.completed) && <Check size={15} />}
          </button>
          <button
            className={`wk-task-title ${r.step?.completed || r.task.completed ? "done" : ""}`}
            onClick={() => setSelectedId(expanded ? "" : key(r))}
          >
            {r.step?.text || r.task.title}
          </button>
          <span className="wk-duration">
            {Math.round((r.step?.plannedSeconds || 1500) / 60)}分
          </span>
        </div>
        <div className={`wk-task-meta ${r.task.category}`}>
          <span># {categories[r.task.category] || r.task.category}</span>
          {r.item?.startMinute != null && (
            <span>{clock(r.item.startMinute)}</span>
          )}
          <button
            className="wk-edit"
            disabled={blocked}
            aria-label={`修改 ${r.step?.text || r.task.title}`}
            onClick={() => setEditor({ row: r, date: r.item?.date || null })}
          >
            <Pencil size={14} />
          </button>
        </div>
        {!expanded && <TaskMetadata task={r.task} compact />}
        {expanded && (
          <div className="wk-task-detail">
            {r.step?.text !== r.task.title && <small>{r.task.title}</small>}
            {steps.length > 1 &&
              steps.map((step) => (
                <div className="wk-child" key={step.id}>
                  <button
                    className={`wk-check ${step.completed ? "checked" : ""}`}
                    aria-label={`${step.completed ? "撤销完成" : "完成"}步骤 ${step.text}`}
                    disabled={blocked}
                    onClick={() => void complete({ ...r, step })}
                  >
                    {step.completed && <Check size={14} />}
                  </button>
                  <span className={step.completed ? "done" : ""}>
                    {step.text}
                  </span>
                </div>
              ))}
            <TaskMetadata task={r.task} step={r.step} />
            {state && storageScope && (
              <TaskProject
                task={r.task}
                state={state}
                storageScope={storageScope}
                onSaved={() => void reload()}
              />
            )}
            {cue && (
              <div className="wk-step-cue" data-session-id={cue.sessionId}>
                <strong>下次从这里继续</strong>
                <p>{cue.text}</p>
              </div>
            )}
            <div className="wk-detail-actions">
              {r.step && !r.step.completed && !r.task.completed && (
                <button disabled={blocked} onClick={() => void choose(r)}>
                  设为下一步并回到 Inky
                </button>
              )}
              <button
                disabled={blocked}
                onClick={() =>
                  setEditor({ row: r, date: r.item?.date || null })
                }
              >
                修改安排
              </button>
              {r.item && r.step && !r.step.completed && !r.task.completed && (
                <>
                  <button
                    disabled={blocked}
                    onClick={() => previewCancel(r, "selected")}
                  >
                    取消本次安排
                  </button>
                  <button
                    disabled={blocked}
                    onClick={() => previewCancel(r, "unexecuted")}
                  >
                    放回待安排
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </article>
    );
  };
  const first = parseDate(`${month}-01`);
  const firstDay = (first.getDay() + 6) % 7;
  const monthStart = shiftDay(dateKey(first), -firstDay);
  const monthDays = new Date(
    first.getFullYear(),
    first.getMonth() + 1,
    0,
  ).getDate();
  const cells = Array.from(
    { length: Math.ceil((firstDay + monthDays) / 7) * 7 },
    (_, i) => shiftDay(monthStart, i),
  );
  const changeMonth = (n: number) => {
    const d = parseDate(`${month}-01`);
    d.setMonth(d.getMonth() + n);
    setMonth(dateKey(d).slice(0, 7));
  };
  const monday = shiftDay(day, -((parseDate(day).getDay() + 6) % 7));
  return (
    <main className={`wk-app${coachCollapsed ? " wk-coach-collapsed" : ""}`}>
      <aside className="wk-sidebar">
        <div className="wk-brand">
          <Leaf size={30} />
          <div>
            <strong>Inky</strong>
            <p>更清晰地完成重要的事</p>
          </div>
        </div>
        <section className="wk-month" aria-label="选择日期">
          <header>
            <strong>
              {Number(month.slice(0, 4))}年{Number(month.slice(5))}月
            </strong>
            <button aria-label="上个月" onClick={() => changeMonth(-1)}>
              <ChevronLeft size={18} />
            </button>
            <button aria-label="下个月" onClick={() => changeMonth(1)}>
              <ChevronRight size={18} />
            </button>
          </header>
          <div className="wk-month-grid">
            {["一", "二", "三", "四", "五", "六", "日"].map((n) => (
              <span className="wk-weekday" key={n}>
                {n}
              </span>
            ))}
            {cells.map((s) => (
              <button
                key={s}
                aria-label={s}
                aria-current={s === dateKey() ? "date" : undefined}
                className={`${s === day ? "active" : ""} ${s.slice(0, 7) !== month ? "outside" : ""}`}
                onClick={() => goDay(s)}
              >
                {Number(s.slice(-2))}
                {(rows.some((r) => r.item?.date === s) ||
                  recordedDates.has(s)) && <i />}
              </button>
            ))}
          </div>
        </section>
        <nav className="wk-nav">
          <button
            className={
              nav === "week" && !filter && !projectFilter ? "active" : ""
            }
            onClick={() => {
              setNav("week");
              setFilter("");
              setProjectFilter("");
              goDay(dateKey());
            }}
          >
            <CalendarDays size={22} />
            本周
          </button>
          <button
            className={nav === "inbox" ? "active" : ""}
            onClick={() => {
              setNav("inbox");
              setSelectedId("");
              setFilter("");
              setProjectFilter("");
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => drop(e, null)}
          >
            <Inbox size={22} />
            待安排<span>{loose.length || ""}</span>
          </button>
          <button
            className={nav === "notes" ? "active" : ""}
            onClick={() => {
              setNav("notes");
              setProjectFilter("");
              setView("tasks");
              setSelectedId("");
              setFilter("");
            }}
          >
            <Pencil size={22} />
            随手记整理
          </button>
        </nav>
        <div className="wk-projects">
          <button
            className="wk-project-heading"
            onClick={() => setShowProjects(!showProjects)}
          >
            分类
            <ChevronDown size={18} className={!showProjects ? "closed" : ""} />
          </button>
          {showProjects &&
            Object.entries(categories).map(([k, v]) => (
              <button
                key={k}
                className={filter === k ? "active" : ""}
                onClick={() => {
                  if (nav === "notes" || nav === "context") setNav("week");
                  setProjectFilter("");
                  setFilter(filter === k ? "" : k);
                  setSelectedId("");
                  if (singleDay) setView("tasks");
                }}
              >
                <i className={k} />
                {v}
              </button>
            ))}
        </div>
        <div className="wk-projects" aria-label="项目筛选">
          <p className="wk-project-heading">项目</p>
          {(state?.planning?.context?.projects || [])
            .filter(
              (p) =>
                !p.archived || state?.tasks.some((t) => t.projectId === p.id),
            )
            .map((project) => (
              <button
                key={project.id}
                title={project.title}
                className={projectFilter === project.id ? "active" : ""}
                onClick={() => {
                  setProjectFilter(
                    projectFilter === project.id ? "" : project.id,
                  );
                  setFilter("");
                  setSelectedId("");
                  setNav("week");
                  setView("tasks");
                }}
              >
                {project.title}
                {project.archived ? "（已归档）" : ""}
              </button>
            ))}
          <button
            onClick={() => {
              setNav("context");
              setSelectedId("");
              setFilter("");
              setProjectFilter("");
              setView("tasks");
            }}
          >
            管理项目与偏好
          </button>
        </div>
        <div className="wk-side-bottom">
          <button
            onClick={() =>
              void invoke("coach_show_main", { view: "home" }).catch((e) =>
                setError(getError(e)),
              )
            }
          >
            <ExternalLink size={20} />
            回到 Inky
          </button>
          <button onClick={() => setSettings(true)}>
            <Settings size={21} />
            设置
          </button>
        </div>
      </aside>
      <section className="wk-main">
        <header className="wk-topbar">
          <h1>工作台</h1>
          <span>计划 · 记录 · 对话</span>
          <button
            title="刷新工作记录"
            aria-label="刷新"
            onClick={() => void reload()}
          >
            <RefreshCw size={17} />
          </button>
        </header>
        <div className="wk-hero">
          <div>
            <h2>
              {nav === "context"
                ? "项目与偏好"
                : nav === "notes"
                  ? "整理随手记"
                  : nav === "inbox"
                    ? "先放在这里，慢慢理清。"
                    : singleDay
                      ? "这一天，留下足迹。"
                      : "这一周，慢慢推进。"}
            </h2>
            {nav !== "notes" && (
              <div className="wk-date-controls">
                <button
                  aria-label={singleDay ? "前一天" : "前面三天"}
                  onClick={() => goDay(shiftDay(day, singleDay ? -1 : -3))}
                >
                  <ChevronLeft size={20} />
                </button>
                <button onClick={() => goDay(dateKey())}>今天</button>
                <button
                  aria-label={singleDay ? "后一天" : "后面三天"}
                  onClick={() => goDay(shiftDay(day, singleDay ? 1 : 3))}
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )}
          </div>
          <div>
            {nav !== "notes" && (
              <p>
                {filter && !singleDay ? `${categories[filter]} · ` : ""}
                {projectFilter && !singleDay
                  ? `${state?.planning?.context?.projects?.find((p) => p.id === projectFilter)?.title || "项目"} · `
                  : ""}
                {singleDay ? (
                  day
                ) : (
                  <>
                    {Number(monday.slice(5, 7))}月{Number(monday.slice(8))}日 —{" "}
                    {Number(shiftDay(monday, 6).slice(5, 7))}月
                    {Number(shiftDay(monday, 6).slice(8))}日
                  </>
                )}
              </p>
            )}
            {nav === "week" && (
              <div className="wk-tabs" role="tablist" aria-label="计划视图">
                <button
                  role="tab"
                  aria-selected={view === "tasks"}
                  onClick={() => setView("tasks")}
                >
                  任务
                </button>
                <button
                  role="tab"
                  aria-selected={view === "calendar"}
                  onClick={() => setView("calendar")}
                >
                  日程
                </button>
                <button
                  role="tab"
                  aria-selected={view === "record"}
                  onClick={() => {
                    setView("record");
                    setSelectedId("");
                    setFilter("");
                  }}
                >
                  每日记录
                </button>
                <button
                  role="tab"
                  aria-selected={view === "markdown"}
                  onClick={() => {
                    setView("markdown");
                    setSelectedId("");
                    setFilter("");
                  }}
                >
                  Markdown
                </button>
              </div>
            )}
          </div>
        </div>
        {(!storageScope || storageIssue) && (
          <div className="wk-banner" role="status">
            <span>{storageIssue || "正在读取本地草稿…"}</span>
            {storageIssue && (
              <button onClick={() => void loadScope()}>重试读取草稿</button>
            )}
          </div>
        )}
        {!!drafts.length && (
          <details
            className="wk-draft-recovery"
            open={drafts.some((draft) => draft.unconfirmed)}
          >
            <summary>
              未保存草稿 · {drafts.length}
              {drafts.some((draft) => draft.unconfirmed)
                ? " · 有待核实的保存"
                : ""}
            </summary>
            {drafts.map((draft) => (
              <button
                key={draft.objectKey}
                disabled={
                  !request.ready || !!request.pending || !!storageIssue || busy
                }
                onClick={() =>
                  setEditor({
                    row: draft.original,
                    date: draft.values.day || null,
                  })
                }
              >
                {draft.unconfirmed ? "核实保存" : "恢复草稿"}：
                {draft.values.title || "未命名任务"}
                <small>{draft.values.day || "待安排"}</small>
              </button>
            ))}
          </details>
        )}
        {(error || request.pending || request.storageError) && (
          <div className="wk-banner wk-error" role="alert">
            <span>
              {request.storageError ||
                error ||
                "上次计划操作的结果尚未核实，请使用原提交重试。"}
            </span>
            {request.pending && (
              <>
                <button
                  disabled={busy || !request.ready}
                  onClick={() => void retryAction()}
                >
                  核实并重试
                </button>
                {request.definitiveFailure && (
                  <button
                    disabled={busy}
                    onClick={() => void reconsiderAction()}
                  >
                    重新读取再操作
                  </button>
                )}
              </>
            )}
            {!request.pending && (
              <button aria-label="关闭错误" onClick={() => setError("")}>
                <X size={17} />
              </button>
            )}
          </div>
        )}
        {notice && (
          <div className="wk-banner" role="status">
            <span>{notice}</span>
            <button aria-label="关闭提示" onClick={() => setNotice("")}>
              <X size={17} />
            </button>
          </div>
        )}
        {state && storageScope && nav === "week" && !singleDay && (
          <DayCapacity
            key={`${storageScope}-${day}`}
            state={state}
            date={day}
            scope={storageScope}
            onSaved={() => void reload()}
            onDiscuss={(text) => {
              setCoachCollapsed(false);
              setSelectedId("");
              setProjectFilter("");
              setCoachPrefill({ text, serial: Date.now() });
            }}
          />
        )}
        {state && storageScope && nav === "week" && !singleDay && (
          <BulkReschedule
            key={storageScope}
            rows={visible(rows)}
            storageScope={storageScope}
            blocked={blocked}
            onSaved={() => void reload()}
          />
        )}
        {state && nav === "week" && !singleDay && (
          <LeftoverPlans
            groups={plans.leftovers.filter(
              (group) =>
                (!filter || group.task.category === filter) &&
                (!projectFilter || group.task.projectId === projectFilter),
            )}
            busy={blocked}
            onContinue={continueToday}
            onEdit={(row) => setEditor({ row, date: row.item!.date })}
            onCancel={(row) => previewCancel(row, "selected")}
            onUnplan={(row) => previewCancel(row, "unexecuted")}
            onDiscuss={(row) => {
              setSelectedId(key(row));
              setCoachCollapsed(false);
            }}
          />
        )}
        {!state ? (
          <p className="wk-loading">正在读取工作记录…</p>
        ) : nav === "context" ? (
          storageScope ? (
            <div className="wk-context-page">
              <ProjectsPanel
                state={state}
                storageScope={storageScope}
                onSaved={() => void reload()}
              />
              <PreferencesPanel
                state={state}
                storageScope={storageScope}
                onSaved={() => void reload()}
              />
            </div>
          ) : (
            <p>正在读取本地设置…</p>
          )
        ) : nav === "notes" ? (
          storageScope ? (
            <NotesInbox
              state={state}
              storageScope={storageScope}
              onSaved={() => void reload()}
              onSelectTask={(id) => {
                const row = [...loose, ...rows].find((r) => r.task.id === id);
                setView("tasks");
                setFilter("");
                setProjectFilter("");
                if (row?.item) {
                  goDay(row.item.date);
                  setSelectedId(key(row));
                } else {
                  setNav("inbox");
                  setSelectedId(row ? key(row) : "");
                  if (!row) {
                    const task = state.tasks.find((t) => t.id === id);
                    if (task) setEditor({ row: { task }, date: null });
                  }
                }
              }}
            />
          ) : (
            <p className="wk-loading">正在读取随手记…</p>
          )
        ) : nav === "inbox" ? (
          <div className="wk-inbox">
            <header>
              <h3>待安排</h3>
              <button
                disabled={blocked}
                onClick={() => setEditor({ date: null })}
              >
                <Plus size={19} />
                添加任务
              </button>
            </header>
            <p className="muted">还没定下时间的事情，先留在这里。</p>
            {visible(loose).length ? (
              visible(loose).map(rowView)
            ) : (
              <div className="wk-empty">
                <Inbox size={28} />
                <p>这里暂时没有待安排的任务</p>
                <button
                  disabled={blocked}
                  onClick={() => setEditor({ date: null })}
                >
                  记下一件想做的事
                </button>
              </div>
            )}
          </div>
        ) : view === "record" ? (
          <DailyJournal
            date={day}
            state={state}
            entry={records[day]}
            openMarkdown={(kind = "day") => {
              setDocumentKind(kind);
              setView("markdown");
            }}
          />
        ) : view === "markdown" ? (
          <MarkdownJournal
            date={day}
            kind={documentKind}
            setKind={setDocumentKind}
            refreshKey={records[day]?.record?.sampledAt || recordsRevision}
          />
        ) : (
          <>
            <div
              className={`wk-days-heading ${view === "calendar" ? "calendar" : ""}`}
            >
              {days.map((d) => (
                <div key={d}>
                  <div className="wk-day-date">
                    <strong>{Number(d.slice(-2))}</strong>
                    <div>
                      <span>
                        周
                        {
                          ["日", "一", "二", "三", "四", "五", "六"][
                            parseDate(d).getDay()
                          ]
                        }{" "}
                        {d === dateKey() && <b>今天</b>}
                      </span>
                      <p>
                        {Number(d.slice(5, 7))}月{Number(d.slice(8))}日
                      </p>
                    </div>
                  </div>
                  <button
                    className="wk-day-summary"
                    aria-label={`查看 ${d} 每日记录`}
                    onClick={() => openRecord(d)}
                  >
                    {records[d]?.record
                      ? (() => {
                          const stats = dailyStats(records[d].record!);
                          return (
                            <>
                              当日完成 {stats.completed} 步<br />
                              工作计时 {durationLabel(stats.workSeconds)}
                            </>
                          );
                        })()
                      : records[d]?.error
                        ? "记录读取失败 · 查看"
                        : "正在同步记录…"}
                  </button>
                </div>
              ))}
            </div>
            {view === "tasks" ? (
              <div className="wk-board">
                {days.map((d) => {
                  const items = visible(
                    rows.filter((r) => r.item?.date === d),
                  ).sort((a, b) => a.item!.order - b.item!.order);
                  return (
                    <section
                      className="wk-day-column"
                      data-date={d}
                      key={d}
                      aria-label={`${d}的任务`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => drop(e, d)}
                    >
                      <button
                        className="wk-add-task"
                        disabled={blocked}
                        onClick={() => setEditor({ date: d })}
                      >
                        <Plus size={20} />
                        添加任务
                      </button>
                      {items.length ? (
                        items.map(rowView)
                      ) : (
                        <div className="wk-day-empty">
                          <p>留一点空间给这一天</p>
                          <span>添加任务，或从右侧聊出下一步。</span>
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="wk-calendar-scroll" ref={timeline}>
                <div className="wk-all-day">
                  <span>未定时间</span>
                  {days.map((d) => (
                    <div key={d}>
                      {visible(
                        rows.filter(
                          (r) =>
                            r.item?.date === d && r.item.startMinute == null,
                        ),
                      ).map((r) => (
                        <button
                          key={key(r)}
                          className={r.step?.completed ? "done" : ""}
                          disabled={blocked}
                          {...dragProps(r)}
                          onClick={() => setEditor({ row: r, date: d })}
                        >
                          {r.step?.completed && "✓ "}
                          {r.step?.text || r.task.title}
                        </button>
                      ))}
                      <button
                        aria-label={`${d}添加日程`}
                        disabled={blocked}
                        onClick={() => setEditor({ date: d })}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="wk-calendar-grid">
                  <div className="wk-time-labels">
                    {Array.from({ length: 24 }, (_, h) => (
                      <span key={h} style={{ top: h * 68 }}>
                        {clock(h * 60)}
                      </span>
                    ))}
                  </div>
                  {days.map((d) => {
                    const items = visible(
                      rows.filter(
                        (r) => r.item?.date === d && r.item.startMinute != null,
                      ),
                    ).sort(
                      (a, b) => a.item!.startMinute! - b.item!.startMinute!,
                    );
                    const lanes = calendarLanes(items);
                    return (
                      <div
                        className="wk-time-column"
                        key={d}
                        aria-label={`${d}的日程`}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          drop(
                            e,
                            d,
                            undefined,
                            Math.max(
                              0,
                              Math.min(
                                1425,
                                Math.round(
                                  (((e.clientY - rect.top) / 68) * 60) / 15,
                                ) * 15,
                              ),
                            ),
                          );
                        }}
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <button
                            className="wk-time-slot"
                            disabled={blocked}
                            aria-label={`${d} ${clock(h * 60)}添加日程`}
                            key={h}
                            style={{ top: h * 68 }}
                            onClick={() => {
                              setEditor({ date: d, startMinute: h * 60 });
                            }}
                          />
                        ))}
                        {items.map((r) => {
                          const start = r.item!.startMinute!,
                            duration = r.item!.durationMinutes || 25;
                          const { lane, count } = lanes.get(r.item!.id)!;
                          return (
                            <button
                              className={`wk-calendar-event ${r.task.category} ${r.step?.completed ? "done" : ""}`}
                              disabled={blocked}
                              key={key(r)}
                              {...dragProps(r)}
                              style={{
                                top: (start / 60) * 68,
                                height: Math.max(25, (duration / 60) * 68 - 3),
                                left: `calc(${(lane / count) * 100}% + 5px)`,
                                width: `calc(${100 / count}% - 10px)`,
                              }}
                              onClick={() => {
                                setSelectedId(key(r));
                                setEditor({ row: r, date: d });
                              }}
                              title={`${r.step?.text || r.task.title} ${clock(start)}–${clock(start + duration)}`}
                            >
                              <strong>
                                {r.step?.completed && "✓ "}
                                {r.step?.text || r.task.title}
                              </strong>
                              <span>
                                {clock(start)}–{clock(start + duration)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </section>
      {storageScope && (
        <CoachChat
          key={storageScope}
          collapsed={coachCollapsed}
          onToggleCollapsed={() => setCoachCollapsed((value) => !value)}
          selectedProject={
            !singleDay && (nav === "week" || nav === "inbox")
              ? state?.planning?.context?.projects?.find(
                  (p) => p.id === projectFilter,
                )
              : undefined
          }
          storageScope={storageScope}
          prefill={coachPrefill}
          selected={singleDay ? undefined : selected}
          date={day}
          onClearSelection={() => {
            setSelectedId("");
            setProjectFilter("");
          }}
          onSaved={() => void reload()}
        />
      )}
      {editor && state && storageScope && (
        <StepEditor
          key={editor.row ? key(editor.row) : `new-${editor.date}`}
          {...editor}
          storageScope={storageScope}
          state={state}
          onClose={() => {
            setEditor(undefined);
            refreshDrafts();
          }}
          onSaved={() => {
            void reload();
            refreshDrafts();
          }}
        />
      )}
      {cancelPreview && (
        <Dialog
          title={
            cancelPreview.scope === "selected" ? "取消本次安排" : "放回待安排"
          }
          onClose={() => {
            if (!busy) setCancelPreview(undefined);
          }}
        >
          <section className="wk-cancel-preview">
            <h3>{cancelPreview.row.step?.text}</h3>
            <p>只取消下面列出的安排，任务、步骤和执行记录会保留。</p>
            {cancelPreview.items.length ? (
              <ul aria-label="将取消的安排">
                {cancelPreview.items.map((item) => (
                  <li key={item.id} data-plan-item={item.id}>
                    {planItemLabel(item)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wk-stale">
                没有可取消的未执行安排。已有执行关系的安排会保留。
              </p>
            )}
            {!!cancelPreview.retained && (
              <p className="wk-stale">
                {cancelPreview.scope === "unexecuted"
                  ? "已有执行关系的"
                  : "其他"}
                {cancelPreview.retained}{" "}
                条有效安排会保留，取消后仍不会列为待安排。
              </p>
            )}
            {error && request.pending && (
              <p className="wk-error" role="alert">
                {error}
              </p>
            )}
            {request.pending && !request.definitiveFailure && (
              <p className="muted">结果尚未确认。重试会使用原操作和原参数。</p>
            )}
            <footer>
              <button
                disabled={busy}
                onClick={() => setCancelPreview(undefined)}
              >
                返回
              </button>
              {request.pending ? (
                <>
                  {request.definitiveFailure && (
                    <button
                      disabled={busy}
                      onClick={() => void reconsiderAction()}
                    >
                      重新读取再操作
                    </button>
                  )}
                  <button
                    className="wk-primary"
                    disabled={busy}
                    onClick={() => void retryAction()}
                  >
                    核实并重试
                  </button>
                </>
              ) : (
                <button
                  className="wk-primary"
                  disabled={busy || !cancelPreview.items.length}
                  onClick={cancelItems}
                >
                  确认取消 {cancelPreview.items.length} 条安排
                </button>
              )}
            </footer>
          </section>
        </Dialog>
      )}
      {settings && (
        <Dialog title="工作台设置" onClose={() => setSettings(false)}>
          <div className="wk-settings">
            <h3>与 Inky 共用计划</h3>
            <p>
              任务与步骤直接保存在当前 Inky Paper
              中。你可以从系统托盘的「打开工作台」回到这里。
            </p>
            <h3>Hermes Coach</h3>
            <p>
              使用本机 Hermes
              已配置的模型。发送消息时才连接，对话历史保存在本机。
            </p>
            <p>
              如需更换模型或账户，请在 Hermes 中设置，下次启动 Inky 后生效。
            </p>
            <button className="wk-primary" onClick={() => setSettings(false)}>
              知道了
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
