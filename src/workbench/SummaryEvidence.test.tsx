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
import type { State } from "../paper/paperTypes";
import type { DailyRecord, DailySummary, SummarySource } from "./dailyRecord";
import { dateKey, prepareStepInInky, shiftDay } from "./model";
import SummaryEvidence from "./SummaryEvidence";
import Workbench from "./Workbench";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
const journal = vi.hoisted(() => ({
  record: undefined as DailyRecord | undefined,
}));
vi.mock("./useDailyRecords", () => ({
  useDailyRecords: () =>
    journal.record ? { [journal.record.date]: { record: journal.record } } : {},
}));
const date = shiftDay(dateKey(), -1);
const makeState = (): State => ({
  tasks: [
    {
      id: "task",
      title: "当前任务名称",
      completed: false,
      revision: 7,
      due: null,
      category: "work",
      priority: "medium",
      nextAction: null,
      source: "user",
      updatedAt: 2,
    },
  ],
  planning: {
    steps: [
      {
        id: "step",
        taskId: "task",
        text: "当前步骤",
        expectedResult: null,
        plannedSeconds: 300,
        revision: 4,
        completed: false,
      },
    ],
    dayItems: [
      {
        id: "item",
        taskId: "task",
        stepId: "step",
        date,
        revision: 3,
        order: 0,
        removedAt: null,
      },
    ],
  },
  sessions: [],
  notes: [],
  coach: {
    blocks: [],
    proposals: [],
    analysisStatus: "",
    activities: [],
    settings: { enabled: false, hermes: false, revision: 1 },
  },
});
const makeSummary = (): DailySummary => ({
  id: "summary",
  body: "实际推进：核对了两项。\n未知：剩余工作还没有估计。\n建议：下次先核对第三项。",
  sourceAsOf: new Date(`${date}T19:00:00+08:00`).getTime(),
  hasNewRecords: false,
  evidence: [
    {
      kind: "session",
      id: "session-old",
      label: "旧步骤名称",
      snapshot: {
        taskTitle: "旧任务名称",
        action: { id: "step", text: "旧步骤名称" },
        startedAt: 1000,
        endedAt: 2000,
        dailySeconds: 30,
        kind: "focus",
        planDate: date,
        feedback: {
          outcome: "stopped",
          output: "核对了两项",
          blocker: null,
          nextCue: "第三项",
        },
      },
    },
  ],
  nextStart: {
    taskId: "task",
    stepId: "step",
    dayItemId: "item",
    cue: "第三项",
  },
});
const record = (summary = makeSummary()): DailyRecord => ({
  date,
  utcOffsetMinutes: 480,
  planItems: [],
  sessions: [],
  notes: [],
  workBlocks: [],
  summaries: [summary],
  personalNotes: "",
  sampledAt: 1,
});
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  journal.record = undefined;
  vi.mocked(invoke).mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(invoke).mockReset();
});

