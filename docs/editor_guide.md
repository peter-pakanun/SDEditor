# Editor Guide
> For Discord user, while reading this guide you can navigate the history using Discord client's history navigation (Alt + Left/Right)

This guide explains how to use the SDEditor to translate game text efficiently.

SDEditor is desktop-first. Use a desktop or laptop browser with a keyboard and mouse or trackpad; mobile phones and tablets are unsupported. This guide covers desktop workflows. See [Platform Support](../README.md#platform-support) for the project scope.

## Overview

The editor helps you translate StatDescription and ClientText content while maintaining formatting, variables, and special tags. It shows the original English and provides terminology, lookup and Translation Memory assistance.

Workspace errors, warnings and persistent notices appear beneath the workspace navigation or above the full editor's preview. Long stacks scroll within their own area, keeping Save, Dictionary, TM and other tools accessible. Focus a scrollable notice area to use the arrow, Page Up/Down, Home and End keys. Recovery and retry buttons remain beside the relevant message.

## Getting Started

### Choosing PoE1 Or PoE2

When SDEditor opens, choose whether you are working on **PoE1** or **PoE2**. Source files, workspace data, and history are separated by version. Dictionary and TM stores belong to the selected language, with game scope on their entries. Personal legacy Regex backups are retained. See [Multi-Version Support](multi_version.md) for storage, migration, and auto-detection details.

Click the current version name in the bottom status bar to choose a source; an unnamed local import shows its shortened source hash instead. The full editor offers the same control beside **Translation**. Hover over or focus the name for the full source identity, deadline and window details. **Online** lists manager-published versions with HEAD first. Click a row to view its details. If your account has access to one language, the version-name link, primary **Open editor** button or a double-click on the row opens that team's editor. Managers/Admins select a version, then click a language-name link or double-click its team row to open that language's editor. Ended versions and teams show an **Ended** badge beside their names, and a catalog version shows Ended for Managers/Admins once every team has ended. A version downloaded into this browser remains available while disconnected. **Offline** continues stored StatDescription workspaces, allows a local version name, and offers next/update and translated ZIP imports for an existing local workspace. Initial previous-version imports and local ClientText imports are not offered. Open ClientText through **Online**; cached ClientText workbooks are not listed under Offline. Selecting a stored version preserves its own work and history without reimporting it or recalculating Dropped assignments.

Opening a version shows **Initializing workspace** while the local source, saved translations, Dictionary and cached shared work are prepared. Its terminal-style activity box keeps completed steps above the current work and shows each step's elapsed time, such as `(3.4s)`, plus the total time. The same activity log covers local storage updates, local account restoration and ZIP imports. Session checks, shared reconciliation, queued uploads and refreshed version details run after the local workspace opens. A first source download still needs a connection. Connection failures retain an actionable warning and queued work for automatic retry; they do not hold the local editor behind Initialization.

An import deadline is a reminder and appears after **Saved** in the bottom status bar. Passing it does not end editing. When a manager collects your team's Saved work and marks it ended, opening the editor warns that new saves will not change the already collected ZIP. You can continue after confirming. The version name retains its Ended or Withdrawn badge and detailed tooltip while working. Unsaved drafts and pending offline uploads are excluded from the manager's collection; synchronize saved work before collection when you want it included.

Click the **PoE1/PoE2** label in the navbar to open **Settings → General → Game version**. Choose the other game and save and close Settings to switch; pending local translation saves finish first.

Use each Dictionary entry's **PoE1 / PoE2 / All** selector to choose where it applies. New entries start as **All**. Change **Settings → Editor & shortcuts → Default game version for new Dictionary entries** to **All**, **PoE1**, or **PoE2**; this personal preference applies to manual and autocomplete creation. Existing entries and added alternates keep their entry's game version. You can repeat a Find or keyword identifier in separate game entries. The current game's entry takes priority over an All entry with the same Find, including its alternates; All is the fallback when that game has no specific entry. Other-game entries stay visible and editable with a yellow warning, but do not appear in autocomplete or move to the top when matched. They also do not supply highlights, keyword replacements or terminology rules.

### Google Backup and Language Assignment

Open **Settings → Cloud backup → Back up with Google** to connect personal settings backup and shared language work. New accounts have the **Translator** role and show **Not configured** until an administrator assigns a language through **Manage users**. Local editing remains available while waiting. Translators can still select other languages in Settings; their dictionaries and translations in those languages stay local.

An administrator can change an account's role between **Translator** and **Manager** in **Settings → Cloud backup → Manage users**. Managers and admins can view and edit shared dictionaries and saved translations in every language, inspect and restore shared history, and read all language teams' comments. Select the language to work in; managers and admins also have a navbar language link that opens its Settings selector. User management remains an admin control.

Settings and legacy Regex backups stay personal to each account. Dictionaries and TM are shared by language, with game scope on their entries. Saved translations and new shared history synchronize within the same game, branch, source version, and language. Shared Dropped copies synchronize within their managed version chain; local Dropped recovery stays in this browser and is offered separately. The editor clipboard, unsaved typing and legacy local history also stay in this browser. Standalone imports keep their ZIP/baseline local; manager-published versions explicitly store the ZIP and compact verified metadata on the server for authorized teams. See [Cloud Backup and Collaboration](cloud_backup.md) for sync status, session renewal, recovery, and account switching.

### Settings

Settings is organized into five tabs: **General** for game version, language, theme and density; **Editor & shortcuts** for preview behavior, highlighting and keyboard preferences; **Cloud backup** for account and shared Dictionary controls; **Data** for importing/exporting settings and starting a workspace from scratch; and **Logs** for viewing and copying the latest workspace initialization activity.

**Editor & shortcuts → Hide clipboard** is enabled by default. Turn it off to show the full editor's clipboard panel. Hiding it preserves its text and gives the sidebar more space; the preference is saved with your personal settings.

**Logs → Copy log** copies the initialization steps, errors and elapsed times after loading finishes. You can also select the log text and copy it with your keyboard. The log remains available in this tab until the next initialization starts or the tab reloads.

During **Initializing workspace**, the overall bar tracks the planned preparation steps. Downloads, parsing, baseline verification and file preparation show measured progress with byte or file counts where available. A moving bar means the total is not yet known. Overall percentages describe preparation steps, rather than estimated time remaining; the bar reaches 100% after preparation finishes. Progress is also retained in **Logs**.

**Hide DNT entries** hides the entire file when any English block starts with `[DNT` or `DNT `, even if its first block has no marker. Hidden DNT files are also excluded from workload counters and manual diagnostic scans.

**General → Translation language** remains available to every role. Only signed-in managers and admins have a navbar language link. Language dictionaries remain separate, and closing Settings waits for an active language change to finish saving locally.

In **General → Theme**, **Dark** keeps the original dark palette; **Modern Dark** uses the new dark palette.

Click a tab or use **Left/Right Arrow**, **Home**, and **End** while a tab has focus to switch sections. **Save and close**, **Close**, and **Escape** save your preferences before returning to the workspace. First-time setup requires a translation language before you can continue.

### Importing StatDescriptions.zip

Use **Import ZIP** in the main action header to begin the import process in a workspace opened from the Offline panel. It stays enabled even when the same source hash belongs to a published Online version. The button is disabled when you open the workspace through Online, including cached Online work while disconnected; these use the manager-published ZIP. Open the version chooser and select the Offline workspace to use local ZIP imports.
Use **Versions** and its Assignment table to switch between the groups in a published version.
For more details, see the [**Import Workflow**](import_workflow.md).

### ClientText worksheets

Select a ClientText group and language from Versions, or import its workbooks locally. ClientText uses the same workspace toolbar, status filters, file table, footer and editor-tool tabs as StatDescription. The file list's left pane selects a worksheet. Sheets act as paths, record IDs as filenames, and each source/translation pair as an editable block. Search includes ID, sheet, source, current translation and Developer notes. Notes remain visible for translators and are preserved in the workbook.

Every ClientText field can be saved and exported blank or whitespace-only, including ordinary translations, Normal, class variants and Gender. Missing and Outdated indicate workload or review; they do not block blank saves.

Opening a workbook uses the same workspace initialization screen as StatDescription. First opening reports original download, workbook/sheet parsing, local caching and editor preparation. Later openings reuse the cached parsed workbook and load that version's independent saved work. Initialization timings remain available in Settings. Saving translations does not invalidate the original cache.

ClientText uses the same default filters as StatDescription: Missing, Saved, Revised, Outdated and diagnostic errors/warnings start selected; **Unchanged** starts off. Unsaved work retains its committed status and has no separate badge, counter or filter. Use the shared Filters control to narrow the list.

**Settings → Editor & shortcuts → Inline editor** applies to both content modes. When enabled, clicking a ClientText row shows English beside its editable translation in the table cells; click its ID to open the full editor. When disabled, clicking the row opens the full editor directly. **Close** or Escape returns to the table and keeps the record's draft. Dictionary, Lookup, TM and Comments use the familiar editor tools sidebar.

Each English and translation field includes a slim toolbar inside its border. After the separator, the history icon shows or hides the reference selector **→ Latest** underneath the field; the settings cog sits at the far right. Active icons use the theme's accent color. English uses the currently open version's immutable source; translations compare against the live draft below the editable field. Source comparison opens automatically for meaningful, unresolved Outdated changes when the earlier original is available. Missing alone and audio-marker-only changes do not open it. Closing a comparison keeps it closed through saves and transitions between inline and full editing. The settings menu loads earlier versions and older history, offers whitespace/character options, and shows revision details, including removed fields and developer notes. **Restore before/after** requires confirmation and creates a saved revision of the whole record.

The translation toolbar's **B**, *I* and underlined U buttons show which styles enclose the caret or selected text. Activating a style wraps the selection in `<b>{text}`, `<i>{text}` or `<u>{text}`; an empty selection inserts an empty wrapper with the caret inside. Toggling an active style removes its innermost wrapper and selects the entire affected text, preserving other nested tags. Toggling again reapplies the style to that selection. If the same style is nested more than once, it stays active while an enclosing wrapper still applies. **Ctrl+B**, **Ctrl+I** and **Ctrl+U** use the same behavior; ClientText uses **Ctrl+Space** for manual completion when the legacy Ctrl+I completion setting is selected. Undo/Redo restores formatting selections and raw newline text. Source toolbars show the same style buttons disabled; Gender metadata has no formatting actions. Formatting changes a draft and follows the regular save and diagnostic rules.

ClientText uses the same game preview above the full editor and in the inline **Preview** tab. Focus a translation field to preview its English and target text, including grammatical forms. Variable inputs substitute `{}` and numbered/formatted placeholders in both languages. Bracket keywords show their display text with the same underline and tooltip. Actual newlines and escaped `\n` both render as line breaks; consecutive breaks preserve blank lines. Preview never changes cell text: the original `@`, escaped `\n`, actual newlines and formatting tags are preserved when saving or exporting. Use **Versions** and its Assignment table to switch content groups.

In the ClientText full editor, previews place English on the left and translation on the right, filling their panes with independent scrolling; grammatical variants share the translation pane. This layout has no preview-size controls. Inline previews and StatDescription previews keep English above translation.

In either full editor, drag the small center handle below the preview to adjust the top pane's height. The pane can shrink below its default height and grow to half the window height. Its height is remembered in your settings. Focus the handle and use **Up/Down** to adjust it, or **Home/End** for the minimum/maximum.

Both content modes render `i`/`italic`, `b`/`bold`, `u`/`underline`, named colors, `colour:`/`color:`, `rgb(...)`, and `fg:rgb(...)` in the preview. Nested styles combine on text, variables, and keyword display text; an inner color overrides its parent until the inner wrapper ends. StatDescription uses double-brace wrappers, while ClientText also accepts single-brace wrappers. Unrecognized modifiers and unsupported conditional language controls remain visible. Formatting affects the preview only: saving and exporting retain the original tags.

The ClientText **Dictionary** tab has the shared search, Add entry, pagination, Find/Replace, alternates, game scope, TL note, delete and shared-history controls. Matching entries appear first; search also includes alternates and notes. Find/Replace and alternate fields use the same single-line inputs and compact rows as StatDescription in both inline and full editors; TL notes accept multiple lines. Ctrl+Enter (Command+Enter on macOS) from a Replace field inserts its exact text at the focused translation's retained caret or replaces that translation's selected text. After jumping to an entry from autocomplete, plain Enter inserts the replacement and returns to that captured translation field. This creates a draft; Save remains a separate action.

Source and translation fields share StatDescription's highlighting and autocomplete popup, including its filter and separate TL note. Selecting a popup option highlights its associated English tags and Dictionary row. Enter inserts an existing exact replacement; for a missing keyword or alternate, it creates or opens the corresponding Dictionary field first. Enter from that Replace field inserts the full translated tag at the captured caret or selection and returns focus to the translation. **Ctrl+Enter** while autocomplete is open edits the selected entry or adds its missing alternative. Click a highlighted English item to insert its replacement, **Alt+Click** to copy the raw item, or **Ctrl+Click** to open its Dictionary entry. **Alt+1–9 / Alt+0** inserts highlighted items 1–10. Dictionary updates preserve the active draft, caret and open popup's captured suggestions; the next popup uses the refreshed Dictionary.

Gender metadata uses an editable combo box, including when the normal workbook has a Gender column. Suggestions depend on the selected language: Russian offers MS/FS/NS/MP/FP/NP/M; other teams retain M/F/N/MP/FP/NP. Any text value is accepted, custom original values remain available, and exact whitespace is retained. Multiline Gender values use a textarea to preserve their line breaks; pasting multiline text or pressing **Shift + Enter** switches to that control and keeps the caret. Gender text forms use M/F/N rows with Singular/Plural columns (MS/FS/NS and MP/FP/NP). `NONEXISTENT` completion replaces a whole eligible form cell after typing a prefix and pressing Tab. It is not a prose or Gender suggestion.

Turkish item names show Normal and Possessive rows with one Translation column in both inline and full editors. Both forms share the displayed English and retain separate values, reviews and history. A blank Normal is Missing when English is active. Unmarked blank Possessive forms stay outside Missing workload; red blanks are Missing, and orange blanks remain Outdated without becoming Missing. These forms do not offer `NONEXISTENT` completion or its diagnostic exemption, and blank Possessive values remain blank in saved work and exports.

Their **Game preview** shows three Turkish versions together: **Normal**, **With prefix**, and **With prefix + suffix**. Prefix-only names use Normal; names with both affixes use `Suffix + Prefix + Possessive`, falling back to Normal in the preview when Possessive is blank. Editable **Prefix** and **Suffix** parameters sit beside the `{…}` variable inputs. The **Example** selector offers `Dayanıklı / Alev` and `Korkusuz / Ölümsüzlük`; Emerald entries start with the second pair. The preview also evaluates `<if:possessive>{Yüce Küresi}<else>{Yüce Küre}` for each version, including Turkish text fields using this control without separate form columns. Preview parameters survive switching between inline and full editors and reset for another entry. They do not edit or save the translation.

Class variants such as `StrFour`, `DexIntFour`, and their `b` variants share the row's English source. Both editors show populated variants as tabs and offer **All variants** for every recognized worksheet column, including blank cells. Only the selected variant's textarea is expanded. Default MS/FS forms remain visible in both editors. Opening a record by click, double-click, or Enter focuses its first editable worksheet cell. **Settings → Editor → Show class names for ClientText variants** is enabled by default: labels use the English Name from the loaded workbook's **Characters** sheet (for example, `DexFour` becomes `Ranger`, and `DexFourb` becomes `Huntress`). The selector and tooltips retain the original variant ID; absent or ambiguous names fall back to that ID. Turning the setting off shows the original IDs everywhere. This changes display labels only; workbook data, fields, saves and exports retain their original identities. Red-marked blank variants show Missing; unmarked unused blanks stay outside Missing workload. Every field is saved together, including variants outside the current view.

ClientText **Tab** and **Shift + Tab** follow editable cells in their original worksheet column order in both editors, including Gender and optional forms, while skipping hidden blank-English fields. Navigation selects the destination class variant automatically. Six-form navigation is MS → FS → NS → MP → FP → NP, even though the grid groups Singular and Plural visually. In the full editor, field review and choice buttons remain reachable after the cells. Inline navigation continues into the next record's first cell or the previous record's last cell, following the current sort and filters and skipping occupied records. At the list ends it stays in place. **Ctrl + Up/Down** uses the same inline record navigation. **Ctrl + Enter** opens the full editor at the current field when autocomplete is closed; **Escape** returns to that exact inline field and caret, keeping the draft. A first Escape dismisses autocomplete; Escape in the inline editor ends editing and keeps its local draft.

ClientText places English on the left and translation on the right in both full and inline editors. The full editor keeps Save, Save & close and Close together beside the heading. **Discard draft** appears only for a draft blocked by unresolved alternatives or a failed save/checkpoint. Ordinary field pairs share their height, and inline blocks stay aligned when notes, wrapped text, review controls, or form grids change their height. Inline fields use compact textareas that expand with their content, without repeated field names or language labels. Inactive list previews show up to three lines; hover to read their full text or open the record to edit it. Populated **Context**, **Character** and **Character Class** columns appear as selectable, read-only references in both editors and in the selected Lookup reference. When a character path matches an ID in this workbook group's **Characters** sheet, its immutable English **Name** appears instead. Hover or focus the name to see the full original path, English name, workbook role and source cell in the shared tooltip. Unmatched or ambiguous paths remain visible as raw text, and line breaks remain intact. Developer notes remain visible separately. Other workbook columns are preserved internally and in downloads. The form grid uses its row and column headings to identify cells; optional blanks use an **Optional translation** placeholder.

The main list shows populated Context metadata beneath every record's filename, including unselected rows. It uses the available English/translation row height, with room for at least one metadata entry. Scroll inside the Context area to read additional entries; focus it to scroll with the keyboard.

Text fields with empty or whitespace-only English are hidden in the editor and list preview. Records without any English text are omitted from the list. Gender controls remain available as metadata on records with English. Hidden cells keep their original values, saved translations and history, and remain intact in workbook downloads.

Missing is red; Outdated is orange until the exact current English has been reviewed and saved. Edit the field or choose **Mark reviewed**, then Save. Saved remains distinct from completeness; per-field corrections outside original Missing/Outdated work are Revised. The list counts records with each overlapping status; workload progress counts resolved Missing/Outdated fields. ClientText source changes preserve translation and never create Dropped copies. A competing incoming/local translation offers an explicit choice.

Inline and full editors share durable drafts and the StatDescription save shortcuts. **F2** or **Ctrl+.** saves and opens the next record; **F1** or **Ctrl+,** saves and opens the previous record. In the full editor, **Ctrl+S** saves and opens the next record when automatic-next-file is enabled, or returns to the table when disabled. In inline mode it saves the active row and keeps it open. **Save** keeps the editor open; **Save & close** returns from the full editor to the table. Navigation keeps scoped drafts and history. Comments use the shared file tools panel and unread indicators, with separate discussions for this version/group/sheet/ID and language; global posting requires the unchecked audience choice. Shared save polling stays silent and preserves the current editing view.

ClientText **History** lists local and shared changes separately, including the shared author. **Compare change** shows a saved change's frozen before/after values; **Compare with current** compares it with your current draft. The read-only viewer can select any two loaded snapshots, including the original workbook and current draft, and displays English, translation, Gender metadata, grammatical forms and Developer notes. Character differences and visible whitespace are optional display settings; raw `@`, literal `\n` and actual newlines stay distinct. **Load older history** pages shared history and expands the local list.

An inherited record offers **Compare previous version**. This explicitly verifies or reuses the earlier original without switching the active workspace, then loads the accepted revision recorded by its carry provenance. It exposes earlier English, notes and removed fields. If that saved revision is unavailable, the viewer labels its fallback as the verified original workbook translation. Earlier workbooks are not downloaded automatically when opening an ID. **Restore before** or **Restore after** asks for confirmation, then creates a new saved revision with the selected translation and retains earlier history. Removed fields are excluded, and old review hashes cannot mark changed English reviewed. A failed save retains the restored text for recovery and retry. Escape closes the comparison and returns focus; save shortcuts are blocked while the read-only viewer is open.

Cell text remains raw: `@`, actual line breaks and literal `\n` have different meanings. Completion and diagnostics recognize bracket links, numeric substitutions and `<<…>>` icons/keybinds, while brace contents after formatting tags remain localizable. The exact audio metadata markers `[NOAUDIO]`, `[NO AUDIO]`, `[OLD AUDIO]` and `[AUDIOTEST]` are optional in translations and omitted from completion suggestions. Adding, removing or replacing one of these prefixes alone does not require source review when the original dialogue is verified; repeated markers or other text changes remain significant. ClientText TM learns valid text/form saves and accepted shared work into this browser's language/game projection, matched by field/form context; Gender metadata, sentinel/blank values and unreviewed or conflicted work do not teach it. Double-click a ClientText TM match or choose **Use translation** to insert its text into the focused target field as a draft. This projection is separate from cloud StatDescription TM.

### NPC browsing

In ClientText, switch from **Sheets** to **NPCs** to read and edit related text across worksheets. **Filter NPCs** searches English names, selected-language names and metadata paths. Choose an NPC, **All NPC text**, or **Unassigned dialogue**, then use **Names**, **Menu topics**, **Dialogue** and **Conversations** to narrow the worklist. Counts show distinct records; workspace progress still covers the complete workspace.

NPC browsing starts with all statuses selected, including **Unchanged**. Each NPC name reflects the highest severity across all its related records: red for **Missing** or diagnostic **Error**, yellow for **Outdated** or diagnostic **Warning**, and normal otherwise. Red takes precedence over yellow, including when the affected record is hidden by the current filters. Hover or focus the name for its severity. Colors use committed translations and existing diagnostic findings; editing a draft does not change them. Sheets and NPCs keep separate search, status filters, sorting, pagination and navigation scroll during the current workspace session. Every row retains its original workbook role, sheet and row number. Inline and full editors use the same save, history and keyboard behavior in either view.

Menu topics use exact NPC metadata links. When a sheet provides an **NPC** hint column, its complete metadata paths determine membership and appear as **NPC reference**; hover or focus the label to see the linked paths. Multiple references can link one record to several NPCs, while repeated paths to the same NPC count once. Blank audio NPC cells and records without a uniquely resolved path stay under **Unassigned dialogue** and **All NPC text**; ID guesses do not replace provided hints. Partially resolved lists keep their unique links and identify unresolved or ambiguous paths in the tooltip. Sheets without the NPC hint column keep the existing **ID match** behavior, matching NPC names or metadata aliases in record IDs. ID matches identify related text rather than verified speakers or playback order. Character and class hints do not assign NPC membership. Names, grammatical forms and records with the same ID on different sheets remain separate editing records. Convo families still keep all their turns together, including player replies and other NPC participants.

This browsing view is also available in **Test Sheet Offline**. That session's existing temporary-save notice still applies; downloading workbooks preserves its saved translations.

### Conversation browsing

The **Convo** tab groups records from **NPCTalkDialogueTextAudio** and its **Gender** counterpart into conversation families. **All conversations** opens the complete worklist. Click an NPC name to show all its conversations and expand or collapse its families. Its chevron only expands or collapses the tree, keeping the current selection. While **Filter conversations** is active, matching families stay expanded. The filter searches English and translated NPC names, metadata paths, family prefixes and full record IDs. Families without a uniquely selected parent appear first under **Unassigned NPC**, with their full family prefix retained.

NPC hints select the parent for the complete family. One uniquely referenced NPC becomes its parent, even when its name differs from the ID prefix, such as Mortimer for `Mort_FirstTime`. If several NPCs participate, the existing ID anchor can select a parent only when it uniquely matches one of those participants. Otherwise the family remains unassigned. Blank NPC cells on player turns do not block a family with valid NPC references; unresolved or ambiguous nonblank paths do. A family spanning hinted and older workbook roles stays together and uses the provided hints. Families from files without the NPC hint column retain the original ID-based parent matching. Turn order and the number of lines per NPC never select a parent.

Each family keeps its context: **Intro** with **DoryaniA4** includes all `DoryaniA4_Intro_A`, `…_B`, `…_C` and their variants, while other Doryani contexts remain separate. Numbered turns such as `A1`, `A1a`, `A1b`, `i1` and `a1b`, conditional endings and recognized class qualifiers before a turn can share a family. Lowercase turn letters require a number; bare lowercase letters remain branch qualifiers. Original IDs and family-name casing remain unchanged. Earlier namespaces remain intact, so `Doryani_Inc_Intro_A1` appears as **Inc_Intro**. IDs without a recognized turn remain under their complete ID rather than a guessed topic.

Parents and families show distinct-record counts and the highest severity across their conversation records: red **Missing/Error**, then yellow **Outdated/Warning**, then normal. Hidden records still contribute. Convo starts with all statuses selected and worksheet-row order; normal table sorting remains available. Its filters, sorting, page, tree expansion and scroll are kept separately from Sheets and NPCs for the active session. The shared inline/full editors, draft checkpoints, saves, comments, history and assistance continue to use the original workbook records.

Arrow keys move tree focus without changing the worklist. Right expands a parent or enters its children; Left collapses it or returns to its parent; Home/End move to the first/last visible node. Enter or Space opens the focused parent or family. **NPC reference** identifies a parent selected by explicit family references; **NPC + ID match** identifies a participating parent selected with the ID anchor. **ID match** identifies the original prefix matching in files without hints, and **ID family** identifies an unassigned family. Tooltips show the family references and matching evidence. This parent applies to every turn in the family, including other NPCs and player replies. The tree retains original row order and does not determine branches or playback order. Test Sheet Offline retains its temporary-save notice.

### Finding Files and Navigating Pages

The main action header stays visible while you scroll, with controls for exporting, importing, diagnostic scans, a Settings cog, and a right-sidebar icon for file tools. Search the file list by name, English source, or translation using the search field in this sticky navigation bar. Results update after typing pauses for 250 ms; press **Enter** to apply the search immediately. Clearing the field or pressing **Esc** restores the list immediately, keeping the selected status filters.

Status filters are hidden by default. Use the filter icon beside search to show or hide them. **Missing translation**, **Saved changes**, **Revised translations**, **Dropped translations**, **Errors**, **Diagnostic warnings** start selected; **Unchanged** is the final option and starts off. Selecting multiple statuses includes files matching **any** selected status. **Clear filters** leaves no statuses selected and shows no files; **Select all** includes every status. Search and the selected status filters work together. Unsaved edits do not change the file's committed status or its status-filter membership.

Click a status counter in the bottom bar to select only that status, keeping your text search. **Ctrl+click** adds the status to your current filter. Hover or focus a counter for its meaning and this shortcut. Click **Loaded files** to show every loaded file: it clears the search, selects all statuses including **Unchanged**, and turns off **Hide DNT entries**. In ClientText, **Loaded IDs** also clears the sheet selection and shows every visible ID across sheets. Both actions return to the first page.

Click **Conflicting dropped copies need review…** in the workspace or editor status bar to show only files whose dropped copies need a decision or whose saved result needs another review before sharing. This clears the text search and activates a special filter that is hidden from the ordinary status choices. It includes affected DNT files while preserving the **Hide DNT entries** setting. Files removed from the current source are outside this review workload. Their earlier translations and history remain with the previous version. Click the **Conflicting dropped copies ×** chip to return to the default search and filters.

Page navigation and the workspace status counters sit together in a sticky bar at the bottom of the file list. Pagination shows the visible range and matching total (for example, **1–50 of 4,090**) with previous/next arrow buttons. The status order is **Loaded**, **Missing**, **Errors**, **Dropped**, **Scan warnings**, **Revised**, **Saved**. Unsaved edits have no separate counter. Errors include present incomplete committed SD language blocks immediately, together with manual scan errors. An absent selected-language tag counts as Missing only. Scan warnings appear during/after a scan. Clearing a scan retains intrinsic completeness errors. **Missing**, **Dropped**, **Saved**, **Revised**, and scan counts describe files eligible under **Hide DNT entries**, independently of search and status choices; **Loaded** covers every loaded file, and the result count describes the files matching your search and filters. The current version name opens the source chooser; unnamed versions show the shortened ZIP hash. Hover over or focus the name/hash for full version details. A managed deadline reminder follows **Saved**. While the hash is being calculated, this spot shows **Hashing…** with a progress indicator.

The **‹!** and **!›** buttons beside pagination jump to the previous or next file needing attention: **Missing**, **Dropped** (SD) or **Outdated** (ClientText), or committed diagnostic **Error/Warning** findings. They keep your search, status filters (including **Unchanged**), browsing group and sort order, move across pages, skip files being edited by others, and stop at the list boundaries. They are also available in the full editor and in ClientText **Sheets**, **NPCs** and **Convo** views. Hover or focus for details. **Ctrl+Shift+,** and **Ctrl+Shift+.** trigger these jumps (Ctrl+< and Ctrl+> on a US keyboard); **Ctrl+, / Ctrl+.** and **F1/F2** retain ordinary save-and-file navigation. Leaving edited work uses the existing save checks and draft recovery. A failed explicit save blocks the jump; SD inline navigation can retain an invalid or declined draft and its findings while moving to the next row. A draft-storage failure keeps the current editor open.

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
| Missing | The selected language tag is absent, or its committed block has blanks or a different English entry count |
| Saved   | A complete staged SD translation exists for this language, including unchanged complete confirmations |
| Error   | A present committed SD language block is incomplete, or a manual scan reports an error |
| Revised | Saved text differs from a complete original ZIP translation, for a file that has not been Dropped in this source version |
| Dropped | An unresolved copy belongs to this workspace's version chain for this file and language, even when its current translation is complete |
| Unchanged | Current translation is complete, with no staged save or unresolved dropped copy in this workspace's chain |

An online workspace can also show **Local recovery** for a browser-owned alternative. The Dropped filter includes it for review; shared Dropped counts, progress and Revised eligibility remain tied to the managed chain.

These statuses come from the immutable original ZIP, committed staged translations, dropped copies, and diagnostic results. A file can match more than one status. A complete current ZIP translation can still be **Dropped** because an older copy awaits a decision; the older copy stays separate from the current text. Switching language recalculates the statuses for that language. Unsaved typing does not change the workspace counters.

To remove a saved translation, open the full editor, use the red **Delete staged translation** button, and confirm the deletion. It restores the original ZIP translation for the selected language and removes the staged save from normal export. It works even when save checks reject the draft. Local drafts, history, and dropped copies remain recoverable. Shared deletions synchronize with the language team; newer shared edits require a conflict decision. **Discard draft** only removes private unsaved typing.

If deletion cannot verify the saved text, it requires a fresh review instead of repeatedly retrying the old decision. The saved translation and private drafts remain available. **Review saved translation** opens the affected file; **Cancel deletion requests** keeps the saved work and cancels only rejected deletion requests. If local and shared saved text disagree, review and save the translation you want to keep before confirming deletion again. Use **Review retained edits** from an actionable warning to compare competing private copies; deleting a staged translation does not resolve a draft conflict.

**Revised** identifies corrections outside this source version's Missing or Dropped workload. A file that started Missing stays **Saved** without becoming **Revised**, even after you complete it and edit it again. A file that was Dropped in this source version also stays outside **Revised** after confirmation, replacement, or discard. For an eligible file, saving exactly its original ZIP translation is **Saved** without **Revised**; saving different text is **Saved** and **Revised**. Every staged SD entry must contain text. See the [workspace status contract](workspace_statuses.md) for examples and the precise scope.

#### What “Missing” Actually Means

“Missing” is calculated from your current committed translation: the staged save, if one exists, otherwise the original ZIP translation.

- No selected-language tag in the original ZIP → Missing only
- A present language block with any blank/empty translation line → Missing + Error
- Different number of lines compared to English → Missing

Missing describes translation work, not a missing file. A present block with a different entry count is also an Error. An absent tag has no quoted translation to classify as blank; its empty editor fields are only display padding. Complete every field before saving a new translation.

### Opening a File

**Inline editor** is enabled by default in **Settings → Editor & shortcuts**. Click a row to edit its translation in the file list. Click its filename, double-click the row's background, or press **Enter** on the focused row to enter the full editor. Double-clicking a text field retains normal text selection. Hover over a filename to see its full directory path and any diagnostic details. Disable Inline editor to restore clicking a row directly into the full editor. A blue indicator on the left marks the selected file.

Source and translation fields appear immediately in the normal editor layout, including tables, multiline text and the preview. The fields stay read-only while highlights and checks are prepared, then become editable in place. **Close** or **Escape** cancels the open while it is loading.

The initial Dictionary snapshot prepares during Initialization. Later Dictionary changes prepare in the background while highlights and autocomplete continue using the previous completed snapshot. New matches appear when preparation finishes without changing your translation or moving the fields. An open autocomplete popup keeps its current suggestions and notes until you close it; the next popup uses the refreshed Dictionary. Changing account, language or game prepares assistance for that selected context.

Focus the file list with **Tab** or press **Up/Down Arrow** from a non-input control in the main interface to return to the currently selected row. If no current selection is visible, the first row is selected. From search, **Down Arrow** selects the first visible file; **Up Arrow** returns to the current selection.

In the list, **Up/Down Arrow** selects the previous/next row without leaving the current page or returning to search. **Home/End** selects the first/last row, and **Page Up/Page Down** moves ten rows, stopping at the page's first/last row; these four keys also work from other non-input controls in the main interface. **Right Arrow** opens the next page at its first row; **Left Arrow** opens the previous page at its last row. Page controls use the same first/last selection behavior and retain focus while revealing the selected file. **Enter** on the row opens its full editor; inside a translation field it keeps its normal text-editing or autocomplete behavior. Other text fields, page inputs, select boxes, editable text, and filter checkboxes keep their usual keyboard behavior. **F2** can also open the first file from the current filtered list.

### Inline Editing

Only the focused file has live translation fields. Its source and translation share the full editor's highlights, autocomplete and block separators, with matching blocks aligned across the columns. Moving between its fields, autocomplete popup and file tools keeps that file active. Leaving the file returns its cells to normal display.

With the file table or an inline translation field focused, **Ctrl + Up Arrow** opens the previous file and **Ctrl + Down Arrow** opens the next file, then focuses its first translation field. This follows the current sort and filters, crosses page boundaries, skips files another translator is editing, and stops at the ends of the list. Leaving the current file uses the normal local-draft and save checks. The destination row is prepared before the queued save starts in the background, as with **F1/F2** in the full editor. Plain arrows keep their normal text-editing behavior.

Inside an inline translation field, **Tab** moves to the next translation field, including each table column, then opens the next file at its first translation. **Shift + Tab** moves backward and opens the previous file at its last translation. File transitions follow the same sort, filters, page boundaries, occupied-file skipping and save checks as **Ctrl + Up/Down**, and stop at the ends of the list. Moving between fields in the same file keeps its draft active. StatDescription full-editor fields and file tools keep normal browser Tab behavior; ClientText cells follow worksheet order as described above.

Press **Ctrl + Enter** in an inline translation field to open the full editor with the same draft and focus the same block and table column. **Escape** returns to that inline field and keeps any further edits as a local draft. If autocomplete is open, Escape closes it first.

The wider **file tools** sidebar takes space beside the table and contains **Dictionary**, **TM**, **Lookup**, **Preview**, and **Comments**. Dictionary and Lookup are available before opening a file. After focus leaves an editor, the sidebar retains the last file's matches, preview and comments until another file opens or the account, game, source version, branch or language changes. It fills the space between the header and bottom status bar and stays in view while the main scrollbar moves the table. Dictionary matches remain first, TM suggests translations for the focused entry, Lookup reads committed references, and Preview follows the active draft with frames filling the available width. Clicking anywhere inside the sidebar keeps inline editing active. The right-sidebar icon in the header hides or shows file tools to give the table more room. File selection and editing indicators continue to show other online collaborators.

Typing is retained privately in this browser, separately from staged translations. No draft badges, counters or dedicated filters are shown; errors and warnings stay in the filename column. Draft controls stay hidden during ordinary editing. **Discard draft** is the only draft action and appears when staging is blocked by errors, competing copies, Dropped review, a declined confirmation, or a failed save/checkpoint. Correcting the draft hides the action when it can stage again. Leaving the inline row uses the normal staging flow; there is no separate Stage draft button. Reverting all fields to the committed text clears the local draft, including when the translation was originally empty. Competing copies from other tabs still require review. Drafts keep their account/profile, game, source version, language and file identity. They do not enter translated ZIPs, change Saved/Missing/Revised counts or synchronize to other translators. Closing the full editor also keeps its draft. Actionable warnings offer **Review retained edits** for preserved translations. **Discard draft** remains available when staging is blocked.

Leaving an inline file attempts to promote its draft through the same save checks as the full editor. Errors keep it as a draft; warnings require confirmation, and declining keeps the draft. Findings appear below the filename. Promotion changes committed text only after the local save transaction succeeds; online synchronization then runs normally. Returning to a draft resumes its text.

Click the filename to open the full editor for Dropped approval/comparison, competing dropped copies, history restoration and **Compare & resolve**. TM is available in both editors. Inline editing never approves a Dropped copy automatically. Shared translation conflicts, competing local draft copies, and drafts whose committed base changed need explicit comparison and resolution before promotion. Opening shared-conflict review from an inline row first carries its draft into the full editor, then opens the conflict comparison.

In the full editor, **Show raw file** beside **Close** opens a read-only text area. Choose **Original zipped txt** to render the original parsed baseline or **With translation applied** to render the current language's editor text, including unsaved changes. Both views use the ZIP export format. **Download .txt** downloads the selected view with the original filename in UTF-16LE with a BOM. Viewing or downloading does not stage the draft. **Escape** closes the modal and returns to the editor.

### Scanning Diagnostics

If a **Resolve conflicts** button appears in the main action header, it opens shared Dictionary conflicts. Choose local content on the left or remote content on the right for **Alternates** and **TL note**, review the center result, and save it. Independent changes merge automatically. See [Resolve Dictionary Conflicts](cloud_backup.md#resolve-dictionary-conflicts).

Click **Scan diagnostics** to choose which checks to run. The modal has a checkbox for whitespace, dash spacing, tag syntax, variable tags, keyword popup tags, text decoration tags, inconsistent translations, and Dictionary terminology. Every check starts selected except **Dictionary terminology**. **Start scan** checks every loaded file in the selected language, including files hidden by search or status filters. When **Hide DNT entries** is enabled, DNT files are excluded from all selected checks, including inconsistent-translation comparisons.

The scan modal shows progress followed by **Diagnostic checks**, then **Files with findings** when results are ready. During a scan, the progress bar shows processed files and live warning/error counts, which also appear in the bottom status bar. **Close** or **Escape** lets the scan continue in the background; open **Scan diagnostics** again to return to it. **Stop scan** cancels without keeping partial results. Longer result lists use a visible range and previous/next arrows.

ClientText uses this same scanner, with **Records with findings** and worksheet, record, field and form locations. Its checks also include numeric substitutions and control tokens. Scans use committed text, including Saved translations, and exclude private drafts. Editor fields use the same error and warning count badges and hover details as StatDescription. Tag mismatches highlight the relevant translated token; a missing tag with no translated counterpart remains in the badge details without highlighting unrelated prose.

Completed results show warning/error totals and a paginated list of affected files, with entry and column details. Expand additional issues when needed, or click **Open file** to inspect a translation in the editor. Reopening the modal retains the completed results until a workspace change clears them. **Scan again** uses the currently selected checks. The file list's diagnostic warning/error status filters also help you focus on affected files.

The scan also warns about **inconsistent translations**: when two or more complete English entries are identical but their translations differ, every entry in that group receives a warning. This includes duplicates within one file and across different files. Case, spacing, punctuation, tags, and blank-versus-filled translations in present language blocks count as differences. Absent committed SD language tags are excluded from scan errors and consistency comparisons; empty display fields do not create a translation variant. Equivalent escaped and actual line breaks compare equally. Multiline and table entries are compared as complete entries, including table separators; matching fragments alone do not trigger a warning.

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

When a translation has more blocks than current English, open **Align translation entries** from the file row. The full editor also opens alignment automatically for excess blocks or a Dropped copy with a changed entry count. **Align entries** and **Align dropped entries** can be opened manually. Current English appears on the left; whole translation blocks appear on the right. Drag each block onto its English entry, or use **Select block** followed by **Place selected**. A block can be used once; replacing a placement returns the previous block to the available list. Only unique exact matches with preserved old English are placed automatically; repeated or unavailable old English requires your decision.

English text and its order are fixed and cannot be edited. Choose **Leave translation blank** for a new English entry and mark removed translation blocks **Unused in this version**. Every English entry and translation block needs a decision before **Continue editing**. This creates a local draft and retains the original blocks with its checkpoint; workspace statuses, exports and shared text change only after Save. Blank entries remain editable in the local draft; complete every entry before Save. Saving keeps the originals in browser-local **Before entry alignment** history; **Align these blocks** lets you reuse them later. Cancel leaves the original text intact. An arrangement that has not reached Continue is temporary and resets when you close the file.

The **History** side panel distinguishes browser-local records from **Shared translation history**. Shared history shows who changed a file, when, how, and its before/after translations. A confirmed restore is a new shared change; existing history is retained. Older local history is not uploaded. See [Translation Collaboration](cloud_backup.md#translation-collaboration) for version matching, offline saves, and conflict recovery.

The editor's **Save & close** button checks the text and retains a submitted save locally, then queues staging together with its local history in a background worker. You can return to the list or use **Save and open next/previous** immediately after queueing; leaving an inline file uses the same background staging. The destination becomes ready before queued saving starts. Saved text and counts update when the local transaction succeeds, and online synchronization follows. Reopening that same file waits for its pending save. Reopening the original workspace after reload resumes submitted saves under their original account, language and source version; a changed base or conflicting draft requires review. A failed write retains the submitted text and shows an actionable warning. Keep the tab open when the browser reports unfinished local writes; **Retry saving** and **Download pending edits** preserve failed queued saves. ZIP export, source import, game switching and reset wait for pending local writes. Later sync failures or conflicts appear in the collaboration status. **Close** retains the local draft without staging it. For files opened from the list, both return focus to the selected file. Use the **Small**, **Medium**, or **Large** controls beside **Preview size** to resize the game preview. **TM** opens suggestions for the focused entry; **Prefill blanks…** previews compatible exact matches for empty entries.

The editor shows each string as a block:
- **Top side (English)**: The original text you need to translate
- **Bottom side (Translation)**: Where you type your translation
- **Special items highlighted**: Variables and keyword tags are highlighted in both columns

### Reference Lookup

Select **Lookup**, the second tab beside **Dictionary** in the right pane, to search references while keeping your current file and unsaved translation open. Both editor modes search prepared StatDescription and ClientText groups in the selected release, including records hidden by workspace search and status filters. Search filenames/IDs, stat identifiers and metadata, English, or translations. **Content mode** and **Content group** narrow the references. Results appear after typing pauses briefly; an empty query shows no results, and clearing the query clears the selected reference immediately. Matching query text is highlighted in the result cards; matching stat identifiers appear beneath the file path. Use **Search in** to narrow the search and **Previous / Next** to page through results. Check **Only with translation** to show only records with a non-blank translation in the selected reference language.

Select a result to read its English and translation blocks, with ClientText field/form context and Developer notes. Multiline text retains its line breaks; `@` separates StatDescription table columns and remains raw text in ClientText. Reference text can be selected and copied. The **Reference language** selector changes only the lookup language; your editor language and draft stay in place. References use verified originals and saved translations, so unsaved changes in the current draft appear only in the editor. Already cached references work offline.

Choose **Prepare missing references** to make uncached groups available for reference. Preparation may download and parse originals when connected; it keeps your active editor, drafts and workspace selection in place. Only groups and languages your account can access are offered. Cancel stops the pending preparation and retains completed originals for the next reference load. StatDescription originals prepared only for Lookup stay in memory until reload or an account, language, mode or group change; ClientText reuses its existing original cache. A standalone local import searches its loaded content.

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

Some keyword references use the special `TagName::Parameter` form, such as `[TentacleSmash::{0}|Tentacle Whip]`. Preserve the complete keyword ID `TentacleSmash::{0}` and translate only the display text. Its `{0}` is part of that ID and is not counted or suggested as a separate variable tag. Variables in display text and ordinary text still count and must match English.

Formatting wrappers may nest and contain variables or keywords; formatting inside keyword display text is also valid. Diagnostics compare every nested modifier and its parameters with English, including repeated tags. Keyword links cannot nest inside other keyword links. In StatDescription, formatting wrappers cannot appear inside a numeric variable or keyword ID, and table columns are validated separately: keep each wrapper inside its column.

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

## Using the Dictionary and Translation Memory Panels

The editor's helper panels include **Dictionary** for terminology and **TM** for remembered complete entries. TM suggestions remain drafts until they pass the ordinary save checks.

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

Selecting an autocomplete option shows its Dictionary entry's **TL note** in a separate box beside the popup, when a note exists. Inline editing places the note on the left; the full editor prefers the right. Alternate options share their parent entry's note. When the viewport cannot fit both boxes side by side, the note appears below the popup. The selected option stays visible in the popup, and its matching Dictionary entry scrolls into view in the sidebar without moving keyboard focus.

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

**Highlight Dictionary words** also marks alternate Find text in plain English, including phrases with apostrophes, ampersands or quotes. Clicking the highlight inserts that alternate's replacement. Matching remains case-sensitive.

#### Dictionary Notes

Use the **TL note** field to document why a term is translated a certain way or explain its context. Notes appear when you click on the "TL note" field. With cloud sync enabled, these notes are part of the language's shared Dictionary.

Autocomplete Popup will show only Dictionary entries that have the same main definition with the tag name of found keyword.

### Finding Used Dictionary Terms

When you're editing, the **Dictionary** panel automatically shows terms that are used in the current block's English text, highlighted and sorted to the top. This helps you find the right replacements quickly.

**Ctrl+Click on a highlighted English term**: Jump directly to that term in the Dictionary.

### Backing up your Dictionary

Use **Settings → Data → Export settings** to download the current language's Dictionary, personal Regex rules, preferences and local editor clipboard. Select and export other languages separately when needed. **Import settings** restores a standard settings export and keeps a recovery copy first.

Google backup synchronizes personal settings and the translator's assigned language Dictionary or the manager/admin's selected language Dictionary; collaboration also synchronizes saved translations and new shared history for matching source versions. Managers and admins can switch languages to inspect and edit each team's shared work. The clipboard, unsaved typing, and legacy local history are not uploaded. See [Cloud Backup and Collaboration](cloud_backup.md) for first-login restores, recovery archives, and conflict resolution.

### Translation Memory

The **TM** tab shows exact, context and fuzzy matches for the focused English entry, with differences, warnings and suggested translations. In the inline editor, **TM matches** beneath each active entry selects it and opens file tools even when the sidebar was hidden. Double-click a match or choose **Use translation** to insert it into the focused target entry and return focus to the translation field; replacing existing draft text asks for confirmation. **Prefill blanks…** previews unambiguous exact/context matches for blank entries.

Successful durable saves teach valid nonblank pairs automatically. **Manage TM** provides editing, history, reviewed workspace seeding and JSON import/export. Original ZIP seeding is opt-in, and unresolved Dropped copies are excluded.

See the [Translation Memory Guide](translation_memory.md) for matching, game scope, synchronization and recovery. Private Regex rules remain exportable as legacy backups; the [Legacy Regex Guide](regex_guide.md) documents their historical syntax.

## Keyboard Shortcuts

### Global Shortcuts
```
| Shortcut          | Action                                        |
|-------------------|-----------------------------------------------|
| F1 / Ctrl + ,     | Save and move to previous file                |
| F2 / Ctrl + .     | Save and move to next file                    |
| Ctrl + Shift + ,  | Previous file needing attention               |
| Ctrl + Shift + .  | Next file needing attention                   |
| Ctrl + F          | Focus on search box                           |
```
### In the Main Editor
```
| Shortcut           | Action                                       |
|--------------------|----------------------------------------------|
| Ctrl + Space (default), Ctrl + I (optional), or literal [ | Open Autocomplete Popup |
| Ctrl + S           | Save; open next file when enabled in settings |
| Ctrl + Up / Down   | Previous / next file from the table or inline translation text |
| Tab / Shift + Tab  | Next / previous translation field, continuing across files (inline only) |
| Ctrl + Enter       | Open full editor at the current translation field (inline only) |
| Escape             | Close the file, retaining its local draft     |
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

An SD file with any blank or whitespace-only translation entry is a destructive error. Save is blocked for the whole file, even if other entries are useful. The local draft stays editable and the previous committed translation remains intact. An original ZIP without the selected language tag shows Missing only. A present language block with blanks or a different English entry count shows Missing and Error immediately. Drafts and recovery/promotion candidates require complete text before Save even when the original tag was absent. ClientText permits blank fields. Existing incomplete SD saves are removed from Saved and retained in scoped recovery. Open History and choose **Recover into draft** to align and complete their old text. Drafts and historical originals can contain blanks for repair; they cannot become a new SD save or export. Full export preserves an untouched absent language tag without adding blank translation entries.

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

Normal local history uses the selected account, game, branch, source and language. **Show legacy local references** adds older or ambiguous records from the same account/branch as comparison-only rows. A workspace adopted from the guest profile can also show its original guest references. These rows cannot be restored directly into this source version; review the text and explicitly recover it in the intended workspace. Existing local history stays in the browser when an offline workspace becomes an online catalog version.

## Managing Your Work

### Manager Dashboard

Managers/Admins click the current version name in the status bar to open **Manage version**, upload a named source, review validation/duplicate-block decisions and publish it to all 12 teams. Each Online version row has its own original-ZIP download, name/deadline edit and withdraw/restore actions. Resized desktop windows place secondary actions in an **Actions** menu; open it with a click, Enter or Space, tab through its buttons, and press Escape to close it and return focus. The default name uses the New Zealand date and game; the Publish deadline controls use New Zealand time and default to next Monday at 09:00. All displayed deadlines and timestamps use your browser's local time, including tooltips and the deadline controls in **Edit version details**. Before publication, the upload dialog identifies matching rooms where teams have already started shared work; hover over or focus a team chip for its counts, room type and online participants. Local drafts and saves awaiting upload are outside this pre-check.

Selecting a version shows one **Assignment** table for all content modes, with rows such as **French — StatDescription** and **French — ClientText**. Sort by Assignment or Progress. Each row retains its ended state, participant avatars, editor and collection actions. StatDescription progress displays Saved / (Missing + Saved): green is ordinary Saved, purple is Revised within Saved, and red is Missing. ClientText uses the same fraction, percentage and bar layout: green is resolved initial workload and orange is remaining Outdated work. Missing-only fields are excluded from progress because teams may intentionally leave them blank to use English. A field that is both Missing and Outdated still requires review; reviewing it while leaving it blank excludes it from progress. Missing counters and filters remain available. Corrections outside the initial workload do not affect progress. Hover over or focus either bar for its counts and overlap explanation. Deadlines, publication times, hashes and avatars use the same hover/focus tooltip. **Open editor** enters that assignment's workspace.

Inherited reference copies preserve prior work that cannot be applied automatically, including files absent from the selected source. Inspect their preserved source/text in the version's reference view; references for a loaded file also appear in its History panel for comparison. They do not become Saved translations or enter collections merely because you open them.

**Download** captures server-accepted Saved files and generates their named ZIP in the browser without ending the team's window. **Download and end** ends the window after the API verifies the durable snapshot and retained original; browser ZIP generation follows. Both retain the snapshot for later download or retry, and older retained ZIP collections remain supported. The dashboard shows changes saved after the latest ending collection and supports **Recollect** or **Reopen**. Publishing while a previous HEAD has open teams requires an explicit override. **Withdraw** hides an accidental version; work/collections/active editors require confirmation, and data remains recoverable. See [Import Workflow](import_workflow.md#manager-published-versions) for collection and withdrawal details.

### Confirming Unchanged Translations

If the English source was updated but your translation still fits (source typo, etc.), you can manually confirm it hasn't changed:

1. Open the file in the editor
2. When several copies are available, choose **Local recovery** or **Shared Dropped** in **Recovery copy**. Expand **Compare dropped version → current** to inspect its preserved source and translation. Choosing a comparison keeps the editor text unchanged; **Use for editing** puts the selected target into a draft.
3. Click **Confirm unchanged** to stage the selected preserved translation for this source version. If the entry layout changed or the draft needs corrections, use the copy for editing and **Save** the replacement instead. Saving, confirming or discarding resolves only the selected copy.

Dropped copies do not enter exports. Local recovery stays in the browser; Shared Dropped stays in the managed online chain and its browser cache. Cached online work keeps its online identity while disconnected. Each copy remains until you resolve that copy by Save, Confirm unchanged or Discard. Reloading, exporting and importing later versions preserve unresolved recovery. Copies without available historical English identify that limitation in the viewer; their exact target text remains recoverable.

Local imports and managed publication can reach the same current ZIP through different predecessors. Their recovery copies remain independent, including when the target text matches. A local copy never automatically replaces or resolves Shared Dropped; the client offers both for review. **Local recovery** labels and the Dropped filter make browser-owned alternatives discoverable in an online workspace, while shared Dropped counts, progress and Revised eligibility follow only its managed chain. Existing collaboration history continues to show who edited what. A genuine revision conflict within shared recovery still requires an explicit current-copy decision.

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
