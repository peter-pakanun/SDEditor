# Import Workflow

This app edits Path of Exile StatDescription ZIPs and ClientText XLSX/XLSM workbooks in your browser.

SDEditor supports separate PoE1 and PoE2 workspaces with named source versions. Pick the game on launch, then choose an Online version or the Offline workspace. For identities, retained versions and migration, see [Multi-Version Support](multi_version.md).

The version chooser appears as soon as the game is selected. Its Online list loads version metadata without opening a translation workspace. Selecting a row loads that version's team counts and presence separately; cached content stays visible during background refreshes. Translation files, drafts and workspace preparation load when you explicitly open an editor or continue the Offline workspace. A required legacy-storage migration still needs to finish before legacy work can be opened.

## Multi-content versions and ClientText import/export

Managers and admins can view, upload and manage ClientText groups for all 12 languages, with or without an assigned language. Use **Add content group** on the selected version, confirm each workbook's team, then prepare and publish the complete groups. The Assignment table lists every language's groups and offers Open editor, Download, Download and end, previous snapshots and Reopen. Opening a group selects its language and keeps its work and history scoped to that version/group. Translators see only their assigned language's online groups; changing the required workbook-role policy remains admin-only.

A named version is metadata with its own ID. **Add content** accepts any available upstream originals; there is no requirement that the folder contain every file. Keep the upstream folder name, or use the timestamp/game default. Save metadata first when files are not ready. `Missing_XXX.txt` is ignored because the editor computes workload itself.

Choose StatDescription team assignments (all checked by default), and confirm each workbook's detected language and normal/Gender role. ClientText is assigned to that language. French, German, Polish, Portuguese, Russian and Spanish default to exactly one normal and one Gender workbook in the same group; uploading either alone is rejected. Other teams default to one normal workbook. Admins can change the required-role policy, and explicit saved overrides take precedence over these defaults. Original assets and accepted parser identities are immutable; add a new version/group rather than silently replacing their bytes. Older published versions remain one all-team StatDescription group with their existing work/history.

ClientText filenames do not confirm the game. The selected version supplies its game scope; workbook names such as `German.xlsm` and `German_Gender.xlsm` are accepted without a PoE suffix. Exact language names and language prefixes detect the team, and a separate Gender name token detects the role. Confirm those assignments before preparation.

ClientText preparation runs in the browser and reports workbook/sheet progress before publication. Headers map text pairs and Developer notes by name, so a Notes column does not shift translations onto the wrong field. Duplicate IDs within a sheet, ambiguous identities, editable formulas and unsafe merged layouts stop import. Unknown columns and conditional formatting produce reviewable warnings; unknown columns and untouched package parts are retained. Gender metadata accepts any text value without an enum warning, preserving imported whitespace. Missing/Outdated workload uses supported direct solid RGB fills, not evaluated theme/indexed colors or conditional-formatting rules.

ClientText is opened through Online; local workbook imports and cached ClientText entries are not offered in the Offline panel. Online opening verifies original hashes and the accepted parser contract, reuses a matching immutable cache or parses locally, then overlays scoped saved work. Both cold and cached opening use the StatDescription workspace initialization screen with phase progress and retained timings. Trusted publication uploads originals, small descriptors/workload summaries and actual carried work; it does not upload every original ID or construct a Merkle tree. Saves preserve exact cell text and per-field reviews; a new English source retains translation with Outdated review requirements. Competing carried values require a choice; removed records remain in the previous version.

Every ClientText target field accepts blank or whitespace-only values in saves and exports, including ordinary translations, grammatical forms and Gender. Missing and Outdated workload markers do not impose nonblank validation.

New preparations use `clienttext-v4` and accept exports with or without localisation hints. Italic header fonts identify read-only metadata, including `Gender` in hint-rich NPC tables; non-italic headers still use the existing ID/source/translation/form layout rules. Italics take precedence over reserved field names, and expected italic hints do not produce unknown-column warnings. Existing accepted v1/v2/v3 originals retain their parser interpretation and identity. Workbook exports preserve hint cells and header styles while patching only accepted translation targets. New managed preparation/publication requires an API advertising `clienttext-v4`; local offline work needs no API update.

