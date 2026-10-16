# Contextual skill-card previews

The isolated `ClientTextSkillCards` module composes preview models from a private,
versioned relationship catalog and immutable ClientText units. It does not change
workbook parsing, saves, source identities, exports or status calculation. The
private catalog is generated from verified active/meta gem relationships rather
than a skill-specific list. Other item types, support layouts and arbitrary
workbook sheets remain outside scope.

## Implementation and integration status

`public/clientTextSkillCards.js` provides the pure composer and catalog validator.
`public/clientTextSkillCardUi.js` loads the protected catalog, mounts the shared
inline/full card and manages its artwork. `index.html`, `clientTextUi.js`,
`editorComponents.js` and `index.js` connect it to the existing preview and
variable list. Cards apply to verified active-skill descriptions,
names, gem item names and mapped related tags/labels. Short descriptions retain
the ordinary field preview because they belong to a different game surface.

The card consumes independent `source` and `target` models and passes text through
the existing
`buildGamePreviewSegments(text, {contentMode: 'clienttext'})` method. Render those
segments as text, variables and existing keyword controls; do not use `v-html`.
The English and translated sides retain their own font selection and pass the
correct side to the existing keyword-popup handlers. A missing
translated value remains blank and has `available: false`; it never silently uses
English. Incomplete reference workbooks can still show a verified primary card.

One resolver is retained for the active immutable unit array, catalog revision
and full scope. Composition follows selected fields, drafts, Saved values and
preview examples. Unsupported or incompatible rows retain the single-field
preview. Shared tags/labels retain the last explicit skill context when it still
matches; otherwise they require a choice. The chooser remains available to switch
between matching skills. Context is cleared on account/source/language/access
changes and never defaults to a particular skill.
The mounted card shows a heading, tags, examples, description, mode tabs and
footer; unresolved combat rows are omitted explicitly. Decorative frames use
CSS. The full editor gives contextual cards a larger initial preview height and
retains manual resizing.

Clicking the skill name or description, or Alt+Clicking any mapped workbook text,
navigates to its exact editable translation field in the selected workspace
language, from either preview side.
Related-sheet navigation checkpoints the outgoing draft using the existing
guarded selection flow and refuses to move after a failed checkpoint or scope
change. Related checkpointed drafts are read locally for the current card and
remain visible alongside its live current-field draft. A subtle dotted hover
underline and tooltip explain the gesture without adding controls to the card.
Ordinary keyword hover/click and keyboard actions keep their existing popup/pin
behavior; Alt+Click on a mapped keyword navigates once without pinning a popup.
Other labels require Alt+Click; ordinary mode-tab clicks only select the mode.
Missing catalog-only English has no edit action. Preview sample values remain
independent controls rather than workbook text.

## Generated coverage

The reviewed client build supplies 1,191 gem records: 642 support-layout records
are excluded and 549 active/meta records are considered. Exact workbook/client
matching currently enables 423 cards. The other 126 have source mismatches (49),
missing or ambiguous text (57), or missing workbook rows (20); they retain ordinary
field previews. This is coverage of compatible translation records, not a claim
that every record is a released or currently obtainable gem.

The generator uses the authoritative SkillGems → GemEffects → GrantedEffects →
ActiveSkills join, preserves displayed GemTags order, and resolves named visible
statset labels. Null/internal Hidden/Shown labels are not invented. Secondary
granted abilities are recorded in private coverage evidence and do not receive
guessed tags or independent layouts. Runtime combat rows remain omitted.

Artwork coverage is separate: all 423 cards have indexed local icon/inventory
references and 87 have local UI-sprite illustrations. The published catalog uses
only the private asset worker's verified active-skill/gem mappings: 193 distinct
asset identities currently serve 197 card-icon mappings, 196 inventory mappings
and 63 illustrations. Several cards can share an asset identity. Missing art
keeps the text card usable.

