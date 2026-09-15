# Pet Naming Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users name the pet on first entry, keep `Inky` as the default pet name and product brand, and persist onboarding completion.

**Architecture:** Add `hasCompletedPetNaming` to the shared persisted state contract and migrate the SQLite schema from v3 to v4. The React widget owns a small dialog draft state, renders the first-entry naming dialog only after persistence has loaded in the main view, and keeps later inline rename behavior unchanged. Pet-related labels read from `petName`; product brand copy remains literal `Inky`.

**Tech Stack:** Tauri 2, Rust, rusqlite, React 18, TypeScript, Vite, CSS Modules.

---

## File Structure

- Modify `src-tauri/src/persistence.rs`
  - Bump `DATABASE_VERSION` to 4.
  - Change Rust `DEFAULT_PET_NAME` from `pet` to `Inky`.
  - Add `has_completed_pet_naming: bool` to `FocusFlowPersistedState`.
  - Add `has_completed_pet_naming` to the `app_state` schema, load query, save query, validation path, and tests.
  - Add a v3-to-v4 migration while preserving the existing v1-to-v2 and v2-to-v3 migration path.
- Modify `src/utils/focusFlowPersistence.ts`
  - Bump frontend persisted state version to 4.
  - Add `hasCompletedPetNaming` to defaults, normalizer, and save payload.
  - Keep blank or old invalid pet names normalized to `Inky`.
- Modify `src/components/FocusFlowWidget/FocusFlowWidget.tsx`
  - Add `hasCompletedPetNaming` and `petNamingDraft` state.
  - Load and save onboarding completion with the rest of focus-flow state.
  - Add confirm/skip handlers.
  - Render the first-entry naming dialog only when persistence is loaded, onboarding is incomplete, view is `main`, and mini mode is off.
  - Replace pet-related hardcoded renderer labels with `petName` while keeping product brand `Inky` unchanged.
- Modify `src/components/FocusFlowWidget/FocusFlowWidget.module.css`
  - Add compact dialog styles for the naming prompt using the existing overlay visual language.

---

### Task 1: Add Rust persistence tests for v4 pet naming state

**Files:**
- Modify: `src-tauri/src/persistence.rs:457-748`

- [ ] **Step 1: Update `custom_state` test fixture to the target v4 shape**

Change `custom_state()` in `src-tauri/src/persistence.rs` to include version 4 and the new completion field:

```rust
fn custom_state() -> FocusFlowPersistedState {
    FocusFlowPersistedState {
        version: 4,
        mood: "一般".into(),
        xp: 42,
        pet_name: "小蓝".into(),
        pet_set_id: "local:cat".into(),
        inbox_items: vec![InboxItemDto {
            id: "inbox-1".into(),
            text: "Capture this later".into(),
            created_at: "2026-05-16T10:00:00Z".into(),
            status: "pending".into(),
            converted_task_id: None,
            date: "2026-05-16".into(),
        }],
        show_focus_return: true,
        has_completed_pet_naming: true,
        tasks: vec![
            TaskDto {
                id: "later".into(),
                title: "整理读书笔记".into(),
                category: "study".into(),
                priority: "medium".into(),
                completed: false,
                due: None,
                completed_pomodoros: 2,
            },
            TaskDto {
                id: "first".into(),
                title: "回复导师邮件".into(),
                category: "work".into(),
                priority: "high".into(),
                completed: true,
                due: Some("今天 16:00".into()),
                completed_pomodoros: 1,
            },
        ],
    }
}
```

- [ ] **Step 2: Update first-run schema/default assertions to expected v4 values**

In `first_run_initializes_schema_and_default_state`, replace the assertions and column query with:

