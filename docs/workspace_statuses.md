# Workspace Status Contract

This is the canonical repository contract for workspace statuses and their UI behavior. It guides implementation and regression checks; it does not establish that these changes have been deployed or verified on the hosted editor. User workflows are described in the [Editor Guide](editor_guide.md), [Import Workflow](import_workflow.md), and [Cloud Backup guide](cloud_backup.md).

## Scope and Sources of Truth

Calculate a loaded file's statuses for the **current game, branch, accepted source version, selected translation language, and active local/account profile**. Changing any of these must use the new scope's data. Thai saves, dropped copies, and counters must not appear as German work, including for an Admin assigned Thai who selects German.

The immutable parsed **original ZIP baseline** supplies English, entry metadata, and original translations. Preserve it separately from staged work. Saving, restoring, importing translated work, and receiving shared edits must not rewrite it or change its source identity. A new source import establishes a new baseline.

The **current committed translation** is the staged translation for this file, language, and source version when one exists; otherwise it is the original ZIP translation. Staged presence is meaningful even for an empty array, blank lines, or text identical to the ZIP. Unsaved editor typing is a draft and must not change workspace counts or export data.

Both inline and full editors retain translation drafts locally under their profile/account, game, accepted source, language and filepath. A **Local draft** label and draft findings describe this separate editing state; they are not Saved, Error or Warning workspace statuses. Displaying draft text in a row must not replace its committed descriptor or make Lookup, exports, manual scans or collaboration treat it as committed text.

A **dropped copy** is a separate unresolved snapshot of translation text with its original English and entry metadata where available. It is not the current translation. A valid current ZIP translation may coexist with a dropped copy. Missing old English must be reported as unavailable rather than reconstructed from the new source.

Shared translation rooms use **game + branch + accepted source baseline + language**. Local profiles, unsaved drafts, and queued operations retain their account scope; queued work also retains its original game, branch, language, source version, and access context. Switching accounts or versions must not publish an old operation in the new scope. Dictionaries are shared by **language**, independent of game and source version. Translators synchronize their assigned language; Managers and Admins synchronize the selected language with or without an assignment.

Online/offline catalog association, HEAD, import deadlines, ended windows and withdrawal are version metadata, not translation statuses. Manager dashboards derive the same content statuses from server-accepted work; unsaved drafts and pending local saves are outside their counts and collection snapshots. The Progress column displays Saved / (Missing + Saved), with ordinary Saved in green, the Revised subset of Saved in purple, and Missing in red. The tooltip states the counts and overlap: Revised is included in Saved, and an intentionally blank save can also be Missing. This progress denominator is a workload indicator, not a count of distinct files or overall baseline completeness. An empty workload has a neutral bar. Ended badges belong beside version/team names rather than a separate status column: translators see their assigned team's window; Managers/Admins see a catalog version as ended only when every team has ended. The current version name/hash opens the chooser from the workspace status bar and full editor heading. The workspace deadline follows Saved counts, and hover/focus details retain deadline, ended and withdrawal guidance. Ended is a warning before editing and does not mutate Saved/Missing/Dropped/Revised or the already collected ZIP.

Dictionary entries use `gameScope` (`poe1`, `poe2`, or `all`; legacy absence means All) while the complete Dictionary remains language-shared. Automatic matching uses only the current game's entries and All fallbacks. A current-game entry overrides the entire All entry with the same normalized main Find, including its alternates. Other-game rows remain visible with a warning but do not contribute autocomplete, highlighting, keyword/Regex replacements, terminology findings, or matches-first ordering. Each row retains a unique internal ID; duplicate Find/keyword identifiers across games are separate records.

## Status Definitions

| Status | Derive from | Color |
| --- | --- | --- |
| Missing | Current committed translation has a blank/whitespace-only line or its entry count differs from the current English count | Red |
| Dropped | An unresolved dropped copy exists for the loaded file and selected language | Orange |
| Saved | A staged translation exists for this file, language, and current source version | Green |
| Revised | Saved text differs from the complete immutable original ZIP translation **and** the file has never belonged to this source version's Dropped workload | Purple |
| Error | The active or completed manual diagnostic scan reports an error for the file | Red, matching Missing |
| Warning | The active or completed manual diagnostic scan reports a warning for the file | Orange, matching Dropped |
| Unchanged | Current translation is complete, with no staged translation and no unresolved dropped copy | Neutral |

Use these color relationships in every supported theme and in list labels, filters, and workspace counters. Error/Warning are diagnostic statuses; they do not imply Missing/Dropped. Unchanged is neutral rather than a completion-success color.

