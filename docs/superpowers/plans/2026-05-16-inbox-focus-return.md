# Inbox and Focus Return Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Inky v1.1 Inbox capture, Inbox processing, and focus-return guidance while preserving the existing task and AI parsing flows.

**Architecture:** Inbox is a separate persisted collection from tasks, backed by a SQLite v3 migration and frontend normalizers. The existing `FocusFlowWidget` gains a capture mode for main-view input, an Inbox bottom sheet, and a focus-view Inbox-only input with a transient focus-return cue. UI changes are surgical and reuse existing sheet, stats, and settings patterns.

**Tech Stack:** Tauri 2, Rust, rusqlite, React 18, TypeScript, Vite, CSS modules, pnpm.

---

## File Structure

- Modify `src/types/index.ts`
  - Add `InboxItemStatus` and `InboxItem`.
  - Add `inbox` to `OverlayState`.

- Modify `src-tauri/src/persistence.rs`
  - Bump database version to 3.
  - Add `InboxItemDto` and `show_focus_return` to persisted state.
  - Add `inbox_items` table and v2-to-v3 migration.
  - Load/save/validate Inbox rows.
  - Extend persistence tests.

- Modify `src/utils/focusFlowPersistence.ts`
  - Bump frontend persisted state version to 3.
  - Add Inbox normalizer and `showFocusReturn` normalization.
  - Include Inbox items and setting in save/load payloads.

- Modify `src/components/FocusFlowWidget/FocusFlowWidget.tsx`
  - Add Inbox state, capture mode state, focus input state, focus-return cue state, and setting state.
  - Route main capture by mode.
  - Add Inbox bottom sheet actions.
  - Add focus capture input and focus-return cue.
  - Add settings toggle.

- Modify `src/components/FocusFlowWidget/FocusFlowWidget.module.css`
  - Style capture mode switch, Inbox sheet, focus capture input, and focus-return cue.

---

### Task 1: Add Rust persistence schema and tests

**Files:**
- Modify: `src-tauri/src/persistence.rs:6-461`
- Test: embedded Rust tests in `src-tauri/src/persistence.rs`

- [ ] **Step 1: Add failing Rust tests for v3 defaults, save/load, migration, and validation**

In `src-tauri/src/persistence.rs`, update the test module to expect version 3, Inbox rows, and `show_focus_return`.

Use these exact test additions/changes:

```rust
fn custom_inbox_item() -> InboxItemDto {
    InboxItemDto {
        id: "inbox-1".into(),
        text: "突然想到定价策略".into(),
        created_at: "2026-05-16T10:00:00.000Z".into(),
        status: "pending".into(),
        converted_task_id: None,
        date: "2026-05-16".into(),
    }
}
```

Update `custom_state()` so it includes:

```rust
version: 3,
show_focus_return: true,
inbox_items: vec![custom_inbox_item()],
```

Update `first_run_initializes_schema_and_default_state()` assertions:

```rust
assert_eq!(schema_version, 3);
assert_eq!(state.version, 3);
assert!(state.show_focus_return);
assert!(state.inbox_items.is_empty());
```

Add this test:

```rust
#[test]
fn version_two_database_migrates_to_inbox_schema() {
    let tempdir = tempdir().unwrap();
    let database_path = tempdir.path().join("focusflow.sqlite3");
    let connection = Connection::open(&database_path).unwrap();
    connection
        .execute_batch(
            "
            CREATE TABLE app_state (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              mood TEXT NOT NULL CHECK (mood IN ('好', '一般', '烦')),
              xp INTEGER NOT NULL CHECK (xp >= 0),
              pet_name TEXT NOT NULL,
              pet_set_id TEXT NOT NULL DEFAULT 'builtin:inky'
            );

            CREATE TABLE tasks (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              category TEXT NOT NULL CHECK (category IN ('work', 'study', 'life', 'idea')),
              priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
              completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
              due TEXT NULL,
              completed_pomodoros INTEGER NOT NULL CHECK (completed_pomodoros >= 0),
              sort_order INTEGER NOT NULL
            );

            INSERT INTO app_state (id, mood, xp, pet_name, pet_set_id)
            VALUES (1, '一般', 42, 'Inky', 'builtin:inky');
            PRAGMA user_version = 2;
            ",
        )
        .unwrap();
    drop(connection);

    let connection = open_database(database_path).unwrap();
    let schema_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    let state = load_state(&connection).unwrap();

    assert_eq!(schema_version, 3);
    assert!(state.show_focus_return);
    assert!(state.inbox_items.is_empty());
}
```

Add this validation assertion to `save_rejects_invalid_enums_and_negative_numbers()`:

```rust
let mut invalid = custom_state();
invalid.inbox_items[0].status = "unknown".into();
assert!(save_state(&mut database.connection, &invalid).is_err());

let mut invalid = custom_state();
invalid.inbox_items[0].text = "   ".into();
assert!(save_state(&mut database.connection, &invalid).is_err());
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with errors that `InboxItemDto`, `show_focus_return`, and `inbox_items` do not exist, and version assertions still expect schema version 2.

- [ ] **Step 3: Implement Rust v3 state and Inbox schema**

In `src-tauri/src/persistence.rs`, change the version and DTOs to:

```rust
const DATABASE_VERSION: u8 = 3;
```

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusFlowPersistedState {
    pub version: u8,
    pub tasks: Vec<TaskDto>,
    pub inbox_items: Vec<InboxItemDto>,
    pub mood: String,
    pub xp: i64,
    pub pet_name: String,
    pub pet_set_id: String,
    pub show_focus_return: bool,
}
```

Add below `TaskDto`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItemDto {
    pub id: String,
    pub text: String,
    pub created_at: String,
    pub status: String,
    pub converted_task_id: Option<String>,
    pub date: String,
}
```

Update `default_state()` to include:

```rust
show_focus_return: true,
inbox_items: Vec::new(),
```

Update the new-database schema block so `app_state` and `inbox_items` are:

```sql
CREATE TABLE app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mood TEXT NOT NULL CHECK (mood IN ('好', '一般', '烦')),
  xp INTEGER NOT NULL CHECK (xp >= 0),
  pet_name TEXT NOT NULL,
  pet_set_id TEXT NOT NULL DEFAULT 'builtin:inky',
  show_focus_return INTEGER NOT NULL DEFAULT 1 CHECK (show_focus_return IN (0, 1))
);

CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'converted', 'archived', 'deleted')),
  converted_task_id TEXT NULL,
  date TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

PRAGMA user_version = 3;
```

Replace the migration logic with sequential migration:

```rust
if version == 0 {
    connection.execute_batch("...new version 3 schema...")?;
    let defaults = default_state();
    save_state(connection, &defaults)?;
} else {
    if version == 1 {
        connection.execute_batch(
            "
            ALTER TABLE app_state ADD COLUMN pet_set_id TEXT NOT NULL DEFAULT 'builtin:inky';
            PRAGMA user_version = 2;
            ",
        )?;
    }

    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == 2 {
        connection.execute_batch(
            "
            ALTER TABLE app_state ADD COLUMN show_focus_return INTEGER NOT NULL DEFAULT 1 CHECK (show_focus_return IN (0, 1));

            CREATE TABLE inbox_items (
              id TEXT PRIMARY KEY,
              text TEXT NOT NULL,
              created_at TEXT NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('pending', 'converted', 'archived', 'deleted')),
              converted_task_id TEXT NULL,
              date TEXT NOT NULL,
              sort_order INTEGER NOT NULL
            );

            PRAGMA user_version = 3;
            ",
        )?;
    }

    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > i64::from(DATABASE_VERSION) {
        return Err(rusqlite::Error::InvalidQuery);
    }
}
```

Update `load_state()` to read `show_focus_return` and Inbox rows:

```rust
let (mood, xp, pet_name, pet_set_id, show_focus_return): (String, i64, String, String, i64) = connection.query_row(
    "SELECT mood, xp, pet_name, pet_set_id, show_focus_return FROM app_state WHERE id = 1",
    [],
    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
)?;
```

```rust
let mut inbox_statement = connection.prepare(
    "
    SELECT id, text, created_at, status, converted_task_id, date
    FROM inbox_items
    ORDER BY sort_order ASC
    ",
)?;
let inbox_items = inbox_statement
    .query_map([], |row| {
        Ok(InboxItemDto {
            id: row.get(0)?,
            text: row.get(1)?,
            created_at: row.get(2)?,
            status: row.get(3)?,
            converted_task_id: row.get(4)?,
            date: row.get(5)?,
        })
    })?
    .collect::<Result<Vec<_>, _>>()?;