V4 retains v3 support for styled shared-string cells with no value element as blank, preserving their original fills. Present invalid references remain errors. Turkish `BaseItemTypes` supports separate Normal Translation and Possessive Translation forms referencing Display Name. A blank Normal contributes Missing workload when English is active; an unmarked blank Possessive is outside Missing workload, red cells contribute Missing workload, and orange cells retain review requirements. No fallback text is inferred.

Both v2 and v3 recognize `StrFour`, `IntFour`, `DexFour`, `StrDexFour`, `DexIntFour`, `StrIntFour` and their `b` variants as editable form fields attached to the identified English source. Their exact header names establish identity; moving a recognized column retains that identity. Duplicate variants, ambiguous source mappings and formulas in these cells block preparation. Unmarked blank variants remain optional, while direct red and orange marks retain their field workload. Existing v1/v2 groups replay their accepted parser, preserving their baseline identities, field mappings and saved history. In v1, class columns remain metadata. Prepare a new version/group to adopt a newer layout; do not rewrite an accepted baseline. Online v3 preparation/publication requires an API advertising v3 in `clientTextParserVersions`; deploy that API before the frontend. Existing accepted groups and retry requests retain their parser contracts.

Optional content does not break carry-forward. Preparation follows published release ancestors until it finds the last matching workbook group, or the last StatDescription group assigned to each selected team. An intervening release without that content is skipped. Adding content to an older release uses its own ancestry. If that ancestry changes while an upload is prepared, prepare a new upload; retained originals and prior accepted work remain available.

ClientText exports always reconstruct a complete workbook from its original and durably saved values. Unsaved drafts are excluded. Exported workbook names append `_Translated` before their original extension, such as `French_Translated.xlsx` and `French_Gender_Translated.xlsm`. An existing trailing marker is recognised case-insensitively; re-importing and exporting it does not add another. Numeric browser duplicate counters are retained before the marker. Other filename text and extension case are preserved. Paired files download together in `<version name>_<language>_ClientText_Translated.zip`; case-insensitive member-name collisions receive a role label before the marker, keeping both workbooks and Gender detection intact. Input filenames and workbook contents are unchanged by naming. XLSM VBA and untouched workbook parts are preserved without executing macros or recalculating formulas. Export updates target cells and status fills: blank Missing stays red, unresolved Outdated orange, completed original Missing grey, reviewed fields green, and eligible corrections purple. Progress reports the active workbook/sheet and compression phase. Managed downloads use a frozen server-accepted collection; local/pending work is outside that snapshot.

Export also updates each affected sheet's tab from the committed content across that whole sheet. The priority is **red → orange → purple → green → grey → no colour**: remaining Missing, remaining Outdated, eligible saved corrections, reviewed sources, completed Missing work, then unmarked content. Grey is an explicit completion colour, distinct from no tab colour. An ordinary complete original, an unchanged save of that original, and unused optional blank fields do not become grey merely because nothing is missing. Recognised completion fills retained in an original participate in the same priority; other original fills remain formatting and do not imply completed work. Saved nonblank cells no longer retain an obsolete red fill. Unchanged complete saves and unaffected sheets retain their original formatting. Manual diagnostic findings, drafts and MTL suggestions do not determine workbook colours. Older cached workbook headers are supported by deriving the sheet colours from the same original and accepted parser; no source identity or storage migration changes.

Local and frozen collection exports use darker purple and grey status tabs in both XLSX and XLSM. These tab colours follow the UI's purple status and grey completion accents; the cell fills, other tab colours and status priority remain unchanged. Unaffected sheets and exact no-op exports retain their original formatting.

| Worksheet status tab | Previous RGB | Exported RGB |
|---|---|---|
| Purple (Revised) | `#D9D2E9` (217, 210, 233) | `#793BB6` (121, 59, 182) |
| Grey (completed Missing) | `#D9D9D9` (217, 217, 217) | `#626B7A` (98, 107, 122) |

