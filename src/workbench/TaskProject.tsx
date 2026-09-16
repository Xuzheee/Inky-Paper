import { useState } from "react";
import type { Project, State, Task } from "../paper/paperTypes";
import { getError } from "./model";
import { requestStorageKey, storagePrefix } from "./editorDraft";
import { usePlanRequest } from "./usePlanRequest";
import "./task-project.css";

type Props = {
  task: Task;
  state: State;
  storageScope: string;
  onSaved: () => void;
};
type Draft = {
  schemaVersion: 1;
  taskId: string;
  taskRevision: number;
  projectId: string | null;
  projectRevision: number | null;
  projectTitle: string;
  editing: boolean;
};
const initial = (task: Task, projects: Project[]): Draft => {
  const project = projects.find((p) => p.id === task.projectId);
  return {
    schemaVersion: 1,
    taskId: task.id,
    taskRevision: task.revision,
    projectId: task.projectId || null,
    projectRevision: project?.revision ?? null,
    projectTitle: project?.title || "",
    editing: false,
  };
};
function ProjectSelection({ task, state, storageScope, onSaved }: Props) {
  const projects = state.planning?.context?.projects || [];
  const key = `${storagePrefix(storageScope)}task-project-draft:${encodeURIComponent(task.id)}`;
  const [local, setLocal] = useState(() => {
    try {
      const raw = storageScope ? localStorage.getItem(key) : null;
      const draft: Draft = raw ? JSON.parse(raw) : initial(task, projects);
      if (
        draft.schemaVersion !== 1 ||
        draft.taskId !== task.id ||
        typeof draft.taskRevision !== "number" ||
        !(draft.projectId === null || typeof draft.projectId === "string") ||
        typeof draft.editing !== "boolean"
      )
        throw Error();
      return { draft, error: "" };
    } catch {
      return {
        draft: initial(task, projects),
        error: "任务项目草稿无法读取。原草稿已保留，请检查本地存储后重新打开。",
      };
    }
  });
  const [confirmed, setConfirmed] = useState<Task>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const current =
    confirmed && confirmed.revision >= task.revision ? confirmed : task;
  const draft = local.draft;
  const attached = projects.find((project) => project.id === current.projectId);
  const selected = projects.find((project) => project.id === draft.projectId);
  const request = usePlanRequest(
    storageScope
      ? requestStorageKey(storageScope, `task-project:${task.id}`)
      : undefined,
  );
  const unknown = !!request.pending && !request.definitiveFailure;
  const conflict =
    current.revision !== draft.taskRevision ||
    (!!draft.projectId && selected?.revision !== draft.projectRevision) ||
    request.definitiveFailure;
  const blocked = busy || !request.ready || !!local.error || unknown;
  const update = (next: Draft) => {
    if (!storageScope || local.error) return false;
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setLocal({ draft: next, error: "" });
      setError("");
      setStatus("");
      return true;
    } catch {
      setLocal((previous) => ({
        ...previous,
        error: "关联草稿未能保存，暂未发送操作。请检查本地存储后重新打开。",
      }));
      return false;
    }
  };
  const finish = (result: Record<string, unknown>) => {
    const next = result.task as Task | undefined;
    if (!next || next.id !== task.id)
      throw Error("未收到任务关联结果，请刷新核对。");
    setConfirmed(next);
    setLocal({ draft: initial(next, projects), error: "" });
    setStatus(next.projectId ? "项目关联已保存。" : "已移除项目关联。");
    try {
      localStorage.removeItem(key);
    } catch {
      setError("关联已保存，但本地草稿未能清理，请刷新核对。");
    }
    onSaved();
  };
  const save = async () => {
    if (
      blocked ||
      conflict ||
      (draft.projectId && (!selected || selected.archived))
    )
      return;
    if (!update(draft)) return;
    setBusy(true);
    try {
      finish(
        await request.submit("set_task_project", {
          taskId: task.id,
          expectedTaskRevision: draft.taskRevision,
          projectId: draft.projectId,
          expectedProjectRevision: draft.projectId
            ? draft.projectRevision
            : null,
        }),
      );
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
        taskRevision: current.revision,
        projectRevision: selected?.revision ?? null,
        projectTitle: selected?.title || draft.projectTitle,
      });
    } catch (e) {
      setError(getError(e));
    }
  };
  return (
    <section className="wk-task-project" aria-label="任务所属项目">
      <div>
        <span>
          项目：
          {attached?.title || (current.projectId ? "原项目暂不可用" : "未关联")}
          {attached?.archived ? "（已归档）" : ""}
        </span>
        {!draft.editing && !request.pending && (
          <button
            type="button"
            disabled={blocked}
            onClick={() => update({ ...draft, editing: true })}
          >
            修改项目
          </button>
        )}
      </div>
      {(draft.editing || request.pending) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            关联项目
            <select
              disabled={blocked}
              value={draft.projectId || ""}
              onChange={(e) => {
                const project = projects.find((p) => p.id === e.target.value);
                update({
                  ...draft,
                  projectId: e.target.value || null,
                  projectRevision: project?.revision ?? null,
                  projectTitle: project?.title || "",
                });
              }}
            >
              <option value="">不关联项目</option>
              {projects
                .filter(
                  (project) =>
                    !project.archived ||
                    project.id === draft.projectId ||
                    project.id === current.projectId,
                )
                .map((project) => (
                  <option
                    key={project.id}
                    value={project.id}
                    disabled={project.archived}
                  >
                    {project.title}
                    {project.archived ? "（已归档）" : ""}
                  </option>
                ))}
            </select>
          </label>
          <p>项目关联独立于任务分类。归档项目的原有关联保留。</p>
          {selected?.archived && (
            <p>这个项目已归档，可保留原关联，或选择其他项目。</p>
          )}
          {conflict && !unknown && (
            <div role="alert">
              <p>任务或项目已有更新，草稿保留，请核对后再保存。</p>
              <p>
                当前任务版本 {current.revision}；当前项目：
                {attached?.title || "未关联"}
              </p>
              {draft.projectId && (
                <p>
                  草稿选择：{draft.projectTitle}（版本 {draft.projectRevision}
                  ）；最新：
                  {selected
                    ? `${selected.title}（版本 ${selected.revision}${selected.archived ? "，已归档" : ""}）`
                    : "项目不存在"}
                </p>
              )}
              <button type="button" disabled={busy} onClick={onSaved}>
                刷新最新记录
              </button>
              <button type="button" disabled={blocked} onClick={review}>
                已核对，保留选择并使用当前版本
              </button>
            </div>
          )}
          {!unknown && (
            <>
              <button
                type="submit"
                disabled={
                  blocked ||
                  conflict ||
                  (!!draft.projectId && (!selected || selected.archived))
                }
              >
                保存项目关联
              </button>
              <button
                type="button"
                disabled={blocked}
                onClick={() => update({ ...draft, editing: false })}
              >
                收起
              </button>
            </>
          )}
        </form>
      )}
      {unknown && (
        <div role="status">
          <p>上次关联结果尚未确认，将核实原提交。</p>
          <button
            type="button"
            disabled={busy || !request.ready}
            onClick={() => void retry()}
          >
            核实并重试原提交
          </button>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      {(local.error || request.storageError || error) && (
        <p role="alert" className="wk-error">
          {local.error || request.storageError || error}
        </p>
      )}
    </section>
  );
}
export default function TaskProject(props: Props) {
  return (
    <ProjectSelection
      key={`${props.storageScope}:${props.task.id}`}
      {...props}
    />
  );
}
