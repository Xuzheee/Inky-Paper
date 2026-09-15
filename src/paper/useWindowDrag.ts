import { useEffect, useRef, type HTMLAttributes } from "react";

const controls =
  'button,input,textarea,select,a,label,fieldset,summary,[role="button"],[role="radio"],[contenteditable]:not([contenteditable="false"]),[data-no-window-drag]';

type Options = {
  enabled: boolean;
  moveBy: (deltaX: number, deltaY: number) => Promise<unknown>;
  onError?: (error: unknown) => void;
};

/** Mouse-only window dragging leaves touch scrolling and form controls native. */
export function useWindowDrag(options: Options): HTMLAttributes<HTMLElement> {
  const current = useRef(options);
  current.current = options;
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const pending = useRef({ x: 0, y: 0 });
  const moving = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const cancel = () => {
      pointer.current = null;
      pending.current = { x: 0, y: 0 };
    };
    if (!options.enabled) cancel();
    window.addEventListener("blur", cancel);
    return () => {
      mounted.current = false;
      cancel();
      window.removeEventListener("blur", cancel);
    };
  }, [options.enabled]);

  const flush = async () => {
    if (moving.current) return;
    moving.current = true;
    try {
      // Keep native read-position / write-position calls in order. Fast pointer
      // events are combined while the previous IPC call is still in flight.
      while (
        mounted.current &&
        current.current.enabled &&
        (pending.current.x || pending.current.y)
      ) {
        const { x, y } = pending.current;
        pending.current = { x: 0, y: 0 };
        await current.current.moveBy(x, y);
      }
    } catch (error) {
      pointer.current = null;
      pending.current = { x: 0, y: 0 };
      if (mounted.current) current.current.onError?.(error);
    } finally {
      moving.current = false;
    }
  };

  const cancelPointer = (id: number) => {
    if (pointer.current?.id === id) pointer.current = null;
  };

  return {
    onPointerDown(event) {
      if (
        !options.enabled ||
        pointer.current ||
        event.button !== 0 ||
        event.isPrimary === false ||
        (event.pointerType && event.pointerType !== "mouse") ||
        !(event.target instanceof Element) ||
        event.target.closest(controls)
      )
        return;

      const surface = event.currentTarget;
      const bounds = surface.getBoundingClientRect();
      // A scrollable end page still needs its native scrollbar thumb.
      if (
        event.target === surface &&
        ((surface.offsetWidth > surface.clientWidth &&
          event.clientX >= bounds.left + surface.clientWidth) ||
          (surface.offsetHeight > surface.clientHeight &&
            event.clientY >= bounds.top + surface.clientHeight))
      )
        return;

      event.preventDefault();
      surface.setPointerCapture(event.pointerId);
      pointer.current = {
        id: event.pointerId,
        x: event.screenX,
        y: event.screenY,
      };
    },
    onPointerMove(event) {
      const previous = pointer.current;
      if (!previous || previous.id !== event.pointerId) return;
      if (!(event.buttons & 1)) {
        cancelPointer(event.pointerId);
        return;
      }
      const x = event.screenX - previous.x;
      const y = event.screenY - previous.y;
      if (Math.abs(x) + Math.abs(y) < 2) return;
      pointer.current = {
        id: previous.id,
        x: event.screenX,
        y: event.screenY,
      };
      pending.current.x += x;
      pending.current.y += y;
      void flush();
    },
    onPointerUp: (event) => cancelPointer(event.pointerId),
    onPointerCancel: (event) => cancelPointer(event.pointerId),
    onLostPointerCapture: (event) => cancelPointer(event.pointerId),
  };
}
