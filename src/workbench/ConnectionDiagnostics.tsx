import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./coach-controls.css";

type Stage = "dependency" | "acp" | "paper" | "model";
type Check = { stage: Stage; code: string; summary: string; retry: string };
type Diagnostics = { checks: Check[]; sampledAt: number };
const labels: Record<Stage, string> = {
  dependency: "本机依赖",
  acp: "Hermes 连接",
  paper: "Paper 工具",
  model: "模型调用",
};
const statuses: Record<string, string> = {
  ready: "正常",
  missing: "未找到",
  unavailable: "不可用",
  failed: "失败",
  unknown: "未验证",
};

export default function ConnectionDiagnostics({
  busy,
  onRetryQuestion,
  onRefreshPlan,
}: {
  busy: boolean;
  onRetryQuestion: () => void;
  onRefreshPlan: () => void;
}) {
  const [data, setData] = useState<Diagnostics>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const check = async () => {
    const request = ++generation.current;
    setChecking(true);
    setError("");
    try {
      const result = await invoke<Diagnostics>("workbench_diagnostics");
      if (!Array.isArray(result.checks) || !Number.isFinite(result.sampledAt))
        throw Error("invalid diagnostics");
      if (request === generation.current) setData(result);
    } catch {
      if (request === generation.current)
        setError("暂时无法读取连接状态，请重新检查。");
    } finally {
      if (request === generation.current) setChecking(false);
    }
  };
  useEffect(() => {
    void check();
    return () => {
      generation.current++;
    };
  }, []);
  return (
    <section className="wk-diagnostics" aria-label="Coach 连接检查">
      <header>
        <strong>连接检查</strong>
        <button disabled={checking} onClick={() => void check()}>
          {checking ? "正在检查…" : "重新检查"}
        </button>
      </header>
      <p>只读取当前状态，不连接 Hermes，也不发送模型请求。</p>
      {error && <p role="alert">{error}</p>}
      <ul>
        {data?.checks
          .filter((item) =>
            Object.prototype.hasOwnProperty.call(labels, item.stage),
          )
          .map((item) => (
            <li key={item.stage} data-stage={item.stage}>
              <div>
                <strong>{labels[item.stage]}</strong>
                <span
                  className={`wk-diagnostic-code ${item.code === "ready" ? "ready" : ""}`}
                >
                  {statuses[item.code] || "未验证"}
                </span>
              </div>
              <p>{item.summary}</p>
              {item.code !== "ready" && (
                <>
                  <small>{item.retry}</small>
                  {item.stage !== "dependency" && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (item.stage === "paper") onRefreshPlan();
                        onRetryQuestion();
                      }}
                    >
                      {item.stage === "paper"
                        ? "刷新计划并准备重试"
                        : item.stage === "acp"
                          ? "准备重试连接"
                          : "准备重试问题"}
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
      </ul>
      {data && (
        <small>
          检查于{" "}
          {new Date(data.sampledAt).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
          。重试会先放入输入框，由你发送。
        </small>
      )}
    </section>
  );
}
