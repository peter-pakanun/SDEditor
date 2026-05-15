# Editor Guide

This guide explains how to use the SDEditor to translate game text efficiently.

## Overview

The editor helps you translate game stat descriptions while maintaining formatting, variables, and special tags. It shows you the original English text and lets you work with a Dictionary and Regex system to speed up your translation work.

## Getting Started

### Importing StatDescriptions.zip

Use the **📦 Import Zip** button in the top left corner to begin import process.
For more details, see the [Import Workflow](import_workflow.md).

### File Status Indicators

In the file list, you'll see colors and counters indicating the state of each file:

| Color       | Meaning                                                                                |
|-------------|----------------------------------------------------------------------------------------|
| **Red**     | Missing lines or line count mismatch                                                   |
| **Green**   | Done and checked                                                                       |
| **Yellow**  | Review required                                                                        |

| Counter     | Meaning                                                                                |
|-------------|----------------------------------------------------------------------------------------|
| **Missing** | Translation has blank lines or doesn't match English line count                        |
| **Done**    | You've saved changes to this file at least once and are “tracked for export”           |
| **Review**  | The English source changed since your last save; consider re-checking your translation |

#### What “Missing” Actually Means

“Missing” is calculated from your current translation lines:

- Any blank/empty translation line → Missing
- Different number of lines compared to English → Missing

So it is “missing translation content”, not “missing file”.

### Opening a File

1. Click on any row to open that file in the editor
2. Or use **Ctrl + >** to open the first file from the current filtered list

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
English:   {0:+d} to maximum Life
Thai:      พลังชีวิตสูงสุด {0:+d}
```

### KeywordPopups Tags: `[TagName]` or `[TagName|Display]`

These create interactive tooltips in the game. They have two parts:

- **TagName**: The reference to a game KeywordPopups (must stay exactly the same)
- **Display** (optional): What the player sees (you can translate this)

**Example:**
```
English:   Deals {0} to {1} [Fire] Damage
Thai:      สร้างความเสียหาย [Fire|ไฟ] {0} ถึง {1}
```

You can translate "Fire" to your language, but `[Fire]` must stay unchanged.
If the display does not exist, you can create one.

> 💡 It is recommended to use the **Autocomplete Popup (Ctrl + Space)** to insert this tag to speedup and ensure consistency.

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

While editing a translation, press **Ctrl + Space** or **`[`** (left square bracket) to open a popup showing all available Dictionary replacements. This is called the **Autocomplete Popup**.

- Use **↑ / ↓ Arrow Keys** to navigate the list
- Press **Enter** to insert the selected item into your translation at the cursor position
- Type to filter the list as you navigate
- Press **Escape** to close without inserting
- Press **Ctrl + Enter** to jump to the Dictionary entry, or create a new one if it doesn't exist.

> 💡 When you done creating a new Dictionary entry, press **Ctrl + Space** to call the Autocomplete Popup again can speed up your work.

### Alternative Ways to Insert

- **Alt + 1 through 9** / **Alt + 0**: Quickly insert items #1-#10 from the highlighted English text
- **Click an item in the Autocomplete Popup**: Same as pressing Enter

### Dictionary (Word Replacements)

The **Dictionary** tab lets you define how specific terms should be translated.

**Adding a Dictionary Entry:**
1. Click the **+** button below the "Dictionary" heading
2. Enter a word or phrase in the "Find" field
3. Enter the translation in the "Replace" field
4. (Optional) Add a "Note" for your own reference

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

Use the **TL note** field to document why a term is translated a certain way or to remind yourself of context. Notes appear when you click on the "TL note" field.

Autocomplete Popup will show only Dictionary entries that have the same main definition with the tag name of found keyword.

### Finding Used Dictionary Terms

When you're editing, the **Dictionary** panel automatically shows terms that are used in the current block's English text, highlighted and sorted to the top. This helps you find the right replacements quickly.

**Ctrl+Click on a highlighted English term**: Jump directly to that term in the Dictionary.

### Regex (Pattern-Based Replacements)

The **Regex** tab lets you define pattern-matching rules. These are useful for translating complex phrases with variations.

See [Regex Guide](regex_guide.md) for detailed information on how to use Regex replacements.

## Keyboard Shortcuts

### Global Shortcuts

| Shortcut              | Action                                            |
|-----------------------|---------------------------------------------------|
| **Ctrl + >**          | Save and open next file                           |
| **Ctrl + Shift + >**  | Open next file without saving                     |
| **Ctrl + <**          | Save and open previous file                       |
| **Ctrl + Shift + <**  | Open previous file without saving                 | 
| **Ctrl + F**          | Focus on search box                               |

### In the Main Editor

| Shortcut                   | Action                                       |
|----------------------------|----------------------------------------------|
| **Ctrl + Space** or **[**  | Open Autocomplete Popup                      |
| **Ctrl + S**               | Save the file                                |
| **Escape**                 | Close the file without saving                |
| **Alt + 1-9 / 0**          | Insert highlighted item #1-#10 from English  |

## Creating/Editing Dictionary Entries from Keywords

When you click on a **keyword tag** (`[TagName|...]`) in the English text, you can:

- **Click**: Insert it into your translation
- **Alt + Click**: Copy it to your clipboard
- **Ctrl + Click**: Either jump to the Dictionary entry for that keyword, or create a new one if it doesn't exist

This is faster than manually typing the keyword in the Dictionary panel.

## Adding New Keywords to Dictionary

If you see a keyword in the English text that isn't in your Dictionary yet:

1. **Ctrl + Click** the keyword in the English text or **Ctrl + Space** to open the Autocomplete Popup and **Ctrl + Enter** while selecting the keyword
2. A new Dictionary entry is created and appears in the Dictionary panel
3. Add your translation in the "Replace" field
4. (Optional) **Ctrl + Space** to open the Autocomplete Popup again and select the keyword you just created to insert it back into the translation.

## Saving Your Translation

**Click the 💾 button** at the top of the editor to save your work, or use:
- **Ctrl + S**: Save the file

When you save:
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

If the English source was updated but your translation still fits (typo, etc.), you can manually confirm it hasn't changed:

1. Open the file in the editor
2. Click **"Confirm unchanged"** button (appears when "Review" flag is set)
3. This clears the "Review" flag without requiring you to edit the translation.

> **Note**: All file which haven't been reviewed will **not be exported**, you will have to translate them again next export.

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
