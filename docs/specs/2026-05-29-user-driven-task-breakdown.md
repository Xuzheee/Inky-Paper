# User-Driven Task Breakdown Design

**Goal:** Let users describe their own plan for a task, then have Inky organize that plan into editable subtasks.

**Scope:** MVP implementation. Includes AI-assisted breakdown, editable confirmation, persisted subtasks, subtask completion/deletion/manual add, collapsed progress display, and XP settlement on parent task completion. Excludes subtask drag sorting and pomodoro binding.

## Product behavior

### Entry point

Each incomplete parent task shows a `✦` breakdown button on the right side of the task row. If the task already has subtasks, the icon becomes `✦·`. Completed tasks do not show the breakdown entry.

The hover label is `拆解计划`.

### Plan input card

Clicking the breakdown button opens a dark plan input card over the main widget. The card contains:

- The parent task title
- A textarea with placeholder `写下你打算怎么做...`
- A secondary `还不知道怎么做` button
- A primary `整理成步骤` button

The card does not show a separate example text block. The textarea auto-focuses when the card opens. The primary button is disabled while the textarea is empty or below the minimum useful input length.

`还不知道怎么做` closes the card, focuses the main capture input, and lets Inky prompt the user to describe the task at a higher level.

### Loading and AI fallback

Submitting the plan switches the card into a loading state. Inky uses the `think` expression while the request is in flight.

The app calls a dedicated task-breakdown AI command with a 5 second frontend timeout. If AI is unavailable, unconfigured, times out, or returns unusable data, the app opens the confirmation card with two empty step inputs. The user can manually enter steps and continue without configuring AI.

### Confirmation card

On AI success, the confirmation card displays 2-6 editable step rows. The user can:

- Edit any row inline
- Delete a row
- Add a manual row
- Return to the plan input card with the previous text preserved
- Confirm and start

The confirm button is disabled when all step rows are empty. Confirming saves only non-empty steps.

### Subtask list

After confirmation, the card closes and the new subtasks render under the parent task. The subtask list is expanded by default.

Clicking the parent task body toggles expanded/collapsed state. Clicking the parent task checkbox, breakdown button, focus button, or delete button does not toggle the list.

Expanded state shows:

- One small checkbox per subtask
- The subtask text
- A delete button on row hover
- A `+ 添加步骤` row at the bottom

Collapsed state shows a compact progress label in this format:

```text
▸ 2/4
```

The MVP does not include subtask drag sorting or subtask pomodoro binding.

## XP behavior

Subtask completion does not award XP immediately.

Completing a parent task awards the existing base parent-task XP. If that parent task has subtasks and every subtask is complete at the moment the parent is completed, the app awards an additional `+10 XP`.

The app does not block parent task completion when subtasks remain incomplete; it simply skips the extra subtask-completion bonus.

## Data model

Add a new shared frontend type:

```ts
export type SubTaskSource = 'ai' | 'manual';

export interface SubTask {
  id: string;
  parentTaskId: string;
  text: string;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
  order: number;
  source: SubTaskSource;
}
```

Do not add `hasSubtasks`, `subtaskCount`, or `subtaskDoneCount` to `Task`. Those values are derived from `subTasks` in UI code to avoid redundant persisted state.

## Persistence

The persisted focus-flow state moves from version 4 to version 5 and adds `subTasks: SubTask[]`.

Rust SQLite adds a `sub_tasks` table with:

- `id TEXT PRIMARY KEY`
- `parent_task_id TEXT NOT NULL`
- `text TEXT NOT NULL`
- `completed INTEGER NOT NULL CHECK (completed IN (0, 1))`
- `created_at TEXT NOT NULL`
- `completed_at TEXT`
- `position INTEGER NOT NULL`
- `source TEXT NOT NULL CHECK (source IN ('ai', 'manual'))`

The v4-to-v5 migration creates an empty `sub_tasks` table. Existing tasks remain unchanged.

Loading state validates that every subtask references an existing parent task. Saving state persists tasks and subtasks together so task deletion can remove child subtasks in the same save payload.

## AI command

Add a dedicated Tauri command:

```ts
break_down_task_with_ai(request: {
  taskTitle: string;
  userPlan: string;
}): Promise<{
  steps: string[];
  inkyComment: string;
}>;
```

This command reuses the existing AI configuration storage, but it uses a separate prompt and result DTO from the current task parsing command. The current `parse_task_with_ai` contract remains unchanged.

Frontend normalization:

- Trim step text
- Remove empty steps
- Cap at 6 steps
- Cap each step at 20 characters
- Treat invalid or empty results as fallback-to-manual

## Component boundaries

Keep the MVP inside the existing `FocusFlowWidget` flow, but split helper logic where it reduces risk:

- Shared domain types in `src/types/index.ts`
- Persistence normalization in `src/utils/focusFlowPersistence.ts`
- AI breakdown wrapper in a new `src/utils/taskBreakdown.ts`
- Rust AI prompt/normalization alongside existing AI code in `src-tauri/src/claude.rs`
- Rust persistence migration/validation in `src-tauri/src/persistence.rs`

The current `FocusFlowWidget.tsx` is already large. The implementation may extract a focused presentational component for the breakdown card if that keeps the main widget readable, but should not refactor unrelated widget behavior.

## Testing and verification

Required checks:

```powershell
corepack pnpm typecheck
corepack pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Manual desktop verification should cover:

- Opening the breakdown card from an incomplete task
- Empty input disabled state
- AI success path when AI is configured
- Fallback manual confirmation when AI is unavailable
- Editing, deleting, and adding step rows before confirmation
- Confirming subtasks and seeing them expanded under the parent task
- Collapsing to `▸ 2/4`
- Completing subtasks and then completing the parent task with the extra XP bonus
- Completing a parent task with unfinished subtasks and seeing only base XP
- Deleting a parent task removes its subtasks