```

Return these fields:

```rust
inbox_items,
show_focus_return: show_focus_return == 1,
```

Update `save_state()` to insert `show_focus_return` and Inbox rows:

```rust
transaction.execute(
    "
    INSERT INTO app_state (id, mood, xp, pet_name, pet_set_id, show_focus_return)
    VALUES (1, ?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(id) DO UPDATE SET mood = excluded.mood, xp = excluded.xp, pet_name = excluded.pet_name, pet_set_id = excluded.pet_set_id, show_focus_return = excluded.show_focus_return
    ",
    params![state.mood, state.xp, pet_name, pet_set_id, if state.show_focus_return { 1 } else { 0 }],
)?;
```

After deleting tasks, add:

```rust
transaction.execute("DELETE FROM inbox_items", [])?;

{
    let mut statement = transaction.prepare(
        "
        INSERT INTO inbox_items (id, text, created_at, status, converted_task_id, date, sort_order)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ",
    )?;

    for (index, item) in state.inbox_items.iter().enumerate() {
        statement.execute(params![
            item.id,
            item.text,
            item.created_at,
            item.status,
            item.converted_task_id,
            item.date,
            index as i64,
        ])?;
    }
}
```

Add Inbox validation helpers:

```rust
fn is_inbox_status(value: &str) -> bool {
    matches!(value, "pending" | "converted" | "archived" | "deleted")
}
```

Extend `validate_state()`:

```rust
for item in &state.inbox_items {
    if item.id.trim().is_empty()
        || item.text.trim().is_empty()
        || item.created_at.trim().is_empty()
        || item.date.trim().is_empty()
        || !is_inbox_status(&item.status)
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
}
```

- [ ] **Step 4: Run Rust tests and verify pass**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS for all persistence tests.

---

### Task 2: Add TypeScript persisted types and normalizers

**Files:**
- Modify: `src/types/index.ts:1-21`
- Modify: `src/utils/focusFlowPersistence.ts:1-134`

- [ ] **Step 1: Add shared Inbox types**

In `src/types/index.ts`, add:

```ts
export type InboxItemStatus = 'pending' | 'converted' | 'archived' | 'deleted';
```

Change overlay state to:

```ts
export type OverlayState = 'none' | 'category' | 'ai-parse' | 'break' | 'level-up' | 'settings' | 'inbox';
```

Add after `Task`:

```ts
export interface InboxItem {
  id: string;
  text: string;
  createdAt: string;
  status: InboxItemStatus;
  convertedTaskId: string | null;
  date: string;
}
```

- [ ] **Step 2: Update frontend persistence state shape**

In `src/utils/focusFlowPersistence.ts`, change imports:

```ts
import type { InboxItem, InboxItemStatus, Mood, Task, TaskCategory, TaskPriority } from '../types';
```

Add status set:

```ts
const inboxStatuses = new Set<InboxItemStatus>(['pending', 'converted', 'archived', 'deleted']);
```

Change `FocusFlowPersistedState`:

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

Update defaults:

```ts
export const defaultFocusFlowState: FocusFlowPersistedState = {
  version: 3,
  petName: 'Inky',
  tasks: [
    { id: '1', title: '回复导师邮件', category: 'work', priority: 'high', completed: false, due: '今天 16:00', completedPomodoros: 0 },
    { id: '2', title: '整理读书笔记', category: 'study', priority: 'medium', completed: false, due: null, completedPomodoros: 0 },
    { id: '3', title: '买明天早饭食材', category: 'life', priority: 'low', completed: true, due: '明早', completedPomodoros: 0 },
  ],
  inboxItems: [],
  mood: '好',
  xp: 10,
  petSetId: DEFAULT_PET_SET_ID,
  showFocusReturn: true,
};
```

Update clone:

```ts
export function cloneDefaultFocusFlowState(): FocusFlowPersistedState {
  return {
    ...defaultFocusFlowState,
    tasks: defaultFocusFlowState.tasks.map((task) => ({ ...task })),
    inboxItems: defaultFocusFlowState.inboxItems.map((item) => ({ ...item })),
  };
}
```

- [ ] **Step 3: Add Inbox normalizer and version 3 validation**

Add below `normalizeTask`:

```ts
function normalizeInboxItem(value: unknown): InboxItem | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== 'string' ||
    typeof value.text !== 'string' ||
    !value.text.trim() ||
    typeof value.createdAt !== 'string' ||
    !value.createdAt.trim() ||
    typeof value.date !== 'string' ||
    !value.date.trim() ||
    typeof value.status !== 'string' ||
    !inboxStatuses.has(value.status as InboxItemStatus) ||
    !(typeof value.convertedTaskId === 'string' || value.convertedTaskId === null)
  ) {
    return null;
  }

  return {
    id: value.id,
    text: value.text,
    createdAt: value.createdAt,
    status: value.status as InboxItemStatus,
    convertedTaskId: value.convertedTaskId,
    date: value.date,
  };
}
```

Update `normalizeState()` to require version 3 and Inbox items:

```ts
if (
  !isRecord(value) ||
  value.version !== 3 ||
  !Array.isArray(value.tasks) ||
  !Array.isArray(value.inboxItems) ||
  typeof value.mood !== 'string' ||
  !moods.has(value.mood as Mood) ||
  typeof value.xp !== 'number' ||
  !Number.isFinite(value.xp) ||
  value.xp < 0
) {
  return null;
}

const tasks = value.tasks.map(normalizeTask);
const inboxItems = value.inboxItems.map(normalizeInboxItem);

if (tasks.some((task) => task === null) || inboxItems.some((item) => item === null)) {
  return null;
}