```rust
let (show_focus_return, has_completed_pet_naming): (i64, i64) = database
    .connection
    .query_row(
        "SELECT show_focus_return, has_completed_pet_naming FROM app_state WHERE id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap();
let inbox_count: i64 = database
    .connection
    .query_row("SELECT COUNT(*) FROM inbox_items", [], |row| row.get(0))
    .unwrap();

assert_eq!(schema_version, 4);
assert_eq!(state.version, 4);
assert_eq!(show_focus_return, 1);
assert_eq!(has_completed_pet_naming, 0);
assert!(!state.has_completed_pet_naming);
assert_eq!(inbox_count, 0);
assert_eq!(state.mood, "好");
assert_eq!(state.xp, 10);
assert_eq!(state.pet_name, "Inky");
assert_eq!(state.pet_set_id, "builtin:inky");
assert_eq!(state.tasks.len(), 3);
assert_eq!(state.tasks[0].title, "回复导师邮件");
```

- [ ] **Step 3: Update blank pet name normalization assertion**

In `blank_pet_name_normalizes_to_default_pet_name`, change:

```rust
assert_eq!(loaded.pet_name, "Inky");
```

- [ ] **Step 4: Add a saved onboarding completion assertion**

In `saving_then_loading_preserves_state_and_task_order`, keep `let expected = custom_state();` and add this after the equality assertion:

```rust
assert!(loaded.has_completed_pet_naming);
```

- [ ] **Step 5: Add a v3-to-v4 migration test**

Add this test after `version_two_database_migrates_to_inbox_schema`:

```rust
#[test]
fn version_three_database_migrates_to_pet_naming_schema() {
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

            INSERT INTO app_state (id, mood, xp, pet_name, pet_set_id, show_focus_return)
            VALUES (1, '好', 12, '小蓝', 'builtin:inky', 0);
            INSERT INTO inbox_items (id, text, created_at, status, converted_task_id, date, sort_order)
            VALUES ('inbox-1', 'Remember this', '2026-05-20T10:00:00Z', 'pending', NULL, '2026-05-20', 0);
            PRAGMA user_version = 3;
            ",
        )
        .unwrap();
    drop(connection);

    let connection = open_database(database_path).unwrap();
    let schema_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    let has_completed_pet_naming: i64 = connection
        .query_row(
            "SELECT has_completed_pet_naming FROM app_state WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let state = load_state(&connection).unwrap();

    assert_eq!(schema_version, 4);
    assert_eq!(has_completed_pet_naming, 0);
    assert!(!state.has_completed_pet_naming);
    assert!(!state.show_focus_return);
    assert_eq!(state.pet_name, "小蓝");
    assert_eq!(state.inbox_items.len(), 1);
}
```

