# Use English: toolbar and actionable Missing follow-up

This local follow-up is based on the now-live frontend `819c90e339a5e7ec3b3595bcb8173fa955899614` and API `e7e045fce1150c519b8d94bfbb47ccdadf01e666`. The owner's request supersedes the original decision to leave Missing/progress raw. This document records implementation and local evidence, not release approval. No push, deployment, production migration, sample mutation, external workbook upload or live inference occurred.

## Result

- A single **E** button follows Underline and a separator. It shares the formatting-button active class, has accessible name **Use English**, a contextual tooltip/description and native Tab/Enter/Space behavior. Disabled controls explain ineligible scopes; old unsupported decisions remain removable. The former verbose block, passive text and Raw Missing note are removed.
- The existing normal Missing counter/filter now describes actionable work. A current, eligible, active source-bound decision resolves its blank target. The field/row stops being Missing, diagnostics skip that resolved translation, and attention navigation no longer treats it as translation work. Raw emptiness remains `fields[fieldId].rawMissing` internally; no competing visible raw counter is introduced.
- Suspended/revoked/expired/mismatched/ineligible decisions and real conflicts cannot resolve Missing. Conflicts with a real nonblank incoming translation remain in attention navigation without falsely labeling the real translation blank. Failed shared saves refresh current saved/recovery state immediately, rather than leaving the resolved counter displayed until the next poll. A newer private draft is retained.
- Both editor and assignment progress use resolved initial workload fields / all initial Missing/Outdated workload fields. Unmarked blanks stay in the denominator. Missing/Outdated overlap counts once. Source-reviewed nonblank work and explicit English decisions resolve work; a reviewed blank without approval remains Missing. Corrections outside initial workload retain their existing exclusion. Marker-only audio does not manufacture workload.
- Sheet aggregation retains red > orange > purple > green > grey > no color. Original Missing work resolved by English uses established grey; reviewed/corrected work follows existing field rules. Grey remains distinct from uncolored complete originals. Other unresolved siblings/manual diagnostics retain their priority. Successful explicit conflict resolution clears current conflict flags while its full before-provenance remains in history.

Stored/exported targets remain blank; no English text is fabricated. Original packages, IDs, source fingerprints, filenames, macro bytes and raw whitespace contracts remain unchanged. Cell/tab status colors now reflect the resolved intent using the existing palette. Blank saves without explicit intent never acquire approval.

## Validation

Entire frontend suite, all `scripts/test-*.cjs` files without a subset:

```powershell
$taskFiles=Get-ChildItem scripts -Filter 'test-*.cjs' -File | ForEach-Object FullName
node --test --test-concurrency=2 --test-timeout=120000 --test-reporter=spec @taskFiles
```

**3,763 passed; zero failures/skips.** Log: `temp/use-english-actionable-full-frontend.log`.

API `npm run check`, followed by `npm test -- --test-concurrency=2 --test-timeout=120000 --test-reporter=spec`: **836 passed; zero failures/skips.** Logs: sibling `SDEditor-API/temp/use-english-actionable-api-check.log` and `use-english-actionable-full-api.log`. Disposable TEMP is outside the API checkout. Actual HTTP tests verify initial Missing 1/resolved 0 -> approval Missing 0/resolved 1 with `saved:false`, identical results after count-cache rebuild, revocation restoration, and changed-source carry returning Missing/Outdated. Sparse-counter tests reject invalid state, hash, scope, eligibility and conflict projections. No original summaries are rewritten.

Current browser evidence:

- `node scripts/clienttext-browser-fixture.cjs --english-http-only --keep`: real SPA, worker, IndexedDB, authentication and HTTP save routes using synthetic paired originals. E text/order/separator and `aria-pressed`, Space/Enter activation, visible normal Missing **3 -> 2**, actual Missing-table exclusion, no red field frame, initial-workload progress, known rejection restoring Missing, ordinary saves, lost receipts, explicit accept/reapply and retained history. Report `temp/sdeditor-clienttext-browser-JTPlNl/clienttext-english-http-results.json`; log `temp/use-english-actionable-http-browser.log`. Four theme captures are in the same directory; light and modern-dark were visually inspected.
- `node scripts/clienttext-local-browser-check.cjs --use-english-only`: real supplied PoE2 Thai, ordinary identical Save, explicit conversion/history, blank native export, reload, v2 backup/restore, revocation and local predecessor carry. The normal Missing counter remains **1,998** through reload and backup restoration, with the approved field not Missing. Revocation restores it to **1,999**. Targets export empty with existing translated naming/palette. Report `temp/clienttext-use-english-browser-results.json`; log `temp/use-english-actionable-native-local.log`.
- `node scripts/clienttext-local-browser-check.cjs --intent-conflicts-only`: native identical approvals, lost recovery acknowledgement, accepted/reapplied choices, exact rejected-body recovery, unsupported DNT projection/cursor advancement and disabled E tooltip explanations. Report `temp/clienttext-use-english-conflicts.json`; log `temp/use-english-actionable-native-conflicts.log`.

Browser reports recorded zero uncaught errors and no inference. Native local-workbook runs recorded zero HTTP writes. HTTP acceptance intentionally writes synthetic data only to its disposable localhost API. Syntax checks and both `git diff --check` checks pass.

The initial full-suite failure was a test harness evaluating a browser-context-dependent computed property through a separate CommonJS root; it now uses its loaded VM mixin. A browser assertion initially inspected visibility before the asynchronous Close action settled; the fixture now awaits the actual closed state. These were corrected and the full/acceptance runs above passed. Automatic review initially denied a combined fixture edit/browser command under the obsolete research-only restriction; that command did not execute. The parent supplied fresh explicit implementation/testing authorization, the blocked operation was retried once under that clarified scope, and approved. No action remains denied, pending or uncertain.

Original samples remain unchanged:

```text
PoE2 Thai.xlsx: f46736c6501a606a4168a6a6fdd321b30a3feff123fba00031d0d6be992c403a
PoE1 Thai_PoE1.xlsm: 67f90e1d2bae8063c7a351b56028548a46ccf82576d5b4223efb9cfea9889cb4
```

This round did not repeat every-language native acceptance, the complete older PoE1 persistence fixture or the two-client Dictionary/TM fixture. Prior passing evidence is retained in the previous review package. Current complete suites preserve those subsystem regressions. There is no game-runtime, hosted OAuth/deployment, other-browser-engine, actual eviction/quota exhaustion or physical disk/power-failure claim.

## Compatibility and review

The API advertises `clientTextEnglishStatus: resolved-v1`. Deploy that compatible API before the frontend and reload older tabs only after separate review/release authorization. This follow-up remains API schema 30, IndexedDB 25 and local protocol v2: it changes derived status/count/color projections, with no database migration, source catalog, source-text copies or durable request-body changes. Existing legitimate decisions immediately participate in fresh projections; old blank cells are never inferred or bulk marked. Existing receipt/access/atomic-save/history and v1-read/v2-backup protections remain.

Rolling back this follow-up's code restores the prior status/count interpretation; it needs no data rollback. The earlier schema29-to30 and older-browser rollback limitations still apply to the original release. Eligibility continues to use verified client-file facts under the existing trusted-client boundary; the API cannot independently disprove forged DNT eligibility from a hash alone.

Fresh independent review and a new exact-commit release approval remain required. There is no unresolved product ambiguity blocking this local review: the normal Missing counter is actionable, and raw emptiness is internal only. Bulk marking and additional fallback scopes remain separate work.
