// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaperScrollbar } from "./PaperScrollbar";

const observations: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
const targets: HTMLElement[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  observations.length = 0;
  vi.stubGlobal("ResizeObserver", class {
    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
    constructor(callback: () => void) { observations.push({ callback, disconnect: this.disconnect }); }
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});

afterEach(() => {
  cleanup();
  for (const target of targets.splice(0)) target.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function makeTarget(options: { viewport?: number; content?: number; scale?: number; top?: number; id?: string } = {}) {
  const target = document.createElement("div");
  const size = { viewport: options.viewport ?? 300, content: options.content ?? 900 };
  const scale = options.scale ?? 1;
  const top = options.top ?? 0;
  target.id = options.id ?? "";
  Object.defineProperties(target, {
    clientHeight: { get: () => size.viewport },
    offsetHeight: { get: () => size.viewport },
    clientTop: { value: 0 },
    scrollHeight: { get: () => size.content },
  });
  target.getBoundingClientRect = () => ({
    x: 0, y: top, top, left: 0, right: 320, width: 320,
    bottom: top + size.viewport * scale, height: size.viewport * scale,
    toJSON: () => ({}),
  });
  document.body.appendChild(target);
  targets.push(target);
  return { target, size };
}

function pointer(target: EventTarget, type: string, clientY: number, options: { id?: number; buttons?: number } = {}) {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: options.buttons ?? 1, clientY,
  });
  Object.defineProperties(event, {
    pointerId: { value: options.id ?? 1 },
    pointerType: { value: "mouse" },
    isPrimary: { value: true },
  });
  fireEvent(target as HTMLElement, event);
  return event;
}

function scrollbar() { return screen.getByRole("scrollbar", { name: "滚动页面" }); }
function resize() {
  act(() => { observations[observations.length - 1]?.callback(); vi.advanceTimersByTime(16); });
}

describe("paper overlay scrolling", () => {
  it("only exposes a scrollbar for overflow and reacts to changing content", async () => {
    const { target, size } = makeTarget({ content: 300 });
    const view = render(<PaperScrollbar target={target} />);
    expect(screen.queryByRole("scrollbar")).toBeNull();
    size.content = 900;
    await act(async () => { target.appendChild(document.createElement("p")); });
    act(() => vi.advanceTimersByTime(16));
    expect(scrollbar().getAttribute("aria-controls")).toBe(target.id);
    expect(scrollbar().getAttribute("aria-valuemax")).toBe("600");
    size.content = 300;
    resize();
    expect(screen.queryByRole("scrollbar")).toBeNull();
    view.unmount();
    expect(target.id).toBe("");
    expect(observations[0].disconnect).toHaveBeenCalled();
  });

  it("keeps native scroll position and keyboard navigation in sync, including boundaries", () => {
    const { target } = makeTarget({ id: "task-paper" });
    render(<PaperScrollbar target={target} />);
    expect(scrollbar().getAttribute("aria-controls")).toBe("task-paper");
    const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    fireEvent(scrollbar(), down);
    expect(down.defaultPrevented).toBe(true);
    expect(target.scrollTop).toBe(36);
    fireEvent.keyDown(scrollbar(), { key: "PageDown" });
    expect(target.scrollTop).toBe(291);
    fireEvent.keyDown(scrollbar(), { key: "PageUp" });
    expect(target.scrollTop).toBe(36);
    fireEvent.keyDown(scrollbar(), { key: "End" });
    expect(target.scrollTop).toBe(600);
    fireEvent.keyDown(scrollbar(), { key: "ArrowDown" });
    expect(target.scrollTop).toBe(600);
    fireEvent.keyDown(scrollbar(), { key: "Home" });
    fireEvent.keyDown(scrollbar(), { key: "ArrowUp" });
    expect(target.scrollTop).toBe(0);
    target.scrollTop = 178;
    fireEvent.scroll(target);
    act(() => vi.advanceTimersByTime(16));
    expect(scrollbar().getAttribute("aria-valuenow")).toBe("178");
  });

  it("drags in viewport coordinates when the paper uses CSS zoom", () => {
    const { target } = makeTarget({ scale: 1.5, top: 30 });
    render(<PaperScrollbar target={target} />);
    const track = scrollbar();
    track.setPointerCapture = vi.fn();
    // Visible track is 430px; thumb is one third. Half the remaining
    // 286.67px travel must scroll halfway through the 600 CSS-pixel content.
    const down = pointer(track, "pointerdown", 50);
    expect(down.defaultPrevented).toBe(true);
    expect(track.setPointerCapture).toHaveBeenCalledWith(1);
    pointer(window, "pointermove", 50 + 430 / 3);
    expect(target.scrollTop).toBeCloseTo(300);
    pointer(window, "pointermove", 2000);
    expect(target.scrollTop).toBe(600);
    pointer(window, "pointerup", 2000, { buttons: 0 });
    expect(track.getAttribute("data-dragging")).toBeNull();
  });

  it("pages on the track and forwards overlay wheel events without cancelling browser zoom", () => {
    const { target } = makeTarget();
    render(<PaperScrollbar target={target} />);
    pointer(scrollbar(), "pointerdown", 270);
    expect(target.scrollTop).toBe(255);
    const wheel = new WheelEvent("wheel", { deltaY: 2, deltaMode: 1, bubbles: true, cancelable: true });
    fireEvent(scrollbar(), wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(target.scrollTop).toBe(287);
    fireEvent.wheel(scrollbar(), { deltaY: 1, deltaMode: 2 });
    expect(target.scrollTop).toBe(587);
    const zoom = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    fireEvent(scrollbar(), zoom);
    expect(zoom.defaultPrevented).toBe(false);
    expect(target.scrollTop).toBe(587);
  });

  it.each(["pointerup", "pointercancel", "lostpointercapture", "blur"])(
    "stops active dragging after %s", (end) => {
      const { target } = makeTarget();
      render(<PaperScrollbar target={target} />);
      const track = scrollbar();
      pointer(track, "pointerdown", 20);
      pointer(window, "pointermove", 40);
      const saved = target.scrollTop;
      if (end === "blur") fireEvent(window, new Event("blur"));
      else pointer(end === "lostpointercapture" ? track : window, end, 40, { buttons: 0 });
      pointer(window, "pointermove", 100);
      expect(target.scrollTop).toBe(saved);
      expect(track.getAttribute("data-dragging")).toBeNull();
    },
  );

  it("cleans up an active drag, pending observer updates and wheel handlers when target changes or unmounts", () => {
    const first = makeTarget();
    const second = makeTarget({ id: "keep-existing-id" });
    const view = render(<PaperScrollbar target={first.target} />);
    const oldTrack = scrollbar();
    pointer(oldTrack, "pointerdown", 20);
    pointer(window, "pointermove", 40);
    const saved = first.target.scrollTop;
    view.rerender(<PaperScrollbar target={second.target} />);
    pointer(window, "pointermove", 100);
    fireEvent.wheel(oldTrack, { deltaY: 100 });
    expect(first.target.scrollTop).toBe(saved);
    expect(second.target.scrollTop).toBe(0);
    expect(first.target.id).toBe("");
    const track = scrollbar();
    pointer(track, "pointerdown", 20);
    act(() => observations[observations.length - 1]?.callback());
    view.unmount();
    pointer(window, "pointermove", 100);
    fireEvent.wheel(track, { deltaY: 100 });
    act(() => vi.runAllTimers());
    expect(second.target.scrollTop).toBe(0);
    expect(second.target.id).toBe("keep-existing-id");
    expect(observations.every((observation) => observation.disconnect.mock.calls.length > 0)).toBe(true);
  });

  it("reveals after native scroll and fades after idle, while an active drag stays visible", () => {
    const { target } = makeTarget();
    render(<PaperScrollbar target={target} />);
    fireEvent.scroll(target);
    expect(scrollbar().getAttribute("data-visible")).toBe("true");
    act(() => vi.advanceTimersByTime(1100));
    expect(scrollbar().getAttribute("data-visible")).toBeNull();
    pointer(scrollbar(), "pointerdown", 20);
    act(() => vi.advanceTimersByTime(1200));
    expect(scrollbar().getAttribute("data-visible")).toBe("true");
  });
});
