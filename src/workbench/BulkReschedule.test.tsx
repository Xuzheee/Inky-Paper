// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import BulkReschedule from "./BulkReschedule";
import { requestStorageKey } from "./editorDraft";
import type { AdjustmentData, Row } from "./model";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mock = vi.mocked(invoke);
const row = (n: number): Row => ({
  task: {
    id: `task-${n}`,
    title: `任务 ${n}`,
    category: "work",
    priority: "medium",
    due: null,
    nextAction: null,
    completed: false,
    revision: 3,
    source: "user",
    updatedAt: 1,
  },
  step: {
    id: `step-${n}`,
    taskId: `task-${n}`,
    text: `步骤 ${n}`,
    plannedSeconds: 1500,
    expectedResult: null,
    completed: false,
    revision: 4,
  },
  item: {
    id: `item-${n}`,
    taskId: `task-${n}`,
    stepId: `step-${n}`,
    date: "2030-03-04",
    startMinute: n === 1 ? 600 : null,
    durationMinutes: n === 1 ? 30 : 45,
    order: n,
    revision: 5,
    removedAt: null,
  },
});
const props = { storageScope: "bulk-test", blocked: false, onSaved: vi.fn() };
const requests = (action: string) =>
  mock.mock.calls
    .filter(([, args]) => args && "action" in args && args.action === action)
    .map(([, args]) => (args as { input: Record<string, any> }).input);
function backend(rows: Row[], failProposal = false, failAdopt = false) {
  let data: AdjustmentData;
  mock.mockImplementation(async (_command, args) => {
    const { action, input } = args as {
      action: string;
      input: Record<string, any>;
    };
    if (action === "propose_plan_adjustment") {
      data = {
        batch: {
          id: input.batchId,
          revision: 1,
          createdAt: 1,
          groups: input.groups.map((group: any) => ({
            ...group,
            adoptedAt: null,
            before: {
              tasks: rows.map((r) => r.task),
              steps: rows.map((r) => r.step!),
              dayItems: rows.map((r) => r.item!),
            },
            after: {
              tasks: rows.map((r) => r.task),
              steps: rows.map((r) => r.step!),
              dayItems: rows.map((r) => ({
                ...r.item!,
                date:
                  group.actions.find((a: any) => a.itemId === r.item!.id)
                    ?.date || r.item!.date,
              })),
            },
          })),
        },
      };
      if (failProposal) {
        failProposal = false;
        throw Error("响应丢失");
      }
    }
    if (action === "adopt_plan_adjustment") {
      if (failAdopt) throw Error("采用响应丢失");
      data!.batch.revision++;
      data!.batch.groups.forEach((group) => {
        group.adoptedAt = 2;
      });
    }
    return structuredClone(data!);
  });
}
function choose(count: number) {
  fireEvent.click(screen.getByRole("button", { name: "批量改期" }));
  fireEvent.change(screen.getByLabelText("批量改期目标日期"), {
    target: { value: "2030-03-05" },
  });
  for (let n = 1; n <= count; n++)
    fireEvent.click(
      screen.getByRole("checkbox", { name: `选择安排 步骤 ${n} · 2030-03-04` }),
    );
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  mock.mockReset();
  props.onSaved.mockClear();
});

it("proposes one dependency group with current versions and leaves timing omitted, then adopts only on confirmation", async () => {
  const rows = [row(1), row(2)];
  backend(rows);
  render(<BulkReschedule {...props} rows={rows} />);
  choose(2);
  fireEvent.click(screen.getByRole("button", { name: "生成改期预览" }));
  await screen.findByRole("checkbox", { name: "选择调整组 1" });
  const proposal = requests("propose_plan_adjustment")[0];
  expect(proposal.groups).toHaveLength(1);
  expect(proposal.groups[0].actions).toEqual(
    rows.map(({ task, step, item }) => ({
      kind: "reschedule",
      taskId: task.id,
      stepId: step!.id,
      expectedTaskRevision: 3,
      expectedStepRevision: 4,
      itemId: item!.id,
      expectedItemRevision: 5,
      date: "2030-03-05",
    })),
  );
  expect(
    screen.getByText("改为：2030-03-05 · 10:00 · 预留 30 分钟"),
  ).toBeTruthy();
  expect(
    screen.getByText("改为：2030-03-05 · 未设时刻 · 预留 45 分钟"),
  ).toBeTruthy();
  expect(requests("adopt_plan_adjustment")).toHaveLength(0);
  expect(requests("workbench_move_step")).toHaveLength(0);
  fireEvent.click(screen.getByRole("checkbox", { name: "选择调整组 1" }));
  fireEvent.click(screen.getByRole("button", { name: "采用所选 1 组调整" }));
  await screen.findByText("调整 1 · 已采用");
  expect(requests("adopt_plan_adjustment")[0]).toMatchObject({
    batchId: proposal.batchId,
    expectedRevision: 1,
    groupIds: [proposal.groups[0].id],
  });
  expect(props.onSaved).toHaveBeenCalledTimes(1);
});

