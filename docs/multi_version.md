# Multi-Version Support

SDEditor separates PoE1 and PoE2, and retains named source versions within each game. Each game initially has one release branch, `default`; workspace, catalog and collaboration identities include the branch so future release branches can stay independent. The current UI does not offer branch creation or switching.

## Selecting A Version

When the app opens, choose **PoE1** or **PoE2**, then use **Versions** to choose a source workspace. **Online** lists manager-published versions with HEAD first for assigned Translators and Managers/Admins. Unassigned Translators cannot see the managed list or cached managed details; their local Offline workflow remains available. Selecting a row shows the authorized language teams' Missing, Saved, Revised and Dropped counts, translation-window state and online participants. Managers/Admins see all 12 teams and can open any team's editor without an assignment. Translators see their assigned team.

**Offline** retains the existing local workflow: import the previous ZIP, import the next/update ZIP, or import translated work. Give the standalone workspace a local name with **Save name**. A published version already downloaded into this browser can also be opened while disconnected; details may reflect the last cached server state. An uncached online version must be downloaded while connected first.

Selecting an existing version activates its stored source and workspace. It does not import it again, carry translations backward or forward, create Dropped assignments, or alter its baseline. Explicit **Import next/update** advances the source and calculates carry-forward and Dropped work. Both paths retain previous versions' saved work, drafts, recovery records and history.

The selected version controls:

- Imported source `StatDescriptions.zip`
- Local translated workspace
- Revision history
- Browser tab title

Both versions use the same Dictionary for a selected language. Dictionaries are separated by language and local/account profile. Regex rules, selected language, theme, and other preferences are shared between PoE1 and PoE2 within that profile. With Google backup enabled, Regex/preferences remain personal. Translators synchronize the shared Dictionary for their assigned language; other languages selected for local editing remain local. Managers and Admins synchronize the selected language's Dictionary with or without an assignment. Their assignment does not restrict access, and `all` is not an assigned language value. See [Cloud Backup and Shared Dictionaries](cloud_backup.md).

Each Dictionary entry has a **PoE1 / PoE2 / All** selector. Existing entries are **All**; new entries start in the selected game. The same Find or keyword identifier can have separate entries for each game, each with its own internal ID, translation, alternates and TL note. A game-specific entry overrides the **All** entry with the same Find (ignoring case and surrounding whitespace), including that All entry's alternates. All remains the fallback in the other game.

Entries for the other game stay visible and editable with a yellow warning. They are excluded from autocomplete, highlighting, keyword replacement, Regex Dictionary use, terminology diagnostics and automatic matching that moves relevant entries to the top. Changing an entry's selector keeps its row in place while you edit it. All rows remain part of the language's Dictionary, settings exports and shared history.

## Auto-Detection

When you use **Import Next Version** with a full `StatDescriptions.zip`, SDEditor checks the ZIP paths to detect the game version.

PoE2 is detected when the ZIP contains PoE2-only `specific_skill_stat_descriptions` structure, especially paths like:

```text
specific_skill_stat_descriptions/explosive_grenade
```

If the ZIP looks like a different version from the one currently selected, SDEditor asks before switching versions and importing there.

## Storage Split

For the recorded direction on reducing server baseline duplication and generating managed collections on clients, read [Local-first baselines and incremental server storage](local_first_server_storage.md). That design is pending implementation; this section describes the current storage and version behavior.

IndexedDB v8 retains source/workspace snapshots and active pointers separately:

| Data | Identity |
| --- | --- |
| Parsed source and workspace | Account/local profile + game + branch + accepted source baseline |
| Active version pointer | Account/local profile + game + branch |
| Local version names and cached catalog/details | Account/local profile + game + branch, with source identity for version metadata |
| History | `revisions_poe1` / `revisions_poe2`, filtered by account, branch, source and language |
| Drafts | Account/local profile + game + branch + source + language + file |
| Save receipts and queued shared work | Captured account, game, branch, source and language; original job/mutation IDs retained |

The old single-version `kv.source`, `kv.workspace`, `revisions`, and per-game `source_poe1`/`workspace_poe1` slots (and their PoE2 equivalents) remain as recovery evidence. The v8 loader copies each existing per-game slot into its recorded owner's default branch once. Unowned legacy work belongs to the guest profile. First sign-in can adopt guest source and committed work into an empty account workspace; it never copies another signed-in account's work. Original guest drafts, receipts and history remain under their original scope.

