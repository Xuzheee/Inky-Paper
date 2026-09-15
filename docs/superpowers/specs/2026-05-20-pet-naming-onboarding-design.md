# Pet Naming Onboarding Design

## Goal

Let users name the pet on first entry while keeping `Inky` as the default name and product brand. After the first-entry prompt is completed or skipped, the app should keep the existing inline pet-name editing behavior and synchronize the chosen pet name across pet-related UI.

## User Experience

On first entry, after persisted state has loaded, the main widget shows a lightweight naming dialog over the existing interface. The dialog contains:

- A short prompt inviting the user to name the pet.
- A text input for the pet name.
- A confirm action.
- A `Skip` action.

If the user enters a non-empty name and confirms, that value becomes `petName`. If the user clicks `Skip`, the app keeps the default name `Inky`. Both actions mark the onboarding as complete, so the dialog does not appear again on future launches.

The existing pet name input in the main pet section remains the long-term rename mechanism. Users can still edit the name later, and blank edits normalize back to `Inky`.

## Sync Scope

The user-defined pet name applies only to pet-related UI:

- Main pet name input.
- Pet renderer accessible labels in main, focus, and mini views.
- Mini-mode restore label where it refers to the pet.
- Any pet-specific speech or UI that displays the pet identity.

The application brand remains `Inky` in the title bar and product-level settings copy. `Inky` is both the default pet name and the product brand, but custom pet names do not replace the product brand.

## Persistence

Add a persisted boolean such as `hasCompletedPetNaming`.

- Default for brand-new frontend fallback state: `false`.
- Confirm name: save `petName` and set `hasCompletedPetNaming` to `true`.
- Skip: keep or restore default `petName: 'Inky'` and set `hasCompletedPetNaming` to `true`.
- Later inline renames update `petName` only; they do not reopen onboarding.

The Rust backend should align with frontend defaults. The current Rust default pet name should become `Inky` so Tauri-backed loads match browser fallback state.

Database schema should migrate from v3 to v4 by adding `has_completed_pet_naming INTEGER NOT NULL DEFAULT 0 CHECK (has_completed_pet_naming IN (0, 1))` to `app_state`. Existing databases migrate with onboarding incomplete, so current users see the naming prompt once and can confirm or skip.

## React State and Rendering

Extend the loaded focus-flow state with `hasCompletedPetNaming`. In `FocusFlowWidget`, keep a small local draft state for the dialog input. Render the dialog only when:

- Persistence has loaded.
- `hasCompletedPetNaming` is `false`.
- The app is in the main widget view, not mini mode or focus view.

The dialog should not alter task, Inbox, AI parsing, or pomodoro logic. Confirm and Skip both call the existing interaction recording path and then update the relevant state.

## Validation and Edge Cases

- Trim confirmed names before saving.
- Empty confirm behaves like default `Inky` and still completes onboarding.
- Keep the current name length limit aligned with the existing pet name input.
- If persistence fails, the UI may still proceed in-memory; the next launch can ask again because save is best-effort.
- Old invalid or blank pet names normalize to `Inky`.

## Testing and Verification

Implementation should be test-driven where practical:

- Add or update Rust persistence tests for v4 schema defaults, v3-to-v4 migration, saved onboarding completion, and default pet name `Inky`.
- Add frontend normalizer coverage if the project gains a frontend test harness; otherwise verify with TypeScript and browser behavior.

Manual/browser verification should cover:

1. Fresh state shows the naming dialog.
2. Confirming a custom name updates pet-related labels and does not change the product brand.
3. `Skip` keeps `Inky` and prevents the dialog from returning.
4. Existing inline rename still works after onboarding.
5. `corepack pnpm typecheck` passes.
6. `cargo test --manifest-path src-tauri/Cargo.toml` passes.
