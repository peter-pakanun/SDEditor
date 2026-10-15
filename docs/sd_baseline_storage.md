# ZIP-only StatDescription source storage

The frontend uses IndexedDB v22 and the companion API uses schema v24. Deploy
the API first. This replaces the undeployed per-file-fragment design; production
has not been migrated by agent work.

## Source authority and trust

The owner's explicit preference is **"ZIP over SQLite, 10:1"** for SD source
availability and correct hashing. This expresses an architectural priority, not
a measured failure probability. The owner supplies the latest original ZIP and
accepts losing historical source when an older ZIP and its verified client caches
are gone.

The exact immutable ZIP, interpreted with its accepted parser and duplicate
decisions, is the authority for SD English, metadata and original translations.
SQLite's source fingerprints, entry counts and workload summaries are compact
derived facts, not a second source archive. SQLite remains authoritative for
authored targets, edit attribution, accepted collection targets, receipts and
Dropped lifecycle. Complete TM remains in SQLite under its existing contract.

Future changes must not add SQLite source copies, complete untouched catalogs,
extracted per-file server artifacts or exhaustive historical ZIP verification to
guard against the accepted possibility of old-source loss. Verify ZIP identity
when importing or actually using it. A mismatch remains an integrity error;
this preference does not authorize silently rewriting accepted identities or
authored work. Access, translation completeness, revision guards and atomic saves
remain required. ClientText workbook and generated collection dependencies keep
their existing retention and verification requirements.

## Retention boundary

SQLite retains complete Translation Memory, current staged translations, authored
before/after target values, edit attribution, Dropped copies and lifecycle,
recovery IDs, accepted collection targets and retry receipts. Explicit unchanged
saves, imported stages and review records remain durable. A target identical to
an original is still protected when it belongs to authored history.

SD English and parser metadata resolve from the exact original ZIP. SQLite keeps
compact identities, counts, accepted fingerprints and workload summaries. There
is no `artifacts/sd-baselines` directory and no complete untouched source catalog
in SQLite. Pure untouched legacy seed values may be unavailable; their event IDs,
actors, timestamps and revisions remain in compact SQLite indexes.

Latest source availability is an operational guarantee. Historical ZIP retention
is best effort: losing an old ZIP and all verified browser copies loses historical
English/metadata, source diffs, old-file reconstruction and untouched translations
that existed only there. Staged work, authored history and existing Dropped text
remain available. Missing old source never falls back to current English.

## Advancement and the Dropped model

For managed advancement, the manager's browser uploads the incoming ZIP and asks
the API to prepare it. The API performs the comparison for each team's matching
predecessor. It reads the predecessor ZIP when available and combines that source
context with a captured snapshot of server-accepted Saved translations; an ended
team uses its frozen ending-collection cutoff. Conceptually this is the previous
baseline with Saved work overlaid. A complete merged baseline is not persisted in
SQLite. Offline **Import Next Version** performs the equivalent comparison in the
browser. Selecting an existing version performs no carry-forward.

Changed English or missing/incomplete incoming translation at a retained filepath
can preserve predecessor text as Dropped. Existing unresolved copies propagate only
while that filepath remains in the incoming source. Entire filepath removal is
authoritative and creates no new Dropped or recovery copy. Earlier-version work
and history remain in their original scope. Opening an existing source version
physically deletes its removed-file recovery records after verification against
the matching ZIP or a complete accepted browser baseline. Missing/incomplete
source caches never prove deletion. A legacy candidate still assigned to a
predecessor containing that filepath keeps only its valid predecessor assignment.
Text-free recovery dispositions retain original retry hashes; saved translations,
edit history and frozen collections remain intact. This cleanup touches scoped
recovery records only. Reclaiming unreachable immutable payload bytes still uses
the explicit stopped maintenance command; it never runs a full payload sweep on
startup or during version loading.
When an old ZIP is unavailable, retained source fingerprints can still classify
staged work; unknown old English preserves that work as Dropped conservatively.
Untouched translations existing only in a missing old ZIP cannot be recovered.

A Dropped record owns a **frozen copy of its translation text**, its original
baseline identity and filepath/source reference, compact source facts where
available, candidate ID/revision, destination-version assignments and resolution
state. Never rebuild an existing candidate's target text from the predecessor's
mutable current stage. Later predecessor edits must not change the frozen copy.
Historical English/metadata is resolved from the matching ZIP or verified client
cache only when needed for comparison. Losing that source does not lose the
frozen target or prevent explicit recovery against the verified current baseline.
Explicit history recovery can also create a Dropped candidate with a stable
recovery ID; advancement is the main automatic trigger, not its only origin.

Ownership also identifies the version chain. Browser-created automatic copies
belong to the standalone local import chain and remain local recovery records.
Managed automatic copies come from the API's accepted predecessor chain and
remain online records. Matching destination ZIPs or matching preserved text do
not merge these lifecycles or their assignment lists. Cached online work retains
its online identity while disconnected; a local import of its next source creates
local recovery without extending or resolving the original online record.

