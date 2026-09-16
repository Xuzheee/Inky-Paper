import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useWindowDrag } from "./useWindowDrag";
import { PaperScrollbar } from "./PaperScrollbar";
import "./paper-chrome.css";

export function PaperChrome({
  paperRef,
  scrollRef,
  pageKey,
  canDrag,
  moveBy,
  onError,
}: {
  paperRef: RefObject<HTMLElement>;
  scrollRef: RefObject<HTMLElement>;
  pageKey: string;
  canDrag: boolean;
  moveBy: (x: number, y: number) => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const drag = useWindowDrag({ enabled: canDrag, moveBy, onError });

  useEffect(() => {
    setTarget(scrollRef.current || paperRef.current);
  }, [scrollRef, paperRef, pageKey]);

  useEffect(() => {
    document.documentElement.classList.add("paper-window");
    return () => document.documentElement.classList.remove("paper-window");
  }, []);

  useEffect(() => {
    const element = layer.current;
    if (!element || !target) return;
    // The edge is outside the scrolling DOM. Forward its wheel input without
    // intercepting content scrolling or the scrollbar's own wheel handler.
    const wheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        !(event.target instanceof Element) ||
        !event.target.closest("[data-paper-drag-edge]")
      )
        return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? target.clientHeight
            : 1;
      target.scrollTop += event.deltaY * unit;
      target.scrollLeft += event.deltaX * unit;
      event.preventDefault();
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [target]);

  return createPortal(
    <div
      className="paper-chrome"
      ref={layer}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {canDrag && (
        <>
          <div
            className="paper-drag-edge paper-drag-left"
            data-paper-drag-edge
            aria-hidden="true"
            title="拖动窗口"
            {...drag}
          />
          <div
            className="paper-drag-edge paper-drag-bottom"
            data-paper-drag-edge
            aria-hidden="true"
            title="拖动窗口"
            {...drag}
          />
        </>
      )}
      <PaperScrollbar target={target} />
    </div>,
    document.body,
  );
}
