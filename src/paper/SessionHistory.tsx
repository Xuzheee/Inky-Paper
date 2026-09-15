import { useEffect, useState } from "react";
import type { Session } from "./paperTypes";
import { elapsedSeconds } from "./sessionTime";

export function SessionHistoryList({ sessions }: { sessions: Session[] }) {
  const [limit, setLimit] = useState(20);
  return (
    <>
      {sessions.slice(0, limit).map((session) => (
        <SessionHistory key={session.id} session={session} />
      ))}
      {sessions.length > limit && (
        <button
          className="outline"
          onClick={() => setLimit((value) => value + 20)}
        >
          加载更多轮次
        </button>
      )}
    </>
  );
}

export function SessionHistory({ session }: { session: Session }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (session.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session.status]);
  const seconds = elapsedSeconds(session, now);
  return (
    <article>
      <span className="eyebrow">
        {new Date(session.startedAt).toLocaleString("zh-CN", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}{" "}
        · {session.kind === "rest" ? "休息" : "专注"}
      </span>
      <h2>{session.action?.text || session.taskTitle || "休息"}</h2>
      <p>
        {Math.floor(seconds / 60)} 分 {seconds % 60} 秒 · {session.pauseCount}{" "}
        次暂停 ·{" "}
        {session.feedback?.outcome === "step_completed"
          ? "这一步完成"
          : session.status === "finished"
            ? "本轮已结束"
            : "本轮未结束"}
      </p>
      {session.feedback?.output && <p>留下：{session.feedback.output}</p>}
      {session.feedback?.blocker && <p>卡点：{session.feedback.blocker}</p>}
      {(session.feedback?.nextCue || session.resumeCue) && (
        <p>下次：{session.feedback?.nextCue || session.resumeCue}</p>
      )}
    </article>
  );
}
