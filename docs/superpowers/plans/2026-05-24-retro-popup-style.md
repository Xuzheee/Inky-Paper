# Retro Popup Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle Inky's popup and lightweight floating surfaces as retro-game UI panels while preserving the current dark purple Inky palette and leaving the category chooser unchanged.

**Architecture:** This is primarily a CSS-module change in `FocusFlowWidget.module.css`, with small JSX class/header additions in `FocusFlowWidget.tsx` only where needed to make existing dialogs share the same retro panel structure. Existing overlay state, persistence, AI parsing, Inbox, pet naming, and task logic remain unchanged.

**Tech Stack:** React 18, TypeScript, CSS Modules, Vite, Tauri frontend preview.

---

## File Structure

- Modify `src/components/FocusFlowWidget/FocusFlowWidget.module.css`
  - Add retro popup design tokens inside `.widgetWrap, .shell`.
  - Add shared retro surface declarations for major dialogs and lightweight floating surfaces.
  - Restyle pet naming, AI sheet, settings panel, pomodoro dialog, Inbox convert choices, and toast.
  - Do not restyle `.categoryOverlay`.
- Modify `src/components/FocusFlowWidget/FocusFlowWidget.tsx`
  - Add minimal header-strip markup/classes to major dialogs if CSS alone cannot create the desired structure clearly.
  - Do not change overlay state transitions, handlers, persistence payloads, or category chooser markup.
- No new production files.
- No Rust changes.

---

### Task 1: Add shared retro popup CSS foundation

**Files:**
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css:1-26`
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css:947-1048`
- Do not modify: `.categoryOverlay` block at `src/components/FocusFlowWidget/FocusFlowWidget.module.css:911-945`

- [ ] **Step 1: Add retro popup tokens**

In `src/components/FocusFlowWidget/FocusFlowWidget.module.css`, extend the variable block under `.widgetWrap, .shell` with these variables:

```css
  --retro-border: rgba(201, 173, 255, 0.62);
  --retro-border-muted: rgba(99, 85, 116, 0.72);
  --retro-panel: rgba(24, 18, 37, 0.98);
  --retro-panel-deep: rgba(9, 7, 17, 0.96);
  --retro-outline: #05030a;
  --retro-shadow: rgba(0, 0, 0, 0.36);
```

Keep all existing variables unchanged.

- [ ] **Step 2: Restyle shared scrim only**

Replace the existing `.scrim` block with:

```css
.scrim {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px),
    radial-gradient(circle at 50% 84%, rgba(185, 150, 255, 0.12), transparent 34%),
    rgba(0, 0, 0, 0.66);
  background-size: 8px 8px, 8px 8px, auto, auto;
  backdrop-filter: blur(6px);
}
```

This keeps scrim positioning and z-index unchanged while adding the light retro grid texture only to popup overlays.

- [ ] **Step 3: Restyle pet naming scrim consistently**

Replace the existing `.petNamingScrim` block with:

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
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px),
    radial-gradient(circle at 50% 38%, rgba(185, 150, 255, 0.14), transparent 34%),
    rgba(0, 0, 0, 0.6);
  background-size: 8px 8px, 8px 8px, auto, auto;
  backdrop-filter: blur(6px);
}
```

- [ ] **Step 4: Add shared retro panel selector**

Below `.petNamingScrim`, add this shared selector. It intentionally excludes `.categoryOverlay`:

```css
.petNamingDialog,
.aiSheet,
.settingsPanel,
.pomodoroDialog,
.toast,
.inboxCategoryChoices {
  border: 2px solid var(--retro-border);
  border-radius: 8px;
  background:
    linear-gradient(180deg, var(--retro-panel), var(--retro-panel-deep));
  box-shadow:
    0 0 0 2px var(--retro-outline),
    6px 6px 0 var(--retro-shadow),
    0 0 24px rgba(185, 150, 255, 0.1);
}
```

- [ ] **Step 5: Verify category chooser has not been touched**

Run:

```bash
git diff -- src/components/FocusFlowWidget/FocusFlowWidget.module.css
```

Expected:
- The `.categoryOverlay` block remains unchanged.
- The diff only adds variables and changes shared scrim/panel styling.

---

### Task 2: Apply retro styling to major dialogs

**Files:**
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css:974-1087`
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css:1379-1395`
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css:1789-1837`
- Optional modify: `src/components/FocusFlowWidget/FocusFlowWidget.tsx:1222-1319`

