// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  CoachHelp,
  CoachPrompt,
  CoachSettings,
  WorkStart,
  emptyCoach,
} from "./CoachUI";
import type { WorkBlock } from "./CoachUI";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, callback) => {
    native.listeners.set(name, callback);
    return () => native.listeners.delete(name);
  }),
}));

const block = (): WorkBlock => ({
  id: "work",
  taskId: "task",
  taskTitle: "整理结果",
  action: { id: "step", text: "写出第一条结论" },
  goal: "写出第一条结论",
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

beforeEach(() => {
  vi.clearAllMocks();
  native.listeners.clear();
  localStorage.clear();
  native.invoke.mockResolvedValue(null);
});
afterEach(cleanup);

describe("on-demand Coach", () => {
  it("starts with the selected card duration and preserves the user's saved timer choice", async () => {
    const task = {
      id: "task",
      title: "整理结果",
      revision: 1,
      completed: false,
      nextAction: { id: "step", text: "写出第一条结论", completed: false },
    };
    const props = {
      task,
      currentTask: task,
      reviewTask: vi.fn(),
      settings: emptyCoach.settings,
      busy: false,
      mutate: vi.fn(async () => null),
      done: vi.fn(),
    };
    const view = render(<WorkStart {...props} initialSeconds={1200} />);
    expect(
      (screen.getByRole("combobox", { name: "本轮计时" }) as HTMLSelectElement)
        .value,
    ).toBe("1200");
    expect(screen.getByRole("option", { name: "20 分钟" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "本轮计时" }), {
      target: { value: "900" },
    });
    view.unmount();
    render(<WorkStart {...props} initialSeconds={2700} />);
    expect(
      (screen.getByRole("combobox", { name: "本轮计时" }) as HTMLSelectElement)
        .value,
    ).toBe("900");
  });
  it("offers only local activity records even with legacy automatic settings", () => {
    const mutate = vi.fn(async () => null);
    render(
      <CoachSettings
        coach={{
          ...emptyCoach,
          settings: { enabled: true, hermes: true, revision: 3 },
        }}
        busy={false}
        mutate={mutate}
      />,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "工作时段内保存本地活动记录" }),
    );
    expect(mutate).toHaveBeenCalledWith("coach_settings", {
      expectedRevision: 3,
      enabled: false,
    });
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("calls Hermes only after the user asks, with local observation turned off", async () => {
    const refresh = vi.fn(async () => {});
    const props = {
      block: block(),
      coach: emptyCoach,
      busy: false,
      mutate: vi.fn(async () => null),
      refresh,
      hasSession: false,
      adopt: vi.fn(async () => null),
      openWork: vi.fn(),
    };
    const view = render(<CoachHelp {...props} />);
    expect(native.invoke).not.toHaveBeenCalled();
    view.rerender(
      <CoachHelp
        {...props}
        coach={{
          ...emptyCoach,
          settings: { enabled: true, hermes: true, revision: 3 },
        }}
      />,
    );
    expect(native.invoke).not.toHaveBeenCalled();
    view.rerender(<CoachHelp {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "找回起点" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步不清楚" }));
    expect(native.invoke).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "请 Hermes 给一个建议" }),
      ),
    );
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith("request_coaching", {
      kind: "recovery",
      blocker: "下一步不清楚",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores old proactive prompt payloads on read and event delivery", async () => {
    const oldPrompt = {
      kind: "return",
      block: block(),
      episode: { id: "old", shownAt: [] },
    };
    native.invoke.mockResolvedValue(oldPrompt);
    await act(async () => render(<CoachPrompt />));
    expect(screen.queryByRole("heading")).toBeNull();
    await act(async () =>
      native.listeners.get("coach:prompt")?.({ payload: oldPrompt }),
    );
    expect(screen.queryByRole("button", { name: "回到任务" })).toBeNull();
    expect(native.invoke).not.toHaveBeenCalledWith(
      "request_coaching",
      expect.anything(),
    );
  });

  it("keeps the work-end notice and its close control", async () => {
    native.invoke.mockResolvedValue({
      kind: "work_end",
      block: { ...block(), status: "expired" },
    });
    await act(async () => render(<CoachPrompt />));
    expect(screen.getByRole("heading", { name: "这段时间到了" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "延长 15 分钟" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭到点提示" }));
    expect(native.invoke).toHaveBeenCalledWith("coach_hide_prompt");
  });
});
