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
import type { Project, State } from "../paper/paperTypes";
import ProjectsPanel from "./ProjectsPanel";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mock = vi.mocked(invoke);
const project = (): Project => ({
  id: "project-one",
  title: "发布笔记",
  goal: "写清楚这次改动",
  criteria: "示例可运行",
  referenceLinks: ["https://example.com/reference"],
  archived: false,
  revision: 3,
  updatedAt: 1,
  source: "user",
});
const fixture = (projects: Project[] = [project()]): State => ({
  coach: {} as State["coach"],
  tasks: [
    {
      id: "task",
      title: "整理示例",
      category: "work",
      completed: false,
      due: null,
      priority: "medium",
      nextAction: null,
      revision: 4,
      source: "user",
      updatedAt: 1,
      projectId: "project-one",
    },
  ],
  sessions: [],
  notes: [],
  planning: { steps: [], dayItems: [], context: { days: [], projects } },
});
const props = { storageScope: "project-db", onSaved: vi.fn() };
const saves = () =>
  mock.mock.calls
    .filter(([cmd]) => cmd === "paper_execute")
    .map(([, args]) => (args as { input: Record<string, any> }).input);
const succeed = () =>
  mock.mockImplementation(async (_command, args) => {
    const { input } = args as { input: Record<string, any> };
    return {
      project: {
        ...project(),
        id: input.projectId,
        revision: input.expectedRevision + 1,
        title: input.title,
        goal: input.goal,
        criteria: input.criteria,
        referenceLinks: input.referenceLinks,
        archived: input.archived,
      },
    };
  });
afterEach(() => {
  cleanup();
  localStorage.clear();
  mock.mockReset();
  props.onSaved.mockClear();
  vi.restoreAllMocks();
});

it("creates a project only after explicit save and validates references without opening or fetching them", async () => {
  succeed();
  render(<ProjectsPanel {...props} state={fixture([])} />);
  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  fireEvent.change(screen.getByLabelText("项目名称"), {
    target: { value: "新项目" },
  });
  fireEvent.change(screen.getByLabelText("参考链接（每行一条，最多 10 条）"), {
    target: { value: "file:///secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
  await screen.findByText("参考链接只支持完整的 http 或 https 地址。");
  expect(mock).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("参考链接（每行一条，最多 10 条）"), {
    target: { value: Array(11).fill("https://example.com").join("\n") },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
  await screen.findByText("参考链接最多 10 条，每行一条。");
  expect(mock).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("参考链接（每行一条，最多 10 条）"), {
    target: { value: "https://example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
  await screen.findByText("项目已保存。");
  expect(saves()[0]).toMatchObject({
    expectedRevision: 0,
    title: "新项目",
    referenceLinks: ["https://example.com"],
    goal: "",
    criteria: "",
    archived: false,
    projectId: expect.any(String),
    requestId: expect.any(String),
  });
  expect(mock).toHaveBeenCalledTimes(1);
});

it("opens a saved reference only when its button is clicked", async () => {
  mock.mockResolvedValue(null);
  render(<ProjectsPanel {...props} state={fixture()} />);
  expect(screen.getByText("参考链接 · 仅保存，未读取")).toBeTruthy();
  expect(mock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /打开参考链接 1/ }));
  await waitFor(() =>
    expect(mock).toHaveBeenCalledWith("workbench_open_reference", {
      url: "https://example.com/reference",
    }),
  );
});

it("archives only the project while retaining the associated task and original category", async () => {
  const state = fixture();
  const snapshot = structuredClone(state.tasks);
  succeed();
  render(<ProjectsPanel {...props} state={state} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑项目" }));
  fireEvent.click(screen.getByLabelText("归档项目"));
  fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
  await screen.findByText("项目已归档，已有任务和记录保留。");
  expect(saves()[0]).toMatchObject({
    projectId: "project-one",
    expectedRevision: 3,
    archived: true,
  });
  expect(mock.mock.calls[0][1]).toMatchObject({ action: "save_project" });
  expect(state.tasks).toEqual(snapshot);
  expect(screen.getByText("1 条任务")).toBeTruthy();
});

it("keeps a project draft through a version conflict and never advances its baseline without explicit review", async () => {
  const state = fixture();
  const view = render(<ProjectsPanel {...props} state={state} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑项目" }));
  fireEvent.change(screen.getByLabelText("项目目标（可不填）"), {
    target: { value: "我的目标草稿" },
  });
  const updated = fixture([
    { ...project(), revision: 4, goal: "另一处刚更新的目标" },
  ]);
  view.rerender(<ProjectsPanel {...props} state={updated} />);
  expect(
    (screen.getByRole("button", { name: "保存项目" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("项目目标（可不填）") as HTMLTextAreaElement).value,
  ).toBe("我的目标草稿");
  expect(screen.getAllByText(/另一处刚更新的目标/).length).toBeGreaterThan(0);
  expect(mock).not.toHaveBeenCalled();
  succeed();
  fireEvent.click(
    screen.getByRole("button", { name: "已核对，保留草稿并使用当前版本" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
  await screen.findByText("项目已保存。");
  expect(saves()[0]).toMatchObject({
    expectedRevision: 4,
    goal: "我的目标草稿",
  });
});

it("restores an uncertain new project request exactly, isolated from another database", async () => {
  mock.mockRejectedValueOnce(Error("响应丢失"));
  const view = render(<ProjectsPanel {...props} state={fixture([])} />);
  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  fireEvent.change(screen.getByLabelText("项目名称"), {
    target: { value: "稳定项目" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
  await screen.findByText("响应丢失");
  const original = saves()[0];
  view.rerender(
    <ProjectsPanel {...props} state={fixture([])} storageScope="other-db" />,
  );
  expect(screen.queryByRole("button", { name: "核实并重试原提交" })).toBeNull();
  view.unmount();
  succeed();
  render(<ProjectsPanel {...props} state={fixture([])} />);
  fireEvent.click(screen.getByRole("button", { name: "核实并重试原提交" }));
  await screen.findByText("项目已保存。");
  expect(saves()[1]).toEqual(original);
});
