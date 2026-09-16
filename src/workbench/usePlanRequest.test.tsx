// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { usePlanRequest } from "./usePlanRequest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
});

it("freezes an uncertain payload and blocks a changed operation until the original is resolved", async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce(Error("response lost"))
    .mockResolvedValue({});
  const { result } = renderHook(usePlanRequest);
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
  const { result } = renderHook(usePlanRequest);
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
