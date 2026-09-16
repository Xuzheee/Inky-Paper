// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import CoachChat from "./CoachChat";
import type { DiscussionContext, Row } from "./model";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
Element.prototype.scrollIntoView = vi.fn();
const events = new Map<string, (event: { payload: any }) => void>();
beforeEach(() => {
  events.clear();
  vi.mocked(listen).mockImplementation(async (event, callback) => {
    events.set(event, ({ payload }) => callback({ event, id: 1, payload }));
    return () => {
      events.delete(event);
    };
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(invoke).mockReset();
});

it("restores an explicitly requested candidate date independently of the conversation and browsing dates", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "workbench_history")
      return {
        sessions: [{ id: "session", title: "安排下周", updated: 1 }],
        messages: [
          {
            id: "reply",
            role: "assistant",
            created: 1,
            status: "done",
            text: '::inky-plan{batchId="11111111-1111-4111-8111-111111111111" date="2030-03-11"}',
            context: {
              date: "2030-03-04",
              selectedTaskId: null,
              selectedStepId: null,
              taskTitle: null,
              stepText: null,
            },
          },
        ],
      };
    return {
      batch: {
        id: "batch",
        revision: 1,
        cards: [{ id: "card", text: "核对安排", plannedSeconds: 900 }],
      },
      tasks: [],
      steps: [],
      dayItems: [],
    };
  });
  render(
    <CoachChat
      date="2030-03-08"
      onSaved={vi.fn()}
      onClearSelection={vi.fn()}
    />,
  );
  expect(
    ((await screen.findByLabelText("建议安排日期")) as HTMLInputElement).value,
  ).toBe("2030-03-11");
  expect(screen.getByLabelText("Coach 讨论范围").textContent).toContain(
    "讨论范围 · 2030-03-08",
  );
  expect(screen.getByText("2030-03-04 · 当天计划与记录")).toBeTruthy();
});