If ClientText export fails, **Copy timings** retains the specific original lookup step, an allowlisted failure code and browser error type, plus retry guidance. Raw error payloads, record IDs and workbook text are excluded from that report; the workspace error retains the exact error message. Repeated preparation/lookup phases cover metadata, Saved records, affected original records and workbook packages. A failure while retrieving originals happens before workbook generation and does not establish a failed Save. **Local workbooks** retain committed edits, source reviews, history and drafts in this browser. Keep a tab open when its checkpoint fails; download its current draft or recovery backup. Reopen existing work under Offline after restart. See [local workbook recovery](clienttext_local_workbooks.md) for browser-data limits and backup restoration. Share the copied report and the workspace error details. Persisted content groups may be reopened and retried independently.

Preparation retains a snapshot of the verified original bytes, so moving the selected file later cannot invalidate a new session's original package. Older open memory sessions may still hold a disk-backed File. If its original becomes unavailable, follow the [memory recovery instructions](clienttext_memory_recovery.md): preserve a JSON snapshot first, then re-export using SHA-256-verified matching originals without resetting the session. This does not require an API update.

## Legacy StatDescription publication and compatibility workflow

This section describes the earlier all-team ZIP publication path and retained versions. Its matching-room reuse and raw ZIP hash uniqueness rules apply to that path. Explicit multi-content groups keep separate version/group work and rooms even when their original ZIPs and accepted baselines match.

Managers and Admins open **Manage version** by clicking the current version name/hash in the status bar, then **Upload next version**. Choose the original ZIP, a name and an informational import deadline. Defaults use the current New Zealand date (`YYYY-MM-DD_POE1` or `YYYY-MM-DD_POE2`) and next Monday at 09:00 in `Pacific/Auckland`, including daylight-saving changes. The Publish deadline controls use New Zealand time; displayed deadlines and timestamps, including tooltips, use your browser's local time. **Edit version details** also reads and saves deadlines in local time. Passing the deadline changes the reminder only; it does not collect work or end editing.

**Upload and prepare** checks the ZIP's game against the selected PoE1/PoE2 game and rejects a mismatch. The API repeats this check before preparation, and publication also rejects mismatched uploads prepared earlier. Select the correct game and start another upload to use that ZIP; there is no mismatch override. The source is parsed on the API, which reports recoverable repairs/errors and requests one shared decision for ambiguous duplicate language blocks. Preparation calculates the predecessor comparison for every team before **Publish to all teams** makes the version visible. Publication creates or reuses all 12 language rooms atomically and moves the branch's HEAD. Existing matching-baseline rooms keep their saved work and history. Every assigned team in every HEAD content group must be Ended before starting or publishing the next version; there is no override. The upload dialog shows the captured predecessor name in a disabled input. Publishing the same raw ZIP hash twice in the same game and branch is rejected.

Click a version row to view team progress. Its **Actions** column contains **Download original ZIP** and manager version controls, with a compact menu in narrower desktop windows. Accounts with one assigned language can open their editor from the version-name link, primary **Open editor** button, or a double-click on the version row. Language-name links and team-row double-clicks open that exact team. Opening a non-HEAD, ended, or withdrawn version asks for confirmation before activating it; cancelling keeps the current workspace and drafts. Downloaded versions stay available in this browser for offline editing; queued saves retain the selected version's identity.

**Download** captures immutable server-accepted Saved content while retaining the team's current open/ended state and latest ending collection. **Download and end** captures the content and ends the team's window after the API verifies the durable snapshot and retained original ZIP. The browser generates the translated ZIP from those inputs; an interrupted download can retry the same collection. Older retained ZIP collections remain downloadable. Unsaved drafts and pending offline uploads are outside either snapshot. A team without Saved files can be marked ended without downloading an empty ZIP. Downloads use `<version name>_Translated_<language>.zip`. Retrying either action returns its same snapshot; **Recollect** takes a later ending snapshot. Managers can download a retained snapshot again or **Reopen** the window.

Ended is advisory: opening an editor warns that later saves will not change the already collected ZIP. The dashboard flags changes after collection. A deadline never marks a team ended. **Withdraw** removes an accidental entry from ordinary selection; versions with work, collections or active participants require confirmation and retain rooms/history for reference and recovery. Withdrawing HEAD selects the preceding active version. Withdrawal blocks further shared publication for that version; locally retained work remains recoverable.