it("keeps the source snapshot when current objects change or disappear, with a stale marker", () => {
  const summary = { ...makeSummary(), hasNewRecords: true, nextStart: null };
  const { rerender } = render(
    <SummaryEvidence summary={summary} date={date} state={makeState()} />,
  );
  fireEvent.click(screen.getByText("查看依据 · 1 条"));
  fireEvent.click(screen.getByText("番茄钟记录 · 旧步骤名称"));
  expect(screen.getByText("旧任务名称")).toBeTruthy();
  expect(screen.getByText("30 秒")).toBeTruthy();
  expect(screen.queryByText("当前任务名称")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("尚未更新");
  const state = makeState();
  state.tasks = [];
  state.planning!.steps = [];
  rerender(<SummaryEvidence summary={summary} date={date} state={state} />);
  expect(screen.getByText("旧任务名称")).toBeTruthy();
  expect(screen.getByText("核对了两项")).toBeTruthy();
  expect(summary.evidence![0].snapshot.taskTitle).toBe("旧任务名称");
});

it("shows each saved evidence kind as readable fields and does not invent evidence for old summaries", () => {
  const extra: SummarySource[] = [
    {
      kind: "step",
      id: "s",
      label: "计划来源",
      snapshot: {
        text: "计划小步",
        completed: false,
        plannedSeconds: 900,
        expectedResult: "一页草稿",
      },
    },
    {
      kind: "manualChange",
      id: "m",
      label: "撤销来源",
      snapshot: {
        taskTitle: "父任务",
        stepText: "手动小步",
        completed: false,
        recordedAt: 2000,
      },
    },
    {
      kind: "note",
      id: "n",
      label: "笔记来源",
      snapshot: {
        text: "原文 <script> 也是普通文字",
        taskTitle: "笔记来自任务",
        action: { text: "笔记来自步骤" },
        createdAt: 1000,
      },
    },
    {
      kind: "planChange",
      id: "p",
      label: "改期来源",
      snapshot: {
        before: { date, order: 0 },
        after: {
          date: dateKey(),
          durationMinutes: 30,
          startMinute: 600,
          order: 1,
        },
        recordedAt: 2000,
      },
    },
    {
      kind: "personalNote",
      id: date,
      label: "个人笔记来源",
      snapshot: {
        date,
        quote: "这是当时写下的原句",
        notesVersion: "source-version",
      },
    },
  ];
  const { rerender } = render(
    <SummaryEvidence
      date={date}
      summary={{ ...makeSummary(), evidence: extra, nextStart: null }}
    />,
  );
  expect(screen.getByText("15 分钟")).toBeTruthy();
  expect(screen.getByText("撤销完成")).toBeTruthy();
  expect(screen.getByText("原文 <script> 也是普通文字")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByText(/10:00 · 预留 30 分钟/)).toBeTruthy();
  expect(screen.getByText("这是当时写下的原句")).toBeTruthy();
  rerender(
    <SummaryEvidence
      date={date}
      summary={{ ...makeSummary(), evidence: undefined, nextStart: null }}
      state={makeState()}
    />,
  );
  expect(
    screen.getByText("这份总结未附依据；旧总结不会补造来源。"),
  ).toBeTruthy();
  expect(screen.queryByText(/查看依据/)).toBeNull();
  expect(screen.queryByText("当前任务名称")).toBeNull();
});

it("keeps two distinct personal-note quotes from the same date independently rendered and expanded", () => {
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const evidence: SummarySource[] = [
      "先核对第一项。",
      "第二项需要明天继续。",
    ].map((quote) => ({
      kind: "personalNote",
      id: date,
      label: "个人笔记原句",
      snapshot: { date, quote, notesVersion: "same-read" },
    }));
    const summary = { ...makeSummary(), evidence, nextStart: null };
    const { rerender } = render(
      <SummaryEvidence date={date} summary={summary} />,
    );
    fireEvent.click(screen.getByText("查看依据 · 2 条"));
    const first = screen.getByText("先核对第一项。").closest("details")!;
    fireEvent.click(first.querySelector("summary")!);
    expect(first.open).toBe(true);
    expect(screen.getByText("第二项需要明天继续。")).toBeTruthy();
    rerender(
      <SummaryEvidence
        date={date}
        summary={{ ...summary, evidence: [...evidence].reverse() }}
      />,
    );
    expect(screen.getByText("先核对第一项。").closest("details")!.open).toBe(
      true,
    );
    expect(
      screen.getByText("第二项需要明天继续。").closest("details")!.open,
    ).toBe(false);
    expect(
      document.querySelectorAll(`[data-evidence-id="${date}"]`),
    ).toHaveLength(2);
    expect(warning).not.toHaveBeenCalled();
  } finally {
    warning.mockRestore();
  }
});

