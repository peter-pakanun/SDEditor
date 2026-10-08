# Local-first baselines and incremental server storage

Design recorded: 2026-10-08. Implementation updated: 2026-10-09.

Status: Implemented in the frontend and companion API source; production deployment and production compaction remain pending. API schema v16 must deploy before the frontend. This document records the storage decision, implementation, migration safeguards, and local validation. It does not establish that either hosted service has been updated.

Read this document before changing managed-version baseline retention, collection/export generation, shared history storage, or database compaction. The [Workspace Status Contract](workspace_statuses.md) remains authoritative for statuses, assignment provenance, diagnostics, and export eligibility. Operational rollout instructions are in [Cloud Backup](cloud_backup.md).

## Architectural decision

Keep the immutable complete parsed baseline in the browser. Manager publication retains the exact original ZIP as a separate content-addressed artifact, accepted import decisions, and compact verified metadata in SQLite. It no longer keeps a permanent complete multilingual parsed baseline or a duplicate full baseline in a completed upload job.

The browser generates managed translated downloads from the verified original ZIP and an immutable snapshot of server-accepted Saved translations. When publication preparation or a compatibility download needs original text, the API parses the retained ZIP temporarily. Parsing is coalesced across concurrent requests and uses a bounded two-baseline memory cache; cached parses still require matching retained ZIP bytes.

Ordinary translator saves and standalone room creation do not upload full ZIPs. Unsaved drafts and existing browser-local revision history stay local. "Incremental" means sharing affected files and authored operations, rather than uploading every original file. The API still holds real Saved text, scoped per-file baseline witnesses, Dropped recovery content, and authenticated history. Saves are not character-level patches.

## Why the downloaded database was large

The downloaded backup `2026-10-08T14-11-45-782Z-7a571b29` was a schema-v13 snapshot. Sizes below include each table's indexes and use MiB (1,048,576 bytes).

| Storage in that snapshot | MiB |
| --- | ---: |
| Shared translation history | 77.8 |
| Legacy parsed source manifests | 65.9 |
| Current collaboration translations | 47.1 |
| Collaboration replay events | 36.2 |
| Published version's parsed baseline | 34.3 |
| Completed upload's duplicate baseline | 34.3 |
| Reusable free database pages | 34.2 |
| Other tables and indexes | 2.3 |
| Total SQLite file | 332.1 |

Five legacy rooms accounted for 101,558 initial seed history records out of 102,563 history records. Non-seed before/after JSON totaled approximately 0.61 MiB. The newer sparse rooms contained 752 shared files. The completed upload's parsed file array exactly matched the published baseline's file array. Across legacy versions, identical filepath/source payload pairs repeated approximately 23.6 MiB of source JSON.

Legacy room initialization stored a complete source manifest, a current translation row and seed history for every file, plus a replay event containing the seeded translations. Switching new rooms to sparse synchronization did not remove those records. Original and collected ZIP files were excluded from this backup, but parsed text inside SQLite was included. Its WAL was empty. Duplication and retained free space explain most of this snapshot's size.

## Persistence boundary

| Data | Browser | Server |
| --- | --- | --- |
| Complete immutable parsed baseline | Retained with accepted source identity | Temporary verified ZIP parsing only for modern managed versions |
| Original ZIP | Local import or cached authorized download | Explicit manager publication retains an external artifact and reference/checksum |
| Accepted archive descriptor | Retained with baseline | ZIP hash/size, parser version, duplicate decisions, configuration hash, Merkle root and baseline identity |
| Baseline metadata | Complete local baseline | Filepath, English entry count, DNT eligibility and hashes of complete original team translations |
| Version catalog and team state | Account-scoped cache | Names, HEAD, deadlines, access, advisory ended state and collection references |
| Drafts and pending local saves | Durable account/workspace-scoped data | Excluded from shared state and collections before acceptance |
| Saved translations | Durable work and sync cache | Affected-file content, revisions, attribution, conflicts and idempotency receipts |
| Per-file originals/proofs | Local baseline | Scoped witnesses and recovery content needed for touched work |
| Dropped copies | Separate snapshots and provenance | Preserved text/source metadata, recovery generations, conflicts and assignment/resolution provenance |
| History | Local history remains local | Authenticated shared history with retrievable before/after content |
| Modern managed collections | ZIP generated locally | Immutable Saved snapshot and verified reconstructible manifest |
| Legacy collections and rooms | Existing compatibility behavior | Existing ZIP artifacts, source manifests and seed history retained |
| Dictionaries, settings, comments | Existing local/cache behavior | Existing language/account/audience contracts |

