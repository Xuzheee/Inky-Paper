import { useLayoutEffect, useRef, useState } from "react";

/** Fit the handwriting to its paper area after the bundled font is ready. */
export function EndTask({ text }: { text: string }) {
  const area = useRef<HTMLDivElement>(null);
  const lettering = useRef<HTMLSpanElement>(null);
  const lines = useRef<HTMLSpanElement>(null);
  const fullText = useRef<HTMLDialogElement>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    let active = true;
    const fit = () => {
      const box = area.current;
      const node = lettering.current;
      const content = lines.current;
      if (!active || !box || !node || !content || !box.clientWidth) return;
      const style = getComputedStyle(box);
      const height =
        box.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      content.style.webkitLineClamp = "unset";
      // Use rendered lines, rather than character counts: Latin words, CJK,
      // punctuation and explicit line breaks all occupy different space.
      let low = 18,
        high = 42,
        fitted = 18;
      while (low <= high) {
        const size = Math.floor((low + high) / 2);
        node.style.fontSize = `${size}px`;
        if (
          node.scrollHeight <= height &&
          node.scrollWidth <= box.clientWidth - 12
        ) {
          fitted = size;
          low = size + 1;
        } else high = size - 1;
      }
      node.style.fontSize = `${fitted}px`;
      const overflow =
        node.scrollHeight > height || node.scrollWidth > box.clientWidth - 12;
      if (overflow)
        content.style.webkitLineClamp = String(
          Math.max(1, Math.floor((height - 10) / (fitted * 1.15))),
        );
      setClipped(overflow);
    };
    fit();
    void document.fonts?.ready.then(fit);
    document.fonts?.addEventListener("loadingdone", fit);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (area.current) observer?.observe(area.current);
    return () => {
      active = false;
      observer?.disconnect();
      document.fonts?.removeEventListener("loadingdone", fit);
    };
  }, [text]);

  return (
    <>
      <div className="end-task" ref={area}>
        <span ref={lettering} title={text}>
          <span className="end-task-letters" ref={lines}>
            {text}
          </span>
        </span>
        {clipped && (
          <button
            className="end-task-more"
            onClick={() => fullText.current?.showModal()}
          >
            查看全文
          </button>
        )}
      </div>
      <dialog
        ref={fullText}
        className="end-task-dialog"
        aria-label="本轮完整任务"
        data-no-window-drag
        onClick={(event) => {
          if (event.target === event.currentTarget) fullText.current?.close();
        }}
      >
        <p tabIndex={0}>{text}</p>
        <button
          className="text-button"
          onClick={() => fullText.current?.close()}
        >
          收起全文
        </button>
      </dialog>
    </>
  );
}