it("prepares the original step with current revisions and exact original source without starting a clock", async () => {
  render(
    <SummaryEvidence
      date={date}
      summary={makeSummary()}
      state={makeState()}
      onContinue={async (row) => {
        await prepareStepInInky(row);
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "继续原步骤" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(invoke).toHaveBeenCalledWith("workbench_prepare_step", {
    input: {
      requestId: expect.any(String),
      taskId: "task",
      stepId: "step",
      expectedRevision: 7,
      expectedStepRevision: 4,
    },
    itemId: "item",
  });
  expect(screen.getByText(/点击 start 才开始计时/)).toBeTruthy();
});

it.each([
  [
    "completed step",
    (state: State) => {
      state.planning!.steps[0].completed = true;
    },
    "原步骤已完成",
  ],
  [
    "completed task",
    (state: State) => {
      state.tasks[0].completed = true;
    },
    "整个任务已完成",
  ],
  [
    "missing step",
    (state: State) => {
      state.planning!.steps = [];
    },
    "原任务或步骤已不可用",
  ],
  [
    "removed arrangement",
    (state: State) => {
      state.planning!.dayItems[0].removedAt = 1;
    },
    "原安排已取消或变化",
  ],
  [
    "resolved historical arrangement",
    (state: State) => {
      state.planning!.dayItems[0].resolvedAt = 1;
      state.planning!.dayItems[0].continuedTo = "new-current-item";
    },
    "原安排已处理",
  ],
  [
    "missing arrangement",
    (state: State) => {
      state.planning!.dayItems = [];
    },
    "原安排已取消或变化",
  ],
  [
    "different arrangement target",
    (state: State) => {
      state.planning!.dayItems[0].stepId = "another";
    },
    "原安排已取消或变化",
  ],
  [
    "active focus",
    (state: State) => {
      state.sessions = [{ status: "running" }] as State["sessions"];
    },
    "当前一轮还未保存",
  ],
  [
    "paused focus",
    (state: State) => {
      state.sessions = [{ status: "paused" }] as State["sessions"];
    },
    "当前一轮还未保存",
  ],
  [
    "expired focus",
    (state: State) => {
      state.sessions = [{ status: "waiting" }] as State["sessions"];
    },
    "当前一轮还未保存",
  ],
] as const)(
  "disables continuation for %s and never silently falls back to unplanned work",
  (_name, alter, message) => {
    const state = makeState();
    alter(state);
    const continueStep = vi.fn();
    render(
      <SummaryEvidence
        date={date}
        summary={makeSummary()}
        state={state}
        onContinue={continueStep}
      />,
    );
    const button = screen.getByRole("button", {
      name: "继续原步骤",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.getByText((content) => content.startsWith(message)),
    ).toBeTruthy();
    fireEvent.click(button);
    expect(continueStep).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  },
);

it("retains a genuinely unplanned original step and respects an in-flight operation", () => {
  const summary = makeSummary();
  summary.nextStart!.dayItemId = null;
  const onContinue = vi.fn();
  const { rerender } = render(
    <SummaryEvidence
      date={date}
      summary={summary}
      state={makeState()}
      onContinue={onContinue}
      blocked
    />,
  );
  expect(
    (screen.getByRole("button", { name: "继续原步骤" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(
    <SummaryEvidence
      date={date}
      summary={summary}
      state={makeState()}
      onContinue={onContinue}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "继续原步骤" }));
  expect(onContinue.mock.calls[0][0].item).toBeUndefined();
});

function nativeMocks() {
  const state = makeState();
  journal.record = record();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "workbench_storage_scope")
      return { scopeId: "summary-test" };
    if (command === "workbench_history") return { sessions: [], messages: [] };
    if (command === "paper_execute") {
      const action = (args as { action: string }).action;
      if (action === "get_state") return { state };
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
      throw Error(`Unexpected write: ${action}`);
    }
    return {};
  });
}
async function historicalJournal() {
  await screen.findByRole("button", { name: "收起 Coach" });
  fireEvent.click(screen.getByRole("tab", { name: "每日记录" }));
  fireEvent.click(screen.getByRole("button", { name: "前一天" }));
  return screen.findByRole("region", { name: `${date}的总结` });
}

it("workbench continuation uses its existing handoff and never sends a model or start-session request", async () => {
  nativeMocks();
  render(<Workbench />);
  const summary = await historicalJournal();
  await waitFor(() =>
    expect(
      (
        within(summary).getByRole("button", {
          name: "继续原步骤",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(within(summary).getByRole("button", { name: "继续原步骤" }));
  await screen.findByText("已选好下一步，回到 Inky 后点击 start 开始。");
  const writes = vi
    .mocked(invoke)
    .mock.calls.filter(
      ([command]) =>
        command !== "paper_execute" &&
        command !== "workbench_storage_scope" &&
        command !== "workbench_history",
    );
  expect(writes.map(([command]) => command)).toEqual([
    "workbench_prepare_step",
  ]);
  expect(writes[0][1]).toMatchObject({
    itemId: "item",
    input: { expectedRevision: 7, expectedStepRevision: 4 },
  });
});

it("prefilling from a historical summary switches discussion to real today, expands Coach and waits for user send", async () => {
  nativeMocks();
  render(<Workbench />);
  const summary = await historicalJournal();
  fireEvent.click(screen.getByRole("button", { name: "收起 Coach" }));
  fireEvent.click(
    within(summary).getByRole("button", { name: "为今天准备候选" }),
  );
  const input = await screen.findByRole("textbox", { name: "发送给 Coach" });
  await waitFor(() =>
    expect((input as HTMLTextAreaElement).value).toContain(
      `请为今天（${dateKey()}）`,
    ),
  );
  expect((input as HTMLTextAreaElement).value).toContain(
    `${date} 的总结（标识 summary`,
  );
  expect((input as HTMLTextAreaElement).value).toContain(
    "未知：剩余工作还没有估计",
  );
  expect(screen.getByLabelText("Coach 讨论范围").textContent).toContain(
    `讨论范围 · ${dateKey()}`,
  );
  expect(screen.getByLabelText("Coach 讨论范围").textContent).toContain(
    "当天计划与记录",
  );
  expect(screen.getByText("已放入输入框，发送后再讨论。")).toBeTruthy();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(
        ([command]) =>
          command === "workbench_send" || command === "workbench_prepare_step",
      ),
  ).toBe(false);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "paper_execute")
      .every(([, args]) =>
        (args as { action: string }).action.startsWith("get_"),
      ),
  ).toBe(true);
});