## Local Import and Export

There are two different “import” actions and two different “export” modes. They are meant for different situations:

- **Import Next Version**: when you get a new `StatDescriptions.zip` from a game update.
- **Import Translated**: when you want to move your translated work between PCs.
- **Export (:floppy_disk: click)**: exports your **Saved** files. You will use this mode most of the time.
- **Export (:floppy_disk: Ctrl+Click)**: exports current ZIP and staged file data, leaving out an incomplete ZIP translation with an unresolved dropped copy when no staged save exists.

When signed in with access to the selected language, a source import also determines the collaboration workspace. Everyone imports the same original upstream ZIP. Its SHA-256 hash covers the complete archive, including all languages, and is cached with the immutable local baseline. Repacking or changing the ZIP creates a different identity; later local translation edits do not. The status bar displays the version name, or the shortened ZIP hash when unnamed. Hover over or focus it for the full ZIP hash, baseline identity and version details; clicking opens the version chooser.

The first accepted import records the ZIP hash, size and file count, importer version, duplicate-language-block choices, and a verification hash for the resulting baseline. Other translators replay those choices against their own copy of the ZIP. These choices are shared across language teams; translation rooms remain separate by game, accepted baseline, and selected language. Translators need access through their assignment; Managers and Admins can select any language. An offline import can make its own choices; reconnecting applies the accepted choices and preserves differing local work for review.

Creating a room from a standalone local import uploads this small import record without uploading the complete ZIP. Manager publication explicitly stores the original ZIP separately, with compact affected-file facts and aggregate summaries in SQLite; complete parsed text stays local or is parsed transiently by the API. Saved, staged files synchronize with their shared history; untouched originals come from the verified baseline. Local Dropped recovery stays in the browser and keeps its local version ancestry. Managed source advancement creates separate Shared Dropped copies from the server-recorded predecessor; only those shared copies synchronize their frozen targets and original baseline/file references. Publication may reuse shared edit history without adopting local Dropped copies. A cached online workspace keeps its online identity when disconnected. Old English and entry metadata load on demand from the matching ZIP or verified client cache. Losing historical source leaves the retained target recoverable against the verified current baseline, with manual alignment when needed. Dropped text does not become active or enter exports until you save a replacement or confirm it unchanged. See [ZIP-only SD source storage](sd_baseline_storage.md).

**Missing**, **Dropped**, **Saved**, and **Revised** describe the selected translation language and current source version. **Saved** means a complete staged SD translation exists, including unchanged complete saves. Any blank entry or mismatched entry count blocks the entire translated-file import; existing work stays intact. An original ZIP without the selected language tag shows Missing only; a present incomplete block shows Missing and Error. **Missing** comes from the current committed ZIP or staged text. **Dropped** means an unresolved copy belongs to this workspace's own version chain, even when the current ZIP already supplies a complete translation. **Revised** means staged text differs from an already complete original ZIP translation, for a file that has never belonged to that chain's Dropped workload in this source version. In an online workspace, **Local recovery** remains separately visible and appears in the Dropped filter without changing shared counts, progress or Revised eligibility. These statuses are calculated from stored content and can overlap.

Completing a file that started Missing, then changing it again, remains **Saved** without **Revised**. Resolving a Dropped file by confirmation, replacement, or discard does not make it eligible for **Revised** in the same source version. A later source import establishes a new original ZIP baseline and version-specific workload. Saving or reviewing Thai does not mark German as Saved or Dropped. Admins and Managers synchronize the selected language regardless of assignment. See the [workspace status contract](workspace_statuses.md) for the full definitions.

Older browser workspaces migrate saved work and recoverable dropped copies once; unavailable old source text is identified in the comparison viewer. Older history records may still use the previous Needs Review label.

Imports automatically repair a quoted translation whose closing quote is stranded on the immediately following line. The repair preserves that line break as literal `\n`, including spaces inside the quote, and reports the affected file and lines. An equivalent manually repaired archive may parse to the same text but has a different ZIP hash. Use the same original archive to collaborate. Ambiguous malformed entries still abort the import rather than guessing at their contents.

