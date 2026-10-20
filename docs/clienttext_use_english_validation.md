# Use English review package

Prepared against frontend `6f3811023733a5795d6f7f07c44f747ec8fa9ae4` and API `428e918d3bbcd483b4d0a83d12c71c4d0bae3a24` in isolated task-owned Git worktrees. Remote frontend `master` matched the requested frontend SHA; the API's upstream branch is `main`, and matched the requested API SHA. Original D:/WorkDir checkouts were not changed. No push, deployment, production migration or model inference was performed.

## Behavior under review

Explicit ordinary-PoE2-text intent, passive exact-English offer, legal ordinary identical Save, previous editor/committed translation history, revocation, conservative source invalidation, no implicit blanks, upstream-nonblank conflicts, role/game/group/field scope, shared predecessor carry and explicit saved-local-predecessor selection. Existing raw Missing/progress, DNT, PoE1 behavior, export naming/palette and private resource boundaries are preserved. See [feature contract](clienttext_use_english.md) for exact limits and compatibility.

## Validation

- `node --test --test-reporter=spec scripts/test-clienttext-use-english.cjs scripts/test-clienttext-state.cjs scripts/test-clienttext-codec.cjs scripts/test-clienttext-store.cjs scripts/test-clienttext-local-store.cjs scripts/test-clienttext-sync.cjs scripts/test-clienttext-ui.cjs scripts/test-clienttext-resource-sync.cjs`: **567 passed**. Exact output: `temp/use-english-frontend-tests.log`.
- API `npm run check` and `npm test -- --test-reporter=spec`: **825 passed**. Logs in sibling `SDEditor-API/temp/use-english-check.log` and `use-english-api-all.log`. Disposable test TEMP belongs to the task and is outside the API checkout, respecting the existing private-config output guard.
- `node scripts/clienttext-local-browser-check.cjs --use-english-only`: passed in disposable Edge profile with real PoE2 Thai. Pointer action, legal ordinary identical Save, optional offer, conversion history, blank native export, current colors/name, reload, v2 backup/restore, revocation and actual local-predecessor dropdown/successor were checked. Report: `temp/clienttext-use-english-browser-results.json`.
- `node scripts/clienttext-local-browser-check.cjs`: broader native regression passed with actual PoE2 Thai and PoE1 Thai. Covers v23→v25 legacy retention, browser restart, cross-tab ownership, injected quota/read/transaction abort, malformed-record rejection without deletion, offline reopening, export/reimport, backup/restore and independent imports. Report: `temp/clienttext-local-browser-results.json`.
- `node scripts/clienttext-browser-fixture.cjs --resource-sync-only`: passed two synthetic authenticated API clients with explicit resource opt-in. Dictionary/TM changes preserve drafts; no private workbook scope enters resource transport; no content-group workbook upload or inference. Log: `temp/use-english-resource-sync.log`.
- All touched JavaScript syntax and both `git diff --check` checks passed. Four theme screenshots exist as `temp/use-english-{light,grey,dark,modern-dark}.png`, plus the passive offer. Light/modern-dark were visually inspected after closing the export dialog.

Native local runs recorded **zero HTTP writes and zero uncaught browser errors**. Sample originals remain unchanged:

```text
PoE2 Thai.xlsx
f46736c6501a606a4168a6a6fdd321b30a3feff123fba00031d0d6be992c403a
PoE1 Thai_PoE1.xlsm
67f90e1d2bae8063c7a351b56028548a46ccf82576d5b4223efb9cfea9889cb4
```

Earlier research inspected all 18 supplied workbooks. Current implementation native validation used the two Thai originals; Normal/Gender/form/collision exclusions additionally use synthetic and existing codec/state tests. This is not a claim of fresh native acceptance for every language or game-runtime fallback verification.

## Independent reviewer focus

1. Atomic intent/history/receipt/draft boundaries and uncertain exact-body retries.
2. Shared intent conflict handling: unsent approvals are held for explicit resolution rather than silently rebased; old receipts and uncertain predecessors retain their bodies.
3. Source-bound carry, tombstones, source reversion, nonblank upstream handling and local predecessor scope/readiness.
4. Metadata-only `saved:false` behavior and source-review collection projection; raw progress is intentionally unchanged.
5. Durable v1 read compatibility, v2 archive protection and IndexedDB 25 exclusion of older writers.
6. API schema-30 semantic fence and capability-first rollout, without any new source text catalog.

No independent review approval is claimed by this development package. Review remains the next gate before integration or release.

## Deployment and remaining choices

Stop old API writers, preserve a pre-upgrade backup, deploy compatible schema-30 API first, verify `clientTextEnglishIntent: clienttext-use-english-v1`, then deploy frontend/IndexedDB 25 and reload old pages/workers. Do not run mixed API versions against one database. Rolling back schema-29 code requires the pre-upgrade database backup. No production action has been taken.

Product choices still open: actionable Missing/progress migration, a reviewed bulk marking workflow, and independently verified fallback support before enabling grammatical/class/named forms, Gender metadata or PoE1. Real eviction, disk/power failure, other browser engines, hosted authentication and production backup restoration were not tested. There is no remaining execution/approval blocker for this local review deliverable.
