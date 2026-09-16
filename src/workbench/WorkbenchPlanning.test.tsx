// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import Workbench from "./Workbench";
import { dateKey, shiftDay } from "./model";
import type { DayItem, State } from "../paper/paperTypes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("./useDailyRecords", () => ({ useDailyRecords: () => ({}) }));
vi.mock("./CoachChat", () => ({
  default: ({
    selected,
    collapsed,
    onToggleCollapsed,
    prefill,
  }: {
    selected?: { step?: { id: string }; item?: { date: string } };
    collapsed?: boolean;
    onToggleCollapsed?: () => void;
    prefill?: { text: string };
  }) => (
    <>
      <div data-testid="coach-scope">
        {selected?.step?.id} / {selected?.item?.date}
      </div>
      <button onClick={onToggleCollapsed}>
        {collapsed ? "展开 Coach" : "收起 Coach"}
      </button>
      <div data-testid="coach-prefill">{prefill?.text}</div>
    </>
  ),
}));
const today = dateKey();
const makeItem = (id: string, date: string): DayItem => ({
  id,
  taskId: "task",
  stepId: "step",
  date,
  order: 0,
  revision: 1,
  removedAt: null,
  startMinute: 540,
  durationMinutes: 30,
});

it("expands a collapsed Coach for the budget discussion entry without submitting a request", async () => {
  render(<Workbench />);
  fireEvent.click(await screen.findByRole("button", { name: "收起 Coach" }));
  expect(
    document.querySelector(".wk-app")!.classList.contains("wk-coach-collapsed"),
  ).toBe(true);
  const budget = document.querySelector(".wk-capacity")!;
  fireEvent.click(budget.querySelector("summary")!);
  fireEvent.click(screen.getByRole("button", { name: "请 Coach 帮我取舍" }));
  expect(
    document.querySelector(".wk-app")!.classList.contains("wk-coach-collapsed"),
  ).toBe(false);
  expect(screen.getByTestId("coach-prefill").textContent).toContain(
    `请根据 ${today} 的可投入时间`,
  );
  expect(writes).toHaveLength(0);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([command]) => command === "workbench_send"),
  ).toBe(false);
});
let data: State;
let writes: { action: string; input: Record<string, any> }[];
let handleWrite: (action: string, input: Record<string, any>) => unknown;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  data = {
    tasks: [
      {
        id: "task",
        title: "核对周报",
        due: null,
        category: "work",
        priority: "high",
        completed: false,
        nextAction: null,
        revision: 1,
        source: "user",
        updatedAt: 1,
      },
    ],
    planning: {
      steps: [
        {
          id: "step",
          taskId: "task",
          text: "继续核对数字",
          expectedResult: null,
          plannedSeconds: 900,
          completed: false,
          revision: 1,
        },
      ],
      dayItems: [
        makeItem("old-executed", shiftDay(today, -2)),
        makeItem("old-unexecuted", shiftDay(today, -1)),
        makeItem("future", shiftDay(today, 4)),
      ],
      sessionLinks: [
        {
          sessionId: "past-session",
          dayItemId: "old-executed",
          planDate: shiftDay(today, -2),
        },
      ],
    },
    sessions: [],
    notes: [],
    coach: {
      blocks: [],
      proposals: [],
      analysisStatus: "",
      settings: { enabled: false, hermes: false, revision: 1 },
      activities: [],
    },
  };
  writes = [];
  handleWrite = () => ({ remainingActiveCount: 1 });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "workbench_storage_scope")
      return { scopeId: "test-data-a" };
    if (command !== "paper_execute") return {};
    const { action, input } = args as {
      action: string;
      input: Record<string, any>;
    };
    if (action === "get_state") return { state: structuredClone(data) };
    if (action === "get_day_capacity")
      return {
        capacity: {
          availableMinutes: null,
          reservedMinutes: 0,
          unestimatedCount: 0,
          calendarOccupiedMinutes: 0,
          overlapPairs: [],
          unavailableConflicts: [],
          overBudget: null,
          fullyEstimated: true,
        },
      };
    writes.push({ action, input: structuredClone(input) });
    return handleWrite(action, input);
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(invoke).mockReset();
});

async function openOld() {
  await screen.findByText("旧安排");
  const outer = screen.getByText("旧安排").closest("details")!;
  expect(outer.open).toBe(false);
  fireEvent.click(outer.querySelector("summary")!);
  const group = within(outer).getByText("继续核对数字").closest("details")!;
  expect(group.open).toBe(false);
  fireEvent.click(group.querySelector("summary")!);
  return group;
}

