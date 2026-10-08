# Local-first baselines and incremental server storage

Date: 2026-10-08

Status: Recorded design direction; implementation pending. This document records the database-size investigation and the proposed storage boundary. It does not describe a completed migration or authorize deleting existing data. The current runtime behavior remains documented in [Cloud Backup](cloud_backup.md), [Multi-Version Support](multi_version.md), and [Import Workflow](import_workflow.md).

Read this document before changing managed-version baseline retention, collection/export generation, shared history storage, or database compaction. The [Workspace Status Contract](workspace_statuses.md) remains authoritative for statuses, assignment provenance, diagnostics, and export eligibility.

## Architectural direction

Keep the immutable complete parsed baseline in the browser. The server persists shared work and the information needed to authenticate, recover, coordinate, and reproduce that work. Manager publication does not inherently require a permanent second representation of the complete original ZIP inside SQLite.

Generate translated downloads in the browser from the verified original ZIP and an immutable snapshot of server-accepted Saved translations. When server processing needs original content, it can parse the retained original ZIP temporarily rather than persist the complete parsed archive indefinitely.

Retaining the original ZIP as an external artifact for explicit manager publication and authorized team downloads remains compatible with this direction. Ordinary translator saves and standalone room creation must not acquire full-ZIP uploads. Unsaved drafts and existing browser-local revision history remain local.

"Incremental" means sharing affected files and authored operations. It does not mean the API holds only hashes, or that every save is a character-level patch. Saved translation content, per-file baseline witnesses, Dropped recovery content, and shared history are real server data. Any future delta encoding must retain independent recovery and conflict validation.

## Current implementation and why it is large

Standalone sparse collaboration already creates empty rooms and sends baseline witnesses/proofs on first saves. It retains the selected language's original translation for touched files, saved overrides, and authenticated history. Untouched originals come from the client baseline.

Legacy room initialization instead stored a complete source manifest and created a current translation row and seed history record for every file. A replay event also embedded the complete seeded translation set. Switching new rooms to sparse synchronization did not remove these older records.

Manager publication currently stores the complete multilingual parsed baseline in `version_baselines.files`. The same file array remains in `version_uploads.prepared` after publication. The parsed baseline also supports server-side team counts, predecessor comparison, carry-forward/Dropped preparation, and ZIP collection generation. These are present implementation dependencies, not proof that permanent parsed-baseline storage is essential.

The downloaded backup `2026-10-08T14-11-45-782Z-7a571b29` provided the following evidence. It was a schema-v13 snapshot, not a measurement of every future deployment. Sizes include each table's indexes and use MiB (1,048,576 bytes).

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

Original and collected ZIP files were excluded from this backup; parsed text inside SQLite was not. The WAL was empty. These findings explain duplication and retained free space, rather than establishing that normal recent saves alone caused the database size.

## Intended persistence boundary

| Data | Browser | Server |
| --- | --- | --- |
| Complete immutable parsed baseline | Retained with the accepted source identity | No permanent full parsed copy in the intended design; temporary parsing/cache is allowed |
| Original ZIP | Local import or cached authorized download | Explicit manager publication may retain one external artifact and its reference/checksum |
| Accepted archive descriptor | Retained with the baseline | ZIP hash, parser version, duplicate-block decisions, configuration hash, Merkle root, and baseline identity |
| Version catalog and team state | Account-scoped cache | Names, HEAD, deadlines, access, advisory ended state, and collection references |
| Drafts and pending local saves | Durable account/workspace-scoped data | Not included in shared state or collections before acceptance |
| Saved translations | Durable local work and sync cache | Affected-file content, revisions, author/time, conflicts, and idempotency receipts |
| Per-file original content/proofs | Available from the local baseline | Scoped witnesses and recovery content needed for touched work; deduplicate immutable payloads where possible |
| Dropped copies | Separate preserved snapshots and provenance | Preserved text/old source metadata where available, recovery generations, conflicts, and assignment/resolution provenance |
| History | Local history remains local; shared history cached as needed | Authenticated shared history with retrievable before/after content |
| Collections | ZIP generation from the verified baseline and frozen shared work | Durable immutable manifest identifying the baseline and exact accepted file revisions/content |
| Dictionaries, settings, comments | Existing local/cache behavior | Existing language/account/audience contracts; unaffected by translation-baseline reduction |

Compact metadata is still server data. It must be bounded and derived from verified content, not a renamed full multilingual baseline or client-supplied status booleans. Preserve account, game, branch, baseline, selected language, role/access, and comment audience guards across requests, asynchronous callbacks, and retries.

## Client-side downloads and collections

The browser already parses downloaded published ZIPs and generates local translation ZIPs. A managed collection can use the same codec and archive validation, with a separate immutable input snapshot:

1. The server atomically captures a collection manifest for the authorized game, branch, accepted baseline, language, and room sequence. It includes exactly the server-accepted Saved files and pins their revisions or immutable content references, including staged/deleted presence at that cutoff.
2. The browser obtains the matching original ZIP from its cache or the authorized artifact endpoint. It replays the accepted parser/duplicate decisions and verifies the resulting baseline identity.
3. The browser fetches the collection's pinned translation content. It must not substitute current editor text, unsaved drafts, pending uploads, later room revisions, or a Dropped snapshot.
4. The browser reconstructs and encodes each Saved file using the original English, entry metadata and other language blocks plus the captured selected-language translation. It generates the translated ZIP locally.
5. A later download of the same collection uses the same manifest and retained inputs. Recollecting explicitly creates a new cutoff. Download-only must keep the team's ended state and latest ending collection unchanged.

