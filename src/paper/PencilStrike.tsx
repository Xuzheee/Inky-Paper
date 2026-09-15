import { useEffect, useRef } from "react";

type Point = { x: number; y: number };
type Stroke = {
  pointerId: number;
  revision: number;
  rect: DOMRect;
  origin: DOMRect;
  threshold: number;
  points: Point[];
};

// Paint coalesced pointer samples once per frame without rerendering the task list.
function pencilPath(points: Point[]) {
  if (points.length < 2) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    path += ` Q ${a.x} ${a.y} ${(a.x + b.x) / 2} ${(a.y + b.y) / 2}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

export function PencilStrike({
  text,
  revision,
  completed,
  disabled,
  className,
  complete,
}: {
  text: string;
  revision: number;
  completed: boolean;
  disabled: boolean;
  className: string;
  complete: () => Promise<void>;
}) {
  const stroke = useRef<Stroke | null>(null);
  const host = useRef<HTMLSpanElement>(null);
  const latest = useRef({ revision, disabled, completed, complete });
  latest.current = { revision, disabled, completed, complete };
  const path = useRef<SVGPathElement>(null);
  const frame = useRef<number | null>(null);
  const submitted = useRef(false);
  const suppressClick = useRef(false);
  const clear = () => {
    stroke.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    path.current?.setAttribute("d", "");
  };
  useEffect(() => {
    if (!submitted.current) clear();
  }, [revision, disabled, completed]);
  const paint = (active: Stroke) => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      path.current?.setAttribute("d", pencilPath(active.points));
    });
  };
  const addPoint = (event: PointerEvent) => {
    const active = stroke.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const coalesced = event.getCoalescedEvents?.();
    for (const point of coalesced?.length ? coalesced : [event]) {
      const next = {
        x: point.clientX - active.origin.left,
        y: point.clientY - active.origin.top,
      };
      const previous = active.points[active.points.length - 1];
      if (
        !previous ||
        Math.hypot(next.x - previous.x, next.y - previous.y) >= 0.6
      )
        active.points.push(next);
    }
    paint(active);
  };
  useEffect(() => {
    const node = host.current!;
    const surface = node.closest<HTMLElement>("[data-strike-row]") || node;
    const down = (event: PointerEvent) => {
      suppressClick.current = false;
      const current = latest.current;
      const target = event.target as Element;
      const control = target.closest(
        "button,input,select,textarea,a,[data-strike-ignore]",
      );
      if (
        current.disabled ||
        current.completed ||
        submitted.current ||
        event.pointerType !== "mouse" ||
        event.button !== 0 ||
        (control && control !== surface)
      )
        return;
      const rect = surface.getBoundingClientRect();
      const origin = node.getBoundingClientRect();
      if (rect.width < 8 || rect.height === 0 || !origin.width) return;
      stroke.current = {
        pointerId: event.pointerId,
        revision: current.revision,
        rect,
        origin,
        threshold: Math.max(14, Math.min(36, origin.width * 0.35)),
        points: [],
      };
      surface.setPointerCapture(event.pointerId);
      addPoint(event);
    };
    const up = (event: PointerEvent) => {
      const active = stroke.current;
      if (!active || active.pointerId !== event.pointerId) return;
      addPoint(event);
      const first = active.points[0],
        last = active.points[active.points.length - 1];
      const dx = Math.abs(last.x - first.x);
      const ys = active.points.map((point) => point.y);
      const drift = Math.max(...ys) - Math.min(...ys);
      const current = latest.current;
      const valid =
        !current.disabled &&
        !current.completed &&
        current.revision === active.revision &&
        dx >= active.threshold &&
        drift <= Math.max(24, active.rect.height * 1.2) &&
        dx >= drift * 1.3;
      stroke.current = null;
      suppressClick.current = Math.hypot(dx, last.y - first.y) > 7;
      // Keep the live ink until persistence updates the line, avoiding a flash on release.
      submitted.current = valid;
      if (surface.hasPointerCapture(event.pointerId))
        surface.releasePointerCapture(event.pointerId);
      if (valid) {
        suppressClick.current = true;
        void current.complete().finally(() => {
          submitted.current = false;
          clear();
        });
      } else clear();
    };
    const cancel = () => {
      if (!submitted.current) clear();
    };
    const click = (event: MouseEvent) => {
      if (suppressClick.current && event.detail > 0) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
      }
    };
    surface.addEventListener("pointerdown", down);
    surface.addEventListener("pointermove", addPoint);
    surface.addEventListener("pointerup", up);
    surface.addEventListener("pointercancel", cancel);
    surface.addEventListener("lostpointercapture", cancel);
    surface.addEventListener("click", click);
    document.addEventListener("scroll", cancel, true);
    return () => {
      clear();
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("pointermove", addPoint);
      surface.removeEventListener("pointerup", up);
      surface.removeEventListener("pointercancel", cancel);
      surface.removeEventListener("lostpointercapture", cancel);
      surface.removeEventListener("click", click);
      document.removeEventListener("scroll", cancel, true);
    };
  }, []);
  return (
    <span
      ref={host}
      className={`pencil-strike ${className}`}
      data-can-strike={!disabled && !completed}
    >
      <span className="pencil-line">{text}</span>
      <svg className="sheet-live-ink" aria-hidden="true">
        <path ref={path} />
      </svg>
    </span>
  );
}