These stores retain the browser's current parsed source, language-specific staged translations, Dropped snapshots and local history. Immutable imported baseline caches are also kept in `kv`, keyed by game and accepted baseline ID. Saving, restoring or importing translated work does not rewrite that original baseline. IndexedDB stores collaboration caches, recovery copies and pending saves scoped by account and workspace.

Signed-in users automatically join a shared room for the same **game + branch + accepted source baseline + language** when their role permits it. A Translator joins only when the editor language matches their assignment. Managers and Admins join the selected language's room regardless of their assignment. The room's source identity differs between modern and legacy imports:

- For an original ZIP import, `zipHash` is the SHA-256 hash of the archive bytes. Repacking the ZIP changes this hash even if its parsed text is identical.
- The modern room's `sourceHash` is its `baselineId`, derived from `zipHash`, the accepted parser version and duplicate-language choices, and the parsed baseline tree's root hash. The ZIP hash alone is not the room identity. Collaborators use the accepted import configuration for that ZIP.
- Legacy workspaces without a cached ZIP descriptor use a hash of the canonical parsed English/source metadata manifest. They can join an existing legacy room; creating a new room requires importing the original ZIP.

Standalone imports use sparse synchronization: joining shares the small ZIP/import descriptor. A file's first save supplies its baseline witness and membership proof; the API retains that file's original translation for the room language, the saved override and authenticated change history. Manager publication explicitly uploads and retains the original ZIP and complete parsed baseline on the API so teams can download the same source and the manager can collect translated ZIPs. Older legacy rooms may retain uploaded source manifests and initial translation snapshots. Existing local revision history is never uploaded.

Publishing an identical accepted baseline associates existing local work and matching collaboration rooms with the catalog entry. It keeps the room ID, staged work, active draft and shared history; offline/online is a catalog association, not a second translation history. A published entry with the same raw ZIP hash is rejected within its game and branch. Different parser or duplicate-block decisions must not be silently treated as the same baseline.

Dropped copies synchronize separately by game, branch, language and file and can survive later source imports. Each copy preserves its old translation, original English and entry metadata where available, plus source-version provenance. Only versions recorded in `targetSourceHashes` have that Dropped assignment. Import advancement can extend unresolved assignments; selecting an old/new version or receiving an unrelated record cannot. Missing old source text stays unavailable. Dropped is separate from current ZIP/staged text: **Save** or **Confirm unchanged** stages a translation and resolves the copy; **Discard** resolves it without staging. A dropped snapshot is never exported directly. See the [workspace status contract](workspace_statuses.md) for Saved, Missing, Dropped and Revised rules.

Import Next Version activates a separate shared room after the new source and working copy are durably saved. Previous rooms retain their shared history and pending saved-translation operations under their original identity; loading a new version never publishes those operations into it. Return to the original source, game, account and language to retry its pending saves. Preserved Dropped copies can still be encountered and reviewed in the newer version. Deploy the compatible API before updating the frontend, then reload older editor tabs; IndexedDB's newer schema prevents older editors/workers from writing the migrated workspace. Production authentication, tunnel connectivity and backup restoration require separate deployment checks.

## Migration From Older SDEditor Builds

If your browser already has data from before multi-version support, SDEditor shows a migration screen after you choose a version.

The migration:

- Detects whether the old data looks like PoE1 or PoE2 using the same path detection as ZIP import.
- Asks for confirmation before copying anything.
- Copies old source, workspace, and revision history into the detected version's new storage.
- Leaves the old storage untouched as a backup.
- Sets `kv.migratedFromSingleVersion` after a successful copy so the migration prompt does not appear again.
- Shows a copying progress message while the migration is running and prevents starting the same migration twice.

## Dictionary Migration for Cloud Backup

The hybrid-storage upgrade attaches the previous Dictionary to its saved language and keeps the original settings locally. If no language was saved, choose one in Settings before attaching that dictionary. Switching languages opens separate dictionaries; it does not copy the original into each language. This automatic settings migration is independent of the confirmed PoE1/PoE2 workspace migration above. First cloud attachment merges the shared dictionary permitted by the account's role and presents incompatible edits for local/remote selection: the assigned language for Translators, or the selected language for Managers/Admins.
