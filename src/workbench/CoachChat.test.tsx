// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import CoachChat from "./CoachChat";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
Element.prototype.scrollIntoView = vi.fn();
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
