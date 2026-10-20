# PoE1 workbook compatibility audit

Local audit, 20 October 2026, based on frontend `d173f8c754c7b42b08f3f53193ba698ed9f3a8fe`.
The supplied files were read directly and never modified or sent to an external service.
No workbook content or generated export is committed. This is local validation, not deployment evidence.

| Supplied input | SHA-256 | Parsed sheets / records / fields |
| --- | --- | --- |
| `2026-10-19_POE1/Thai_PoE1.xlsm` | `67f90e1d2bae8063c7a351b56028548a46ccf82576d5b4223efb9cfea9889cb4` | 245 / 146,929 / 365,396 |
| `2026-10-13_POE2/Thai.xlsx` | `f46736c6501a606a4168a6a6fdd321b30a3feff123fba00031d0d6be992c403a` | 212 / 150,808 / 384,908 |

Both parse without warnings. There are 154 shared sheet names, 91 PoE1-only names and
58 PoE2-only names in these two inputs. Counts exclude styled empty rows; raw XML row
counts are not record counts. All 17 supplied PoE2 normal/Gender workbooks also pass
the existing sample suite, including Turkish possessive forms and six grammatical forms.

## Compatibility matrix

| Area | PoE1 evidence and resulting behavior | PoE2 / verification limits |
| --- | --- | --- |
| Game identification | Exact `Characters` record paths end in `Str`, `Int`, etc.; full export has `GrantedEffects` + `IndexableSkillGems`. Import, reusable-original preparation, group cache and activation reject evidence for the other game. Conflicting markers are rejected. | PoE2 Character paths end in `Four`/`Fourb`; corroborating full-export tables are `NPCTalkDialogueTextAudio` + `SupportGemFamily`. Filenames never establish game identity. Partial/Gender exports without markers retain the explicitly selected release scope; their game cannot be independently proved. No parser or durable identity version changes. |
| General schema / PoE1-only sheets | Existing header-based layout already handles all 245 sheets. Field names, whitespace and positions remain exact, including Hard Mode fields and `NPCTalk`'s trailing-space `HoverDescription ` header. | Shared sheet names do not imply identical columns. No fixed PoE2 column offsets or sheet allowlist were added. |
| `Mods`, `Words`, metadata | PoE1 `Mods` has Generation Type/Tags and Name/Translation at D/E; PoE2 uses G/H with additional ModType/StatMagnitude/ModDomain metadata. PoE1 italic reference headers remain metadata. `Words` Tags remain reference text. | The all-sheet sweep verifies edited targets and byte-exact unrelated source, metadata, notes and cells in both layouts. Missing optional hints stay absent. |
| Fields, forms, blanks | PoE1 normal Thai uses ordinary Translation pairs; all blank and whitespace targets remain legal. Workbook role + sheet + ID + field remain the identity. | Actual PoE1 Gender/non-Thai/form bundles were not supplied. Existing synthetic and all-language PoE2 tests cover Gender, class variants, Normal/Possessive, NONEXISTENT and exact whitespace. |
| Export, source protection, six colours | No-op export is byte-exact. The all-sheet sweep checks 394 target fields across all 245 sheets, including insertion into absent target cells. Existing colour audit resolves red targets/tabs and checks a revised field. Retained input bytes and disk hashes stay exact. | PoE2 Thai: 343 target fields across all 212 sheets. Original style/fill records stay intact; appended styles preserve every non-fill property. Existing six-state, source-hash mismatch and original-file-unavailability regressions pass. |
| Native package, macros, formulas | All native parts remain present; 497 parts outside touched sheets/styles remain byte-exact in the all-sheet PoE1 export. The supplied XLSM content type is macro-enabled but contains no `vbaProject.bin` and no worksheet formulas. | Actual macro execution and real formula recalculation are unverified. Existing synthetic XLSM tests verify byte-preserved VBA/native parts, metadata formulas and caches; editable/identity formulas remain rejected. |
| `KeywordPopups` | 88 records, three text fields: title, content and gamepad override. Snapshots require matching game/account/branch/release/language. An active draft overlays only its own content group. Identical tags from PoE2 cannot fill PoE1 cards. | Existing desktop card renders title/content; gamepad override remains editable/exportable without a new preview mode. Tests cover both games, same IDs, stale/unscoped sources, sibling groups and nested frozen previews. |
| NPC names / topics / dialogue | 804 NPC records, 4,058 topic records and 26,842 `NPCTextAudio` records. Existing generic index builds 487 browse groups. Topic console/hover fields remain separate editable targets. | PoE1 has no `NPCTalkDialogueTextAudio`, so conversation membership is empty. Grouping is derived navigation, not proof of speaker/conversation relationships. PoE2 conversation index still covers 11,717 rows in the supplied Thai input. |
| NPC/Character hints, portraits, labels | Seven exact PoE1 Character paths resolve against the existing game-specific identity/portrait catalog. The supplied file has Character Class metadata but no authoritative NPC/speaker/audio hints. Missing hints remain unavailable. | Portrait providers/catalogs already isolate `poe1`/`poe2`. Acquisition, authenticated media delivery and exhaustive real PoE1 identity coverage were not newly validated. Existing portrait/identity/API tests pass. |
| Skill cards | Existing private skill-card UI is explicitly PoE2-only. PoE1 ActiveSkills/GrantedEffects/BaseItemTypes continue to use ordinary field previews. | No PoE1 relationship catalog was supplied or invented. PoE2 skill cards/navigation remain covered by the regression suite. |
| Audio | Neither supplied Thai workbook contains Audio File hints. PoE1 now yields no audio clips and cannot route a hinted path through the PoE2-only provider. | PoE1 playback is unsupported/unverified. Existing synthetic PoE2 browser audio workflows remain covered. |
| Dictionary / TM / glossary alternates | Existing selected-game and All-fallback matching, language-shared sync, permissions and glossary alternates are unchanged. CT memory calls already supply the workspace game. | Full frontend/API suites cover resource access, scope changes, retry queues and Dictionary/TM behavior. No real account sync or model inference was invoked. |
| History / comparisons / persistence | Existing workbook role/field identities and memory-store save/history/export paths are retained. Known wrong-game cached originals are rejected rather than rewritten. | No storage migration or queued IndexedDB implementation. Existing persistence, permissions, carry, history and sync tests pass; a real managed PoE1 publication/collection was not performed. |
| MTL context / formatting / diagnostics | Generic field/context preparation works on parsed PoE1 units; exact Character scope is preserved. Absent participant hints cannot establish authoritative tone relationships. | Existing mocked context/roles/lookup tests pass. No live inference or external workbook lookup was performed. Use English, Lookup UI and DNT behavior are unchanged. |