it("keeps an in-flight reply and its suggestion on the original date when browsing another day", async () => {
  let resolveReply!: (value: unknown) => void;
  let sent: Record<string, any> = {};
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "workbench_history") return { sessions: [], messages: [] };
    if (command === "workbench_send") {
      sent = args as typeof sent;
      return new Promise((resolve) => {
        resolveReply = resolve;
      });
    }
    return {
      batch: {
        id: "batch",
        revision: 1,
        cards: [{ id: "card", text: "核对日期", plannedSeconds: 900 }],
      },
      tasks: [],
      steps: [],
      dayItems: [],
    };
  });
  const props = { onSaved: vi.fn(), onClearSelection: vi.fn() };
  const view = render(<CoachChat {...props} date="2030-03-04" />);
  fireEvent.change(screen.getByLabelText("发送给 Coach"), {
    target: { value: "安排所选日期" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  view.rerender(<CoachChat {...props} date="2030-03-08" />);
  expect(screen.getByLabelText("Coach 讨论范围").textContent).toContain(
    "本次回复 · 2030-03-04",
  );
  expect(screen.getByLabelText("Coach 讨论范围").textContent).toContain(
    "下次发送：2030-03-08",
  );
  await act(async () =>
    resolveReply({
      sessionId: "session",
      message: {
        id: `${sent.requestId}-answer`,
        role: "assistant",
        created: Date.now(),
        status: "done",
        text: '::inky-plan{batchId="11111111-1111-4111-8111-111111111111"}',
        context: sent.context,
      },
    }),
  );
  expect(
    ((await screen.findByLabelText("建议安排日期")) as HTMLInputElement).value,
  ).toBe("2030-03-04");
  expect(screen.getByLabelText("Coach 讨论范围").textContent).toContain(
    "讨论范围 · 2030-03-08",
  );
});

const selected: Row = {
  task: {
    id: "task",
    title: "草稿标题",
    due: null,
    category: "work",
    priority: "medium",
    completed: false,
    nextAction: null,
    revision: 1,
    source: "user",
    updatedAt: 1,
  },
  step: {
    id: "step",
    taskId: "task",
    text: "草稿步骤",
    expectedResult: null,
    plannedSeconds: 900,
    completed: false,
    revision: 2,
  },
  item: {
    id: "item",
    taskId: "task",
    stepId: "step",
    date: "2030-03-04",
    order: 0,
    revision: 3,
    removedAt: null,
  },
};
const props = { onSaved: vi.fn(), onClearSelection: vi.fn() };
const reply = (sent: Record<string, any>, context?: DiscussionContext) => ({
  sessionId: "session",
  message: {
    id: `${sent.requestId}-answer`,
    role: "assistant",
    created: 1,
    status: "done",
    text: "已读取本次范围。",
    context,
  },
});
const normalized = (context: DiscussionContext): DiscussionContext => ({
  ...context,
  taskTitle: "刚更新的周报",
  stepText: "核对本周报表",
  today: "2030-03-05",
  utcOffsetMinutes: 480,
  sampledAt: 1898899200000,
  resolvedIntent: "stuck",
  latestFacts: { selection: { step: { id: "step", revision: 8 } } },
  versions: { tasks: { task: 7 }, steps: { step: 8 }, dayItems: { item: 9 } },
  truncated: {},
});

it.each([
  ["安排一下", "plan", "帮我安排3月4日"],
  ["我卡住了", "stuck", "这一步有点难开始"],
  ["回顾一下", "review", "回顾3月4日的工作"],
])(
  "keeps %s available after conversation history and only sends its intent on explicit send",
  async (label, intent, prefill) => {
    let sent: Record<string, any> = {};
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "workbench_history")
        return {
          sessions: [{ id: "session", title: "旧会话", updated: 1 }],
          messages: [
            { id: "old", role: "assistant", text: "此前的回答", created: 1 },
          ],
        };
      if (command === "workbench_send") {
        sent = args as typeof sent;
        return reply(sent, sent.context);
      }
    });
    render(<CoachChat {...props} selected={selected} date="2030-03-08" />);
    await screen.findByText("此前的回答");
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(
      (screen.getByLabelText("发送给 Coach") as HTMLTextAreaElement).value,
    ).toBe(prefill);
    expect(
      screen.getByRole("button", { name: label }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === "workbench_send"),
    ).toBe(false);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "发送" })),
    );
    expect(sent.message).toBe(prefill);
    expect(sent.context).toEqual({
      schemaVersion: 2,
      date: "2030-03-04",
      viewDate: "2030-03-08",
      intent,
      selectedTaskId: "task",
      selectedStepId: "step",
      selectedDayItemId: "item",
      taskTitle: "草稿标题",
      stepText: "草稿步骤",
      today: expect.any(String),
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
      temporaryConstraints: { text: prefill, scope: "request" },
    });
  },
);

it("resets manually edited shortcut intent to auto and sends only the current wording as temporary constraints", async () => {
  let sent: Record<string, any> = {};
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "workbench_history") return { sessions: [], messages: [] };
    if (command === "workbench_send") {
      sent = args as typeof sent;
      return reply(sent, sent.context);
    }
  });
  render(<CoachChat {...props} date="2030-03-04" />);
  fireEvent.click(screen.getByRole("button", { name: "安排一下" }));
  const text = "  现在只有十分钟。\n先谈谈这件事，不要安排。 ";
  fireEvent.change(screen.getByLabelText("发送给 Coach"), {
    target: { value: text },
  });
  expect(
    screen
      .getByRole("button", { name: "安排一下" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([command]) => command === "workbench_send"),
  ).toBe(false);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "发送" })),
  );
  expect(sent.context.intent).toBe("auto");
  expect(sent.context.temporaryConstraints).toEqual({ text, scope: "request" });
  expect(sent.context).not.toHaveProperty("energy");
  expect(sent.context).not.toHaveProperty("latestFacts");
  expect(sent.context.selectedDayItemId).toBeNull();
});

