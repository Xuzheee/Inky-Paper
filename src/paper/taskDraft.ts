import type { Draft, Task } from "./paperTypes";

export function taskDraft(task?: Task, nextCue = ""): Draft {
  return task
    ? {
        id: task.id,
        revision: task.revision,
        title: task.title,
        due: task.due || "",
        category: task.category,
        priority: task.priority,
        nextAction: task.nextAction?.completed
          ? nextCue
          : task.nextAction?.text || "",
      }
    : { title: "", due: "", nextAction: "" };
}

export function sameDraftContent(a: Draft, b: Draft) {
  return (
    a.title === b.title &&
    a.due === b.due &&
    a.nextAction === b.nextAction &&
    (a.category || "work") === (b.category || "work") &&
    (a.priority || "medium") === (b.priority || "medium")
  );
}

export function persistDraft(draft: Draft, baseline: Draft) {
  const key = `paper-draft-${draft.id || draft.originNoteId || "new"}`;
  if (sameDraftContent(draft, baseline)) {
    localStorage.removeItem(key);
    try {
      const global: Draft | null = JSON.parse(
        localStorage.getItem("paper-edit-draft") || "null",
      );
      if (
        global &&
        global.id === draft.id &&
        global.originNoteId === draft.originNoteId
      )
        localStorage.removeItem("paper-edit-draft");
    } catch {
      /* A corrupt global pointer must not overwrite another task's draft. */
    }
  } else {
    localStorage.setItem(key, JSON.stringify(draft));
    localStorage.setItem("paper-edit-draft", JSON.stringify(draft));
  }
}
