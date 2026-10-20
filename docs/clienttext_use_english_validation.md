# Use English review fixes and validation

Prepared in task-owned worktrees against frontend `6f3811023733a5795d6f7f07c44f747ec8fa9ae4` and API `428e918d3bbcd483b4d0a83d12c71c4d0bae3a24` (API upstream is `main`). These fixes include the second review of frontend `7c9b93b8ef466358288cf37ef45e291a1364b4c2` and API `5104e24f83f0e7b4d20e409746bf1e40b734c766`, following the original review of cfbaf3cf / 26bee04f. No original checkout, reviewer tree or sample file was modified. No push, deployment, production migration, external workbook upload or live model inference was performed.

## Review findings addressed

1. A definitive `CLIENTTEXT_INTENT_REQUIRED` or `CLIENTTEXT_INTENT_ELIGIBILITY_REQUIRED` rejection now freezes its exact sent body as rejected recovery evidence. Automatic sync skips it; ordinary newer Save cannot keep adding predecessors. The editor offers explicit accept-peer or fresh current-protocol reapply. Both atomically archive the retained chain. Unknown receipt outcomes still replay the original command before recovery can consume it.
2. Identical concurrent blank approvals expose the same explicit choices. Accept uses the current accepted peer version and preserves private drafts. Reapply creates a new command and archives previous editor values. Recovery acknowledgements and ordinary Save receipts retry with stable job IDs. Known rejection cleans the job; uncertain completion retains it. Older receipts cannot replace newer peer state, regress a newer command base, or automatically rebase an approval queued behind an uncertain predecessor.
3. English actions now include a sparse source-bound eligibility witness; both shared capabilities gate controls. New DNT Set requests with absent/false eligibility are rejected. Structurally valid legacy unsupported events suspend the decision and advance the cursor safely. This uses the existing trusted-client source boundary, not independent server DNT verification: a source hash cannot disprove a forged true witness. No source catalog, immutable fact/hash rewrite or workbook parsing was added to the API.
4. Storage tests derive the current version from `offlineStore.js`; future-version fixtures use current+1. Retention fixtures still seed their actual historical versions. PoE1, forms, Gender metadata, DNT and inactive-source exclusions display a reason instead of silently hiding controls. Raw Missing, export colors and team progress remain unchanged; migration and bulk marking remain separate product decisions.

## Second review: HTTP boundary and ordinary successors

The preceding 3,758/827 passes did not establish HTTP compatibility: the intent bridge called the save service directly, and both route allowlists omitted the current protocol fields. Both routes now share one complete allowlist. The legacy-rejection bridge now uses actual authenticated HTTP. New HTTP regressions exercise selected and team routes with ordinary/Set/Revoke bodies, exact receipts, manager/admin access, wrong/reassigned-language rejection, unchanged durable work after validation failures, and INVALID_REQUEST recovery. HTTP 400/422 is definitive rejection rather than an uncertain request loop.

A late predecessor receipt previously rebased an ordinary successor over competing peer text. Every successor now pauses when a newer peer revision overtook the receipt. The queue retains its original base, requires explicit accept/reapply, and retains conflicts through further peer pulls. Actual HTTP tests verify both choices, no successor upload before resolution, exact old receipt replay, a second peer update and retained history. The browser fixture verifies this with current SPA controls and real authenticated requests. No save service or sync transport is mocked in that browser flow; the only injected fault throws after a real committed HTTP response to simulate a lost acknowledgement.

## Complete suites

Frontend: run every `scripts/test-*.cjs`, without a name/file subset:

```powershell
$taskFiles=Get-ChildItem scripts -Filter 'test-*.cjs' -File | ForEach-Object FullName
node --test --test-concurrency=2 --test-timeout=120000 --test-reporter=spec @taskFiles
```

Result: **3,758 passed, zero failures/skips**. Log: `temp/use-english-http-full-frontend.log`. The previous 15 version-fixture failures are covered by this whole-suite run. Focused recovery checks additionally cover exact rejected bodies, stable receipt replay, draft preservation, known-error job cleanup, monotonic bases and late peer receipts.

API: `npm run check`, then `npm test -- --test-concurrency=2 --test-timeout=120000 --test-reporter=spec`: **834 passed, zero failures/skips**. Logs: `../SDEditor-API/temp/use-english-http-api-check.log` and `use-english-http-api-full.log`. Disposable test TEMP is outside the API checkout, preserving the private-config output guard. The actual HTTP/browser-store sync bridges verify legacy and generic validation rejection followed by explicit recovery, plus late receipt conflicts for ordinary successors. Existing access/receipt replay, ancestry/hash, atomic abort, collections and schema-fencing coverage remains in the full suite.

