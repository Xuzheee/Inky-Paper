import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import { useWindowDrag } from "./useWindowDrag";
import "./notice.css";

export type Notice = { id: string; message: string };
const isNative = () =>
  !!(window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;

/** Presentation only: acknowledgement never changes a task or clock. */
function NoticeCard({
  notice,
  dismiss,
  movable = false,
}: {
  notice: Notice;
  dismiss: () => void;
  movable?: boolean;
}) {
  const drag = useWindowDrag({
    enabled: movable,
    moveBy: (deltaX, deltaY) => invoke("move_window_by", { deltaX, deltaY }),
  });
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [dismiss]);
  return (
    <section className="paper-notice-card" aria-label="操作提醒" {...drag}>
      <div className="paper-notice-heading">
        <span>Inky Paper</span>
        <button type="button" aria-label="关闭提醒" onClick={dismiss}>
          <X size={15} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <p className="paper-notice-message" role="status" key={notice.id}>
        {notice.message}
      </p>
      <div className="paper-notice-actions">
        <button type="button" onClick={dismiss}>
          知道了
        </button>
      </div>
    </section>
  );
}

export function usePaperNotice() {
  const current = useRef<Notice | null>(null);
  const queue = useRef(Promise.resolve());
  const [fallback, setFallback] = useState<Notice | null>(null);
  const showNotice = useCallback((message: string) => {
    const notice = { id: crypto.randomUUID(), message };
    current.current = notice;
    setFallback(null);
    if (!isNative()) {
      setFallback(notice);
      return;
    }
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        if (current.current?.id !== notice.id) return;
        try {
          await invoke("paper_show_notice", notice);
        } catch {
          // A failed native window must not hide a successfully saved outcome.
          if (current.current?.id === notice.id) setFallback(notice);
        }
      });
  }, []);
  const clearNotice = useCallback(() => {
    const notice = current.current;
    current.current = null;
    setFallback(null);
    if (isNative() && notice) {
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          await invoke("paper_dismiss_notice", { id: notice.id });
        })
        .catch(() => {});
    }
  }, []);
  useEffect(() => {
    // Showing the native notice preserves focus, so Esc usually arrives here.
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && current.current) clearNotice();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [clearNotice]);
  useEffect(() => {
    if (!fallback) return;
    const timeout = window.setTimeout(clearNotice, 8000);
    return () => window.clearTimeout(timeout);
  }, [fallback, clearNotice]);
  return {
    showNotice,
    clearNotice,
    fallback: fallback
      ? createPortal(
          <div className="paper-notice-fallback">
            <NoticeCard notice={fallback} dismiss={clearNotice} />
          </div>,
          document.body,
        )
      : null,
  };
}

/** Separate Tauri webview; it only reads and dismisses ephemeral notices. */
export default function PaperNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const latest = useRef<Notice | null>(null);
  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    let revision = 0;
    const receive = (value: Notice | null) => {
      if (stopped) return;
      latest.current = value;
      setNotice(value);
    };
    void (async () => {
      unlisten = await listen<Notice | null>("paper:notice", (event) => {
        revision += 1;
        receive(event.payload);
      });
      if (stopped) {
        unlisten();
        return;
      }
      const beforeRead = revision;
      const value = await invoke<Notice | null>("paper_current_notice");
      if (beforeRead === revision) receive(value);
    })().catch(() => {});
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);
  const dismiss = useCallback(() => {
    const shown = latest.current;
    if (!shown) return;
    void invoke("paper_dismiss_notice", { id: shown.id }).catch(() => {});
  }, []);
  return notice ? (
    <NoticeCard notice={notice} dismiss={dismiss} movable />
  ) : null;
}
