// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { TaskSheet } from "./TaskSheet";
import { emptyCoach } from "./CoachUI";
import { localDate } from "./DayPlan";
import type { PlanStep, State, Task } from "./paperTypes";

const task = (id: string): Task => ({
  id,
  title: `任务 ${id}`,
  due: null,
  category: "work",
  priority: "medium",
  completed: false,
  nextAction: {
    id: `step-${id}`,
    text: `步骤 ${id}`,
    completed: false,
    source: "user",
  },
  revision: 1,
  source: "user",
  updatedAt: Date.now(),
});
const step = (id: string, parent = "A"): PlanStep => ({
  id,
  taskId: parent,
  text: `动作 ${id}`,
  expectedResult: "明确结果",
  plannedSeconds: 1200,
  completed: false,
  revision: 3,
});
const data = (): State => ({
  tasks: [task("A")],
  sessions: [],
  notes: [],
  coach: emptyCoach,
  planning: {
    steps: [step("one"), step("two")],
    dayItems: [
      {
        id: "day-one",
        date: localDate(),
        taskId: "A",
        stepId: "one",
        order: 0,
        revision: 1,
        removedAt: null,
      },
    ],
  },
});
const setup = (
  state = data(),
  extra: { busy?: boolean; hasSession?: boolean } = {},
  allTasks = true,
) => {
  const props = {
    data: state,
    busy: false,
    hasSession: false,
    selectedTaskId: "A",
    choose: vi.fn().mockResolvedValue(undefined),
    selectTask: vi.fn(),
    edit: vi.fn(),
    complete: vi.fn().mockResolvedValue(undefined),
    completeStep: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };
  const view = render(<TaskSheet {...props} />);
  if (allTasks)
    fireEvent.click(screen.getByRole("button", { name: "全部任务" }));
  return { ...view, props };
};
const toggle = () => screen.getByRole("button", { name: /^任务 A/ });
const title = () => toggle().querySelector<HTMLElement>(".sheet-task-name")!;
const prepareStroke = (node: HTMLElement, width = 200) => {
  vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 100,
    left: 100,
    top: 100,
    right: 100 + width,
    bottom: 124,
    width,
    height: 24,
    toJSON: () => ({}),
  });
  const row = node.closest<HTMLElement>("[data-strike-row]")!;
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
    x: 80,
    y: 94,
    left: 80,
    top: 94,
    right: 360,
    bottom: 130,
    width: 280,
    height: 36,
    toJSON: () => ({}),
  });
  for (const surface of [node, row])
    Object.defineProperties(surface, {
      setPointerCapture: { value: vi.fn(), configurable: true },
      releasePointerCapture: { value: vi.fn(), configurable: true },
      hasPointerCapture: { value: () => true, configurable: true },
    });
  return node;
};
const prepareTitle = () => prepareStroke(title());
const stepTitle = (text: string) =>
  screen.getByText(text, { selector: ".sheet-step-name .pencil-line" })
    .parentElement!;
const point = (
  x: number,
  y = 112,
  extra: PointerEventInit = {},
): PointerEventInit => ({
  pointerId: 1,
  pointerType: "mouse",
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX: x,
  clientY: y,
  ...extra,
});
const stroke = async (
  node: HTMLElement,
  from: PointerEventInit,
  to: PointerEventInit,
  cancel = false,
) => {
  await act(async () => {
    fireEvent.pointerDown(node, from);
    fireEvent.pointerMove(node, {
      ...from,
      clientX: ((from.clientX ?? 0) + (to.clientX ?? 0)) / 2,
      clientY: ((from.clientY ?? 0) + (to.clientY ?? 0)) / 2,
    });
    fireEvent.pointerMove(node, to);
    if (cancel) fireEvent.pointerCancel(node, to);
    fireEvent.pointerUp(node, { ...to, buttons: 0 });
  });
};

beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Paper shared daily queue", () => {
  it("defaults to ordered individual steps and keeps completed rows in place when plans update", () => {
    const state = data();
    const first = state.planning!.dayItems[0];
    first.order = 2;
    state.planning!.dayItems.push({
      ...first,
      id: "day-two",
      stepId: "two",
      order: 0,
    });
    const { container, props, rerender } = setup(state, {}, false);
    const names = () =>
      Array.from(
        container.querySelectorAll(".sheet-queue-item .sheet-task-name"),
        (node) => node.textContent,
      );
    expect(screen.getByRole("heading", { name: "今日步骤" })).toBeTruthy();
    expect(names()).toEqual(["动作 two", "动作 one"]);
    const updated = structuredClone(state);
    updated.planning!.steps[1].completed = true;
    updated.planning!.steps[1].revision += 1;
    rerender(<TaskSheet {...props} data={updated} />);
    expect(names()).toEqual(["动作 two", "动作 one"]);
    expect(
      container
        .querySelector('[data-plan-item-id="day-two"]')
        ?.getAttribute("data-completed"),
    ).toBe("true");
    expect(updated.tasks[0].completed).toBe(false);
    updated.planning!.dayItems[0].date = "2099-01-01";
    rerender(<TaskSheet {...props} data={structuredClone(updated)} />);
    expect(names()).toEqual(["动作 two"]);
  });

  it("expands without selecting and prepares only the clicked day's exact step and item", async () => {
    const { props } = setup(data(), {}, false);
    fireEvent.click(screen.getByRole("button", { name: /^动作 one/ }));
    expect(props.choose).not.toHaveBeenCalled();
    expect(props.completeStep).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Do this：动作 one" }),
      ),
    );
    expect(props.choose).toHaveBeenCalledExactlyOnceWith(
      props.data.planning!.steps[0],
      props.data.planning!.dayItems[0],
    );
    expect(props.selectTask).not.toHaveBeenCalled();
    expect(props.complete).not.toHaveBeenCalled();
  });

  it("crosses a queue step without completing its parent or selecting it", async () => {
    const { props, container } = setup(data(), {}, false);
    const node = prepareStroke(
      container.querySelector<HTMLElement>(
        ".sheet-queue-item .sheet-task-name",
      )!,
    );
    await stroke(node, point(110), point(170));
    expect(props.completeStep).toHaveBeenCalledExactlyOnceWith(
      props.data.planning!.steps[0],
    );
    expect(props.complete).not.toHaveBeenCalled();
    expect(props.choose).not.toHaveBeenCalled();
  });

  it("offers unplanned steps on an empty day while leaving future arrangements out of that list", async () => {
    const state = data();
    state.planning!.dayItems[0].date = "2099-01-01";
    const { props } = setup(state, {}, false);
    fireEvent.click(screen.getByText("未安排事项 · 1"));
    expect(screen.queryByRole("button", { name: /^动作 one/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^动作 two/ }));
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Do this：动作 two" }),
      ),
    );
    expect(props.choose).toHaveBeenCalledExactlyOnceWith(
      state.planning!.steps[1],
      undefined,
    );
    expect(state.planning!.dayItems[0].date).toBe("2099-01-01");
    fireEvent.click(screen.getByRole("button", { name: "全部任务" }));
    expect(toggle()).toBeTruthy();
  });

  it("shows common metadata only in expanded detail and locks a queue during a session", () => {
    const state = data();
    state.tasks[0].priority = "high";
    state.tasks[0].due = "等资料齐了";
    state.tasks[0].dueDate = "2030-03-08";
    const { props } = setup(state, { hasSession: true }, false);
    expect(screen.queryByText("截止日期：2030-03-08")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^动作 one/ }));
    expect(screen.getByText("优先级：高")).toBeTruthy();
    expect(screen.getByText("截止备注：等资料齐了")).toBeTruthy();
    expect(screen.getByText("截止日期：2030-03-08")).toBeTruthy();
    expect(screen.getByText("做到：明确结果")).toBeTruthy();
    const choose = screen.getByRole("button", {
      name: "Do this：动作 one",
    }) as HTMLButtonElement;
    expect(choose.disabled).toBe(true);
    fireEvent.click(choose);
    expect(props.choose).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: "完成步骤：动作 one",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("TaskSheet explicit selection and paper gestures", () => {
  it("expands on a title click and selects only through the separate step button", async () => {
    const { props } = setup();
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByText("动作 one"));
    expect(props.choose).not.toHaveBeenCalled();
    expect(props.selectTask).not.toHaveBeenCalled();
    expect(props.complete).not.toHaveBeenCalled();
    expect(props.completeStep).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Do this：动作 one" }).textContent,
    ).toBe("Do this");
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Do this：动作 one" }),
      ),
    );
    expect(props.choose).toHaveBeenCalledExactlyOnceWith(
      props.data.planning!.steps[0],
      props.data.planning!.dayItems[0],
    );
  });

  it("keeps simple tasks compact and exposes Do this only after expanding", async () => {
    const state = data();
    state.tasks = [{ ...task("A"), nextAction: null }, task("B")];
    state.planning = { steps: [step("only", "B")], dayItems: [] };
    const { props } = setup(state);
    expect(screen.queryByRole("button", { name: /^Do this：/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^任务 A/ }));
    fireEvent.click(screen.getByRole("button", { name: "Do this：任务 A" }));
    expect(props.selectTask).toHaveBeenCalledExactlyOnceWith(state.tasks[0]);
    fireEvent.click(screen.getByRole("button", { name: /^任务 B/ }));
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Do this：动作 only" }),
      ),
    );
    expect(props.choose).toHaveBeenCalledExactlyOnceWith(
      state.planning.steps[0],
      undefined,
    );
  });

  it.each([false, true])(
    "crosses out completed single-action details and prevents reselection with formal step=%s",
    (formal) => {
      const state = data();
      state.tasks[0].nextAction!.completed = true;
      state.planning!.steps = formal
        ? [{ ...step("step-A"), completed: true }]
        : [];
      const { props } = setup(state);
      fireEvent.click(toggle());
      expect(
        screen.queryByRole("button", {
          name: formal ? "Do this：动作 step-A" : "Do this：任务 A",
        }),
      ).toBeNull();
      expect(props.choose).not.toHaveBeenCalled();
      expect(props.selectTask).not.toHaveBeenCalled();
      if (formal)
        expect(
          (
            screen.getByRole("button", {
              name: "撤销步骤完成：动作 step-A",
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(false);
      const detail = screen
        .getByText(formal ? "动作 step-A" : "步骤 A", {
          selector: formal
            ? ".sheet-step .pencil-line"
            : ".sheet-simple-detail .pencil-line",
        })
        .closest(formal ? ".sheet-step" : ".sheet-simple-detail");
      expect(detail?.classList.contains("is-done")).toBe(true);
      expect(detail?.textContent).toContain("已划掉");
      expect(state.tasks[0].completed).toBe(false);
    },
  );

  it("keeps completed tasks in source order and passes the current task to undo", async () => {
    const state = data();
    state.tasks = [
      task("A"),
      { ...task("B"), completed: true, revision: 4 },
      task("C"),
    ];
    const { container, props, rerender } = setup(state);
    const order = () =>
      Array.from(
        container.querySelectorAll(".sheet-task-name"),
        (node) => node.textContent,
      );
    expect(order()).toEqual(["任务 A", "任务 B", "任务 C"]);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "撤销完成：任务 B" })),
    );
    expect(props.complete).toHaveBeenCalledExactlyOnceWith(state.tasks[1]);
    const restored = {
      ...state,
      tasks: state.tasks.map((t) =>
        t.id === "B" ? { ...t, completed: false, revision: 5 } : t,
      ),
    };
    rerender(<TaskSheet {...props} data={restored} />);
    expect(order()).toEqual(["任务 A", "任务 B", "任务 C"]);
    fireEvent.click(screen.getByRole("button", { name: /^任务 B/ }));
    expect(
      screen.getByRole("button", { name: "整个任务完成了：任务 B" }),
    ).toBeTruthy();
  });

  it("completes and undoes only the requested step through its checkbox", async () => {
    const { props, rerender } = setup();
    fireEvent.click(toggle());
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "完成步骤：动作 one" }),
      ),
    );
    expect(props.completeStep).toHaveBeenCalledExactlyOnceWith(
      props.data.planning!.steps[0],
    );
    expect(props.complete).not.toHaveBeenCalled();
    expect(props.choose).not.toHaveBeenCalled();
    const updated = structuredClone(props.data);
    updated.planning!.steps[0].completed = true;
    updated.planning!.steps[0].revision += 1;
    rerender(<TaskSheet {...props} data={updated} />);
    expect(
      stepTitle("动作 one")
        .closest(".sheet-step")
        ?.classList.contains("is-done"),
    ).toBe(true);
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "撤销步骤完成：动作 one" }),
      ),
    );
    expect(props.completeStep).toHaveBeenLastCalledWith(
      updated.planning!.steps[0],
    );
    expect(props.completeStep).toHaveBeenCalledTimes(2);
    expect(props.complete).not.toHaveBeenCalled();
    expect(updated.tasks[0].completed).toBe(false);
  });

  it.each([false, true])(
    "disables step completion and undo when the parent is complete (step done=%s)",
    async (completed) => {
      const current = data();
      current.tasks[0].completed = true;
      current.planning!.steps[0].completed = completed;
      const { props } = setup(current);
      fireEvent.click(toggle());
      const control = screen.getByRole("button", {
        name: `${completed ? "撤销步骤完成" : "完成步骤"}：动作 one`,
      }) as HTMLButtonElement;
      expect(control.disabled).toBe(true);
      fireEvent.click(control);
      await stroke(
        prepareStroke(stepTitle("动作 one")),
        point(130),
        point(260),
      );
      expect(props.completeStep).not.toHaveBeenCalled();
      expect(props.complete).not.toHaveBeenCalled();
    },
  );

  it.each([{ busy: true }, { hasSession: true }])(
    "blocks selection, completion and strokes while locked by %j",
    async (lock) => {
      const { props } = setup(data(), lock);
      fireEvent.click(toggle());
      const choose = screen.getByRole("button", {
        name: "Do this：动作 one",
      }) as HTMLButtonElement;
      const complete = screen.getByRole("button", {
        name: "整个任务完成了：任务 A",
      }) as HTMLButtonElement;
      expect(choose.disabled).toBe(true);
      expect(complete.disabled).toBe(true);
      const stepComplete = screen.getByRole("button", {
        name: "完成步骤：动作 one",
      }) as HTMLButtonElement;
      expect(stepComplete.disabled).toBe(true);
      fireEvent.click(choose);
      fireEvent.click(complete);
      fireEvent.click(stepComplete);
      await stroke(prepareTitle(), point(110), point(290));
      await stroke(
        prepareStroke(stepTitle("动作 one")),
        point(110),
        point(290),
      );
      expect(props.choose).not.toHaveBeenCalled();
      expect(props.complete).not.toHaveBeenCalled();
      expect(props.completeStep).not.toHaveBeenCalled();
    },
  );

  it("does not complete on an ordinary click but still expands the title", async () => {
    const { props } = setup();
    const node = prepareTitle();
    await stroke(node, point(150), point(152));
    fireEvent.click(node);
    expect(props.complete).not.toHaveBeenCalled();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it.each([
    ["short horizontal movement", point(110), point(126), false],
    ["vertical movement", point(110), point(118, 150), false],
    [
      "large vertical drift during a long stroke",
      point(110),
      point(290, 180),
      false,
    ],
    ["cancelled pointer", point(110), point(290), true],
    [
      "touch input",
      point(110, 112, { pointerType: "touch" }),
      point(290, 112, { pointerType: "touch" }),
      false,
    ],
    [
      "right mouse button",
      point(110, 112, { button: 2, buttons: 2 }),
      point(290, 112, { button: 2, buttons: 2 }),
      false,
    ],
  ] as const)("does not complete for %s", async (_label, from, to, cancel) => {
    const { props } = setup();
    await stroke(prepareTitle(), from, to, cancel);
    expect(props.complete).not.toHaveBeenCalled();
    expect(props.choose).not.toHaveBeenCalled();
  });

  it("completes once for a horizontal mouse stroke and suppresses its trailing click", async () => {
    const { props } = setup();
    const node = prepareTitle();
    await stroke(node, point(110), point(290));
    fireEvent.click(node, { detail: 1 });
    expect(props.complete).toHaveBeenCalledExactlyOnceWith(props.data.tasks[0]);
    expect(props.choose).not.toHaveBeenCalled();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("accepts a gently curved step stroke without touching either end of the text", async () => {
    const { props } = setup();
    fireEvent.click(toggle());
    const node = prepareStroke(stepTitle("动作 one"));
    await act(async () => {
      fireEvent.pointerDown(node, point(130));
      fireEvent.pointerMove(node, point(180, 118));
      fireEvent.pointerMove(node, point(260, 114));
      fireEvent.pointerUp(node, point(260, 114, { buttons: 0 }));
    });
    fireEvent.click(node, { detail: 1 });
    expect(props.completeStep).toHaveBeenCalledExactlyOnceWith(
      props.data.planning!.steps[0],
    );
    expect(props.complete).not.toHaveBeenCalled();
    expect(props.choose).not.toHaveBeenCalled();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("allows a short title to be crossed with a proportionate stroke", async () => {
    const { props } = setup();
    await stroke(prepareStroke(title(), 20), point(102), point(118));
    expect(props.complete).toHaveBeenCalledExactlyOnceWith(props.data.tasks[0]);
  });

  it.each(["blank", "number", "progress"])(
    "accepts a short stroke starting on task-row %s",
    async (start) => {
      const { props } = setup();
      prepareTitle();
      const row = toggle();
      const surface =
        start === "number"
          ? row.querySelector<HTMLElement>(".sheet-number")!
          : start === "progress"
            ? row.querySelector<HTMLElement>(".sheet-count")!
            : row;
      await stroke(surface, point(84, 97), point(126, 99));
      fireEvent.click(surface, { detail: 1 });
      expect(props.complete).toHaveBeenCalledExactlyOnceWith(
        props.data.tasks[0],
      );
      expect(props.completeStep).not.toHaveBeenCalled();
      expect(props.choose).not.toHaveBeenCalled();
      expect(row.getAttribute("aria-expanded")).toBe("false");
    },
  );

  it.each(["blank", "metadata"])(
    "completes only the step when a short stroke starts in its %s",
    async (start) => {
      const { props } = setup();
      fireEvent.click(toggle());
      const node = prepareStroke(stepTitle("动作 one"));
      const row = node.closest<HTMLElement>("[data-strike-row]")!;
      const surface =
        start === "metadata"
          ? row.querySelector<HTMLElement>(".sheet-step-meta")!
          : row;
      await stroke(surface, point(310, 127), point(353, 129));
      fireEvent.click(surface, { detail: 1 });
      expect(props.completeStep).toHaveBeenCalledExactlyOnceWith(
        props.data.planning!.steps[0],
      );
      expect(props.complete).not.toHaveBeenCalled();
      expect(props.choose).not.toHaveBeenCalled();
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
    },
  );

  it.each(["Do this", "checkbox", "arrow"])(
    "does not interpret a drag starting on the %s control as a completion stroke",
    async (control) => {
      const { props } = setup();
      fireEvent.click(toggle());
      prepareTitle();
      prepareStroke(stepTitle("动作 one"));
      const surface =
        control === "arrow"
          ? toggle().querySelector<HTMLElement>("[data-strike-ignore]")!
          : screen.getByRole("button", {
              name:
                control === "Do this"
                  ? "Do this：动作 one"
                  : "完成步骤：动作 one",
            });
      await stroke(surface, point(110), point(180));
      expect(props.complete).not.toHaveBeenCalled();
      expect(props.completeStep).not.toHaveBeenCalled();
      expect(props.choose).not.toHaveBeenCalled();
    },
  );

  it("does not complete either step when a vertical drag crosses their rows", async () => {
    const { props } = setup();
    fireEvent.click(toggle());
    const first = prepareStroke(stepTitle("动作 one")).closest<HTMLElement>(
      "[data-strike-row]",
    )!;
    const second = prepareStroke(stepTitle("动作 two")).closest<HTMLElement>(
      "[data-strike-row]",
    )!;
    await act(async () => {
      fireEvent.pointerDown(first, point(145));
      fireEvent.pointerMove(first, point(146, 164));
      fireEvent.pointerMove(second, point(150, 195));
      // A real pointer capture routes release back to the row where dragging began.
      fireEvent.pointerUp(first, point(150, 195, { buttons: 0 }));
    });
    expect(props.completeStep).not.toHaveBeenCalled();
    expect(props.complete).not.toHaveBeenCalled();
  });

  it("cancels a step stroke when its revision changes before release", async () => {
    const { props, rerender } = setup();
    fireEvent.click(toggle());
    const node = prepareStroke(stepTitle("动作 one"));
    fireEvent.pointerDown(node, point(130));
    fireEvent.pointerMove(node, point(260));
    const updated = structuredClone(props.data);
    updated.planning!.steps[0].revision += 1;
    rerender(<TaskSheet {...props} data={updated} />);
    await act(async () =>
      fireEvent.pointerUp(node, point(260, 112, { buttons: 0 })),
    );
    expect(props.completeStep).not.toHaveBeenCalled();
    expect(props.complete).not.toHaveBeenCalled();
  });

  it("cancels a row stroke when its scroll container moves before release", async () => {
    const { props } = setup();
    const node = prepareTitle();
    const row = node.closest<HTMLElement>("[data-strike-row]")!;
    fireEvent.pointerDown(row, point(84, 97));
    fireEvent.pointerMove(row, point(140, 99));
    fireEvent.scroll(screen.getByRole("region", { name: "任务清单" }));
    await act(async () =>
      fireEvent.pointerUp(row, point(150, 100, { buttons: 0 })),
    );
    expect(props.complete).not.toHaveBeenCalled();
    expect(props.completeStep).not.toHaveBeenCalled();
  });

  it("keeps the live stroke while saving and prevents another gesture from submitting twice", async () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      }),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn(() => {
        frame = undefined;
      }),
    );
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { props, rerender } = setup();
    props.completeStep.mockImplementation(() => pending);
    fireEvent.click(toggle());
    const node = prepareStroke(stepTitle("动作 one"));
    await stroke(node, point(130), point(260));
    act(() => frame?.(0));
    const path = node.querySelector("path")!;
    expect(path.getAttribute("d")).toContain("M ");
    fireEvent.lostPointerCapture(node, point(260));
    expect(path.getAttribute("d")).toContain("M ");
    await stroke(node, point(130), point(260));
    expect(props.completeStep).toHaveBeenCalledTimes(1);
    rerender(<TaskSheet {...props} busy />);
    expect(path.getAttribute("d")).toContain("M ");
    const updated = structuredClone(props.data);
    updated.planning!.steps[0].completed = true;
    updated.planning!.steps[0].revision += 1;
    await act(async () => {
      rerender(<TaskSheet {...props} data={updated} />);
      release();
      await pending;
    });
    expect(path.getAttribute("d")).toBe("");
    expect(node.closest(".sheet-step")?.classList.contains("is-done")).toBe(
      true,
    );
    expect(props.completeStep).toHaveBeenCalledTimes(1);
  });

  it("rechecks an active session arriving before pointer release", async () => {
    const { props, rerender } = setup();
    const node = prepareTitle();
    fireEvent.pointerDown(node, point(110));
    fireEvent.pointerMove(node, point(290));
    rerender(<TaskSheet {...props} hasSession />);
    await act(async () =>
      fireEvent.pointerUp(node, point(290, 112, { buttons: 0 })),
    );
    expect(props.complete).not.toHaveBeenCalled();
  });
});
