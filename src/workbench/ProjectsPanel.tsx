import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project, State } from "../paper/paperTypes";
import { getError } from "./model";
import { requestStorageKey, storagePrefix } from "./editorDraft";
import { usePlanRequest } from "./usePlanRequest";
import "./projects.css";

type Props = { state: State; storageScope: string; onSaved: () => void };
type Draft = {
  schemaVersion: 1;
  projectId: string;
  base?: Project;
  editing: boolean;
  title: string;
  goal: string;
  criteria: string;
  links: string;
  archived: boolean;
};
const initial = (project?: Project): Draft => ({
  schemaVersion: 1,
  projectId: project?.id || crypto.randomUUID(),
  base: project,
  editing: false,
  title: project?.title || "",
  goal: project?.goal || "",
  criteria: project?.criteria || "",
  links: project?.referenceLinks.join("\n") || "",
  archived: project?.archived || false,
});
const draftKey = (scope: string, owner: string) =>
  `${storagePrefix(scope)}project-draft:${encodeURIComponent(owner)}`;
function read(scope: string, owner: string, project?: Project) {
  try {
    const saved = scope ? localStorage.getItem(draftKey(scope, owner)) : null;
    if (!saved) return { draft: initial(project), error: "" };
    const draft: Draft = JSON.parse(saved);
    if (
      draft.schemaVersion !== 1 ||
      !draft.projectId ||
      (project && draft.projectId !== project.id) ||
      ![draft.title, draft.goal, draft.criteria, draft.links].every(
        (v) => typeof v === "string",
      ) ||
      typeof draft.archived !== "boolean" ||
      typeof draft.editing !== "boolean"
    )
      throw Error("invalid draft");
    return { draft, error: "" };
  } catch {
    return {
      draft: initial(project),
      error: "项目草稿无法读取。原草稿已保留，请检查本地存储后重新打开。",
    };
  }
}
function linksFrom(text: string) {
  const links = text
    .split(/\r?\n/)
    .map((link) => link.trim())
    .filter(Boolean);
  if (links.length > 10) throw Error("参考链接最多 10 条，每行一条。");
  for (const link of links) {
    try {
      const url = new URL(link);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname)
        throw Error();
    } catch {
      throw Error("参考链接只支持完整的 http 或 https 地址。");
    }
  }
  return links;
}