it("binds normalized connected facts to both request messages while page changes and next-draft shortcuts remain separate", async () => {
  let sent: Record<string, any> = {};
  let resolve!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "workbench_history") return { sessions: [], messages: [] };
    if (command === "workbench_send") {
      sent = args as typeof sent;
      return new Promise((done) => {
        resolve = done;
      });
    }
  });
  const view = render(
    <CoachChat {...props} selected={selected} date="2030-03-04" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "我卡住了" }));
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  const context = normalized(sent.context);
  await act(async () =>
    events.get("workbench:chat")!({
      payload: {
        requestId: sent.requestId,
        sessionId: "session",
        context,
        update: { sessionUpdate: "connected" },
      },
    }),
  );
  view.rerender(<CoachChat {...props} date="2030-03-08" />);
  fireEvent.click(screen.getByRole("button", { name: "回顾一下" }));
  expect(screen.getByLabelText("Coach 讨论范围").textContent).toContain(
    "核对本周报表",
  );
  expect(screen.getByLabelText("Coach 讨论范围").textContent).toContain(
    "下次发送：2030-03-08",
  );
  expect(screen.getAllByText("2030-03-04 · 核对本周报表")).toHaveLength(2);
  expect(
    (screen.getByLabelText("发送给 Coach") as HTMLTextAreaElement).value,
  ).toBe("回顾3月8日的工作");
  expect(sent.context.intent).toBe("stuck");
  await act(async () => resolve(reply(sent, context)));
  expect(screen.getAllByText("2030-03-04 · 核对本周报表")).toHaveLength(2);
  expect(screen.getByLabelText("Coach 讨论范围").textContent).toContain(
    "讨论范围 · 2030-03-08",
  );
  expect(
    screen
      .getByRole("button", { name: "回顾一下" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});

it("uses the final normalized context for both messages when the connected event was missed", async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "workbench_history") return { sessions: [], messages: [] };
    if (command === "workbench_send") {
      const sent = args as Record<string, any>;
      return reply(sent, normalized(sent.context));
    }
  });
  render(<CoachChat {...props} selected={selected} date="2030-03-04" />);
  fireEvent.click(screen.getByRole("button", { name: "我卡住了" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "发送" })),
  );
  expect(screen.getAllByText("2030-03-04 · 核对本周报表")).toHaveLength(2);
  expect(screen.queryByText("2030-03-04 · 草稿步骤")).toBeNull();
});

it("does not let a late completed invoke reset a newer request or accept unrelated stream context", async () => {
  const requests: Record<string, any>[] = [];
  const resolve: ((value: unknown) => void)[] = [];
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "workbench_history") return { sessions: [], messages: [] };
    if (command === "workbench_send") {
      requests.push(args as Record<string, any>);
      return new Promise((done) => {
        resolve.push(done);
      });
    }
  });
  const view = render(<CoachChat {...props} date="2030-03-04" />);
  fireEvent.click(screen.getByRole("button", { name: "安排一下" }));
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  const first = requests[0];
  await act(async () =>
    events.get("workbench:finished")!({
      payload: {
        requestId: first.requestId,
        ...reply(first, normalized(first.context)),
      },
    }),
  );
  expect(screen.getAllByText("2030-03-04 · 核对本周报表")).toHaveLength(2);
  view.rerender(<CoachChat {...props} date="2030-03-08" />);
  fireEvent.click(screen.getByRole("button", { name: "回顾一下" }));
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await act(async () => {
    events.get("workbench:chat")!({
      payload: {
        requestId: first.requestId,
        sessionId: "session",
        context: normalized(first.context),
        update: { sessionUpdate: "connected" },
      },
    });
    resolve[0](reply(first, normalized(first.context)));
  });
  expect(screen.getByRole("button", { name: "停止回复" })).toBeTruthy();
  expect(screen.getByLabelText("Coach 讨论范围").textContent).toContain(
    "本次回复 · 2030-03-08",
  );
  expect(requests[1].context.intent).toBe("review");
  expect(requests[1].sessionId).toBe("session");
  expect(requests[1].context).not.toHaveProperty("latestFacts");
  await act(async () => resolve[1](reply(requests[1], requests[1].context)));
});
