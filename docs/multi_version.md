# Multi-Version Support

SDEditor supports separate PoE1 and PoE2 workspaces.

## Selecting A Version

When the app opens, choose **PoE1** or **PoE2** before importing or editing files.

The selected version controls:

- Imported source `StatDescriptions.zip`
- Local translated workspace
- Revision history
- Browser tab title

Both versions use the same Dictionary for a selected language. Dictionaries are separated by language and local/account profile. Regex rules, selected language, theme, and other preferences are shared between PoE1 and PoE2 within that profile. With Google backup enabled, Regex/preferences are personal and the assigned language's Dictionary is shared with its translators. See [Cloud Backup and Shared Dictionaries](cloud_backup.md).

## Auto-Detection

When you use **Import Next Version** with a full `StatDescriptions.zip`, SDEditor checks the ZIP paths to detect the game version.

PoE2 is detected when the ZIP contains PoE2-only `specific_skill_stat_descriptions` structure, especially paths like:

```text
specific_skill_stat_descriptions/explosive_grenade
```

If the ZIP looks like a different version from the one currently selected, SDEditor asks before switching versions and importing there.

## Storage Split

Version-specific data is stored separately in IndexedDB:
```
| Data            | PoE1                | PoE2                |
|-----------------|---------------------|---------------------|
| Source ZIP data | `kv.source_poe1`    | `kv.source_poe2`    |
| Workspace       | `kv.workspace_poe1` | `kv.workspace_poe2` |
| History         | `revisions_poe1`    | `revisions_poe2`    |
```
The old single-version `kv.source`, `kv.workspace`, and `revisions` data are left intact as a backup.

These stores retain the browser's current source, working translations and local history. Signed-in translators automatically join a shared workspace when the game, source SHA-256 hash and assigned language match. Shared source manifests and saved translations are stored by the API, with new server-authored history. Existing local history is never uploaded. IndexedDB also stores collaboration caches, recovery copies and pending saves scoped by account and workspace.

Import Next Version activates a separate shared workspace after the new source and working copy are durably saved. Previous workspaces retain their shared history and pending operations under their original identity; loading a new version never publishes those operations into it. Return to the original source, game, account and language to retry its pending saves. Deploy the migrated API before updating the frontend; production authentication, tunnel connectivity and backup restoration require separate deployment checks.

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

The hybrid-storage upgrade attaches the previous Dictionary to its saved language and keeps the original settings locally. If no language was saved, choose one in Settings before attaching that dictionary. Switching languages opens separate dictionaries; it does not copy the original into each language. This automatic settings migration is independent of the confirmed PoE1/PoE2 workspace migration above. First cloud attachment merges the assigned language's dictionary and presents incompatible edits for local/remote selection.