- [ ] **Step 6: Run Rust tests and verify they fail for missing v4 implementation**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml persistence
```

Expected: FAIL because `FocusFlowPersistedState` does not yet have `has_completed_pet_naming`, schema version is still 3, and `DEFAULT_PET_NAME` is still `pet`.

---

### Task 2: Implement Rust v4 schema, migration, load, and save

**Files:**
- Modify: `src-tauri/src/persistence.rs:6-435`

- [ ] **Step 1: Bump constants and DTO state shape**

Change the constants and add the field:

```rust
const DATABASE_VERSION: u8 = 4;
const DEFAULT_PET_NAME: &str = "Inky";
const DEFAULT_PET_SET_ID: &str = "builtin:inky";
```

```rust
pub struct FocusFlowPersistedState {
    pub version: u8,
    pub tasks: Vec<TaskDto>,
    pub mood: String,
    pub xp: i64,
    pub pet_name: String,
    pub pet_set_id: String,
    pub inbox_items: Vec<InboxItemDto>,
    pub show_focus_return: bool,
    pub has_completed_pet_naming: bool,
}
```

- [ ] **Step 2: Add the default state field**

In `default_state()`, add:

```rust
has_completed_pet_naming: false,
```

near `show_focus_return: true`.

- [ ] **Step 3: Add the new column to fresh schema creation**

In the `CREATE TABLE app_state` statement for version 0 databases, add:

```sql
has_completed_pet_naming INTEGER NOT NULL DEFAULT 0 CHECK (has_completed_pet_naming IN (0, 1))
```

and change the fresh schema pragma to:

```sql
PRAGMA user_version = 4;
```

The final `app_state` columns should be:

```sql
id INTEGER PRIMARY KEY CHECK (id = 1),
mood TEXT NOT NULL CHECK (mood IN ('好', '一般', '烦')),
xp INTEGER NOT NULL CHECK (xp >= 0),
pet_name TEXT NOT NULL,
pet_set_id TEXT NOT NULL DEFAULT 'builtin:inky',
show_focus_return INTEGER NOT NULL DEFAULT 1 CHECK (show_focus_return IN (0, 1)),
has_completed_pet_naming INTEGER NOT NULL DEFAULT 0 CHECK (has_completed_pet_naming IN (0, 1))
```

- [ ] **Step 4: Add v3-to-v4 migration routing**

Change migration routing in `initialize_schema` to:

```rust
} else if version == 1 {
    connection.execute_batch(
        "
        ALTER TABLE app_state ADD COLUMN pet_set_id TEXT NOT NULL DEFAULT 'builtin:inky';
        PRAGMA user_version = 2;
        ",
    )?;
    migrate_v2_to_v3(connection)?;
    migrate_v3_to_v4(connection)?;
} else if version == 2 {
    migrate_v2_to_v3(connection)?;
    migrate_v3_to_v4(connection)?;
} else if version == 3 {
    migrate_v3_to_v4(connection)?;
} else if version > i64::from(DATABASE_VERSION) {
    return Err(rusqlite::Error::InvalidQuery);
}
```

- [ ] **Step 5: Add `migrate_v3_to_v4`**

Add below `migrate_v2_to_v3`:

```rust
fn migrate_v3_to_v4(connection: &Connection) -> Result<(), rusqlite::Error> {
    if !app_state_has_column(connection, "has_completed_pet_naming")? {
        connection.execute_batch(
            "
            ALTER TABLE app_state ADD COLUMN has_completed_pet_naming INTEGER NOT NULL DEFAULT 0 CHECK (has_completed_pet_naming IN (0, 1));
            ",
        )?;
    }

    connection.execute_batch("PRAGMA user_version = 4;")
}
```

- [ ] **Step 6: Load the new field**

Change the app state query in `load_state` to:

```rust
let (mood, xp, pet_name, pet_set_id, show_focus_return, has_completed_pet_naming):
    (String, i64, String, String, bool, bool) = connection.query_row(
    "SELECT mood, xp, pet_name, pet_set_id, show_focus_return, has_completed_pet_naming FROM app_state WHERE id = 1",
    [],
    |row| {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get::<_, i64>(4)? == 1,
            row.get::<_, i64>(5)? == 1,
        ))
    },
)?;
```

and include in the returned state:

```rust
has_completed_pet_naming,
```

- [ ] **Step 7: Save the new field**

Change the app state upsert in `save_state` to:

```rust
transaction.execute(
    "
    INSERT INTO app_state (id, mood, xp, pet_name, pet_set_id, show_focus_return, has_completed_pet_naming)
    VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(id) DO UPDATE SET mood = excluded.mood, xp = excluded.xp, pet_name = excluded.pet_name, pet_set_id = excluded.pet_set_id, show_focus_return = excluded.show_focus_return, has_completed_pet_naming = excluded.has_completed_pet_naming
    ",
    params![
        state.mood,
        state.xp,
        pet_name,
        pet_set_id,
        if state.show_focus_return { 1 } else { 0 },
        if state.has_completed_pet_naming { 1 } else { 0 },
    ],
)?;
```

- [ ] **Step 8: Update migration test expectations from older versions**

In `version_one_database_migrates_to_pet_set_schema`, change:

```rust
assert_eq!(schema_version, 4);
assert_eq!(state.has_completed_pet_naming, false);
```

In `version_two_database_migrates_to_inbox_schema`, change:

```rust
assert_eq!(schema_version, 4);
assert_eq!(state.has_completed_pet_naming, false);
```

- [ ] **Step 9: Run Rust tests and verify they pass**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml persistence
```

