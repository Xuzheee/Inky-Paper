// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { StepEditor } from "./Workbench";
import TaskMetadata from "./TaskMetadata";
import DailyJournal from "./DailyJournal";
import type { State } from "../paper/paperTypes";
import type { Row } from "./model";
import type { DailyRecord } from "./dailyRecord";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.mocked(invoke).mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
});

const fixture = (): { row: Row; state: State } => {
  const row: Row = {
    task: {
      id: "task",
      title: "核对周报",
      due: "等财务回复后确认",
      dueDate: "2030-03-08",
      category: "work",
      priority: "high",
      completed: false,
      nextAction: null,
      revision: 1,
      source: "user",
      updatedAt: 1,
    },
    step: {
      id: "step",
      taskId: "task",
      text: "核对第三项",
      expectedResult: "第三项与原始报表一致",
      plannedSeconds: 900,
      completed: false,
      revision: 1,
    },
    item: {
      id: "item",
      taskId: "task",
      stepId: "step",
      date: "2030-03-04",
      order: 0,
      revision: 1,
      removedAt: null,
    },
  };
  return {
    row,
    state: {
      tasks: [row.task],
      planning: { steps: [row.step!], dayItems: [row.item!] },
      sessions: [],
      notes: [],
      coach: {
        blocks: [],
        proposals: [],
        analysisStatus: "",
        settings: { enabled: false, hermes: false, revision: 1 },
        activities: [],
      },
    },
  };
};
const propsFor = () => ({
  ...fixture(),
  date: "2030-03-04",
  onClose: vi.fn(),
  onSaved: vi.fn(),
});
const value = (name: string) =>
  (screen.getByLabelText(name) as HTMLInputElement).value;
const submitted = () =>
  vi.mocked(invoke).mock.calls[0][1] as {
    action: string;
    input: Record<string, unknown>;
  };
const save = async () => {
  fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
};

it("loads existing metadata and omits unchanged fields while editing the title", async () => {
  const props = propsFor();
  props.row.step!.expectedResult = "原标准".repeat(500);
  render(<StepEditor {...props} />);
  expect(value("优先级")).toBe("high");
  expect(value("截止日期")).toBe("2030-03-08");
  expect(value("截止备注")).toBe("等财务回复后确认");
  expect(value("步骤完成标准")).toBe(props.row.step!.expectedResult);
  fireEvent.change(screen.getByLabelText("任务名称"), {
    target: { value: "核对更新后的周报" },
  });
  await save();
  expect(submitted().action).toBe("workbench_save_step");
  expect(submitted().input.title).toBe("核对更新后的周报");
  for (const key of ["priority", "due", "dueDate", "expectedResult"])
    expect(submitted().input).not.toHaveProperty(key);
});

it("preserves a reservation without a start time while changing task details", async () => {
  const props = propsFor();
  props.row.item!.durationMinutes = 60;
  props.row.item!.startMinute = null;
  render(<StepEditor {...props} />);
  fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "修改标题" } });
  await save();
  expect(submitted().input).toMatchObject({startMinute:null,durationMinutes:60});
});

it("keeps arrangement and deadline separate, preserves free-text remarks, and saves edited criteria", async () => {
  render(<StepEditor {...propsFor()} />);
  fireEvent.change(screen.getByLabelText("安排日期"), {
    target: { value: "2030-03-06" },
  });
  fireEvent.change(screen.getByLabelText("截止日期"), {
    target: { value: "2030-03-09" },
  });
  fireEvent.change(screen.getByLabelText("截止备注"), {
    target: { value: "明天下午再确认，不是正式截止日" },
  });
  fireEvent.change(screen.getByLabelText("步骤完成标准"), {
    target: { value: "核对三项并留下差异说明" },
  });
  fireEvent.change(screen.getByLabelText("优先级"), {
    target: { value: "low" },
  });
  await save();
  expect(submitted().input).toMatchObject({
    date: "2030-03-06",
    dueDate: "2030-03-09",
    due: "明天下午再确认，不是正式截止日",
    expectedResult: "核对三项并留下差异说明",
    priority: "low",
    expectedTaskRevision: 1,
    expectedStepRevision: 1,
  });
});

