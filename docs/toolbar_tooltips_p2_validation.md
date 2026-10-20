# Toolbar Tooltip P2 follow-up: Escape and accessible descriptions

This local follow-up addresses independent review of frontend `9131c85106fc4b3dfeb4d2bc08a02bd3da84dc4b`. The original toolbar/Eng candidate remains based on released `91b7f1a18e39f52f28b37b4588c8566a05dc2da3`. API stays at `3e535402da908ba9a1506710ee38f642fa506127`, with no source/schema change. Work remains in the task-owned `feat/shared-toolbar-tooltips` worktree. No push or deployment occurred.

The reviewed evidence demonstrated both issues: focus Bold + Escape moved focus to the revision menu and left a new hint visible; Show raw file lost the accessible description `View and download this file as text` when native title was removed. The released-baseline and candidate JSON under the read-only independent review tree were inspected without mutation.

## Resulting behavior

The shared directive installs a capture-phase Escape listener only while its hint owns the visible-tooltip state. Escape dismisses that hint before toolbar/menu/editor handling, retains focus and suppresses continued pointer movement or state updates until a new focus/hover interaction. Only the active trigger handles Escape when pointer and focus are on different controls; IME composition keeps its own Escape handling. Hide, empty hint, ownership transfer and unmount remove the listener; no idle per-control document listener is retained. The field toolbar also honors an already-consumed key event. Closing an actual revision menu remains available on the next Escape.

Shared hints now supply `aria-description` independently of whether their visual tooltip is open. Show raw file again exposes its released description before hover/focus. Explicit descriptions and existing `aria-describedby` associations remain authoritative. Managed descriptions update with the current hint, disappear when the hint becomes empty, and are removed on unmount only if still owned by the directive. Authored replacements remain intact. Native title is still absent, so there is no duplicate native/component tooltip.

No formatting, square Eng layout, accessible name, selected translation/source state, Lookup resizing, storage or API behavior changes are introduced by this follow-up.

## Validation

- Focused component/audio suites: **53 passed**. `temp/toolbar-p2-focused.log`.
- Entire frontend suite: **3,772 passed; zero failures/skips**. Every `scripts/test-*.cjs`, using `node --test --test-concurrency=2 --test-timeout=120000 --test-reporter=spec`; `temp/toolbar-p2-full-frontend.log`.
- Actual Chromium accessibility tree: **62 control/state snapshots**, fetched via CDP `Accessibility.getPartialAXTree` before hover/focus. Descriptions match the current authored/generated description after Chromium whitespace normalization. The raw-file description is separately checked against the released text. Focused active Eng also refreshes its accessible description. JSON retains name, role, native description and ignored state for each case.
- Actual keyboard regression: **46 Escape cases**, including enabled Bold, disabled explanation wrappers and MTL states. Focus remains on each trigger and same-control pointer movement does not reopen the hint. A real shared revision-menu component proves first Escape dismisses the hint while leaving the menu open; the next closes the menu and keeps the expected trigger focus.
- Retained browser coverage: **61** hover/focus/disabled/action hint cases across SD and ClientText full/inline/workspace surfaces, **96** unclipped square Eng theme/density/width/zoom-equivalent layouts, zero page errors and zero inference requests. `SDEDITOR_TOOLBAR_ONLY=1 node scripts/shared-editor-browser-fixture.cjs`; log `temp/toolbar-p2-browser.log`, structured evidence and PNGs in `temp/toolbar-tooltips/`.
- Existing shared Tooltip placement fixture: **27 passed** across hover/focus, footer/corners, resize/reflow, four themes and both densities. `node scripts/tooltip-browser-fixture.cjs`; `temp/toolbar-p2-placement.log`.
- Changed JavaScript syntax and `git diff --check` pass.

The browser uses synthetic test-mode work and stubbed English/MTL persistence/generation handlers. It verifies real templates, actions, focus and Chromium accessibility, without repeating the earlier durable-save/recovery or hosted-deployment acceptance. Zoom checks emulate effective CSS viewport/device density rather than altering a user's browser preference. The full frontend suite includes disposable localhost HTTP integrations. API code is unchanged; its full suite is not repeated for this frontend-only follow-up.

No production access, original-sample edit, external workbook upload, live inference or other task/reviewer source-checkout mutation occurred. Schema/API30, IDB25 and local protocolv2 remain. No execution action is denied, pending or uncertain; independent rereview and exact-commit release authorization remain pending. Rollback is a frontend-only revert and introduces no data rollback step.
