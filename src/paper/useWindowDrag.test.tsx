// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { useWindowDrag } from "./useWindowDrag";

afterEach(cleanup);

function Surface({
  moveBy,
  enabled = true,
  onError,
  save = () => {},
}: {
  moveBy: (x: number, y: number) => Promise<unknown>;
  enabled?: boolean;
  onError?: (error: unknown) => void;
  save?: () => void;
}) {
  const [completed, chooseCompleted] = useState(false);
  const drag = useWindowDrag({ enabled, moveBy, onError });
  return (
    <main {...drag} data-testid="paper">
      <h1>结束番茄钟</h1>
      <div>复习</div>
      <label>
        <input
          type="radio"
          checked={completed}
          onChange={() => chooseCompleted(true)}
        />
        <span>已完成</span>
      </label>
      <textarea aria-label="产出" />
      <button onClick={save}>
        <span>保存并结束</span>
      </button>
      <a href="#tasks">任务列表</a>
      <div contentEditable suppressContentEditableWarning>
        手写笔记
      </div>
    </main>
  );
}

function pointer(
  target: Element,
  type: string,
  x = 100,
  y = 100,
  extra: {
    pointerId?: number;
    pointerType?: string;
    button?: number;
    buttons?: number;
    clientX?: number;
    clientY?: number;
  } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: extra.button ?? 0,
    buttons: extra.buttons ?? 1,
    screenX: x,
    screenY: y,
    clientX: extra.clientX ?? x,
    clientY: extra.clientY ?? y,
  });
  Object.defineProperties(event, {
    pointerId: { value: extra.pointerId ?? 1 },
    pointerType: { value: extra.pointerType ?? "mouse" },
    isPrimary: { value: true },
  });
  fireEvent(target, event);
  return event;
}

function setup(moveBy = vi.fn().mockResolvedValue(undefined)) {
  const view = render(<Surface moveBy={moveBy} />);
  const paper = screen.getByTestId("paper");
  const capture = vi.fn();
  paper.setPointerCapture = capture;
  return { ...view, paper, capture, moveBy };
}