**Import Next Version** saves the new source and dropped copies before joining its collaboration workspace. A predecessor save identical to the incoming English, translation and metadata is omitted because the new ZIP already contains that work. With unchanged English and changed metadata outside the quoted text, the saved translation uses the new English metadata and stays **Saved**. The import report lists the changed fields; **Metadata updated** beside the file and in the full editor keeps that comparison available. These rules apply separately to every staged language.

Changed English or an incomplete incoming translation with nonblank predecessor text preserves the previous translation as local **Dropped** recovery for a source/translation diff review. This review takes precedence over automatic metadata updates. Removal of an entire filepath is authoritative: it creates no new recovery copy and existing Dropped copies do not carry into that destination. Earlier-version work and history remain with the predecessor. Opening a version also deletes obsolete recovery copies for its removed filepaths once its source has been verified. Unresolved copies for retained filepaths survive later imports and reloads. Reimporting a previously opened version preserves its existing saved work and retains conflicting predecessor text for review. Pending saves from an older source remain attached to that old source.

When both chains have a recovery copy, open the full editor and choose **Local recovery** or **Shared Dropped** in **Recovery copy**. Selection changes the comparison only; **Use for editing** puts that target into a draft. Saving, confirming or discarding resolves only the selected copy. The other copy remains available, including when its text is identical. Importing a local successor does not extend the managed version chain.

The inherited-save cleanup preserves complete explicit unchanged saves, metadata corrections, Dropped resolutions and uncertain legacy work. Browser v19/API v21 additionally quarantine every incomplete SD stage, including older explicit blank saves, with exact scoped recovery evidence. Shared cleanup requires the compatible API first.

**Import Translated** stages translations inside the current source workspace and follows the same durable-save, merge, conflict, and shared-history rules as editor Save. It never changes the source version hash. Signed-out work and Translator work outside its assigned language remain local.

SD staging requires every translation entry to be nonblank and the entry count to match English. One blank rejects the entire translated file, including useful neighboring entries. Immutable originals stay readable: an absent selected-language tag is Missing only, while a present incomplete block shows Missing + Error immediately. Complete every draft entry before saving. New exports and collections require complete included SD language blocks; full export preserves an untouched absent tag without adding an empty block. ClientText permits blank fields.

Selecting an existing named version is activation, not **Import Next Version**. It loads that exact stored snapshot without recalculating assignments. If a manager later publishes the same accepted baseline as a standalone workspace, the app associates it with the online version and reuses the work/drafts/room. Original browser-local history stays local; existing shared history remains in that same room.

## Files You Will See

- `StatDescriptions.zip` (source)
  - The English source + translation blocks.
  - You always import this first for a given version.
  - Full ZIP imports are auto-detected as PoE1 or PoE2. If the ZIP looks like the other version, SDEditor asks before switching.
- `StatDescriptions_Translated.zip` (your work)
  - A ZIP of `.txt` files created by this app.
  - **__Main file to be submitted.__**
  - You can also use this file to share your work or to move it between PCs.

## The Two Export Modes (:floppy_disk:)

```
             +----------------------+
             |       Export 💾      |
             +----------------------+
                 |            |
        Click (normal)      Ctrl+Click (full)
                 |            |
     exports Saved files   exports "Full Set" files
     (staged translations) (current file data only)
```

- **Normal export (click :floppy_disk:)** includes files with **Saved** translations.
  - Main way to submit your work.
- **Full export (Ctrl+Click :floppy_disk:)** includes current ZIP and staged translations. It leaves out an incomplete ZIP translation with an unresolved dropped copy when no staged save exists. Export blocks if an included present selected-language block has a blank entry or a different English entry count. Untouched files without that language tag keep it absent; empty editor fields are not exported as a new translation block. Complete staged saves remain included; a complete current ZIP translation can also be exported while its older dropped copy remains unresolved. The dropped snapshot is never encoded.
  - Good for building a “release” ZIP of everything (take a while to do).

## Common Workflows

### A) Start Translating (First Time on a Version)

