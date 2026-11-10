# Translation Memory

Translation Memory (TM) replaces the Regex editing panel with remembered English/translation pairs. The Dictionary continues to provide terminology, keyword display text and autocomplete. Legacy Regex rules remain private settings data and can be exported from **Manage TM → Legacy Regex backup**; patterns and recursive captures cannot be converted reliably into translation pairs.

The suggestion workflow and exact/context/fuzzy categories follow [memoQ's translation memory model](https://docs.memoq.com/current/en/Concepts/concepts-translation-memories.html) and [match-rate presentation](https://docs.memoq.com/current/en/Concepts/concepts-match-rates-from-translation-m.html). SDEditor defines its own context and Unicode edit-distance scoring for PoE entries; the percentages do not reproduce memoQ's scoring internals.

## Suggestions and insertion

Focus an entry in either editor and open **TM**. Matches show the remembered English, current English, proposed translation, source context and any warnings. The default minimum is **60%**. Double-click a match to insert its translation into the focused target entry. You can also use Up/Down in the result panel to select a match, then Enter or **Use translation** to insert it. Replacing existing draft text asks for confirmation.

In the inline editor, each entry in the active row has **TM matches** beneath its translation. It selects that entry and opens the TM sidebar, including when file tools were hidden. Table entries use one button for the whole entry. Inserting a match returns focus to its translation field and keeps the row active; leaving the row retains its usual save checks. Prefill reviews take keyboard focus, and applying or cancelling returns to the entry.

| Match | Meaning |
| --- | --- |
| 101% Context | Identical raw English and the same filepath, ordered stat IDs, condition, remarks and entry index |
| 100% Exact | Identical raw English with different or unavailable context |
| 99% Variables adapted | The English differs only by a verified one-to-one renumbering of ordinary numeric variable tags |
| Below 100% Fuzzy | Similar English, including case, whitespace, punctuation or wording differences |

Fuzzy percentages use Unicode character edit distance after lookup normalization. They are not confidence that the translation expresses the new meaning. Review changes such as increased/reduced, more/less, negation, literal numbers and keyword identities. A near-exact fuzzy match still needs review. Literal numbers, changed terms and keyword IDs are not rewritten automatically. Parameterized keyword IDs such as `[TentacleSmash::{0}]` remain whole identities.

One TM unit contains a complete quoted entry, including all `@` table columns and escaped `\n` lines. Insertion changes a local draft and refreshes its ordinary checks. Save retains its normal validation and Dropped review requirements; inserting a suggestion does not stage text or approve a Dropped copy.

**Prefill blanks…** previews compatible, unambiguous exact/context matches for empty entries. A unique 101% context match takes priority over source-only variants. Choose the rows to apply; the result remains a draft. Fuzzy and variable-adapted matches require manual insertion.

## Learning and managing entries

Successful durable translation saves learn validated, nonblank pairs automatically. Draft typing, a queued submission, a failed save and suggestion insertion do not teach TM. Blank, DNT, malformed or structurally incompatible pairs are excluded. DNT detection uses `/\bDNT\b/i` anywhere in immutable English, including lowercase and malformed bracket markers; target-only markers do not determine DNT. Unresolved Dropped copies are excluded; a reviewed replacement can teach its current English and final saved translation.

Open **Manage TM** to search, add, correct, delete, inspect history or restore entries. New entries use the selected game. **PoE1**, **PoE2** and **All** entries share a language store; a game-specific entry overrides All entries with the same raw English. Other-game entries remain available in the manager but do not supply suggestions. Source-version and branch metadata describe where a pair came from, so it can be reused in later versions.

A correction with the same raw source, game scope and context updates its active target while retaining history. Changed context remains a separate example; source-version provenance alone does not create another unit. Deleting a unit suppresses automatic relearning of that identity until an explicit restore is reviewed.

Entry history includes this profile's local edits and, when authorized online, the team's server-authored changes. **Load older** retrieves earlier shared changes. Restoring a historical translation requires confirmation and checks the current unit revision again; a newer correction remains available for review rather than being overwritten.

**Build TM from workspace…** previews current Saved pairs. **Include original ZIP translations** is initially unchecked. New additions start selected; corrections and deleted-entry restores require selection. Imports change TM, leaving workspace translations and the immutable baseline intact. Completed batches remain durable if an import stops; retry the remaining rows.

For a local workbook opened through **Offline → ClientText**, select **Sync Dictionary and TM** during import with an authorized signed-in account. Open **TM → Manage TM → Build TM from workspace…**. To build from translations already in the Excel files, check **Include original workbook translations when building TM** first; without it, only committed Saved IDs supply pairs. Review the preview and import the selected rows. Eligible text and named forms from Normal/Gender workbooks join the existing language TM with ClientText field/form context; gender selectors, blank/DNT/incompatible text and fields awaiting source review are excluded. Drafts and Use English decisions do not supply translations. StatDescription suggestions continue to exclude ClientText pairs.

**Export JSON** creates an `sdeditor-tm` version-1 backup for the selected language, including deletion records. **Import JSON** requires that language and previews additions, corrections, restores and preserved deletions. Deleting a currently active entry requires selection. Import rejects duplicate source/context identities and excludes incompatible pairs. TM is separate from ordinary settings JSON and translated ZIP exports.

## Bulk ClientText suggestions

Row-selection controls are hidden by default. In the inline **TM** panel, open **TM options → Show row selection** to show the bar and checkboxes beside workbook row numbers. Leaving the TM panel hides them again and clears the checked rows and TM-only filter, while retaining prepared suggestions and review text. In either an Offline or published ClientText workbook, Shift-click marks a range. The header checkbox selects the current page; **Select all filtered rows** explicitly includes other pages. Selection survives page changes and clears when the workbook or filters change.

Choose **Pre-translate selected with TM** to prepare suggestions for eligible Missing text/form fields whose committed translation and draft are blank. The batch uses the current TM panel's minimum percentage and the same language/game/form matching rules. Populated translations, DNT/audio/gender metadata, Use English decisions, resolved fallbacks, and existing TM/MTL review work are preserved. Preparation shows progress and prepared/unmatched/skipped counts. **Stop** retains suggestions already stored for review.

Open **Review TM** or the **TM review** filter to review the prepared fields. The native translation field edits a separate review buffer, showing the remembered English, current English differences, match percentage and source context. Equally ranked, different translations require an explicit choice. Numbers and tokens are never rewritten automatically. **Accept** places reviewed text into the ordinary draft; **Undo accept** restores the previous draft. **Save** or Save-and-next commits the whole ID. **Dismiss** leaves workbook text intact. An unaccepted suggestion does not change committed statuses, translation history, learned TM or workbook exports.

Candidates and review edits remain private to this browser, account and exact workbook scope, including for published workbooks. They survive normal reloads. Changed field sources, filled targets or corrected/deleted TM entries require renewed review; edited review text is retained. A later correction to TM does not replace text already accepted into a human-edited draft. The review controls share the MTL interaction, without making model requests or requiring MTL consent. Accepted published-workbook text uses ordinary shared Save; provisional TM evidence never enters the MTL transport.

IndexedDB v27 fences older writers and adds private TM review stores without deleting existing work. Local protocol-v3 recovery backups include TM proposals and edited reviews; older v1/v2 workbooks and backups remain readable. Restore creates fresh workbook identities and requires review against an available current TM before accepting restored proposals. If no current match is available, edited review text stays retained. Reload older tabs after the frontend upgrade; no API/schema upgrade or storage clear is needed.

## Local storage and team synchronization

ClientText local workbook import offers **Sync Dictionary and TM**, initially unchecked. When selected for an authorized account/language, Dictionary changes, eligible explicitly saved ClientText pairs and reviewed workbook TM builds use normal account synchronization and durable retry queues. Workbook values, drafts, originals and history stay in this browser's private durable workbook storage. ClientText pairs retain field/form identity and raw text; StatDescription suggestions exclude them. Shared corrections, deletion suppression and reviewed restoration use the existing TM manager. See [Local ClientText workbooks](clienttext_local_workbooks.md) for persistence boundaries.

Local TM belongs to the active profile/account and selected language. Translator cloud access follows the assigned language; Manager/Admin access follows the selected language. Other languages can still be edited locally. Healthy synchronization and same-browser tab updates are silent; conflicting corrections remain available for an explicit choice.

IndexedDB v10 adds separate TM units, metadata, outbox and history/receipt stores. Save learning joins the same transaction as staged text, history, retry operations and the save receipt. Retries reuse their original identifiers. Older stores and private Regex settings remain available; close older tabs for a blocked upgrade rather than clearing storage.

Cloud TM requires the companion API's schema v17. Deploy the compatible API before this frontend and retain the existing database and archive backups. Local tests and browser fixtures do not establish hosted deployment or production restoration readiness. See [Cloud Backup](cloud_backup.md) for rollout details.
