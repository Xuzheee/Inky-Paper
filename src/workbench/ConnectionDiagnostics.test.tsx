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
import ConnectionDiagnostics from "./ConnectionDiagnostics";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const props = { busy: false, onRetryQuestion: vi.fn(), onRefreshPlan: vi.fn() };
const result = {
  sampledAt: 1000,
  checks: [
    {
      stage: "dependency",
      code: "missing",
      summary: "未找到 Hermes 或 Node.js；安装后重新检查",
      retry: "重新检查本机依赖",
    },
    {
      stage: "acp",
      code: "unknown",
      summary: "Hermes 当前未连接；发送消息时连接",
      retry: "重新发送原问题以连接",
    },
    {
      stage: "paper",
      code: "unavailable",
      summary: "Paper 工具调用未成功，请刷新计划后重试",
      retry: "刷新计划并重试原问题",
    },
    {
      stage: "model",
      code: "failed",
      summary: "最近一次模型调用失败，请在 Hermes 检查账户和模型后重试",
      retry: "手动重试原问题",
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  props.onRetryQuestion.mockClear();
  props.onRefreshPlan.mockClear();
});
it("shows four diagnostic stages and only makes the read-only diagnostic call", async () => {
  vi.mocked(invoke).mockResolvedValue(result);
  render(<ConnectionDiagnostics {...props} />);
  await screen.findByText("本机依赖");
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
  expect(screen.getByText("Hermes 连接")).toBeTruthy();
  expect(screen.getByText("Paper 工具")).toBeTruthy();
  expect(screen.getByText("模型调用")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
  await waitFor(() =>
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["workbench_diagnostics"],
      ["workbench_diagnostics"],
    ]),
  );
  expect(props.onRetryQuestion).not.toHaveBeenCalled();
});
it("prepares an explicit retry and refreshes Paper only for the Paper action", async () => {
  vi.mocked(invoke).mockResolvedValue(result);
  render(<ConnectionDiagnostics {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "准备重试连接" }));
  expect(props.onRetryQuestion).toHaveBeenCalledTimes(1);
  expect(props.onRefreshPlan).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "刷新计划并准备重试" }));
  expect(props.onRefreshPlan).toHaveBeenCalledTimes(1);
  expect(props.onRetryQuestion).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "准备重试问题" }));
  expect(props.onRetryQuestion).toHaveBeenCalledTimes(3);
  expect(vi.mocked(invoke).mock.calls).toEqual([["workbench_diagnostics"]]);
});
it("does not show raw diagnostic errors and supports another safe check", async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce(
      Error("Bearer test-secret at C:/private/activity-title"),
    )
    .mockResolvedValue(result);
  render(<ConnectionDiagnostics {...props} />);
  await screen.findByRole("alert");
  expect(document.body.textContent).not.toMatch(
    /test-secret|private|activity-title/,
  );
  fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
  await screen.findByText("模型调用");
  expect(screen.queryByRole("alert")).toBeNull();
});
it("allows status checks but disables retry preparation while a reply is already running", async () => {
  vi.mocked(invoke).mockResolvedValue(result);
  render(<ConnectionDiagnostics {...props} busy />);
  const retry = (await screen.findByRole("button", {
    name: "准备重试问题",
  })) as HTMLButtonElement;
  expect(retry.disabled).toBe(true);
  fireEvent.click(retry);
  expect(props.onRetryQuestion).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "重新检查" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});
