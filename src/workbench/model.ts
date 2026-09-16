import { invoke } from "@tauri-apps/api/core";
import type { DayItem, PlanStep, Task } from "../paper/paperTypes";
export type Row = { task: Task; step?: PlanStep; item?: DayItem };
export const categories: Record<string, string> = {
  work: "工作",
  study: "学习",
  life: "个人事务",
  idea: "想法",
};
export const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseDate = (s: string) => new Date(`${s}T12:00:00`);
export const validDate = (s?: string | null): s is string =>
  !!s &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(parseDate(s).getTime()) &&
  dateKey(parseDate(s)) === s;
export const dateLabel = (s: string) =>
  `${Number(s.slice(5, 7))}月${Number(s.slice(8))}日`;
export const shiftDay = (s: string, n: number) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateKey(d);
};
export const clock = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const minutes = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
export const paper = <T = Record<string, unknown>>(
  action: string,
  input: Record<string, unknown> = {},
) => invoke<T>("paper_execute", { action, input });
export const mutate = <T = Record<string, unknown>>(
  action: string,
  input: Record<string, unknown>,
) => paper<T>(action, { requestId: crypto.randomUUID(), ...input });
export type DiscussionContext = {
  date: string;
  selectedTaskId: string | null;
  selectedStepId: string | null;
  taskTitle: string | null;
  stepText: string | null;
  schemaVersion?: number;
  intent?: "auto" | "plan" | "stuck" | "review";
  viewDate?: string;
  today?: string;
  utcOffsetMinutes?: number;
  selectedDayItemId?: string | null;
  resolvedIntent?: "auto" | "plan" | "stuck" | "review";
  sampledAt?: number;
  latestFacts?: Record<string, unknown>;
  versions?: Record<string, unknown>;
  truncated?: Record<string, boolean>;
  temporaryConstraints?: { text: string; scope: "request" };
};
export type Message = {
  id: string;
  role: string;
  text: string;
  created: number;
  status?: string;
  context?: DiscussionContext | null;
};
export const planDirective =
  /::inky-plan\{batchId="([0-9a-f-]{36})"(?: date="(\d{4}-\d{2}-\d{2})")?\}/gi;
export const adjustmentDirective =
  /::inky-adjust\{batchId="([0-9a-f-]{36})"\}/gi;
type AdjustmentTarget = {
  taskId: string;
  stepId: string;
  expectedTaskRevision: number;
  expectedStepRevision: number;
};
export type AdjustmentAction =
  | (AdjustmentTarget & {
      kind: "continue";
      items: { id: string; revision: number }[];
      date: string;
    })
  | (AdjustmentTarget & {
      kind: "reschedule";
      itemId: string;
      expectedItemRevision: number;
      date: string;
      startMinute?: number | null;
      durationMinutes?: number | null;
    })
  | (AdjustmentTarget & {
      kind: "reservation";
      itemId: string;
      expectedItemRevision: number;
      durationMinutes: number | null;
    })
  | { kind: "reorder"; date: string; items: { id: string; revision: number }[] }
  | (AdjustmentTarget & {
      kind: "narrow";
      text: string;
      expectedResult: string | null;
      plannedSeconds: number;
      date: string | null;
      newStepId: string;
    });
export type AdjustmentSnapshot = {
  tasks: Task[];
  steps: PlanStep[];
  dayItems: DayItem[];
};
export type AdjustmentGroup = {
  id: string;
  reason: string;
  actions: AdjustmentAction[];
  before: AdjustmentSnapshot;
  after: AdjustmentSnapshot;
  adoptedAt: number | null;
};
export type AdjustmentData = {
  batch: {
    id: string;
    revision: number;
    createdAt: number;
    groups: AdjustmentGroup[];
  };
};
export const prepareStepInInky = (row: Row) =>
  invoke("workbench_prepare_step", {
    input: {
      requestId: crypto.randomUUID(),
      taskId: row.task.id,
      stepId: row.step?.id,
      expectedRevision: row.task.revision,
      expectedStepRevision: row.step?.revision,
    },
    itemId: row.item?.id ?? null,
  });
export type Conversation = { id: string; title: string; updated: number };
export type Candidate = {
  id: string;
  taskId: string;
  taskTitle?: string;
  text: string;
  plannedSeconds: number;
  expectedResult?: string;
  stepId?: string;
  adoptedStepId?: string;
  expectedTaskRevision?: number;
  expectedStepRevision?: number;
};
export type BatchData = {
  batch: { id: string; revision: number; cards: Candidate[] };
  tasks: Task[];
  steps: PlanStep[];
  dayItems: DayItem[];
};
export const getError = (e: unknown) => String(e).replace(/^Error:\s*/, "");

export function calendarLanes(rows: Row[]) {
  const result = new Map<string, { lane: number; count: number }>();
  const sorted = [...rows].sort(
    (a, b) => a.item!.startMinute! - b.item!.startMinute!,
  );
  let group: { id: string; lane: number }[] = [],
    ends: number[] = [],
    groupEnd = -1;
  const flush = () => {
    for (const item of group)
      result.set(item.id, { lane: item.lane, count: ends.length });
    group = [];
    ends = [];
  };
  for (const row of sorted) {
    const item = row.item!,
      start = item.startMinute!;
    if (start >= groupEnd) flush();
    let lane = ends.findIndex((end) => end <= start);
    if (lane < 0) lane = ends.length;
    // A short event still needs enough room for a readable, clickable title.
    const end = start + Math.max(item.durationMinutes || 25, (25 / 68) * 60);
    ends[lane] = end;
    groupEnd = Math.max(...ends);
    group.push({ id: item.id, lane });
  }
  flush();
  return result;
}
