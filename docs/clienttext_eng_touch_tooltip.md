# Disabled Eng explanations on touch

Local follow-up to independently reviewed frontend `b1d2fbe04521e61db1b8e8b1b513296c62d2b8a9`, on task-owned branch `fix/eng-touch-tooltip`. This is a separate commit after the current-draft activation policy. No push or deployment is performed; rereview remains pending.

## Failure and repair

The disabled Eng button already has a focusable explanation wrapper and uses the shared Tooltip. Touch emulation could focus that wrapper without leaving a visible explanation, particularly after Escape had dismissed the hint. Compatibility mouse events on the nested disabled button could also replace or hide the wrapper's hint. The unchanged product code reproduced the inline-after-Escape failure with the new native fixture; the failed run is retained in `temp/eng-touch-before-fix.log`.

The existing shared `v-tooltip` directive now recognizes a completed primary touch tap on a focusable wrapper containing a native disabled button. It focuses the wrapper and explicitly opens the same Tooltip, including when focus was already there after Escape. Compatibility mouse events within that wrapper cannot immediately steal or hide the touch-opened explanation. Tapping outside, blurring or pressing Escape dismisses it. Another tap reopens it. Active document listeners are removed on dismissal, ownership transfer and unmount.

This path only qualifies existing `tabindex="0"` explanation wrappers with a disabled descendant button at the touch target. It does not synthesize a button click. A touch gesture begun while disabled cannot activate the control if an asynchronous update enables it before release. New gestures on enabled buttons and keyboard activation remain available. Canceled gestures and movement beyond eight CSS pixels do not explicitly open the hint.

Eng's current-draft eligibility, active revocation, native disabled state, accessible name/description, source restrictions and all save guards remain unchanged. No source data, history, outbox, export, status, schema, API or IndexedDB contract changes. API stays at `3e535402da908ba9a1506710ee38f642fa506127` (schema30 / IDB25 / intent protocolv2).

## Scope and parallel work

The sole product edit is the Tooltip directive at the end of `public/index.js`. The Lookup author is reported by the parent as not editing this directive. No Lookup functions, templates, sizing or layout are changed. The shared filename still merits ordinary merge review if the parallel branch also edits `public/index.js`. Other edits are regression fixtures, unit tests and these notes; no other task or reviewer checkout is modified.

## Validation

- Focused Tooltip/editor/audio suite: **56 passed**, including three new tests for touch ownership and compatibility mouse events, outside/Escape dismissal and reopening, listener cleanup, drag/cancel, asynchronous enable, and preserved keyboard/enabled actions. `temp/eng-touch-focused.log`.
- Entire frontend suite: **3,786 passed; zero failures, cancellations or skips**. All `scripts/test-*.cjs` with `node --test --test-concurrency=2 --test-timeout=120000 --test-reporter=spec`. `temp/eng-touch-full-frontend.log`.
- Native SPA touch fixture: `node scripts/clienttext-browser-fixture.cjs --english-touch-only --keep`. Two successful runs; the second records actual touch pointer events for every Eng tap. **12 touch visibility/dismissal/reopen cases, 17 existing draft-policy cases and four actual shared HTTP saves** per run. Full and inline editors cover a fresh disabled tap, outside dismissal/reopen, Escape/reopen on the same focused wrapper, keyboard-to-touch transition and an unsupported grammatical field. Disabled exploration leaves values, saved work, history, outbox and save attempts unchanged. Enabled taps actually set/revoke approvals and preserve a different draft on revocation. Zero page errors and zero inference requests.
  - First pass: `temp/eng-touch-browser.log`, `temp/sdeditor-clienttext-browser-91iP0m/eng-draft-eligibility-results.json`.
  - Confirmation with input-event trace: `temp/eng-touch-confirmation.log`, `temp/sdeditor-clienttext-browser-fZBx2V/eng-draft-eligibility-results.json` and `eng-translated-disabled-inline.png`.
- Desktop shared-toolbar browser regression: **61 hint cases, 62 Chromium accessibility snapshots, 46 Escape cases and 96 square Eng layout cases passed** across SD and ClientText. Hover/focus, native activation, disabled/admin explanations and descriptions remain intact. `SDEDITOR_TOOLBAR_ONLY=1 node scripts/shared-editor-browser-fixture.cjs`; `temp/eng-touch-desktop-regression.log`, `temp/toolbar-tooltips/results.json`.
- Tooltip viewport/placement browser fixture: **27 passed**. `node scripts/tooltip-browser-fixture.cjs`; `temp/eng-touch-placement.log`.
- Changed JavaScript syntax and `git diff --check` pass.

The browser evidence is **Edge desktop touch emulation**, not a physical touchscreen or mobile-device acceptance claim. Workbooks and accounts are generated synthetic fixtures used only with disposable localhost services. Private samples, production services and immutable customer source files are untouched. The full API suite is not repeated for this Tooltip-only repair; the native fixture uses the unchanged real API and current HTTP save protocol. Prior draft-policy, recovery and checkpoint-race review remains applicable. No denied, pending or uncertain execution remains; independent rereview is the next step.