A repeated full run exposed an existing test-only clock mismatch: the historical MTL fixture reserved through a real clock and checked expiry through a frozen clock. Both now use the same injected clock; no MTL runtime or model request behavior changed. The failed output is retained as `../SDEditor-API/temp/use-english-review-api-clock-failure.log`. A parallel frontend rerun stopped progressing while native fixtures ran; it was interrupted with output retained in `temp/use-english-review-full-frontend-interrupted.log`, then the entire suite was rerun with two workers. Initial sandbox browser/listener failures were resolved through authorized local-test escalation; they are not reported as product regressions.

## Native and authenticated browser checks

Current authenticated-HTTP and native-conflict runs use disposable Edge profiles and task-owned local data. The native intent/full-local/resource-sync evidence below is retained from the previous validated fix commit; those broader real-file runs were not repeated for this HTTP/shared-queue-only change. Original sample bytes remain read-only. Browser fixture writes target localhost, and no live inference is configured.

- `node scripts/clienttext-browser-fixture.cjs --english-http-only --keep`: current SPA worker/IndexedDB/authenticated HTTP flow with synthetic paired originals, pointer Use English and ordinary Save, a real eligibility validation rejection and fresh recovery, lost committed receipts followed by ordinary successors/peer writes, no overwrite before explicit accept/reapply, and archived evidence. Report `temp/sdeditor-clienttext-browser-0e9zwY/clienttext-english-http-results.json`; log `temp/use-english-real-http-browser.log`. Zero uncaught browser errors and no inference. Expected authoring requests go only to the disposable local API.
- `node scripts/clienttext-local-browser-check.cjs --intent-conflicts-only`: actual pointer controls resolve identical approvals by accept and reapply; accept retries a lost committed acknowledgement; a legacy body is sent once, rejected, explicitly recovered and archived intact; unsupported DNT projects to `needs_review` while sequence advances; visible DNT/forms/Gender reasons. Report `temp/clienttext-use-english-conflicts.json`; log `temp/use-english-http-native-conflicts.log`.
- `node scripts/clienttext-local-browser-check.cjs --use-english-only`: supplied PoE2 Thai optional offer, ordinary identical Save, conversion/prior editor history, blank native export, unchanged name/palette, reload, v2 backup/restore, revocation and explicit local predecessor/successor. Report `temp/clienttext-use-english-browser-results.json`; log `temp/use-english-review-native-intent.log`.
- `node scripts/clienttext-local-browser-check.cjs`: supplied PoE2 and PoE1 Thai complete native persistence regression, v23 to v25 retention, restart, cross-tab ownership, injected quota/read/transaction failures, corruption without deletion, offline reopening, export/reimport, backup/restore and independent imports. Report `temp/clienttext-local-browser-results.json`; log `temp/use-english-review-native-full.log`.
- `node scripts/clienttext-browser-fixture.cjs --resource-sync-only`: two real local API clients, explicit resource opt-in, Dictionary/TM changes preserving workbook drafts and identities, offline resource queue/reconnect, no private workbook content-group transport or inference. Log `temp/use-english-review-resource-sync.log`.

Private local-workbook reports recorded **zero HTTP writes and zero uncaught browser errors**. Four theme captures were regenerated; light and modern-dark were visually inspected. Changed JavaScript syntax and both `git diff --check` checks pass.

Unchanged original hashes:

```text
PoE2 Thai.xlsx (9,822,140 bytes)
f46736c6501a606a4168a6a6fdd321b30a3feff123fba00031d0d6be992c403a
PoE1 Thai_PoE1.xlsm
67f90e1d2bae8063c7a351b56028548a46ccf82576d5b4223efb9cfea9889cb4
```

Earlier research inspected all 18 supplied workbooks. Native implementation checks used the two Thai originals; role/forms/DNT/collision exclusions also use synthetic and existing codec/state tests. This does not establish all-language native acceptance, game-runtime fallback, other browser engines, real eviction/quota exhaustion, physical disk/power failure, hosted OAuth/deployment or production backup restore acceptance.

## Rollout and rollback

When separately authorized: stop every old API writer, including the earlier unapproved schema-30 review build; retain a pre-upgrade content-database backup and required original/collection artifacts; deploy the corrected schema-30 API first. Verify `clientTextEnglishIntent: clienttext-use-english-v1` and `clientTextEnglishEligibility: clienttext-english-eligibility-v1`, then deploy the frontend/IndexedDB 25 and reload old pages/workers. Do not run mixed API versions against one database. Schema 30 uses existing payloads, with no new source tables or production rewrite.

Rollback to schema-29 binaries requires restoring the pre-upgrade database and would lose later accepted changes unless separately recovered. IndexedDB 25 fences older pages; v1 restore software rejects v2 archives. Preserve/export recovery before any downgrade; never clear browser storage to bypass fencing. Legacy durable v1 workspaces/backups remain readable; first English marking promotes local protocol transactionally. The browser conflict archive is local recovery history, not a newly uploaded server event.

The [feature contract](clienttext_use_english.md) and API `docs/clienttext_storage.md` describe the final lifecycle and trust limits. Independent review approval and release authorization remain pending. No local execution action remains blocked or uncertain in this deliverable.