return {
  version: 3,
  tasks: tasks as Task[],
  inboxItems: inboxItems as InboxItem[],
  mood: value.mood as Mood,
  xp: Math.floor(value.xp),
  petName:
    typeof value.petName === 'string' && value.petName.trim() && value.petName.trim() !== '小章章'
      ? value.petName.trim()
      : defaultFocusFlowState.petName,
  petSetId: isPetSetId(value.petSetId) ? value.petSetId : DEFAULT_PET_SET_ID,
  showFocusReturn: typeof value.showFocusReturn === 'boolean' ? value.showFocusReturn : true,
};
```

Update `saveFocusFlowState` signature and payload:

```ts
export async function saveFocusFlowState(
  state: Pick<FocusFlowPersistedState, 'tasks' | 'inboxItems' | 'mood' | 'xp' | 'petName' | 'petSetId' | 'showFocusReturn'>,
) {
  try {
    await invoke('save_focus_flow_state', {
      payload: {
        version: 3,
        tasks: state.tasks,
        inboxItems: state.inboxItems,
        mood: state.mood,
        xp: Math.max(0, Math.floor(state.xp)),
        petName: state.petName.trim() || defaultFocusFlowState.petName,
        petSetId: isPetSetId(state.petSetId) ? state.petSetId : DEFAULT_PET_SET_ID,
        showFocusReturn: state.showFocusReturn,
      } satisfies FocusFlowPersistedState,
    });
  } catch {
    // Persistence remains best-effort so UI actions are not blocked by disk errors.
  }
}
```

- [ ] **Step 4: Run frontend typecheck and fix only related errors**

Run:

```bash
corepack pnpm typecheck
```

Expected now: FAIL because `FocusFlowWidget.tsx` still calls `saveFocusFlowState` without `inboxItems` and `showFocusReturn`.

Do not fix unrelated pre-existing errors unless they are directly caused by this change.

---

### Task 3: Wire main-view Inbox capture mode

**Files:**
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.tsx:1-1078`
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css`

- [ ] **Step 1: Add state and helper functions**

In `FocusFlowWidget.tsx`, change imports:

```ts
import type { InboxItem, Mood, OverlayState, TaskCategory, TaskPriority, ViewState } from '../../types';
```

Add constants near existing constants:

```ts
const FOCUS_RETURN_CUE_MS = 1_500;

type CaptureMode = 'inbox' | 'task';
```

Add state near `input`:

```ts
const [inboxItems, setInboxItems] = useState<InboxItem[]>(initialFocusFlowState.inboxItems);
const [captureMode, setCaptureMode] = useState<CaptureMode>('inbox');
const [showFocusReturn, setShowFocusReturn] = useState(initialFocusFlowState.showFocusReturn);
```

Update persistence load:

```ts
setInboxItems(persistedState.inboxItems);
setShowFocusReturn(persistedState.showFocusReturn);
```

Update persistence save effect:

```ts
void saveFocusFlowState({ tasks, inboxItems, mood, xp, petName, petSetId, showFocusReturn });
```

Update dependency array:

```ts
}, [isPersistenceLoaded, tasks, inboxItems, mood, xp, petName, petSetId, showFocusReturn]);
```

Add derived pending items:

```ts
const pendingInboxItems = inboxItems.filter((item) => item.status === 'pending');
```

Add helpers near `addTask`:

```ts
function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createInboxItem(text: string): InboxItem {
  const now = new Date();

  return {
    id: crypto.randomUUID(),
    text,
    createdAt: now.toISOString(),
    status: 'pending',
    convertedTaskId: null,
    date: localDateString(now),
  };
}

function addInboxItem(text: string) {
  setInboxItems((current) => [createInboxItem(text), ...current]);
}
```

- [ ] **Step 2: Route main submit by capture mode**

Replace the beginning of `handleSubmit()` after trimming title with:

```ts
if (!title || isParsingTask) {
  return;
}

if (captureMode === 'inbox') {
  addInboxItem(title);
  setInput('');
  resetParsedState();
  setOverlay('none');
  setPetComment('帮你记住了。');
  return;
}

