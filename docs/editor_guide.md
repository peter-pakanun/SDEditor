# Editor Guide
> For Discord user, while reading this guide you can navigate the history using Discord client's history navigation (Alt + Left/Right)

This guide explains how to use the SDEditor to translate game text efficiently.

SDEditor is desktop-first. Use a desktop or laptop browser with a keyboard and mouse or trackpad; mobile phones and tablets are unsupported. This guide covers desktop workflows. See [Platform Support](../README.md#platform-support) for the project scope.

## Overview

The editor helps you translate game stat descriptions while maintaining formatting, variables, and special tags. It shows you the original English text and lets you work with a Dictionary and Regex system to speed up your translation work.

## Getting Started

### Choosing PoE1 Or PoE2

When SDEditor opens, choose whether you are working on **PoE1** or **PoE2**. Source files, workspace data, and history are separated by version. Both versions use the same Dictionary for the selected language and your personal Regex rules. See [Multi-Version Support](multi_version.md) for storage, migration, and auto-detection details.

Click the **PoE1/PoE2** label in the navbar to open **Settings → General → Game version**. Choose the other game and save and close Settings to switch; pending local translation saves finish first.

### Google Backup and Language Assignment

Open **Settings → Cloud backup → Back up with Google** to connect personal settings backup and shared language work. New accounts have the **Translator** role and show **Not configured** until an administrator assigns a language through **Manage users**. Local editing remains available while waiting. Translators can still select other languages in Settings; their dictionaries and translations in those languages stay local.

An administrator can change an account's role between **Translator** and **Manager** in **Settings → Cloud backup → Manage users**. Managers and admins can view and edit shared dictionaries and saved translations in every language, inspect and restore shared history, and read all language teams' comments. Select the language to work in; managers and admins also have a navbar language link that opens its Settings selector. User management remains an admin control.

Settings and Regex rules stay personal to each account. Dictionaries are shared by language; saved translations and new shared history synchronize within the same game, source version, and language. Dropped translations synchronize separately across source versions for that game and language. The editor clipboard, original ZIPs, unsaved typing, and legacy local history stay in this browser. See [Cloud Backup and Collaboration](cloud_backup.md) for sync status, session renewal, recovery, and account switching.

### Settings

Settings is organized into four tabs: **General** for game version, language, theme and density; **Editor & shortcuts** for preview behavior, highlighting and keyboard preferences; **Cloud backup** for account and shared Dictionary controls; and **Data** for importing/exporting settings and starting a workspace from scratch.

**General → Translation language** remains available to every role. Only signed-in managers and admins have a navbar language link. Language dictionaries remain separate, and closing Settings waits for an active language change to finish saving locally.

In **General → Theme**, **Dark** keeps the original dark palette; **Modern Dark** uses the new dark palette.

Click a tab or use **Left/Right Arrow**, **Home**, and **End** while a tab has focus to switch sections. **Save and close**, **Close**, and **Escape** save your preferences before returning to the workspace. First-time setup requires a translation language before you can continue.

### Importing StatDescriptions.zip

Use **Import ZIP** in the main action header to begin the import process.
For more details, see the [**Import Workflow**](import_workflow.md).

### Finding Files and Navigating Pages

The main action header stays visible while you scroll, with labeled controls for exporting, settings, importing, and diagnostic scans. Search the file list by name, English source, or translation using the search field in this sticky navigation bar.

Status filters are hidden by default. Use the filter icon beside search to show or hide them. **Missing translation**, **Saved changes**, **Revised translations**, **Dropped translations**, **Diagnostic errors**, and **Diagnostic warnings** start selected; **Unchanged** is the final option and starts off. Selecting multiple statuses includes files matching **any** selected status. **Clear filters** leaves no statuses selected and shows no files; **Select all** includes every status. Search and the selected status filters work together.

Page navigation and the workspace status counters sit together in a sticky bar at the bottom of the file list. Pagination shows the visible range and matching total (for example, **1–50 of 4,090**) with previous/next arrow buttons. The status order is **Loaded**, **Missing**, **Scan errors**, **Dropped**, **Scan warnings**, **Revised**, **Saved**. Scan counts show files with errors or warnings while a scan runs and after it completes; they disappear when results are cleared or a scan is stopped. **Missing**, **Dropped**, **Saved**, **Revised**, and scan counts describe files eligible under **Hide DNT entries**, independently of search and status choices; **Loaded** covers every loaded file, and the result count describes the files matching your search and filters. **Export Version** shows the current export's short hash; hover to see the full hash. While the hash is being calculated, this spot shows **Hashing…** with a progress indicator.

### File Status Indicators

In the file list, colors indicate each file's state. The bottom navigation bar shows the workspace counters:

| Color   | Meaning                                                                                |
|---------|----------------------------------------------------------------------------------------|
| Red     | Missing lines, line count mismatch, or diagnostic errors                                |
| Orange  | Dropped translations or diagnostic warnings                                            |
| Purple  | Revised an already complete original ZIP translation                                  |
| Green   | Saved changes                                                                          |
| Neutral | Unchanged current translation                                                         |

| Counter | Meaning                                                                                |
|---------|----------------------------------------------------------------------------------------|
| Missing | Current committed translation has blank lines or doesn't match English line count     |
| Saved   | A staged translation exists for this language, including blanks or unchanged confirmations |
| Revised | Saved text differs from a complete original ZIP translation, for a file that has not been Dropped in this source version |
| Dropped | An unresolved dropped copy exists for this file and language, even when its current translation is complete |
| Unchanged | Current translation is complete, with no staged save or unresolved dropped copy      |

These statuses come from the immutable original ZIP, committed staged translations, dropped copies, and diagnostic results. A file can match more than one status. A complete current ZIP translation can still be **Dropped** because an older copy awaits a decision; the older copy stays separate from the current text. Switching language recalculates the statuses for that language. Unsaved typing does not change the workspace counters.

**Revised** identifies corrections outside this source version's Missing or Dropped workload. A file that started Missing stays **Saved** without becoming **Revised**, even after you complete it and edit it again. A file that was Dropped in this source version also stays outside **Revised** after confirmation, replacement, or discard. For an eligible file, saving exactly its original ZIP translation is **Saved** without **Revised**; saving different text is **Saved** and **Revised**. A saved blank can still be **Missing**. See the [workspace status contract](workspace_statuses.md) for examples and the precise scope.

#### What “Missing” Actually Means

“Missing” is calculated from your current committed translation: the staged save, if one exists, otherwise the original ZIP translation.

- Any blank/empty translation line → Missing
- Different number of lines compared to English → Missing

So it is “missing translation content”, not “missing file”.

### Opening a File

Click a row or its filename once to open the file in the editor. A blue indicator on the left marks the selected file.

Source and translation fields appear immediately in the normal editor layout, including tables, multiline text and the preview. The fields stay read-only while highlights and checks are prepared, then become editable in place. **Close** or **Escape** cancels the open while it is loading.

Focus the file list with **Tab** or press **Up/Down Arrow** from a non-input control in the main interface to return to the currently selected row. If no current selection is visible, the first row is selected. From search, **Down Arrow** selects the first visible file; **Up Arrow** returns to the current selection.

In the list, **Up/Down Arrow** selects the previous/next row without leaving the current page or returning to search. **Home/End** selects the first/last row, and **Page Up/Page Down** moves ten rows, stopping at the page's first/last row; these four keys also work from other non-input controls in the main interface. **Right Arrow** opens the next page at its first row; **Left Arrow** opens the previous page at its last row. Page controls use the same first/last selection behavior and retain focus while revealing the selected file. **Enter** opens the selected row. Other text fields, page inputs, select boxes, editable text, and filter checkboxes keep their usual keyboard behavior. **F2** can also open the first file from the current filtered list.

### Scanning Diagnostics

If a **Resolve conflicts** button appears in the main action header, it opens shared Dictionary conflicts. Choose local content on the left or remote content on the right for **Alternates** and **TL note**, review the center result, and save it. Independent changes merge automatically. See [Resolve Dictionary Conflicts](cloud_backup.md#resolve-dictionary-conflicts).

Click **Scan diagnostics** to choose which checks to run. The modal has a checkbox for whitespace, dash spacing, tag syntax, variable tags, keyword popup tags, text decoration tags, inconsistent translations, and Dictionary terminology. Every check starts selected except **Dictionary terminology**. **Start scan** checks every loaded file in the selected language, including files hidden by search or status filters. When **Hide DNT entries** is enabled, DNT files are excluded from all selected checks, including inconsistent-translation comparisons.

The scan modal shows progress followed by **Diagnostic checks**, then **Files with findings** when results are ready. During a scan, the progress bar shows processed files and live warning/error counts, which also appear in the bottom status bar. **Close** or **Escape** lets the scan continue in the background; open **Scan diagnostics** again to return to it. **Stop scan** cancels without keeping partial results. Longer result lists use a visible range and previous/next arrows.

Completed results show warning/error totals and a paginated list of affected files, with entry and column details. Expand additional issues when needed, or click **Open file** to inspect a translation in the editor. Reopening the modal retains the completed results until a workspace change clears them. **Scan again** uses the currently selected checks. The file list's diagnostic warning/error status filters also help you focus on affected files.

The scan also warns about **inconsistent translations**: when two or more complete English entries are identical but their translations differ, every entry in that group receives a warning. This includes duplicates within one file and across different files. Case, spacing, punctuation, tags, and blank-versus-filled translations count as differences. Equivalent escaped and actual line breaks compare equally. Multiline and table entries are compared as complete entries, including table separators; matching fragments alone do not trigger a warning.

Open a flagged file and click **Compare & resolve** below the affected block. The comparison shows the full versions, their file locations and entry counts, and an inline diff. Pick another version from **Compare with** when there are more than two. Changes are highlighted character by character, including Thai text; enable **Show spaces & line breaks** to inspect small formatting differences.

Click **Use this version for all N entries** on either side to save that version to every loaded entry with identical English in the selected language, including matches hidden by filters. Each button shows how many entries and files it will update. Matching drafts are included; unrelated unsaved edits stay in your editor. Invalid tags or a mismatched table column count must be fixed before a version can be applied. Empty versions are labeled explicitly. The workspace and before/after translation history are saved together, so previous saved translations can be restored from each file's **History** panel. A failed save leaves the entries unchanged.

**Inconsistent translations** and **Dictionary terminology** are included only when selected in a manual scan. Opening or editing a file does not run either check. After a scan, opening an unchanged entry shows its saved scan warnings; changing the entry hides those warnings until it is saved or scanned again. Saving, restoring, and receiving shared translation changes refresh the affected files and their consistency peers using the completed scan's selected checks. Applying **Compare & resolve** also refreshes the affected files. Remaining results stay available, so you can fix issues consecutively without rescanning. Editing the Dictionary, changing language or **Hide DNT entries**, and importing another workspace clear previous scan results without starting another scan. Translation changes during an unfinished scan cancel its results. Run **Scan diagnostics** again when you want a new scan. The other editor checks continue to update automatically, and tag errors still prevent saving regardless of the manual scan selection.

#### Dictionary Terminology

Select **Dictionary terminology** in the scan selector to check the words and phrases in your current **Dictionary**, even when the complete English blocks differ. This check is off by default. If a dictionary term occurs in the English, the translation must contain the entry's main **Replace** text or any of its alternate **Replace** texts. Otherwise a warning lists the term and its allowed translations below the unchanged affected block and in the scan details.

All alternatives belong to the same allowed set: an alternate does not need to match the current English wording to allow its translation. For example, `Fire → ไฟ` with an alternate `Flame → เปลวไฟ` permits either `ไฟ` or `เปลวไฟ` when English contains `Fire` or `Flame`. An alternate may repeat the main **Find**, or leave **Find** blank when it only supplies another allowed translation. Empty replacements and unfinished entries with no usable translation do not create terminology rules.

Source matching uses literal words and phrases, ignoring case; `Fire` does not match `Firestorm`. Longer overlapping phrases take priority, so a `Fire Damage` entry can define the phrase without also requiring the separate `Fire` translation at that occurrence. Target matching ignores case and whitespace formatting, and supports Thai/CJK wording without spaces. Table columns are checked separately; multiline text is checked within its block.

Keyword tags use their dictionary entry's main **Find** to identify the term and check the translated display text. For example, `[Fire|ผิด]` does not pass just because the identifier `Fire` was preserved or `ไฟ` appears elsewhere. Decoration wrappers and variable identifiers do not count as translated wording. Runtime-generated display text is skipped when it cannot be checked reliably.

Terminology warnings come from the last manual scan; edit translations or dictionary alternatives and scan again to check the updated wording. This is a check for allowed wording, not a word-alignment or occurrence-count check: it does not prove that every word was translated correctly. The separate identical-English check still reports differences between complete translations, even when both use allowed dictionary wording.

## The Editor Interface

### Working with Other Translators

When signed in with language access, matching game and source versions collaborate automatically. Translators use their assigned language; managers and admins use the selected language and can switch among all language teams. A colored outline marks another translator's selected file; hover over its translation cell to see their name. While they edit, the cell darkens and their Editing badge stays visible. Opening an occupied file asks whether you want to edit alongside them, and the editor shows everyone currently editing it. Names and text remain readable in both themes.

Participant circles appear before the **Show all comments** button and pagination. Their borders match the file-selection colors, and grey initials indicate Away after two minutes without activity or when the tab is hidden. Hover or focus a circle to see its name and status. Returning to the tab or using the keyboard or pointer marks it active again; an away translator's open file is still skipped by automatic navigation.

Only saved changes are shared. In the bottom status bar, the source version appears before the loaded-file count. Both the status bar and editor show only actionable collaboration warnings, errors, and conflicts; healthy sync stays quiet and retries happen automatically. Routine saves do not show pending messages or **Retry sync** buttons. Settings offers **Sync now** only when a sync warning or error needs attention. **Resolve translation conflicts** compares Base, Yours, and Shared for each conflicting translation entry and lets you choose or edit the result. Changes to separate entries merge automatically; multiline and table content within one entry stays together. Closing a conflict dialog preserves unresolved work.

Previous/next editor shortcuts (**F1/F2** and **Ctrl+, / Ctrl+.**) and automatic next-file navigation skip files other translators are editing across the filtered and sorted list. They do not wrap. If there is no eligible file, the view stays in place with a status message. Direct row opens remain available after the occupied-file warning.

The **History** side panel distinguishes browser-local records from **Shared translation history**. Shared history shows who changed a file, when, how, and its before/after translations. A confirmed restore is a new shared change; existing history is retained. Older local history is not uploaded. See [Translation Collaboration](cloud_backup.md#translation-collaboration) for version matching, offline saves, and conflict recovery.

The editor's **Save & close** button captures the current translation and returns to the file list immediately. A background worker finishes saving the translation and its history in this browser; online synchronization follows the local save. You can continue with another file while saving. Reloading or leaving the page prompts a browser warning while local saves or an open draft are unfinished. If a local save fails, a visible warning keeps your captured edits available through **Retry saving** and **Download pending edits**. Keep the tab open until those edits are saved; choosing to leave despite the browser warning can lose unfinished saves. ZIP export, source import, game switching and reset wait for pending local saves. Later sync failures or conflicts appear in the collaboration status. **Close** returns without saving, asking for confirmation when there are unsaved changes. For files opened from the list, both return focus to the selected file. Use the **Small**, **Medium**, or **Large** controls beside **Preview size** to resize the game preview. **Apply regex** fills a translation block using your Regex rules and Dictionary.

The editor shows each string as a block:
- **Top side (English)**: The original text you need to translate
- **Bottom side (Translation)**: Where you type your translation
- **Special items highlighted**: Variables and keyword tags are highlighted in both columns

### Reference Lookup

Select **Lookup**, the second tab beside **Dictionary** in the right pane, to search references while keeping your current file and unsaved translation open. Search filenames, stat identifiers, English, or translations across every file in the loaded source, including files hidden by workspace search and status filters. Results appear after typing pauses briefly; an empty query shows no results, and clearing the query clears the selected reference immediately. Matching query text is highlighted in the result cards; matching stat identifiers appear beneath the file path. Use **Search in** to narrow the search and **Previous / Next** to page through results.

Select a result to read all of its English and translation blocks. Multiline text retains its line breaks, and `@` separates table columns. Reference text can be selected and copied. The **Reference language** selector changes only the lookup language; your editor language and draft stay in place. References use the loaded source and saved translations, so unsaved changes in the current draft appear only in the editor. Lookup works locally without signing in or opening another SDEditor instance.

The search and selected reference remain when you switch side tabs or move to another editor file. The configured search shortcut (**Ctrl+F**, or **Ctrl+D** in Settings) focuses the lookup search while Lookup is selected. **Esc** inside Lookup clears its search. Editor save and next/previous file shortcuts do not run while a Lookup control has focus.

### File Comments

Open a file and select **Comments**, beside **History** in the right pane, to discuss that file. Translators' new comments are visible to their administrator-assigned language by default. Managers and admins can read every language's comments, and their new posts default to the selected language. Check **Post to all languages** to share a post across language teams; the checkbox starts unchecked and resets after posting. Existing comments remain global and show an **All languages** label, as do new global posts. Discussions follow the selected game (**PoE1** or **PoE2**) and file path across source hashes. Importing a new source version therefore keeps its file discussions available; PoE1 and PoE2 discussions remain separate.

Each comment shows its author's name, posting language, and time. A small yellow information icon appears when the comment was posted from a source hash other than the source currently loaded. Hover over it for the **Different version** explanation and full source hash. A translator's assigned language identifies their team even when another editor language is selected; managers and admins post under the selected language. Sign in with an assigned translator account or as a manager/admin to read comments; load a source version to post. Sidebar replies also work for existing discussions whose file is absent from your loaded source.

The API checks your current role and assignment for every cloud request. Removing a translator's assignment stops their cloud access; once the editor receives that denial, it closes shared comment views and stops comment polling. Managers and admins do not need an assignment to access all languages. Changing a role or assignment closes outdated shared history and collaboration connections; downgrading a manager to Translator restricts cloud access to their current assignment. Sign-in, local translations, settings, and unsent comment drafts remain in the browser.

The red numbered badge on **Comments** counts unread comments for the open file. **Show all comments**, between the participant avatars and pagination, has the unread total for the selected game. Click it to toggle the right sidebar containing comments from every file, including files absent from your current source. Comments for the same file share one card with a single file control. Cards are ordered by their newest comment, while comments inside each card run from oldest to newest. A new comment moves its file's card to the top and appears at the bottom of that card. Use the file control to open an available file; **Load older comments** retrieves earlier posts and adds them to the beginning of their file's discussion.

Each sidebar card ends with a single-line **Reply...** input, send icon, and an unchecked **Post to all languages** checkbox. Press Enter or click the icon to post without opening the editor. Replies default to the translator's assigned language or the manager/admin's selected language, including replies in a global discussion, and use the currently loaded source version. Drafts and audience choices are separate for each file and from the full editor's comment box; managers' and admins' drafts also stay separate by selected language. A failed send keeps both for retry. This compact reply control appears only in **Show all comments**.

Unread counts include the Translator's assigned language and global comments, or every language team for managers and admins. Counts exclude your own comments and are saved for your account. Unread comments show a red **Unread** badge immediately before their timestamp in both panels. A comment is marked read when the individual comment is visible in an open comments panel while the browser tab is visible. Opening a panel or viewing its file heading does not mark older, unloaded or off-screen comments read. Scrolling through either panel updates the same unread state and removes the badge after the read is saved.

Comments refresh automatically every 20 seconds while the browser tab is visible, when you return to it, and when connectivity returns. Refreshes preserve the current cards, scroll position, focus, and settled empty states without loading messages or a **Refresh** button. Only actionable sync warnings and errors appear. A failure stays visible until its operation succeeds, and a failed post retains the text you were composing for retry. Explicit actions such as posting a comment, saving, importing, or opening history can still show progress; routine background sync does not show success notices or timestamps.

## Text Elements to Watch

### Variables: `{0}`, `{1}`, etc.

These are placeholders that the game fills in at runtime. They **must** be preserved exactly and in the same quantity in your translation.

Diagnostics also require a `%` immediately after a variable to be preserved: `{1}` and `{1}%` are different forms. Adding or removing the suffix is an error in the scan and editor, and must be fixed before saving. Variables may be reordered, but each variable's plain and percentage occurrence counts must match the English.

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

SDEditor follows [VS Code's shortcut model](https://code.visualstudio.com/docs/reference/default-keybindings) for every language: **Ctrl + Space** is the primary/default binding and **Ctrl + I** is an optional alternative. Editor shortcuts do not run while any IME—including Japanese, Chinese, and Korean IMEs—is actively composing. **Settings → Editor & shortcuts → Open autocomplete** can select either binding or **Disabled**; disabling the keybinding does not disable the literal `[` trigger. If the operating system intercepts **Ctrl + Space** before it reaches the browser, select **Ctrl + I**, or use literal `[` from an alphanumeric/direct-input mode.

> **IME punctuation:** Autocomplete reacts to the character committed into the translation, not the physical key. A Zhuyin IME that commits ASCII `[` opens autocomplete after composition ends. Japanese Hiragana normally commits `「` from the same physical key; SDEditor leaves that legitimate punctuation unchanged, so use the configured shortcut or switch temporarily to alphanumeric/direct input for `[`.

> **Upgrade note:** The default key has not changed: it remains **Ctrl + Space**. Existing saved shortcut choices are preserved, while users who have not selected one receive the default above. IME handling is based on the browser's composition state, not the selected translation language.

- Use **↑ / ↓ Arrow Keys** to navigate the list
- Press **Enter** to insert the selected item into your translation at the cursor position
- Type to filter the list as you navigate
- Press **Escape** to close without inserting
- Press **Ctrl + Enter** to jump to the Dictionary entry, or create a new one if it doesn't exist.

Selecting an autocomplete option shows its Dictionary entry's **TL note** in a separate box beside the popup, when a note exists. Alternate options share their parent entry's note. On narrow screens, the note appears below the popup. The selected option stays visible in the popup, and its matching Dictionary entry scrolls into view in the sidebar without moving keyboard focus.

> 💡 When you done creating a new Dictionary entry, press **Enter** to quickly insert it back into your translation at the cursor position.

### Alternative Ways to Insert

- **Alt + 1 through 9** / **Alt + 0**: Quickly insert items #1-#10 from the highlighted English text
- **Click an item in the Autocomplete Popup**: Same as pressing Enter

### Dictionary (Word Replacements)

The **Dictionary** tab lets you define how specific terms should be translated.

Entries matched in the current file appear first, including matches in table columns. The panel shows 40 entries per page; use **Previous** and **Next** to browse more. Search covers the entire Dictionary, and jumping to an entry from autocomplete opens its page automatically. Large dictionaries use a reusable lookup index, so opening another file does not rebuild every definition.

New entries appear at the top. While editing Dictionary fields, entries stay in place as match highlights update. Moving between Find, Replace, Alternates, and TL note keeps the same order; leaving the entries restores matches-first ordering. An entry being edited stays visible even if its text stops matching the current search.

**Adding a Dictionary Entry:**
1. Click **Add entry** beside the search box underneath the Dictionary tabs
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

Use **Settings → Data → Export settings** to download the current language's Dictionary, personal Regex rules, preferences and local editor clipboard. Select and export other languages separately when needed. **Import settings** restores a standard settings export and keeps a recovery copy first.

Google backup synchronizes personal settings and the translator's assigned language Dictionary or the manager/admin's selected language Dictionary; collaboration also synchronizes saved translations and new shared history for matching source versions. Managers and admins can switch languages to inspect and edit each team's shared work. The clipboard, unsaved typing, and legacy local history are not uploaded. See [Cloud Backup and Collaboration](cloud_backup.md) for first-login restores, recovery archives, and conflict resolution.

### Regex (Pattern-Based Replacements)

The **Regex** tab lets you define pattern-matching rules. These are useful for translating complex phrases with variations.

Use **Add rule** beside the search box underneath the tabs to create a rule.

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
| Ctrl + S           | Save; open next file when enabled in settings |
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

**Click Save & close** at the top of the editor to save your work, or use:
- **Ctrl + S**: Save the file
- **F1/F2**: Save and open previous/next file

**When you save:**
- Your translation is stored locally in your browser
- A revision/history entry is created (view in the **History** tab on the right)
- Mismatch warnings appear if your translation doesn't match the English version ask you to review before saving
- The **Saved** counter updates if this is your first save for this file

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
2. Expand **Compare dropped version → current** to inspect the preserved English source and translation. The dropped translation may be loaded as an editor draft, while the current committed text remains unchanged.
3. Click **Confirm unchanged** to stage the preserved translation for this source version. If the entry layout changed or the draft needs corrections, edit it and **Save** the replacement instead.

Dropped copies do not enter exports. They remain stored locally and in the cloud until you stage a translation or choose **Discard**. Reloading, exporting, and importing later versions do not remove unresolved copies. Older copies without preserved English identify that limitation in the viewer.

### Exporting Your Work

Click the **Export** button at the top of the editor to export your work. This creates a ZIP file containing all your translated files `StatDescriptions_Translated.zip` you can submit this file to the same folder as the original files.

**See [import_workflow.md](import_workflow.md)** for more information on exporting your translated files.

## Tips and Tricks

1. **Use the Dictionary early**: Define key terms at the start so you don't have to re-translate them repeatedly.

2. **Use Alternatives for context**: If you have more than one translation for a keyword, create Alternatives to distinguish between them, you can have multiple entries for each keyword by adding number next to the name, e.g. `Hit1`, `Hit2`, etc.

3. **Filter by status**: Tick **Missing translation**, **Saved changes**, **Revised translations**, **Dropped translations**, or **Unchanged** to focus your work. Combine statuses to show files matching any of them.

4. **Review dropped translations**: Use **Dropped translations** to find preserved work that may still fit the current source. Unresolved copies remain available after export, including when a complete current ZIP translation already exists.

## What Happens During Import/Export

See [Import Workflow](import_workflow.md) for details on:
- What "Missing" files mean during export
- How Saved translations and separate Dropped copies affect export
- Managing multiple game versions
- How to transfer translations between your PCs

## Bug Reports / Feature Requests

If you encounter any bugs or have feature requests, please post them on the [Bug Reports / Feature Requests thread](#)
