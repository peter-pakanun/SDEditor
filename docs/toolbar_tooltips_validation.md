# Shared toolbar tooltips and square Eng: local review

This change starts from the released frontend `91b7f1a18e39f52f28b37b4588c8566a05dc2da3`, independently confirmed on the existing remote master before creating the clean task-owned branch `feat/shared-toolbar-tooltips`. API remains `3e535402da908ba9a1506710ee38f642fa506127` with no source or schema change. No push or deployment is authorized or performed.

## Inventory and behavior

| Surface | Tooltip path |
|---|---|
| ClientText field toolbar, full and inline | Formatting shortcuts, Use English, MTL/stop, admin model settings/debug, source/translation comparison and revision menu use the existing `v-tooltip` directive and root `AppTooltip`. |
| Adjacent comparison selector | Current revision label uses the same shared hint. |
| SD preview size toolbar | Small/Medium/Large retain their text, active state and action; hints use the shared component. |
| Workspace and full-editor action bars | Existing filter/settings/sidebar, comment/pagination, close/save/discard/raw-file/path/TM hints use the shared component. Existing attention arrows and import/export hints already used it. |
| Shared side tools and diagnostic paging | Existing Dictionary entry actions, TM match, history/restore and diagnostic result paging hints use the shared component. |
| ClientText dialogue audio controls | Remove redundant native title; the native button now also exposes the existing shared hint on keyboard focus. |

Existing native hints on those buttons are removed rather than left alongside the component. Controls keep their accessible names, labels, shortcuts, `aria-pressed`/expanded state, native button activation and action handlers. Disabled Use English and MTL targets keep focusable explanations. The MTL primary target owns its hint separately from the adjacent admin buttons, so a bubbled pointer event cannot replace an admin hint with Translate. Disabled MTL is keyboard discoverable; in-progress focus transfer and cancellation remain in the stable target wrapper.

The shared directive refreshes a currently visible hint in place when its text changes, retaining the pointer/focus anchor. A blurred control does not reopen when its state changes. Nested button hints retain ownership while pointer events bubble through a row/container that also has a tooltip. This keeps the focused Eng action and running/stopping MTL explanation current without requiring pointer movement.

Use English renders **Eng** after the existing Underline separator, with accessible name **Use English** and its existing action description. Explicit 28 by 28 CSS pixels, border-box sizing, fixed flex basis, 12px type and 1px padding keep it square and readable. The shared formatting-button `active` class continues to provide its active styling.

Lookup resizing, translation/source data, status/progress/export rules and storage contracts are unchanged. Non-toolbar metadata/native controls outside this inventory are outside this cleanup; text-only buttons that had no tooltip do not acquire redundant label-only hints.

## Validation

- Focused shared component/audio suites: **50 passed**; `temp/toolbar-focused.log`.
- Entire frontend suite: **3,769 passed, zero failures/skips**; every `scripts/test-*.cjs` with `node --test --test-concurrency=2 --test-timeout=120000 --test-reporter=spec`. `temp/toolbar-full-frontend-authorized.log`.
- New actual-SPA browser check (**61 hint cases** across SD and ClientText full/inline/workspace surfaces): `SDEDITOR_TOOLBAR_ONLY=1 node scripts/shared-editor-browser-fixture.cjs`. Current Vue templates/controllers, pointer hover, keyboard focus/blur, single component tooltip, native-title absence, viewport bounds, disabled English/MTL explanations, separate admin hints, native Space/Enter, formatting selection capture and active Eng hint are exercised. Details and captures: `temp/toolbar-tooltips/results.json` and PNGs. The browser fixture uses only synthetic data and stubs English/MTL persistence/generation actions; this is presentation coverage, not a repeat of existing save/recovery acceptance.
- Eng geometry: **96** full-editor combinations: four themes, compact/spacious density, 1440/1100/1000 physical-width scenarios and 100/125/150/200% zoom-equivalent metrics. CDP emulates desktop zoom's effective CSS viewport and device-pixel density; it does not change a real user's browser zoom preference. Every label text rectangle fits within a square button. Inline rendering and keyboard hints are checked separately.
- Existing shared Tooltip browser fixture: **27 passed**, including footer hover/focus, viewport corners, resize, content reflow, four themes and both densities. `temp/toolbar-shared-tooltip-placement.log`.
- Changed JavaScript syntax and `git diff --check` pass. The full frontend suite includes current disposable HTTP collaboration integrations. API source is unchanged; the API suite was not repeated for this presentation-only follow-up.

The native Edge checks use disposable localhost origins. There is no live inference, external workbook upload, original-sample change, production access or mutation of another task/reviewer checkout. Current schema/API30, IndexedDB25 and local protocolv2 remain.

## Execution and review boundary

The new task-owned worktree is `C:/Users/lpeac/Documents/Codex/2026-10-20/task-7/SDEditor-toolbar`. A dependency junction creation at its `node_modules` failed with filesystem Access denied and was not created; the checks use the existing task-owned dependency directory via `NODE_PATH`. The initial restricted full-suite run could not connect to its own localhost HTTP fixtures (`connect EACCES`); the approved local-fixture execution passed the entire suite. Remote release verification also required the normal network-enabled read-only execution. No approval review rejection or uncertain mutation remains.

Independent review and exact-commit release approval remain pending. Rollback is a frontend-only revert; this change writes no new data format and needs no storage rollback.
