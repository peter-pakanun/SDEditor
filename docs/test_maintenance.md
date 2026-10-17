# Test maintenance audit follow-up

This test-only maintenance pass uses frontend `e6630ed611c088b56f9be95d4367ceac82b819b5`
and API `7080552dbdfd62813a02564dd990ac54770b93d6` as its comparison baseline.
Production modules, storage schemas, dependencies and API code are unchanged.

## Corrected evidence

- `test-storage-upgrade.cjs` now snapshots every retained ClientText store in the
  v12 migration case, including exact Blob bytes and MIME type. The general
  legacy snapshot intentionally excludes those stores, so it could not establish
  preservation of the workbook, saved rows, history, request fragments or receipts.
- `test-editor-components.cjs` and `test-collaboration-ui.cjs` require both elements
  to exist before comparing their source positions. An absent dependency or avatar
  wrapper can no longer pass because its position is `-1`.
- The two legacy blank-resolution/history UI cases call the real
  `collaborationIntegration.js` mutation methods and SD codec. They preserve
  inspectable historical text while asserting that a new incomplete save fails,
  without a success notice or transport write.
- Native trusted-storage fixtures open the upgraded database without requesting
  an obsolete version. They retain old-writer rejection and exact data-preservation
  assertions. This run exercises schema v23.
- Deferred-save checks use a controlled paint boundary and a completed task turn
  while acknowledgement stays held, rather than a 5 ms completion deadline. An
  explicit worker-start event makes subsequent fixture observations deterministic.
  Existing gated tests still cover destination preparation and painting before
  outgoing save dispatch.

## Removed cases and coverage ownership

| Removed coverage | Entries removed | Retained owner |
| --- | ---: | --- |
| Generic v5, v8 and v16 writer-fencing cases using the same default legacy fixture | 3 | The v4 versionchange/closed-writer case, pending-transaction and blocked-upgrade cases in `test-storage-upgrade.cjs`; native trusted-storage old-writer checks. Version-specific retained-data fixtures remain. |
| Arbitrary duplicate overflow sizes `11/28` and `1/4` | 2 | `test-save-worker.cjs` retains multi-entry `11/23`, single-entry `1/7`, exact retry bytes, frozen recovery, receipt replay and stale-stage/candidate rejection. |
| Six whole-record ClientText history-dialog cases | 6 | The dialog has no production template or UI caller. Current field-comparison tests retain live draft diffs, removed fields, authorized ancestry, late account/selection fencing, unavailable revisions, rejected foreign groups and scoped retries. |

The offline import-history witness now uses `ctPrepareComparisons` and the current
field toolbar's Details controller. It verifies actual previous English, target
text, removed fields and developer notes while refusing both IndexedDB and API
access for the temporary in-memory workspace.

Three functional Dictionary fixtures use 512 rows instead of 20,000. Their
focus/paint, snapshot-note, no-rescan and raw-versus-reactive assertions remain.
The dedicated 20,000-entry, 46-block/two-open scaling test and the separate
20,000-entry scoped-cache case remain in `test-editor-opening.cjs`.

## Browser acceptance

The collaboration fixture's former intentional-blank-Saved control is replaced
with **Check SD save validation**. A terminating desktop run is available:

```text
node scripts/collaboration-browser-fixture.cjs --check-sd-validation
node scripts/statdescription-trusted-storage-browser-fixture.cjs
node scripts/clienttext-trusted-storage-browser-fixture.cjs
```

The terminating collaboration check uses ephemeral loopback ports, synthetic
accounts, in-memory SQLite, disposable IndexedDB and a temporary API data directory
under repository `temp/`. It blocks external browser requests, serves cached Vue
and installed JSZip locally, and omits the optional diff library because diff
rendering is outside this SD validation scenario. Set `FIXTURE_VUE_PATH` to a
cached Vue 3 global browser build; its default is the existing fixture cache at
`temp/clienttext-fixture-vue.min.js`. Existing `PLAYWRIGHT_MODULE_PATH` and
`FIXTURE_BROWSER_PATH` overrides remain available.

The check verifies real mounted avatar existence, order, away shading and color,
plus the loaded reference-catalog/session globals. Its controlled presence row is
rendering input, not a WebSocket presence acceptance test. The save flow verifies:

1. A mixed complete/blank API batch fails without partially staging its valid row.
2. Synthetic pre-policy invalid stages are quarantined while exact recovery and
   historical text remain.
3. The real browser command rejects a new blank without staging, history or upload.
4. A complete correction reaches durable storage and the real API.
5. Reload retains the correction, accepted source identity and quarantined copy.

Ordinary interactive use of `collaboration-browser-fixture.cjs` remains available.
Its source activation now explicitly selects the account-scoped local version
through the current catalog/storage APIs.

## Validation and measured impact

The seven changed Node suites pass **800 reported entries**, down from **811**.
Five adjacent storage, recovery, memory-store and Lookup suites pass another
**319**, for **1,119 focused entries**. Counts include nested parent entries and
do not represent a count of independent product behaviors.

| Changed suite | Before | After |
| --- | ---: | ---: |
| Storage upgrade | 52 | 49 |
| Save worker | 54 | 52 |
| Collaboration UI | 43 | 43 |
| Editor components | 19 | 19 |
| Editor opening | 59 | 59 |
| Collaboration editor | 246 | 246 |
| ClientText UI | 338 | 332 |

A sequential process-per-file local run measured **30.304 s before** and
**18.205 s after** for these seven suites. Editor opening changed from **20.724 s**
to **10.550 s** with its 59 entries retained. These illustrative measurements
include process startup and uncontrolled host/cache effects; they are not new
performance thresholds.

The deferred-save selection passed **50 consecutive runs / 450 reported entries**.
Five temporary in-memory negative controls failed as intended: changed workbook
bytes, a deleted request fragment, a missing script, a missing avatar wrapper,
and navigation made to wait for the held durable acknowledgement. Fault injections
did not modify production files.

All three desktop browser acceptance commands above pass. The two native storage
fixtures preserve original bytes, legacy retry bodies, drafts, receipts and
history through migration and reload. Browser execution on this host required
running outside the restricted sandbox so Edge could start.

Focused checks, syntax checks and `git diff --check` accompany this pass; this is
not a claim that every frontend/API test or hosted deployment was exercised.
