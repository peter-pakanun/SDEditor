# Eng activation from the current editor draft

Local follow-up to released frontend `ff34875f7cb19bb31a1d4a3bc7017d344e10b7a2`, on the task-owned branch `feat/eng-draft-eligibility`. The owner clarified: only a blank translation or a translation identical to English should enable activation. No push or deployment is performed; independent review and new exact-commit release approval remain pending.

## Behavior

New activation requires the existing ordinary PoE2 source/field/service eligibility and either `!String(draft).trim()` or exact raw `draft === field.source`. The value comes from the current `ctValues`, so typing updates button availability and explanation without a save or network round trip. This matches the existing exact-English suggestion and existing blank convention. A trailing/leading space around nonempty English, case changes, CRLF/LF differences, Unicode normalization differences and marker-stripped fingerprint equality do not broaden equality.

A different nonempty translation disables activation. Its shared Tooltip explains that the current translation must be blank or exactly match English. Existing active approvals can still be switched off after typing different text; revocation keeps that draft. Unsupported retained decisions remain removable. Source-stale decisions are not treated as active: reapproval requires an eligible draft and an explicit action for the current source. Source/field scope, service capability, pending shared recovery, conflict alternatives, save/recovery/history/MTL locks and captured-context guards remain enforced and provide the actual disabled reason.

The controller and direct action guard share this reason calculation. Disabled hover, focus and activation attempts do not save or create metadata. The existing native disabled button, focusable wrapper, shared Tooltip, accessible name/description and Escape behavior are retained. The explanation wrapper is recognized as a row control, so Enter/Space on it cannot bubble into inline record navigation or redirect typing into the editor.

Eng commands also capture the editor signature before awaiting a draft checkpoint. If editor values/reviews change during that wait, the action aborts before creating a save command, retaining the newer draft. Exact receipt replay skips this new-command check and retains its original request body, preserving existing uncertain-save recovery.

Source-only eligibility, source witnesses, source hashing, valid active intent, normal Missing/progress, history/export semantics and ordinary translation saves are unchanged. No source catalog, API payload, database or IndexedDB schema change is introduced. Existing approvals are not migrated or retroactively invalidated.

## Files and parallel-work boundary

Product changes are confined to `public/clientTextUi.js` and `public/clientTextComparisons.js`. No edits to Lookup source/layout files, `public/index.js`, `public/editorComponents.js`, `scripts/shared-editor-browser-fixture.cjs` or `docs/editor_guide.md` are needed. The toolbar-specific regression helper only clears its synthetic different draft before its existing enabled/active Eng checks. The older HTTP fixture now expects the released Eng label and prepares allowed English-identical drafts before approval/recovery tests.

## Validation

- Focused ClientText UI: **392 passed**, including raw equality/blank cases, immediate draft updates, direct-call rejection, active/unsupported revocation, source-stale decisions, context replacement, operational reasons and checkpoint races. `temp/eng-eligibility-focused.log`.
- Entire frontend suite: **3,783 passed; zero failures/skips**. Every `scripts/test-*.cjs` with `node --test --test-concurrency=2 --test-timeout=120000 --test-reporter=spec`; `temp/eng-eligibility-full-frontend.log`.
- New native SPA fixture: `node scripts/clienttext-browser-fixture.cjs --english-eligibility-only --keep`. Real Vue, ClientText worker/IndexedDB and authenticated disposable localhost API; synthetic workbooks only. **17 cases and four actual shared HTTP saves** cover blank/whitespace/identical/translated edits, unchanged saved state during disabled pointer/keyboard interactions, real shared activation/revocation, preserved different draft on revocation, unsupported forms, retained callbacks after record switching and full/inline views. Source suspension is an explicitly synthetic read-only UI projection; it does not rewrite originals or API source facts. `temp/eng-eligibility-browser.log`; `eng-draft-eligibility-results.json` and PNG retained in its reported fixture directory.
- Existing current-editor HTTP validation/recovery and late-receipt ordinary-successor conflict regressions pass: `--english-http-only --keep`; `temp/eng-eligibility-http-regression.log`.
- Existing toolbar regression: **61** hint cases, **62** Chromium accessibility snapshots, **46** Escape cases and **96** square-label layout cases pass. `SDEDITOR_TOOLBAR_ONLY=1 node scripts/shared-editor-browser-fixture.cjs`; `temp/eng-eligibility-toolbar-regression.log`.
- Changed JavaScript syntax and `git diff --check` pass. All browser checks contain zero page errors and zero live inference requests.

No private/customer workbook is read, changed or included in Git. All HTTP workbook assets are generated synthetic originals sent only to disposable localhost fixtures. API source remains unchanged at `3e535402da908ba9a1506710ee38f642fa506127`; the full API suite was not repeated for this UI-only policy. The frontend suite and native HTTP checks exercise current API contracts. No production access, source migration, push, deploy or other task/reviewer checkout mutation occurred. Schema/API30, IDB25 and local protocolv2 remain.

Coverage is desktop keyboard/pointer and synthetic browser work; previous workbook-carry, durable recovery and production acceptance are retained by existing suites rather than repeated with private samples. The separate mixed keyboard/touch finding from the earlier plan is not changed by this activation-policy patch. No execution blocker, denied action or uncertain operation remains.
