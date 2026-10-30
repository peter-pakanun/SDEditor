# PoE1 full export validation — 29 October 2026 exports

Audited locally on 30 October 2026 against the current frontend working tree
(base commit `8d7107557dd0dcbdc730588b0923b1d1dcf40f87`, including existing local changes).
Inputs: the 14 original XLSX files in the supplied `2026-10-29_POE1` folder.

**Result: all 14 workbooks are compatible with the current ClientText parser and
edited native export. No application/parser change is needed for this supplied set.**
This extends the [earlier Thai-only PoE1 audit](poe1_workbook_compatibility.md) to
all nine supplied languages and their five Gender companions.

## Supplied coverage

Counts below apply to each individual workbook, not to a deduplicated language bundle.

| Languages / role | Files | Sheets per file | Records per file | Editable fields per file |
| --- | ---: | ---: | ---: | ---: |
| French, German, Portuguese, Russian, Spanish — normal | 5 | 241 | 83,048 | 292,573 |
| The same five languages — Gender | 5 | 9 | 73,776 | 205,248 |
| Thai, Japanese, Korean, Traditional Chinese — normal | 4 | 247 | 148,556 | 368,440 |
| Total across the supplied files | 14 | 2,238 | 1,378,344 | 3,962,865 |

Every file parsed with `clienttext-v4` and **zero warnings**. An independent raw
OOXML scan matched every parsed sheet/record count and every editable field count;
no data-bearing translation column was omitted. Sheet/header/ID sets are identical
within each of the three families. All filenames resolve to the intended language
and normal/Gender role; the five pairs match the editor's existing pairing policy.

## English coverage across languages

For this comparison only, strip the terminal `_Gender` sheet suffix and compare
exact sheet + record ID + English field name. This normalization is analytical;
stored role/sheet/field identities remain distinct.

- Each normal/Gender pair has exactly the same 148,556 normalized sheet/ID records
  as Thai, with no missing or extra records.
- The 8,268 record overlaps in each pair are confined to `MTXTypes`, where normal
  and Gender files contain different fields. There are no duplicate source-field keys.
- Every common English field matches exactly. The pair has 366,349 distinct English
  field keys versus Thai's 368,440. All 2,091 absent keys are empty `MTXTypes`
  English cells whose Thai targets are also empty: 195 Display Name cells and
  237 cells in each of eight other fields. No nonblank English is missing.
- Japanese, Korean and Traditional Chinese match Thai's complete English field-key
  set and exact English values.

These differences reflect the export split; they do not establish missing editor support.

## Gender and reference fields

The nine Gender sheets are `Chests`, `BaseItemTypes`, `MonsterVarieties`,
`Words`, `WorldAreas`, `MTXTypes`, `Mods_Gender`, `Words_Gender` and
`NPCTextAudio_Gender`.

Existing parsing handles the Translation/Gender pairs, the six grammatical forms
`MS/FS/NS/MP/FP/NP` in Mods/Words, and `MS/FS` dialogue forms. Each Gender file
has 31,834 ordinary text fields, 31,834 Gender fields and 141,580 form fields.
No PoE1 class-name or PoE2 Four/Fourb class-form columns occur in this set.
The 1,324 French Gender `NONEXISTENT` targets are accepted without warnings.
Gender strings, including blanks, `N/A`, `-` and singular/plural codes, remain exact.

Italic Character Class, Generation Type, Tags and Translation Note headers remain
reference information or developer notes. They are not turned into editable
translations. No unsupported nonitalic translation/form headers or unheaded data
were found.

All nine normal workbooks independently identify as PoE1 from internal evidence.
The five Gender workbooks contain no independent game markers, which is already
supported: they retain the explicitly selected release scope. A filename does not
prove their game. The audit script now tests this case instead of incorrectly
requiring game markers from a partial Gender export. Normal samples still require
game evidence and reject the opposite game.

## Native export and source preservation

Every supplied original passed a byte-exact no-op export. The all-sheet edited
sweep changed 3,668 target fields across all 2,238 worksheets, including empty,
whitespace-only, XML-sensitive and Excel-escape-like text.

The sweep verified exact authored target values; unchanged package entry sets;
byte-exact source, notes, metadata, unrelated targets and other native parts;
unchanged original style/fill records; and every edited target's non-fill style
properties. Original input bytes and all 14 on-disk SHA-256 hashes remained exact.

The independent package audit found no formulas, Excel error cells, duplicate IDs
within a sheet, data rows without IDs, comments, audio-hint headers, VBA parts,
drawings, external links or merged cells. Native target fills are white,
Missing red and Outdated orange. The German normal export has nine nonblank
targets against blank English; each other normal file has one. These original
values are preserved, not removed or treated as invalid SD translations.