it("recovers an uncertain proposal across close and restart with its original ids, versions, and parameters", async () => {
  const rows = [row(1), row(2)];
  backend(rows, true);
  const view = render(<BulkReschedule {...props} rows={rows} />);
  choose(2);
  fireEvent.click(screen.getByRole("button", { name: "生成改期预览" }));
  await screen.findByRole("button", { name: "核实并重试原提案" });
  const original = structuredClone(requests("propose_plan_adjustment")[0]);
  expect(
    localStorage.getItem(
      requestStorageKey(props.storageScope, "bulk-reschedule"),
    ),
  ).toContain(original.requestId);
  fireEvent.click(screen.getByRole("button", { name: "关闭批量改期" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  view.unmount();
  rows[0].item!.revision = 100;
  render(<BulkReschedule {...props} rows={rows} />);
  fireEvent.click(screen.getByRole("button", { name: "继续批量改期" }));
  expect(
    screen.getByLabelText("批量改期目标日期").closest("fieldset")!.disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "核实并重试原提案" }));
  await screen.findByRole("checkbox", { name: "选择调整组 1" });
  expect(requests("propose_plan_adjustment")).toEqual([original, original]);
  expect(
    localStorage.getItem(
      requestStorageKey(props.storageScope, "bulk-reschedule"),
    ),
  ).toBeNull();
});

it("retains access to an uncertain adoption when starting another batch is requested", async () => {
  const rows = [row(1)];
  backend(rows, false, true);
  render(<BulkReschedule {...props} rows={rows} />);
  choose(1);
  fireEvent.click(screen.getByRole("button", { name: "生成改期预览" }));
  fireEvent.click(
    await screen.findByRole("checkbox", { name: "选择调整组 1" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "采用所选 1 组调整" }));
  await screen.findByRole("button", { name: "核实并重试原提交" });
  fireEvent.click(screen.getByRole("button", { name: "开始另一批改期" }));
  expect(
    screen.getByText("上次操作仍待核实，请先重试原提交，再开始另一批改期。"),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "核实并重试原提交" })).toBeTruthy();
});

it("caps a proposal at 20 arrangements and isolates saved selection by data-directory scope", () => {
  const rows = Array.from({ length: 21 }, (_, n) => row(n + 1));
  const view = render(<BulkReschedule {...props} rows={rows} />);
  choose(20);
  expect(
    (
      screen.getByRole("checkbox", {
        name: "选择安排 步骤 21 · 2030-03-04",
      }) as HTMLInputElement
    ).disabled,
  ).toBe(true);
  view.unmount();
  render(
    <BulkReschedule
      {...props}
      storageScope="separate-test-directory"
      rows={rows}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "批量改期" }));
  expect(screen.getByText("已选 0 / 20 条安排")).toBeTruthy();
  expect(
    (screen.getByLabelText("批量改期目标日期") as HTMLInputElement).value,
  ).toBe("");
});

it("does not generate a proposal when a selected arrangement has become completed", async () => {
  const rows = [row(1)];
  const view = render(<BulkReschedule {...props} rows={rows} />);
  choose(1);
  view.rerender(
    <BulkReschedule
      {...props}
      rows={[{ ...rows[0], step: { ...rows[0].step!, completed: true } }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "生成改期预览" }));
  expect(
    screen.getByText("所选安排已变化，请重新选择未完成的安排。"),
  ).toBeTruthy();
  expect(requests("propose_plan_adjustment")).toHaveLength(0);
});
