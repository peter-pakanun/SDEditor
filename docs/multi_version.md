# Multi-Version Support

SDEditor supports separate PoE1 and PoE2 workspaces.

## Selecting A Version

When the app opens, choose **PoE1** or **PoE2** before importing or editing files.

The selected version controls:

- Imported source `StatDescriptions.zip`
- Local translated workspace
- Revision history
- Browser tab title

Dictionary, Regex, language, theme, and other editor settings are shared between versions.

## Auto-Detection

When you use **Import Next Version** with a full `StatDescriptions.zip`, SDEditor checks the ZIP paths to detect the game version.

PoE2 is detected when the ZIP contains PoE2-only `specific_skill_stat_descriptions` structure, especially paths like:

```text
specific_skill_stat_descriptions/explosive_grenade
```

If the ZIP looks like a different version from the one currently selected, SDEditor asks before switching versions and importing there.

## Storage Split

Version-specific data is stored separately in IndexedDB:

| Data | PoE1 | PoE2 |
|---|---|---|
| Source ZIP data | `kv.source_poe1` | `kv.source_poe2` |
| Workspace | `kv.workspace_poe1` | `kv.workspace_poe2` |
| History | `revisions_poe1` | `revisions_poe2` |

The old single-version `kv.source`, `kv.workspace`, and `revisions` data are left intact as a backup.

## Migration From Older SDEditor Builds

If your browser already has data from before multi-version support, SDEditor shows a migration screen after you choose a version.

The migration:

- Detects whether the old data looks like PoE1 or PoE2 using the same path detection as ZIP import.
- Asks for confirmation before copying anything.
- Copies old source, workspace, and revision history into the detected version's new storage.
- Leaves the old storage untouched as a backup.
- Sets `kv.migratedFromSingleVersion` after a successful copy so the migration prompt does not appear again.
- Shows a copying progress message while the migration is running and prevents starting the same migration twice.
