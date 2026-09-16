// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import AdjustmentCards from "./AdjustmentCards";
import type {
  AdjustmentAction,
  AdjustmentData,
  AdjustmentGroup,
} from "./model";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
const props = { id, streaming: false, onSaved: vi.fn() };
const mock = vi.mocked(invoke);
const target = {
  taskId: "task-uuid",
  stepId: "step-uuid",
  expectedTaskRevision: 3,
  expectedStepRevision: 2,
};
const fixture = (): AdjustmentData => {
  const task = {
    id: target.taskId,
    title: "本月报表",
    due: null,
    category: "work",
    priority: "medium",
    completed: false,
    nextAction: null,
    revision: 3,
    source: "user",
    updatedAt: 1,
  };
  const step = {
    id: target.stepId,
    taskId: task.id,
    text: "核对完整报表",
    expectedResult: null,
    plannedSeconds: 1500,
    completed: false,
    revision: 2,
  };
  const item = {
    id: "item-uuid",
    taskId: task.id,
    stepId: step.id,
    date: "2030-03-04",
    startMinute: 600,
    durationMinutes: 60,
    order: 0,
    revision: 4,
    removedAt: null,
  };
  const actions: AdjustmentAction[] = [
    {
      ...target,
      kind: "reschedule",
      itemId: item.id,
      expectedItemRevision: 4,
      date: "2030-03-05",
      startMinute: 660,
      durationMinutes: 45,
    },
    {
      ...target,
      kind: "narrow",
      text: "先核对第三行",
      expectedResult: "第三行与原始记录一致",
      plannedSeconds: 900,
      date: null,
      newStepId: "new-step-uuid",
    },
  ];
  return {
    batch: {
      id,
      revision: 1,
      createdAt: 1,
      groups: [
        {
          id: groupId,
          reason: "先核对一行，完整报表留到明天",
          actions,
          adoptedAt: null,
          before: { tasks: [task], steps: [step], dayItems: [item] },
          after: {
            tasks: [task],
            steps: [
              step,
              {
                ...step,
                id: "new-step-uuid",
                text: "先核对第三行",
                revision: 1,
              },
            ],
            dayItems: [
              {
                ...item,
                date: "2030-03-05",
                startMinute: 660,
                durationMinutes: 45,
                revision: 5,
              },
            ],
          },
        },
        {
          id: "other-group-uuid",
          reason: "取消另一项的时间预留",
          adoptedAt: null,
          actions: [
            {
              ...target,
              kind: "reservation",
              itemId: item.id,
              expectedItemRevision: 4,
              durationMinutes: null,
            },
          ],
          before: { tasks: [task], steps: [step], dayItems: [item] },
          after: {
            tasks: [task],
            steps: [step],
            dayItems: [
              {
                ...item,
                startMinute: null,
                durationMinutes: null,
                revision: 5,
              },
            ],
          },
        },
      ],
    },
  };
};
const requests = (action: string) =>
  mock.mock.calls
    .filter(([, args]) => args && "action" in args && args.action === action)
    .map(([, args]) => (args as { input: Record<string, any> }).input);
const getOnly = (data = fixture()) =>
  mock.mockImplementation(async () => structuredClone(data));
const selectFirst = async () =>
  fireEvent.click(
    await screen.findByRole("checkbox", { name: "选择调整组 1" }),
  );
const editFirst = async () => {
  await screen.findByRole("checkbox", { name: "选择调整组 1" });
  fireEvent.click(screen.getAllByRole("button", { name: "修改参数" })[0]);
};
afterEach(() => {
  cleanup();
  localStorage.clear();
  mock.mockReset();
  props.onSaved.mockClear();
  vi.restoreAllMocks();
});

