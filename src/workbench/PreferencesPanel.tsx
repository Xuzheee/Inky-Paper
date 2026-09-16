import { useState } from "react";
import type { State, Preference } from "../paper/paperTypes";
import { usePlanRequest } from "./usePlanRequest";
import { getError } from "./model";
import "./context.css";
type Draft = {
  id: string;
  revision: number;
  text: string;
  scope: Preference["scope"];
  date: string;
  projectId: string;
  enabled: boolean;
};
export default function PreferencesPanel({
  state,
  storageScope,
  onSaved,
}: {
  state: State;
  storageScope: string;
  onSaved: () => void;
}) {
  const storageKey = `inky-wb:${storageScope}:preference-draft`;
  const [draft, setDraft] = useState<Draft | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "null");
    } catch {
      return null;
    }
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = usePlanRequest(`${storageKey}:request`);
  const preferences = state.planning?.context?.preferences || [];
  const projects = state.planning?.context?.projects || [];
  const locked = busy || !!request.pending;
  const current = preferences.find((p) => p.id === draft?.id);
  const conflict =
    !!draft && draft.revision > 0 && current?.revision !== draft.revision;
  const store = (next: Draft | null) => {
    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify(next));
      else localStorage.removeItem(storageKey);
      setDraft(next);
      setError("");
    } catch {
      setError("偏好草稿未能保存，暂不发送修改。");
    }
  };
  const submit = async (action: string, input: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await request.submit(action, input);
      store(null);
      onSaved();
    } catch (e) {
      setError(getError(e));
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    setBusy(true);
    try {
      await request.retry();
      store(null);
      onSaved();
    } catch (e) {
      setError(getError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="wk-context" aria-label="偏好和背景">
      <h2>偏好和背景</h2>
      <p className="muted">
        这里的内容经你确认后，才用于相关 Coach 请求。当前消息中的要求优先。
      </p>
      <p className="muted">
        停用或删除会停止用于后续 Inky 请求；已有对话、事件记录及 Hermes
        独立历史不会一并删除。
      </p>
      {preferences.map((p) => (
        <article className="wk-context" key={p.id}>
          <p>{p.text}</p>
          <p className="muted">
            {p.scope === "global"
              ? "长期偏好"
              : p.scope === "day"
                ? `仅 ${p.date}`
                : `项目：${projects.find((x) => x.id === p.projectId)?.title || "未找到"}`}{" "}
            · {p.enabled ? "启用" : "已停用"}
          </p>
          <div className="wk-context-actions">
            <button
              disabled={locked}
              onClick={() =>
                store({
                  id: p.id,
                  revision: p.revision,
                  text: p.text,
                  scope: p.scope,
                  date: p.date || "",
                  projectId: p.projectId || "",
                  enabled: p.enabled,
                })
              }
            >
              修改偏好
            </button>
            <button
              disabled={locked}
              onClick={() =>
                void submit("delete_preference", {
                  preferenceId: p.id,
                  expectedRevision: p.revision,
                })
              }
            >
              删除偏好
            </button>
          </div>
        </article>
      ))}
      {!draft && (
        <button
          disabled={locked}
          onClick={() =>
            store({
              id: crypto.randomUUID(),
              revision: 0,
              text: "",
              scope: "global",
              date: "",
              projectId: "",
              enabled: true,
            })
          }
        >
          添加偏好
        </button>
      )}
      {draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (conflict) return;
            void submit("save_preference", {
              preferenceId: draft.id,
              expectedRevision: draft.revision,
              text: draft.text,
              scope: draft.scope,
              date: draft.scope === "day" ? draft.date : null,
              projectId: draft.scope === "project" ? draft.projectId : null,
              enabled: draft.enabled,
            });
          }}
        >
          <fieldset disabled={locked}>
            <label>
              偏好内容
              <textarea
                required
                maxLength={1000}
                value={draft.text}
                onChange={(e) => store({ ...draft, text: e.target.value })}
              />
            </label>
            <label>
              生效范围
              <select
                value={draft.scope}
                onChange={(e) =>
                  store({ ...draft, scope: e.target.value as Draft["scope"] })
                }
              >
                <option value="global">长期偏好</option>
                <option value="day">指定一天</option>
                <option value="project">指定项目</option>
              </select>
            </label>
            {draft.scope === "day" && (
              <label>
                生效日期
                <input
                  type="date"
                  required
                  value={draft.date}
                  onChange={(e) => store({ ...draft, date: e.target.value })}
                />
              </label>
            )}
            {draft.scope === "project" && (
              <label>
                生效项目
                <select
                  required
                  value={draft.projectId}
                  onChange={(e) =>
                    store({ ...draft, projectId: e.target.value })
                  }
                >
                  <option value="">选择项目</option>
                  {projects
                    .filter((p) => !p.archived)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => store({ ...draft, enabled: e.target.checked })}
              />
              用于相关请求
            </label>
          </fieldset>
          {conflict && (
            <p role="alert">
              这条偏好已有更新。当前内容：{current?.text || "已删除"}
              。草稿已保留。
              {current && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    store({ ...draft, revision: current.revision })
                  }
                >
                  已核对，保留草稿
                </button>
              )}
            </p>
          )}
          <div className="wk-context-actions">
            <button
              className="wk-primary"
              disabled={locked || conflict || !request.ready}
            >
              确认保存偏好
            </button>
            <button type="button" disabled={locked} onClick={() => store(null)}>
              放弃草稿
            </button>
          </div>
        </form>
      )}
      {request.pending && (
        <div className="wk-context-actions">
          <button disabled={busy} onClick={() => void retry()}>
            核实并重试偏好操作
          </button>
          {request.definitiveFailure && (
            <button
              disabled={busy}
              onClick={() => {
                request.discardDefinitiveFailure();
                onSaved();
              }}
            >
              刷新并核对
            </button>
          )}
        </div>
      )}
      {(error || request.storageError) && (
        <p className="wk-error" role="alert">
          {error || request.storageError}
        </p>
      )}
    </section>
  );
}