Repeatable extraction and generation live in the private API's
`scripts/skill-cards/`; the deployed catalog and detailed coverage remain under
its `assets/skill-cards/`. The extractor verifies the installed Steam build,
schema row lengths, table/index hashes and UI sprite definitions using the
already installed trusted tool. The generator emits stable relationship IDs,
English fingerprints and a content-versioned revision, with no translated
targets. Image IDs come from the matching verified private asset manifest.

## Private catalog contract

Endpoint: `GET`/`HEAD /v1/skill-card-catalogs/poe2/v1`, with no arbitrary file,
URL or query parameters. The private API serves its reviewed
`assets/skill-cards/poe2-v1.json`. The public frontend ships
only schema and logic, never extracted descriptions, target translations or art.

Use the same current-session and language authorization as the private skill
asset endpoints: bearer header, server-side current-account/assignment checks
and revalidation before delivery. These endpoints return language-neutral data;
the frontend omits the optional language selector and keeps its selected-language
guard in the captured UI context. Response data is
`private, no-store`; the browser uses `cache: 'no-store'`. Catalog contents do not
grant access. Missing or denied catalog access leaves ordinary local editing and
the single-field preview available. Do not persist this response in IndexedDB or
put tokens in a URL, Vue state, diagnostics, exports or catalog keys.

The JSON structure is:

```js
{
    schemaVersion: 1,
    game: 'poe2',
    revision: 'opaque-reviewed-revision',
    clientBuild: '12345',
    sdArchiveHash: '64 lowercase hex characters', // optional raw ZIP SHA-256
    cards: [{
        id: 'example',
        activeSkillId: 'example_skill',
        baseItemId: 'ExampleGem',
        title: fieldReference,
        itemTitle: fieldReference,
        description: fieldReference,
        shortDescription: fieldReference, // optional
        tags: [{position: 'type', ref: fieldReference},
               {position: 'tag', ref: fieldReference}],
        tabs: [{id: 'example-mode', label: fieldReference, lines: [statReference]}],
        qualityLabel: fieldReference, // optional
        qualityLines: [statReference], // optional
        footer: fieldReference, // optional
        examples: {level: fieldReference, quality: fieldReference,
                   cost: fieldReference, criticalChance: fieldReference,
                   costFormat: fieldReference}, // optional, all five if supplied
        assets: {id: 'example', icon: true, gem: true, background: true} // optional
    }]
}
```

`fieldReference` contains `sheet`, `recordId`, `field`, `source` and `sourceHash`.
`field` is the codec's original field name, not its column position or target ID.
`sourceHash` is `ClientTextState.sourceHash(source)`. The only accepted sheets are
ActiveSkills, gem-related BaseItemTypes, GemTags, GrantedEffectLabels and selected
ClientStrings. IDs are exact and case-sensitive. The composer never joins display
names. The private reference's English fallback is identified as `client-catalog`
when the workbook lacks that related row; no translated fallback is supplied.

`statReference` contains `id`, `filepath`, `entryIndex`, `stats` and `sourceHash`.
The path identifies a single-description file in the accepted original SD ZIP;
`entryIndex` selects a verified non-table entry. `stats` preserves its ordered stat
identities and `sourceHash` fingerprints that entry's English string. The catalog
stores references, not a new full SD source catalog or authored target history.
Raw multi-description client CSDs cannot be passed directly to the existing
single-description parser.

The raw ZIP hash remains distinct from SD `baselineId`, source-manifest hashes and
workbook artifact hashes. Never substitute one identity for another, rewrite a
baseline, or import a catalog as translation work. New source versions require a
reviewed relationship update or a matching compatible subset, not a blind remap.

## Composer API

```js
const resolver = ClientTextSkillCards.createResolver(catalog, immutableUnits, scope);
const choices = resolver.candidates(currentUnit);
const model = resolver.compose({
    scope,
    unit: currentUnit,
    fieldId: currentField.id,
    cardId: selectedRelatedCardId, // optional when exactly one candidate exists
    saved: savedByUnitId,
    draft: {scope, unitId: currentUnit.id, values: currentDraftValues},
    variables: existingPreviewVariableValues,
    sd: optionalVerifiedSdSnapshot
});
```