resetParsedState();
```

Keep the existing task-mode logic after this block unchanged.

Add a Tab handler to the main input:

```tsx
onKeyDown={(event) => {
  if (event.key === 'Tab') {
    event.preventDefault();
    setCaptureMode((current) => (current === 'inbox' ? 'task' : 'inbox'));
  }
}}
```

- [ ] **Step 3: Update main capture JSX**

Change the form class:

```tsx
<form className={`${styles.captureForm} ${captureMode === 'task' ? styles.taskCapture : styles.inboxCapture} ${isAiParsing && captureMode === 'task' ? styles.aiReady : ''}`} onSubmit={handleSubmit}>
```

Change glyph:

```tsx
<span className={styles.captureGlyph} aria-hidden="true">{captureMode === 'inbox' ? '◎' : '✦'}</span>
```

Change input placeholder and aria label:

```tsx
placeholder={captureMode === 'inbox' ? '随手记，不用想太多...' : '添加一条任务...'}
aria-label={captureMode === 'inbox' ? '快速记录到收集盒' : '快速记录任务'}
```

Change submit text:

```tsx
{isParsingTask ? '解析中' : captureMode === 'inbox' ? '存入' : isAiParsing ? 'AI 解析' : 'Enter ↵'}
```

Add below the form:

```tsx
<div className={styles.captureModeSwitch} role="tablist" aria-label="记录目标">
  <button
    type="button"
    role="tab"
    aria-selected={captureMode === 'inbox'}
    className={captureMode === 'inbox' ? styles.activeCaptureMode : undefined}
    onClick={() => {
      recordInteraction();
      setCaptureMode('inbox');
    }}
  >
    ◎ 收集盒
  </button>
  <button
    type="button"
    role="tab"
    aria-selected={captureMode === 'task'}
    className={captureMode === 'task' ? styles.activeCaptureMode : undefined}
    onClick={() => {
      recordInteraction();
      setCaptureMode('task');
    }}
  >
    ✦ 任务
  </button>
  <span>Tab 切换</span>
</div>
```

- [ ] **Step 4: Add main capture styles**

In `FocusFlowWidget.module.css`, add near existing capture styles:

```css
.inboxCapture {
  border-color: rgba(95, 209, 255, 0.48);
  box-shadow: 0 0 0 1px rgba(95, 209, 255, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.035);
}

.taskCapture {
  border-color: rgba(185, 150, 255, 0.48);
}

.captureModeSwitch {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: -6px;
  padding: 0 2px;
  color: var(--muted);
  font-size: 9px;
}

.captureModeSwitch button {
  padding: 4px 7px;
  border: 0.5px solid rgba(190, 157, 255, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.025);
  color: var(--muted-deep);
  font-size: 9px;
  font-weight: 800;
  transition: border-color var(--ease), color var(--ease), background var(--ease);
}

.captureModeSwitch button:hover,
.captureModeSwitch .activeCaptureMode {
  border-color: rgba(95, 209, 255, 0.42);
  background: rgba(95, 209, 255, 0.08);
  color: var(--cyan);
}

.captureModeSwitch span {
  margin-left: auto;
  color: var(--muted);
  font-family: var(--font-mono);
}
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS or only errors from not-yet-implemented Inbox panel/focus changes if the current task intentionally references them. Resolve all errors introduced in this task.

---

### Task 4: Add Inbox stats count and processing panel

**Files:**
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.tsx:459-1078`
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css`

- [ ] **Step 1: Add Inbox action helpers**

In `FocusFlowWidget.tsx`, add state near other overlay-related state:

```ts
const [convertingInboxItemId, setConvertingInboxItemId] = useState<string | null>(null);
```

Add helpers near task actions:

```ts
function openInboxPanel() {
  recordInteraction();
  setConvertingInboxItemId(null);
  setOverlay('inbox');
}

function closeInboxPanel() {
  recordInteraction();
  setConvertingInboxItemId(null);
  setOverlay('none');
}

function updateInboxItemStatus(itemId: string, status: InboxItem['status'], convertedTaskId: string | null = null) {
  setInboxItems((current) =>
    current.map((item) => (item.id === itemId ? { ...item, status, convertedTaskId } : item)),
  );
}

function archiveInboxItem(itemId: string) {
  recordInteraction();
  updateInboxItemStatus(itemId, 'archived');
}

function deleteInboxItem(itemId: string) {
  recordInteraction();
  updateInboxItemStatus(itemId, 'deleted');
}

function deleteAllPendingInboxItems() {
  recordInteraction();
  setInboxItems((current) => current.map((item) => (item.status === 'pending' ? { ...item, status: 'deleted' } : item)));
  setConvertingInboxItemId(null);
  setOverlay('none');
  setPetComment('清空了！脑子轻多了吧？');
}

function startConvertingInboxItem(itemId: string) {
  recordInteraction();
  setConvertingInboxItemId(itemId);
}

function convertInboxItemToTask(itemId: string, category: TaskCategory) {
  recordInteraction();
  const item = inboxItems.find((candidate) => candidate.id === itemId && candidate.status === 'pending');

  if (!item) {
    return;
  }

  const taskId = crypto.randomUUID();
  setTasks((current) => [
    { id: taskId, title: item.text, category, priority: 'medium', completed: false, due: null, completedPomodoros: 0 },
    ...current,
  ]);
  updateInboxItemStatus(itemId, 'converted', taskId);
  setConvertingInboxItemId(null);
}
```