## Reproducing local checks

Run the optional audit with explicitly supplied local paths; it creates edited packages
only in memory and logs counts/hashes, not workbook text:

```text
node scripts/validate-clienttext-compatibility.cjs poe1 <local-PoE1-workbook.xlsm>
node scripts/validate-clienttext-compatibility.cjs poe2 <local-PoE2-Thai.xlsx>
node scripts/validate-clienttext-export-colours.cjs <local-PoE1-workbook.xlsm> <local-PoE2-Thai.xlsx>
node scripts/validate-clienttext-samples.cjs <local-PoE2-folder> --all-languages
node --test --test-concurrency=4 scripts/test-*.cjs
node scripts/clienttext-offline-browser-fixture.cjs --poe1-real-workbook
node scripts/keyword-popups-browser-fixture.cjs
```

The browser flag uses `CLIENTTEXT_POE1_WORKBOOK` when provided; its default is the supplied
PoE1 path. It runs in a disposable browser profile against loopback, blocks cloud data
requests, imports the actual file, edits/saves a KeywordPopups field through visible controls,
downloads/reparses the XLSM, checks cross-game isolation and verifies the original checksum.
Browser artifacts stay in ignored `temp/`. Shared offline workflows also cover roles,
inline/full editors, temporary history, comparisons, native export and storage isolation.

Validation after independent review: frontend **3,657 passed**, API **823 passed** (isolated sibling API
`428e918d3bbcd483b4d0a83d12c71c4d0bae3a24`), all 17 supplied PoE2 samples passed,
both Thai all-sheet and colour audits passed. The offline browser fixture passed all six
imported sessions, including actual PoE1 edit/save/download/reparse and zero workbook
storage/cloud activity; the dedicated KeywordPopups browser fixture passed its SD/CT,
inline/full, nested popup, focus/keyboard, theme and scope-lifetime checks. The actual
PoE1 editor screenshot was also visually inspected. Sandbox process restrictions prevented the initial helper/browser
runs; rerunning with normal local process access resolved those environment failures.

## Independent review corrections

The two supplied synthetic reproductions confirmed gaps in reviewed commit
`69e0fcc575d7c3667540acde07b1be4dc45d8c41`: ready reference units with PoE2 Character
markers could be displayed under a PoE1 cache scope, and an SD A-to-B release change
with the same baseline/file/tag retained A's autocomplete context. The initial seven
new regression cases failed before the fixes; the completed suite has nine scenarios.

All ClientText catalog sources now pass `assertGame` before publication, including
ready/retained cache reads, explicit preparation and active references. Failure reports
the unavailable reference and drops only its derived session index. Original cached
workbooks, Saved translations and history remain intact. An unavailable validator
also withholds ClientText references.

Popup origins/cache keys include the complete reference-session scope and access
context. Synchronous scope fencing clears autocomplete and transient pointer/request
state; catalog and popup generations reject pending results across rapid A-to-B-to-A
transitions. Stale invocations cannot invalidate current work. Explicitly pinned cards
keep their frozen opening context and cannot retarget current-release lookups.

Green checks derived from the supplied reproductions show zero foreign ClientText
sources, a reported game-mismatch error, and release B in both the selected scope and
popup scope. The real browser fixture additionally verifies five same-baseline
release/branch transitions, three pending A/B/A responses and wrong-game reference
rejection. Dictionary/TM resource sync and export/source-byte browser fixtures also
pass. No queued feature work, API code, stored originals, or sample files changed.

## Next separate step: DNT

A case-insensitive English-field DNT substring scan finds 220 fields in PoE1, including
82 rows mixing DNT and nonblank ordinary fields. PoE2 Thai has 1,434 such fields and
109 mixed rows. These are research counts, not a new detection contract. Field-level
hiding must use the intended SD-equivalent detector while retaining visible siblings,
immutable source/field identities, saved values, status/export facts and history. Hiding
a complete row whenever one field contains DNT would lose valid work. No DNT filtering
or status/export change is implemented by this task.