## Regression and browser checks

Focused existing checks passed: 80 codec/filename tests plus 180 state,
NPC/conversation, formatting and MTL-context tests (**260 passed, zero failed**).

The durable desktop browser fixture passed its `--native-input-only` branch using
the new PoE1 Thai workbook and the historical PoE2 Thai control. It verified real
native-file imports, Save/history, timer-only CRLF drafts, exact original retention,
reload and browser restart, plus interrupted PoE1 atomic-Save crash recovery,
receipt/history atomicity and DNT visibility. Browser errors and HTTP writes were
both empty. The PoE1 original retained SHA-256
`dca689dfc235b5a1ea0c41714235be2ba9b5cd6347b5028c6a2d130618cf8bc0`.

The actual PoE1 editor was captured at 1440×1000 in all four themes; light and
modern-dark were visually inspected. This branch does not run the full default
browser export workflow; all 14 native exports were checked separately by the
codec/package audits above. An ignored temporary harness changed only the browser
fixture's stale schema assertion from 25 to the current 26. No tracked fixture or
application code was altered. Browser results and screenshots remain under the
ignored audit directory.

## Scope and limits

This is technical compatibility validation of the supplied nine languages, not a
linguistic translation review or coverage evidence for languages not supplied.
It does not establish a hosted deployment or a real managed publication/collection.
No original workbook was edited or uploaded, and no translation/model request was made.

The existing PoE1 feature boundaries remain: these exports contain no conversation
table or authoritative audio hints, and PoE1 playback and PoE2 skill-card navigation
are not enabled by this audit. Generic fields, grammatical forms, NPC navigation
and native export are supported by the evidence above. No source identity,
storage schema, accepted translation, history or application code changed.

## Reproduce the all-workbook audit

From the frontend repository in PowerShell:

```powershell
$poe1Books = @(Get-ChildItem -LiteralPath 'C:\Users\lpeac\Downloads\2026-10-29_POE1' -Filter '*.xlsx' |
    Sort-Object Name | Select-Object -ExpandProperty FullName)
node scripts/validate-clienttext-compatibility.cjs poe1 @poe1Books
```

The script reads originals and creates edited packages only in memory. Disposable
raw-audit scripts, count-only results and run logs are under
`temp/poe1-20261029-audit/`; they are ignored by Git.

## Input identity

| Workbook | SHA-256 |
| --- | --- |
| `French_Gender.xlsx` | `78a4cb985cc15f6446950cf8bb0e94c951dd78ab9725aa04f74831474ece45b0` |
| `French.xlsx` | `8ce46a7bcc7afb26e57aaf4a486a8716ed17e7419a9b6fc49bab3326452faa84` |
| `German_Gender.xlsx` | `2399400dafec5f60a17d496cc272faad65a53d990d9f8326c516c124cc0b772a` |
| `German.xlsx` | `1e374fbe708c4b5555ed49ee14a2593699b91689ce4c1e57cbc0c2d0bdfd398a` |
| `Japanese.xlsx` | `863b8bb4af331df311d936d38490f2fca27584d193fdb55be6261f8145c618a0` |
| `Korean.xlsx` | `f8d9e44789acf4685533401359cf3eb75c04a3061eeb8eee4093a057ecec518e` |
| `Portuguese_Gender.xlsx` | `50478aa3de3937e713dc574788a5a8e4861f98b28cdda0a8bc366e9fdfb666bc` |
| `Portuguese.xlsx` | `b473c10e3d1cf9442e4ef8e3a303ce6ef7ced61b39239875c347f41c86b24ca1` |
| `Russian_Gender.xlsx` | `66350147aa297754af41ce072e891a38a14eaf8c3e49916194da1e94cfc98748` |
| `Russian.xlsx` | `c833fcadf352463ac886c6b28cbbe771eed4d26c21373e2918f5cf198a3ff3e2` |
| `Spanish_Gender.xlsx` | `460d7137991a81572a4c312d9a5f5ce01745391dd7334fef279aee6315d485cd` |
| `Spanish.xlsx` | `1e0a107c36e0366d1c5bcd7898f5157e0941b6ea513d405a276357e544634913` |
| `Thai.xlsx` | `dca689dfc235b5a1ea0c41714235be2ba9b5cd6347b5028c6a2d130618cf8bc0` |
| `Traditional Chinese.xlsx` | `d0ee617cb0a42a5961b52e1e7bc03872bfb21c594754a939686d00f0bb7ba54f` |

