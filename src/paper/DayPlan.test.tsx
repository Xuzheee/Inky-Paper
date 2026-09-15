// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DayPlan, localDate, TaskSteps } from "./DayPlan";
import { emptyCoach } from "./CoachUI";
import type { PlanStep, State, Task } from "./paperTypes";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
const step: PlanStep = {
  id: "step-one",
  taskId: "task-one",
  text: "列出三个结论",
  expectedResult: "三条结论",
  plannedSeconds: 1500,
  completed: false,
  revision: 3,
};
const task: Task = {
  id: "task-one",
  title: "项目周报",
  due: null,
  category: "work",
  priority: "medium",
  completed: false,
  nextAction: null,
  revision: 4,
  source: "hermes",
  updatedAt: Date.now(),
};
const state = (): State => ({
  tasks: [task],
  sessions: [],
  notes: [],
  coach: emptyCoach,
  planning: {
    steps: [step],
    dayItems: [
      {
        id: "day-one",
        date: localDate(),
        taskId: task.id,
        stepId: step.id,
        order: 0,
        revision: 2,
        removedAt: null,
      },
    ],
  },
});
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue({
    date: localDate(),
    sessions: [],
    summaries: [],
    personalNotes: "",
  });
});
afterEach(cleanup);
describe("shared daily cards", () => {
  it("prepares the existing step without starting a clock or asking a model", async () => {
    const choose = vi.fn().mockResolvedValue(undefined);
    render(
      <DayPlan
        data={state()}
        busy={false}
        hasSession={false}
        mutate={vi.fn()}
        choose={choose}
        reportError={vi.fn()}
      />,
    );
    await screen.findByText(/不会自动发起总结/);
    fireEvent.click(screen.getByRole("button", { name: "准备这一轮" }));
    expect(choose).toHaveBeenCalledWith(
      step,
      expect.objectContaining({ id: "day-one", stepId: step.id }),
    );
    expect(
      mocks.invoke.mock.calls.every(
        ([name, args]) =>
          name === "paper_execute" && args.action === "get_daily_record",
      ),
    ).toBe(true);
  });
  it("removes only a daily reference and preserves task and execution data", async () => {
    const mutate = vi.fn().mockResolvedValue({ item: {} });
    render(
      <DayPlan
        data={state()}
        busy={false}
        hasSession={true}
        mutate={mutate}
        choose={vi.fn()}
        reportError={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "移出这一天" }));
    expect(mutate).toHaveBeenCalledWith("remove_plan_item", {
      planItemId: "day-one",
      expectedRevision: 2,
    });
    expect(
      (
        screen.getByRole("button", {
          name: "先完成当前一轮",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
  });
  it("keeps each step identity when choosing among steps in one task", () => {
    const data = state();
    data.planning!.steps.push({
      ...step,
      id: "step-two",
      text: "补齐数据",
      revision: 1,
    });
    const choose = vi.fn().mockResolvedValue(undefined);
    render(<TaskSteps task={task} data={data} busy={false} choose={choose} />);
    fireEvent.click(screen.getByText("完整步骤 · 0/2"));
    fireEvent.click(screen.getByRole("button", { name: /补齐数据/ }));
    expect(choose).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "step-two",
        taskId: "task-one",
        revision: 1,
      }),
    );
  });
});
