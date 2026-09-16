import { clock, type Row } from "./model";

export type EditorValues = {
  title: string;
  text: string;
  category: string;
  priority: string;
  due: string;
  dueDate: string;
  expectedResult: string;
  day: string;
  time: string;
  duration: number;
  round: number;
};
export type EditorDraft = {
  schemaVersion: 1;
  objectKey: string;
  ids: { taskId: string; stepId: string };
  original?: Row;
  base?: Row;
  values: EditorValues;
  editedFields: (keyof EditorValues)[];
  savedAt: number;
};
export const storagePrefix = (scope: string) => `inky-wb:${scope}:`;
export const editorObjectKey = (row?: Row) =>
  row
    ? `${row.task.id}:${row.step?.id || "task"}:${row.item?.id || "unplanned"}`
    : "new";
export const editorStorageKey = (scope: string, objectKey: string) =>
  `${storagePrefix(scope)}draft:${encodeURIComponent(objectKey)}`;
export const requestStorageKey = (scope: string, owner: string) =>
  `${storagePrefix(scope)}request:${encodeURIComponent(owner)}`;
export const initialEditorDraft = (
  row: Row | undefined,
  date: string | null,
  startMinute?: number,
): EditorDraft => ({
  schemaVersion: 1,
  objectKey: editorObjectKey(row),
  ids: {
    taskId: row?.task.id || crypto.randomUUID(),
    stepId: row?.step?.id || crypto.randomUUID(),
  },
  original: row,
  base: row,
  editedFields: [],
  savedAt: 0,
  values: {
    title: row?.task.title || "",
    text: row?.step?.text || "",
    category: row?.task.category || "work",
    priority: row?.task.priority || "medium",
    due: row?.task.due || "",
    dueDate: row?.task.dueDate || "",
    expectedResult: row?.step?.expectedResult || "",
    day: row?.item?.date || date || "",
    time:
      row?.item?.startMinute != null
        ? clock(row.item.startMinute)
        : startMinute != null
          ? clock(startMinute)
          : "",
    duration:
      row?.item?.durationMinutes ||
      Math.round((row?.step?.plannedSeconds || 1500) / 60),
    round: Math.round((row?.step?.plannedSeconds || 1500) / 60),
  },
});
export function readEditorDraft(
  scope: string,
  objectKey: string,
): EditorDraft | undefined {
  const raw = localStorage.getItem(editorStorageKey(scope, objectKey));
  if (!raw) return undefined;
  const draft: EditorDraft = JSON.parse(raw);
  if (
    draft.schemaVersion !== 1 ||
    draft.objectKey !== objectKey ||
    !draft.ids?.taskId ||
    !draft.ids.stepId ||
    !draft.values ||
    typeof draft.values.title !== "string"
  )
    throw Error("这份编辑草稿无法读取，请保留原记录后检查。");
  return draft;
}
export function listEditorDrafts(scope: string) {
  const prefix = `${storagePrefix(scope)}draft:`;
  const result: (EditorDraft & { unconfirmed: boolean })[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const draft = readEditorDraft(
      scope,
      decodeURIComponent(key.slice(prefix.length)),
    );
    if (!draft) continue;
    const pending = JSON.parse(
      localStorage.getItem(
        requestStorageKey(scope, `editor:${draft.objectKey}`),
      ) || "null",
    );
    result.push({
      ...draft,
      unconfirmed: !!pending && !pending.definitiveFailure,
    });
  }
  return result.sort((a, b) => b.savedAt - a.savedAt);
}