- [ ] **Step 1: Restyle pet naming panel contents**

In `FocusFlowWidget.module.css`, replace `.petNamingDialog` with:

```css
.petNamingDialog {
  width: min(100%, 236px);
  display: grid;
  gap: 0;
  overflow: hidden;
  padding: 0;
}
```

Replace `.petNamingEyebrow` with:

```css
.petNamingEyebrow {
  margin: 0;
  padding: 8px 12px;
  border-bottom: 2px solid rgba(201, 173, 255, 0.34);
  background: rgba(185, 150, 255, 0.12);
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
```

Replace `.petNamingDialog h2` with:

```css
.petNamingDialog h2 {
  margin: 14px 14px 0;
  color: rgba(255, 250, 244, 0.94);
  font-size: 17px;
  font-weight: 850;
  line-height: 1.25;
}
```

Replace `.petNamingCopy` with:

```css
.petNamingCopy {
  margin: 8px 14px 0;
  color: rgba(236, 226, 255, 0.7);
  font-size: 11.5px;
  line-height: 1.5;
}
```

Replace `.petNamingInput` with:

```css
.petNamingInput {
  width: calc(100% - 28px);
  height: 38px;
  margin: 12px 14px 0;
  padding: 0 10px;
  border: 2px solid var(--retro-border-muted);
  border-radius: 4px;
  color: rgba(255, 250, 244, 0.95);
  background: var(--retro-panel-deep);
  box-shadow: inset 3px 3px 0 rgba(0, 0, 0, 0.2);
  font-size: 14px;
  font-weight: 650;
  outline: none;
}
```

Replace `.petNamingInput:focus` with:

```css
.petNamingInput:focus {
  border-color: rgba(116, 215, 255, 0.62);
  box-shadow: inset 3px 3px 0 rgba(0, 0, 0, 0.2), 0 0 0 2px rgba(116, 215, 255, 0.16);
}
```

Replace `.petNamingActions` with:

```css
.petNamingActions {
  display: grid;
  grid-template-columns: 0.78fr 1fr;
  gap: 8px;
  margin: 12px 14px 14px;
}
```

Replace `.petNamingSkipButton` with:

```css
.petNamingSkipButton {
  height: 36px;
  border: 2px solid var(--retro-border-muted);
  border-radius: 4px;
  color: rgba(236, 226, 255, 0.72);
  background: rgba(32, 24, 46, 0.86);
  box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.24);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 800;
}
```

Keep `.petNamingSkipButton:hover`, but update it to:

```css
.petNamingSkipButton:hover {
  border-color: rgba(201, 173, 255, 0.48);
  color: rgba(255, 250, 244, 0.92);
  background: rgba(42, 32, 58, 0.92);
}
```

- [ ] **Step 2: Restyle AI sheet without changing behavior**

Replace `.aiSheet` with:

```css
.aiSheet {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 13px;
  margin: 0 12px 12px;
  padding: 0 14px 14px;
  animation: sheetRise 220ms ease-out;
}
```

Replace `.aiSheet::before` with:

```css
.aiSheet::before {
  display: none;
}
```

Replace `.sheetTitle` with:

```css
.sheetTitle {
  margin: 0 -14px;
  padding: 8px 34px 8px 12px;
  border-bottom: 2px solid rgba(201, 173, 255, 0.34);
  background: rgba(185, 150, 255, 0.12);
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
```

Update `.sheetClose` to fit the title strip:

```css
.sheetClose {
  position: absolute;
  top: 4px;
  right: 8px;
  z-index: 1;
  width: 24px;
  height: 24px;
  border: 2px solid rgba(99, 85, 116, 0.64);
  border-radius: 4px;
  background: rgba(9, 7, 17, 0.56);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1;
}
```

Keep `.sheetClose:hover`, but it should still only change color:

```css
.sheetClose:hover {
  color: var(--ink-soft);
}
```

- [ ] **Step 3: Restyle settings panel with same retro surface**

Replace `.settingsPanel` with:

```css
.settingsPanel {
  position: relative;
  display: flex;
  max-height: calc(100% - 24px);
  flex-direction: column;
  gap: 10px;
  margin: 12px;
  padding: 0 14px 14px;
  overflow: auto;
  animation: overlayRise 190ms ease-out;
}
```

Keep `.settingsPanel::-webkit-scrollbar` unchanged.

- [ ] **Step 4: Restyle pomodoro completion dialog**

