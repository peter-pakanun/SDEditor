# Import Workflow

This app edits Path of Exile `StatDescriptions.zip` translation files in your browser.

SDEditor supports separate PoE1 and PoE2 workspaces. Pick the game version on launch before importing. For details, see [Multi-Version Support](multi_version.md).

There are two different “import” actions and two different “export” modes. They are meant for different situations:

- **Import Next Version**: when you get a new `StatDescriptions.zip` from a game update.
- **Import Translated**: when you want to move your translated work between PCs.
- **Export (:floppy_disk: click)**: exports your “tracked / done” files. you will use this mode most of the time.
- **Export (:floppy_disk: Ctrl+Click)**: exports a “full set” of files that are not flagged for review.

When signed in with an assigned language, a source import also determines the collaboration workspace. Everyone imports the same original upstream ZIP. Its SHA-256 hash covers the complete archive, including all languages, and is cached with the immutable local baseline. Repacking or changing the ZIP creates a different identity; later local translation edits do not. **Export Version** displays this ZIP hash.

The first accepted import records the ZIP hash, size and file count, importer version, duplicate-language-block choices, and a verification hash for the resulting baseline. Other translators replay those choices against their own copy of the ZIP. These choices are shared across language teams; translation rooms remain separate by game, accepted baseline, and assigned language. An offline import can make its own choices; reconnecting applies the accepted choices and preserves differing local work for review.

Creating a room uploads this small import record without uploading the original translations. Only files marked **Edited** enter synchronization. Carried translations marked **Needs Review** remain personal until you save them or confirm them unchanged. The server keeps saved changes and their shared history; untouched originals come from each translator's local baseline.

Imports automatically repair a quoted translation whose closing quote is stranded on the immediately following line. The repair preserves that line break as literal `\n`, including spaces inside the quote, and reports the affected file and lines. An equivalent manually repaired archive may parse to the same text but has a different ZIP hash. Use the same original archive to collaborate. Ambiguous malformed entries still abort the import rather than guessing at their contents.

**Import Next Version** saves the new source and local carry-forward work before joining its collaboration workspace. Pending changes from an older source remain attached to that old source. **Import Translated** changes saved translations inside the current source workspace and follows the same durable-save, merge, conflict, and shared-history rules as editor Save. It never changes the source version hash. Signed-out or unassigned-language work remains local.

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
     exports "Done" files   exports "Full Set" files
     (tracked for export)   (All file except needs Review)
```

- **Normal export (click :floppy_disk:)** includes files marked **Done**.
  - Main way to submit your work.
- **Full export (Ctrl+Click :floppy_disk:)** includes all files except those that need review.
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
Some files may become "Review"
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

- “Review” is used when the app had to carry forward older translation lines (because the new source didn’t provide them). It’s a warning that the English changed and you should verify the translation still makes sense.
- If you do an export while there're still some “Review” left, those translated strings will be discarded.
- When you “Confirm unchanged”, the app clears Review and marks the file as Done so you can export it.

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
Some files may become "Review"
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