Scope must contain `accountId`, `game`, `groupId` and `language`; it also captures
`branchId`, `versionId`, `sourceHash`, `baselineId` and `accessKey` when supplied.
Pass an opaque access/session generation as `accessKey`, never the session token.
An async catalog/asset loader must capture and compare the same context before
publishing results. A change of account, language, game, source or access
generation makes an old resolver unavailable. Invalid/missing primary source
matches and ambiguous rows retain the normal preview rather than guessing.

`compose` returns `state: 'ready' | 'partial' | 'unavailable'`. These are transient
preview availability states, not persisted workspace statuses. Successful models
contain `skillId`, `revision`, `clientBuild`, `assets`, `compatibility`, `warnings`,
and independent `source`/`target` sides. Side entries contain raw `text`,
`available`, `focused`, and, for workbook fields, `reference` and `origin`.
Tabs preserve their catalog IDs. Missing SD data omits stat rows and the orphaned
quality heading. The current same-scope row draft overrides Saved values including
intentional blanks. Other rows use `ClientTextState.valuesFor`.

The user explicitly requested four editable preview examples with these rendered
defaults: Level 1, Quality +10%, Cost 5 Mana, and Critical Hit Chance 7.00%.
`EXAMPLE_KEYS` supplies distinct keys for the existing variable-list model;
`exampleDefaults()` returns a new default value map, `defaultExampleValue(key)`
provides one default, and `resetExamples(values)` returns a copy resetting only
these four keys. Preserve other text-template variables when resetting.
`compose({variables})` derives each side's `properties` using its workbook label
references and cost format, without editing fields, drafts or Saved values.
The quality and critical labels retain keyword markup and must use the normal
segment/keyword renderer in both the card and variable-list labels. `variableKeys`
and `exampleValues` describe the four controls; `invalidExampleKeys` lets the UI
mark invalid input. Numeric validation rejects markup, non-finite values, range
violations and fractional levels; invalid input renders the requested default.
Critical chance renders two decimal places. These are labelled preview examples,
not claims about the selected gem level or current character.

The four keys are appended to `ctPreviewKeys` and `gamePreviewVarKeyList` for an
available card, using the existing `ctPreviewGggVars`/`gamePreviewVarValues` map.
`defaultPreviewVarValue` delegates these keys to `defaultExampleValue`. The
variable list renders property labels through the keyword renderer. Reset changes
only this preview map; no sample value enters `ctValues` or a save command.

An optional SD snapshot contains `accountId`, `game`, `language`, `archiveHash`,
and `files`. Each file has `filepath`, ordered `stats`, and `translations`, as
returned by the existing parser. A caller may materialize the appropriate current
Saved translations before passing it. It must load from the verified original
ZIP/current scoped source adapter, not an unrelated editor's pending drafts.
The composer checks the exact catalog archive hash, account, game, language,
entry fingerprint and stat identities. Mismatch omits that line. Numeric
placeholders remain raw; no combat calculations, implicit numeric defaults,
requirements formula or socket state is supplied.
Omit unresolved numeric stat rows from the mounted card rather than filling their
placeholders with the ordinary generic variable default. The four explicitly
requested examples above are separate controls, not values for arbitrary `{0}`
tokens in SD lines. An SD template inspection mode can show those raw templates
without claiming resolved combat data.

## Protected artwork adapter

