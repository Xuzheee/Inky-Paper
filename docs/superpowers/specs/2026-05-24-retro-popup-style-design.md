# Retro Popup Style Design

## Goal

Unify Inky's popup, modal, and lightweight floating surfaces with a retro-game UI feel while preserving the existing dark purple Inky color palette and soft companion-app mood.

## Scope

Update these surfaces:

- First-entry pet naming dialog
- AI parse result dialog
- Settings dialog
- Pomodoro completion dialog
- Inbox convert-to-task choice surface
- Toast / reminder cards

Do not update in this pass:

- Task category chooser (`categoryOverlay`)
- Main widget layout
- Task list cards
- Inbox sticky notes
- Pet renderer
- Persistence or behavior logic

## Visual Direction

The target style is retro-game UI structure with current Inky colors.

Keep the current palette:

- Dark base: deep purple-black backgrounds
- Primary border/accent: soft violet
- Secondary accent: cyan
- Primary action: violet button treatment
- Muted text: current lavender-gray tones

Add retro-game UI traits:

- 2px pixel-like borders
- Outer dark outline around popup cards
- Blocky offset shadows instead of fully soft glass shadows
- Smaller radius / near-square panel corners
- Header-strip treatment for major dialogs
- Light grid or scanline texture on scrim/panel backgrounds only
- Minimal glow used as accent, not as the primary surface style

Avoid:

- High-saturation retro arcade palettes as the main color system
- Full pixel fonts for Chinese body text
- Applying grid/scanline texture to the whole app shell
- Changing popup positions for high-frequency lightweight controls unless needed for consistency

## Typography

- Keep Chinese body copy in the current readable UI font stack.
- Use the existing mono font for small labels, eyebrow text, status labels, and technical-feeling headings.
- Keep important dialog titles readable and slightly heavier, not fully pixelated.

## Surface Rules

### Major dialogs

Applies to pet naming, AI parse, settings, and pomodoro completion.

- Use a shared retro panel treatment where practical:
  - dark panel background
  - violet 2px border
  - dark outer outline
  - blocky offset shadow
  - compact header strip or title row
- Keep existing content hierarchy: title, supporting copy, fields/lists, actions.
- Preserve existing dialog semantics (`role="dialog"`, `aria-modal`, labelled titles).
- Keep existing business behavior and state transitions unchanged.

### Lightweight surfaces

Applies to Inbox convert-to-task choices and toast/reminder cards.

- Keep their current placement and flow.
- Apply the same border, outline, shadow, and typography language as major dialogs.
- Do not convert these into full-screen modals.

### Category chooser exception

The task category chooser remains unchanged in this pass. It is a high-frequency task entry control and should not be visually disrupted until the rest of the popup system is validated.

## Implementation Constraints

- Prefer CSS-only changes.
- Minimize JSX edits; only change markup if needed for shared styling or accessible title/header structure.
- Do not change persistence, task logic, Inbox logic, AI parsing behavior, or pet naming behavior.
- Reuse existing CSS variables where possible.
- If shared popup classes are introduced, keep names specific to this widget's CSS module and avoid broad app-level abstractions.

## Verification

- Run `corepack pnpm typecheck`.
- Run `corepack pnpm build` if CSS/JSX changes are substantial.
- Use browser preview at `http://127.0.0.1:1420` to inspect:
  - pet naming dialog
  - AI parse dialog when parse output is available or by reachable UI state
  - settings dialog
  - pomodoro completion dialog if reachable
  - Inbox convert-to-task surface
  - toast/reminder card
- Confirm category chooser remains visually unchanged.
- Confirm no console warnings/errors appear during popup interactions.

## Success Criteria

- The listed popup and floating surfaces feel like one visual system.
- The UI reads as retro-game inspired while still using Inky's current dark purple/cyan palette.
- Chinese text remains readable.
- Main widget layout and core interactions are unchanged.
- Category chooser is unchanged.
