# Editor Guide
> For Discord user, while reading this guide you can navigate the history using Discord client's history navigation (Alt + Left/Right)

This guide explains how to use the SDEditor to translate game text efficiently.

## Overview

The editor helps you translate game stat descriptions while maintaining formatting, variables, and special tags. It shows you the original English text and lets you work with a Dictionary and Regex system to speed up your translation work.

## Getting Started

### Choosing PoE1 Or PoE2

When SDEditor opens, choose whether you are working on **PoE1** or **PoE2**. Source files, workspace data, and history are separated by version. Both versions use the same Dictionary for the selected language and your personal Regex rules. See [Multi-Version Support](multi_version.md) for storage, migration, and auto-detection details.

### Google Backup and Language Assignment

Open **Settings → Cloud backup → Backup using Google account** to connect personal settings backup and your language's shared Dictionary. A new account shows **Not configured** until the administrator assigns a language through **Manage users**. Local editing remains available while waiting. Other selected languages keep local dictionaries.

Settings and Regex rules are personal; dictionaries are shared among assigned translators. The editor clipboard, source ZIPs, translated files and history remain local. See [Cloud Backup and Shared Dictionaries](cloud_backup.md) for sync status, session renewal, recovery and account switching.

### Importing StatDescriptions.zip

Use the **📦 Import Zip** button in the top left corner to begin import process.
For more details, see the [**Import Workflow**](import_workflow.md).

### File Status Indicators

In the file list, you'll see colors and counters indicating the state of each file:

| Color   | Meaning                                                                                |
|---------|----------------------------------------------------------------------------------------|
| Red     | Missing lines or line count mismatch                                                   |
| Green   | Done and checked                                                                       |
| Yellow  | Review required                                                                        |

| Counter | Meaning                                                                                |
|---------|----------------------------------------------------------------------------------------|
| Missing | Translation has blank lines or doesn't match English line count                        |
| Done    | You've saved changes to this file at least once and are “tracked for export”           |
| Review  | The English source changed since your last save; consider re-checking your translation |

#### What “Missing” Actually Means

“Missing” is calculated from your current translation lines:

- Any blank/empty translation line → Missing
- Different number of lines compared to English → Missing

So it is “missing translation content”, not “missing file”.

### Opening a File

1. Click on any row to open that file in the editor
2. Or use **F2** to open the first file from the current filtered list

### Scanning Diagnostics