```
Get StatDescriptions.zip
        |
        v
Click 📦 Import button
        |
        v
Select 🆕📦 Import Next Version and select StatDescriptions.zip
        |
        v
Do the translations work -> Save in editor
        |
        v
Export 💾 (normal) to produce StatDescriptions_Translated.zip
        |
        v
Submit StatDescriptions_Translated.zip
```

### B) Game Update Arrives (Import Next Version)

Use this when you get a new `StatDescriptions.zip` export (new patch, new data).

```
New StatDescriptions.zip arrives
        |
        v
Click 📦 Import button
        |
        v
Select 🆕📦 Import Next Version and select StatDescriptions.zip
        |
        v
Some files may become "Dropped"
        |
        +-------------------------------+
        |                               |
        v                               v
If translation needs review:        If translation still OK:
(Edit file and Save)                "Confirm unchanged"
        |                               |
        +-------------------------------+
        |
        v
Do the rest of the translations work -> Save in editor
        |
        v
Export 💾 (normal) to produce StatDescriptions_Translated.zip
        |
        v
Submit StatDescriptions_Translated.zip
```

Notes:

- **Dropped** points to a preserved translation awaiting a decision. Open the file to compare the dropped English and translation with the current version. A complete current translation does not hide this status.
- Dropped copies are excluded from exports. Local recovery stays in this browser; Shared Dropped stays in its online chain and browser cache until that copy is resolved. Exporting and later version imports do not discard them.
- **Confirm unchanged** stages the selected dropped translation for the current source. **Use for editing**, corrections and **Save** stage a replacement instead. Both resolve only that selected copy; **Discard** resolves it without staging anything.
- Both local and shared copies can be offered for one file and language, including identical target text. Choose the comparison with **Recovery copy**. Different chains coexist; a concurrent change to the same shared generation still requires a fresh review before promotion or discard.

### C) Move Your Work Between PCs / Share with Others (Import Translated)

This is the “continue on a different computer” workflow.

PC A:

```
Export 💾 (normal)  -> StatDescriptions_Translated.zip
```

PC B / Other person PC:

```
Click 📦 Import button
        |
        v
(If you have not yet imported the current version of StatDescriptions.zip)
Select 🆕📦 Import Next Version and select the same StatDescriptions.zip as PC A
        |
        v
Click 📦 Import button again
        |
        v
Select 🔁📦 Import Translated and select your StatDescriptions_Translated.zip from PC A
        |
        v
Your workspace is now synced with PC A
```

Important:

- Both PCs must use matching source `StatDescriptions.zip` version, otherwise import is blocked for safety.
- Import Translated now also “tracks” imported files for export even if nothing changed, so a normal export on PC B will include the same set of files you exported on PC A (file counts match for transfer ZIPs).

### D) Post-Migration: Restore Translations from Previous Version

If you previously used an older version of `SDEditor` and need to restore your translations:

```
The app detects that you have a previous version data available
        |
        v
A prompt shows: "Attention! Post-migration import required"
        |
        v
Click 📦 Import Previous Version and select the OLD StatDescriptions.zip you used before the version update
        |
        v
Your translations are restored with revision history
        |
        v
Click 📦 Import button
        |
        v
Select 🆕📦 Import Next Version and select the NEW StatDescriptions.zip you just got
        |
        v
Some files may become "Dropped"
        |
        +-------------------------------+
        |                               |
        v                               v
If translation needs review:        If translation still OK:
(Edit file and Save)                "Confirm unchanged"
        |                               |
        +-------------------------------+
        |
        v
Do the rest of the translations work -> Save in editor
        |
        v
Export 💾 (normal) to produce StatDescriptions_Translated.zip
        |
        v
Submit StatDescriptions_Translated.zip
```

- Use **Start from scratch** if you want to discard old data and begin fresh.

## Quick “Which Button Do I Use?”

- You got a fresh `StatDescriptions.zip` from a game update → **🆕📦 Import Next Version**
- You want to continue the same work on another PC → **🔁📦 Import Translated**
- You want to submit your translations → **💾 click**
- You want a bigger “release” export of everything → **💾 Ctrl+Click**
