# ClientText reference portraits

Inline and full ClientText editors show reference artwork beneath the first English field and its audio controls. The row-number column and the separate game-text preview are unchanged. The leftmost contextual NPC appears first, followed by distinct explicit Character and NPC references. Context is not a claim about the actual speaker; Character Filter is a listener constraint.

The public frontend contains only public/clientTextPortraitCatalog.js (identifier mappings) and display code. It contains no portrait images, encoded image payloads or image-source URLs. The catalog is generated from the reviewed installed-client tables and sprites. Exact NPCs.Id joins through Portrait and NPCPortraits.PortraitFile to the sprite. Game-specific paths and forms remain separate; display names are never an artwork alias fallback. Family evidence chooses a contextual variant when unambiguous. Known NPCTextAudio portrait overrides require the exact record and matching explicit NPC metadata.

Character metadata resolves through the built-in exact-path catalog even when the workbook has no Characters sheet. In PoE2, Metadata/Characters/Int/IntFour is Witch and Metadata/Characters/Int/IntFourb is Sorceress. Both icon sizes resolve to their preferred 900x866 full portraits. All twelve known PoE2 Character paths are included. Marauder, Duelist, Shadow and Templar use the user-approved provisional 629x579 sources, with an asterisk and explanatory tooltip; review them at PoE2 1.0. No released portrait is asserted for these four. PoE1 metadata uses its own exact paths and available source mappings.

NPC forms retain their source mapping: Doryani's helmet portrait is distinct from Doryani, and Hooded One night lighting is distinct from the normal form. RavenBoy and RavenBoyHub map to ChildTangmazu; StrangeVoice has no portrait and is not assigned the boy image by shared display name. All three LoyalCompanion/Squire records have null Portrait and remain named placeholders. Objects and Info references are excluded from NPC artwork assignment. Unsupported or ambiguous paths also retain placeholders.

The API serves GET/HEAD /portraits/<poe1|poe2>/<id>.webp?v=4. It only reads reviewed, bounded, digest-verified local WebP files; no request fetches an upstream URL. The private API repository packages the runtime manifest, provenance and prepared images in assets/portraits, so its normal git-pull redeploy includes the artwork. Raw PNG/DDS originals and earlier source research remain in ignored API data storage. Deploy the API before the frontend. An old/missing API image does not prevent local editing.

Images use a transparent 320x360 prepared canvas displayed at up to 160x180 CSS pixels, preserving source aspect ratio and alpha. Two fit side by side where space permits. Larger groups overlap within the English column, with the leftmost on top; hover/focus expands them and Escape collapses them. Images load lazily, decode asynchronously and use the API's private browser cache/ETags. Failed images show named placeholders and retry after connectivity returns. No guaranteed offline prefetch is performed.

The reviewed package has 143 preferred image entries: 35 PoE1 and 108 PoE2, including variants and non-character sprite entries. These are not 143 distinct NPCs. The static catalog has 86 PoE1 and 416 PoE2 verified NPC paths, plus exact Character paths. In the supplied partial Thai_with_hint.xlsx fixture (no Characters sheet), 23,084 of 43,777 rows (52.7%) have at least one reference image. NPCTalkDialogueTextAudio reaches 11,486 of 11,727 rows (97.9%). Other related portraits may still be missing; identity/variant reference counts overlap. The coverage script reports per-sheet counts and does not export authored translations.

Checks:

```text
node scripts/test-clienttext-portraits.cjs
node scripts/test-clienttext-ui.cjs
node scripts/clienttext-portraits-browser-fixture.cjs
node scripts/clienttext-portrait-coverage.cjs <workbook.xlsx> <language>
```

The browser fixture uses real packaged API image delivery and the shared English field, verifies both key dual-portrait examples, all twelve static Character paths, four themes, resized desktop windows, fallback/reconnection and keyboard expansion. It establishes local behavior, not hosted authentication or deployment readiness. The frontend npm test remains a stub; use the direct checks. Existing unrelated aggregate test failures are not changed by this feature.