Expected: PASS for persistence tests.

---

### Task 3: Update frontend persistence contract to version 4

**Files:**
- Modify: `src/utils/focusFlowPersistence.ts:10-183`

- [ ] **Step 1: Add frontend state field and version 4 target**

Change the interface and defaults:

```ts
export interface FocusFlowPersistedState {
  version: 4;
  tasks: Task[];
  inboxItems: InboxItem[];
  mood: Mood;
  xp: number;
  petName: string;
  petSetId: PetSetId;
  showFocusReturn: boolean;
  hasCompletedPetNaming: boolean;
}
```

```ts
export const defaultFocusFlowState: FocusFlowPersistedState = {
  version: 4,
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
  hasCompletedPetNaming: false,
};
```

- [ ] **Step 2: Normalize version 4 and the completion flag**

In `normalizeState`, change the version checks and return object:

```ts
value.version !== 4 ||
```

```ts
return {
  version: 4,
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
  hasCompletedPetNaming: value.hasCompletedPetNaming === true,
};
```

- [ ] **Step 3: Include completion in save payload type and payload**

Change the function signature to:

```ts
export async function saveFocusFlowState(
  state: Pick<
    FocusFlowPersistedState,
    'tasks' | 'inboxItems' | 'mood' | 'xp' | 'petName' | 'petSetId' | 'showFocusReturn' | 'hasCompletedPetNaming'
  >,
) {
```

Change the payload to:

```ts
payload: {
  version: 4,
  tasks: state.tasks,
  inboxItems: state.inboxItems,
  mood: state.mood,
  xp: Math.max(0, Math.floor(state.xp)),
  petName: state.petName.trim() || defaultFocusFlowState.petName,
  petSetId: isPetSetId(state.petSetId) ? state.petSetId : DEFAULT_PET_SET_ID,
  showFocusReturn: state.showFocusReturn,
  hasCompletedPetNaming: state.hasCompletedPetNaming,
} satisfies FocusFlowPersistedState,
```

- [ ] **Step 4: Run frontend typecheck and verify current callers fail**

Run:

```bash
corepack pnpm typecheck
```

Expected: FAIL because `FocusFlowWidget` does not yet pass `hasCompletedPetNaming` to `saveFocusFlowState` or load it into state.

---

### Task 4: Wire pet naming state and handlers into `FocusFlowWidget`

**Files:**
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.tsx`

- [ ] **Step 1: Add state for onboarding completion and dialog draft**

Near the existing persisted state hooks, add:

```ts
const [hasCompletedPetNaming, setHasCompletedPetNaming] = useState(initialFocusFlowState.hasCompletedPetNaming);
const [petNamingDraft, setPetNamingDraft] = useState(initialFocusFlowState.petName);
```

- [ ] **Step 2: Load the persisted completion flag and initialize the draft**

In the persistence load effect, after `setPetName(persistedState.petName);`, add:

```ts
setHasCompletedPetNaming(persistedState.hasCompletedPetNaming);
setPetNamingDraft(persistedState.petName);
```

- [ ] **Step 3: Save the completion flag**

Change the save call to include the new field:

```ts
void saveFocusFlowState({ tasks, inboxItems, mood, xp, petName, petSetId, showFocusReturn, hasCompletedPetNaming });
```

Change the save effect dependency array to include it:

```ts
}, [isPersistenceLoaded, tasks, inboxItems, mood, xp, petName, petSetId, showFocusReturn, hasCompletedPetNaming]);
```

- [ ] **Step 4: Add a derived visibility flag and handlers**

Add near other helper functions:

```ts
const shouldShowPetNamingDialog =
  isPersistenceLoaded && !hasCompletedPetNaming && view === 'main' && !isMiniMode;