Current collections contain Saved files only, including unchanged or intentionally blank saves. They are not full-original-ZIP exports. Preserve that behavior unless a separate product change is requested. Dropped snapshots never enter an export directly.

Pinned references must remain resolvable. A room sequence alone is insufficient if records needed to reconstruct that sequence can be overwritten or removed. Reproducibility also requires retaining a compatible parser/encoder version and canonical decisions. Logical file-content reproducibility and byte-identical ZIP artifacts are different guarantees; entry order, timestamps and compression must be specified if byte identity is required.

The existing ending workflow marks a team ended only after the translated artifact is durable. Client-side ZIP generation must address that guarantee explicitly: either preserve a verified durable artifact completion path, or deliberately define completion around a durable reconstructible manifest. This document does not silently change the current ending contract. A failed or interrupted browser export must leave a retrievable collection and safe retry path.

## Counts, source advancement, and validation

Moving ZIP generation alone does not remove all current baseline dependencies.

Team counts can use compact verified per-file metadata: filepath, DNT/eligibility information, English entry count, original completeness for each team, source-shape fingerprints, and canonical original translation fingerprints. Saved/Missing/Revised/Dropped still derive from committed content and version-specific assignment provenance under the Workspace Status Contract. Exact normalization, metadata format, and proof validation must be specified before implementation.

Source advancement needs both predecessor and new source shapes to decide carry-forward versus Dropped work. It must also preserve old original translations that become Dropped, including files with no shared save. Hashes can identify a change but cannot recreate that text. Obtain the required content from retained old/new ZIPs through temporary parsing, or through an explicitly validated client preparation protocol. Keep canonical choices, source availability reporting, and revision checks intact.

Selecting an existing version is activation, not source advancement. Storage reduction must not create new Dropped assignments, rewrite immutable baselines, or move work/history between source identities. Publishing an already accepted baseline must continue reusing matching rooms and shared history.

Server authority over permissions, accepted writes, immutable collection cutoffs, proof verification, and authenticated history remains necessary even when parsing and ZIP generation happen on clients.

## Storage reduction and migration constraints

Prefer lossless structural reductions:

- Store identical immutable source/revision payloads once and reference them from current state, history, events, and collections. Preserve room/version identity and ordering even when content is shared.
- Replace completed publication preparation payloads with baseline references and bounded summaries while retaining upload status, conflict details needed by the UI, and idempotent replay information. The current status APIs still read `prepared`; clearing the column without changing those consumers would break the workflow.
- Migrate legacy full seeds to retrievable immutable references. Do not delete old rooms, seed histories, original source text, or recovery evidence merely because new rooms are sparse.
- Reclaim reusable free pages through deliberate database/backup compaction. This is separate from logical deduplication and does not prevent repeated payload growth.
- Compress downloadable backups to reduce transfer and retained backup size. Compression does not shrink the live database or change persistence boundaries. See SQLite's [VACUUM documentation](https://sqlite.org/lang_vacuum.html) for database compaction behavior.

Do not introduce automatic history retention/deletion as an assumed part of this direction. Retention changes recovery guarantees and requires a separate explicit policy. Preserve save receipts, durable mutation/request IDs, recovery generations, resolved archives, source-version assignment evidence, and conflict checks through migrations. Existing collection artifacts and all content referenced by their snapshots must remain retrievable.

Any implementation needs a coordinated API/schema/frontend rollout, a recoverable backup, reference-aware artifact restoration, and compatible client handling. Keep raw ZIP artifacts separately because the current operational backup excludes them. Never clear browser storage or lose recoverable data to complete a migration. The database investigation and this document authorize no cleanup, schema migration, deployment, or code change.

## Implementation choices still open

- Whether an ending collection retains a generated ZIP artifact, a reconstructible manifest, or both; completion and retry semantics must preserve the chosen durability contract.
- Whether carry-forward preparation runs on the server using temporary ZIP parsing or uses a validated client preparation protocol.
- Compact metadata/proof formats, payload reference layout, temporary cache limits, and parser/encoder compatibility retention.
- Legacy migration, verification, rollback, and compatibility handling for existing clients and backup formats.

Before declaring the direction implemented, verify client/server export equivalence, Saved-only scope, wrong-baseline rejection, frozen collections across later edits, interrupted/repeated collection requests, draft/upload exclusion, counts and Dropped provenance across versions, and retrievability of all migrated shared history. Measure database growth and size on representative data separately from backup compression. Local checks do not prove hosted deployment or production restore readiness.

## Code entry points

| Area | Current implementation |
| --- | --- |
| Browser published ZIP parsing and managed downloads | [public/managedVersions.js](../public/managedVersions.js) |
| Browser ZIP generation | [public/index.js](../public/index.js), [public/statDescCodec.js](../public/statDescCodec.js) |
| Immutable workspace/status rules | [public/workspaceState.js](../public/workspaceState.js) |
| API sparse/legacy initialization, saves, history, events | Sibling `SDEditor-API/src/collaboration-store.js` |
| API baseline lookup, counts, preparation, publication, collections | Sibling `SDEditor-API/src/versions-store.js` |
| API original ZIP parsing and collection encoding | Sibling `SDEditor-API/src/version-codec.js` |
| Operational backup and reference-aware restore | Sibling `SDEditor-API/scripts/backup.js` and `scripts/restore.js` |
