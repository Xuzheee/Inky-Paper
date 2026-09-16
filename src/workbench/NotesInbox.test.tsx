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
import type { State } from "../paper/paperTypes";
import NotesInbox from "./NotesInbox";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mock = vi.mocked(invoke);
const props = {
  storageScope: "notes-fixture-db",
  onSaved: vi.fn(),
  onSelectTask: vi.fn(),
};
const fixture = (): State => ({
  tasks: [
    {
      id: "target",
      title: "整理访谈",
      revision: 4,
      completed: false,
      nextAction: null,
      category: "work",
      priority: "medium",
      source: "user",
      updatedAt: 10,
      due: null,
    },
  ],
  sessions: [],
  notes: [
    {
      id: "note",
      text: "回头补一张流程图\n保留原来的说明。",
      createdAt: 1899000000000,
      taskId: "origin",
      taskTitle: "原始项目",
      sessionId: "source-session",
      source: "user",
      action: {
        id: "source-step",
        text: "核对第三项",
        source: "user",
        completed: false,
      },
    },
  ],
  coach: {} as State["coach"],
});
const inputs = () =>
  mock.mock.calls.map(
    ([, args]) =>
      (args as { action: string; input: Record<string, any> }).input,
  );
function succeeding(data: State) {
  mock.mockImplementation(async (_command, args) => {
    const { action, input } = args as {
      action: string;
      input: Record<string, any>;
    };
    expect(action).toBe("organize_note");
    const note = {
      ...data.notes[0],
      revision: (data.notes[0].revision ?? 1) + 1,
      organization:
        input.mode === "keep"
          ? "kept"
          : input.mode === "link"
            ? "linked"
            : "converted",
      linkedTaskId: input.mode === "link" ? input.targetTaskId : null,
      convertedTaskId: input.mode === "convert" ? input.taskId : undefined,
    };
    return {
      note,
      task:
        input.mode === "convert"
          ? { ...data.tasks[0], id: input.taskId, title: input.title }
          : data.tasks[0],
    };
  });
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  mock.mockReset();
  props.onSaved.mockClear();
  props.onSelectTask.mockClear();
  vi.restoreAllMocks();
});

it("keeps a legacy note using revision 1, preserving the full source and recording only the explicit action", async () => {
  const state = fixture();
  succeeding(state);
  render(<NotesInbox {...props} state={state} />);
  expect(mock).not.toHaveBeenCalled();
  expect(screen.getByText("原任务：原始项目")).toBeTruthy();
  expect(screen.getByText("原步骤：核对第三项")).toBeTruthy();
  expect(screen.getByTitle("source-session")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "保留为笔记" }));
  await screen.findByText("已保留为笔记。");
  expect(inputs()).toEqual([
    {
      noteId: "note",
      mode: "keep",
      expectedRevision: 1,
      requestId: expect.any(String),
    },
  ]);
  expect(screen.getByText(/回头补一张流程图/).textContent).toBe(
    state.notes[0].text,
  );
  expect(state.notes[0].taskId).toBe("origin");
  expect(props.onSaved).toHaveBeenCalledTimes(1);
});