**Revised** identifies corrections outside this version's Missing/Dropped assignment workload. Original ZIP completeness establishes Missing eligibility; becoming complete after a save does not change it. Compare staged text to the immutable ZIP translation, never to the preceding save, a history entry, or a dropped snapshot. Returning an eligible file exactly to its ZIP text removes Revised while retaining Saved.

Dropping a file in this version permanently excludes it from Revised **for this version and language**, even after confirmation, replacement, or discard. Preserve version-specific assignment provenance, not a permanent file-wide exclusion. A new source version recalculates eligibility against its new immutable baseline.

## Dropped Assignment and Sync Boundaries

Dropped copies can survive across source imports and are shared by game, branch, language, and file across versions. Their original and target source identities are provenance; a cloud copy may still carry an older target when another browser encounters it in a newer workspace.

For Revised eligibility, retain evidence of the versions in which that file was actually assigned Dropped. Only a copy with durable assignment evidence for the selected source and branch belongs to that version's Dropped workload. Explicit source advancement extends an unresolved predecessor assignment to its successor; promotion, discard, reload and synchronization preserve established assignments. Ordinary selection/activation of a named version, room joining or receiving another version's candidate cannot add a target or upload new assignment provenance. Resolved cloud receipts preserve the same exclusion when the assignment is known. A resolved record belonging only to an unrelated earlier version must not exclude an otherwise eligible file in the current version.

The workspace model records this provenance in a candidate's `targetSourceHashes` list. Preserve and merge that list through active copies, resolved archives, aliases, and cloud receipts. It records assignment history rather than an authoritative UI status flag; the current status remains derived by `WorkspaceState.workspaceFile`.

Do not infer all version assignments from the latest target hash, discard the evidence when resolving a copy, or treat every historical dropped record as a global exclusion. Cross-browser correctness requires durable, synchronized assignment provenance; an in-memory cache alone cannot establish it. This is a persistence/sync requirement, not a claim that an older deployed API supplies that evidence.

The companion API persists `targetSourceHashes` for active candidates and resolution records (schema v11), explicit-recovery generation receipts (v12), and branch-scoped managed versions (v13). Dropped uploads merge these hashes even when identical content is deduplicated; resolution replay must not recreate an unresolved copy. Promotion records the actual target room's source hash in the same transaction as the saved translation and history. Listing with `includeResolved` also returns superseded generations as provenance records without their snapshot payload. Legacy records recover only target hashes supported by retained evidence; an unknown old target stays unknown. Deploy the compatible API before this frontend.

Save stages a replacement; **Confirm unchanged** stages the selected dropped translation. Both resolve that copy together with the staged write. **Discard** resolves it without staging. Validate the current source, candidate revision, and shared file revision before committing. A failed durable write or stale conflict decision must preserve recoverable content and the editor draft. None of these actions removes the version's Dropped assignment.

Consolidate competing unresolved copies automatically when game, language and filepath agree, and their complete preserved snapshots match exactly, including English, translation, variables, remarks, stats and name. Different original archive hashes or source availability alone do not require a choice between identical preserved content: retain the original local copy and its provenance in recovery storage while adopting the active shared copy. Keep assignment provenance, recovery receipts, and any already staged save. Consolidation alone does not stage or approve a dropped translation. An existing reviewed promotion may resume only when the original source hash and availability also agree, using the active shared candidate's current ID/revision and the original shared-file revision guard. Aliases across different source histories require a fresh review before promotion. Different content, a resolved shared candidate, or a saved operation awaiting fresh review still needs an explicit decision.

An explicit history recovery may create a new unresolved generation even when identical text was previously promoted or discarded. Capture one stable `recoveryId` for that user action, retain it through the initial queued upload and retries, and preserve the older resolved generation. Retrying the same action must return its original generation, even after resolution; it must never resurrect it. Another unresolved copy still requires revision-checked conflict resolution. Ordinary migration, imports, peer retargeting, and provenance uploads deduplicate resolved content and must not request a new recovery generation.

## Overlap, Counts, and Filters

Statuses overlap. Revised implies Saved. An intentionally blank save can be Saved and Missing. Dropped can coexist with Missing or with a complete current translation. Diagnostic findings can coexist with any applicable content status, including Unchanged. A file originally assigned Missing or Dropped may remain Saved without Revised after many later corrections; Missing still applies whenever its committed content is incomplete.