The client can use both owners at runtime. It labels them **Local recovery** and
**Shared Dropped**, retains each frozen target, and resolves only the selected
copy. A local recovery can be reviewed and saved against the current managed
baseline through the normal completeness, candidate and file-revision guards.
That authored save can synchronize without resolving the online candidate. Only
the current workspace's ownership contributes to Dropped assignment status and
Revised eligibility. SQLite retains online recovery and authored collaboration
history; browser storage retains local recovery, including resolved dispositions.
An attached Local recovery retains its originating standalone scope. Promotion
or discard resolves that local candidate in the same transaction as the managed
workspace action, with exact-snapshot and revision guards. The standalone staged
translation and its history remain unchanged; stale linked recovery rejects the
destination transaction instead of consuming a changed copy.

The schema-v24 API advertises the `separate-v1` ownership capability and accepts
new client-created online candidates only for explicit recovery with a stable
`recoveryId`. It retains existing server candidates and replay evidence. Browser
v22 fences older pages/workers that can merge owners, preserves all existing
stores, and retains obsolete cross-owner conflicts in a recovery archive. Room
identities, edit attribution, history and saved-translation receipts stay intact.
Deploy this API capability before the frontend.

## Source loading and recovery

`sdSourceStorage: 'zip-only-v1'` identifies the API contract. First-file witnesses
are accepted transiently and reduced to compact immutable facts. Accepted source
references validate without reading historical ZIPs. Old queued requests retain
original IDs and bodies; source fields are removed only after request hashing.

The client resolver uses detached memory/per-file caches, verified cached ZIPs,
or an authorized room/version baseline-file request. The separate ZIP worker
hashes/indexes archives and extracts only requested TXT entries. Its caches retain
at most two opened archives and 64 parsed files/16 MiB. JSZip may read the complete
compressed package; this is selective decompression, not network range loading.

Source absence produces a comparison error while target history stays visible.
Explicit recovery validates against the available destination baseline, with
candidate/scope/revision guards and complete nonblank SD targets. Entry-count
changes use manual alignment before saving. A lost untouched original may be an
unavailable first-before state; it is never invented as empty translation text.

Version advancement compares retained English fingerprints. Unchanged English
can carry with current metadata; changed or unknown English preserves staged
work as Dropped. Untouched predecessor originals are recovered only when their
ZIP remains available. Selection performs no carry-forward.

Legacy multipart receipts keep original chunk hashes and durable target/fact
projections. Source context for unfinished legacy seed validation is transient;
a server restart can require resending the same chunks with unchanged IDs/hashes.
The client handles `SOURCE_CONTEXT_REQUIRED` without inventing a new upload.

## Conversion and backups

Schema v24 installs compatible readers and metadata without an exhaustive startup
conversion, garbage-collection sweep or VACUUM. In the API checkout, inspect:

```text
npm run cleanup:sd-references -- --dry-run
```

After stopping all API writers, convert with a safety backup and reclaim pages:

```text
npm run cleanup:sd-references -- --stopped --compact
```

Conversion derives compact facts from existing SQLite source before removing it,
checkpoints batches and verifies target preservation, typed SQLite references and
integrity. It does not need old ZIPs or install external fragments. Retain the
pre-conversion database for rollback. Rehearse on a separate copy first.

Before removing an older compact catalog, conversion retains its count/presence
facts for affected Saved, Dropped and resolved paths only. These facts keep cold
dashboard counts and file lookup correct without opening old ZIPs. They are
separate from full accepted source witnesses: they do not prove historical
English or authorize a source reference on their own.

Format-5 backups identify SD source ZIPs as optional external inputs. Missing or
corrupt old SD ZIPs do not block database backup/restore. ZIP identity, parser
configuration and safe extraction are checked when actually imported or used.
Workbook originals and generated collection archives retain required dependency
checks; a hash shared with a required consumer stays required. Formats 1–4 remain
readable. SQLite checksums, references and integrity remain mandatory. Configure
`DATA_DIR`, `DATABASE_PATH` and optional `ARTIFACT_DIR` consistently.

## Verification

Run API `npm run check` and `npm test`, focused frontend storage/collaboration/
Dropped suites, and `scripts/sd-baseline-files-browser-fixture.cjs` for native
IndexedDB, worker extraction, cache reuse and source-loss recovery.

A fresh migration of the supplied production-copy database measured **254.96 MiB
to 72.00 MiB (75,497,472 bytes)** after VACUUM, a **71.76% reduction**, with **zero external SD
fragments**. Retained ZIP bytes are separate. These local measurements do not
establish deployment or production maintenance, and supersede the earlier
fragment-backed sizing result. The supplied production download is unchanged.