it("separates grouped old arrangements from unplanned and continues the same step into today", async () => {
  handleWrite = (action) => {
    expect(action).toBe("continue_plan_items");
    const target = makeItem("today-item", today);
    data.planning!.dayItems.push(target);
    data
      .planning!.dayItems.filter((item) => item.date < today)
      .forEach((item) => {
        item.resolvedAt = 1;
      });
    return { item: target };
  };
  render(<Workbench />);
  await openOld();
  expect(screen.getByText("已重新安排")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "讨论这一步" }));
  expect(screen.getByTestId("coach-scope").textContent).toContain(
    shiftDay(today, -1),
  );
  fireEvent.click(screen.getByRole("button", { name: "今天继续" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({
    action: "continue_plan_items",
    input: {
      taskId: "task",
      stepId: "step",
      date: today,
      expectedTaskRevision: 1,
      expectedStepRevision: 1,
      items: [
        { id: "old-executed", revision: 1 },
        { id: "old-unexecuted", revision: 1 },
      ],
    },
  });
  await waitFor(() =>
    expect(screen.getByTestId("coach-scope").textContent).toBe(
      `step / ${today}`,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "待安排" }));
  expect(screen.getByText("这里暂时没有待安排的任务")).toBeTruthy();
  expect(screen.queryByText("旧安排")).toBeNull();
});

it("previews all and only unexecuted arrangements, then reports the retained executed plan accurately", async () => {
  render(<Workbench />);
  await openOld();
  fireEvent.click(screen.getByRole("button", { name: "放回待安排" }));
  const preview = screen.getByRole("dialog");
  const list = within(preview).getByRole("list", { name: "将取消的安排" });
  expect(list.querySelectorAll("li")).toHaveLength(2);
  expect(list.textContent).toContain(shiftDay(today, -1));
  expect(list.textContent).toContain(shiftDay(today, 4));
  expect(list.textContent).not.toContain(shiftDay(today, -2));
  expect(preview.textContent).toContain("已有执行关系的1 条有效安排会保留");
  expect(writes).toHaveLength(0);
  fireEvent.click(
    within(preview).getByRole("button", { name: "确认取消 2 条安排" }),
  );
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({
    action: "cancel_plan_items",
    input: {
      scope: "unexecuted",
      items: [
        { id: "old-unexecuted", revision: 1 },
        { id: "future", revision: 1 },
      ],
    },
  });
  await screen.findByText(
    "已取消所选安排，仍有 1 条有效安排；步骤未放回待安排。",
  );
  expect(
    writes.some((write) => /create_task|update_task/.test(write.action)),
  ).toBe(false);
});

