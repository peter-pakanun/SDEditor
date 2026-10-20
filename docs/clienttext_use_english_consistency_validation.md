# Use English consistency refresh: P2 rereview

This follow-up addresses independent review of frontend `97cdb114b31c2decacae388ef57233b5a3c621f7` with API `3e535402da908ba9a1506710ee38f642fa506127`. It is local work for rereview only. No push, deployment, production migration, original-sample modification, other-checkout/reviewer-tree mutation or live inference occurred.

## Problem and fix

A completed consistency scan skipped active Use English fields while building the source/form peer index and its reverse unit index. An ordinary Save or received shared edit could revoke approval and supply a different nonblank translation, but incremental refresh could not find that record's peer group. Warnings appeared only after a manual full rescan.

The index now retains eligible immutable source/form identities even while their current target is intentionally blank. Existing target filtering still excludes blank targets from consistency findings, and the actionable diagnostic exemption remains intact. No new scan, database/catalog, status, counter, scope rule or storage protocol is introduced. The existing save/shared refresh path can now find the complete peer group and update only affected findings.

## Reproduction and validation

Both newly added unit regressions reproduced the defect before the fix: **0 warnings instead of the expected 2**, for ordinary Save and received shared edit. Retained output: `temp/use-english-consistency-before-fix.log`.

After the fix:

- Focused full UI test file: **384 passed**. `node --test --test-reporter=spec scripts/test-clienttext-ui.cjs`; log `temp/use-english-consistency-focused.log`.
- Entire frontend suite: **3,765 passed; zero failures/skips**. Every `scripts/test-*.cjs` was run with `node --test --test-concurrency=2 --test-timeout=120000 --test-reporter=spec`; log `temp/use-english-consistency-full-frontend.log`.
- Unchanged API: `npm run check` and `npm test -- --test-concurrency=2 --test-timeout=120000 --test-reporter=spec`: **836 passed; zero failures/skips**. Logs in sibling `SDEditor-API/temp/use-english-consistency-api-check.log` and `use-english-consistency-full-api.log`.
- Actual SPA: `node scripts/clienttext-browser-fixture.cjs --english-consistency-only --keep` passed with real worker, IndexedDB, current authenticated HTTP routes, current editor Save control and received shared events. Synthetic originals only. Log `temp/use-english-consistency-spa.log`; structured report `temp/sdeditor-clienttext-browser-sUenc4/clienttext-english-consistency-results.json`.
- Changed JavaScript syntax and `git diff --check` passed.

The SPA keeps two unrelated consistency warnings present throughout. The affected pair's findings change as follows:

| Phase | Edited record | Matching-source peer | Total warning records | Completed scan preserved |
|---|---:|---:|---:|---|
| Approved blank before Save | 0 | 0 | 2 unrelated | yes |
| Immediately after ordinary Save | 1 | 1 | 4 | yes, same run ID |
| Explicit full rescan for comparison | 1 | 1 | 4 | same findings |
| Second approved blank before shared edit | 0 | 0 | 4 existing | yes |
| Immediately after received shared edit | 1 | 1 | 6 | yes, same run ID |
| Matching shared correction | 0 | 0 | 4 | yes, same run ID |
| Explicit full rescan for comparison | 0 | 0 | 4 | same findings |

Every automatic refresh preserves the unrelated result arrays by identity. Explicit full rescans correctly rebuild arrays; the report's `unrelatedPreserved:false` in the two full-rescan comparison snapshots describes that expected allocation, not lost findings. Unit regressions additionally verify that an ordinary matching correction clears both peer warnings, and that the approved unit remains in both forward and reverse indexes.

The SPA report contains zero uncaught errors and zero inference requests. HTTP writes target only the disposable localhost API. No source workbook bytes were uploaded externally. No API source changed and no new API commit is required. API schema 30, IndexedDB 25 and local protocol v2 remain unchanged. Existing E toolbar, actionable Missing/progress, source-change/revocation/conflict handling and export semantics are retained; their full previous native acceptance was not repeated because this change affects consistency indexing only.

## Rereview and release boundary

The existing eligible source/form, DNT visibility, audio/Gender exclusions and immutable scan-environment guards remain. This fix adds no change to accepted work, history, receipts, drafts or exports and needs no data rollback. Fresh independent rereview and new exact-commit release authorization remain pending. No execution blocker or uncertain action remains.
