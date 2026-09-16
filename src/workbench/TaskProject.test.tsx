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
import type { State, Task } from "../paper/paperTypes";
import TaskProject from "./TaskProject";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mock = vi.mocked(invoke);
const fixture = (): { task: Task; state: State } => {
  const task: Task = {
    id: "task",
    title: "整理示例",
    category: "study",
    completed: false,
    due: null,
    priority: "medium",
    nextAction: null,
    revision: 4,
    source: "user",
    updatedAt: 1,
    projectId: "archived",
  };
  return {
    task,
    state: {
      coach: {} as State["coach"],
      tasks: [task],
      sessions: [],
      notes: [],
      planning: {
        steps: [],
        dayItems: [],
        context: {
          days: [],
          projects: [
            {
              id: "active",
              title: "当前项目",
              goal: "",
              criteria: "",
              referenceLinks: [],
              archived: false,
              revision: 2,
              updatedAt: 1,
              source: "user",
            },
            {
              id: "archived",
              title: "以前的项目",
              goal: "",
              criteria: "",
              referenceLinks: [],
              archived: true,
              revision: 3,
              updatedAt: 1,
              source: "user",
            },
          ],
        },
      },
    },
  };
};
const props = { storageScope: "task-project-db", onSaved: vi.fn() };
const inputs = () =>
  mock.mock.calls.map(
    ([, args]) => (args as { input: Record<string, any> }).input,
  );
const succeed = (task: Task) =>
  mock.mockImplementation(async (_command, args) => {
    const { input } = args as { input: Record<string, any> };
    return {
      task: {
        ...task,
        projectId: input.projectId,
        revision: input.expectedTaskRevision + 1,
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

it("shows an archived current project but prevents new association to it and leaves category untouched", async () => {
  const data = fixture();
  succeed(data.task);
  render(<TaskProject {...props} {...data} />);
  expect(screen.getByText("项目：以前的项目（已归档）")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "修改项目" }));
  expect(
    (
      screen.getByRole("option", {
        name: "以前的项目（已归档）",
      }) as HTMLOptionElement
    ).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "保存项目关联" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("关联项目"), {
    target: { value: "active" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存项目关联" }));
  await screen.findByText("项目关联已保存。");
  expect(inputs()[0]).toMatchObject({
    taskId: "task",
    expectedTaskRevision: 4,
    projectId: "active",
    expectedProjectRevision: 2,
  });
  expect(inputs()[0]).not.toHaveProperty("category");
  expect(data.task.category).toBe("study");
});

it("clears an archived association using null without changing the project itself", async () => {
  const data = fixture();
  succeed(data.task);
  render(<TaskProject {...props} {...data} />);
  fireEvent.click(screen.getByRole("button", { name: "修改项目" }));
  fireEvent.change(screen.getByLabelText("关联项目"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存项目关联" }));
  await screen.findByText("已移除项目关联。");
  expect(inputs()[0]).toMatchObject({
    projectId: null,
    expectedProjectRevision: null,
    expectedTaskRevision: 4,
  });
  expect(mock).toHaveBeenCalledTimes(1);
  expect(data.state.planning?.context?.projects?.[1].archived).toBe(true);
});

it("preserves selected project on task revision conflict until explicit review, and blocks a newly archived target", async () => {
  const data = fixture();
  const view = render(<TaskProject {...props} {...data} />);
  fireEvent.click(screen.getByRole("button", { name: "修改项目" }));
  fireEvent.change(screen.getByLabelText("关联项目"), {
    target: { value: "active" },
  });
  const latest = structuredClone(data);
  latest.task.revision = 5;
  view.rerender(<TaskProject {...props} {...latest} />);
  expect(
    (screen.getByRole("button", { name: "保存项目关联" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((screen.getByLabelText("关联项目") as HTMLSelectElement).value).toBe(
    "active",
  );
  expect(mock).not.toHaveBeenCalled();
  const archived = structuredClone(latest);
  archived.state.planning!.context!.projects![0].archived = true;
  archived.state.planning!.context!.projects![0].revision = 3;
  view.rerender(<TaskProject {...props} {...archived} />);
  fireEvent.click(
    screen.getByRole("button", { name: "已核对，保留选择并使用当前版本" }),
  );
  expect(
    (screen.getByRole("button", { name: "保存项目关联" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(mock).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("关联项目"), {
    target: { value: "" },
  });
  succeed(archived.task);
  fireEvent.click(screen.getByRole("button", { name: "保存项目关联" }));
  await waitFor(() =>
    expect(inputs()[0]).toMatchObject({
      expectedTaskRevision: 5,
      projectId: null,
    }),
  );
});

it("retries the exact association after reopening and never sends before storage scope is ready", async () => {
  const data = fixture();
  mock.mockRejectedValueOnce("连接中断");
  const view = render(<TaskProject {...props} {...data} storageScope="" />);
  expect(
    (screen.getByRole("button", { name: "修改项目" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  view.rerender(<TaskProject {...props} {...data} />);
  fireEvent.click(screen.getByRole("button", { name: "修改项目" }));
  fireEvent.change(screen.getByLabelText("关联项目"), {
    target: { value: "active" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存项目关联" }));
  await screen.findByText("连接中断");
  const original = inputs()[0];
  view.unmount();
  succeed(data.task);
  render(<TaskProject {...props} {...data} />);
  expect(
    (screen.getByLabelText("关联项目") as HTMLSelectElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "核实并重试原提交" }));
  await screen.findByText("项目关联已保存。");
  expect(inputs()[1]).toEqual(original);
});