function confirmPetNaming() {
  recordInteraction();
  const nextPetName = petNamingDraft.trim() || defaultFocusFlowState.petName;
  setPetName(nextPetName);
  setPetNamingDraft(nextPetName);
  setHasCompletedPetNaming(true);
}

function skipPetNaming() {
  recordInteraction();
  setPetName(defaultFocusFlowState.petName);
  setPetNamingDraft(defaultFocusFlowState.petName);
  setHasCompletedPetNaming(true);
}
```

- [ ] **Step 5: Keep inline rename from reopening onboarding**

Leave `updatePetName` as pet-name-only behavior:

```ts
function updatePetName(value: string) {
  setPetName(value.trim() || defaultFocusFlowState.petName);
}
```

Do not update `hasCompletedPetNaming` inside `updatePetName`.

- [ ] **Step 6: Update pet-related labels to use `petName`**

Change the mini restore button label from hardcoded `Inky` to:

```tsx
aria-label={`恢复 ${petName}`}
```

Change the mini `PetRenderer` label to:

```tsx
label={`${petName} Lv.${level.current.level}`}
```

Change the focus-view `PetRenderer` label to:

```tsx
label={`${petName} Lv.${level.current.level}`}
```

Change the main-view `PetRenderer` label to:

```tsx
label={`${petName} Lv.${level.current.level}`}
```

Keep these product brand spans unchanged:

```tsx
<span className={styles.brand}>Inky</span>
```

- [ ] **Step 7: Run frontend typecheck and verify only dialog rendering/styles are still absent**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS if the new state contract and handlers are wired correctly.

---

### Task 5: Render the first-entry naming dialog and styles

**Files:**
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.tsx`
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css`

- [ ] **Step 1: Add the dialog JSX in the main widget render**

Inside the main widget view container, near other overlay/scrim rendering and after the base interface content, add:

```tsx
{shouldShowPetNamingDialog && (
  <div className={styles.petNamingScrim} role="dialog" aria-modal="true" aria-labelledby="pet-naming-title">
    <section className={styles.petNamingDialog}>
      <p className={styles.petNamingEyebrow}>First hello</p>
      <h2 id="pet-naming-title">给你的伙伴取个名字</h2>
      <p className={styles.petNamingCopy}>默认叫 Inky。你可以现在命名，也可以跳过之后再改。</p>
      <input
        className={styles.petNamingInput}
        value={petNamingDraft}
        onChange={(event) => {
          recordInteraction();
          setPetNamingDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            confirmPetNaming();
          }
        }}
        aria-label="首次宠物名字"
        maxLength={8}
        autoFocus
      />
      <div className={styles.petNamingActions}>
        <button className={styles.petNamingSkipButton} type="button" onClick={skipPetNaming}>
          Skip
        </button>
        <button className={styles.confirmButton} type="button" onClick={confirmPetNaming}>
          确认
        </button>
      </div>
    </section>
  </div>
)}
```

- [ ] **Step 2: Add compact dialog CSS**

Add to `src/components/FocusFlowWidget/FocusFlowWidget.module.css` near the existing overlay/dialog styles:

```css
.petNamingScrim {
  position: absolute;
  inset: 0;
  z-index: 45;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
  background:
    radial-gradient(circle at 50% 38%, rgba(185, 150, 255, 0.18), transparent 34%),
    rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(7px);
}

