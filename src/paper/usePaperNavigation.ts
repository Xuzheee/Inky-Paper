import { useState } from "react";

export type PaperView =
  | "home"
  | "focus"
  | "edit"
  | "feedback"
  | "receipt"
  | "celebration"
  | "settings"
  | "notes"
  | "history"
  | "day-plan"
  | "work-start"
  | "work"
  | "work-end"
  | "coach-help";

// Browsing never changes a running session; completed flows reset their return path.
export function usePaperNavigation() {
  const [path, setPath] = useState<PaperView[]>(["home"]);
  return {
    view: path[path.length - 1],
    navigate: (next: PaperView) =>
      setPath((current) =>
        current[current.length - 1] === next ? current : [...current, next],
      ),
    reset: (next: PaperView) => setPath([next]),
    back: (fallback: PaperView, valid: (view: PaperView) => boolean) =>
      setPath((current) => {
        const previous = current.slice(0, -1).filter(valid);
        return previous.length ? previous : [fallback];
      }),
  };
}