Do not persist UI status booleans. Preserve account, game, branch, baseline, selected language, role/access, and comment audience guards across asynchronous work and retries. Activating an existing version does not advance its source, create Dropped assignments, or rewrite baseline/history. Publication continues to reuse matching rooms and shared history.

## Managed collections and client ZIP generation

The modern frontend requests `format: 'manifest'` on collection/download creation. The API captures the authorized team's current server-accepted Saved files, room sequence and immutable content in one transaction. `GET /v1/collections/:id/manifest` returns that frozen text with the accepted archive descriptor, parser/encoder versions, language and download name. Later edits, drafts, pending uploads and Dropped copies cannot enter the captured collection.

Before the collection becomes ready, the API verifies the retained original ZIP, accepted baseline identity and captured export shape. The ending contract is now **durable reconstructible inputs**: a verified immutable manifest plus the retained verified original. The API marks an ending team ended after that readiness check, without waiting for a browser to finish downloading or generating its ZIP. A browser export failure retains the collection ID and snapshot for retry. Collection completion is revision-guarded so an older job cannot override a later collection or explicit reopen.

The browser uses its matching verified local baseline when available. Otherwise it downloads the original ZIP and replays the accepted parser and duplicate-block decisions without activating another workspace. It verifies ZIP SHA-256, configuration hash, Merkle root and baseline identity. It then replaces only the selected-language text in the captured Saved files, preserving original English, entry metadata and other language blocks. Account/source/access changes cancel stale results; explicit preparation uses the existing work spinner.

Collections remain Saved-only, including unchanged or intentionally blank saves. They are not full-original-ZIP exports. Empty teams can end without a browser download. Download-only preserves open/ended state and the latest ending collection; recollection creates a later cutoff. Entry order, UTF-16LE encoding, fixed ZIP timestamp (2000-01-01), and DEFLATE level 5 match the API exporter. Byte equality is covered by local validation.

Compatibility is deliberate: older requests that omit `format` retain server-rendered archive collections and existing artifact downloads. The new frontend can fall back for an older API or replay a previously persisted request ID with its original request shape. Retrying uses the same durable ID. A manifest collection's legacy archive endpoint can reconstruct bytes temporarily without retaining another translated ZIP artifact. Existing archive collections are not converted or deleted.

## Counts and source advancement

`version_baselines.files` contains compact parser-derived metadata. Original completeness is represented by language-specific hashes only when every original line is nonblank and its count matches English. Hashes cover the original raw translation arrays, preserving Revised comparisons; English count and DNT eligibility preserve Missing/eligible counts. Saved, Missing, Revised and Dropped still follow the Workspace Status Contract and version-specific assignment provenance.

Source advancement transiently parses the verified predecessor and incoming ZIPs for carry-forward and Dropped preparation. Hashes alone cannot recreate old translations. Pending preparation retains compact metadata and witnesses only for inherited touched paths, plus necessary staged/Dropped work and revision checks. Completed publication replaces those preparation files/teams with the accepted archive and a bounded summary. Withdrawal, recovery evidence, and source-version identities remain intact.

## Immutable payload storage

Schema v15 introduces `immutable_payloads`: canonical JSON addressed by SHA-256, losslessly deflated, checksum/size checked and protected from update/deletion. Large translation arrays and file snapshots are shared through nested references. Current state, source manifests, history, replay events, Dropped snapshots, parent captures, recovery payloads and collections can reference the same content. Decoding returns detached values; callers receive the existing wire format. Legacy inline JSON is still readable.

The v15 migration preserves row IDs, history ordering, authors, receipts, recovery IDs, resolved archives and conflict/provenance metadata. It verifies each converted payload round trip, restores immutable history/event triggers and checks foreign keys. Invalid data rolls back the migration. Reference verification traverses durable payloads, including nested frozen Dropped content. Limits bound decoding and the decoded cache. Logical room quota accounting uses original payload sizes, so compressed references do not bypass quotas.

Keep quota joins indexable: look up `immutable_payloads.hash` directly using the hash extracted from a validated reference token. Comparing a file's reference to a concatenated prefix plus every payload hash prevents an indexed lookup and scans the payload table once per room file on every save/deletion. A 2026-10-09 CPU investigation reproduced this regression with 100,000 payloads and 750 room files: the quota query consumed about 2.5 seconds of CPU; the corrected indexed query took about 0.4 ms with identical logical byte totals, including UTF-8 inline rows. A regression test checks the actual store query's plan. Queued distinct saves can sustain CPU after typing stops; retries of accepted mutations still reuse durable receipts. This fix changes the query only, requires no schema/data rewrite, and needs API deployment to affect a hosted process. The benchmark is local evidence, not a hosted profile.