Replace `.pomodoroDialog` with:

```css
.pomodoroDialog {
  margin: 0 12px 12px;
  padding: 18px 18px 20px;
  text-align: center;
  animation: overlayRise 190ms ease-out;
}
```

Replace `.celebration` with:

```css
.celebration {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin: 0 auto 10px;
  border: 2px solid rgba(247, 200, 106, 0.34);
  border-radius: 6px;
  background: rgba(247, 200, 106, 0.1);
  box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.22);
  font-size: 28px;
  filter: none;
}
```

Replace `.pomodoroDialog h2` with:

```css
.pomodoroDialog h2 {
  margin: 6px 0;
  color: var(--ink);
  font-size: 16px;
  font-weight: 850;
}
```

Replace `.pomodoroActions button` with:

```css
.pomodoroActions button {
  min-height: 34px;
  border: 2px solid var(--retro-border-muted);
  border-radius: 4px;
  background: rgba(32, 24, 46, 0.86);
  box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.24);
  color: var(--ink);
  font-size: 12px;
  font-weight: 700;
}
```

Keep `.pomodoroActions button:last-child`, but replace it with:

```css
.pomodoroActions button:last-child {
  background: transparent;
  box-shadow: none;
  color: var(--muted);
}
```

- [ ] **Step 5: Verify TypeScript still compiles**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS with `tsc --noEmit` and no TypeScript errors.

---

### Task 3: Apply retro styling to lightweight surfaces and controls

**Files:**
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css:1347-1377`
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css:1586-1632`
- Modify: `src/components/FocusFlowWidget/FocusFlowWidget.module.css:1106-1168` if needed for AI draft items only

- [ ] **Step 1: Restyle Inbox convert-to-task choices**

Replace `.inboxCategoryChoices` with:

```css
.inboxCategoryChoices {
  padding: 8px;
}
```

Do not change `.categoryActions` or `.categoryActions button`; those are shared with category chooser. If button styling needs a retro touch only for Inbox, add this selector below `.inboxCategoryChoices`:

```css
.inboxCategoryChoices button {
  border-width: 2px;
  border-radius: 4px;
  box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.2);
  font-family: var(--font-mono);
}
```

This preserves the category chooser because it does not have `.inboxCategoryChoices`.

- [ ] **Step 2: Restyle shared confirm/primary buttons with pixel structure**

Replace `.confirmButton, .primaryButton, .pomodoroActions button:first-child` with:

```css
.confirmButton,
.primaryButton,
.pomodoroActions button:first-child {
  border: 2px solid rgba(224, 201, 255, 0.76);
  border-radius: 4px;
  background: var(--violet);
  color: #ffffff;
  box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.32);
  font-family: var(--font-mono);
  font-weight: 900;
}
```

Keep `.confirmButton` height/font-size block, but it should remain:

```css
.confirmButton {
  height: 36px;
  font-size: 12px;
  line-height: 1;
}
```

Replace `.confirmButton:disabled` with:

```css
.confirmButton:disabled {
  cursor: not-allowed;
  border-color: rgba(99, 85, 116, 0.44);
  background: rgba(99, 85, 116, 0.38);
  color: rgba(244, 238, 255, 0.44);
  box-shadow: none;
}
```

- [ ] **Step 3: Restyle AI draft rows and inputs to match retro panels**

Replace `.draftItem` with:

```css
.draftItem {
  display: flex;
  gap: 8px;
  padding: 9px;
  border: 2px solid rgba(99, 85, 116, 0.42);
  border-radius: 4px;
  background: rgba(20, 16, 29, 0.78);
  box-shadow: inset 2px 2px 0 rgba(0, 0, 0, 0.16);
}
```

Replace `.draftBody > input` with:

```css
.draftBody > input {
  width: 100%;
  height: 30px;
  padding: 0 9px;
  border: 2px solid rgba(99, 85, 116, 0.48);
  border-radius: 4px;
  outline: none;
  background: rgba(9, 7, 17, 0.7);
  color: var(--ink);
  font-size: 12px;
  box-shadow: inset 2px 2px 0 rgba(0, 0, 0, 0.18);
}
```

Replace `.sheetTags span` with:

```css
.sheetTags span {
  padding: 5px 8px;
  border: 2px solid rgba(98, 215, 130, 0.24);
  border-radius: 4px;
  background: rgba(98, 215, 130, 0.1);
  color: var(--green);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 800;
}
```

