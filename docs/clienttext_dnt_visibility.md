# ClientText DNT visibility

Implemented locally on 20 October 2026, based on reviewed frontend commit
`abe2dea178856df5d881372ead1f3cd35bcb63bf`. No publication or deployment is included.

## Detector and actual workbook evidence

As of 30 October 2026, SD's `StatDescCodec.computeIsDNT` checks whether any selected
English entry matches `/\bDNT\b/i`. The same case-insensitive word rule applies in
the frontend and API, ClientText visibility and Use English eligibility, and
Translation Memory exclusions. It matches anywhere in immutable English, including
bare `DNT`, lowercase or mixed-case spelling and malformed brackets such as `DNT]`
or `[dnt`. ASCII letters, digits and underscores adjacent to the marker prevent a match.
Targets never determine DNT classification. SD retains its whole-file policy.

ClientText applies that same detector to each immutable English field, including
markers inside nested and custom formatting such as
`<size:+5>{<augurypopuptitle>{Butcher}}\n<augurypopuptext>{[DNT] Advanced Description}`.
A mark in one payload hides that field, including its other payloads. Ordinary
siblings remain visible. No formatting-token boundary or leading prefix is required;
inline mentions and markers after whitespace also match.

This adaptation is necessary for the reported PoE1 `AuguryCardTiers` example:
none of its marked fields starts with a raw SD prefix. **21 of its 81 records**
have the marker inside `Advanced Description` formatting; their ordinary
`Description` is blank. Hide DNT hides those 21 records and retains the other 60.
The separate synthetic mixed-row checks verify that ordinary nonblank siblings
remain visible even when another field is marked.

| Supplied original | SHA-256 | DNT fields / rows | Mixed rows | Hidden all-DNT rows |
| --- | --- | --- | --- | --- |
| PoE1 `Thai_PoE1.xlsm` | `67f90e1d2bae8063c7a351b56028548a46ccf82576d5b4223efb9cfea9889cb4` | 216 / 175 | 80 | 95 |
| PoE2 `Thai.xlsx` | `f46736c6501a606a4168a6a6fdd321b30a3feff123fba00031d0d6be992c403a` | 1,390 / 1,250 | 107 | 1,143 |

The workbook measurements above are historical evidence from the 20 October
prefix-based detector, before the 30 October word-rule change. Its raw SD-prefix
subset was 173 fields in PoE1 and 1,390 in PoE2. The earlier case-insensitive
substring research in [PoE1 compatibility](poe1_workbook_compatibility.md) also used
a different rule. These counts do not establish the current word-rule totals.
No originals were modified, uploaded or committed.

## Visibility and data safety

- Normal fields, grammatical forms and class variants filter individually.
  Gender has no English source; it remains metadata for a row with visible prose.
  Existing blank-English hiding continues to apply.
- Both editors, field groups, class tabs, source/target list summaries, preview
  selection, search, sorting, Lookup results and keyboard/file navigation consume
  the filtered view. Manual scans check ordinary fields in mixed rows and omit
  all-hidden records. Changing Hide DNT clears manual scan results as before.
- Visibility caches never replace immutable unit fields or original identities.
  Loaded/status counts, assignment progress and sheet colour aggregation still
  describe their existing committed field workload, including hidden fields.
  The result/pagination total describes matching visible rows. No status or
  accepted progress facts, parser version, storage schema or API contract changed.
- Toggling retains the selected record, every raw draft value and review hash.
  Hidden focus, completion and pending focus callbacks are fenced; visible
  variants/focus are selected again. A full editor with all fields hidden explains
  how to restore visibility. Existing draft checkpoint/save guards still run when
  leaving, and checkpoint failure retains the current draft. Pending selection
  reads and TM confirmation cannot install or edit newly hidden fields.
- Whole-record saves, history, no-op exports and edited exports retain hidden
  values. Hiding alone never stages a save or rewrites a workbook. Native package
  parts, original source bytes and six-state colour behavior remain intact.

## Reproduction and verification

```text
node --test --test-concurrency=4 scripts/test-*.cjs
node scripts/validate-clienttext-dnt.cjs poe1 <local-PoE1-workbook.xlsm>
node scripts/validate-clienttext-dnt.cjs poe2 <local-PoE2-Thai.xlsx>
node scripts/validate-clienttext-export-colours.cjs <local-PoE1-workbook.xlsm> <local-PoE2-Thai.xlsx>
node scripts/validate-clienttext-samples.cjs <local-PoE2-folder> --all-languages
node scripts/clienttext-offline-browser-fixture.cjs --poe1-real-workbook
node scripts/editor-lookup-browser-fixture.cjs
node scripts/keyword-popups-browser-fixture.cjs
node scripts/clienttext-browser-fixture.cjs --resource-sync-only
node scripts/clienttext-export-browser-fixture.cjs
```

