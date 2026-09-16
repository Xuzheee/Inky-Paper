// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { State } from "../paper/paperTypes";
import DayCapacity from "./DayCapacity";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const state = (): State => ({
  tasks: [],
  sessions: [],
  notes: [],
  coach: {
    blocks: [],
    proposals: [],
    analysisStatus: "",
    settings: { enabled: false, hermes: false, revision: 1 },
    activities: [],
  },
  planning: { steps: [], dayItems: [], context: { days: [] } },
});
const capacity = {
  availableMinutes: null,
  reservedMinutes: 60,
  unestimatedCount: 1,
  calendarOccupiedMinutes: 45,
  overlapPairs: [],
  unavailableConflicts: [],
  overBudget: null,
  fullyEstimated: false,
};
beforeEach(() => {
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const action = (args as { action: string }).action;
    return action === "get_day_capacity"
      ? { capacity, constraints: null }
      : { capacity, constraints: { revision: 1 } };
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(invoke).mockReset();
});
it("keeps unknown estimates visible and discussing only prefills a request", async () => {
  const onDiscuss = vi.fn();
  render(
    <DayCapacity
      state={state()}
      date="2030-03-04"
      scope="test"
      onSaved={() => {}}
      onDiscuss={onDiscuss}
    />,
  );
  await screen.findByText(/1 项未估计/);
  expect(screen.getByText(/可投入 未填写/)).toBeTruthy();
  fireEvent.click(screen.getByText("请 Coach 帮我取舍"));
  expect(onDiscuss).toHaveBeenCalledWith(expect.stringContaining("2030-03-04"));
  expect(
    vi
      .mocked(invoke)
      .mock.calls.every(
        (c) => (c[1] as { action: string }).action === "get_day_capacity",
      ),
  ).toBe(true);
});
it("saves zero as explicit constraint and retries the exact original request after reopening", async () => {
  let reject = true;
  const calls: Record<string, unknown>[] = [];
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const a = args as { action: string; input: Record<string, unknown> };
    if (a.action === "get_day_capacity") return { capacity };
    calls.push(a.input);
    if (reject) throw Error("connection lost");
    return { constraints: { revision: 1 } };
  });
  const props = {
    state: state(),
    date: "2030-03-04",
    scope: "test",
    onSaved: vi.fn(),
    onDiscuss: vi.fn(),
  };
  const r = render(<DayCapacity {...props} />);
  fireEvent.click(screen.getByText("自己调整"));
  fireEvent.change(screen.getByLabelText("当天可投入分钟（可不填）"), {
    target: { value: "0" },
  });
  fireEvent.click(screen.getByText("保存当天约束"));
  await screen.findByText("connection lost");
  expect(calls[0].availableMinutes).toBe(0);
  r.unmount();
  reject = false;
  render(<DayCapacity {...props} />);
  fireEvent.click(screen.getByText("核实并重试"));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  expect(calls[1]).toEqual(calls[0]);
});