describe("end page window dragging", () => {
  it("drags from the heading, handwritten task, and paper whitespace", async () => {
    const { paper, capture, moveBy } = setup();
    for (const target of [
      screen.getByRole("heading"),
      screen.getByText("复习"),
      paper,
    ]) {
      const down = pointer(target, "pointerdown");
      expect(down.defaultPrevented).toBe(true);
      pointer(paper, "pointermove", 128, 116);
      pointer(paper, "pointerup", 128, 116, { buttons: 0 });
      await act(async () => {});
    }
    expect(capture).toHaveBeenCalledTimes(3);
    expect(moveBy.mock.calls).toEqual([
      [28, 16],
      [28, 16],
      [28, 16],
    ]);
  });

  it("preserves label selection, note input, navigation and save clicks", () => {
    const moveBy = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn();
    render(<Surface moveBy={moveBy} save={save} />);
    const paper = screen.getByTestId("paper");
    paper.setPointerCapture = vi.fn();
    for (const target of [
      screen.getByText("已完成"),
      screen.getByRole("radio"),
      screen.getByRole("textbox"),
      screen.getByText("保存并结束"),
      screen.getByRole("link"),
      screen.getByText("手写笔记"),
    ]) {
      expect(pointer(target, "pointerdown").defaultPrevented).toBe(false);
      pointer(paper, "pointermove", 145, 120);
      pointer(paper, "pointerup", 145, 120, { buttons: 0 });
    }
    fireEvent.click(screen.getByText("已完成"));
    expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "复习了三节" },
    });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "复习了三节",
    );
    fireEvent.click(screen.getByText("保存并结束"));
    expect(save).toHaveBeenCalledOnce();
    expect(paper.setPointerCapture).not.toHaveBeenCalled();
    expect(moveBy).not.toHaveBeenCalled();
  });

  it("serializes native moves and combines rapid movement without losing distance", async () => {
    let resolveFirst!: () => void;
    const moveBy = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const { paper } = setup(moveBy);
    pointer(paper, "pointerdown");
    pointer(paper, "pointermove", 110, 104);
    pointer(paper, "pointermove", 125, 108);
    pointer(paper, "pointermove", 145, 114);
    pointer(paper, "pointerup", 145, 114, { buttons: 0 });
    expect(moveBy.mock.calls).toEqual([[10, 4]]);
    await act(async () => resolveFirst());
    expect(moveBy.mock.calls).toEqual([
      [10, 4],
      [35, 10],
    ]);
  });

  it.each(["pointerup", "pointercancel", "lostpointercapture", "blur"])(
    "ends the drag on %s and ignores later pointer movement",
    async (end) => {
      const { paper, moveBy } = setup();
      pointer(paper, "pointerdown");
      pointer(paper, "pointermove", 110, 104);
      await act(async () => {});
      if (end === "blur") fireEvent(window, new Event("blur"));
      else pointer(paper, end, 110, 104);
      pointer(paper, "pointermove", 145, 120);
      expect(moveBy.mock.calls).toEqual([[10, 4]]);
    },
  );

  it("ignores other pointers and stops when the primary mouse button is released", async () => {
    const { paper, moveBy } = setup();
    pointer(paper, "pointerdown");
    pointer(paper, "pointermove", 130, 130, { pointerId: 2 });
    pointer(paper, "pointerup", 130, 130, { pointerId: 2 });
    expect(moveBy).not.toHaveBeenCalled();
    pointer(paper, "pointermove", 110, 105);
    await act(async () => {});
    pointer(paper, "pointermove", 125, 125, { buttons: 0 });
    pointer(paper, "pointermove", 135, 135);
    expect(moveBy.mock.calls).toEqual([[10, 5]]);
  });

  it("keeps touch gestures, wheel scrolling, the scrollbar and right clicks native", () => {
    const { paper, capture, moveBy } = setup();
    expect(
      pointer(paper, "pointerdown", 100, 100, { pointerType: "touch" })
        .defaultPrevented,
    ).toBe(false);
    expect(
      pointer(paper, "pointerdown", 100, 100, { button: 2 }).defaultPrevented,
    ).toBe(false);
    Object.defineProperties(paper, {
      offsetWidth: { value: 320 },
      clientWidth: { value: 305 },
      offsetHeight: { value: 500 },
      clientHeight: { value: 500 },
    });
    expect(pointer(paper, "pointerdown", 315, 100).defaultPrevented).toBe(
      false,
    );
    const wheel = new WheelEvent("wheel", {
      deltaY: 100,
      cancelable: true,
      bubbles: true,
    });
    fireEvent(paper, wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    expect(moveBy).not.toHaveBeenCalled();
  });

  it("clears a gesture when leaving the end page", async () => {
    const { paper, moveBy, rerender } = setup();
    pointer(paper, "pointerdown");
    rerender(<Surface enabled={false} moveBy={moveBy} />);
    pointer(paper, "pointermove", 140, 130);
    expect(moveBy).not.toHaveBeenCalled();
    expect(pointer(paper, "pointerdown").defaultPrevented).toBe(false);
    await act(async () => {});
  });

  it("reports native move failures without retaining a stuck gesture", async () => {
    const error = new Error("window closed");
    const moveBy = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    render(<Surface moveBy={moveBy} onError={onError} />);
    const paper = screen.getByTestId("paper");
    paper.setPointerCapture = vi.fn();
    pointer(paper, "pointerdown");
    pointer(paper, "pointermove", 140, 130);
    await act(async () => {});
    expect(onError).toHaveBeenCalledWith(error);
    pointer(paper, "pointermove", 160, 160);
    expect(moveBy).toHaveBeenCalledOnce();
  });
});
