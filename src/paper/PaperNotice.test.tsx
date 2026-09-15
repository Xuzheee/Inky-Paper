// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PaperNotice, { usePaperNotice, type Notice } from "./PaperNotice";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  receive: undefined as
    undefined | ((event: { payload: Notice | null }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, callback) => {
    native.receive = callback;
    return () => {
      native.receive = undefined;
    };
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
  });
  native.invoke.mockResolvedValue(null);
});
afterEach(cleanup);

function Harness() {
  const { showNotice, clearNotice, fallback } = usePaperNotice();
  return (
    <main>
      <button onClick={() => showNotice("计时已保存")}>保存</button>
      <button onClick={clearNotice}>准备下一步</button>
      {fallback}
    </main>
  );
}

it("keeps a newer event when an older startup read finishes late and only dismisses its ID", async () => {
  let finishRead!: (notice: Notice) => void;
  native.invoke.mockImplementation((command) =>
    command === "paper_current_notice"
      ? new Promise<Notice>((resolve) => {
          finishRead = resolve;
        })
      : Promise.resolve(),
  );
  render(<PaperNotice />);
  await waitFor(() => expect(finishRead).toBeTypeOf("function"));
  await act(async () =>
    native.receive?.({ payload: { id: "new", message: "新的提醒" } }),
  );
  await act(async () => finishRead({ id: "old", message: "过期提醒" }));
  expect(screen.getByRole("status").textContent).toBe("新的提醒");
  expect(screen.queryByText("过期提醒")).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(native.invoke).toHaveBeenCalledWith("paper_dismiss_notice", {
    id: "new",
  });
  expect(
    native.invoke.mock.calls.some(([command]) => command === "paper_execute"),
  ).toBe(false);
});

it("keeps saved feedback available in a floating fallback if the native window fails", async () => {
  native.invoke.mockRejectedValue(new Error("Window unavailable"));
  const { container } = render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect((await screen.findByRole("status")).textContent).toBe("计时已保存");
  expect(container.querySelector(".paper-notice-card")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "知道了" }));
  expect(screen.queryByRole("status")).toBeNull();
});

it("serializes showing and clearing without dismissing the subsequent message", async () => {
  let finishShow!: () => void;
  native.invoke.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishShow = resolve;
      }),
  );
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(finishShow).toBeTypeOf("function"));
  const first = native.invoke.mock.calls[0][1];
  fireEvent.click(screen.getByRole("button", { name: "准备下一步" }));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await act(async () => finishShow());
  expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
    "paper_show_notice",
    "paper_dismiss_notice",
    "paper_show_notice",
  ]);
  expect(native.invoke.mock.calls[1][1]).toEqual({ id: first.id });
  expect(native.invoke.mock.calls[2][1].id).not.toBe(first.id);
  expect(screen.queryByRole("status")).toBeNull();
});

it("closes from the main window with Escape while the native popup has not taken focus", async () => {
  render(<Harness />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "保存" })));
  const notice = native.invoke.mock.calls[0][1];
  await act(async () => fireEvent.keyDown(window, { key: "Escape" }));
  expect(native.invoke).toHaveBeenCalledWith("paper_dismiss_notice", { id: notice.id });
  expect(native.invoke.mock.calls.some(([command]) => command === "paper_execute")).toBe(false);
});
