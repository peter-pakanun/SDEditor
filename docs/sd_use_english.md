# StatDescription Use English and upstream recovery

The full SD editor offers **Use English** as an explicit whole-file choice for
PoE1 and PoE2. It is a workaround for upstream exports that omit intentional
English-identical translations. ClientText's separate field-level fallback
protocol and blank-target behavior are unchanged.

## Translator workflow

- Open a file in the full editor. Its draft must contain only blank entries or
  entries exactly equal to their corresponding English text. Different authored
  translations, unresolved conflicts, unfinished alignment, DNT and any visible
  pending review prevent activation. Retired hidden MTL records remain preserved
  and do not block this workflow. The disabled control explains the reason.
- Choose **Use English**. This fills every entry with its exact English text and
  saves the complete file through the existing validation, draft, history,
  worker, receipt and optional Dropped-promotion transaction. SD requires
  complete nonblank targets, so exported Thai contains English text rather than
  an empty block or a placeholder. English and other-language metadata retain
  their existing export rules.
- The active button remembers this choice for the selected account/workspace,
  game, branch, filepath and language. On actual source advancement, an omitted
  or blank incoming target block does not recreate Missing/Dropped while English
  and its entry metadata remain unchanged. An incoming block already equal to
  the approved English also retains the decision. Ordinary English-identical
  saves never infer approval.
- Choose the active button again to remove the remembered choice. This saves
  the current draft and preserves its authored text. A later ordinary Save with
  different translated text also removes approval. An English or metadata
  change, a different nonblank upstream target, or removal of the whole file
  follows normal source advancement/recovery. Approval never silently overwrites
  a new upstream translation or reactivates through a later source reversion.

The choice is **whole-file**, not an entry-level blank-target exemption. A
mixed-language file cannot use this shortcut to overwrite its translated
entries. Shared work requires the compatible API; disconnected operation keeps
the normal durable outbox semantics. Local work stays local. A translated ZIP
carries the actual English target text, not decision metadata; shared history or
the browser's retained workspace preserves the explicit choice.

## Excess incoming translation rows

An unresolved copy remains Dropped under the existing lifecycle. When the
incoming ZIP has more target entries than English, the preserved target is
complete for current English, and verified origin English **and metadata** match
the current source exactly, its full-editor banner uses information styling:

> The incoming ZIP still contains extra translation entries. English and entry
> metadata are unchanged, and the complete saved translation is preserved.
> Upstream may have retained obsolete variants.

The notice reports actual counts and explains that the translator can continue
other work and export Saved files. **Use preserved translation** performs the
existing revision-checked, owner-specific promotion and Save. It needs no second
generic confirmation for this verified case; current save validation and scope
guards still run. The comparison remains available in collapsed details. Genuine
source changes, missing source evidence, incomplete recovery and competing
copies retain their existing warnings and review guards.

This presentation does not declare the upstream importer broken, rewrite the
immutable baseline, export an incomplete target, resolve another recovery owner,
or hide actual committed Missing/Error counts. Until the preserved copy is
saved, its original committed count mismatch remains factual. Existing normal
Saved-file export and unrelated saves/navigation remain available; full export
continues excluding unresolved incomplete Dropped-only work.

## Persistence and rollout

`sd-use-english-v1` decisions contain an action ID, an active state and SHA-256
fingerprints of English and its metadata. They accompany the complete authored
target in scoped staged records, collaboration before/after history, events,
receipts and frozen collection content. They do not add source catalogs or
English metadata copies to SQLite. No existing record is automatically approved.
Revocation is a revisioned save without active decision metadata; exact old
receipts remain replayable and cannot restore an already revoked choice.

Browser IndexedDB **28** fences older pages/workers without removing stores or
pending commands. API schema **31** adds the small authored `english_intent`
column. It validates decisions against accepted original file facts and exact
English targets, advertises `statDescriptionEnglishIntent: sd-use-english-v1`,
and rejects unaware writes to active intent-bearing files. New client requests
carry the active decision or explicit null; existing retry bodies remain exact.
Initial legacy-room saves, sparse rooms, named SD groups, managed advancement,
shared conflicts and normal history restore use the same decision boundary.

Deploy the API first, stopping older writers before the schema upgrade. Retain a
pre-upgrade backup and the existing required artifacts. Deploy the frontend next
and reload old tabs/workers; do not clear storage. Older schema-30 binaries must
not reopen the upgraded database. No production deployment is implied by these
local changes.

## Validation

Focused checks cover explicit versus inferred intent, repeated source carry,
source/metadata changes, conflicting upstream targets, revocation, ownership,
peer decision conflicts, immutable originals and exact receipt replay. API
regressions cover accepted facts, CAS, access, unaware-writer rejection, managed
publication and named-group carry. The disposable desktop fixture checks pointer
and keyboard controls in four themes/resized windows, informational recovery,
unrelated Save, native IndexedDB/worker persistence and replay, page reopen,
exported English and revocation.

Replaying the inspected November 9/11 archive evidence also identifies all 13
excess-row files (including the additional advanced Shaper file) for the bounded
informational notice. All 27 omitted English-identical target files carry only
after explicit approval. This is a local projection of the previously inspected
artifacts, not a new observation of the upstream pipeline.

```text
node scripts/test-sd-use-english.cjs
node scripts/test-save-worker.cjs
node scripts/test-sd-editor-tools.cjs
```

For the desktop fixture, set `SDEDITOR_SD_USE_ENGLISH_ONLY=1` and run
`node scripts/shared-editor-browser-fixture.cjs`. Evidence goes to ignored
`temp/sd-use-english-20261112/`. These local checks do not establish hosted
deployment, OAuth or live upstream importer behavior.
