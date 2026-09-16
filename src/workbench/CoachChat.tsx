import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Clock, Leaf, Plus, Send, Square, X } from "lucide-react";
import {
  Conversation,
  dateKey,
  dateLabel,
  validDate,
  planDirective,
  adjustmentDirective,
  DiscussionContext,
  getError,
  Message,
  Row,
} from "./model";
import PlanCards from "./PlanCards";
import AdjustmentCards from "./AdjustmentCards";

const directive = planDirective;
const scopeLabel = (context: DiscussionContext) =>
  `${context.date} · ${context.stepText || context.taskTitle || "当天计划与记录"}`;
const applyReply = (messages: Message[], requestId: string, reply: Message) =>
  messages.map((message) => {
    if (message.id === reply.id)
      return { ...reply, context: reply.context || message.context };
    if (message.id === requestId && reply.context)
      return { ...message, context: reply.context };
    return message;
  });
function RichText({ text }: { text: string }) {
  return (
    <div className="wk-message-text">
      {text.split("\n").map((line, i) => (
        <div key={i}>
          {line
            .replace(/^#{1,4}\s+/, "")
            .split(/(\*\*[^*]+\*\*)/g)
            .map((s, k) =>
              s.startsWith("**") ? (
                <strong key={k}>{s.slice(2, -2)}</strong>
              ) : (
                s
              ),
            ) || "\u00a0"}
        </div>
      ))}
    </div>
  );
}
export default function CoachChat({
  selected,
  date,
  onSaved,
  onClearSelection,
  prefill,
}: {
  selected?: Row;
  date: string;
  onSaved: () => void;
  onClearSelection: () => void;
  prefill?: {text:string;serial:number};
}) {
  const [session, setSession] = useState<string>();
  const [sessions, setSessions] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState(
    () => localStorage.getItem("inky-wb-composer") || "",
  );
  const [intent, setIntent] =
    useState<NonNullable<DiscussionContext["intent"]>>("auto");
  useEffect(()=>{if(prefill){setText(prefill.text);setIntent("plan");}},[prefill]);
  const [busy, setBusy] = useState(false);
  const [replyContext, setReplyContext] = useState<DiscussionContext>();
  const currentContext: DiscussionContext = {
    schemaVersion: 2,
    date: selected?.item?.date || date,
    viewDate: date,
    intent,
    selectedTaskId: selected?.task.id ?? null,
    selectedStepId: selected?.step?.id ?? null,
    selectedDayItemId: selected?.item?.id ?? null,
    taskTitle: selected?.task.title ?? null,
    stepText: selected?.step?.text ?? null,
  };
  const visibleContext = busy && replyContext ? replyContext : currentContext;
  const dayName =
    currentContext.date === dateKey() ? "今天" : dateLabel(currentContext.date);
  const [history, setHistory] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [permission, setPermission] = useState<{
    key: string;
    params: {
      toolCall?: { title?: string };
      options: { optionId: string; name: string }[];
    };
  }>();
  const turn = useRef<string>();
  const sessionRef = useRef<string>();
  const end = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const serial = useRef(0);
  const load = async (id?: string) => {
    const seq = ++serial.current;
    const r = await invoke<{
      sessions: Conversation[];
      messages: Message[];
      active?: { requestId: string; sessionId: string };
    }>("workbench_history", { sessionId: id ?? null });
    if (seq !== serial.current) return;
    setSessions(r.sessions);
    setMessages(r.messages);
    setSession(id);
    sessionRef.current = id;
    if (r.active && r.active.sessionId === id) {
      turn.current = r.active.requestId;
      sending.current = true;
      setBusy(true);
      setReplyContext(
        r.messages.find(
          (message) => message.id === `${r.active!.requestId}-answer`,
        )?.context || undefined,
      );
      setStatus("正在回复…");
    }
  };
  useEffect(() => {
    let dead = false;
    void invoke<{ sessions: Conversation[] }>("workbench_history", {
      sessionId: null,
    })
      .then((r) => {
        if (!dead) {
          setSessions(r.sessions);
          if (r.sessions[0]) void load(r.sessions[0].id);
        }
      })
      .catch((e) => setError(getError(e)));
    return () => {
      dead = true;
      serial.current++;
    };
  }, []);
  useEffect(() => {
    const a = listen<{
      requestId: string;
      sessionId: string;
      context?: DiscussionContext;
      update: {
        sessionUpdate: string;
        content?: { text?: string };
        title?: string;
        status?: string;
      };
    }>("workbench:chat", (e) => {
      const p = e.payload;
      if (p.requestId !== turn.current) return;
      sessionRef.current = p.sessionId;
      setSession(p.sessionId);
      if (p.context) {
        const context = p.context;
        setReplyContext(context);
        setMessages((ms) =>
          ms.map((m) =>
            m.id === p.requestId || m.id === `${p.requestId}-answer`
              ? { ...m, context }
              : m,
          ),
        );
      }
      const u = p.update;
      if (u.sessionUpdate === "connected") setStatus("正在思考…");
      if (u.sessionUpdate === "agent_message_chunk") {
        setStatus("正在回复…");
        setMessages((ms) =>
          ms.map((m) =>
            m.id === `${p.requestId}-answer`
              ? { ...m, text: m.text + (u.content?.text || "") }
              : m,
          ),
        );
      }
      if (u.sessionUpdate === "tool_call")
        setStatus(u.title ? `正在处理 · ${u.title}` : "正在读取工作记录…");
    });
    const b = listen<NonNullable<typeof permission>>(
      "workbench:permission",
      (e) => setPermission(e.payload),
    );
    const c = listen<{
      requestId: string;
      sessionId: string;
      message: Message;
      error?: string;
    }>("workbench:finished", (e) => {
      const r = e.payload;
      if (r.requestId !== turn.current) return;
      sessionRef.current = r.sessionId;
      setSession(r.sessionId);
      setMessages((ms) => applyReply(ms, r.requestId, r.message));
      if (r.message.context) setReplyContext(r.message.context);
      turn.current = undefined;
      setBusy(false);
      sending.current = false;
      setStatus("");
      setPermission(undefined);
      if (r.error) setError(r.error);
      void invoke<{ sessions: Conversation[] }>("workbench_history", {
        sessionId: null,
      }).then((h) => setSessions(h.sessions));
    });
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
      void c.then((f) => f());
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, messages[messages.length - 1]?.text, status]);
  const send = async (value = text) => {
    if (!value.trim() || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setStatus("正在连接 Hermes…");
    setHistory(false);
    const requestId = crypto.randomUUID();
    turn.current = requestId;
    const now = Date.now();
    const context: DiscussionContext = {
      ...currentContext,
      today: dateKey(),
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
      temporaryConstraints: { text: value, scope: "request" },
    };
    setReplyContext(context);
    setMessages((ms) => [
      ...ms,
      { id: requestId, role: "user", text: value, created: now, context },
      {
        id: `${requestId}-answer`,
        role: "assistant",
        text: "",
        created: now + 1,
        status: "sending",
        context,
      },
    ]);
    setText("");
    setIntent("auto");
    localStorage.removeItem("inky-wb-composer");
    try {
      const r = await invoke<{
        sessionId: string;
        message: Message;
        error?: string;
      }>("workbench_send", {
        requestId,
        sessionId: sessionRef.current ?? null,
        message: value,
        context,
      });
      setMessages((ms) => applyReply(ms, requestId, r.message));
      if (turn.current === requestId) {
        sessionRef.current = r.sessionId;
        setSession(r.sessionId);
        if (r.message.context) setReplyContext(r.message.context);
        if (r.error) setError(r.error);
      }
      const h = await invoke<{ sessions: Conversation[] }>(
        "workbench_history",
        { sessionId: null },
      );
      setSessions(h.sessions);
      onSaved();
    } catch (e) {
      if (turn.current !== requestId) return;
      setError(getError(e));
      setMessages((ms) =>
        ms.map((m) =>
          m.id === `${requestId}-answer`
            ? {
                ...m,
                text: m.text || "消息未能完成。你的输入已保留在输入框。",
                status: "error",
              }
            : m,
        ),
      );
      setText((current) => {
        const saved = current || value;
        localStorage.setItem("inky-wb-composer", saved);
        return saved;
      });
    } finally {
      if (turn.current === requestId) {
        sending.current = false;
        setBusy(false);
        setStatus("");
        setPermission(undefined);
        turn.current = undefined;
      }
    }
  };
  const answerPermission = async (optionId: string | null) => {
    try {
      await invoke("workbench_permission", { key: permission!.key, optionId });
      setPermission(undefined);
    } catch (e) {
      setError(getError(e));
    }
  };
  return (
    <aside className="wk-coach" aria-label="Coach 对话">
      <header className="wk-coach-header">
        <div>
          <h2>
            Coach <i className={busy ? "working" : ""} />
          </h2>
          <p>围绕当前这一步</p>
        </div>
        <button
          aria-label="对话历史"
          disabled={busy}
          onClick={() => setHistory(!history)}
        >
          <Clock size={20} />
          <span>历史</span>
        </button>
      </header>
      <div
        className="wk-chat-context"
        aria-label="Coach 讨论范围"
        aria-live="polite"
      >
        <div>
          <strong>
            {busy ? "本次回复" : "讨论范围"} · {visibleContext.date}
          </strong>
          <p>
            {visibleContext.stepText ||
              visibleContext.taskTitle ||
              "当天计划与记录"}
          </p>
          {busy &&
            scopeLabel(visibleContext) !== scopeLabel(currentContext) && (
              <small>下次发送：{scopeLabel(currentContext)}</small>
            )}
        </div>
        {selected && (
          <button
            aria-label="取消任务选择，讨论当天记录"
            onClick={onClearSelection}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {history ? (
        <div className="wk-history">
          <button
            className="wk-primary"
            onClick={() => {
              void load();
              setHistory(false);
              setError("");
            }}
          >
            <Plus size={18} />
            新对话
          </button>
          {sessions.map((s) => (
            <button
              className={s.id === session ? "active" : ""}
              key={s.id}
              onClick={() => {
                void load(s.id).catch((e) => setError(getError(e)));
                setHistory(false);
                setError("");
              }}
            >
              <span>{s.title}</span>
              <small>{new Date(s.updated).toLocaleDateString("zh-CN")}</small>
            </button>
          ))}
          {!sessions.length && <p className="muted">还没有对话。</p>}
        </div>
      ) : (
        <div className="wk-chat-scroll">
          {!messages.length && (
            <div className="wk-chat-empty">
              <div className="wk-avatar">
                <Leaf size={21} />
              </div>
              <h3>先说说，你想推进什么？</h3>
              <p>一起拆解目标、调整安排，或者想清楚卡住的那一步。</p>
            </div>
          )}
          {messages.map((m) => (
            <article className={`wk-message ${m.role}`} key={m.id}>
              {m.role === "assistant" && (
                <div className="wk-message-heading">
                  <span className="wk-avatar">
                    <Leaf size={17} />
                  </span>
                  <span>Hermes Coach</span>
                  <time>
                    {new Date(m.created).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              )}
              <div className="wk-message-content">
                {m.context && (
                  <p className="wk-message-scope">{scopeLabel(m.context)}</p>
                )}
                <RichText
                  text={m.text
                    .replace(directive, "")
                    .replace(adjustmentDirective, "")
                    .trim()}
                />
                {[...m.text.matchAll(directive)].map((match) => (
                  <PlanCards
                    key={match[1]}
                    id={match[1]}
                    streaming={m.status === "sending"}
                    defaultDate={
                      validDate(match[2]) ? match[2] : m.context?.date
                    }
                    onSaved={onSaved}
                  />
                ))}
                {[...m.text.matchAll(adjustmentDirective)].map((match) => (
                  <AdjustmentCards
                    key={match[1]}
                    id={match[1]}
                    streaming={m.status === "sending"}
                    onSaved={onSaved}
                  />
                ))}
                {m.status === "interrupted" && (
                  <small className="muted">回复已停止</small>
                )}
              </div>
            </article>
          ))}
          {busy && (
            <p className="wk-thinking" role="status">
              {status}
            </p>
          )}
          <div ref={end} />
        </div>
      )}
      {permission && (
        <div className="wk-permission">
          <strong>
            {permission.params.toolCall?.title || "Hermes 请求执行操作"}
          </strong>
          <p>请选择是否允许本次操作。</p>
          {permission.params.options.map((o) => (
            <button
              key={o.optionId}
              onClick={() => void answerPermission(o.optionId)}
            >
              {o.name}
            </button>
          ))}
          <button onClick={() => void answerPermission(null)}>取消</button>
        </div>
      )}
      {error && (
        <div className="wk-chat-error" role="alert">
          <span>{error}</span>
          <button aria-label="关闭对话错误" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <div className="wk-coach-shortcuts" aria-label="Coach 请求入口">
        {(
          [
            { intent: "plan", label: "安排一下", text: `帮我安排${dayName}` },
            {
              intent: "stuck",
              label: "我卡住了",
              text: selected
                ? "这一步有点难开始"
                : "我有点卡住了，帮我明确下一步",
            },
            {
              intent: "review",
              label: "回顾一下",
              text: `回顾${dayName}的工作`,
            },
          ] as const
        ).map((shortcut) => (
          <button
            key={shortcut.intent}
            type="button"
            aria-pressed={intent === shortcut.intent}
            onClick={() => {
              setText(shortcut.text);
              setIntent(shortcut.intent);
              localStorage.setItem("inky-wb-composer", shortcut.text);
            }}
          >
            {shortcut.label}
          </button>
        ))}
      </div>
      <form
        className="wk-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="发送给 Coach"
          placeholder="说说哪里卡住了…"
          maxLength={16000}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setIntent("auto");
            localStorage.setItem("inky-wb-composer", e.target.value);
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (!busy) void send();
            }
          }}
        />
        {busy ? (
          <button
            type="button"
            aria-label="停止回复"
            onClick={() =>
              void invoke("workbench_cancel").catch((e) =>
                setError(getError(e)),
              )
            }
          >
            <Square size={20} />
          </button>
        ) : (
          <button aria-label="发送" disabled={!text.trim()}>
            <Send size={22} />
          </button>
        )}
        <small>Enter 发送 · Shift + Enter 换行</small>
      </form>
    </aside>
  );
}
