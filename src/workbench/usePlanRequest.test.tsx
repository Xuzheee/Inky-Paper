// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { usePlanRequest } from "./usePlanRequest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

it("freezes an uncertain payload and blocks a changed operation until the original is resolved", async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce(Error("response lost"))
    .mockResolvedValue({});
  const { result } = renderHook(() => usePlanRequest("test-scope:request"));
  const input = { items: [{ id: "plan", revision: 1 }], date: "2030-03-04" };
  await act(async () => {
    await expect(result.current.submit("move", input)).rejects.toThrow(
      "response lost",
    );
  });
  input.items[0].revision = 2;
  await act(async () => {
    await expect(result.current.submit("move", input)).rejects.toThrow(
      "上次操作尚未确认",
    );
  });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(result.current.discardDefinitiveFailure()).toBe(false);
  await act(async () => {
    await result.current.retry();
  });
  expect(vi.mocked(invoke).mock.calls[1]).toEqual(
    vi.mocked(invoke).mock.calls[0],
  );
  expect(result.current.pending).toBeNull();
});

it("retains a rejected operation for exact retry, but assigns a new id after an explicit version correction", async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce(Error("CONFLICT: changed"))
    .mockResolvedValue({});
  const { result } = renderHook(() => usePlanRequest("test-scope:request"));
  await act(async () => {
    await expect(
      result.current.submit("move", { expectedRevision: 1 }),
    ).rejects.toThrow("CONFLICT");
  });
  expect(result.current.definitiveFailure).toBe(true);
  await act(async () => {
    await result.current.submit("move", { expectedRevision: 2 });
  });
  const first = (
    vi.mocked(invoke).mock.calls[0][1] as { input: { requestId: string } }
  ).input;
  const second = (
    vi.mocked(invoke).mock.calls[1][1] as { input: { requestId: string } }
  ).input;
  expect(second.requestId).not.toBe(first.requestId);
});

it("restores an unknown operation after remount and keeps its exact versioned payload", async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce(Error("response lost"))
    .mockResolvedValue({});
  const first = renderHook(() => usePlanRequest("scope-a:request"));
  await act(async () => {
    await expect(
      first.result.current.submit("cancel_plan_items", {
        items: [{ id: "plan", revision: 4 }],
        scope: "selected",
      }),
    ).rejects.toThrow("response lost");
  });
  const original = structuredClone(vi.mocked(invoke).mock.calls[0]);
  first.unmount();
  const restored = renderHook(() => usePlanRequest("scope-a:request"));
  expect(restored.result.current.pending?.input).toEqual(
    (original[1] as any).input,
  );
  await act(async () => {
    await restored.result.current.retry();
  });
  expect(vi.mocked(invoke).mock.calls[1]).toEqual(original);
  expect(localStorage.getItem("scope-a:request")).toBeNull();
});

it("isolates pending operations by storage scope and blocks submits until scope is ready", async () => {
  vi.mocked(invoke).mockRejectedValue(Error("response lost"));
  const first = renderHook(() => usePlanRequest("scope-a:request"));
  await act(async () => {
    await expect(
      first.result.current.submit("move", { date: "2030-03-04" }),
    ).rejects.toThrow();
  });
  first.unmount();
  const { result, rerender } = renderHook(({ key }) => usePlanRequest(key), {
    initialProps: { key: undefined as string | undefined },
  });
  await act(async () => {
    await expect(result.current.submit("move", {})).rejects.toThrow("尚未就绪");
  });
  expect(invoke).toHaveBeenCalledTimes(1);
  rerender({ key: "scope-b:request" });
  expect(result.current.ready).toBe(true);
  expect(result.current.pending).toBeNull();
  expect(localStorage.getItem("scope-a:request")).not.toBeNull();
});

it("fails before IPC when a durable pending request cannot be written", async () => {
  const { result } = renderHook(() => usePlanRequest("scope:request"));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("storage full");
  });
  await act(async () => {
    await expect(result.current.submit("move", {})).rejects.toThrow(
      "无法保存待核实请求",
    );
  });
  expect(invoke).not.toHaveBeenCalled();
  expect(result.current.ready).toBe(false);
});
