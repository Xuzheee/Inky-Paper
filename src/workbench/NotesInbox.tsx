import { useState } from "react";
import type { State, Task } from "../paper/paperTypes";
import { getError } from "./model";
import { requestStorageKey, storagePrefix } from "./editorDraft";
import { usePlanRequest } from "./usePlanRequest";
import "./notes.css";

type Note = State["notes"][number];
type Mode = "keep" | "link" | "convert";
type NoteDraft = {
  schemaVersion: 1;
  base: Note;
  mode: Mode | null;
  title: string;
  nextAction: string;
  newTaskId: string;
  targetTaskId: string;
  targetRevision: number | null;
  targetTitle: string;
};
type Props = {
  state: State;
  storageScope: string;
  onSaved: () => void;
  onSelectTask?: (taskId: string) => void;
};
const revision = (note: Note) => note.revision ?? 1;
const draftKey = (scope: string, id: string) =>
  `${storagePrefix(scope)}note-draft:${encodeURIComponent(id)}`;
const initialDraft = (note: Note): NoteDraft => ({
  schemaVersion: 1,
  base: note,
  mode: null,
  title: Array.from(note.text.trim()).slice(0, 300).join(""),
  nextAction: "",
  newTaskId: crypto.randomUUID(),
  targetTaskId: "",
  targetRevision: null,
  targetTitle: "",
});
function readDraft(scope: string, note: Note) {
  const initial = initialDraft(note);
  if (!scope) return { draft: initial, error: "" };
  try {
    const stored = localStorage.getItem(draftKey(scope, note.id));
    if (!stored) return { draft: initial, error: "" };
    const draft: NoteDraft = JSON.parse(stored);
    if (
      draft.schemaVersion !== 1 ||
      draft.base?.id !== note.id ||
      typeof draft.base.text !== "string" ||
      !draft.newTaskId ||
      typeof draft.title !== "string" ||
      typeof draft.nextAction !== "string" ||
      ![null, "keep", "link", "convert"].includes(draft.mode) ||
      typeof draft.targetTaskId !== "string"
    )
      throw Error("invalid draft");
    return { draft, error: "" };
  } catch {
    return {
      draft: initial,
      error: "笔记草稿无法读取。原草稿已保留，请检查本地存储后重新打开。",
    };
  }
}

