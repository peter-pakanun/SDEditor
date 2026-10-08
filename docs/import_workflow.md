# Import Workflow

This app edits Path of Exile `StatDescriptions.zip` translation files in your browser.

SDEditor supports separate PoE1 and PoE2 workspaces with named source versions. Pick the game on launch, then choose an Online version or the Offline workspace. For identities, retained versions and migration, see [Multi-Version Support](multi_version.md).

## Manager-Published Versions

Managers and Admins open **Versions → Upload next version**, choose the original ZIP, a name and an informational import deadline. Defaults use the current New Zealand date (`YYYY-MM-DD_POE1` or `YYYY-MM-DD_POE2`) and next Monday at 09:00 in `Pacific/Auckland`, including daylight-saving changes. Passing the deadline changes the reminder only; it does not collect work or end editing.

**Upload and prepare** validates and parses the source on the API, reports recoverable repairs/errors, and requests one shared decision for ambiguous duplicate language blocks. Preparation calculates the predecessor comparison for every team before **Publish to all teams** makes the version visible. Publication creates or reuses all 12 language rooms atomically and moves the branch's HEAD. Existing matching-baseline rooms keep their saved work and history. An unfinished previous HEAD produces a warning with an explicit override. Publishing the same raw ZIP hash twice in the same game and branch is rejected.

Select a version to view team progress. **Download original ZIP** supports translators' external tools. **Open editor** starts/continues the selected team's version. Downloaded versions stay available in this browser for offline editing; queued saves retain the selected version's identity.

**Download and mark ended** captures an immutable translated ZIP from server-accepted Saved files and marks that team's window ended after the artifact is ready. Unsaved drafts and pending offline uploads are outside that snapshot. A team without Saved files can be marked ended without downloading an empty ZIP. Downloads use `<version name>_Translated_<language>.zip`. Retrying a collection returns the same snapshot; **Recollect** takes a later one. Managers can download the recorded collection again or **Reopen** the window.

Ended is advisory: opening an editor warns that later saves will not change the already collected ZIP. The dashboard flags changes after collection. A deadline never marks a team ended. **Withdraw** removes an accidental entry from ordinary selection; versions with work, collections or active participants require confirmation and retain rooms/history for reference and recovery. Withdrawing HEAD selects the preceding active version. Withdrawal blocks further shared publication for that version; locally retained work remains recoverable.

## Local Import and Export

There are two different “import” actions and two different “export” modes. They are meant for different situations:

- **Import Next Version**: when you get a new `StatDescriptions.zip` from a game update.
- **Import Translated**: when you want to move your translated work between PCs.
- **Export (:floppy_disk: click)**: exports your **Saved** files. You will use this mode most of the time.
- **Export (:floppy_disk: Ctrl+Click)**: exports current ZIP and staged file data, leaving out an incomplete ZIP translation with an unresolved dropped copy when no staged save exists.

When signed in with access to the selected language, a source import also determines the collaboration workspace. Everyone imports the same original upstream ZIP. Its SHA-256 hash covers the complete archive, including all languages, and is cached with the immutable local baseline. Repacking or changing the ZIP creates a different identity; later local translation edits do not. **Export Version** displays this ZIP hash.

The first accepted import records the ZIP hash, size and file count, importer version, duplicate-language-block choices, and a verification hash for the resulting baseline. Other translators replay those choices against their own copy of the ZIP. These choices are shared across language teams; translation rooms remain separate by game, accepted baseline, and selected language. Translators need access through their assignment; Managers and Admins can select any language. An offline import can make its own choices; reconnecting applies the accepted choices and preserves differing local work for review.

Creating a room from a standalone local import uploads this small import record without uploading the complete ZIP. Manager publication explicitly uploads and stores the original ZIP and complete parsed baseline. Saved, staged files synchronize with their shared history; standalone untouched originals come from each translator's local baseline. Dropped translations synchronize separately with their old English source and entry metadata. They do not become active translations or enter exports until you save a replacement or confirm them unchanged.

**Missing**, **Dropped**, **Saved**, and **Revised** describe the selected translation language and current source version. **Saved** means a staged translation exists, including an intentional blank or unchanged save. **Missing** comes from the current committed ZIP or staged text. **Dropped** means an unresolved dropped copy exists, even when the current ZIP already supplies a complete translation. **Revised** means staged text differs from an already complete original ZIP translation, for a file that has never been Dropped in this source version. These statuses are calculated from the stored content and can overlap.

Completing a file that started Missing, then changing it again, remains **Saved** without **Revised**. Resolving a Dropped file by confirmation, replacement, or discard does not make it eligible for **Revised** in the same source version. A later source import establishes a new original ZIP baseline and version-specific workload. Saving or reviewing Thai does not mark German as Saved or Dropped. Admins and Managers synchronize the selected language regardless of assignment. See the [workspace status contract](workspace_statuses.md) for the full definitions.

Older browser workspaces migrate saved work and recoverable dropped copies once; unavailable old source text is identified in the comparison viewer. Older history records may still use the previous Needs Review label.

Imports automatically repair a quoted translation whose closing quote is stranded on the immediately following line. The repair preserves that line break as literal `\n`, including spaces inside the quote, and reports the affected file and lines. An equivalent manually repaired archive may parse to the same text but has a different ZIP hash. Use the same original archive to collaborate. Ambiguous malformed entries still abort the import rather than guessing at their contents.

**Import Next Version** saves the new source and dropped copies before joining its collaboration workspace. Changed source or a removed upstream translation can drop the previous translation. Each recoverable copy includes its own source for comparison; unresolved copies survive later imports and reloads. Pending saves from an older source remain attached to that old source. **Import Translated** stages translations inside the current source workspace and follows the same durable-save, merge, conflict, and shared-history rules as editor Save. It never changes the source version hash. Signed-out work and Translator work outside its assigned language remain local.

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
- **Full export (Ctrl+Click :floppy_disk:)** includes current ZIP and staged translations. It leaves out an incomplete ZIP translation with an unresolved dropped copy when no staged save exists. Staged saves remain included, including intentional blanks; a complete current ZIP translation can also be exported while its older dropped copy remains unresolved. The dropped snapshot is never encoded.
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
- Dropped copies are excluded from exports and remain stored locally and in the cloud until resolved. Exporting and later version imports do not discard them.
- **Confirm unchanged** stages the dropped translation for the current source. Editing and **Save** stages the replacement instead. Both resolve the dropped copy; **Discard** removes it without staging anything.
- One dropped version is offered per file and language. A concurrent cloud decision is checked before promotion or discard; competing copies produce an actionable conflict.

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
