// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import PaperApp from "./PaperApp";
import type { State, Task, Session } from "./paperTypes";
import type { WorkBlock } from "./CoachUI";
import { WorkHistory } from "./CoachUI";
import { SessionHistoryList } from "./SessionHistory";
import { localDate } from "./DayPlan";
import { PAPER_MOTTOS } from "./mottos";
import { taskCompletionPrompt } from "../shared/planning";

const native = vi.hoisted(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
  });
  return {
    invoke: vi.fn(),
    listeners: new Map<string, (event: { payload: unknown }) => void>(),
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, callback) => {
    native.listeners.set(name, callback);
    return () => native.listeners.delete(name);
  }),
}));
vi.mock("./completionSound", () => ({
  prepareCompletionSound: vi.fn(),
  playCompletionSound: vi.fn(),
}));

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
const block = (): WorkBlock => ({
  id: "block",
  taskId: "A",
  taskTitle: "任务 A",
  action: { id: "step-A", text: "步骤 A" },
  goal: "步骤 A",
  status: "active",
  mode: "working",
  revision: 1,
  energy: null,
  plannedEndAt: Date.now() + 3600000,
  startedAt: Date.now(),
  endedAt: null,
  resumeCue: null,
  sessionIds: [],
  progress: null,
  output: null,
  blocker: null,
  focus: null,
});
const session = (status = "running"): Session => ({
  id: "session",
  taskId: "A",
  taskTitle: "任务 A",
  action: task("A").nextAction,
  kind: "focus",
  status,
  revision: 1,
  plannedSeconds: 1500,
  elapsedSeconds: 0,
  lastResumedAt: status === "running" ? Date.now() - 12000 : null,
  startedAt: Date.now() - 12000,
  endedAt: null,
  pauseCount: 0,
  resumeCue: null,
  feedback: null,
});
let state: State;
const button = (name: string) => screen.getByRole("button", { name });
const allTasks = () => fireEvent.click(button("全部任务"));
const outcome = (name: "还没完成" | "已完成") =>
  screen.getByRole("radio", { name }) as HTMLInputElement;