Add this effect so the panel closes when the last pending item is processed:

```ts
useEffect(() => {
  if (overlay !== 'inbox' || pendingInboxItems.length > 0) {
    return;
  }

  setConvertingInboxItemId(null);
  setOverlay('none');
  setPetComment('清空了！脑子轻多了吧？');
}, [overlay, pendingInboxItems.length]);
```

- [ ] **Step 2: Add Inbox count to stats bars**

In both stats bars, add this button inside `statsGroup`:

```tsx
<button className={styles.inboxStatButton} type="button" onClick={openInboxPanel} aria-label={`打开收集盒，${pendingInboxItems.length} 条待处理`}>
  <strong>◎ {pendingInboxItems.length}</strong><em>收集</em>
</button>
```

Keep existing completed/streak/XP stats unchanged.

- [ ] **Step 3: Add Inbox panel JSX**

Near the other overlay blocks in main view, add:

```tsx
{overlay === 'inbox' && (
  <div className={styles.scrim}>
    <div aria-labelledby="inbox-overlay-title" aria-modal="true" className={styles.inboxSheet} role="dialog">
      <button className={styles.sheetClose} type="button" onClick={closeInboxPanel} aria-label="关闭收集盒">
        ×
      </button>
      <p className={styles.sheetTitle} id="inbox-overlay-title">◎ 收集盒 · {pendingInboxItems.length} 条待处理</p>
      <p className={styles.inboxPetLine}>Inky：“来清理一下今天的想法吧，清空之后更轻松。”</p>

      {pendingInboxItems.length === 0 ? (
        <div className={styles.emptyInbox}>现在没有待处理的想法。</div>
      ) : (
        <div className={styles.inboxList}>
          {pendingInboxItems.map((item) => (
            <article className={styles.inboxItem} key={item.id}>
              <p>{item.text}</p>
              {convertingInboxItemId === item.id ? (
                <div className={styles.inboxCategoryActions}>
                  {(['work', 'study', 'life', 'idea'] as TaskCategory[]).map((category) => (
                    <button className={styles[category]} type="button" key={category} onClick={() => convertInboxItemToTask(item.id, category)}>
                      {categoryLabel[category]}
                    </button>
                  ))}
                </div>
              ) : (
                <div className={styles.inboxItemActions}>
                  <button type="button" onClick={() => startConvertingInboxItem(item.id)}>转任务</button>
                  <button type="button" onClick={() => archiveInboxItem(item.id)}>存档</button>
                  <button type="button" onClick={() => deleteInboxItem(item.id)}>删除</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <div className={styles.inboxFooterActions}>
        <button type="button" onClick={deleteAllPendingInboxItems} disabled={pendingInboxItems.length === 0}>全部删除</button>
        <button type="button" onClick={closeInboxPanel}>稍后再说</button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Add Inbox panel styles**

In `FocusFlowWidget.module.css`, add near sheet styles:

```css
.inboxSheet {
  position: relative;
  display: flex;
  max-height: 78%;
  flex-direction: column;
  gap: 12px;
  padding: 18px 16px 16px;
  border-top: 1px solid rgba(95, 209, 255, 0.34);
  border-radius: 18px 18px 0 0;
  background: linear-gradient(180deg, rgba(28, 32, 50, 0.98), rgba(13, 16, 27, 0.99));
  box-shadow: 0 -24px 52px rgba(0, 0, 0, 0.62), 0 -4px 28px rgba(95, 209, 255, 0.1);
  animation: sheetRise 220ms ease-out;
}

.inboxPetLine {
  margin: 0;
  color: var(--muted-deep);
  font-size: 10px;
  line-height: 1.5;
}

.emptyInbox {
  display: grid;
  min-height: 120px;
  place-items: center;
  color: var(--muted);
  font-size: 11px;
}