it("previews readable changes without writing and adopts only explicitly chosen dependency groups", async () => {
  const data = fixture();
  mock.mockImplementation(async (_command, args) => {
    if (args && "action" in args && args.action === "adopt_plan_adjustment") {
      data.batch.revision++;
      data.batch.groups[0].adoptedAt = 10;
    }
    return structuredClone(data);
  });
  render(<AdjustmentCards {...props} />);
  await screen.findByText("先核对一行，完整报表留到明天", { exact: false });
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(screen.getByText("这 2 项改动一起采用，保持依赖关系。")).toBeTruthy();
  expect(screen.getByText("原步骤保留：核对完整报表")).toBeTruthy();
  expect(
    screen.getByText("改为：2030-03-05 · 11:00 · 预留 45 分钟"),
  ).toBeTruthy();
  expect(screen.getByText("取消预留与开始时刻，保留日期。")).toBeTruthy();
  expect(screen.getByLabelText("Coach 调整建议").textContent).not.toContain(
    "uuid",
  );
  expect(requests("adopt_plan_adjustment")).toHaveLength(0);
  await selectFirst();
  fireEvent.click(screen.getByRole("button", { name: "采用所选 1 组调整" }));
  await screen.findByText("调整 1 · 已采用");
  expect(requests("adopt_plan_adjustment")[0]).toEqual({
    batchId: id,
    expectedRevision: 1,
    groupIds: [groupId],
    requestId: expect.any(String),
  });
  expect(
    (screen.getByRole("checkbox", { name: "选择调整组 1" }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  expect(screen.getAllByRole("button", { name: "修改参数" })).toHaveLength(1);
  expect(props.onSaved).toHaveBeenCalledTimes(1);
});

it("saves only edited groups as a new candidate revision before a separate explicit adoption", async () => {
  const data = fixture();
  mock.mockImplementation(async (_command, args) => {
    if (args && "action" in args && args.action === "revise_plan_adjustment") {
      const input = args.input as { groups: AdjustmentGroup[] };
      data.batch.groups[0].actions = input.groups[0].actions;
      data.batch.groups[0].after.dayItems[0].date = "2030-03-07";
      data.batch.groups[0].after.dayItems[0].durationMinutes = 20;
      data.batch.revision = 2;
    }
    return structuredClone(data);
  });
  render(<AdjustmentCards {...props} />);
  await selectFirst();
  await editFirst();
  fireEvent.change(screen.getByLabelText("调整 1 动作 1 安排日期"), {
    target: { value: "2030-03-07" },
  });
  fireEvent.change(screen.getByLabelText("调整 1 动作 1 预留分钟"), {
    target: { value: "20" },
  });
  expect(
    (
      screen.getByRole("button", {
        name: "采用所选 1 组调整",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    screen.getByText("改为：2030-03-05 · 11:00 · 预留 45 分钟"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "保存参数并更新预览" }));
  await screen.findByText("改为：2030-03-07 · 11:00 · 预留 20 分钟");
  expect(requests("adopt_plan_adjustment")).toHaveLength(0);
  expect(props.onSaved).not.toHaveBeenCalled();
  const saved = requests("revise_plan_adjustment")[0];
  expect(saved.expectedRevision).toBe(1);
  expect(saved.groups).toHaveLength(1);
  expect(saved.groups[0].actions[0]).toEqual({
    ...fixture().batch.groups[0].actions[0],
    date: "2030-03-07",
    durationMinutes: 20,
  });
  expect(saved.groups[0].actions[1]).toEqual(
    fixture().batch.groups[0].actions[1],
  );
  fireEvent.click(screen.getByRole("button", { name: "采用所选 1 组调整" }));
  await waitFor(() =>
    expect(requests("adopt_plan_adjustment")).toHaveLength(1),
  );
  const adopted = requests("adopt_plan_adjustment")[0];
  expect(adopted.expectedRevision).toBe(2);
  expect(adopted.requestId).not.toBe(saved.requestId);
});

it("restores an uncertain adoption across remounts and retries the identical payload even if already adopted", async () => {
  const data = fixture();
  let attempts = 0;
  mock.mockImplementation(async (_command, args) => {
    if (args && "action" in args && args.action === "adopt_plan_adjustment") {
      data.batch.revision = 2;
      data.batch.groups[0].adoptedAt = 10;
      if (++attempts === 1) throw Error("响应丢失");
    }
    return structuredClone(data);
  });
  const view = render(<AdjustmentCards {...props} />);
  await selectFirst();
  fireEvent.click(screen.getByRole("button", { name: "采用所选 1 组调整" }));
  await screen.findByText("响应丢失");
  expect(
    (screen.getByRole("checkbox", { name: "选择调整组 2" }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  const saved = JSON.parse(
    localStorage.getItem(`inky-wb-adjust-${id}-pending`)!,
  );
  expect(saved.input).toEqual(requests("adopt_plan_adjustment")[0]);
  view.unmount();
  render(<AdjustmentCards {...props} />);
  await screen.findByText("调整 1 · 已采用");
  fireEvent.click(screen.getByRole("button", { name: "核实并重试原提交" }));
  await waitFor(() =>
    expect(requests("adopt_plan_adjustment")).toHaveLength(2),
  );
  expect(requests("adopt_plan_adjustment")[1]).toEqual(
    requests("adopt_plan_adjustment")[0],
  );
  await waitFor(() =>
    expect(localStorage.getItem(`inky-wb-adjust-${id}-pending`)).toBeNull(),
  );
});

it("locks uncertain parameter edits and restores their original revision and values on retry", async () => {
  const data = fixture();
  let attempts = 0;
  mock.mockImplementation(async (_command, args) => {
    if (args && "action" in args && args.action === "revise_plan_adjustment") {
      if (++attempts === 1) throw Error("连接中断");
      data.batch.revision = 2;
      data.batch.groups[0].actions = (
        args.input as { groups: AdjustmentGroup[] }
      ).groups[0].actions;
    }
    return structuredClone(data);
  });
  const view = render(<AdjustmentCards {...props} />);
  await selectFirst();
  await editFirst();
  fireEvent.change(screen.getByLabelText("调整 1 动作 2 安排日期"), {
    target: { value: "2030-03-08" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存参数并更新预览" }));
  await screen.findByText("连接中断");
  expect(
    screen.getByLabelText("调整 1 动作 2 安排日期").closest("fieldset")
      ?.disabled,
  ).toBe(true);
  view.unmount();
  render(<AdjustmentCards {...props} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "核实并重试原提交" }),
  );
  await waitFor(() =>
    expect(requests("revise_plan_adjustment")).toHaveLength(2),
  );
  expect(requests("revise_plan_adjustment")[1]).toEqual(
    requests("revise_plan_adjustment")[0],
  );
  expect(requests("revise_plan_adjustment")[1].groups[0].actions[1].date).toBe(
    "2030-03-08",
  );
  expect(requests("adopt_plan_adjustment")).toHaveLength(0);
});

it("keeps selection and edits after conflict without rebasing onto a reloaded candidate", async () => {
  const data = fixture();
  mock.mockImplementation(async (_command, args) => {
    if (args && "action" in args && args.action === "revise_plan_adjustment")
      throw Error("CONFLICT: 步骤已有更新");
    return structuredClone(data);
  });
  const view = render(<AdjustmentCards {...props} />);
  await selectFirst();
  await editFirst();
  fireEvent.change(screen.getByLabelText("调整 1 动作 1 安排日期"), {
    target: { value: "2030-03-09" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存参数并更新预览" }));
  await screen.findByText(/请让 Coach 读取最新计划后重新提出调整/);
  expect(localStorage.getItem(`inky-wb-adjust-${id}-pending`)).toBeNull();
  data.batch.revision = 7;
  fireEvent.click(screen.getByRole("button", { name: "重新读取候选" }));
  await act(async () => {});
  view.unmount();
  render(<AdjustmentCards {...props} />);
  const checkbox = await screen.findByRole("checkbox", {
    name: "选择调整组 1",
  });
  expect((checkbox as HTMLInputElement).checked).toBe(true);
  expect((checkbox as HTMLInputElement).disabled).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "采用所选 1 组调整",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  const draft = JSON.parse(localStorage.getItem(`inky-wb-adjust-${id}`)!);
  expect(draft.baseRevision).toBe(1);
  expect(draft.edits[groupId][0].date).toBe("2030-03-09");
  expect(
    (screen.getByLabelText("调整 1 动作 1 安排日期") as HTMLInputElement).value,
  ).toBe("2030-03-09");
  expect(requests("adopt_plan_adjustment")).toHaveLength(0);
});

it("validates required dates and minute bounds while allowing a narrow step to stay unplanned", async () => {
  getOnly();
  render(<AdjustmentCards {...props} />);
  await editFirst();
  expect(
    (screen.getByLabelText("调整 1 动作 2 安排日期") as HTMLInputElement).value,
  ).toBe("");
  fireEvent.change(screen.getByLabelText("调整 1 动作 1 安排日期"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存参数并更新预览" }));
  await screen.findByText("请填写有效的安排日期。");
  fireEvent.change(screen.getByLabelText("调整 1 动作 1 安排日期"), {
    target: { value: "2030-03-05" },
  });
  fireEvent.change(screen.getByLabelText("调整 1 动作 1 预留分钟"), {
    target: { value: "0" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存参数并更新预览" }));
  await screen.findByText(/预留时间请填写 1–1440/);
  expect(requests("revise_plan_adjustment")).toHaveLength(0);
});

it("does not send an operation when its pending request cannot be saved locally", async () => {
  getOnly();
  render(<AdjustmentCards {...props} />);
  await selectFirst();
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key.endsWith("-pending")) throw Error("quota");
    original.call(this, key, value);
  });
  fireEvent.click(screen.getByRole("button", { name: "采用所选 1 组调整" }));
  await screen.findByText(/无法保存待核实的请求，暂未发送/);
  expect(requests("adopt_plan_adjustment")).toHaveLength(0);
});

it("waits until streaming finishes before reading the persisted candidate", async () => {
  getOnly();
  const view = render(<AdjustmentCards {...props} streaming />);
  expect(mock).not.toHaveBeenCalled();
  expect(screen.getByText("正在整理调整建议…")).toBeTruthy();
  view.rerender(<AdjustmentCards {...props} />);
  await screen.findByRole("checkbox", { name: "选择调整组 1" });
  expect(requests("get_plan_adjustment")).toHaveLength(1);
});

it("shows continue and reorder changes using saved step names and exact dates", async () => {
  const data = fixture();
  const group = data.batch.groups[0];
  group.actions = [
    {
      ...target,
      kind: "continue",
      items: [{ id: "item-uuid", revision: 4 }],
      date: "2030-03-06",
    },
    {
      kind: "reorder",
      date: "2030-03-04",
      items: [
        { id: "second", revision: 1 },
        { id: "item-uuid", revision: 4 },
      ],
    },
  ];
  group.before.steps.push({
    ...group.before.steps[0],
    id: "second-step",
    text: "确认结论",
  });
  group.after.steps.push({
    ...group.before.steps[0],
    id: "second-step",
    text: "确认结论",
  });
  group.before.dayItems.push({
    ...group.before.dayItems[0],
    id: "second",
    stepId: "second-step",
    order: 1,
  });
  group.after.dayItems = [
    { ...group.before.dayItems[1], order: 0 },
    { ...group.before.dayItems[0], order: 1 },
  ];
  data.batch.groups = [group];
  getOnly(data);
  render(<AdjustmentCards {...props} />);
  await screen.findByText("继续到：2030-03-06");
  expect(screen.getByText("原来：核对完整报表 → 确认结论")).toBeTruthy();
  expect(screen.getByText("改为：确认结论 → 核对完整报表")).toBeTruthy();
  expect(
    within(screen.getByLabelText("Coach 调整建议")).getAllByRole("checkbox"),
  ).toHaveLength(1);
});

it("ignores an older read that arrives after adoption has succeeded", async () => {
  const old = fixture();
  const adopted = fixture();
  adopted.batch.revision = 2;
  adopted.batch.groups[0].adoptedAt = 100;
  let readCount = 0;
  let resolveRead!: (value: unknown) => void;
  mock.mockImplementation(async (_command, args) => {
    if (args && "action" in args && args.action === "adopt_plan_adjustment")
      return adopted;
    if (++readCount === 1) return old;
    return new Promise((resolve) => {
      resolveRead = resolve;
    });
  });
  render(<AdjustmentCards {...props} />);
  await selectFirst();
  fireEvent.click(screen.getByRole("button", { name: "重新读取候选" }));
  fireEvent.click(screen.getByRole("button", { name: "采用所选 1 组调整" }));
  await screen.findByText("调整 1 · 已采用");
  await act(async () => resolveRead(old));
  expect(screen.getByText("调整 1 · 已采用")).toBeTruthy();
  expect(screen.queryByText(/相关计划或候选已变化/)).toBeNull();
});

it.each(["missing", "undefined"])(
  "inherits omitted timing for date-only reschedules without adding or clearing it on revise (%s)",
  async (shape) => {
    const data = fixture();
    const action = data.batch.groups[0].actions[0];
    if (action.kind !== "reschedule") throw Error("fixture");
    delete action.startMinute;
    delete action.durationMinutes;
    if (shape === "undefined") action.durationMinutes = undefined;
    getOnly(data);
    render(<AdjustmentCards {...props} />);
    await editFirst();
    expect(
      (screen.getByLabelText("调整 1 动作 1 预留分钟") as HTMLInputElement)
        .value,
    ).toBe("60");
    fireEvent.change(screen.getByLabelText("调整 1 动作 1 安排日期"), {
      target: { value: "2030-03-07" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存参数并更新预览" }));
    await waitFor(() =>
      expect(requests("revise_plan_adjustment")).toHaveLength(1),
    );
    const sent = requests("revise_plan_adjustment")[0].groups[0].actions[0];
    expect(sent.date).toBe("2030-03-07");
    expect(sent.durationMinutes).toBeUndefined();
    expect(sent.startMinute).toBeUndefined();
    expect(JSON.parse(JSON.stringify(sent))).not.toHaveProperty(
      "durationMinutes",
    );
  },
);

it("keeps an explicit null timing edit empty instead of inheriting the old reservation", async () => {
  const data = fixture();
  const action = data.batch.groups[0].actions[0];
  if (action.kind !== "reschedule") throw Error("fixture");
  action.startMinute = null;
  action.durationMinutes = null;
  getOnly(data);
  render(<AdjustmentCards {...props} />);
  await editFirst();
  expect(
    (screen.getByLabelText("调整 1 动作 1 预留分钟") as HTMLInputElement).value,
  ).toBe("");
  fireEvent.change(screen.getByLabelText("调整 1 动作 1 安排日期"), {
    target: { value: "2030-03-07" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存参数并更新预览" }));
  await waitFor(() =>
    expect(requests("revise_plan_adjustment")).toHaveLength(1),
  );
  const sent = requests("revise_plan_adjustment")[0].groups[0].actions[0];
  expect(sent.durationMinutes).toBeNull();
  expect(sent.startMinute).toBeNull();
});
