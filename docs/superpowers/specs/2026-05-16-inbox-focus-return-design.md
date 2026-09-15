# Inbox and Focus Return Design

## Goal

Add a v1.1 focus-protection flow to Inky: users can capture stray thoughts into an Inbox with less judgment, process those Inbox items later, and receive a lightweight cue back to the current task after capturing during focus.

## Scope

This design includes:

- Main capture input mode switching between Inbox and task capture.
- A visible mode button below the current input, with Tab as a keyboard shortcut.
- A dedicated Inbox data model persisted separately from tasks.
- A bottom-sheet Inbox processing panel.
- A focus-page lightweight Inbox-only capture input.
- Focus-return cue after focus-page capture.
- A settings toggle for focus-return cues.
- Lightweight Inky copy/state feedback.

This design does not include a visible idea-library screen for archived items. Archived Inbox items remain persisted with `status: 'archived'` so a future idea-library feature can expose them without changing the data model.

## Current App Context

`src/components/FocusFlowWidget/FocusFlowWidget.tsx` owns most user-facing state: tasks, mood, XP, pet name, current view, overlays, AI task parsing, pomodoro state, toast reminders, and settings. The current capture input creates tasks directly: short inputs open a category picker and longer inputs use AI parsing.

`src/utils/focusFlowPersistence.ts` and `src-tauri/src/persistence.rs` both enforce a versioned persisted state. The current database version is `2`; adding Inbox persistence requires a version `3` state and SQLite migration.

The current focus page does not have a quick capture input. It shows the focused task, timer, pomodoro controls, stats, and reminder toast.

## Product Naming

Use `Inky` for the pet/mascot in UI copy and implementation language. Older PRD references to another mascot name should be translated to Inky.

## Architecture

Inbox is a separate persisted collection, not a special task category. This keeps task statistics, XP, completion state, focus sessions, and pomodoro counts scoped to real tasks.

The main widget keeps one capture text input but adds a `captureMode` state. `captureMode === 'inbox'` submits directly to Inbox. `captureMode === 'task'` preserves the existing task flow: short text opens the category picker, longer text uses AI parsing.

The focus view gets a separate lightweight capture input that always writes to Inbox. Submitting there can show a focus-return cue if the user setting is enabled.

## Data Model

Add shared TypeScript types:

```ts
export type InboxItemStatus = 'pending' | 'converted' | 'archived' | 'deleted';

export interface InboxItem {
  id: string;
  text: string;
  createdAt: string;
  status: InboxItemStatus;
  convertedTaskId: string | null;
  date: string;
}
```

Persisted state version changes to `3`:

```ts
export interface FocusFlowPersistedState {
  version: 3;
  tasks: Task[];
  inboxItems: InboxItem[];
  mood: Mood;
  xp: number;
  petName: string;
  petSetId: PetSetId;
  showFocusReturn: boolean;
}
```

`date` is a local `YYYY-MM-DD` string derived at capture time. It supports future daily Inbox views without parsing timestamps.

## SQLite Persistence

`src-tauri/src/persistence.rs` should move `DATABASE_VERSION` to `3` and add:

```sql
CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'converted', 'archived', 'deleted')),
  converted_task_id TEXT NULL,
  date TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
```

Add `show_focus_return INTEGER NOT NULL DEFAULT 1 CHECK (show_focus_return IN (0, 1))` to `app_state`.

Migration rules:

- New databases create version 3 schema directly.
- Version 1 databases first receive the existing `pet_set_id` migration, then version 3 additions.
- Version 2 databases receive `show_focus_return` and `inbox_items`.
- Databases with a version greater than 3 still error as unsupported.

Save/load should preserve Inbox item order and all statuses. UI will filter to pending items where needed.

## Main Capture Interaction

The existing main capture form remains in the same visual location.

Add a mode switch below it:

- Inbox button: selected by default.
- Task button: selected when the user clicks it or presses Tab.
- Tab toggles between modes only outside focus view.
- The active mode changes placeholder, glyph, border/accent color, and right-side submit label.

Inbox mode behavior:

- Placeholder: `随手记，不用想太多...`
- Enter stores the trimmed input as a new pending Inbox item.
- The input clears immediately.
- No AI parsing and no category picker.
- Show lightweight feedback copy such as `帮你记住了。`

Task mode behavior:

- Placeholder: `添加一条任务...`
- Preserve existing behavior:
  - Text length `<= 8` opens the category picker.
  - Text length `> 8` uses AI parsing.
- Existing AI confirmation and category flows continue to create normal tasks.

## Focus Capture Interaction

Add a compact input to the focus view, placed below the timer/primary action area or near the lower portion of the focus content. It should be visually quiet and never switch to task mode.

Behavior:

- Placeholder: `冒出的念头先放这里...`
- Enter stores a pending Inbox item.
- The input clears.
- It does not open AI parsing or category selection.
- It does not leave focus mode.
- It can trigger focus-return cue if `showFocusReturn` is true.

## Focus Return Cue

When the user submits the focus capture input and `showFocusReturn` is true, show a transient cue below the focus capture input:

```text
✓ 已存入收集盒 · 回到 → {任务名}
```

Rules:

- Only focus-view capture triggers this cue.
- Main-view capture does not trigger it.
- Inbox processing actions do not trigger it.
- The cue disappears after 1.5 seconds.
- A new capture replaces the previous cue instead of stacking.
- Task names longer than 16 characters are truncated with `...`.
- This cue is independent from the existing 15-minute idle drift reminder.

## Inbox Processing Panel

Clicking the `◎ N` count in the bottom stats bar opens an Inbox bottom sheet. It can reuse the existing sheet/scrim visual language.

Panel content:

- Title: `◎ 收集盒 · N 条待处理`
- Inky copy: `“来清理一下今天的想法吧，清空之后更轻松。”`
- List of `status === 'pending'` items.
- Each item has actions:
  - `转任务`
  - `存档`
  - `删除`
- Footer actions:
  - `全部删除`
  - `稍后再说`

Processing actions:

- `存档`: mark item `archived`.
- `删除`: mark item `deleted`.
- `全部删除`: mark all pending items `deleted`.
- `稍后再说`: close the panel without changing data.
- `转任务`: enter an inline category-choice state for that Inbox item.

Converting to a task:

- User chooses one of the existing task categories.
- Create a normal task with:
  - title from Inbox item text
  - chosen category
  - priority `medium`
  - due `null`
  - completed `false`
  - completedPomodoros `0`
- Mark the Inbox item `converted`.
- Store the created task id in `convertedTaskId`.

If the final pending Inbox item is processed, close the panel and show Inky feedback copy: `清空了！脑子轻多了吧？`

## Stats Bar

Main view stats should add a clickable Inbox count at the right side:

```text
◎ N
```

`N` is the number of pending Inbox items. Clicking opens the Inbox panel. If `N` is zero, clicking may still open an empty panel or do nothing; use an empty panel if it is simpler and clearer.

Focus view stats may also show `◎ N`, but it should not be the primary way to capture thoughts during focus because the focus view has its own input.

## Settings

Add a setting in the existing settings panel:

- Label: `专注时显示回神引导`
- Default: on
- Persisted as `showFocusReturn`

When off:

- Focus capture still stores Inbox items.
- The focus-return cue does not appear.
- Existing toast reminders and idle drift reminder keep their current behavior.

## Inky Feedback

Use lightweight feedback through existing UI surfaces instead of new animation assets in v1.1.

- After Inbox capture: show copy like `帮你记住了。`
- After Inbox is cleared: show `清空了！脑子轻多了吧？`
- If pending Inbox items exceed 8: show a concerned main-view pet speech such as `收集盒快装满了，找个时间整理一下？`

Do not change `PetRenderer` animation frame structure for this version.

## File Responsibilities

- `src/types/index.ts`
  - Add Inbox types.
  - Add `inbox` to `OverlayState` if the panel uses overlay state.

- `src/utils/focusFlowPersistence.ts`
  - Add version 3 state shape.
  - Add Inbox item normalization.
  - Add `showFocusReturn` normalization.
  - Save/load Inbox items with current state.

- `src-tauri/src/persistence.rs`
  - Add Rust DTO fields and `InboxItemDto`.
  - Add SQLite v3 schema/migration.
  - Add validation for Inbox item statuses and non-empty text/id/date/created_at.
  - Add tests for default schema, v2 migration, saving/loading Inbox items, and invalid Inbox status rejection.

- `src/components/FocusFlowWidget/FocusFlowWidget.tsx`
  - Add capture mode, Inbox item state, focus capture input state, focus-return cue state, and show-focus-return state.
  - Route main capture submissions by mode.
  - Add focus capture input.
  - Add Inbox panel actions.
  - Add settings toggle.

- `src/components/FocusFlowWidget/FocusFlowWidget.module.css`
  - Add mode switch styles.
  - Add Inbox panel/list/action styles.
  - Add focus capture and focus-return cue styles.

## Testing Strategy

Automated checks:

- Run Rust persistence tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

- Run frontend type checking:

```bash
corepack pnpm typecheck
```

Manual desktop validation:

```bash
corepack pnpm tauri dev
```

Scenarios:

1. Main view defaults to Inbox mode.
2. Main Inbox capture stores a pending item and increments `◎ N`.
3. Button and Tab switch to task mode.
4. Task mode preserves category picker for short text.
5. Task mode preserves AI parse flow for longer text.
6. Inbox panel opens from `◎ N`.
7. `存档`, `删除`, and `全部删除` remove pending items from the panel without removing rows from persisted data.
8. `转任务` creates a normal task and marks the Inbox item converted.
9. Focus view capture stores an Inbox item without leaving focus mode.
10. Focus-return cue appears, refreshes on quick repeated capture, and disappears after 1.5 seconds.
11. Settings toggle disables the focus-return cue only.
12. App restart preserves pending Inbox count and show-focus-return setting.

## Risks and Constraints

- `FocusFlowWidget.tsx` is already large. The implementation should be surgical and avoid unrelated refactors, but small helper functions are acceptable when they keep Inbox actions understandable.
- The current working tree has unrelated modified files. Implementation must avoid touching unrelated Cargo, Tauri config, or PetRenderer changes unless necessary for this feature.
- Frontend currently has no dedicated test suite, so persistence correctness should be covered in Rust tests and UI behavior should be manually verified in the Tauri app.
