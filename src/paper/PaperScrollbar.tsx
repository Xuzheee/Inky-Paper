import { useId, useLayoutEffect, useRef, useState } from "react";
import "./paper-scrollbar.css";

type Geometry = {
  target: HTMLElement;
  top: number;
  height: number;
  thumbHeight: number;
  thumbTop: number;
  maximum: number;
  value: number;
  controls: string;
};

const clamp = (value: number, maximum: number) =>
  Math.max(0, Math.min(value, maximum));

/** The track lives outside the scrolling/zoomed paper; scrollTop stays native. */
export function PaperScrollbar({ target }: { target: HTMLElement | null }) {
  const generatedId = `paper-scroll-${useId().replace(/:/g, "")}`;
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const liveGeometry = useRef<Geometry | null>(null);
  const [track, setTrack] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [dragging, setDragging] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const refresh = useRef(() => {});
  const drag = useRef<{
    id: number;
    y: number;
    value: number;
  } | null>(null);

  const reveal = () => {
    setVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 1100);
  };

  useLayoutEffect(() => {
    if (!target) {
      liveGeometry.current = null;
      setGeometry(null);
      return;
    }
    const assignedId = !target.id;
    if (assignedId) target.id = generatedId;
    let frame = 0;
    const measure = () => {
      const bounds = target.getBoundingClientRect();
      // clientHeight is in the element's own CSS coordinates. The track is in
      // viewport coordinates, so CSS zoom must only affect the measured bounds.
      const scale = target.offsetHeight ? bounds.height / target.offsetHeight : 1;
      const top = Math.max(0, bounds.top + target.clientTop * scale) + 10;
      const bottom = Math.min(
        window.innerHeight,
        bounds.top + (target.clientTop + target.clientHeight) * scale,
      ) - 10;
      const height = Math.max(0, bottom - top);
      const maximum = Math.max(0, target.scrollHeight - target.clientHeight);
      if (!target.isConnected || maximum <= 1 || height <= 0) {
        liveGeometry.current = null;
        setGeometry(null);
        return;
      }
      const value = clamp(target.scrollTop, maximum);
      const thumbHeight = Math.min(
        height,
        Math.max(24, height * target.clientHeight / target.scrollHeight),
      );
      const next = {
        target, top, height, thumbHeight,
        thumbTop: value / maximum * (height - thumbHeight),
        maximum, value, controls: target.id,
      };
      liveGeometry.current = next;
      setGeometry((previous) => previous &&
        (Object.keys(next) as (keyof Geometry)[]).every((key) => previous[key] === next[key])
        ? previous : next);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const onScroll = () => { reveal(); schedule(); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    const observeContent = () => {
      observer?.disconnect();
      observer?.observe(target);
      for (const child of target.children) observer?.observe(child);
    };
    const mutations = new MutationObserver(() => { observeContent(); schedule(); });
    mutations.observe(target, { subtree: true, childList: true, characterData: true, attributes: true });
    observeContent();
    refresh.current = measure;
    target.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    measure();
    return () => {
      refresh.current = () => {};
      liveGeometry.current = null;
      cancelAnimationFrame(frame);
      clearTimeout(hideTimer.current);
      observer?.disconnect();
      mutations.disconnect();
      target.removeEventListener("scroll", onScroll);
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
      if (assignedId && target.id === generatedId) target.removeAttribute("id");
    };
  }, [target, generatedId]);

  const scrollTo = (value: number) => {
    if (!target) return;
    target.scrollTop = clamp(value, target.scrollHeight - target.clientHeight);
    refresh.current();
    reveal();
  };

  useLayoutEffect(() => {
    if (!track || !target) return;
    const cancel = () => {
      const pointer = drag.current;
      drag.current = null;
      setDragging(false);
      if (pointer && track.hasPointerCapture?.(pointer.id))
        track.releasePointerCapture(pointer.id);
    };
    const onMove = (event: PointerEvent) => {
      const pointer = drag.current;
      const current = liveGeometry.current;
      if (!pointer || pointer.id !== event.pointerId || !current) return;
      if (!(event.buttons & 1)) { cancel(); return; }
      event.preventDefault();
      const travel = current.height - current.thumbHeight;
      if (travel > 0)
        scrollTo(pointer.value + (event.clientY - pointer.y) / travel * current.maximum);
    };
    const onEnd = (event: PointerEvent) => {
      if (drag.current?.id === event.pointerId) cancel();
    };
    const onWheel = (event: WheelEvent) => {
      // React's delegated wheel listeners may be passive. A native listener is
      // needed here because this overlay is not a child of the scroll target.
      if (event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1;
      scrollTo(target.scrollTop + event.deltaY * unit);
    };
    track.addEventListener("wheel", onWheel, { passive: false });
    track.addEventListener("lostpointercapture", onEnd);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      track.removeEventListener("wheel", onWheel);
      track.removeEventListener("lostpointercapture", onEnd);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("blur", cancel);
      clearTimeout(hideTimer.current);
    };
  }, [target, track]);

  if (!geometry || geometry.target !== target) return null;
  return (
    <div
      ref={setTrack}
      className="paper-scrollbar"
      data-no-window-drag
      data-visible={visible || dragging ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      role="scrollbar"
      tabIndex={0}
      aria-label="滚动页面"
      aria-controls={geometry.controls}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={Math.round(geometry.maximum)}
      aria-valuenow={Math.round(geometry.value)}
      style={{ top: geometry.top, height: geometry.height }}
      onPointerDown={(event) => {
        if (!target || event.button !== 0 || event.isPrimary === false ||
          (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        refresh.current();
        const current = liveGeometry.current;
        if (!current) return;
        const y = event.clientY - current.top;
        if (y >= current.thumbTop && y <= current.thumbTop + current.thumbHeight) {
          drag.current = { id: event.pointerId, y: event.clientY, value: target.scrollTop };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDragging(true);
          reveal();
        } else {
          scrollTo(target.scrollTop + (y < current.thumbTop ? -1 : 1) * target.clientHeight * 0.85);
        }
      }}
      onKeyDown={(event) => {
        if (!target) return;
        const page = target.clientHeight * 0.85;
        const next = {
          ArrowUp: target.scrollTop - 36,
          ArrowDown: target.scrollTop + 36,
          PageUp: target.scrollTop - page,
          PageDown: target.scrollTop + page,
          Home: 0,
          End: geometry.maximum,
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        scrollTo(next);
      }}
    >
      <span
        className="paper-scrollbar-thumb"
        aria-hidden="true"
        style={{ height: geometry.thumbHeight, transform: `translateY(${geometry.thumbTop}px)` }}
      />
    </div>
  );
}