Workspace counters count **files**, not entries or actions. Missing, Dropped, Revised, Saved, Error, and Warning count eligible loaded files under **Hide DNT entries**, independent of the search and selected status filters. Loaded counts all loaded files. The pagination/result total counts files that match both the search and selected statuses. Adding overlapping counters does not give the number of distinct files.

Status filters combine with **OR** and never duplicate a file. No selected statuses means no files. Unchanged is the final filter and starts off; the other status filters start selected. The footer order is **Loaded, Missing, Scan errors, Dropped, Scan warnings, Revised, Saved**. Scan counters appear only during a scan or while completed results remain available.

The dropped-conflict warning links to a hidden filter for the selected account, game, source version, and language. Include competing dropped copies and queued promotions awaiting a decision or fresh review, including Saved files without an active Dropped copy. Clear text search on activation and include affected DNT files without changing the Hide DNT setting or workload counts. For files absent from the current source, offer comparison and guarded copy selection without staging or adding them to the loaded-file counts. Exiting this filter restores the normal defaults. Resolve matching files from live conflict and retry state; do not persist a conflict status flag.

## Diagnostic Lifecycle

Manual scans use the selected checks, current language, and Hide DNT eligibility across all loaded files, including files hidden by search or status filters. Scan errors and warnings are separate from automatic editor checks and save guards.

Keep completed scan results and their selected checks while correcting translations. A local save, restore, shared translation update, or consistency correction refreshes affected files and any relevant consistency peers; retain unrelated results. Unsaved draft diagnostics belong to the editor and do not rewrite committed workspace statuses.

Inline focus loss attempts promotion using the full editor's save checks. Errors block promotion; warnings and the existing missing/structural confirmations require explicit acceptance. Declining keeps the draft and its findings below the filepath. Moving into that file's tools or helper popup retains the editing session. Dropped approval, competing copies and comparison-based decisions require the full editor or their existing resolver; inline promotion must never implicitly resolve Dropped.

Changing language, the Dictionary, Hide DNT eligibility, or the imported workspace clears scan results without starting another scan. Translation changes invalidate an unfinished scan. **Stop scan** clears partial results. Clearing or stopping a scan removes its Error/Warning filters' matches and counters; it does not change Missing, Dropped, Revised, or Saved. The scan result list is titled **Files with findings**.

## Persistence, Migration, and Exports

Persist immutable baselines, staged text, dropped snapshots and assignment provenance, and factual metadata/history. Derive status booleans from those records. UI descriptors may cache derived values for rendering, but cached `isMissing`, `isDropped`, `isRevised`, or `hasChanges` values must not become authoritative workspace data.

Saving atomically commits staged text, history, any collaboration outbox, its durable receipt and consumption of the exact associated recovery checkpoint revision. A valid Save does not need to create a private draft first. Inline and full-editor typing still receive compact, per-file local recovery checkpoints; invalid or declined edits remain recoverable. Publish committed UI only after acknowledgement. Newer typing remains a draft; retries reuse the original save identifier. Cross-tab draft conflicts and changed committed bases preserve recoverable drafts and require a new decision. Source/profile changes keep older drafts in their original scope for explicit recovery, without retargeting or uploading them automatically.

Deferred saves first retain a durable submission in their captured account, game, branch, source and language. The editor prepares and paints the destination before dispatching queued work. Reload resumes submissions under their original identity, subject to current scope/access and base guards. Committing a submission removes it in the same transaction as its save receipt. A rejected stale-base or conflicting-draft submission preserves reviewable text and cannot silently overwrite newer work. Network synchronization starts after local acknowledgment; pending submissions remain outside Saved counts and exports.

Older workspaces may use `needsReview`, `trackedForExport`, `hasChanges`, or language status flags. A one-time migration can use that evidence to recover staged work and dropped snapshots in the correct language. Preserve recoverable history and identify unavailable old source text. Historical **Needs Review** labels and older wire compatibility fields may remain; they do not define a new persisted UI status. “Review” remains an action word, not the current status name.

IndexedDB v9 adds separate scoped records for immutable baseline files/assets, workspace metadata, staged files, Dropped recovery, checkpoints, collaboration state/operations, submissions and receipts. Ordinary one-file transactions touch only that file's records. Complete workspace/source/room views are materialized for consumers instead of written back as aggregates. Readiness markers make normalized absence authoritative: deleting staged work must not restore it from a legacy snapshot.

The upgrade retains all earlier stores and freezes old aggregate records as recovery evidence. Conversion runs in resumable, bounded batches; failed or interrupted conversion leaves the scope unready and retains the original content. Preserve source identities, staged presence, history ordering, IDs, receipt signatures, draft variants and Dropped assignment provenance. Do not dual-write old aggregate records or clear storage to bypass a failed conversion.