.inboxList {
  display: flex;
  overflow: auto;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.inboxItem {
  padding: 10px;
  border: 0.5px solid rgba(95, 209, 255, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
}

.inboxItem p {
  margin: 0 0 8px;
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
}

.inboxItemActions,
.inboxFooterActions,
.inboxCategoryActions {
  display: flex;
  gap: 7px;
}

.inboxItemActions button,
.inboxFooterActions button,
.inboxCategoryActions button {
  flex: 1;
  padding: 6px 7px;
  border-radius: 8px;
  background: rgba(185, 150, 255, 0.08);
  color: var(--muted-deep);
  font-size: 10px;
  font-weight: 800;
}

.inboxItemActions button:hover,
.inboxFooterActions button:hover,
.inboxCategoryActions button:hover {
  color: var(--cyan);
}

.inboxFooterActions {
  padding-top: 2px;
}

.inboxStatButton {
  display: grid;
  justify-items: center;
  gap: 2px;
  min-width: 25px;
  padding: 0;
  background: transparent;
  color: var(--muted-deep);
  line-height: 1;
}

.inboxStatButton strong {
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.inboxStatButton em {
  color: var(--muted);
  font-size: 8px;
  font-style: normal;
  font-weight: 700;
  letter-spacing: 0.05em;
}
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS or only errors from upcoming focus/settings steps. Resolve all errors introduced in this task.

---

### Task 5: Add focus-view Inbox capture and focus-return cue

**Files:**
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.tsx:87-730`
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css`

- [ ] **Step 1: Add focus capture state and cue timer**

In `FocusFlowWidget.tsx`, add state near `input`:

```ts
const [focusInput, setFocusInput] = useState('');
const [focusReturnCue, setFocusReturnCue] = useState<string | null>(null);
```

Add effect near toast timers:

```ts
useEffect(() => {
  if (!focusReturnCue) {
    return;
  }

  const timeoutId = window.setTimeout(() => setFocusReturnCue(null), FOCUS_RETURN_CUE_MS);

  return () => window.clearTimeout(timeoutId);
}, [focusReturnCue]);
```

Add helpers:

```ts
function truncateTaskTitle(title: string) {
  return title.length > 16 ? `${title.slice(0, 16)}...` : title;
}

function handleFocusCaptureSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  recordInteraction();
  const text = focusInput.trim();

  if (!text || !focusedTask) {
    return;
  }

  addInboxItem(text);
  setFocusInput('');
  setPetComment('帮你记住了。');

  if (showFocusReturn) {
    setFocusReturnCue(`✓ 已存入收集盒 · 回到 → ${truncateTaskTitle(focusedTask.title)}`);
  }
}
```

- [ ] **Step 2: Add focus capture JSX**

Inside focus view `focusContent`, after the primary `暂停并返回` button, add:

```tsx
<form className={styles.focusCaptureForm} onSubmit={handleFocusCaptureSubmit}>
  <span aria-hidden="true">◎</span>
  <input
    value={focusInput}
    onChange={(event) => {
      recordInteraction();
      setFocusInput(event.target.value);
    }}
    placeholder="冒出的念头先放这里..."
    aria-label="专注中记录到收集盒"
  />
  {focusInput.trim() && <button type="submit">存入</button>}
</form>
{focusReturnCue && <div className={styles.focusReturnCue} role="status">{focusReturnCue}</div>}
```

- [ ] **Step 3: Add focus capture styles**

In `FocusFlowWidget.module.css`, add near focus styles:

```css
.focusCaptureForm {
  display: flex;
  align-items: center;
  width: min(236px, 100%);
  gap: 7px;
  margin-top: 6px;
  padding: 8px 9px;
  border: 0.5px solid rgba(95, 209, 255, 0.24);
  border-radius: 12px;
  background: rgba(10, 12, 22, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);
}

.focusCaptureForm span {
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: 12px;
}

.focusCaptureForm input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-size: 11px;
}

.focusCaptureForm input::placeholder {
  color: var(--muted);
}

.focusCaptureForm button {
  padding: 4px 7px;
  border-radius: 999px;
  background: rgba(95, 209, 255, 0.12);
  color: var(--cyan);
  font-size: 9px;
  font-weight: 800;
}

.focusReturnCue {
  min-height: 16px;
  color: var(--muted-deep);
  font-size: 11px;
  animation: focusCueIn 100ms ease-out;
}

@keyframes focusCueIn {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS or only errors from the settings step. Resolve all errors introduced in this task.

---

### Task 6: Add show-focus-return setting and Inky feedback copy

**Files:**
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.tsx:758-1064`
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css`

- [ ] **Step 1: Add dynamic pet speech**

Add derived pet speech near existing derived values:

```ts
const petSpeech = pendingInboxItems.length > 8
  ? '“收集盒快装满了，找个时间整理一下？”'
  : petComment
    ? `“${petComment}”`
    : '“准备好开始新的任务了吗？”';
```

Replace main-view pet speech:

```tsx
<p className={styles.petSpeech}>{petSpeech}</p>
```

- [ ] **Step 2: Add settings toggle JSX**

In the settings panel, after the “窗口与快捷键” section or before it, add:

```tsx
<section className={styles.settingsSection}>
  <h2>专注保护</h2>
  <label className={styles.settingToggle}>
    <input
      type="checkbox"
      checked={showFocusReturn}
      onChange={(event) => {
        recordInteraction();
        setShowFocusReturn(event.target.checked);
      }}
    />
    <span>
      <strong>专注时显示回神引导</strong>
      <em>记录闪念后，用当前任务名把注意力轻轻拉回来。</em>
    </span>
  </label>
</section>
```

- [ ] **Step 3: Add settings toggle styles**

In `FocusFlowWidget.module.css`, add near settings styles:

```css
.settingToggle {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px;
  border: 0.5px solid rgba(190, 157, 255, 0.14);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
  color: var(--text);
}

.settingToggle input {
  margin-top: 2px;
  accent-color: var(--cyan);
}

.settingToggle span {
  display: grid;
  gap: 4px;
}

.settingToggle strong {
  font-size: 11px;
}

.settingToggle em {
  color: var(--muted-deep);
  font-size: 10px;
  font-style: normal;
  line-height: 1.45;
}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS.

---

### Task 7: Full verification and manual desktop testing

**Files:**
- No planned source edits unless verification reveals a defect directly caused by Tasks 1-6.

- [ ] **Step 1: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 2: Run frontend typecheck**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Start the desktop app for manual UI testing**

Run:

```bash
corepack pnpm tauri dev
```

Expected: the desktop widget opens with the main view.

- [ ] **Step 4: Test main-view Inbox capture**

Manual steps:

1. Confirm the main input defaults to `◎ 收集盒` mode.
2. Enter `回复林老师的消息`.
3. Press Enter.
4. Confirm the input clears.
5. Confirm `◎ 1` appears in the stats bar.
6. Click `◎ 1`.
7. Confirm the Inbox sheet shows `回复林老师的消息`.

- [ ] **Step 5: Test task mode preservation**

Manual steps:

1. Close the Inbox sheet.
2. Click `✦ 任务` or press Tab.
3. Enter `买猫粮`.
4. Press Enter.
5. Confirm the existing category picker appears.
6. Pick `生活`.
7. Confirm the task appears in today’s task list.
8. Enter a longer task such as `明天下午整理课程项目计划` in task mode.
9. Press Enter.
10. Confirm the existing AI parsing sheet appears when AI settings are available, or category fallback appears if parsing fails.

- [ ] **Step 6: Test Inbox processing**

Manual steps:

1. Capture two Inbox items from main view.
2. Open the Inbox sheet from `◎ N`.
3. Click `存档` on one item and confirm it disappears from pending list.
4. Click `删除` on one item and confirm it disappears from pending list.
5. Capture another Inbox item.
6. Open the Inbox sheet.
7. Click `转任务`.
8. Pick `工作`.
9. Confirm a task appears in the task list with the Inbox text and category `工作`.
10. Confirm the Inbox pending count decreases.

- [ ] **Step 7: Test focus capture and focus-return cue**

Manual steps:

1. Start focus on an incomplete task.
2. Enter `突然想到定价策略` in the focus capture input.
3. Press Enter.
4. Confirm the focus page remains open.
5. Confirm the cue appears: `✓ 已存入收集盒 · 回到 → {当前任务名}`.
6. Confirm the cue disappears after about 1.5 seconds.
7. Capture another item before the cue disappears and confirm the cue refreshes instead of stacking.

- [ ] **Step 8: Test settings toggle and persistence**

Manual steps:

1. Open settings.
2. Turn off `专注时显示回神引导`.
3. Return to focus view.
4. Capture an Inbox item.
5. Confirm no focus-return cue appears.
6. Restart the app.
7. Confirm pending Inbox count is preserved.
8. Confirm the setting remains off.

- [ ] **Step 9: Inspect git diff before reporting**

Run:

```bash
git diff -- src/types/index.ts src/utils/focusFlowPersistence.ts src-tauri/src/persistence.rs src/components/FocusFlowWidget/FocusFlowWidget.tsx src/components/FocusFlowWidget/FocusFlowWidget.module.css docs/superpowers/specs/2026-05-16-inbox-focus-return-design.md docs/superpowers/plans/2026-05-16-inbox-focus-return.md
```

Expected: Diff only includes Inbox/focus-return design, persistence, UI, and styles. It should not include unrelated changes to `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, or `src/components/PetRenderer/PetRenderer.tsx` unless the user separately asked for them.

---

## Self-Review

**Spec coverage:** Covered main input mode switch with visible button and Tab shortcut, independent Inbox persistence, Inbox processing panel, archived hidden-from-UI behavior, focus-view Inbox-only input, focus-return cue, settings toggle, Inky naming, lightweight Inky feedback, Rust tests, typecheck, and desktop manual validation.

**Placeholder scan:** No `TBD`, `TODO`, `implement later`, `fill in`, or `Similar to` placeholders are used as implementation instructions.

**Type consistency:** The plan consistently uses `InboxItem`, `InboxItemStatus`, `inboxItems`, `showFocusReturn`, `createdAt`, `convertedTaskId`, Rust `InboxItemDto`, Rust `created_at`, and Rust `converted_task_id` matching serde camelCase behavior.

**Git safety:** The plan intentionally does not include commit steps because commits require explicit user approval in this session.
