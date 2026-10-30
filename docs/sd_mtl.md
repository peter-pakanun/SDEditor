# StatDescription field toolbar and MTL

Both the inline and full SD editors use the shared field toolbar: Bold, Italic,
Underline, MTL, comparison and revision history. SD has no Use English action or
decision metadata. English fields remain read-only. Restoring history saves the
whole file, using the existing completeness, revision and recovery guards.

MTL visibility uses the same function as ClientText: signed-in Translators and
Managers need an assigned account language; Admins always qualify. A selected
editor language is not an assignment. Translators cannot generate for another
language. Admin model settings and request details remain Admin-only. The
personal consent and shortcut settings are shared across modes. Generation
requires a connection, including when the ZIP itself is local.

## Formatting and validation

SD inserts `<tag>{{text}}`, whereas ClientText normally inserts `<tag>{text}`.
The SD formatting buttons preserve the source's exact aliases (`bold` versus
`b`, for example). The preview supports bold, italic, underline, nested wrappers,
colour parameters, variables and linked display text. Single-brace SD wrappers
are malformed; formatting identities/counts must still match English before
Save. The toolbar does not relax those existing rules. Formatting edits retain
native undo/redo and the selection, including table cells.

MTL validates whole protected-token identities and counts per table column,
exact formatting headers/counts, balanced syntax, nonblank output and line breaks.
The entry/table-cell selector never turns an SD variable or metadata field into
translation text. Whole-file Save still requires exactly the English entry count
and no blank entries. Optional diagnostic scans are not run when opening a field.

## Review and persistence

Suggestions and edited review text are private, source-bound browser records.
Typing, formatting, Dictionary insertion and previewing a suggestion leave the
ordinary draft and committed translation untouched. Accept transfers reviewed
text to the ordinary draft; normal Save applies the complete file. Dismiss
restores the underlying draft. Unaccepted suggestions are never exported or
learned by TM. Review validation is visible without changing workspace statuses.

IndexedDB v26 adds `sd_mtl` and fences older writers. Candidate acceptance commits
in the same transaction as the complete translation, history, retry outbox and
Save receipt. A changed candidate aborts the transaction. Exact receipt replay
does not consume or overwrite a newer suggestion. Pending attempts retain their
request IDs; **Check attempt** recovers that request without repeating inference.
Account, language, game, branch, group, source, filepath and field fences prevent
late responses from entering another editor scope. Context changes never clear
the existing database.

The API advertises `capabilities.statdescription` with
`sourceRetention: 'transient'`. SD generation does not call ClientText's durable
source/prompt review archive. The API retains quota/request hashes, scoped
identities, generated target results and provenance; English, stat metadata,
Dictionary context and executed prompts stay transient. Admin diagnostics keep
the existing bounded session-local lifetime. SD has no source catalog, extracted
source artifact or new SQLite source table. Original English and metadata still
come from matching immutable ZIPs or verified browser caches.

Deploy the compatible API before the frontend, then reload existing tabs. The
capability check prevents new SD generation against an older API. Existing
ClientText requests, consent, source retention and exact retries are unchanged.

## Context and prompt research — 2026-10-30

The selected field is the translation task. Its complete entry, immutable stat
IDs, numeric conditions and remarks supply bounded context. Matching active-game
Dictionary definitions and alternates contribute terminology. Up to two valid
committed/original variants of the same stat file may provide examples. Drafts
and provisional suggestions do not enter examples. Direct keyword definitions
and structurally valid approved target titles/content are included when matching
references are already available. Missing definitions provide no facts.
Oversized optional examples/definitions are omitted whole, rather than cutting
tokens or passing partial approved translations. Context is quoted data, without
tools, executable paths, NPC/tone inference or an extra lookup loop.

Live tests used the configured Admin Cloudflare model at high effort. Initial
and revised prompt rounds exercised four synthetic mechanics/syntax examples
each: added damage, nested double-brace/RGB formatting, tables/newlines and a
conditional more-damage modifier. All eight responses passed SD structural
validation. The first conditional Thai result copied English word order too
closely; explicit target-language word-order guidance improved the next result.

Three further tests used actual English entries read from the existing exported
Thai StatDescriptions ZIP in the 2026-10-16 audit fixture:

- `active_skill_has_%_standard_scaling_attack_damage`: placeholder and protected
  DefaultAttackDamage link.
- `off_hand_minimum_added_physical_damage_per_5_shield_armour_and_evasion_rating`:
  two placeholders, an explicit newline and three protected links.
- `virtual_number_of_wolves_allowed`: a text/numeric table entry.

All three passed structural checks. The no-glossary round used noncanonical Thai
terms for flat added damage, Armour/Evasion Rating and Limit. The next prompt
explicitly distinguishes flat added, increased/reduced and more/less mechanics;
a controlled glossary round supplied approved equivalents and all three new responses used them while passing structural validation. The live total was fourteen requests: eight synthetic and six from actual exported SD entries.
These samples establish transport/syntax behavior and expose terminology issues;
they do not establish translation quality for every stat or language. Human
review and ordinary Save remain required.

Validation includes the real desktop browser in all four themes, native
IndexedDB acceptance/receipt replay/rollback, API authorization and retry checks,
and SQLite inspection proving that source/prompt/context canaries are absent.
Live outputs and screenshots are disposable under `temp/` in the two checkouts.