Schema v16 replaces permanent managed parsed baselines and preparation duplication with compact metadata and adds manifest collections. **Before either new migration runs**, startup checks every existing managed baseline/prepared archive's accepted decisions and original ZIP reference, size and SHA-256. Missing or corrupt original artifacts block migration and preserve the old database schema and full parsed content. Restore the separately retained originals, then retry. Server startup supplies its configured artifact directory; library callers can pass `openDatabase(path, { artifactDir })`.

No history retention/deletion policy was introduced. Legacy full source manifests and seed records remain retrievable through deduplicated references. Immutable payloads are retained; reference garbage collection would require a separate recovery policy.

## Backups, compaction and rollout

Backup manifest format 4 contains a compacted SQLite snapshot compressed as `sdeditor.sqlite.gz`, checksums for compressed and expanded bytes, the exact expanded size, configuration when present, and external artifact references. Snapshot compaction never vacuums the running source database. ZIP files remain excluded. Restore supports formats 1–4, verifies expansion bounds/checksums, database integrity and immutable references, and verifies separately retained ZIPs before replacing the database. `--uncompressed` creates a compact raw format-3 snapshot for compatibility.

To reclaim pages in the live database after migration, stop the API and run `node scripts/compact.js --stopped` in the API checkout. This command checks the process lock, creates a compressed safety backup, obtains an exclusive database lock, checkpoints the WAL and vacuums deliberately. It does not run automatically at startup. Retain `DATA_DIR/artifacts` separately, including existing collected archives. Deploy schema v16 and reference-aware restore before the frontend; rolling back requires old code plus a compatible database/artifact backup and loses post-backup writes.

## Validation and remaining operational work

Local API validation passed 217 tests, including migration rollback, missing/corrupt-original preflight, old client/archive compatibility, frozen manifests, wrong-ZIP rejection, counts/provenance, retrievable history, gzip verification, restore and stopped compaction. Frontend checks passed 9 collection-export and 85 managed-version tests. A normal-mode desktop browser fixture exercised IndexedDB, save workers, authenticated collaboration, manifest exports, byte-equivalent ZIP generation, offline activation, language isolation and access revocation.

The follow-up audit on 2026-10-09 compared old/new counts for all 12 teams and 20,547 baseline files in the downloaded backup; counts matched and its checksum stayed unchanged. A disposable fixture preloaded all 12 teams on the same accepted HEAD, then verified room IDs, sequences, history, Saved text, pending preparation and frozen collections through publication and v14→v16 migration. Matching verified local baselines are reused for client exports without reimporting the ZIP. Another 2,000 generated JSON cases checked lossless payload round trips. The audit corrected duplicate-summary language/occurrence labels and added regression assertions; accepted parser decisions and translation content were unaffected. No translation/history loss was reproduced. Server originals are still required for every managed baseline/prepared archive, including older versions, even when all browsers have the current HEAD loaded.

A disposable copy of the downloaded schema-v13 database was migrated and vacuumed during development: **332.1 MiB → 158.2 MiB** (52.4% smaller); its compressed output was **62.2 MiB** (81.3% smaller than the original raw file). Canonically decoded contents of 20 durable tables were compared, all 102,563 history rows remained, compact metadata was checked against the original baseline, and the downloaded file's checksum remained unchanged. This benchmark exercised the reduction before the final artifact preflight was added. The downloaded folder lacks ZIPs, so current startup intentionally refuses to migrate it without its separately retained originals. Production size may differ.

Pending: coordinated API/frontend deployment, separate artifact retention/transfer, and deliberate production compaction after a recoverable backup. The live database, deployment and original downloaded backup remain unchanged; browser checks used disposable profile/storage. Local fixtures do not establish hosted OAuth/CORS or production restore readiness.

## Code entry points

| Area | Implementation |
| --- | --- |
| Managed collection verification and browser encoding | [public/managedCollectionExports.js](../public/managedCollectionExports.js) |
| Managed download requests, scope guards and retries | [public/managedVersions.js](../public/managedVersions.js) |
| Immutable workspace/status rules | [public/workspaceState.js](../public/workspaceState.js) |
| API payload codec and migration/reference checks | Sibling `SDEditor-API/src/payload-store.js`, `src/payload-schema.js` |
| API metadata, preparation, counts and collection jobs | Sibling `SDEditor-API/src/version-metadata.js`, `src/versions-store.js`, `src/versions-schema.js` |
| API original ZIP parsing and compatibility encoding | Sibling `SDEditor-API/src/version-codec.js` |
| API migration preflight | Sibling `SDEditor-API/src/database.js` |
| Backup, reference-aware restore and stopped compaction | Sibling `SDEditor-API/scripts/backup.js`, `scripts/restore.js`, `scripts/compact.js` |