it("cancels only the selected arrangement and retries a lost response with identical id and parameters", async () => {
  handleWrite = () => {
    if (writes.length === 1) {
      data.tasks[0].revision = 2;
      data.planning!.dayItems[0].revision = 2;
      throw Error("连接中断，尚未收到保存响应");
    }
    return { remainingActiveCount: 2 };
  };
  render(<Workbench />);
  const group = await openOld();
  fireEvent.click(
    within(group).getAllByRole("button", { name: "取消本次安排" })[0],
  );
  const preview = screen.getByRole("dialog");
  fireEvent.click(
    within(preview).getByRole("button", { name: "确认取消 1 条安排" }),
  );
  await within(preview).findByRole("button", { name: "核实并重试" });
  expect(writes[0].input.scope).toBe("selected");
  expect(writes[0].input.items).toEqual([{ id: "old-executed", revision: 1 }]);
  // Closing the sheet does not discard the request owned by the parent workbench.
  fireEvent.click(within(preview).getByRole("button", { name: "返回" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "核实并重试" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual(writes[0]);
  await screen.findByText(
    "已取消所选安排，仍有 2 条有效安排；步骤未放回待安排。",
  );
});

it("restores a lost plan operation after restart without recomputing versions or affected items", async () => {
  handleWrite = () => {
    if (writes.length === 1) {
      data.tasks[0].revision = 2;
      data.planning!.dayItems[0].revision = 2;
      throw Error("保存响应丢失");
    }
    return { remainingActiveCount: 2 };
  };
  const view = render(<Workbench />);
  const group = await openOld();
  fireEvent.click(
    within(group).getAllByRole("button", { name: "取消本次安排" })[0],
  );
  fireEvent.click(screen.getByRole("button", { name: "确认取消 1 条安排" }));
  await within(screen.getByRole("dialog")).findByRole("button", {
    name: "核实并重试",
  });
  const first = structuredClone(writes[0]);
  view.unmount();
  render(<Workbench />);
  fireEvent.click(await screen.findByRole("button", { name: "核实并重试" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual(first);
  await screen.findByText("操作已核实，计划和记录已刷新。");
});

it("offers recovery for an uncertain editor save after restarting the entire workbench", async () => {
  handleWrite = () => {
    if (writes.length === 1) throw Error("保存响应丢失");
    return {};
  };
  const view = render(<Workbench />);
  await screen.findByText("旧安排");
  fireEvent.click(screen.getByRole("button", { name: "待安排" }));
  fireEvent.click(screen.getByRole("button", { name: "添加任务" }));
  fireEvent.change(screen.getByLabelText("任务名称"), {
    target: { value: "重启后核实的任务" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
  await screen.findByRole("button", { name: "核实并重试" });
  const first = structuredClone(writes[0]);
  view.unmount();
  render(<Workbench />);
  fireEvent.click(
    await screen.findByRole("button", { name: /核实保存：重启后核实的任务/ }),
  );
  expect((screen.getByLabelText("任务名称") as HTMLInputElement).value).toBe(
    "重启后核实的任务",
  );
  fireEvent.click(screen.getByRole("button", { name: "核实并重试" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual(first);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    screen.queryByRole("button", { name: /核实保存：重启后核实的任务/ }),
  ).toBeNull();
});

it("keeps plan mutations disabled until the data-directory storage scope is available", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let resolveScope!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(async (command, args) =>
    command === "workbench_storage_scope"
      ? new Promise((resolve) => {
          resolveScope = resolve;
        })
      : original(command, args),
  );
  render(<Workbench />);
  await openOld();
  expect(
    (screen.getByRole("button", { name: "今天继续" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "今天继续" }));
  expect(writes).toHaveLength(0);
  resolveScope({ scopeId: "test-data-a" });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "今天继续" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
});

it("shows the latest cue for the selected step in its task details", async () => {
  data.planning!.dayItems = [makeItem("today-item", today)];
  const session = (
    id: string,
    stepId: string,
    endedAt: number,
    resumeCue: string,
  ) => ({
    id,
    taskId: "task",
    taskTitle: "核对周报",
    action: {
      id: stepId,
      text: "继续核对数字",
      completed: false,
      source: "user",
    },
    kind: "focus",
    status: "finished",
    revision: 1,
    plannedSeconds: 900,
    elapsedSeconds: 500,
    lastResumedAt: null,
    startedAt: endedAt - 500,
    endedAt,
    pauseCount: 0,
    resumeCue,
    feedback: null,
  });
  data.sessions = [
    session("session-a1", "step", 1000, "已过时的提示"),
    session("session-b", "other-step", 2000, "另一步骤的提示"),
    session("session-a2", "step", 3000, "从第三行的原始数据继续"),
  ];
  render(<Workbench />);
  fireEvent.click(await screen.findByRole("button", { name: "继续核对数字" }));
  const cue = screen.getByText("从第三行的原始数据继续");
  expect(cue.closest(".wk-step-cue")?.getAttribute("data-session-id")).toBe(
    "session-a2",
  );
  expect(screen.queryByText("已过时的提示")).toBeNull();
  expect(screen.queryByText("另一步骤的提示")).toBeNull();
});

it("opens the notes workspace without day views and returns to a linked task's visible details", async () => {
  data.planning!.dayItems = [makeItem("future", shiftDay(today, 4))];
  data.notes = [
    {
      id: "note",
      text: "待核对的数字来源",
      createdAt: 1000,
      organization: "linked",
      linkedTaskId: "task",
      revision: 2,
    },
  ];
  render(<Workbench />);
  fireEvent.click(await screen.findByRole("button", { name: "随手记整理" }));
  await screen.findByRole("region", { name: "随手记整理" });
  expect(screen.queryByRole("tablist", { name: "计划视图" })).toBeNull();
  expect(screen.queryByRole("button", { name: "今天" })).toBeNull();
  expect(screen.queryByRole("button", { name: "批量改期" })).toBeNull();
  expect(document.querySelector(".wk-capacity")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "全部" }));
  fireEvent.click(screen.getByRole("button", { name: "打开任务" }));
  expect(screen.getByTestId("coach-scope").textContent).toBe(
    `step / ${shiftDay(today, 4)}`,
  );
  expect(
    screen.getByRole("button", { name: "设为下一步并回到 Inky" }),
  ).toBeTruthy();
  expect(writes).toHaveLength(0);
});