function NoteCard({
  note,
  state,
  storageScope,
  onSaved,
  onSelectTask,
  pendingOnly,
}: Props & { note: Note; pendingOnly: boolean }) {
  const [local, setLocal] = useState(() => readDraft(storageScope, note));
  const [saved, setSaved] = useState<{ note: Note; task?: Task }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const request = usePlanRequest(
    storageScope
      ? requestStorageKey(storageScope, `note:${note.id}`)
      : undefined,
  );
  const draft = local.draft;
  // A confirmed response must remain authoritative while the parent refreshes.
  const current =
    saved && revision(saved.note) >= revision(note) ? saved.note : note;
  const convertedId = current.convertedTaskId;
  const linkedId = convertedId || current.linkedTaskId;
  const linked =
    state.tasks.find((task) => task.id === linkedId) ||
    (linkedId && saved?.task?.id === linkedId ? saved.task : undefined);
  const target = state.tasks.find((task) => task.id === draft.targetTaskId);
  const changedNote = revision(current) !== revision(draft.base);
  const changedTarget =
    draft.mode === "link" &&
    !!draft.targetTaskId &&
    target?.revision !== draft.targetRevision;
  const conflict = changedNote || changedTarget || request.definitiveFailure;
  const unknown = !!request.pending && !request.definitiveFailure;
  const organized = !!current.organization || !!convertedId;
  const blocked = busy || !request.ready || !!local.error || unknown;

  const update = (next: NoteDraft) => {
    if (!storageScope || local.error) return false;
    try {
      localStorage.setItem(
        draftKey(storageScope, note.id),
        JSON.stringify(next),
      );
      setLocal({ draft: next, error: "" });
      setError("");
      setStatus("");
      return true;
    } catch {
      setLocal((previous) => ({
        ...previous,
        error: "草稿未能保存，暂未发送整理操作。请检查本地存储后重新打开。",
      }));
      return false;
    }
  };
  const finish = (result: Record<string, unknown>) => {
    const next = result.note as Note | undefined;
    if (!next || next.id !== note.id)
      throw Error("未收到笔记保存结果，请刷新最新记录核对。");
    setSaved({ note: next, task: result.task as Task | undefined });
    setLocal({ draft: { ...draft, base: next, mode: null }, error: "" });
    setStatus(
      next.convertedTaskId
        ? "已转为任务，原笔记与来源已保留。"
        : next.organization === "linked"
          ? "已关联任务，原笔记与来源已保留。"
          : "已保留为笔记。",
    );
    try {
      localStorage.removeItem(draftKey(storageScope, note.id));
    } catch {
      setError("整理已保存，但本地草稿未能清理。请刷新记录核对。");
    }
    onSaved();
  };
  const save = async (next = draft) => {
    if (blocked || conflict || convertedId || !next.mode) return;
    if (
      next.mode === "link" &&
      (!target || target.revision !== next.targetRevision)
    ) {
      setError("请先选择并核对要关联的任务。");
      return;
    }
    if (next.mode === "convert" && !next.title.trim()) {
      setError("请填写新任务标题。原笔记会完整保留。");
      return;
    }
    if (!update(next)) return;
    setBusy(true);
    try {
      const input: Record<string, unknown> = {
        noteId: note.id,
        expectedRevision: revision(next.base),
        mode: next.mode,
      };
      if (next.mode === "link")
        Object.assign(input, {
          targetTaskId: next.targetTaskId,
          expectedTaskRevision: next.targetRevision,
        });
      if (next.mode === "convert")
        Object.assign(input, {
          taskId: next.newTaskId,
          title: next.title.trim(),
          nextAction: next.nextAction.trim() || null,
        });
      finish(await request.submit("organize_note", input));
    } catch (e) {
      setError(getError(e));
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    setBusy(true);
    setError("");
    try {
      finish(await request.retry());
    } catch (e) {
      setError(getError(e));
    } finally {
      setBusy(false);
    }
  };
  const review = () => {
    try {
      if (request.pending && !request.discardDefinitiveFailure()) return;
      update({
        ...draft,
        base: current,
        targetRevision: target?.revision ?? null,
        targetTitle: target?.title || draft.targetTitle,
      });
    } catch (e) {
      setError(getError(e));
    }
  };

  // Keep pending requests and open drafts recoverable even if another window has organized the note.
  if (
    pendingOnly &&
    organized &&
    !request.pending &&
    !draft.mode &&
    !status &&
    !local.error
  )
    return null;
  const session = state.sessions.find(
    (session) => session.id === current.sessionId,
  );
  const sourceTitle =
    current.taskTitle ||
    session?.taskTitle ||
    state.tasks.find((task) => task.id === current.taskId)?.title;
  const sourceStep = current.action?.text || session?.action?.text;
  return (
    <article className="wk-note" data-note-id={note.id}>
      <header>
        <time dateTime={new Date(current.createdAt).toISOString()}>
          {new Date(current.createdAt).toLocaleString("zh-CN", {
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        <span>
          {convertedId
            ? "已转任务"
            : current.organization === "linked"
              ? "已关联"
              : current.organization === "kept"
                ? "已保留"
                : "待整理"}
        </span>
      </header>
      <p className="wk-note-text">{current.text}</p>
      <div className="wk-note-source" aria-label="笔记来源">
        <span>{current.sessionId ? "来自专注随手记" : "来自随手记"}</span>
        {sourceTitle && <span>原任务：{sourceTitle}</span>}
        {sourceStep && <span>原步骤：{sourceStep}</span>}
        {current.sessionId && (
          <span title={current.sessionId}>
            会话：
            {session
              ? new Date(session.startedAt).toLocaleString("zh-CN")
              : "原会话记录"}
          </span>
        )}
        {current.source && (
          <span>
            记录来源：{current.source === "user" ? "手动记录" : current.source}
          </span>
        )}
      </div>
      {linkedId && (
        <div className="wk-note-target">
          <span>
            {convertedId ? "转换后的任务" : "关联任务"}：
            {linked?.title || "目标任务暂不可用"}
          </span>
          {linked && onSelectTask && (
            <button type="button" onClick={() => onSelectTask(linkedId)}>
              打开任务
            </button>
          )}
        </div>
      )}
      {conflict && !unknown && (
        <div className="wk-note-conflict" role="alert">
          <p>
            {changedNote || changedTarget
              ? "笔记或目标任务已有变化，整理草稿保留。核对后再保存。"
              : "本次整理尚未保存，草稿保留。请核对最新记录和输入内容。"}
          </p>
          {changedNote && (
            <p>
              编辑时的笔记（版本 {revision(draft.base)}）：{draft.base.text}
            </p>
          )}
          {changedNote && <p>当前笔记版本：{revision(current)}</p>}
          {changedTarget && (
            <p>
              编辑时关联：{draft.targetTitle}（版本 {draft.targetRevision}）
              <br />
              当前：
              {target
                ? `${target.title}（版本 ${target.revision}）`
                : "任务已不存在"}
            </p>
          )}
          <button type="button" disabled={busy} onClick={onSaved}>
            刷新最新记录
          </button>
          <button type="button" disabled={blocked} onClick={review}>
            已核对，保留草稿并使用当前版本
          </button>
        </div>
      )}
      {!convertedId && (
        <>
          <div className="wk-note-actions">
            <button
              type="button"
              disabled={blocked || conflict}
              onClick={() => void save({ ...draft, mode: "keep" })}
            >
              保留为笔记
            </button>
            <button
              type="button"
              disabled={blocked}
              aria-pressed={draft.mode === "link"}
              onClick={() => update({ ...draft, mode: "link" })}
            >
              关联已有任务
            </button>
            <button
              type="button"
              disabled={blocked}
              aria-pressed={draft.mode === "convert"}
              onClick={() => update({ ...draft, mode: "convert" })}
            >
              转为新任务
            </button>
          </div>
          {(draft.mode === "link" || draft.mode === "convert") && (
            <form
              className="wk-note-editor"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <fieldset disabled={blocked}>
                {draft.mode === "link" ? (
                  <label>
                    关联到任务
                    <select
                      value={draft.targetTaskId}
                      onChange={(e) => {
                        const selected = state.tasks.find(
                          (task) => task.id === e.target.value,
                        );
                        update({
                          ...draft,
                          targetTaskId: e.target.value,
                          targetRevision: selected?.revision ?? null,
                          targetTitle: selected?.title || "",
                        });
                      }}
                    >
                      <option value="">选择已有任务</option>
                      {state.tasks.map((task) => (
                        <option value={task.id} key={task.id}>
                          {task.title}
                          {task.completed ? "（已完成）" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label>
                      新任务标题
                      <input
                        maxLength={300}
                        value={draft.title}
                        onChange={(e) =>
                          update({ ...draft, title: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      下一步（可不填）
                      <input
                        maxLength={300}
                        value={draft.nextAction}
                        onChange={(e) =>
                          update({ ...draft, nextAction: e.target.value })
                        }
                      />
                    </label>
                    <p>只创建任务，原笔记完整保留。安排和计时由你决定。</p>
                  </>
                )}
              </fieldset>
              <button
                type="submit"
                className="wk-primary"
                disabled={
                  blocked || conflict || (draft.mode === "link" && !target)
                }
              >
                {draft.mode === "link" ? "保存关联" : "创建任务并保留笔记"}
              </button>
              <button
                type="button"
                disabled={blocked}
                onClick={() => update({ ...draft, mode: null })}
              >
                收起
              </button>
            </form>
          )}
        </>
      )}
      {unknown && (
        <div className="wk-note-pending" role="status">
          <p>
            上次整理结果尚未确认。将使用原提交核实，不会按当前草稿另建任务。
          </p>
          <button
            type="button"
            disabled={busy || !request.ready}
            onClick={() => void retry()}
          >
            核实并重试原提交
          </button>
        </div>
      )}
      {status && (
        <p className="wk-note-status" role="status">
          {status}
        </p>
      )}
      {(error || local.error || request.storageError) && (
        <p className="wk-error" role="alert">
          {local.error || request.storageError || error}
        </p>
      )}
    </article>
  );
}

export default function NotesInbox(props: Props) {
  const [pendingOnly, setPendingOnly] = useState(true);
  const notes = [...props.state.notes].sort(
    (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
  );
  const pending = notes.filter(
    (note) => !note.organization && !note.convertedTaskId,
  ).length;
  return (
    <section className="wk-notes" aria-label="随手记整理">
      <header className="wk-notes-heading">
        <div>
          <h2>随手记</h2>
          <p>先记下来，再决定放在哪里。</p>
        </div>
        <nav aria-label="笔记范围">
          <button
            type="button"
            aria-pressed={pendingOnly}
            onClick={() => setPendingOnly(true)}
          >
            待整理
          </button>
          <button
            type="button"
            aria-pressed={!pendingOnly}
            onClick={() => setPendingOnly(false)}
          >
            全部
          </button>
        </nav>
      </header>
      {!props.storageScope && (
        <p role="status">正在确认当前数据目录，准备好后即可整理笔记。</p>
      )}
      {(!notes.length || (pendingOnly && !pending)) && (
        <p className="wk-notes-empty">
          {notes.length
            ? "没有新的待整理笔记。已整理的记录可在“全部”中查看。"
            : "还没有随手记。专注时想到的事情，可以先记在这里。"}
        </p>
      )}
      {notes.map((note) => (
        <NoteCard
          key={`${props.storageScope}:${note.id}`}
          {...props}
          note={note}
          pendingOnly={pendingOnly}
        />
      ))}
    </section>
  );
}