const showFeedbackFields = () => {
  const open = screen.queryByRole("button", { name: "补充记录（可选）" });
  if (open) fireEvent.click(open);
  const more = screen.queryByRole("button", { name: "其他记录（可选）" });
  if (more) fireEvent.click(more);
};
const open = async () => {
  render(<PaperApp />);
  await screen.findByRole("heading", { name: "就从这一步开始" });
};
const sync = async () => {
  await act(async () =>
    native.listeners.get("paper:changed")?.({ payload: null }),
  );
};
const enableTaskSteps = () => {
  state.planning = {
    steps: state.tasks.map((current) => ({
      id: current.nextAction!.id,
      taskId: current.id,
      text: current.nextAction!.text,
      expectedResult: null,
      plannedSeconds: current.id === "B" ? 1200 : 1500,
      completed: false,
      revision: 1,
    })),
    dayItems: [],
  };
};
const selectTaskStep = async (id: string) => {
  allTasks();
  if (!screen.queryByRole("button", { name: `Do this：步骤 ${id}` })) {
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^任务 ${id}`) }),
    );
  }
  await act(async () => fireEvent.click(button(`Do this：步骤 ${id}`)));
};
const mutations = () =>
  native.invoke.mock.calls.filter(
    ([command, args]) =>
      command === "paper_execute" &&
      args?.action &&
      !["get_state", "get_daily_record"].includes(args.action),
  );
beforeEach(() => {
  vi.clearAllMocks();
  native.listeners.clear();
  localStorage.clear();
  state = {
    tasks: [task("A")],
    sessions: [],
    notes: [],
    coach: {
      blocks: [],
      proposals: [],
      activities: [],
      analysisStatus: "",
      settings: { enabled: true, hermes: false, revision: 1 },
    },
  };
  native.invoke.mockImplementation(
    async (command, { action, input = {} } = {}) => {
      if (command !== "paper_execute") return;
      if (action === "get_state") return { state: structuredClone(state) };
      if (action === "update_task") {
        const current = state.tasks.find((t) => t.id === input.taskId)!;
        if (current.revision !== input.expectedRevision)
          throw new Error("CONFLICT: 任务已有更新");
        if (input.patch.completed !== undefined)
          current.completed = input.patch.completed;
        current.revision += 1;
        return { task: structuredClone(current) };
      }
      if (action === "acknowledge_task_completion") {
        const prompt = taskCompletionPrompt(state, input.taskId);
        if (
          !prompt ||
          prompt.task.revision !== input.expectedTaskRevision ||
          JSON.stringify(input.steps) !==
            JSON.stringify(
              prompt.steps.map((s) => ({ id: s.id, revision: s.revision })),
            )
        )
          throw new Error("CONFLICT: 步骤集合已有更新");
        const acknowledgement = {
          taskId: prompt.task.id,
          completionKey: prompt.completionKey,
          acknowledgedAt: Date.now(),
        };
        state.planning!.taskCompletionAcknowledgements ||= [];
        state.planning!.taskCompletionAcknowledgements.push(acknowledgement);
        return { acknowledgement };
      }
      if (action === "prepare_step") {
        if (state.sessions.some((session) => session.status !== "finished"))
          throw new Error("ACTIVE_SESSION");
        const selectedTask = state.tasks.find((t) => t.id === input.taskId)!;
        state.planning ||= { steps: [], dayItems: [] };
        let selectedStep = state.planning!.steps.find(
          (s) => s.id === input.stepId && s.taskId === selectedTask.id,
        );
        if (
          !input.stepId &&
          !state.planning.steps.some((step) => step.taskId === selectedTask.id)
        ) {
          selectedStep = {
            id: `prepared-${selectedTask.id}`,
            taskId: selectedTask.id,
            text: selectedTask.nextAction?.text || selectedTask.title,
            expectedResult: null,
            plannedSeconds: 1500,
            completed: false,
            revision: 1,
          };
          state.planning.steps.push(selectedStep);
        }
        if (!selectedStep) throw new Error("NOT_FOUND: step");
        if (
          selectedTask.revision !== input.expectedRevision ||
          (input.stepId && selectedStep.revision !== input.expectedStepRevision)
        )
          throw new Error("CONFLICT: 步骤已有更新");
        const item = input.dayItemId
          ? state.planning.dayItems.find(
              (item) =>
                item.id === input.dayItemId &&
                item.removedAt === null &&
                item.taskId === selectedTask.id &&
                item.stepId === selectedStep!.id,
            )
          : null;
        if (input.dayItemId && !item) throw new Error("CONFLICT: 原安排已变化");
        if (selectedTask.nextAction?.id !== selectedStep.id) {
          selectedTask.nextAction = {
            id: selectedStep.id,
            text: selectedStep.text,
            completed: selectedStep.completed,
            source: "user",
          };
          selectedTask.revision += 1;
        }
        state.planning.prepared = {
          taskId: selectedTask.id,
          stepId: selectedStep.id,
          dayItemId: item?.id || null,
        };
        return {
          task: structuredClone(selectedTask),
          step: structuredClone(selectedStep),
          item: structuredClone(item),
          prepared: structuredClone(state.planning.prepared),
        };
      }
      if (action === "set_step_completed") {
        const parent = state.tasks.find((t) => t.id === input.taskId)!;
        const step = state.planning!.steps.find(
          (s) => s.id === input.stepId && s.taskId === parent.id,
        )!;
        if (
          parent.revision !== input.expectedTaskRevision ||
          step.revision !== input.expectedStepRevision
        )
          throw new Error("CONFLICT: 步骤已有更新");
        if (
          state.sessions.some(
            (s) => s.taskId === parent.id && s.status !== "finished",
          )
        )
          throw new Error("ACTIVE_SESSION: 请先结束这一轮");
        step.completed = input.completed;
        step.revision += 1;
        if (parent.nextAction?.id === step.id) {
          parent.nextAction.completed = input.completed;
          parent.revision += 1;
        }
        return { task: structuredClone(parent), step: structuredClone(step) };
      }
      if (action === "switch_work_task") {
        const currentBlock = state.coach.blocks.find(
          (b) => b.id === input.blockId,
        )!;
        const selectedTask = state.tasks.find((t) => t.id === input.taskId)!;
        if (
          currentBlock.status !== "active" ||
          state.sessions.some((s) => s.status !== "finished")
        )
          throw new Error("ACTIVE_SESSION: 请先结束本轮再切换工作目标");
        if (
          currentBlock.revision !== input.expectedRevision ||
          selectedTask.revision !== input.expectedTaskRevision
        )
          throw new Error("CONFLICT: 工作目标已有更新");
        currentBlock.taskId = selectedTask.id;
        currentBlock.taskTitle = selectedTask.title;
        currentBlock.action = structuredClone(selectedTask.nextAction);
        currentBlock.goal = selectedTask.nextAction?.text || selectedTask.title;
        currentBlock.revision += 1;
        return { saved: true };
      }
      if (action === "start_session") {
        if (state.sessions.some((s) => s.status !== "finished"))
          throw new Error("ACTIVE_SESSION");
        if (input.kind === "rest") {
          const current = {
            ...session(),
            id: "rest-session",
            taskId: null,
            taskTitle: "休息",
            action: null,
            kind: "rest",
            plannedSeconds: input.plannedSeconds,
          };
          state.sessions.push(current);
          return { session: structuredClone(current) };
        }
        const selectedTask = state.tasks.find((t) => t.id === input.taskId)!;
        const selectedStep = state.planning?.steps.find(
          (s) => s.id === input.stepId,
        );
        if (
          selectedTask.revision !== input.expectedRevision ||
          (selectedStep && selectedStep.revision !== input.expectedStepRevision)
        )
          throw new Error("CONFLICT: 开始内容已有更新");
        const currentBlock = state.coach.blocks.find(
          (b) => b.status === "active",
        );
        if (currentBlock && currentBlock.taskId !== selectedTask.id)
          throw new Error("WORK_TARGET_MISMATCH");
        if (selectedStep)
          selectedTask.nextAction = {
            id: selectedStep.id,
            text: selectedStep.text,
            completed: selectedStep.completed,
            source: "user",
          };
        const current = {
          ...session(),
          taskId: selectedTask.id,
          taskTitle: selectedTask.title,
          action: structuredClone(selectedTask.nextAction),
          plannedSeconds: input.plannedSeconds,
        };
        state.sessions.push(current);
        return { session: structuredClone(current) };
      }
      if (["pause_session", "save_cue", "resume_session"].includes(action)) {
        const current = state.sessions.find((s) => s.id === input.sessionId)!;
        if (current.revision !== input.expectedRevision)
          throw new Error("CONFLICT: 番茄钟已有更新");
        if (action === "pause_session") {
          if (current.status !== "running")
            throw new Error("INVALID_SESSION_STATE");
          current.elapsedSeconds += Math.floor(
            (Date.now() - current.lastResumedAt!) / 1000,
          );
          current.lastResumedAt = null;
          current.status = "paused";
          current.pauseCount += 1;
        } else if (action === "save_cue") {
          current.resumeCue = input.resumeCue;
        } else {
          current.status = "running";
          current.lastResumedAt = Date.now();
        }
        current.revision += 1;
        return { session: structuredClone(current) };
      }
      if (action === "finish_session") {
        const current = state.sessions.find((s) => s.id === input.sessionId)!;
        if (current.revision !== input.expectedRevision)
          throw new Error("CONFLICT: 番茄钟已有更新");
        current.status = "finished";
        current.lastResumedAt = null;
        current.feedback = {
          outcome: input.outcome,
          output: input.output || null,
          blocker: input.blocker || null,
          nextCue: input.nextCue || null,
        };
        current.revision += 1;
        if (input.outcome === "step_completed") {
          const finishedStep = state.planning?.steps.find(
            (s) => s.id === current.action?.id && s.taskId === current.taskId,
          );
          if (finishedStep) {
            finishedStep.completed = true;
            finishedStep.revision += 1;
          }
          const parent = state.tasks.find((t) => t.id === current.taskId)!;
          if (parent.nextAction?.id === current.action?.id) {
            parent.nextAction!.completed = true;
            parent.revision += 1;
          }
        }
        return { session: structuredClone(current) };
      }
      return { saved: true };
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Paper current flows", () => {
  it("restores the persisted future step and its duration after restart without relying on a window event", async () => {
    state.tasks.push(task("B"));
    enableTaskSteps();
    state.planning!.steps[1].plannedSeconds = 1080;
    state.planning!.dayItems = [
      {
        id: "future-B",
        date: "2099-01-03",
        taskId: "B",
        stepId: "step-B",
        order: 0,
        revision: 1,
        removedAt: null,
      },
    ];
    state.planning!.prepared = {
      taskId: "B",
      stepId: "step-B",
      dayItemId: "future-B",
    };
    localStorage.setItem("paper-selected", JSON.stringify("A"));
    const committedDurations: string[] = [];
    const openRestored = async () => {
      render(
        <Profiler
          id="restored-step"
          onRender={() => {
            const card = screen.queryByRole("region", { name: "当前步骤" });
            const duration =
              card &&
              (within(card).queryByLabelText(
                "专注时长",
              ) as HTMLSelectElement | null);
            if (
              duration &&
              card &&
              within(card).queryByRole("heading", { name: "步骤 B" })
            )
              committedDurations.push(duration.value);
          }}
        >
          <PaperApp />
        </Profiler>,
      );
      await screen.findByRole("heading", { name: "步骤 B" });
    };
    await openRestored();
    expect(
      within(screen.getByRole("region", { name: "当前步骤" })).getByRole(
        "heading",
        { name: "步骤 B" },
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText("专注时长") as HTMLSelectElement).value).toBe(
      "18",
    );
    expect(screen.getByText(/来自 2099-01-03 的安排/)).toBeTruthy();
    expect(mutations()).toHaveLength(0);
    cleanup();
    await openRestored();
    expect((screen.getByLabelText("专注时长") as HTMLSelectElement).value).toBe(
      "18",
    );
    expect(committedDurations.length).toBeGreaterThan(0);
    expect(new Set(committedDurations)).toEqual(new Set(["18"]));
    await act(async () => fireEvent.click(button("start")));
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "start_session",
    ]);
    expect(mutations()[0][1].input).toMatchObject({
      taskId: "B",
      stepId: "step-B",
      dayItemId: "future-B",
      plannedSeconds: 1080,
    });
    expect(state.planning!.dayItems[0].date).toBe("2099-01-03");
  });

  it("keeps the user's duration when the same step refreshes, and starts with that choice", async () => {
    enableTaskSteps();
    await open();
    fireEvent.change(await screen.findByLabelText("专注时长"), {
      target: { value: "45" },
    });
    state.tasks[0].title = "更新后的任务标题";
    state.tasks[0].revision++;
    state.planning!.steps[0].expectedResult = "新增完成标准";
    state.planning!.steps[0].revision++;
    await sync();
    expect((screen.getByLabelText("专注时长") as HTMLSelectElement).value).toBe(
      "45",
    );
    expect(mutations()).toHaveLength(0);
    await act(async () => fireEvent.click(button("start")));
    expect(state.sessions[0].plannedSeconds).toBe(2700);
  });

  it("uses the exact first daily step for the note, row marker and clock even when the parent's next action is different", async () => {
    enableTaskSteps();
    state.planning!.steps.push({
      ...state.planning!.steps[0],
      id: "step-A2",
      text: "今日先核对来源",
      plannedSeconds: 600,
    });
    state.planning!.dayItems = [
      {
        id: "today-A2",
        date: localDate(),
        taskId: "A",
        stepId: "step-A2",
        order: 0,
        revision: 1,
        removedAt: null,
      },
    ];
    await open();
    expect(
      within(screen.getByRole("region", { name: "当前步骤" })).getByRole(
        "heading",
        { name: "今日先核对来源" },
      ),
    ).toBeTruthy();
    expect(
      document
        .querySelector('[data-plan-item-id="today-A2"]')
        ?.getAttribute("data-current"),
    ).toBe("true");
    expect(state.tasks[0].nextAction?.id).toBe("step-A");
    expect(mutations()).toHaveLength(0);
    await act(async () => fireEvent.click(button("start")));
    expect(mutations()[0][1].input).toMatchObject({
      taskId: "A",
      stepId: "step-A2",
      dayItemId: "today-A2",
      plannedSeconds: 600,
    });
    expect(state.sessions[0].action?.text).toBe("今日先核对来源");
  });

  it("preserves a future source when editing the prepared task and entering the work-block confirmation page", async () => {
    enableTaskSteps();
    state.planning!.dayItems = [
      {
        id: "future-A",
        date: "2099-01-03",
        taskId: "A",
        stepId: "step-A",
        order: 0,
        revision: 1,
        removedAt: null,
      },
    ];
    state.planning!.prepared = {
      taskId: "A",
      stepId: "step-A",
      dayItemId: "future-A",
    };
    await open();
    fireEvent.click(button("修改下一步"));
    await act(async () => fireEvent.click(button("保存")));
    expect(state.planning!.prepared.dayItemId).toBe("future-A");
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "update_task",
      "prepare_step",
    ]);
    expect(state.sessions).toHaveLength(0);
    await act(async () => fireEvent.click(button("安排一个工作时段")));
    expect(state.planning!.prepared.dayItemId).toBe("future-A");
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "update_task",
      "prepare_step",
      "prepare_step",
    ]);
    expect(state.sessions).toHaveLength(0);
    await act(async () => fireEvent.click(button("开始工作并计时")));
    expect(mutations()[mutations().length - 1]?.[1]).toMatchObject({
      action: "start_work",
      input: { taskId: "A", expectedRevision: 2, goal: "步骤 A" },
    });
    expect(state.planning!.dayItems[0].date).toBe("2099-01-03");
  });

  it("keeps the user's previous explicit task ahead of automatic daily suggestions", async () => {
    state.tasks.push(task("B"));
    enableTaskSteps();
    state.planning!.dayItems = [
      {
        id: "today-B",
        date: localDate(),
        taskId: "B",
        stepId: "step-B",
        order: 0,
        revision: 1,
        removedAt: null,
      },
    ];
    localStorage.setItem("paper-selected", JSON.stringify("A"));
    await open();
    expect(
      within(screen.getByRole("region", { name: "当前步骤" })).getByRole(
        "heading",
        { name: "步骤 A" },
      ),
    ).toBeTruthy();
    expect(mutations()).toHaveLength(0);
  });

  it.each(["task missing", "step missing", "task completed", "step completed"])(
    "does not fall back silently when the prepared %s",
    async (condition) => {
      state.tasks.push(task("B"));
      enableTaskSteps();
      state.planning!.prepared = {
        taskId: "A",
        stepId: "step-A",
        dayItemId: null,
      };
      if (condition === "task missing") state.tasks.shift();
      if (condition === "step missing") state.planning!.steps.shift();
      if (condition === "task completed") state.tasks[0].completed = true;
      if (condition === "step completed")
        state.planning!.steps[0].completed = true;
      await open();
      expect(screen.getByRole("alert").textContent).toContain(
        "请重新选择下一步",
      );
      expect(screen.queryByRole("heading", { name: "步骤 B" })).toBeNull();
      const start = screen.queryByRole("button", {
        name: "start",
      }) as HTMLButtonElement | null;
      expect(!start || start.disabled).toBe(true);
      expect(mutations()).toHaveLength(0);
    },
  );

  it("prepares a legacy task without a formal step through one named operation and no clock", async () => {
    state.tasks[0].nextAction = null;
    await open();
    allTasks();
    fireEvent.click(screen.getByRole("button", { name: /^任务 A/ }));
    await act(async () => fireEvent.click(button("Do this：任务 A")));
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "prepare_step",
    ]);
    expect(mutations()[0][1].input).toMatchObject({
      taskId: "A",
      stepId: null,
      expectedStepRevision: null,
      dayItemId: null,
    });
    expect(state.planning!.prepared).toEqual({
      taskId: "A",
      stepId: "prepared-A",
      dayItemId: null,
    });
    expect(state.sessions).toHaveLength(0);
  });

  it("rejects a late workbench event when its pending refresh discovers an active session", async () => {
    state.tasks.push(task("B"));
    enableTaskSteps();
    await open();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args = {}) => {
      if (command === "paper_execute" && args.action === "get_state")
        await waiting;
      return fallback(command, args);
    });
    await act(async () => {
      native.listeners.get("workbench:select")?.({
        payload: {
          taskId: "B",
          stepId: "step-B",
          plannedSeconds: 1200,
          item: null,
        },
      });
    });
    state.planning!.prepared = {
      taskId: "B",
      stepId: "step-B",
      dayItemId: null,
    };
    state.sessions = [session()];
    const snapshot = structuredClone(state.sessions[0]);
    await act(async () => {
      release();
      await waiting;
    });
    expect(screen.getByRole("timer")).toBeTruthy();
    fireEvent.click(button("返回任务列表"));
    expect(
      within(screen.getByRole("region", { name: "当前步骤" })).getByRole(
        "heading",
        { name: "步骤 A" },
      ),
    ).toBeTruthy();
    expect(state.sessions[0]).toEqual(snapshot);
    expect(mutations()).toHaveLength(0);
  });

  it("ignores an obsolete workbench event instead of replacing the newer persisted choice", async () => {
    state.tasks.push(task("B"));
    enableTaskSteps();
    state.planning!.prepared = {
      taskId: "B",
      stepId: "step-B",
      dayItemId: null,
    };
    await open();
    fireEvent.click(button("设置"));
    await act(async () =>
      native.listeners.get("workbench:select")?.({
        payload: {
          taskId: "A",
          stepId: "step-A",
          plannedSeconds: 900,
          item: null,
        },
      }),
    );
    expect(
      screen.queryByRole("heading", { name: "就从这一步开始" }),
    ).toBeNull();
    fireEvent.click(button("返回上一页"));
    expect(
      within(screen.getByRole("region", { name: "当前步骤" })).getByRole(
        "heading",
        { name: "步骤 B" },
      ),
    ).toBeTruthy();
    expect(mutations()).toHaveLength(0);
  });

  it("blocks the old note after preparation succeeds but refresh fails and recovers by reading without a second write", async () => {
    state.tasks.push(task("B"));
    enableTaskSteps();
    state.planning!.prepared = {
      taskId: "A",
      stepId: "step-A",
      dayItemId: null,
    };
    await open();
    const fallback = native.invoke.getMockImplementation()!;
    let prepared = false;
    let failRead = true;
    native.invoke.mockImplementation(async (command, args = {}) => {
      if (
        command === "paper_execute" &&
        args.action === "get_state" &&
        prepared &&
        failRead
      )
        throw new Error("读取中断");
      const result = await fallback(command, args);
      if (command === "paper_execute" && args.action === "prepare_step")
        prepared = true;
      return result;
    });
    await selectTaskStep("B");
    expect((button("start") as HTMLButtonElement).disabled).toBe(true);
    expect(state.planning!.prepared?.taskId).toBe("B");
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "prepare_step",
    ]);
    failRead = false;
    await act(async () => fireEvent.click(button("重新读取")));
    expect(
      within(screen.getByRole("region", { name: "当前步骤" })).getByRole(
        "heading",
        { name: "步骤 B" },
      ),
    ).toBeTruthy();
    expect((button("start") as HTMLButtonElement).disabled).toBe(false);
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "prepare_step",
    ]);
  });

  it("shows the shared daily queue by default and refreshes external order without changing the selected note", async () => {
    state.tasks.push(task("B"));
    enableTaskSteps();
    state.planning!.dayItems = state.tasks.map((item, index) => ({
      id: `today-${item.id}`,
      taskId: item.id,
      stepId: item.nextAction!.id,
      date: localDate(),
      order: 1 - index,
      revision: 1,
      removedAt: null,
    }));
    await open();
    const queue = () =>
      Array.from(
        document.querySelectorAll(".sheet-queue-item .sheet-task-name"),
        (node) => node.textContent,
      );
    expect(queue()).toEqual(["步骤 B", "步骤 A"]);
    expect(screen.getByRole("heading", { name: "今日步骤" })).toBeTruthy();
    state.planning!.dayItems[0].order = 0;
    state.planning!.dayItems[1].order = 1;
    await sync();
    expect(queue()).toEqual(["步骤 A", "步骤 B"]);
    expect(
      within(screen.getByRole("region", { name: "当前步骤" })).getByRole(
        "heading",
        { name: "步骤 A" },
      ),
    ).toBeTruthy();
    expect(mutations()).toHaveLength(0);
  });

  it("can start without daily planning and offers a temporary task from the same home", async () => {
    enableTaskSteps();
    await open();
    expect(screen.getByText(/今天还没有安排/)).toBeTruthy();
    fireEvent.click(button("临时做一件"));
    expect(screen.getByRole("heading", { name: "添一件小事" })).toBeTruthy();
    fireEvent.click(button("返回上一页"));
    await act(async () => fireEvent.click(button("start")));
    expect(state.planning!.dayItems).toEqual([]);
    expect(state.sessions).toHaveLength(1);
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "start_session",
    ]);
    expect(mutations()[0][1].input.dayItemId).toBeUndefined();
  });

  it("defaults to unfinished and changes the end choice without writing until the single save action", async () => {
    enableTaskSteps();
    state.sessions = [session("waiting")];
    const snapshot = structuredClone(state);
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    expect(outcome("还没完成").checked).toBe(true);
    expect(outcome("已完成").checked).toBe(false);
    fireEvent.click(outcome("已完成"));
    expect(outcome("已完成").checked).toBe(true);
    expect(outcome("还没完成").checked).toBe(false);
    fireEvent.click(outcome("还没完成"));
    expect(outcome("还没完成").checked).toBe(true);
    expect(mutations()).toHaveLength(0);
    expect(state).toEqual(snapshot);
    expect(screen.getAllByRole("button", { name: "保存并结束" })).toHaveLength(
      1,
    );
    expect(
      screen.queryByRole("button", { name: "完成这一步并结束" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "仅结束番茄钟" })).toBeNull();
    expect(screen.queryByRole("button", { name: "再专注一段" })).toBeNull();
    expect(screen.queryByRole("button", { name: "休息 5 分钟" })).toBeNull();
  });

  it("prioritizes one optional question and only asks about a blocker after the user selects it", async () => {
    state.sessions = [session("waiting")];
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(button("补充记录（可选）"));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByLabelText("下次起点")).toBeTruthy();
    expect(screen.queryByLabelText("卡点")).toBeNull();
    fireEvent.change(screen.getByLabelText("下次起点"), {
      target: { value: "从第四项继续核对" },
    });
    fireEvent.click(outcome("已完成"));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("产出"), {
      target: { value: "三项已核对" },
    });
    fireEvent.click(button("这轮卡住了"));
    expect(outcome("已完成").checked).toBe(true);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("卡点"), {
      target: { value: "最后一项的来源不清楚" },
    });
    fireEvent.click(outcome("还没完成"));
    expect(screen.getByLabelText("卡点")).toBeTruthy();
    fireEvent.click(button("按完成情况记录"));
    expect(
      (screen.getByLabelText("下次起点") as HTMLTextAreaElement).value,
    ).toBe("从第四项继续核对");
    showFeedbackFields();
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
    expect((screen.getByLabelText("产出") as HTMLTextAreaElement).value).toBe(
      "三项已核对",
    );
    expect((screen.getByLabelText("卡点") as HTMLTextAreaElement).value).toBe(
      "最后一项的来源不清楚",
    );
    expect(mutations()).toHaveLength(0);
  });

  it("keeps an explicit blocker question and its draft across navigation and restart", async () => {
    state.sessions = [session("waiting")];
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(button("补充记录（可选）"));
    fireEvent.click(button("这轮卡住了"));
    fireEvent.change(screen.getByLabelText("卡点"), {
      target: { value: "还缺一份参考文件" },
    });
    fireEvent.click(button("返回任务列表"));
    fireEvent.click(button("返回番茄钟"));
    await screen.findByRole("heading", { name: "结束番茄钟" });
    const expand = screen.queryByRole("button", { name: "补充记录（可选）" });
    if (expand) fireEvent.click(expand);
    expect((screen.getByLabelText("卡点") as HTMLTextAreaElement).value).toBe(
      "还缺一份参考文件",
    );
    cleanup();
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(button("补充记录（可选）"));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect((screen.getByLabelText("卡点") as HTMLTextAreaElement).value).toBe(
      "还缺一份参考文件",
    );
    expect(button("按完成情况记录").getAttribute("aria-pressed")).toBe("true");
    expect(mutations()).toHaveLength(0);
  });

  it.each([false, true])(
    "can skip every feedback field while completed is %s without inventing progress or starting another clock",
    async (completed) => {
      enableTaskSteps();
      state.sessions = [session("waiting")];
      render(<PaperApp />);
      await screen.findByRole("heading", { name: "结束番茄钟" });
      if (completed) fireEvent.click(outcome("已完成"));
      else {
        fireEvent.click(button("补充记录（可选）"));
        fireEvent.click(button("这轮卡住了"));
      }
      await act(async () => fireEvent.click(button("保存并结束")));
      expect(state.sessions[0].feedback).toEqual({
        outcome: completed ? "step_completed" : "stopped",
        output: null,
        blocker: null,
        nextCue: null,
      });
      expect(state.tasks[0].completed).toBe(false);
      expect(state.planning!.steps[0].completed).toBe(completed);
      expect(mutations().map(([, args]) => args.action)).toEqual([
        "finish_session",
      ]);
      expect(state.sessions).toHaveLength(1);
      expect(localStorage.getItem("paper-feedback-stuck-session")).toBeNull();
    },
  );

  it("preserves the chosen outcome and all feedback fields across navigation and reload", async () => {
    state.sessions = [session("waiting")];
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(outcome("已完成"));
    showFeedbackFields();
    for (const [name, value] of [
      ["产出", "已整理三条来源"],
      ["卡点", "一条来源仍需核对"],
      ["下次起点", "从第三条来源继续"],
    ])
      fireEvent.change(screen.getByLabelText(name), { target: { value } });
    fireEvent.click(button("返回任务列表"));
    fireEvent.click(button("返回番茄钟"));
    await screen.findByRole("heading", { name: "结束番茄钟" });
    expect(outcome("已完成").checked).toBe(true);
    showFeedbackFields();
    expect((screen.getByLabelText("产出") as HTMLTextAreaElement).value).toBe(
      "已整理三条来源",
    );
    cleanup();
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    expect(outcome("已完成").checked).toBe(true);
    showFeedbackFields();
    expect((screen.getByLabelText("产出") as HTMLTextAreaElement).value).toBe(
      "已整理三条来源",
    );
    expect((screen.getByLabelText("卡点") as HTMLTextAreaElement).value).toBe(
      "一条来源仍需核对",
    );
    expect(
      (screen.getByLabelText("下次起点") as HTMLTextAreaElement).value,
    ).toBe("从第三条来源继续");
    expect(mutations()).toHaveLength(0);
  });

  it("starts a new session with an unfinished choice and empty feedback without inheriting the previous draft", async () => {
    state.sessions = [session("waiting")];
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(outcome("已完成"));
    showFeedbackFields();
    fireEvent.click(button("这轮卡住了"));
    fireEvent.change(screen.getByLabelText("产出"), {
      target: { value: "上一轮独有的草稿" },
    });
    const previousDraft = localStorage.getItem("paper-feedback-session");
    state.sessions[0].status = "finished";
    state.sessions.push({ ...session("waiting"), id: "session-next" });
    await sync();
    expect(outcome("还没完成").checked).toBe(true);
    expect(outcome("已完成").checked).toBe(false);
    showFeedbackFields();
    expect(button("这轮卡住了").getAttribute("aria-pressed")).toBe("false");
    for (const name of ["产出", "卡点", "下次起点"])
      expect((screen.getByLabelText(name) as HTMLTextAreaElement).value).toBe(
        "",
      );
    expect(localStorage.getItem("paper-feedback-session")).toBe(previousDraft);
    expect(localStorage.getItem("paper-outcome-session")).toBe("true");
    expect(mutations()).toHaveLength(0);
  });

  it("keeps the end draft when a paused session returns to its timer and reopens feedback", async () => {
    state.sessions = [session("paused")];
    render(<PaperApp />);
    await screen.findByRole("timer");
    await act(async () => fireEvent.click(button("结束番茄钟")));
    fireEvent.click(outcome("已完成"));
    showFeedbackFields();
    fireEvent.change(screen.getByLabelText("产出"), {
      target: { value: "回计时页前写下的内容" },
    });
    fireEvent.click(button("返回番茄钟"));
    await screen.findByRole("timer");
    expect(state.sessions[0].status).toBe("paused");
    await act(async () => fireEvent.click(button("结束番茄钟")));
    expect(outcome("已完成").checked).toBe(true);
    showFeedbackFields();
    expect((screen.getByLabelText("产出") as HTMLTextAreaElement).value).toBe(
      "回计时页前写下的内容",
    );
    expect(mutations()).toHaveLength(0);
  });

  it("retains the end choice and notes after a failed save and retries without losing the draft", async () => {
    enableTaskSteps();
    state.sessions = [session("waiting")];
    const fallback = native.invoke.getMockImplementation()!;
    let failed = false;
    native.invoke.mockImplementation(async (command, args = {}) => {
      if (
        command === "paper_execute" &&
        args.action === "finish_session" &&
        !failed
      ) {
        failed = true;
        throw new Error("保存失败：连接暂时不可用");
      }
      return fallback(command, args);
    });
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(outcome("已完成"));
    showFeedbackFields();
    fireEvent.click(button("这轮卡住了"));
    fireEvent.change(screen.getByLabelText("产出"), {
      target: { value: "需要重试但不能丢失的产出" },
    });
    await act(async () => fireEvent.click(button("保存并结束")));
    expect(screen.getByRole("alert").textContent).toContain("连接暂时不可用");
    expect(outcome("已完成").checked).toBe(true);
    expect((screen.getByLabelText("产出") as HTMLTextAreaElement).value).toBe(
      "需要重试但不能丢失的产出",
    );
    expect(state.sessions[0].status).toBe("waiting");
    expect(state.planning!.steps[0].completed).toBe(false);
    expect(localStorage.getItem("paper-feedback-session")).toContain(
      "需要重试但不能丢失的产出",
    );
    expect(localStorage.getItem("paper-outcome-session")).toBe("true");
    expect(localStorage.getItem("paper-feedback-stuck-session")).toBe("true");
    expect(button("按完成情况记录").getAttribute("aria-pressed")).toBe("true");
    await act(async () => fireEvent.click(button("保存并结束")));
    expect(state.sessions[0].feedback).toMatchObject({
      outcome: "step_completed",
      output: "需要重试但不能丢失的产出",
    });
    expect(state.planning!.steps[0].completed).toBe(true);
    expect(state.tasks[0].completed).toBe(false);
    expect(localStorage.getItem("paper-feedback-session")).toBeNull();
    expect(localStorage.getItem("paper-outcome-session")).toBeNull();
    expect(localStorage.getItem("paper-feedback-stuck-session")).toBeNull();
    const saves = mutations().filter(
      ([, args]) => args.action === "finish_session",
    );
    expect(saves).toHaveLength(2);
    expect(saves[0][1].input.requestId).toBe(saves[1][1].input.requestId);
  });

  it.each(["running", "waiting"])(
    "uses the same English motto on the %s rest screen and home",
    async (status) => {
      await open();
      const motto = document.querySelector(".paper-motto")!.textContent;
      state.sessions = [
        {
          ...session(status),
          id: "rest-session",
          kind: "rest",
          taskId: null,
          taskTitle: "休息",
          action: null,
          plannedSeconds: 300,
          elapsedSeconds: status === "waiting" ? 300 : 0,
        },
      ];
      await sync();
      await screen.findByRole("heading", {
        name: status === "waiting" ? "休息结束" : "休息一下",
      });
      const snapshot = structuredClone(state.sessions[0]);
      expect(document.querySelector(".paper-motto")!.textContent).toBe(motto);
      expect(PAPER_MOTTOS).toContain(motto);
      expect(screen.queryByText("不用急，我在这里。")).toBeNull();
      expect(
        screen.getByText("Inky Paper", { selector: ".brand" }),
      ).toBeTruthy();
      expect(button("结束休息")).toBeTruthy();
      fireEvent.click(button("返回任务列表"));
      expect(document.querySelector(".paper-motto")!.textContent).toBe(motto);
      expect(state.sessions[0]).toEqual(snapshot);
      fireEvent.click(button("返回休息计时"));
      await screen.findByRole("timer");
      expect(document.querySelector(".paper-motto")!.textContent).toBe(motto);
      expect(mutations()).toHaveLength(0);
      await act(async () => fireEvent.click(button("结束休息")));
      expect(state.sessions[0].feedback?.outcome).toBe("rest_ended");
      expect(state.tasks[0].completed).toBe(false);
    },
  );

  it("returns from a running timer to the task list and back without mutating the session", async () => {
    state.sessions = [session()];
    const snapshot = structuredClone(state.sessions[0]);
    render(<PaperApp />);
    await screen.findByRole("timer");
    expect(screen.queryByRole("button", { name: "更多工作操作" })).toBeNull();
    expect(button("结束番茄钟")).toBeTruthy();
    fireEvent.click(button("返回任务列表"));
    expect(
      screen.getByRole("heading", { name: "就从这一步开始" }),
    ).toBeTruthy();
    expect(state.sessions[0]).toEqual(snapshot);
    fireEvent.click(button("返回番茄钟"));
    await screen.findByRole("timer");
    expect(state.sessions[0]).toEqual(snapshot);
    expect(mutations()).toHaveLength(0);
  });

  it("pauses a running timer before opening end feedback and returns without automatically resuming", async () => {
    state.sessions = [session()];
    render(<PaperApp />);
    await screen.findByRole("timer");
    await act(async () => fireEvent.click(button("结束番茄钟")));
    expect(screen.getByRole("heading", { name: "结束番茄钟" })).toBeTruthy();
    expect(state.sessions[0].status).toBe("paused");
    expect(state.sessions[0].lastResumedAt).toBeNull();
    expect(state.sessions[0].feedback).toBeNull();
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "pause_session",
    ]);
    expect(mutations()[0][1].input).toMatchObject({
      sessionId: "session",
      expectedRevision: 1,
    });
    const paused = structuredClone(state.sessions[0]);
    fireEvent.click(button("返回番茄钟"));
    await screen.findByRole("timer");
    expect(state.sessions[0]).toEqual(paused);
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "pause_session",
    ]);
  });

  it("keeps the running timer open if pausing before end feedback fails", async () => {
    state.sessions = [session()];
    const snapshot = structuredClone(state.sessions[0]);
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args = {}) => {
      if (command === "paper_execute" && args.action === "pause_session")
        throw new Error("CONFLICT: 本轮状态已变化，请重新读取");
      return fallback(command, args);
    });
    render(<PaperApp />);
    await screen.findByRole("timer");
    await act(async () => fireEvent.click(button("结束番茄钟")));
    expect(screen.getByRole("timer")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "结束番茄钟" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("本轮状态已变化");
    expect(state.sessions[0]).toEqual(snapshot);
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "pause_session",
    ]);
  });

  it("saves a paused timer's edited cue before opening end feedback", async () => {
    state.sessions = [session("paused")];
    render(<PaperApp />);
    await screen.findByRole("timer");
    fireEvent.change(screen.getByLabelText("回来先做什么"), {
      target: { value: "继续核对第三条证据" },
    });
    await act(async () => fireEvent.click(button("结束番茄钟")));
    expect(screen.getByRole("heading", { name: "结束番茄钟" })).toBeTruthy();
    expect(state.sessions[0].resumeCue).toBe("继续核对第三条证据");
    expect(state.sessions[0].status).toBe("paused");
    expect(mutations().map(([, args]) => args.action)).toEqual(["save_cue"]);
    expect(mutations()[0][1].input).toMatchObject({
      sessionId: "session",
      expectedRevision: 1,
      resumeCue: "继续核对第三条证据",
    });
  });

  it("keeps an unsaved cue on the paused timer when saving it before ending fails", async () => {
    state.sessions = [session("paused")];
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args = {}) => {
      if (command === "paper_execute" && args.action === "save_cue")
        throw new Error("保存失败：请重试");
      return fallback(command, args);
    });
    render(<PaperApp />);
    await screen.findByRole("timer");
    fireEvent.change(screen.getByLabelText("回来先做什么"), {
      target: { value: "保留我的继续线索" },
    });
    await act(async () => fireEvent.click(button("结束番茄钟")));
    expect(screen.getByRole("timer")).toBeTruthy();
    expect(
      (screen.getByLabelText("回来先做什么") as HTMLInputElement).value,
    ).toBe("保留我的继续线索");
    expect(screen.queryByRole("heading", { name: "结束番茄钟" })).toBeNull();
    expect(state.sessions[0].status).toBe("paused");
    expect(mutations().map(([, args]) => args.action)).toEqual(["save_cue"]);
  });

  it("lets a waiting timer return from feedback to the task list without finishing it", async () => {
    state.sessions = [session("waiting")];
    const snapshot = structuredClone(state.sessions[0]);
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(button("返回任务列表"));
    expect(
      screen.getByRole("heading", { name: "就从这一步开始" }),
    ).toBeTruthy();
    expect(state.sessions[0]).toEqual(snapshot);
    fireEvent.click(button("返回番茄钟"));
    await screen.findByRole("heading", { name: "结束番茄钟" });
    expect(state.sessions[0]).toEqual(snapshot);
    expect(mutations()).toHaveLength(0);
  });
  it.each([0, 0.99])(
    "chooses an English motto once at startup and keeps it while switching views (random=%s)",
    async (random) => {
      const draw = vi.spyOn(Math, "random").mockReturnValue(random);
      await open();
      const motto = document.querySelector(".paper-motto")!.textContent;
      expect(motto).toBe(
        PAPER_MOTTOS[Math.floor(random * PAPER_MOTTOS.length)],
      );
      expect(motto).toMatch(/[A-Za-z]/);
      draw.mockReturnValue(random === 0 ? 0.99 : 0);
      fireEvent.click(button("设置"));
      fireEvent.click(button("返回上一页"));
      expect(document.querySelector(".paper-motto")!.textContent).toBe(motto);
      allTasks();
      fireEvent.click(screen.getByRole("button", { name: /^任务 A/ }));
      await sync();
      expect(document.querySelector(".paper-motto")!.textContent).toBe(motto);
    },
  );
  it.each([null, "任务 A"])(
    "renders one sticky-note body when the next action is %s",
    async (action) => {
      state.tasks[0].nextAction = action
        ? { ...state.tasks[0].nextAction!, text: action }
        : null;
      await open();
      const note = within(screen.getByRole("region", { name: "当前步骤" }));
      expect(note.getAllByText("任务 A")).toHaveLength(1);
      expect(note.getByRole("heading", { name: "任务 A" })).toBeTruthy();
      expect(note.getByRole("button", { name: "start" })).toBeTruthy();
    },
  );

  it("manually completes and undoes the current step without completing its task or starting a clock", async () => {
    enableTaskSteps();
    await open();
    allTasks();
    fireEvent.click(screen.getByRole("button", { name: /^任务 A/ }));
    await act(async () => fireEvent.click(button("完成步骤：步骤 A")));
    expect(state.planning!.steps[0].completed).toBe(true);
    expect(state.tasks[0].nextAction?.completed).toBe(true);
    expect(state.tasks[0].completed).toBe(false);
    expect(state.sessions).toHaveLength(0);
    const note = () => within(screen.getByRole("region", { name: "当前步骤" }));
    expect(
      note()
        .getByRole("heading", { name: "步骤 A" })
        .classList.contains("crossed"),
    ).toBe(true);
    expect(note().queryByRole("button", { name: "start" })).toBeNull();
    await act(async () => fireEvent.click(button("撤销步骤完成：步骤 A")));
    expect(state.planning!.steps[0].completed).toBe(false);
    expect(state.tasks[0].nextAction?.completed).toBe(false);
    expect(state.tasks[0].completed).toBe(false);
    expect(state.sessions).toHaveLength(0);
    expect(
      note()
        .getByRole("heading", { name: "步骤 A" })
        .classList.contains("crossed"),
    ).toBe(false);
    expect(note().getByRole("button", { name: "start" })).toBeTruthy();
    expect(
      mutations().map(([, args]) => ({ ...args.input, requestId: undefined })),
    ).toEqual([
      {
        taskId: "A",
        stepId: "step-A",
        expectedTaskRevision: 1,
        expectedStepRevision: 1,
        completed: true,
        requestId: undefined,
      },
      {
        taskId: "A",
        stepId: "step-A",
        expectedTaskRevision: 2,
        expectedStepRevision: 2,
        completed: false,
        requestId: undefined,
      },
    ]);
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "set_step_completed",
      "set_step_completed",
    ]);
  });

  it("completes another step without changing the prepared note or historical session snapshot", async () => {
    enableTaskSteps();
    state.planning!.steps.push({
      ...state.planning!.steps[0],
      id: "step-A2",
      text: "核对来源",
    });
    state.sessions = [{ ...session("finished"), endedAt: Date.now() }];
    const snapshot = structuredClone(state.sessions[0]);
    await open();
    allTasks();
    fireEvent.click(screen.getByRole("button", { name: /^任务 A/ }));
    await act(async () => fireEvent.click(button("完成步骤：核对来源")));
    expect(state.planning!.steps[1].completed).toBe(true);
    expect(state.tasks[0].nextAction).toEqual(task("A").nextAction);
    expect(state.tasks[0].completed).toBe(false);
    expect(state.sessions).toEqual([snapshot]);
    expect(
      within(screen.getByRole("region", { name: "当前步骤" })).getByRole(
        "heading",
        { name: "步骤 A" },
      ),
    ).toBeTruthy();
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "set_step_completed",
    ]);
  });

  it("keeps a manual completion conflict visible without crossing the step or starting a clock", async () => {
    enableTaskSteps();
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args = {}) => {
      if (command === "paper_execute" && args.action === "set_step_completed")
        throw new Error("CONFLICT: 步骤已被更新，请重新读取");
      return fallback(command, args);
    });
    await open();
    allTasks();
    fireEvent.click(screen.getByRole("button", { name: /^任务 A/ }));
    await act(async () => fireEvent.click(button("完成步骤：步骤 A")));
    expect(screen.getByRole("alert").textContent).toContain("步骤已被更新");
    expect(state.planning!.steps[0].completed).toBe(false);
    expect(state.tasks[0].nextAction?.completed).toBe(false);
    expect(state.tasks[0].completed).toBe(false);
    expect(state.sessions).toHaveLength(0);
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "set_step_completed",
    ]);
  });

  it("submits one manual completion while its write is pending", async () => {
    enableTaskSteps();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args = {}) => {
      if (command === "paper_execute" && args.action === "set_step_completed")
        await pending;
      return fallback(command, args);
    });
    await open();
    allTasks();
    fireEvent.click(screen.getByRole("button", { name: /^任务 A/ }));
    const complete = button("完成步骤：步骤 A") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(complete);
      fireEvent.click(complete);
    });
    expect(complete.disabled).toBe(true);
    expect((button("start") as HTMLButtonElement).disabled).toBe(true);
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "set_step_completed",
    ]);
    await act(async () => {
      release();
      await pending;
    });
    expect(state.planning!.steps[0].completed).toBe(true);
    expect(state.sessions).toHaveLength(0);
  });

  it("completes and restores a task in the sheet without moving it or opening celebration", async () => {
    state.tasks.push(task("B"), task("C"));
    enableTaskSteps();
    await open();
    allTasks();
    const order = () =>
      Array.from(
        screen
          .getByRole("region", { name: "任务清单" })
          .querySelectorAll(".sheet-task-name"),
        (node) => node.textContent,
      );
    expect(order()).toEqual(["任务 A", "任务 B", "任务 C"]);
    fireEvent.click(screen.getByRole("button", { name: /^任务 B/ }));
    await act(async () => fireEvent.click(button("整个任务完成了：任务 B")));
    expect(state.tasks[1].completed).toBe(true);
    expect(
      screen.getByRole("heading", { name: "就从这一步开始" }),
    ).toBeTruthy();
    expect(order()).toEqual(["任务 A", "任务 B", "任务 C"]);
    expect(button("撤销完成：任务 B")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "收好，回到任务页" }),
    ).toBeNull();
    await act(async () => fireEvent.click(button("撤销完成：任务 B")));
    expect(state.tasks[1].completed).toBe(false);
    expect(order()).toEqual(["任务 A", "任务 B", "任务 C"]);
    expect(
      mutations().map(([, args]) => ({
        action: args.action,
        ...args.input,
        requestId: undefined,
      })),
    ).toEqual([
      {
        action: "update_task",
        taskId: "B",
        expectedRevision: 1,
        patch: { completed: true },
        requestId: undefined,
      },
      {
        action: "update_task",
        taskId: "B",
        expectedRevision: 2,
        patch: { completed: false },
        requestId: undefined,
      },
    ]);
  });
  it("selects another parent's current step into the top card and starts only on start", async () => {
    state.tasks.push(task("B"));
    enableTaskSteps();
    await open();
    await selectTaskStep("B");
    expect(
      within(screen.getByRole("region", { name: "当前步骤" })).getByRole(
        "heading",
        { name: "步骤 B" },
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText("专注时长") as HTMLSelectElement).value).toBe(
      "20",
    );
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "prepare_step",
    ]);
    expect(state.sessions).toHaveLength(0);
    expect(mutations()[0][1].input).toMatchObject({
      taskId: "B",
      stepId: "step-B",
      expectedRevision: 1,
      expectedStepRevision: 1,
    });
    await act(async () => fireEvent.click(button("start")));
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "prepare_step",
      "start_session",
    ]);
    expect(mutations()[1][1].input).toMatchObject({
      taskId: "B",
      stepId: "step-B",
      expectedRevision: 1,
      expectedStepRevision: 1,
      plannedSeconds: 1200,
    });
    expect(state.sessions[0].action?.id).toBe("step-B");
    expect(screen.getByRole("timer")).toBeTruthy();
  });

  it("switches an active work target before starting the selected step", async () => {
    state.tasks.push(task("B"));
    enableTaskSteps();
    state.coach.blocks = [block()];
    await open();
    await selectTaskStep("B");
    expect(state.coach.blocks[0].taskId).toBe("A");
    await act(async () => fireEvent.click(button("start")));
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "prepare_step",
      "switch_work_task",
      "start_session",
    ]);
    expect(mutations()[1][1].input).toMatchObject({
      blockId: "block",
      expectedRevision: 1,
      taskId: "B",
      expectedTaskRevision: 1,
    });
    expect(state.coach.blocks[0].taskId).toBe("B");
    expect(state.coach.blocks[0].revision).toBe(2);
    expect(state.sessions[0].taskId).toBe("B");
    expect(state.sessions[0].plannedSeconds).toBe(1200);
    expect(screen.getByRole("timer")).toBeTruthy();
  });

  it("keeps the selected card and starts no clock when a work switch conflicts", async () => {
    state.tasks.push(task("B"));
    enableTaskSteps();
    state.coach.blocks = [block()];
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args = {}) => {
      if (command === "paper_execute" && args.action === "switch_work_task")
        throw new Error("CONFLICT: 工作目标已变化，请重新读取");
      return fallback(command, args);
    });
    await open();
    await selectTaskStep("B");
    await act(async () => fireEvent.click(button("start")));
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "prepare_step",
      "switch_work_task",
    ]);
    expect(state.coach.blocks[0].taskId).toBe("A");
    expect(state.sessions).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("工作目标已变化");
    expect(
      within(screen.getByRole("region", { name: "当前步骤" })).getByRole(
        "heading",
        { name: "步骤 B" },
      ),
    ).toBeTruthy();
  });

  it("reports an unfinished start when the target switches but the clock write conflicts", async () => {
    state.tasks.push(task("B"));
    enableTaskSteps();
    state.coach.blocks = [block()];
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args = {}) => {
      if (command === "paper_execute" && args.action === "start_session")
        throw new Error("CONFLICT: 步骤已被更新");
      return fallback(command, args);
    });
    await open();
    await selectTaskStep("B");
    await act(async () => fireEvent.click(button("start")));
    expect(state.coach.blocks[0].taskId).toBe("B");
    expect(state.sessions).toHaveLength(0);
    expect(native.invoke).toHaveBeenCalledWith("paper_show_notice", {
      id: expect.any(String),
      message: "工作目标已切换，本轮尚未开始。看过错误提示后可重试 start。",
    });
    expect(screen.queryByText(/工作目标已切换，本轮尚未开始/)).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("starts an independent round without switching an expired work block", async () => {
    state.tasks.push(task("B"));
    enableTaskSteps();
    state.coach.blocks = [{ ...block(), status: "expired" }];
    await open();
    await selectTaskStep("B");
    await act(async () => fireEvent.click(button("start")));
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "prepare_step",
      "start_session",
    ]);
    expect(state.coach.blocks[0].taskId).toBe("A");
    expect(state.coach.blocks[0].status).toBe("expired");
    expect(state.sessions[0].taskId).toBe("B");
    expect(screen.getByRole("timer")).toBeTruthy();
  });

  it.each(["running", "paused", "waiting", "rest"])(
    "keeps a %s round immutable while browsing the task sheet",
    async (status) => {
      state.tasks.push(task("B"));
      enableTaskSteps();
      state.sessions = [session()];
      render(<PaperApp />);
      await screen.findByRole("timer");
      fireEvent.click(button("返回任务列表"));
      if (status === "rest") {
        state.sessions[0].kind = "rest";
        state.sessions[0].taskId = null;
        state.sessions[0].taskTitle = "休息";
        state.sessions[0].action = null;
      } else {
        state.sessions[0].status = status;
        if (status !== "running") state.sessions[0].lastResumedAt = null;
      }
      await sync();
      const snapshot = structuredClone(state.sessions[0]);
      allTasks();
      if (!screen.queryByRole("button", { name: "Do this：步骤 B" }))
        fireEvent.click(screen.getByRole("button", { name: /^任务 B/ }));
      const otherStep = button("Do this：步骤 B") as HTMLButtonElement;
      expect(otherStep.disabled).toBe(true);
      fireEvent.click(otherStep);
      const completeOtherStep = button("完成步骤：步骤 B") as HTMLButtonElement;
      expect(completeOtherStep.disabled).toBe(true);
      fireEvent.click(completeOtherStep);
      fireEvent.click(
        button(status === "rest" ? "返回休息计时" : "返回番茄钟"),
      );
      if (status === "waiting")
        await screen.findByRole("heading", { name: "结束番茄钟" });
      else await screen.findByRole("timer");
      expect(mutations()).toHaveLength(0);
      expect(state.sessions[0]).toEqual(snapshot);
      expect(state.tasks[1].nextAction?.id).toBe("step-B");
    },
  );

  it("crosses out a finished step in its expanded parent without completing that task", async () => {
    enableTaskSteps();
    state.planning!.steps.push({
      id: "step-A2",
      taskId: "A",
      text: "继续核对证据",
      expectedResult: null,
      plannedSeconds: 1500,
      completed: false,
      revision: 1,
    });
    state.sessions = [session("waiting")];
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(outcome("已完成"));
    expect(mutations()).toHaveLength(0);
    await act(async () => fireEvent.click(button("保存并结束")));
    fireEvent.click(await screen.findByRole("button", { name: "回到任务页" }));
    allTasks();
    fireEvent.click(screen.getByRole("button", { name: /^任务 A/ }));
    const completed = () =>
      screen
        .getByText("步骤 A", { selector: ".sheet-step .pencil-line" })
        .closest(".sheet-step");
    expect(completed()?.classList.contains("is-done")).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Do this：步骤 A" }),
    ).toBeNull();
    expect(
      (button("Do this：继续核对证据") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.getByLabelText("1 步已完成，共 2 步")).toBeTruthy();
    expect(state.tasks[0].completed).toBe(false);
    expect(state.planning!.steps[0].completed).toBe(true);
    expect(state.planning!.steps[1].completed).toBe(false);
    expect(mutations().map(([, args]) => args.action)).toEqual([
      "finish_session",
    ]);
    await sync();
    expect(completed()?.classList.contains("is-done")).toBe(true);
  });

  it("continues the exact saved step and future source without starting a clock", async () => {
    enableTaskSteps();
    const original = state.planning!.steps[0];
    state.planning!.steps.push({
      ...original,
      id: "step-A2",
      text: "另一个步骤",
      plannedSeconds: 600,
    });
    state.planning!.dayItems = [
      {
        id: "future-source",
        taskId: "A",
        stepId: original.id,
        date: "2099-01-03",
        order: 0,
        revision: 1,
        removedAt: null,
      },
    ];
    state.planning!.sessionLinks = [
      {
        sessionId: "session",
        dayItemId: "future-source",
        planDate: "2099-01-03",
      },
    ];
    state.sessions = [session("waiting")];
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(button("补充记录（可选）"));
    fireEvent.change(screen.getByLabelText("下次起点"), {
      target: { value: "核对第三项" },
    });
    await act(async () => fireEvent.click(button("保存并结束")));
    state.tasks[0].nextAction = {
      id: "step-A2",
      text: "另一个步骤",
      completed: false,
      source: "user",
    };
    state.tasks[0].revision += 1;
    await sync();
    const snapshots = structuredClone(state.sessions);
    await act(async () => fireEvent.click(button("继续这一步")));
    expect(state.planning!.prepared).toEqual({
      taskId: "A",
      stepId: original.id,
      dayItemId: "future-source",
    });
    expect(mutations().map(([, a]) => a.action)).toEqual([
      "finish_session",
      "prepare_step",
    ]);
    expect(state.sessions).toEqual(snapshots);
    expect(
      screen.getByText("核对第三项", { selector: ".resume-hint" }),
    ).toBeTruthy();
    expect(screen.getByText(/来自 2099-01-03 的安排/)).toBeTruthy();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("does not turn a cancelled continuation source into unplanned execution", async () => {
    enableTaskSteps();
    state.planning!.dayItems = [
      {
        id: "source",
        taskId: "A",
        stepId: "step-A",
        date: localDate(),
        order: 0,
        revision: 1,
        removedAt: null,
      },
    ];
    state.planning!.sessionLinks = [
      { sessionId: "session", dayItemId: "source", planDate: localDate() },
    ];
    state.sessions = [session("waiting")];
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    await act(async () => fireEvent.click(button("保存并结束")));
    state.planning!.dayItems[0].removedAt = Date.now();
    state.planning!.dayItems[0].revision += 1;
    await sync();
    await act(async () => fireEvent.click(button("继续这一步")));
    expect(screen.getByRole("alert").textContent).toContain(
      "不会自动改成计划外执行",
    );
    expect(mutations().map(([, a]) => a.action)).toEqual(["finish_session"]);
    fireEvent.click(button("选择其他步骤"));
    await act(async () => fireEvent.click(button("Do this：步骤 A")));
    expect(state.planning!.prepared?.dayItemId).toBeNull();
    expect(state.sessions).toHaveLength(1);
  });

  it("opens the parent's next steps and prepares a picked step without timing it", async () => {
    enableTaskSteps();
    state.planning!.steps.push({
      ...state.planning!.steps[0],
      id: "step-A2",
      text: "核对下一项",
      plannedSeconds: 600,
    });
    state.sessions = [session("waiting")];
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(outcome("已完成"));
    await act(async () => fireEvent.click(button("保存并结束")));
    expect(screen.queryByRole("region", { name: "父任务收尾" })).toBeNull();
    fireEvent.click(button("选择下一步"));
    expect(
      screen.getByRole("button", { name: "Do this：核对下一项" }),
    ).toBeTruthy();
    expect(mutations().map(([, a]) => a.action)).toEqual(["finish_session"]);
    await act(async () => fireEvent.click(button("Do this：核对下一项")));
    expect(state.planning!.prepared?.stepId).toBe("step-A2");
    expect(mutations().map(([, a]) => a.action)).toEqual([
      "finish_session",
      "prepare_step",
    ]);
    expect(state.sessions).toHaveLength(1);
    expect((screen.getByLabelText("专注时长") as HTMLSelectElement).value).toBe(
      "10",
    );
  });

  it("keeps the parent's dismissal across restart and text edits but asks again after a completion cycle", async () => {
    enableTaskSteps();
    state.sessions = [session("waiting")];
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(outcome("已完成"));
    await act(async () => fireEvent.click(button("保存并结束")));
    expect(screen.getByRole("region", { name: "父任务收尾" })).toBeTruthy();
    expect(state.tasks[0].completed).toBe(false);
    await act(async () => fireEvent.click(button("保留后续")));
    expect(screen.queryByRole("region", { name: "父任务收尾" })).toBeNull();
    expect(mutations()[1][1].input.steps).toEqual([
      { id: "step-A", revision: 2 },
    ]);
    expect(state.tasks[0].completed).toBe(false);
    cleanup();
    await open();
    expect(screen.queryByRole("region", { name: "父任务收尾" })).toBeNull();
    state.tasks[0].title = "改过标题";
    state.tasks[0].revision += 1;
    state.planning!.steps[0].text = "改过文字";
    state.planning!.steps[0].revision += 1;
    await sync();
    expect(screen.queryByRole("region", { name: "父任务收尾" })).toBeNull();
    state.planning!.steps[0].completed = false;
    state.planning!.manualStepChanges = [
      {
        id: "undo",
        taskId: "A",
        stepId: "step-A",
        taskTitle: "改过标题",
        stepText: "改过文字",
        completed: false,
        recordedAt: 100,
      },
    ];
    await sync();
    expect(screen.queryByRole("region", { name: "父任务收尾" })).toBeNull();
    state.planning!.steps[0].completed = true;
    state.planning!.steps[0].revision += 2;
    state.planning!.manualStepChanges.push({
      ...state.planning!.manualStepChanges[0],
      id: "redo",
      completed: true,
      recordedAt: 101,
    });
    await sync();
    expect(screen.getByRole("region", { name: "父任务收尾" })).toBeTruthy();
    expect(state.tasks[0].completed).toBe(false);
  });

  it("only completes the parent after its explicit confirmation", async () => {
    enableTaskSteps();
    state.sessions = [session("waiting")];
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(outcome("已完成"));
    await act(async () => fireEvent.click(button("保存并结束")));
    expect(state.tasks[0].completed).toBe(false);
    await act(async () => fireEvent.click(button("整个任务已完成")));
    expect(state.tasks[0].completed).toBe(true);
    expect(mutations().map(([, a]) => a.action)).toEqual([
      "finish_session",
      "update_task",
    ]);
    expect(screen.getByRole("region", { name: "任务完成庆祝" })).toBeTruthy();
    expect(state.sessions).toHaveLength(1);
  });

  it("retains a failed parent acknowledgement for a stable retry", async () => {
    enableTaskSteps();
    state.planning!.steps[0].completed = true;
    state.tasks[0].nextAction!.completed = true;
    const fallback = native.invoke.getMockImplementation()!;
    let failed = false;
    native.invoke.mockImplementation(async (command, args = {}) => {
      if (
        command === "paper_execute" &&
        args.action === "acknowledge_task_completion" &&
        !failed
      ) {
        failed = true;
        throw new Error("暂时保存失败");
      }
      return fallback(command, args);
    });
    await open();
    await act(async () => fireEvent.click(button("保留后续")));
    expect(screen.getByRole("region", { name: "父任务收尾" })).toBeTruthy();
    expect(state.planning!.taskCompletionAcknowledgements).toBeUndefined();
    await act(async () => fireEvent.click(button("保留后续")));
    expect(screen.queryByRole("region", { name: "父任务收尾" })).toBeNull();
    const requests = mutations().filter(
      ([, a]) => a.action === "acknowledge_task_completion",
    );
    expect(requests[0][1].input.requestId).toBe(requests[1][1].input.requestId);
    expect(state.tasks[0].completed).toBe(false);
  });

  it("uses the shared exact-step cue after A to B to A and does not revive a cleared cue", async () => {
    enableTaskSteps();
    state.planning!.steps.push({
      ...state.planning!.steps[0],
      id: "step-A2",
      text: "另一步",
    });
    state.sessions = [
      {
        ...session("finished"),
        id: "a-old",
        endedAt: 100,
        feedback: {
          outcome: "stopped",
          output: null,
          blocker: null,
          nextCue: "A 的起点",
        },
      },
      {
        ...session("finished"),
        id: "b",
        endedAt: 200,
        action: {
          id: "step-A2",
          text: "另一步",
          completed: false,
          source: "user",
        },
        feedback: {
          outcome: "stopped",
          output: null,
          blocker: null,
          nextCue: "B 的起点",
        },
      },
    ];
    state.planning!.prepared = {
      taskId: "A",
      stepId: "step-A",
      dayItemId: null,
    };
    await open();
    expect(
      screen.getByText("A 的起点", { selector: ".resume-hint" }),
    ).toBeTruthy();
    expect(
      screen.queryByText("B 的起点", { selector: ".resume-hint" }),
    ).toBeNull();
    state.sessions.push({
      ...session("finished"),
      id: "a-latest",
      endedAt: 300,
      feedback: {
        outcome: "stopped",
        output: null,
        blocker: null,
        nextCue: null,
      },
    });
    await sync();
    expect(document.querySelector(".resume-hint")).toBeNull();
    expect(mutations()).toHaveLength(0);
  });

  it("starts only an explicitly chosen rest and does not start focus when rest ends", async () => {
    enableTaskSteps();
    state.sessions = [session("waiting")];
    render(<PaperApp />);
    await screen.findByRole("heading", { name: "结束番茄钟" });
    fireEvent.click(outcome("已完成"));
    await act(async () => fireEvent.click(button("保存并结束")));
    expect(state.sessions).toHaveLength(1);
    await act(async () => fireEvent.click(button("休息 5 分钟")));
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[1].kind).toBe("rest");
    state.sessions[1].status = "waiting";
    await sync();
    await act(async () => fireEvent.click(button("结束休息")));
    expect(state.sessions.every((s) => s.status === "finished")).toBe(true);
    expect(
      mutations()
        .filter(([, a]) => a.action === "start_session")
        .map(([, a]) => a.input.kind),
    ).toEqual(["rest"]);
  });

  it("requires explicit unplanned reselection after the prepared source is removed", async () => {
    state.planning = {
      steps: [
        {
          id: "step-A",
          taskId: "A",
          text: "步骤 A",
          expectedResult: null,
          plannedSeconds: 1200,
          completed: false,
          revision: 1,
        },
      ],
      dayItems: [
        {
          id: "today-A",
          date: localDate(),
          taskId: "A",
          stepId: "step-A",
          order: 0,
          revision: 1,
          removedAt: null,
        },
      ],
    };
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args = {}) => {
      if (command === "paper_execute") {
        const { action, input = {} } = args;
        if (action === "get_daily_record")
          return {
            date: input.date,
            sessions: [],
            summaries: [],
            personalNotes: "",
          };
        if (action === "remove_plan_item") {
          state.planning!.dayItems[0].removedAt = Date.now();
          state.planning!.dayItems[0].revision += 1;
          return { item: structuredClone(state.planning!.dayItems[0]) };
        }
        if (action === "start_session") {
          if (input.dayItemId) throw new Error("NOT_FOUND: daily plan item");
          state.sessions = [
            { ...session(), plannedSeconds: input.plannedSeconds },
          ];
          return { session: structuredClone(state.sessions[0]) };
        }
      }
      return fallback(command, args);
    });
    await open();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /今日计划与记录/ })),
    );
    await act(async () => fireEvent.click(button("准备这一轮")));
    await screen.findByRole("heading", { name: "就从这一步开始" });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /今日计划与记录/ })),
    );
    await act(async () => fireEvent.click(button("移出这一天")));
    fireEvent.click(button("返回上一页"));
    expect(screen.getByRole("alert").textContent).toContain(
      "原来的安排已取消或变化",
    );
    expect((button("start") as HTMLButtonElement).disabled).toBe(true);
    expect(
      mutations().some(([, args]) => args.action === "start_session"),
    ).toBe(false);
    await selectTaskStep("A");
    expect(state.planning!.prepared!.dayItemId).toBeNull();
    await act(async () => fireEvent.click(button("start")));
    const startCall = native.invoke.mock.calls.find(
      ([, args]) => args?.action === "start_session",
    );
    expect(startCall?.[1].input).toMatchObject({
      taskId: "A",
      stepId: "step-A",
      expectedStepRevision: 1,
      plannedSeconds: 1200,
    });
    expect(startCall?.[1].input).not.toHaveProperty("dayItemId");
    expect(screen.getByRole("timer")).toBeTruthy();
  });
  it("loads work history on demand and limits each group to 20 rows", async () => {
    const sessions = Array.from({ length: 45 }, (_, i) => ({
      ...session("finished"),
      id: `history-${i}`,
    }));
    const work = block();
    work.sessionIds = sessions.map((s) => s.id);
    const renderer = vi.fn(() => <SessionHistoryList sessions={sessions} />);
    const { container } = render(
      <WorkHistory
        coach={{ ...state.coach, blocks: [work] }}
        renderSessions={renderer}
      />,
    );
    expect(renderer).not.toHaveBeenCalled();
    await act(async () => {
      const details = container.querySelector("details")!;
      details.open = true;
      fireEvent(details, new Event("toggle"));
    });
    expect(container.querySelectorAll("article article")).toHaveLength(20);
    fireEvent.click(button("加载更多轮次"));
    expect(container.querySelectorAll("article article")).toHaveLength(40);
  });
  it("returns to feedback when a timer ends while browsing another page", async () => {
    state.sessions = [session()];
    render(<PaperApp />);
    await screen.findByRole("timer");
    fireEvent.click(button("返回任务列表"));
    state.sessions[0].status = "waiting";
    state.sessions[0].lastResumedAt = null;
    state.sessions[0].elapsedSeconds = 1500;
    await sync();
    fireEvent.click(button("返回番茄钟"));
    expect(button("保存并结束")).toBeTruthy();
    expect(outcome("还没完成").checked).toBe(true);
    expect(screen.queryByRole("timer")).toBeNull();
  });
  it("keeps the chosen start task when an Agent inserts a newer task", async () => {
    await open();
    await act(async () => fireEvent.click(button("安排一个工作时段")));
    state.tasks.unshift(task("B"));
    await sync();
    expect(screen.getByRole("heading", { name: "步骤 A" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("本轮计时"), {
      target: { value: "0" },
    });
    await act(async () => fireEvent.click(button("开始工作")));
    const call = native.invoke.mock.calls.find(
      ([, args]) => args?.action === "start_work",
    );
    expect(call?.[1].input).toMatchObject({
      taskId: "A",
      expectedRevision: 2,
      goal: "步骤 A",
    });
  });
  it("requires reviewing the latest chosen task before starting after an external edit", async () => {
    await open();
    await act(async () => fireEvent.click(button("安排一个工作时段")));
    state.tasks[0].revision += 1;
    state.tasks[0].nextAction!.text = "新的步骤";
    await sync();
    expect((button("开始工作并计时") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button("使用最新任务内容"));
    expect(screen.getByRole("heading", { name: "新的步骤" })).toBeTruthy();
    expect((button("开始工作并计时") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
  it("keeps active work reachable when all tasks are complete", async () => {
    state.coach.blocks = [block()];
    await open();
    state.tasks[0].completed = true;
    await sync();
    fireEvent.click(screen.getByRole("button", { name: /本段工作 ·/ }));
    expect(button("结束本段工作")).toBeTruthy();
    expect((button("开始一轮计时") as HTMLButtonElement).disabled).toBe(true);
  });
  it("returns from settings to help and then to the work overview", async () => {
    state.coach.blocks = [block()];
    await open();
    fireEvent.click(screen.getByRole("button", { name: /本段工作 ·/ }));
    fireEvent.click(button("卡住了，帮我理一下"));
    fireEvent.click(button("设置"));
    fireEvent.click(button("返回上一页"));
    expect(
      screen.getByRole("heading", { name: "把下一步理清楚" }),
    ).toBeTruthy();
    fireEvent.click(button("返回上一页"));
    expect(button("结束本段工作")).toBeTruthy();
  });
  it("lets standalone focus browse tasks without changing the clock", async () => {
    state.sessions = [session()];
    render(<PaperApp />);
    await screen.findByRole("timer");
    fireEvent.click(button("返回任务列表"));
    fireEvent.click(button("设置"));
    fireEvent.click(button("返回上一页"));
    expect(button("返回番茄钟")).toBeTruthy();
    expect(
      native.invoke.mock.calls.filter(
        ([, args]) => args?.action && args.action !== "get_state",
      ),
    ).toHaveLength(0);
  });
  it("saves an ordinary stop once and returns directly to tasks", async () => {
    enableTaskSteps();
    state.sessions = [session("paused")];
    render(<PaperApp />);
    await screen.findByRole("timer");
    await act(async () => fireEvent.click(button("结束番茄钟")));
    expect(outcome("还没完成").checked).toBe(true);
    expect(screen.queryByLabelText("产出")).toBeNull();
    fireEvent.click(button("补充记录（可选）"));
    fireEvent.click(button("其他记录（可选）"));
    fireEvent.change(screen.getByLabelText("产出"), {
      target: { value: "已整理两条证据" },
    });
    await act(async () => fireEvent.click(button("保存并结束")));
    expect(
      screen.getByRole("heading", { name: "就从这一步开始" }),
    ).toBeTruthy();
    expect(state.sessions[0].status).toBe("finished");
    expect(state.sessions[0].feedback).toMatchObject({
      outcome: "stopped",
      output: "已整理两条证据",
    });
    expect(state.tasks[0].completed).toBe(false);
    expect(state.tasks[0].nextAction?.completed).toBe(false);
    expect(state.planning!.steps[0].completed).toBe(false);
    expect(
      native.invoke.mock.calls.filter(
        ([, args]) => args?.action === "finish_session",
      ),
    ).toHaveLength(1);
    expect(
      native.invoke.mock.calls.filter(
        ([, args]) => args?.action === "end_session",
      ),
    ).toHaveLength(0);
  });
  it("does not create blank or unchanged edit drafts", async () => {
    await open();
    fireEvent.click(button("临时做一件"));
    fireEvent.click(button("稍后再写"));
    expect(localStorage.getItem("paper-edit-draft")).toBeNull();
    fireEvent.click(button("修改下一步"));
    fireEvent.click(button("稍后再写"));
    expect(localStorage.getItem("paper-draft-A")).toBeNull();
  });
  it("preserves real edit drafts and removes them when changes are undone", async () => {
    await open();
    fireEvent.click(button("修改下一步"));
    fireEvent.change(screen.getByLabelText("任务名称"), {
      target: { value: "我的修改" },
    });
    expect(JSON.parse(localStorage.getItem("paper-edit-draft")!).title).toBe(
      "我的修改",
    );
    fireEvent.change(screen.getByLabelText("任务名称"), {
      target: { value: "任务 A" },
    });
    expect(localStorage.getItem("paper-edit-draft")).toBeNull();
  });
  it("does not render an empty independent history group", async () => {
    state.coach.blocks = [block()];
    await open();
    fireEvent.click(button("足迹"));
    expect(screen.queryByText("独立计时记录")).toBeNull();
  });
});
