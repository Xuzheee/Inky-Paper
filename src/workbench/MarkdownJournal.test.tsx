// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MarkdownJournal from "./MarkdownJournal";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => {
  cleanup();
  invoke.mockReset();
});
it("does not replace the selected date with a late response and renders Markdown as literal text", async () => {
  const pending: Record<string, (value: unknown) => void> = {};
  invoke.mockImplementation(
    (_command, { date }) =>
      new Promise((resolve) => {
        pending[date] = resolve;
      }),
  );
  const { rerender } = render(
    <MarkdownJournal
      date="2026-09-14"
      refreshKey={0}
      kind="day"
      setKind={() => {}}
    />,
  );
  rerender(
    <MarkdownJournal
      date="2026-09-15"
      refreshKey={0}
      kind="day"
      setKind={() => {}}
    />,
  );
  const response = (date: string, content: string) => ({
    date,
    documents: [
      {
        kind: "day",
        path: `${date}.md`,
        exists: true,
        content,
        modifiedAt: null,
        error: null,
      },
    ],
  });
  await act(async () =>
    pending["2026-09-15"](
      response("2026-09-15", "# 当天记录\n<script>原文</script>"),
    ),
  );
  await act(async () =>
    pending["2026-09-14"](response("2026-09-14", "昨天的迟到响应")),
  );
  expect(screen.getByLabelText("Markdown 原始内容").textContent).toContain(
    "<script>原文</script>",
  );
  expect(screen.queryByText("昨天的迟到响应")).toBeNull();
  expect(document.querySelector("pre script")).toBeNull();
});