If a **⚡ count** button appears before **Scan diagnostics**, it opens shared Dictionary conflicts. Choose local content on the left or remote content on the right for **Alternates** and **TL note**, review the center result, and save it. Independent changes merge automatically. See [Resolve Dictionary Conflicts](cloud_backup.md#resolve-dictionary-conflicts).

Click **Scan diagnostics** to check every loaded file in the selected language, including files hidden by search or filters. Use **Diagnostic warnings only** or **Diagnostic errors only** to narrow the results. Hover over a flagged file for details.

The scan also warns about **inconsistent translations**: when two or more complete English entries are identical but their translations differ, every entry in that group receives a warning. This includes duplicates within one file and across different files. Case, spacing, punctuation, tags, and blank-versus-filled translations count as differences. Equivalent escaped and actual line breaks compare equally. Multiline and table entries are compared as complete entries, including table separators; matching fragments alone do not trigger a warning.

Open a flagged file to see alternative translations with their file paths and entry numbers below the affected block. Warnings update as you edit, and saving or restoring a translation refreshes the scan results for matching entries in other files. Inconsistencies are warnings, so the existing **save anyway** confirmation allows intentional variations. Changing language or importing another workspace clears the previous scan results.

#### Dictionary Terminology

Diagnostics also check the words and phrases in your current **Dictionary**, even when the complete English blocks differ. If a dictionary term occurs in the English, the translation must contain the entry's main **Replace** text or any of its alternate **Replace** texts. Otherwise a warning lists the term and its allowed translations below the affected block and in the scan details.

All alternatives belong to the same allowed set: an alternate does not need to match the current English wording to allow its translation. For example, `Fire → ไฟ` with an alternate `Flame → เปลวไฟ` permits either `ไฟ` or `เปลวไฟ` when English contains `Fire` or `Flame`. An alternate may repeat the main **Find**, or leave **Find** blank when it only supplies another allowed translation. Empty replacements and unfinished entries with no usable translation do not create terminology rules.

Source matching uses literal words and phrases, ignoring case; `Fire` does not match `Firestorm`. Longer overlapping phrases take priority, so a `Fire Damage` entry can define the phrase without also requiring the separate `Fire` translation at that occurrence. Target matching ignores case and whitespace formatting, and supports Thai/CJK wording without spaces. Table columns are checked separately; multiline text is checked within its block.

Keyword tags use their dictionary entry's main **Find** to identify the term and check the translated display text. For example, `[Fire|ผิด]` does not pass just because the identifier `Fire` was preserved or `ไฟ` appears elsewhere. Decoration wrappers and variable identifiers do not count as translated wording. Runtime-generated display text is skipped when it cannot be checked reliably.

Terminology warnings refresh when you edit translations or dictionary alternatives. If a diagnostic scan has already run, dictionary changes automatically refresh it after typing pauses. This is a check for allowed wording, not a word-alignment or occurrence-count check: it does not prove that every word was translated correctly. The separate identical-English check still reports differences between complete translations, even when both use allowed dictionary wording.

## The Editor Interface

The editor shows each string as a block:
- **Top side (English)**: The original text you need to translate
- **Bottom side (Translation)**: Where you type your translation
- **Special items highlighted**: Variables and keyword tags are highlighted in both columns

## Text Elements to Watch

### Variables: `{0}`, `{1}`, etc.

These are placeholders that the game fills in at runtime. They **must** be preserved exactly and in the same quantity in your translation.

**Example:**
```
English:   Deals {0}% more damage
Thai:      สร้างความเสียหาย เพิ่มขึ้น อีก {0}%
```

### KeywordPopups Tags: `[TagName]` or `[TagName|Display]`

These create interactive tooltips in the game. They have two parts:

- **TagName**: The reference to a game KeywordPopups (must stay exactly the same)
- **Display** (optional): What the player sees (you can translate this)

**Example:**
```
English:   Deals {0}% more damage with [HitDamage|Hits]
Thai:      สร้างความเสียหาย [HitDamage|ปะทะ] เพิ่มขึ้น อีก {0}%

English:   Deals {0} to {1} [Fire] Damage
Thai:      สร้างความเสียหาย [Fire|ไฟ] {0} ถึง {1}
```

You can translate `Hits` to your language, but `HitDamage` must stay unchanged.
Sometime the source text use the same display as the tag name, e.g. `[Fire]`, you can translate it to your language by adding the display part yourself, e.g. `[Fire|ไฟ]`.

> 💡 It is recommended to use the **Autocomplete Popup (Ctrl + Space by default, matching VS Code's primary binding)** to insert these tags to speed up your work and ensure consistency.

### Line Breaks: Multi-line Blocks

Some text blocks span multiple lines. Each line follows the same variable and tag rules:

- **Line count must match**: If the English has 3 lines, your translation must have 3 lines too
- **Variable tags must match**: Ensure total number of `{}` variables stay the same across all line as the English version
- **KeywordPopup tags must match**: The same with variable tags

## Status Indicators

The editor shows metadata for each block to help you catch mismatches:

- **Meta lines (TR/EN)**: The number of lines in Translation vs. English
- **Meta vars (TR/EN)**: The number of `{...}` variables in each
- **Meta kw (TR/EN)**: The number of `[...]` keyword tags in each

If the English and Translation numbers don't match, the interface highlights the mismatched lines in red.

## Using the Dictionary and Regex Panels

On the right side of the editor are two helper panels: **Dictionary** and **Regex**. These let you save common translation pairs to speed up your work.

### Opening the Helper Popup

While editing a translation, press the configured shortcut (**Ctrl + Space** by default) or enter a literal ASCII **`[`** (left square bracket) to open a popup showing all available Dictionary replacements. This is called the **Autocomplete Popup**.

SDEditor follows [VS Code's shortcut model](https://code.visualstudio.com/docs/reference/default-keybindings) for every language: **Ctrl + Space** is the primary/default binding and **Ctrl + I** is an optional alternative. Editor shortcuts do not run while any IME—including Japanese, Chinese, and Korean IMEs—is actively composing. **Settings → Autocomplete popup shortcut** can select either binding or **Disabled**; disabling the keybinding does not disable the literal `[` trigger. If the operating system intercepts **Ctrl + Space** before it reaches the browser, select **Ctrl + I**, or use literal `[` from an alphanumeric/direct-input mode.

> **IME punctuation:** Autocomplete reacts to the character committed into the translation, not the physical key. A Zhuyin IME that commits ASCII `[` opens autocomplete after composition ends. Japanese Hiragana normally commits `「` from the same physical key; SDEditor leaves that legitimate punctuation unchanged, so use the configured shortcut or switch temporarily to alphanumeric/direct input for `[`.

> **Upgrade note:** The default key has not changed: it remains **Ctrl + Space**. Existing saved shortcut choices are preserved, while users who have not selected one receive the default above. IME handling is based on the browser's composition state, not the selected translation language.

- Use **↑ / ↓ Arrow Keys** to navigate the list
- Press **Enter** to insert the selected item into your translation at the cursor position
- Type to filter the list as you navigate
- Press **Escape** to close without inserting
- Press **Ctrl + Enter** to jump to the Dictionary entry, or create a new one if it doesn't exist.

> 💡 When you done creating a new Dictionary entry, press **Enter** to quickly insert it back into your translation at the cursor position.

### Alternative Ways to Insert

- **Alt + 1 through 9** / **Alt + 0**: Quickly insert items #1-#10 from the highlighted English text
- **Click an item in the Autocomplete Popup**: Same as pressing Enter

### Dictionary (Word Replacements)

The **Dictionary** tab lets you define how specific terms should be translated.

**Adding a Dictionary Entry:**
1. Click the **+** button below the "Dictionary" heading
2. Enter a word or phrase in the "Find" field
3. Enter the translation in the "Replace" field
4. (Optional) Add a **TL note** explaining the translation; it is shared with the Dictionary when cloud sync is enabled.

**Example Dictionary Entries:**
```
Find: Fire              Replace: ไฟ
Find: Physical          Replace: กายภาพ
Find: increased         Replace: เพิ่ม
```

#### Dictionary Alternatives

Some terms have multiple valid translations depending on context. Use **Alternatives** (click **+** on the right side of Alternates heading) to add context-specific variants:

**Example with Alternatives:**
```
Main:
  Find: HitDamage        Replace: ความเสียหายปะทะ
  
Alternatives:
  Find: Hit              Replace: ปะทะ
  Find: Hits             Replace: การปะทะ
  Find: Hits2            Replace: ถูกปะทะ
```

When you later encounter "[HitDamage|Hit]" in the text, the Autocomplete Popup will show all available replacements, "HitDamage", "Hit", and "Hits" and highlighting the "Hit" as it matches exactly with the source text.

#### Dictionary Notes

Use the **TL note** field to document why a term is translated a certain way or explain its context. Notes appear when you click on the "TL note" field. With cloud sync enabled, these notes are part of the language's shared Dictionary.

Autocomplete Popup will show only Dictionary entries that have the same main definition with the tag name of found keyword.

### Finding Used Dictionary Terms

When you're editing, the **Dictionary** panel automatically shows terms that are used in the current block's English text, highlighted and sorted to the top. This helps you find the right replacements quickly.

**Ctrl+Click on a highlighted English term**: Jump directly to that term in the Dictionary.

### Backing up your Dictionary

Use **Settings → 📤 Export settings** to download the current language's Dictionary, personal Regex rules, preferences and local editor clipboard. Select and export other languages separately when needed. **📥 Import settings** restores a standard settings export and keeps a recovery copy first.

Google backup also synchronizes personal settings and the assigned language's shared Dictionary. It does not upload the clipboard or translation files. See [Cloud Backup and Shared Dictionaries](cloud_backup.md) for first-login restores, recovery archives and conflict resolution.

### Regex (Pattern-Based Replacements)

The **Regex** tab lets you define pattern-matching rules. These are useful for translating complex phrases with variations.

See [Regex Guide](regex_guide.md) for detailed information on how to use Regex replacements.

## Keyboard Shortcuts

### Global Shortcuts
```
| Shortcut          | Action                                        |
|-------------------|-----------------------------------------------|
| F1 / Ctrl + <     | Move to previous file                         |
| F2 / Ctrl + >     | Move to next file                             |
| Ctrl + F          | Focus on search box                           |
```
### In the Main Editor
```
| Shortcut           | Action                                       |
|--------------------|----------------------------------------------|
| Ctrl + Space (default), Ctrl + I (optional), or literal [ | Open Autocomplete Popup |
| Ctrl + S           | Save and open next file                      |
| Escape             | Close the file without saving                |
| Alt + 1-9 / 0      | Insert highlighted item #1-#10 from English  |
```
## Creating/Editing Dictionary Entries from Keywords

When you click on a **keyword tag** (`[TagName|...]`) in the English text, you can:

- **Click**: Insert it into your translation
- **Alt + Click**: Copy it to your clipboard
- **Ctrl + Click**: Either jump to the Dictionary entry for that keyword, or create a new one if it doesn't exist

This is faster than manually typing the keyword in the Dictionary panel.

## Adding New Keywords to Dictionary

If you see a keyword in the English text that isn't in your Dictionary yet:

1. **Ctrl + Click** the keyword in the English text or use the configured shortcut / **`[`** to open the Autocomplete Popup, then press **Ctrl + Enter** while selecting the keyword
2. A new Dictionary entry is created and appears in the Dictionary panel
3. Add your translation in the "Replace" field
4. (Optional) **Enter** to quickly insert it back into your translation at the cursor position.

## Saving Your Translation

**Click the 💾 button** at the top of the editor to save your work, or use:
- **Ctrl + S**: Save the file
- **F1/F2**: Save and open previous/next file

**When you save:**
- Your translation is stored locally in your browser
- A revision/history entry is created (view in the **History** tab on the right)
- Mismatch warnings appear if your translation doesn't match the English version ask you to review before saving
- The "Done" counter updates if this is your first save for this file

## Handling Warnings

### Missing Fields

If any translation line is blank, a warning appears when you save. You can proceed anyway if you're not ready to complete all lines.

### Line Count Mismatch

If the number of lines differs from the English version, a warning appears. This is **not necessarily an error**—sometimes translations need different line breaks. But verify it's intentional before saving.

### Variable Tag Mismatch

If the number of `{}` variables differs, this is usually an **error**. The warning lets you review before saving.

### Keyword Tag Mismatch

If the number of `[]` keyword tags differs, this is usually an **error**. Check that you didn't miss or duplicate any tags.

## Comparing Translations

The **History** panel on the right shows all saved versions of the current file. You can:

- Click a different history entry to compare it with the current version
- Revert to a specific version by clicking on the revert button next to the version entry

## Managing Your Work

### Confirming Unchanged Translations

If the English source was updated but your translation still fits (source typo, etc.), you can manually confirm it hasn't changed:

1. Open the file in the editor
2. Click **"Confirm unchanged"** button (appears when "Review" flag is set)
3. This clears the "Review" flag without requiring you to edit the translation.

> **Note**: All file which haven't been reviewed will **not be exported**, you will have to translate them again next export if you don't confirm them. So it is important to review your translations before exporting.

### Exporting Your Work

Click the **Export** button at the top of the editor to export your work. This creates a ZIP file containing all your translated files `StatDescriptions_Translated.zip` you can submit this file to the same folder as the original files.

**See [import_workflow.md](import_workflow.md)** for more information on exporting your translated files.

## Tips and Tricks

1. **Use the Dictionary early**: Define key terms at the start so you don't have to re-translate them repeatedly.

2. **Use Alternatives for context**: If you have more than one translation for a keyword, create Alternatives to distinguish between them, you can have multiple entries for each keyword by adding number next to the name, e.g. `Hit1`, `Hit2`, etc.

3. **Filter by status**: Use the filter dropdown to show only "Missing", "Done", "Review", or "New" files to focus your work.

4. **Check the History**: Before exporting, check the "Review" filter to verify all your major edits were saved correctly. These are the files that will be discarded if you export them without reviewing.

## What Happens During Import/Export

See [Import Workflow](import_workflow.md) for details on:
- What "Missing" files mean during export
- How "Done" and "Review" flags affect export
- Managing multiple game versions
- How to transfer translations between your PCs

## Bug Reports / Feature Requests

If you encounter any bugs or have feature requests, please post them on the [Bug Reports / Feature Requests thread](#)