.petNamingDialog {
  width: min(100%, 236px);
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid rgba(224, 201, 255, 0.18);
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(32, 24, 48, 0.96), rgba(17, 13, 27, 0.96)),
    rgba(17, 13, 27, 0.96);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.petNamingEyebrow {
  margin: 0;
  color: rgba(214, 190, 255, 0.62);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.petNamingDialog h2 {
  margin: 0;
  color: rgba(255, 250, 244, 0.94);
  font-size: 17px;
  line-height: 1.25;
}

.petNamingCopy {
  margin: 0;
  color: rgba(236, 226, 255, 0.68);
  font-size: 11.5px;
  line-height: 1.5;
}

.petNamingInput {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid rgba(224, 201, 255, 0.18);
  border-radius: 12px;
  color: rgba(255, 250, 244, 0.95);
  background: rgba(255, 255, 255, 0.07);
  font-size: 14px;
  font-weight: 650;
  outline: none;
}

.petNamingInput:focus {
  border-color: rgba(190, 157, 255, 0.48);
  box-shadow: 0 0 0 3px rgba(190, 157, 255, 0.12);
}

.petNamingActions {
  display: grid;
  grid-template-columns: 0.78fr 1fr;
  gap: 8px;
  margin-top: 2px;
}

.petNamingSkipButton {
  height: 36px;
  border: 1px solid rgba(224, 201, 255, 0.14);
  border-radius: 12px;
  color: rgba(236, 226, 255, 0.7);
  background: rgba(255, 255, 255, 0.05);
  font-size: 12px;
  font-weight: 700;
}

.petNamingSkipButton:hover {
  color: rgba(255, 250, 244, 0.92);
  background: rgba(255, 255, 255, 0.08);
}
```

- [ ] **Step 3: Run frontend typecheck**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS.

---

### Task 6: Full verification

**Files:**
- Verify only; no planned edits.

- [ ] **Step 1: Run frontend typecheck**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run Rust test suite**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 3: Start frontend dev server for browser verification**

If the dev server is not already running, run:

```bash
corepack pnpm dev
```

Expected: Vite reports `Local: http://127.0.0.1:1420/`.

- [ ] **Step 4: Browser verify fresh first-entry prompt**

Open `http://127.0.0.1:1420/` in the browser preview.

Expected:
- The main widget appears.
- The naming dialog appears after state load.
- The dialog contains a name input, `确认`, and `Skip`.
- The title bar/product brand still reads `Inky`.

- [ ] **Step 5: Browser verify confirming a custom name**

In the dialog:
1. Enter `小蓝`.
2. Click `确认`.

Expected:
- Dialog closes.
- Main pet name input shows `小蓝`.
- Pet renderer accessible label contains `小蓝 Lv.`.
- Product brand still reads `Inky`.

- [ ] **Step 6: Browser verify inline rename still works**

Use the existing pet-name input to change `小蓝` to `豆豆`, then blur the input.

Expected:
- Pet name input remains `豆豆`.
- Pet renderer accessible label contains `豆豆 Lv.`.
- Dialog does not reopen.

- [ ] **Step 7: Browser verify Skip path with fresh state**

Reset the app data database or use a fresh browser fallback state, then reload the app and click `Skip`.

Expected:
- Dialog closes.
- Pet name remains `Inky`.
- Dialog does not reappear on reload after persistence succeeds.
- Product brand remains `Inky`.

- [ ] **Step 8: Check browser console**

Inspect console output.

Expected: no new errors or warnings from the pet naming flow.

---

## Self-Review

- Spec coverage:
  - First-entry dialog with input, confirm, and `Skip`: Task 5.
  - Confirm trims and saves custom name, empty confirm defaults to `Inky`: Task 4 confirm handler.
  - Skip keeps/restores `Inky` and completes onboarding: Task 4 skip handler.
  - Existing inline rename remains and blank edits normalize to `Inky`: Task 4 keeps `updatePetName`; Task 2 and Task 3 preserve normalization.
  - Pet-related labels sync to `petName`: Task 4 label updates.
  - Product brand remains `Inky`: Task 4 explicitly preserves brand spans; Task 6 verifies.
  - Rust default pet name becomes `Inky`: Task 2.
  - SQLite migration v3 to v4 and new column default false: Tasks 1 and 2.
  - Frontend fallback default `hasCompletedPetNaming: false`: Task 3.
  - Verification commands and browser behavior: Task 6.
- Placeholder scan: no unfinished placeholder text or deferred implementation language remains.
- Type consistency: frontend uses `hasCompletedPetNaming`; Rust/SQLite use `has_completed_pet_naming`; persisted versions are consistently `4`.