The confirmed image endpoints are `GET`/`HEAD
`/skill-assets/poe2/<reviewed-id>/{icon|gem|background}`. Only the proxy's reviewed
IDs are allowed. The model returns opaque asset identity/kind flags and no URLs.
Use the shared authenticated asset loader: bearer request header,
`cache: 'no-store'`, validated image response, then a Blob
URL. Revoke old Blob URLs and abort pending work when replacing a card, switching
scope/access, signing out or destroying the component. A failed asset request
leaves the textual card usable. Never fall back to a direct CDN or guessed path.

The initial remote illustration is 699 by 369 pixels; the local client sprite
crop is 700 by 370, from a padded DDS. They are different conversions of matching
artwork. Preserve aspect ratio and avoid claiming byte or pixel equivalence.
The world visible through the in-game tooltip is live scene content and is not
part of the static card asset.

`privateAssets.js` validates bounded media types and signatures, supports aborts,
checks captured access before and after asynchronous work and owns revocable
Blob leases. `privateMediaUi.js` supplies current cloud authentication and the
selected language privately. Portraits and explicit audio playback use the same
loader. Native image/audio elements receive Blob URLs only. Logout, role,
assignment, account, source and language changes revoke leases; replacement and
unmount also abort pending downloads. Healthy cloud refreshes preserve media.
The catalog is memory-only and all media/catalog requests use `no-store`.

## Frontend-first rollout

The previous API (`94e727a`) allows `Authorization` in CORS preflights but not
`X-SDEditor-Language`. The frontend therefore sends only its existing bearer
header for language-neutral media and catalog requests. The current API accepts
an absent selector and still checks the current stored role, valid translator
assignment, session and assignment revision. The frontend also checks selected
workspace language before requesting and after asynchronous work. An explicitly
provided wrong-language selector remains forbidden by the current API.

An old API's missing catalog returns 404, leaving the ordinary text preview
available. Existing portrait/audio routes continue to receive authenticated
fetches. No denial triggers an anonymous retry, alternate route or public URL
fallback. Full contextual cards become available after the private API is
redeployed. This permits the public frontend to deploy before the VPS update;
it does not add authentication to an old server's previously public routes.

## KeywordPopups sheet preview

The KeywordPopups sheet assembles `Info Title` and `Info Content` using the same
`KeywordPopups.Card` and text component as existing floating cards: centered
title, separator and content. Typing updates the card before blur, with the
current record draft over Saved/original sibling values. English remains source
text; blank translated content remains blank and carries the existing missing
translation notice. The gamepad override has no separate desktop card layout.
Nested links retain the existing pin, focus, z-order and dismissal pipeline.
Pinned floating windows keep their opening snapshot across record changes.

## Validation

```text
node scripts/test-clienttext-skill-cards.cjs
node scripts/test-clienttext-skill-navigation.cjs
node scripts/test-private-assets.cjs
node scripts/test-private-media-ui.cjs
node scripts/test-private-image-ui.cjs
node scripts/test-clienttext-audio.cjs
node scripts/test-clienttext-portraits.cjs
node scripts/test-keyword-sheet-preview.cjs
node scripts/clienttext-skill-cards-browser-fixture.cjs
node scripts/clienttext-audio-browser-fixture.cjs
node scripts/clienttext-portraits-browser-fixture.cjs
node scripts/keyword-popups-browser-fixture.cjs
node scripts/clienttext-skill-cards-api-fixture.cjs
node scripts/private-media-rollout-browser-fixture.cjs
git diff --check
```

The focused checks use synthetic text and identities. Private sample validation
can additionally parse the actual workbook with `clientTextCodec`, validate the
reviewed catalog, resolve its exact records, and compare matching SD entry hashes.
This establishes composition and source compatibility. The browser fixtures use
synthetic text/media, isolated browser profiles and loopback servers to cover
examples, live drafts, full/inline keyword cards, themes, authenticated native
media and logout revocation. The API fixture additionally checks the actual
catalog contract, allowed roles and denied access against an isolated real API,
with injected synthetic upstream artwork. These establish local integration,
not hosted deployment or exact live character/game parity. The rollout fixture
uses actual cross-origin browser preflights against the old route/CORS contract
and the current real API. Neither fixture uses production accounts.
