# Import Workflow

This app edits Path of Exile `StatDescriptions.zip` translation files in your browser.

SDEditor supports separate PoE1 and PoE2 workspaces. Pick the game version on launch before importing. For details, see [Multi-Version Support](multi_version.md).

There are two different “import” actions and two different “export” modes. They are meant for different situations:

- **Import Next Version**: when you get a new `StatDescriptions.zip` from a game update.
- **Import Translated**: when you want to move your translated work between PCs.
- **Export (:floppy_disk: click)**: exports your “tracked / done” files. you will use this mode most of the time.
- **Export (:floppy_disk: Ctrl+Click)**: exports a “full set” of files that are not flagged for review.

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
