# Workflow Guide (For Translators)

This app edits Path of Exile `StatDescriptions.zip` translation files in your browser.

There are two different “import” actions and two different “export” modes. They are meant for different situations:

- **Import Next Version**: when you get a new `StatDescriptions.zip` from a game update.
- **Import Translated**: when you want to move your translated work between PCs.
- **Export (💾 click)**: exports your “tracked / done” files.
- **Export (💾 Ctrl+Click)**: exports a “full set” of files that are not flagged for review.

## Files You Will See

- `StatDescriptions.zip` (source)
  - The English source + translation blocks.
  - You always import this first for a given version.
- `StatDescriptions_Translated.zip` (your work)
  - A ZIP of `.txt` files created by this app.
  - Used either to share your work or to move it between PCs.

## The Three Status Counters

In the top bar you’ll see:

- **Missing**: translation is incomplete for the current language (blank lines or line-count mismatch).
- **Done**: the app considers this file “tracked for export”.
- **Review**: the English source changed and you should re-check the translation.

### What “Missing” Actually Means

“Missing” is calculated from your current translation lines:

- Any blank/empty translation line → Missing
- Different number of lines compared to English → Missing

So it is “missing translation content”, not “missing file”.

## The Two Export Modes (💾)

```
             +----------------------+
             |       Export 💾      |
             +----------------------+
                 |            |
        click (normal)   Ctrl+Click (full)
                 |            |
     exports "Done" files   exports "Not Review" files
       (tracked for export)   (Review flag is OFF)
```

- **Normal export (click 💾)** includes files marked **Done**.
  - Good for sending only the files you are actively working on (smaller ZIP).
- **Full export (Ctrl+Click 💾)** includes files that are **not** marked Review.
  - Good for building a “release” ZIP of everything you’ve reviewed.

## Common Workflows

### A) Start Translating (First Time on a Version)

```
Get StatDescriptions.zip
        |
        v
Pick language in Settings (⚙️)
        |
        v
Click 📦 Import button and select StatDescriptions.zip
        |
        v
Edit files -> Save in editor
        |
        v
Export 💾 (normal) to produce StatDescriptions_Translated.zip
```

### B) Game Update Arrives (Import Next Version)

Use this when you get a new `StatDescriptions.zip` export (new patch, new data).

```
New StatDescriptions.zip arrives
        |
        v
Click 📦 Import and select it
        |
        v
A dialog appears with two options:
   - 🆕📦 Import Next Version (normal import)
   - 🔁📦 Import Translated (restore previous work)
        |
        v
If using Import Next Version, some files may become "Review"
        |
        +-------------------------------+
        |                               |
        v                               v
Open file and edit + Save        If translation still OK:
(clears Review)                  "Confirm unchanged"
```

Notes:

- “Review” is used when the app had to carry forward older translation lines (because the new source didn’t provide them). It’s a warning that the English changed and you should verify the translation still makes sense.
- If you do an export while there're still some “Review” left, those translated strings will be discarded.
- When you “Confirm unchanged”, the app clears Review and marks the file as Done so you can export it.

### C) Post-Migration: Restore Translations from Previous Version

If you previously used a different version of `StatDescriptions.zip` and need to restore your translations:

```
You notice your translations are missing but workspace data exists
        |
        v
A prompt shows: "Attention! Post-migration import required"
        |
        v
Click 📦 Import Previous Version and select the OLD StatDescriptions.zip you used before
        |
        v
Your translations are restored with revision history
```

- **Import Previous Version** is for when you switched game versions and want to recover your old translation data.
- Use **Start from scratch** if you want to discard old data and begin fresh.

### D) Move Your Work Between PCs (Import Translated)

This is the “continue on a different computer” workflow.

PC A:

```
Export 💾 (normal)  -> StatDescriptions_Translated.zip
```

PC B:

```
Click 📦 Import and select the current StatDescriptions.zip version
        |
        v
Dialog appears - Click 🔁📦 Import Translated
        |
        v
Select your StatDescriptions_Translated.zip from PC A
        |
        v
Continue translating, then Export 💾
```

Important:

- Both PCs must use the matching `StatDescriptions.zip` version, otherwise import is blocked for safety.
- Import Translated now also “tracks” imported files for export even if nothing changed, so a normal export on PC B will include the same set of files you exported on PC A (file counts match for transfer ZIPs).

## Quick “Which Button Do I Use?”

- You got a fresh `StatDescriptions.zip` from a game update → **🆕📦 Import Next Version**- You need to recover old translations (post-migration) → **📦 Import Previous Version**- You want to continue the same work on another PC → **🔁📦 Import Translated**
- You want to export only what you’re working on → **💾 click**
- You want a bigger “release” export of everything reviewed → **💾 Ctrl+Click**

