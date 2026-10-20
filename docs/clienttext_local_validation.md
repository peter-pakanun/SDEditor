# Local workbook implementation validation

Date: 2026-10-20. Implementation starts from exact reviewed frontend `5a95162adb210b86f0dd38d5196efc1ff88e6153` in a new independent clone at `C:/Users/lpeac/Documents/Codex/2026-10-20/task-13/SDEditor-local-workbooks`, branch `feat/clienttext-local-workbooks`. Original release and development checkouts were read-only inputs. No push, deployment, production mutation, workbook upload or model inference was performed.

Architecture, migration and recovery contracts are in [Local ClientText workbooks](clienttext_local_workbooks.md). IndexedDB changes are browser v23→v24 writer fencing with existing stores retained; there is no API/schema deployment dependency for this feature. The implementation was separately reviewed for restore validation, branch rebinding, delayed ownership release, stale queued writes and backup/navigation races; those findings were corrected and have focused regressions.

## Automated checks

| Check | Result |
| --- | --- |
| Complete frontend `scripts/test-*.cjs` through Node test runner, concurrency 2 | 3,714 passed, 0 failed, 0 skipped (`temp/frontend-tests-final.log`) |
| Final changed UI/store/ownership suite after review corrections | 384 passed, 0 failed (`temp/review-fix-tests-final.log`) |
| IndexedDB migration/draft/UI focused rerun | 448 passed, 0 failed (`temp/final-ui-upgrade.log`) |
| Isolated sibling API `npm run check` | Passed |
| Isolated sibling API `npm test` | 823 passed, 0 failed, 0 skipped |
| Touched JavaScript syntax and `git diff --check` | Passed |

The isolated API clone is exact `428e918d3bbcd483b4d0a83d12c71c4d0bae3a24`, with no `.env` or runtime database copied. API logs are in the sibling clone's `temp/api-check.log` and `temp/api-test-unsandboxed.log`; the API checkout remains clean.

The full frontend command was:

```powershell
$localWorkbookTests = @(rg --files scripts -g 'test-*.cjs')
node --test --test-concurrency=2 --test-timeout=120000 $localWorkbookTests
```

An initial full run caught one stale expected browser-version number in the existing SD draft test (23 versus 24). That expectation was updated and the complete run passed. Initial sandboxed browser/loopback executions needed the approved local execution context; the successful runs used disposable loopback APIs/profiles. A resource-fixture cleanup guard initially still referenced system temp after moving fixture files under repo `temp/`; its assertions passed, the guard was corrected, and the entire fixture then exited successfully. These were resolved test/setup failures, not unresolved baseline exceptions. `npm test` in the frontend remains the repository's intentional stub; the direct suite above is the actual validation.

## Native browser and real inputs

`node scripts/clienttext-local-browser-check.cjs` runs the complete normal-mode SPA with native IndexedDB, a disposable persistent Edge profile and local copies of the existing CDN dependencies. It uses the actual file selector with task-owned copies of the read-only sample files. `--native-input-only` adds timer-only checkpoints, disk-copy deletion and an interrupted renderer Save. `--lease-probe-only` checks the same-scope reacquisition race using native Web Locks. Input paths can be overridden with `CLIENTTEXT_LOCAL_POE1`/`CLIENTTEXT_LOCAL_POE2`; browser/dependencies can use `FIXTURE_BROWSER_PATH`, `PLAYWRIGHT_MODULE_PATH`, `FIXTURE_VUE_PATH`, `FIXTURE_JSZIP_PATH`.

| Read-only original | Units | SHA-256 before and after |
| --- | ---: | --- |
| `C:/Users/lpeac/Downloads/2026-10-19_POE1/Thai_PoE1.xlsm` | 146,929 | `67f90e1d2bae8063c7a351b56028548a46ccf82576d5b4223efb9cfea9889cb4` |
| `C:/Users/lpeac/Downloads/2026-10-13_POE2/Thai.xlsx` | 150,808 | `f46736c6501a606a4168a6a6fdd321b30a3feff123fba00031d0d6be992c403a` |

Only synthetic authored translations were added. Task-owned disk copies were deleted after import; original sample files were never moved or modified. Native checks passed for:

- Reload and full browser process/profile close/reopen preserving committed edits, exact CRLF drafts, reviews/history and original byte hashes.
- Timer-driven active draft persistence without calling a manual checkpoint, plus keyboard/pointer editor operation and DNT visibility changes.
- Renderer crash while a real native Save transaction was held uncommitted: prior saved work/history/receipt boundaries and the active draft survived.
- Native transaction abort, injected quota/write and read failures, malformed persisted draft rejection without deletion, and no false checkpoint confirmation.
- Native v23→v24 upgrade preserving legacy SD KV/history, multiple imports/switches, and independent exported-WIP imports.
- Cross-tab ownership rejection, same-scope reacquisition surviving a delayed old release, and local work while the browser context was offline.
- Full native workbook export with `_Translated` naming/palette, committed edits and excluded drafts; export/reimport; full ZIP backup/restore to fresh IDs preserving originals/history/drafts.

The local-only browser runs recorded zero HTTP writes and zero uncaught browser errors. Reports remain in `temp/clienttext-local-browser-results.json`, `temp/clienttext-local-native-input-results.json`, and `temp/clienttext-local-lease-results.json`. Four desktop theme screenshots are `temp/local-workbook-{light,grey,dark,modern-dark}.png`; the light and modern-dark notices, draft indicator and recovery actions were visually inspected.

## Dictionary/TM boundary

`node scripts/clienttext-browser-fixture.cjs --resource-sync-only` passed with two authenticated synthetic clients and a disposable real API. It verified explicit opt-in, shared Dictionary changes preserving unsaved workbook text, live main/alternate glossary previews, immutable submitted context snapshots, field-aware TM/corrections, SD suggestion isolation, offline resource queue/reconnect, durable private workbook writes and retained work after reload. No private `local:test:*` identity entered resource request paths/bodies; no content-group workbook upload or inference occurred. Log: `temp/resource-sync-browser-final.log`.

## Tested limits

- Native browser execution used installed Edge on Windows. Other browser engines, private-mode lifetimes, real eviction, profile/device loss and power-loss durability were not simulated. The UI/docs explicitly describe those recovery limits.
- Quota failures were injected DOMExceptions, not actual exhaustion of the user's browser disk quota. Read/open and write/abort behavior was tested; no physical disk fault was introduced.
- Offline workbook editing was verified after the application loaded. Initial offline application/CDN loading is not guaranteed; no service worker was added.
- Real sample execution used the two Thai originals above. Normal/Gender pair, field/form/source comparison, statuses/history and DNT/colour contracts additionally have synthetic/direct regression coverage; this is not a claim that every workbook/language in both download folders received native browser acceptance.
- API/browser users and resource data were synthetic. Hosted OAuth, production browser profiles, production deployment and live model providers were not exercised.
- Structural corruption and untrusted backup fields are rejected. Local browser storage is not an encryption or security boundary against a script already authorized to write that origin's database.
- Incomplete original preparations/restores remain retained. Retrying restore creates a new copy; there is no automatic cache reclamation or silent workspace deletion. Recovery ZIP size limits are documented in code; large archives may require substantial browser memory.

No remaining execution or approval blocker was identified. The work is prepared as a local review commit only.
