// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import PlanCards from "./PlanCards";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
const batch = {
  batch: {
    id: "batch",
    revision: 1,
    cards: [
      { id: "card", taskId: "task", text: "核对日期", plannedSeconds: 900 },
    ],
  },
  tasks: [],
  steps: [],
  dayItems: [],
};
afterEach(() => {
  cleanup();
  localStorage.clear();
  mockedInvoke.mockReset();
});

it("does not ask to re-approve a card already adopted on its saved date", async () => {
  mockedInvoke.mockResolvedValue({
    ...batch,
    batch: {
      ...batch.batch,
      cards: [
        {
          ...batch.batch.cards[0],
          adoptedStepId: "step",
          expectedTaskRevision: 1,
        },
      ],
    },
    tasks: [{ id: "task", title: "工作台", revision: 3 }],
    steps: [{ id: "step", taskId: "task", text: "核对日期", revision: 1 }],
    dayItems: [
      { id: "item", date: "2030-03-04", stepId: "step", removedAt: null },
    ],
  });
  render(
    <PlanCards
      id="batch"
      streaming={false}
      onSaved={vi.fn()}
      defaultDate="2030-03-04"
    />,
  );
  await screen.findByRole("button", { name: "已加入计划" });
  expect(screen.queryByText("相关任务已有更新：")).toBeNull();
  expect(
    screen.getByRole("button", { name: "设为下一步并回到 Inky" }),
  ).toBeTruthy();
});

it("freezes the request date and keeps a manually edited date across remounts", async () => {
  mockedInvoke.mockResolvedValue(batch);
  const props = { id: "batch", streaming: false, onSaved: vi.fn() };
  const view = render(<PlanCards {...props} defaultDate="2030-03-04" />);
  const date = (await screen.findByLabelText(
    "建议安排日期",
  )) as HTMLInputElement;
  expect(date.value).toBe("2030-03-04");
  view.rerender(<PlanCards {...props} defaultDate="2030-03-08" />);
  expect(date.value).toBe("2030-03-04");
  fireEvent.change(date, { target: { value: "2030-03-06" } });
  view.unmount();
  render(<PlanCards {...props} defaultDate="2030-03-10" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "采用这一步 · 加入 3月6日" }),
  );
  await waitFor(() =>
    expect(mockedInvoke).toHaveBeenCalledWith(
      "paper_execute",
      expect.objectContaining({
        action: "adopt_plan_cards",
        input: expect.objectContaining({ date: "2030-03-06" }),
      }),
    ),
  );
});

it("requires a date for legacy suggestions and retries an uncertain adoption with identical parameters", async () => {
  let attempts = 0;
  mockedInvoke.mockImplementation(async (_command, args) => {
    if (
      args &&
      "action" in args &&
      args.action === "adopt_plan_cards" &&
      ++attempts === 1
    )
      throw Error("连接中断");
    return batch;
  });
  const props = { id: "legacy", streaming: false, onSaved: vi.fn() };
  const view = render(<PlanCards {...props} />);
  const date = (await screen.findByLabelText(
    "建议安排日期",
  )) as HTMLInputElement;
  expect(date.value).toBe("");
  expect(
    (
      screen.getByRole("button", {
        name: "请选择安排日期",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(date, { target: { value: "2030-03-06" } });
  fireEvent.click(
    screen.getByRole("button", { name: "采用这一步 · 加入 3月6日" }),
  );
  await screen.findByText("连接中断");
  view.unmount();
  render(<PlanCards {...props} defaultDate="2030-03-10" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "核实并重试 · 3月6日" }),
  );
  await waitFor(() => expect(attempts).toBe(2));
  const requests = mockedInvoke.mock.calls.filter(
    ([, args]) =>
      args && "action" in args && args.action === "adopt_plan_cards",
  );
  expect(requests[1][1]).toEqual(requests[0][1]);
});