it("clears optional metadata only when explicitly emptied and keeps the arrangement", async () => {
  render(<StepEditor {...propsFor()} />);
  for (const name of ["截止日期", "截止备注", "步骤完成标准"])
    fireEvent.change(screen.getByLabelText(name), { target: { value: "" } });
  await save();
  expect(submitted().input).toMatchObject({
    dueDate: null,
    due: null,
    expectedResult: null,
    date: "2030-03-04",
  });
});

it("blocks a stale editor and preserves newly shared metadata after the user reviews the conflict", async () => {
  const props = propsFor();
  const view = render(<StepEditor {...props} />);
  const changed = structuredClone(props.state);
  changed.tasks[0].revision = 2;
  changed.tasks[0].due = "新的共同备注";
  changed.planning!.steps[0].revision = 2;
  changed.planning!.steps[0].expectedResult = "新的共同标准";
  view.rerender(<StepEditor {...props} state={changed} />);
  expect(
    (screen.getByRole("button", { name: "保存计划" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText("新的共同标准")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("已核对，使用当前草稿保存"));
  await save();
  expect(submitted().input).toMatchObject({
    expectedTaskRevision: 2,
    expectedStepRevision: 2,
  });
  expect(submitted().input).not.toHaveProperty("due");
  expect(submitted().input).not.toHaveProperty("expectedResult");
});

it("displays shared metadata in cards and labels record metadata as current state", () => {
  const { row } = fixture();
  const view = render(<TaskMetadata task={row.task} compact />);
  expect(screen.getByText("高优先级")).toBeTruthy();
  expect(screen.getByText("截止 2030-03-08")).toBeTruthy();
  const record: DailyRecord = {
    date: "2030-03-04",
    utcOffsetMinutes: 480,
    planItems: [{ ...row.item!, task: row.task, step: row.step! }],
    sessions: [],
    manualStepChanges: [],
    notes: [],
    workBlocks: [],
    summaries: [],
    personalNotes: "",
    sampledAt: 1,
  };
  view.rerender(
    <DailyJournal
      date="2030-03-04"
      entry={{ record }}
      openMarkdown={vi.fn()}
    />,
  );
  expect(screen.getByText("当前任务信息")).toBeTruthy();
  expect(screen.getByText("截止日期")).toBeTruthy();
  expect(screen.getByText("等财务回复后确认")).toBeTruthy();
  expect(screen.getByText("第三项与原始报表一致")).toBeTruthy();
});

it("retries an uncertain editor save with the original payload after fresh state has advanced", async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce(Error("保存响应丢失"))
    .mockResolvedValue({});
  const props = propsFor();
  const view = render(<StepEditor {...props} />);
  fireEvent.change(screen.getByLabelText("截止备注"), {
    target: { value: "已确认截止要求" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
  await screen.findByRole("button", { name: "核实并重试" });
  const first = structuredClone(vi.mocked(invoke).mock.calls[0]);
  const newer = structuredClone(props.state);
  newer.tasks[0].revision = 2;
  view.rerender(<StepEditor {...props} state={newer} />);
  expect(screen.getByLabelText("截止备注").matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "核实并重试" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(vi.mocked(invoke).mock.calls[1]).toEqual(first);
  await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
});

it("keeps an uncertain new-task request mounted through close, cancel and Escape until an exact retry succeeds", async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce(Error("response lost"))
    .mockResolvedValue({});
  const props = {
    state: fixture().state,
    date: null,
    onSaved: vi.fn(),
    onClose: vi.fn(),
  };
  render(<StepEditor {...props} />);
  fireEvent.change(screen.getByLabelText("任务名称"), {
    target: { value: "只创建一次的新任务" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
  await screen.findByRole("button", { name: "核实并重试" });
  const first = structuredClone(vi.mocked(invoke).mock.calls[0]);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.getByRole("alert").textContent).toContain("确认后再关闭");
  const cancel = screen.getByRole("button", {
    name: "取消",
  }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(true);
  fireEvent.click(cancel);
  const escape = new Event("cancel", { bubbles: false, cancelable: true });
  fireEvent(screen.getByRole("dialog"), escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(props.onClose).not.toHaveBeenCalled();
  expect((screen.getByRole("dialog") as HTMLDialogElement).open).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "核实并重试" }));
  await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
  expect(vi.mocked(invoke).mock.calls[1]).toEqual(first);
});

it("allows abandoning an editor after a definitive rejected save", async () => {
  vi.mocked(invoke).mockRejectedValue(Error("INVALID_INPUT: invalid field"));
  const props = propsFor();
  render(<StepEditor {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});