it("links an existing task with its selected revision without replacing original task or step provenance", async () => {
  const state = fixture();
  succeeding(state);
  render(<NotesInbox {...props} state={state} />);
  fireEvent.click(screen.getByRole("button", { name: "关联已有任务" }));
  fireEvent.change(screen.getByLabelText("关联到任务"), {
    target: { value: "target" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存关联" }));
  await screen.findByText("已关联任务，原笔记与来源已保留。");
  expect(inputs()[0]).toMatchObject({
    mode: "link",
    noteId: "note",
    expectedRevision: 1,
    targetTaskId: "target",
    expectedTaskRevision: 4,
  });
  expect(inputs()[0]).not.toHaveProperty("taskId");
  expect(screen.getByText("原任务：原始项目")).toBeTruthy();
  expect(screen.getByText("原步骤：核对第三项")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "打开任务" }));
  expect(props.onSelectTask).toHaveBeenCalledWith("target");
});

it("converts into one new task with an optional next step and keeps long original text intact", async () => {
  const state = fixture();
  state.notes[0].text = "长笔记".repeat(110) + "\n末尾原文";
  succeeding(state);
  render(<NotesInbox {...props} state={state} />);
  fireEvent.click(screen.getByRole("button", { name: "转为新任务" }));
  expect(
    (screen.getByLabelText("新任务标题") as HTMLInputElement).value,
  ).toHaveLength(300);
  fireEvent.change(screen.getByLabelText("新任务标题"), {
    target: { value: "补画流程图" },
  });
  fireEvent.change(screen.getByLabelText("下一步（可不填）"), {
    target: { value: "先列出三个节点" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建任务并保留笔记" }));
  await screen.findByText("已转为任务，原笔记与来源已保留。");
  expect(inputs()[0]).toMatchObject({
    mode: "convert",
    title: "补画流程图",
    nextAction: "先列出三个节点",
    taskId: expect.any(String),
  });
  expect(screen.getByText(/末尾原文/).textContent).toBe(state.notes[0].text);
  expect(screen.queryByRole("button", { name: "转为新任务" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "打开任务" }));
  expect(props.onSelectTask).toHaveBeenCalledWith(inputs()[0].taskId);
  expect(mock).toHaveBeenCalledTimes(1);
});

it("restores an uncertain conversion across reopening and retries the exact original payload even after the note is already converted", async () => {
  const state = fixture();
  mock.mockRejectedValueOnce(Error("连接中断"));
  const first = render(<NotesInbox {...props} state={state} />);
  fireEvent.click(screen.getByRole("button", { name: "转为新任务" }));
  fireEvent.change(screen.getByLabelText("新任务标题"), {
    target: { value: "原提交标题" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建任务并保留笔记" }));
  await screen.findByText("连接中断");
  const original = inputs()[0];
  expect(
    (
      screen
        .getByLabelText("新任务标题")
        .closest("fieldset") as HTMLFieldSetElement
    ).disabled,
  ).toBe(true);
  first.unmount();
  const latest = structuredClone(state);
  latest.notes[0] = {
    ...latest.notes[0],
    convertedTaskId: original.taskId,
    organization: "converted",
    revision: 2,
  };
  latest.tasks.push({
    ...latest.tasks[0],
    id: original.taskId,
    title: original.title,
  });
  mock.mockResolvedValue({
    note: latest.notes[0],
    task: latest.tasks[1],
    reused: false,
  });
  render(<NotesInbox {...props} state={latest} />);
  fireEvent.click(screen.getByRole("button", { name: "核实并重试原提交" }));
  await screen.findByText("已转为任务，原笔记与来源已保留。");
  expect(inputs()[1]).toEqual(original);
  expect(mock).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "转为新任务" })).toBeNull();
  expect(
    Object.keys(localStorage).some((key) => key.includes("request:")),
  ).toBe(false);
});

it("preserves a conversion draft after a version conflict and requires review before saving against the refreshed version", async () => {
  const state = fixture();
  mock.mockRejectedValueOnce("CONFLICT: 笔记已更新");
  const view = render(<NotesInbox {...props} state={state} />);
  fireEvent.click(screen.getByRole("button", { name: "转为新任务" }));
  fireEvent.change(screen.getByLabelText("新任务标题"), {
    target: { value: "我的草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建任务并保留笔记" }));
  await screen.findByText("CONFLICT: 笔记已更新");
  const initial = inputs()[0];
  const latest = structuredClone(state);
  latest.notes[0].revision = 7;
  latest.notes[0].organization = "kept";
  view.rerender(<NotesInbox {...props} state={latest} />);
  expect(
    (
      screen.getByRole("button", {
        name: "创建任务并保留笔记",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect((screen.getByLabelText("新任务标题") as HTMLInputElement).value).toBe(
    "我的草稿",
  );
  expect(mock).toHaveBeenCalledTimes(1);
  succeeding(latest);
  fireEvent.click(
    screen.getByRole("button", { name: "已核对，保留草稿并使用当前版本" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "创建任务并保留笔记" }));
  await screen.findByText("已转为任务，原笔记与来源已保留。");
  expect(inputs()[1]).toMatchObject({
    expectedRevision: 7,
    title: "我的草稿",
    taskId: initial.taskId,
  });
  expect(inputs()[1].requestId).not.toBe(initial.requestId);
});

it("does not silently accept a target task revision change while a link draft is open", async () => {
  const state = fixture();
  const view = render(<NotesInbox {...props} state={state} />);
  fireEvent.click(screen.getByRole("button", { name: "关联已有任务" }));
  fireEvent.change(screen.getByLabelText("关联到任务"), {
    target: { value: "target" },
  });
  const latest = structuredClone(state);
  latest.tasks[0].revision = 5;
  latest.tasks[0].title = "更新后的访谈任务";
  view.rerender(<NotesInbox {...props} state={latest} />);
  expect(
    (screen.getByRole("button", { name: "保存关联" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText(/编辑时关联：整理访谈/)).toBeTruthy();
  expect(mock).not.toHaveBeenCalled();
  succeeding(latest);
  fireEvent.click(
    screen.getByRole("button", { name: "已核对，保留草稿并使用当前版本" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存关联" }));
  await waitFor(() =>
    expect(inputs()[0]).toMatchObject({ expectedTaskRevision: 5 }),
  );
});

it("shows already converted legacy notes only in all, opening their existing target without rebuilding", () => {
  const state = fixture();
  state.notes[0].convertedTaskId = "target";
  render(<NotesInbox {...props} state={state} />);
  expect(screen.queryByText(/回头补一张流程图/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "全部" }));
  expect(screen.getByText(/回头补一张流程图/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "转为新任务" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "打开任务" }));
  expect(props.onSelectTask).toHaveBeenCalledWith("target");
  expect(mock).not.toHaveBeenCalled();
});

it("isolates drafts by database scope and restores the source scope draft without sending anything", () => {
  const state = fixture();
  const view = render(<NotesInbox {...props} state={state} />);
  fireEvent.click(screen.getByRole("button", { name: "转为新任务" }));
  fireEvent.change(screen.getByLabelText("新任务标题"), {
    target: { value: "数据库一的草稿" },
  });
  view.rerender(
    <NotesInbox {...props} storageScope="other-db" state={state} />,
  );
  expect(screen.queryByLabelText("新任务标题")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "转为新任务" }));
  expect(
    (screen.getByLabelText("新任务标题") as HTMLInputElement).value,
  ).not.toBe("数据库一的草稿");
  view.rerender(<NotesInbox {...props} state={state} />);
  expect((screen.getByLabelText("新任务标题") as HTMLInputElement).value).toBe(
    "数据库一的草稿",
  );
  expect(mock).not.toHaveBeenCalled();
});

it("does not send writes without a data scope or when a local draft cannot be persisted", async () => {
  const state = fixture();
  const view = render(<NotesInbox {...props} storageScope="" state={state} />);
  expect(
    (screen.getByRole("button", { name: "保留为笔记" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  view.rerender(<NotesInbox {...props} state={state} />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("full");
  });
  fireEvent.click(screen.getByRole("button", { name: "保留为笔记" }));
  await screen.findByText(
    "草稿未能保存，暂未发送整理操作。请检查本地存储后重新打开。",
  );
  expect(mock).not.toHaveBeenCalled();
});