function ProjectCard({
  project,
  state,
  storageScope,
  onSaved,
  showArchived,
}: Props & { project?: Project; showArchived: boolean }) {
  const owner = project?.id || "new";
  const [local, setLocal] = useState(() => read(storageScope, owner, project));
  const [confirmed, setConfirmed] = useState<Project>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const draft = local.draft;
  const fresh = state.planning?.context?.projects?.find(
    (p) => p.id === draft.projectId,
  );
  const current =
    confirmed && confirmed.revision >= (fresh?.revision || 0)
      ? confirmed
      : fresh;
  const request = usePlanRequest(
    storageScope
      ? requestStorageKey(storageScope, `project:${owner}`)
      : undefined,
  );
  const unknown = !!request.pending && !request.definitiveFailure;
  const conflict =
    (current?.revision || 0) !== (draft.base?.revision || 0) ||
    request.definitiveFailure;
  const blocked = busy || !request.ready || !!local.error || unknown;
  const update = (next: Draft) => {
    if (!storageScope || local.error) return false;
    try {
      localStorage.setItem(draftKey(storageScope, owner), JSON.stringify(next));
      setLocal({ draft: next, error: "" });
      setError("");
      setStatus("");
      return true;
    } catch {
      setLocal((previous) => ({
        ...previous,
        error: "项目草稿未能保存，暂未发送操作。请检查本地存储后重新打开。",
      }));
      return false;
    }
  };
  const finish = (result: Record<string, unknown>) => {
    const saved = result.project as Project | undefined;
    if (!saved || saved.id !== draft.projectId)
      throw Error("未收到项目保存结果，请刷新记录核对。");
    setConfirmed(project ? saved : undefined);
    setLocal({ draft: initial(project ? saved : undefined), error: "" });
    setStatus(
      saved.archived ? "项目已归档，已有任务和记录保留。" : "项目已保存。",
    );
    try {
      localStorage.removeItem(draftKey(storageScope, owner));
    } catch {
      setError("项目已保存，但本地草稿未能清理，请刷新核对。");
    }
    onSaved();
  };
  const save = async () => {
    if (blocked || conflict) return;
    setError("");
    let referenceLinks: string[];
    try {
      referenceLinks = linksFrom(draft.links);
      if (!draft.title.trim()) throw Error("请填写项目名称。");
    } catch (e) {
      setError(getError(e));
      return;
    }
    if (!update(draft)) return;
    setBusy(true);
    try {
      finish(
        await request.submit("save_project", {
          projectId: draft.projectId,
          expectedRevision: draft.base?.revision || 0,
          title: draft.title.trim(),
          goal: draft.goal.trim(),
          criteria: draft.criteria.trim(),
          referenceLinks,
          archived: draft.archived,
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
      update({ ...draft, base: current });
    } catch (e) {
      setError(getError(e));
    }
  };
  const open = async (url: string) => {
    try {
      linksFrom(url);
      await invoke("workbench_open_reference", { url });
    } catch (e) {
      setError(`无法打开链接：${getError(e)}`);
    }
  };
  if (
    project &&
    current?.archived &&
    !showArchived &&
    !draft.editing &&
    !request.pending &&
    !status &&
    !local.error
  )
    return null;
  return (
    <article className="wk-project" data-project-id={project?.id || "new"}>
      {project && current && (
        <>
          <header>
            <h3>{current.title}</h3>
            {current.archived && <span>已归档</span>}
            <small>
              {
                state.tasks.filter((task) => task.projectId === current.id)
                  .length
              }{" "}
              条任务
            </small>
          </header>
          {current.goal && (
            <p>
              <strong>目标</strong>
              {current.goal}
            </p>
          )}
          {current.criteria && (
            <p>
              <strong>完成标准</strong>
              {current.criteria}
            </p>
          )}
          {!!current.referenceLinks.length && (
            <div className="wk-project-links">
              <p>参考链接 · 仅保存，未读取</p>
              {current.referenceLinks.map((url, index) => (
                <button
                  type="button"
                  key={`${index}:${url}`}
                  onClick={() => void open(url)}
                  aria-label={`打开参考链接 ${index + 1}：${url}`}
                >
                  {url} ↗
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {!draft.editing && !request.pending && (
        <button
          type="button"
          disabled={blocked}
          onClick={() => update({ ...draft, editing: true })}
        >
          {project ? "编辑项目" : "新建项目"}
        </button>
      )}
      {(draft.editing || request.pending) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={blocked}>
            <label>
              项目名称
              <input
                maxLength={100}
                value={draft.title}
                onChange={(e) => update({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              项目目标（可不填）
              <textarea
                maxLength={2000}
                rows={2}
                value={draft.goal}
                onChange={(e) => update({ ...draft, goal: e.target.value })}
              />
            </label>
            <label>
              完成标准（可不填）
              <textarea
                maxLength={2000}
                rows={2}
                value={draft.criteria}
                onChange={(e) => update({ ...draft, criteria: e.target.value })}
              />
            </label>
            <label>
              参考链接（每行一条，最多 10 条）
              <textarea
                rows={2}
                value={draft.links}
                onChange={(e) => update({ ...draft, links: e.target.value })}
              />
            </label>
            <p className="wk-project-hint">
              链接仅保存，未读取；点击已保存的链接才打开。
            </p>
            {project && (
              <label className="wk-project-archive">
                <input
                  type="checkbox"
                  checked={draft.archived}
                  onChange={(e) =>
                    update({ ...draft, archived: e.target.checked })
                  }
                />
                归档项目
              </label>
            )}
            {draft.archived && (
              <p className="wk-project-hint">
                归档保留已有任务和记录，暂停新增关联。
              </p>
            )}
          </fieldset>
          {conflict && !unknown && (
            <div className="wk-project-conflict" role="alert">
              <p>项目已有更新或上次保存未成功。草稿保留，核对后再保存。</p>
              {current && (
                <p>
                  当前版本 {current.revision}：{current.title}
                  {current.archived ? "（已归档）" : ""}
                  <br />
                  目标：{current.goal || "未填写"}
                  <br />
                  完成标准：{current.criteria || "未填写"}
                </p>
              )}
              <button type="button" onClick={onSaved} disabled={busy}>
                刷新最新记录
              </button>
              <button type="button" onClick={review} disabled={blocked}>
                已核对，保留草稿并使用当前版本
              </button>
            </div>
          )}
          {!unknown && (
            <>
              <button
                type="submit"
                className="wk-primary"
                disabled={blocked || conflict}
              >
                保存项目
              </button>
              <button
                type="button"
                disabled={blocked}
                onClick={() => update({ ...draft, editing: false })}
              >
                收起编辑
              </button>
            </>
          )}
        </form>
      )}
      {unknown && (
        <div className="wk-project-conflict" role="status">
          <p>上次保存结果尚未确认，将核实原提交。</p>
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
    </article>
  );
}
export default function ProjectsPanel(props: Props) {
  const [showArchived, setShowArchived] = useState(false);
  const projects = props.state.planning?.context?.projects || [];
  return (
    <section className="wk-projects" aria-label="项目管理">
      <header>
        <h2>项目</h2>
        <p>用目标和完成标准，把相关任务放在一起。</p>
      </header>
      {!props.storageScope && (
        <p role="status">正在确认当前数据目录，准备好后即可编辑项目。</p>
      )}
      <ProjectCard
        key={`${props.storageScope}:new`}
        {...props}
        showArchived={showArchived}
      />
      <label className="wk-project-archive">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        显示归档项目
      </label>
      {projects.map((project) => (
        <ProjectCard
          key={`${props.storageScope}:${project.id}`}
          {...props}
          project={project}
          showArchived={showArchived}
        />
      ))}
    </section>
  );
}