Open older connections close for the upgrade, and later v4/v5/v6/v7/v8 opens/writes fail with `VersionError`. v4 cannot read staged records; v5 can mistake a shared saved-status reset for a new staged save; v6 Dictionary normalization drops game scope; v7 writers overwrite a single per-game slot and cannot preserve named-version/account isolation; v8 writers can overwrite aggregate state after per-file conversion. Pending older transactions finish before upgrade. Per-game slots retain their owner's default-branch recovery evidence. Dictionary pending requests, save/draft receipts and recovery archives retain their IDs and payloads. A blocked upgrade asks users to close other editor tabs and reload; never clear storage to bypass it. This browser refactor adds no API contract or schema requirement. Existing API compatibility requirements for game-scoped Dictionary and managed storage remain; reload older tabs after frontend rollout.

Legacy migration compares translations after adding the editor's empty placeholders up to the English count. An absent ZIP language block and its display-only blank lines do not create Saved work. Actual legacy save evidence still stages intentional blanks and unchanged text; additional entries are never truncated during this comparison.

On a normal workspace load, a one-time repair can correct old inferred placeholders whose immutable ZIP has no translation block. It requires blank staged text with an empty before snapshot and no authored provenance, timestamps, translation history, save receipts, Dropped assignment, or explicit queued operation. A shared repair also requires evidence of this account's original local join. The workspace and retry state change in one storage transaction, and the original staged record is retained in a recovery archive. Local-only placeholders cease to be Saved; uploaded placeholders stay staged until the API validates and publishes the reset.

The API's `placeholder-repairs` operation requires a verified blank baseline and the requesting account's only file history event: an unchanged first automatic merge at revision 1. It protects later edits, confirmations, imports, Dropped promotions, and deliberate saves, including no-op saves. Historical room mutation receipts without an event are ambiguous and prevent automatic repair. Accepted resets keep the file and immutable history, advance the file revision and room sequence, and propagate `stagingReset` to every current client. Explicit saves after a reset are Saved again. Uncertain cases stay Saved rather than losing potentially intentional work. Deploy this API contract first, then the frontend; reload all older editor tabs. Local test results do not establish hosted correction.

Normal export includes staged **Saved** translations, including intentional blanks and unchanged saves. Full export uses current ZIP/staged data and leaves out an incomplete ZIP translation with an unresolved dropped copy when no staged save exists. Staged saves remain exportable, including intentional blanks; a complete current ZIP translation remains exportable alongside an unresolved dropped copy. Never encode a dropped snapshot as fallback current translation. Exporting does not resolve a copy, clear its assignment, or turn an unsaved draft into Saved.

**Delete staged translation** explicitly removes a staged record for the selected language after confirmation, restoring the immutable ZIP translation without applying draft save checks. Commit the deletion, before/after history, any shared retry operation, and durable receipt atomically. Preserve other languages, local drafts, dropped copies and their assignment provenance. Shared deletion uses a revision-checked reset; concurrent shared edits require a fresh decision, never a partial text merge. A later explicit save stages the file again.

## Examples and Common Misinterpretations

These examples omit independent diagnostic findings:

| Original/current situation | Result |
| --- | --- |
| Complete original ZIP translation; never Dropped here; no save | Unchanged |
| Same file intentionally saved with identical ZIP text | Saved, without Revised |
| Same file saved with different text | Saved + Revised |
| Eligible complete original file saved with a blank line | Saved + Revised + Missing |
| Original ZIP translation Missing; filled and saved, then corrected again | Saved, without Revised |
| Complete current ZIP plus unresolved older copy | Dropped; current text stays the ZIP text |
| Dropped copy confirmed or replaced, then corrected again in the same source version | Saved, without Revised |
| Dropped copy discarded; current complete ZIP then corrected in the same source version | Saved, without Revised |
| New version has complete original text, no Dropped assignment here, and only an unrelated resolved copy from an older version | A changed staged correction can be Saved + Revised |
| Thai staged work exists; Admin selects German with no German work | German statuses derive only from German data |

Do not interpret Revised as “edited twice,” “the previous save was complete,” “any changed Saved file,” or “the translation is complete now.” Do not interpret Saved as “different from ZIP,” “complete,” “uploaded successfully,” or “exported.” Do not hide Dropped merely because current text is complete. Do not use a role's assigned language instead of an authorized Manager/Admin's selected language.