Frontend: **3,672 passed** after independent review corrections. Isolated sibling API at
`428e918d3bbcd483b4d0a83d12c71c4d0bae3a24`: `npm run check` and **823 tests passed**.
The two DNT audits verify repeated toggles, byte-exact no-op export, an edited
hidden target, every other field's source/target identity and value, all package
entries and 741 PoE1 / 219 PoE2 untouched native parts. Both supplied Thai colour
audits pass.

All 17 supplied PoE2 normal/Gender sample workbooks also pass their existing
parse, descriptor, targeted edit/export and original-checksum audit. The full,
inline and all-hidden Augury screenshots were visually inspected.

The offline browser fixture passes seven imported sessions, including actual
PoE1 Augury toggle/restoration and KeywordPopups save/export, synthetic mixed normal
and Gender/class forms, full/inline hidden drafts, F2 navigation, four themes,
repeated settings toggles, search and paired macro/package export. A deliberately
failed checkpoint, held selection read and pending TM confirmation are covered by
unit tests. The original disk hashes remain exact. Screenshot evidence is generated
under ignored `temp/clienttext-npc-offline-fixture/` (`dnt-mixed-full.png`,
`dnt-mixed-inline.png`, `augury-dnt-visible.png`, `augury-dnt-hidden.png`).

The separate popup fixture passes scope transitions and stale A/B/A requests;
Dictionary/TM resource sync passes permissions and draft isolation with two local
API clients and zero inference. The export dialog/worker fixture passes interrupted
flows, frozen receipts and native package retention. Initial sandbox subprocess
and browser-launch failures were resolved using normal local process access;
the popup fixture used its existing local Vue asset copied into ignored `temp/`.

Actual PoE1 Gender/non-Thai workbooks were not supplied; synthetic forms and the
existing PoE2 samples provide that coverage. The supplied XLSM contains no VBA
project, so VBA part retention is checked synthetically. No live inference,
production mutation, IndexedDB feature work, Use English, TM status, filename,
recovery-entry or unrelated Lookup UI changes are included.

## Independent review corrections

Review of local DNT commit `36f7b987e800ad39bcf94f0bfaf143004d590ee7`
identified two gaps. The supplied reproductions confirmed them before correction:
an all-DNT worksheet restored its field but remained absent from the Sheets list
after unhiding; the shared rendered Lookup returned a hidden-source match even
though the editor's field view excluded it.

The sheet navigation catalog now rebuilds from the complete immutable units on
each setting change, and its computed view observes Hide DNT. Activation uses the
same builder. Repeated hide/unhide transitions retain the current sheet filter,
selected record, full raw draft and review hashes, including a selected all-DNT
record. Normal and Gender all-DNT sheets return as selectable buttons.

The actual shared Lookup index now applies the existing `isDNTSource` detector to
ClientText fields in active and sibling catalogs. Its cache identity includes the
setting; the synchronous watcher invalidates cached results and clears an affected
selected reference. A guarded reference getter also prevents stale details from
showing hidden text. Unhiding restores results. Ordinary sibling and target-only
marker hits remain available. SD results, selected references and pagination retain
their existing behavior, including SD DNT references. Pending catalog loads use the
current visibility setting when indexed; settings changes do not rewrite originals,
save drafts or change catalog access/scope decisions.

The two supplied reproductions were run unchanged before the fixes. Five new
regression cases initially failed (**0 passed / 5 failed** in ignored
`temp/dnt-review-red.log`) and pass after correction (**5 passed / 0 failed** in
`temp/dnt-review-green.log`). A sixth regression checks SD-only pagination and
reference retention. The complete frontend aggregate passes **3,672** tests and
the unchanged isolated API passes `npm run check` and **823** tests.

The expanded seven-session offline browser workflow imports the synthetic
normal/Gender workbooks with hiding already enabled, restores and selects an
all-DNT sheet through its real button, repeats toggles, and checks the rendered
Lookup result list and read-only detail in both full and inline editors. Source
and committed target searches exclude hidden fields; ordinary sibling references
remain selected while settings change. Draft snapshots remain exact. It also
repeats the actual PoE1 AuguryCardTiers hide/restore and native save/export workflow.
The separate shared Lookup browser fixture verifies existing SD/CT mixed catalogs,
offline references, permissions/scope isolation, pagination, blank Saved overlays,
excluded drafts, raw identities, cancellation and unchanged active workspace state.
Both supplied Thai DNT/export audits pass again with unchanged counts and checksums.

Current logs are under ignored `temp/dnt-review-*.log`; new visually inspected
screenshots are `temp/clienttext-npc-offline-fixture/dnt-lookup-full.png` and
`dnt-lookup-inline.png`. No DNT publication or deployment is authorized or included;
the previously published `abe2dea178856df5d881372ead1f3cd35bcb63bf` baseline is preserved.
