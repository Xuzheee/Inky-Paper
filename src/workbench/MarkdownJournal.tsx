import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, RefreshCw } from "lucide-react";
import { getError } from "./model";

type DocumentFile = {
  kind: string;
  path: string;
  exists: boolean;
  content: string;
  modifiedAt: number | null;
  error: string | null;
};
type Documents = { date: string; documents: DocumentFile[] };
const labels: Record<string, string> = {
  day: "当天记录",
  personal: "个人复盘",
  tasks: "全部任务",
};
export default function MarkdownJournal({
  date,
  refreshKey,
  kind,
  setKind,
}: {
  date: string;
  refreshKey: number;
  kind: string;
  setKind: (kind: string) => void;
}) {
  const [result, setResult] = useState<Documents>();
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let disposed = false,
      pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await invoke<Documents>("workbench_read_documents", {
          date,
        });
        if (!disposed) {
          setResult(value);
          setError("");
        }
      } catch (e) {
        if (!disposed) setError(getError(e));
      } finally {
        pending = false;
      }
    };
    void read();
    const visibleRead = () => {
      if (document.visibilityState !== "hidden") void read();
    };
    const timer = window.setInterval(visibleRead, 5000);
    window.addEventListener("focus", visibleRead);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", visibleRead);
    };
  }, [date, refreshKey, reload]);
  const file =
    result?.date === date
      ? result.documents.find((document) => document.kind === kind)
      : undefined;
  return (
    <article className="wk-markdown" aria-label={`${date} Markdown 原文`}>
      <div className="wk-document-tools">
        <label>
          文件
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(labels).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label="重新读取 Markdown"
          onClick={() => setReload((v) => v + 1)}
        >
          <RefreshCw size={17} />
        </button>
        <button
          disabled={!file?.exists}
          onClick={() =>
            void invoke("workbench_open_document", { date, kind }).catch((e) =>
              setError(getError(e)),
            )
          }
        >
          <ExternalLink size={16} />
          打开原文件
        </button>
      </div>
      <div className="wk-document-info">
        <h3>
          {kind === "tasks" ? "任务.md · 全部任务" : `${date} · ${labels[kind]}`}
        </h3>
        <p>
          {kind === "tasks"
            ? "全部任务的当前状态，不按日期筛选。"
            : "显示磁盘中已保存的 Markdown 原文。"}
          {kind === "personal"
            ? " 可在原文件中编辑，返回后自动重新读取。"
            : " 任务和完成状态随 Inky 同步。"}
        </p>
        {file && <p className="wk-document-path">{file.path}</p>}
        {file?.modifiedAt && (
          <p>文件更新于 {new Date(file.modifiedAt).toLocaleString("zh-CN")}</p>
        )}
      </div>
      {(error || file?.error) && (
        <p className="wk-banner wk-error" role="alert">
          {error || file?.error}
        </p>
      )}
      {!file ? (
        <p className="wk-record-empty" role="status">
          正在读取原文件…
        </p>
      ) : !file.exists && !file.error ? (
        <p className="wk-record-empty">
          这一天还没有对应的 Markdown 文件。记录产生后会自动同步到这里。
        </p>
      ) : (
        !file.error && (
          <pre
            className="wk-markdown-source"
            tabIndex={0}
            aria-label="Markdown 原始内容"
          >
            <code>{file.content || "（空文件）"}</code>
          </pre>
        )
      )}
    </article>
  );
}