- [ ] **Step 4: Restyle toast and reminder card**

Replace `.toast` with:

```css
.toast {
  position: absolute;
  right: 12px;
  bottom: 54px;
  left: 12px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}
```

Replace `.toastHeader span` with:

```css
.toastHeader span {
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
```

Replace `.toastHeader button` with:

```css
.toastHeader button {
  width: 22px;
  height: 22px;
  border: 2px solid rgba(99, 85, 116, 0.54);
  border-radius: 4px;
  background: rgba(9, 7, 17, 0.46);
  color: var(--muted-deep);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1;
}
```

Keep `.toast p`, but replace it with:

```css
.toast p {
  margin: 0;
  color: var(--ink-soft);
  font-size: 11.5px;
  line-height: 1.55;
}
```

- [ ] **Step 5: Verify category chooser CSS remains unchanged**

Run:

```bash
git diff -- src/components/FocusFlowWidget/FocusFlowWidget.module.css
```

Expected:
- `.categoryOverlay` block is unchanged.
- `.categoryActions` base selector is unchanged except where already existed before this feature.
- Any button retro styling for Inbox is scoped to `.inboxCategoryChoices button`.

---

### Task 4: Browser visual verification and final checks

**Files:**
- No source changes expected unless verification finds a visual issue.

- [ ] **Step 1: Run frontend checks**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS.

Run:

```bash
corepack pnpm build
```

Expected: PASS with a Vite production build.

- [ ] **Step 2: Start browser preview**

Run:

```bash
corepack pnpm dev
```

Expected: Vite serves the app at `http://127.0.0.1:1420`.

- [ ] **Step 3: Inspect first-entry pet naming dialog**

Open `http://127.0.0.1:1420` in browser preview.

Expected:
- Pet naming dialog uses retro panel styling.
- Dialog still has readable Chinese text.
- Confirm and Skip still work.
- Product brand remains `Inky`.

- [ ] **Step 4: Inspect settings dialog**

Use the settings button in the title bar.

Expected:
- Settings panel uses the retro panel border/outline/shadow/title-strip style.
- Existing sections remain readable and scrollable.
- Close button still works.

- [ ] **Step 5: Inspect Inbox convert-to-task surface**

Create or use a pending Inbox item, drag it onto the convert zone, and inspect the category choices below the note.

Expected:
- Inbox convert choices use retro panel styling.
- Buttons are scoped to Inbox and do not require changing the task category chooser.
- Convert action still works.

- [ ] **Step 6: Inspect toast/reminder card**

Trigger a reminder/toast by using an existing visible reminder or any UI action that shows the toast.

Expected:
- Toast uses retro panel styling.
- Text remains readable.
- Close button still works.

- [ ] **Step 7: Inspect AI parse dialog where reachable**

If the AI parse dialog is reachable in the local environment, trigger it from the capture input.

Expected:
- AI parse sheet uses retro panel styling.
- Parsed task rows, tags, and confirm button remain readable.
- Confirm behavior is unchanged.

If AI parse is not reachable due missing local AI configuration, record that limitation and rely on CSS/DOM inspection plus type/build checks.

- [ ] **Step 8: Inspect pomodoro completion dialog where reachable**

Start a focus session and reach the completion dialog if practical.

Expected:
- Pomodoro completion dialog uses retro panel styling.
- Three action buttons remain readable and clickable.
- Focus-session behavior is unchanged.

If reaching the dialog is impractical because it requires waiting for the timer, record that limitation and rely on CSS/DOM inspection plus type/build checks.

- [ ] **Step 9: Confirm category chooser unchanged**

Trigger the normal task category chooser from the main task input.

Expected:
- Category chooser remains visually unchanged from before this feature.
- Category choice still creates the task.

- [ ] **Step 10: Check browser console**

Inspect browser console messages after popup interactions.

Expected:
- No new warnings or errors caused by the popup style change.

- [ ] **Step 11: Final git status**

Run:

```bash
git status --short
```

Expected:
- Only intended files are modified:
  - `src/components/FocusFlowWidget/FocusFlowWidget.module.css`
  - possibly `src/components/FocusFlowWidget/FocusFlowWidget.tsx`
  - `docs/superpowers/specs/2026-05-24-retro-popup-style-design.md`
  - `docs/superpowers/plans/2026-05-24-retro-popup-style.md`
- No commits are created unless the user explicitly requests a commit.
