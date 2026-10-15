# SDEditor — Agent Guide

Minimal, verified facts for working in this repo.

## Project

- **PoE StatDescriptions.zip translation editor** — vanilla JS SPA, Vue 3 loaded via CDN, Express dev server.
- One main Vue 3 Options API component in `public/index.js`, with plain JavaScript modules and mixins for storage, workspace state, cloud sync, collaboration, comments, history and lookup. No build step, bundler or router.
- `server.js` serves the static frontend. The sibling `../SDEditor-API` is a separate Express/WebSocket application with SQLite, its own tests and migrations, and Node.js 24 or later. It deploys separately.

## Workspace status intent

Read [`docs/workspace_statuses.md`](docs/workspace_statuses.md) before changing status calculation, assignment scope, import, save, dropped recovery, or synchronization. These names describe the selected language in the current game/source version. **Assignment scope** here means this version's Missing/Dropped file workload, not the account's assigned language.

| Status | Product meaning | Color |
|---|---|---|
| Missing | The selected SD language block is absent, contains a blank entry, or has a different entry count from English. | Red |
| Dropped | An unresolved preserved translation exists separately from current committed text. | Orange |
| Revised | A saved correction to a complete original ZIP translation outside this version's Missing/Dropped assignment scope. | Purple |
| Saved | A complete staged translation exists; every SD entry must contain nonblank text. Unchanged complete saves are allowed. | Green |
| Error | A present committed SD language block is incomplete, or a manual diagnostic scan reports an error in this file. | Red |
| Warning | A manual diagnostic scan reports a warning in this file. | Orange |
| Unchanged | Complete current translation with no staged save or unresolved dropped copy. | Neutral |

Statuses are derived from immutable ZIP content, staged translations, dropped snapshots and their source-version provenance, and diagnostic results. Do not persist or trust UI status booleans. Legacy wire/history fields remain compatibility data. Revised is **not** any edit or a difference from the previous save: a file originally Missing or Dropped remains ordinary Saved work after later edits in that version. Reverting a correction to the ZIP translation removes Revised while keeping Saved. Counts overlap; Revised is also Saved, and Dropped may also be Missing. Review is an action on a dropped translation, not a status. Dropped copies retain their own source references and frozen targets in their owner's browser or shared storage until an explicit save/promotion/discard resolves the selected copy or verified removal of its entire filepath deletes the destination recovery copy. Keep previous-version Saved work, history and valid predecessor recovery assignments; they are never active text or exported directly.

## Access and language scope

- Use the `translator`, `manager` and configured `admin` roles for access; `all` is not a supported assigned language. Manager/Admin can read and edit every language's shared dictionary and translation work/history with or without an assignment. Their selected editor language controls shared editing and synchronization.
- Translator cloud access is limited to their assigned language. Settings can select another language for local editing; assignment and selected language are separate concepts. User management remains Admin-only. Personal settings and Regex rules remain per account.
- The navbar game link is available to everyone; the navbar language link is for signed-in Manager/Admin. Settings can change language for every role.
- Comments default to the Translator's assigned team or the Manager/Admin's selected language. Global posting requires the explicit, initially unchecked audience choice. Manager/Admin can read all teams. Preserve game, language, account and audience guards for drafts and requests.

## Data and persistence boundaries

- **Owner's SD source trust decision: ZIP over SQLite, 10:1.** This is an explicit architectural preference, not a measured failure probability. Trust the exact immutable original ZIP and accepted parser/duplicate configuration as the source authority; the owner guarantees latest-source availability and accepts optional historical ZIP loss. SQLite is authoritative for authored targets, history, receipts and Dropped lifecycle, while its SD source fingerprints/counts are derived facts. Do not add SQLite English/metadata copies, full untouched catalogs, extracted source artifacts or exhaustive historical ZIP checks to protect against a risk the owner has accepted. Keep identity validation on actual import/use and existing access, completeness, revision and atomic-save guards. Read the [source authority and advancement model](docs/sd_baseline_storage.md) before changing this boundary.
- For storage performance, preparation scheduling or future content modes, read [Storage Performance Design](docs/storage_performance_design.md). It records current scope/transaction/cache contracts, measurements and unfinished follow-ups; keep proposed work distinct from implemented behavior.
- Keep the original ZIP and immutable parsed baseline separate from staged translations. Saves, translated imports, restores and shared edits must not rewrite the baseline or its identity.
- Browser v22/API v24 `droppedOwnership: 'separate-v1'` keep local Dropped recovery and managed Shared Dropped generations independent. Local imports/recovery never upload or resolve shared candidates; managed advancement uses server ancestry. Offer both in the client with owner-specific lifecycle guards, preserving old targets, assignments, retry bodies and collaboration history. Cached online work remains online while disconnected. Shared status/progress/Revised use managed assignments; local alternatives remain separately discoverable. Deploy the compatible API first and reload older tabs; do not clear storage.
- SD translations with any blank/whitespace-only entry or different entry count are destructive errors and must never stage or enter new exports/collections. Validate the whole file at UI, durable storage and API boundaries; partial files are rejected atomically. An immutable baseline without the selected language tag is Missing only; a present incomplete language block is Missing + Error. Derive tag presence from immutable content or verified facts, never padded editor text or cached UI flags. Manual scans exclude absent committed blocks; authored drafts and promotion candidates still require complete translations. Full export preserves an untouched absent tag without creating a blank language block. ClientText permits blank fields. Browser v19/API v21 quarantine all invalid SD stages regardless of authored/inherited origin, retaining exact scoped recovery, history, drafts, commands and receipts. Invalid pending operations cannot replay; a corrected complete save resolves the warning. Preserve historical immutable collection downloads. This presence correction needs no schema/version bump. Deploy API first.
- Read [Local-first Server Storage](docs/local_first_server_storage.md) before changing baseline retention, collection generation, payload storage or compaction. Standalone sparse collaboration shares an archive descriptor, agreed import decisions, trusted immutable per-file baseline facts, saved translations and server-authored history; Dropped copies retain frozen translations and source references separately. Manager publication retains the original ZIP externally and compact facts/summaries for all 12 teams; complete parsed baselines remain local or transient server parses. Modern collection ZIPs are generated client-side from verified originals and immutable Saved manifests. Authored translations/history and recovery remain durable in SQLite. Historical English/metadata and untouched ZIP-only targets require the matching ZIP or verified client cache; virtual seed identities and attribution survive source loss. Preserve legacy archive collections and their required artifacts. Do not add full-ZIP uploads to ordinary saves or bulk-upload local history.
- Browser v21/API v24 use [ZIP-only SD source storage](docs/sd_baseline_storage.md): complete TM and authored target history/recovery stay in SQLite; SD English/metadata come only from matching ZIPs or verified client caches. Historical ZIPs and untouched ZIP-only targets may be lost; never invent historical English or blank target values. Preserve virtual seed identities, authored before/after targets, recovery generations and original retry hashes. Store compact accepted facts and aggregate summaries, with no SD fragment directory or full untouched source catalogs. Missing old ZIPs must not block advancement or explicit recovery against a verified current baseline. Check ZIP identity on import/use, not by exhaustive historical dependency sweeps. Conversion/reachability/VACUUM remain explicit stopped maintenance. Workbook and generated collection artifact requirements stay intact. Deploy API first.
- New StatDescription v2 `baselineId` combines raw ZIP SHA-256 and parser/duplicate-decision configuration hash. Existing v1 descriptor roots remain identity metadata and IDs stay unchanged; do not rebuild proof trees. Legacy rooms use a canonical parsed source-manifest hash. Keep these identities distinct. Browser v20/API v22 use trusted immutable file facts without membership proofs; retain strict browser source/completeness validation, accepted fact fingerprints, revision/provenance recovery guards and exact old pending request bodies. V20 removes baseline tree caches; v22 prunes obsolete mutable cache fields reference-safely. Removed proofs need no current recovery copy; keep historical backups. Deploy API first.
- StatDescription source advancement omits inherited stages identical to incoming English/translation/metadata. With unchanged English, metadata-only changes carry Saved text with current metadata and factual old/new provenance; an incomplete incoming translation with nonblank predecessor text is Dropped first. Preserve existing destination work on reimport. Browser v18/API v20 cleanup removes only proven redundant automatic inheritance, preserving recovery evidence, explicit destination saves, metadata corrections, Dropped assignments, pending commands and ambiguous legacy records. Deploy the API first.
- Commit workspace, history, retry outbox and save receipt atomically before reporting a successful local save. Normal translation persistence uses `saveWorker.js`, with a fallback to the same storage command. After uncertain worker completion, retry with the same job ID and durable receipt; never resend blindly. Source imports also commit their baseline, source, workspace and recovery history together.
- Preserve account/game/source/language/access guards across requests, queued operations and asynchronous callbacks. Never publish a pending operation into another scope. Wait for local saves before switching context or exporting. Detach Vue-reactive objects and nested arrays before IndexedDB writes or worker messages.
- Keep legacy stores/history and recoverable data through migrations; prune current status caches after migration. IndexedDB uses `sdeditor` with `kv`, legacy `revisions`, and `revisions_poe1`/`revisions_poe2`; see `DB_VERSION` in `offlineStore.js`. Preserve older-writer exclusion and close connections on `versionchange`. Never clear storage to bypass a blocked upgrade.
- A new explicit history recovery gets a stable `recoveryId`; retries reuse it even after resolution. Automatic migration, import, peer retargeting and provenance uploads must not create new recovery generations. Preserve resolved archives, source-version assignment provenance and revision-checked conflicts.
- IndexedDB v9 uses scoped per-file baseline, staged translation, recovery checkpoint, collaboration operation, submission and receipt stores, with materialized read adapters and a separate active pointer. Ordinary saves must not read/write aggregate workspace/source/collaboration KV records. Legacy aggregates remain frozen recovery evidence; resumable conversion marks readiness before normalized absence becomes authoritative. Fence older v8 writers and never dual-write or clear storage. Use branch `default` initially. Activation selects an existing snapshot; source advancement performs carry-forward. Selection/join must not add Dropped `targetSourceHashes` or contaminate another version's history. Capture scopes before awaits/worker queues. Existing default-branch draft keys and receipt/mutation IDs remain compatible; legacy per-game slots are retained.
- Managed version deadlines and ended state are advisory metadata. Collections contain immutable server-accepted Saved work and exclude drafts/pending uploads. Modern ending collections become ready after the API verifies the durable manifest and matching original; browser ZIP completion is separate. Preserve legacy archive downloads and durable upload/collection request IDs. Keep catalog caches account-scoped and reuse matching-baseline rooms/history. Deploy API schema v24/reference-aware restore before the frontend. Historical SD ZIPs are optional for source conversion and database backup/restore; verify matching originals when source reconstruction or complete export needs them. ClientText workbook originals and generated collection archives remain required dependencies. Format-5 backups compact/compress an isolated snapshot, exclude artifact files, verify SQLite references and mark SD source ZIPs optional; retain required `DATA_DIR/artifacts` files separately. Live compaction requires explicit stopped maintenance and a safety backup.

## Temporary agent files

- Put disposable files created during agent work (scratch data, temporary fixtures, logs, and generated intermediates) under the repository-root `temp/` directory. Its contents are ignored by Git; only `temp/.gitkeep` is tracked to preserve the directory. Do not save temporary files elsewhere in the repository where they could be committed accidentally.
- Do not put deliverables or source changes in `temp/`; move anything that should be kept to its intended project location.

## Platform Support

- **Desktop-first:** supported use is a desktop or laptop browser with a keyboard and mouse or trackpad.
- Mobile phone and tablet support is discontinued. Mobile layouts, touch-only workflows, and desktop/mobile parity are outside the scope of future work unless explicitly requested.
- Prioritize desktop layouts, keyboard navigation, and pointer interactions. Continue accommodating resized desktop windows; this does not require mobile support.

## Commands

| Command | Purpose |
|---|---|
| `node server.js` | Start dev server on `http://127.0.0.1:3333` |
| `node server.js --no-open` | Skip browser auto-open |
| `node server.js --log-requests` | Enable request logging |

Env vars: `PORT` (3333), `HOST` (127.0.0.1), `NO_OPEN_BROWSER`, `LOG_REQUESTS`, `CI`, `SDEDITOR_NO_OPEN`.

Frontend `npm test` is a stub (exits 1). Run focused checks directly as described below. There is no configured linter or formatter; TypeScript does not check the JavaScript.

## Source map

Browser modules below are in `public/`; `server.js` and `scripts/` are at the repository root.

| Area | Files |
|---|---|
| Entry and main app | `index.html`, `index.js`, `server.js` |
| Content and diagnostics | `statDescCodec.js` (shared runtime parser/encoder), `statDescParser.js` (browser adapter), `helper.js` (ZIP entry decoding/utilities), `regexEngine.js`, `translationDiagnostics.js`, `terminologyDiagnostics.js` |
| Workspace and durable saves | `workspaceState.js`, `normalizedStore.js`, `offlineStore.js`, `saveWorker.js`, `saveWorkerClient.js`, `pendingSaves.js` |
| Settings, Dictionary and account sync | `dictionarySync.js`, `cloudSync.js`, `cloudUi.js`, `cloudHistoryUi.js` |
| Shared translations | `collaborationProtocol.js`, `normalizedRooms.js`, `collaborationSync.js`, `collaborationIntegration.js`, `collaborationUi.js` |
| Managed source versions | `managedVersions.js`, `managed-versions.css` |
| Comments and lookup | `commentsUi.js`, `editorLookup.js`, `editorDictionaryIndex.js` |
| Shared UI and fixtures | `appDialog.js`, `interface.css`, `index.css`, `dummyFiles.js`, `scripts/test-*.cjs`, `scripts/*-browser-fixture.cjs` |

Keep `workspaceState.js` loaded before its helper/storage/protocol consumers and before `offlineStore.js` in `saveWorker.js`. It supports browser, worker and Node consumers. `FileSaver.js` is a vendored client download helper; JSZip handles ZIP archives.

## Testing

- Extend existing `scripts/test-*.cjs` checks; many use Node's built-in `node:test`, others run assertions directly. Select checks for the changed behavior, then syntax-check touched JavaScript and run `git diff --check`. Examples:

  ```text
  node scripts/test-workspace-state.cjs
  node scripts/test-save-worker.cjs
  node scripts/test-collaboration-storage.cjs
  node scripts/test-collaboration-lifecycle.cjs
  node scripts/test-dropped-sync.cjs
  node scripts/test-storage-upgrade.cjs
  node --check public/index.js
  git diff --check
  ```

- Test mode (`http://127.0.0.1:3333/?testMode=1&lang=Thai`) loads `dummyFiles.js` and bypasses normal IndexedDB startup and cloud login/sync. It checks editor/diagnostic behavior, not persistence or authenticated collaboration. The dummy snippets deliberately include missing translations.
- Use disposable normal-mode browser origins/profiles for real IndexedDB checks. `scripts/test-collaboration-api.cjs` and cloud/collaboration browser fixtures require the sibling API and installed dependencies. See [Cloud Backup](docs/cloud_backup.md) for commands and fixture instructions.
- In the API checkout, use its `npm run check` and real `npm test`. Local tests and fixtures do not establish hosted deployment, live Google OAuth/CORS, PM2/tunnel readiness or production backup restoration. Deploy a compatible API before a frontend that needs its new contracts; see the rollout/rollback guidance in [Cloud Backup](docs/cloud_backup.md).
- Validate UI changes in desktop viewports with keyboard and mouse/trackpad workflows. Mobile device checks are not required.
- Preserve completed diagnostic results when correcting or receiving a translation: refresh affected files and consistency peers without clearing unrelated findings. Opening/editing a file must not silently run optional full-workspace consistency or terminology scans. See [Workspace Status Contract](docs/workspace_statuses.md) for scan lifecycle rules.

## Toolchain quirks

- **CDN deps not in package.json:** Vue 3, JSZip, jsdiff loaded from CDN in `index.html`.
- **npm packages** (`express`, `opn`) are only for the dev server.
- **TypeScript is installed** (`tsconfig.json`, `checkJs: false`, `noEmit: true`) — IDE intellisense via declaration files, not a repository-wide JavaScript correctness check or compilation step.
- **UTF-16LE with BOM** — StatDescription files use this encoding; `helper.js` reads via `FileReader.readAsText(blob, 'utf-16le')` and `statDescParser.js` encodes manually with `Uint16Array` and a BOM.

## Conventions

- Edit JavaScript directly; use existing focused checks and syntax validation. No configured linter or formatter.
- Git commit style: conventional prefixes (`feat:`, `fix:`, `style:`, `refactor:`, `docs:`).
- Four themes via `[data-theme]` on `<html>`: `light`, `grey`, `dark`, `modern-dark`. UI density uses `--density`; validate changed UI in the applicable themes.

## Syncing UX

- Healthy background synchronization is silent. Do not show loading/syncing messages, success notices or timestamps, or routine Refresh/Retry controls for automatic sync.
- Keep existing content, scroll position, focus, and settled empty states stable during background requests. Polling must not clear a list, replace it with a loader, or briefly hide its empty state.
- Show only actionable sync warnings, errors, and conflicts. Keep a failure visible until the relevant operation succeeds; starting a retry or completing an unrelated request must not clear it.
- Retry automatically when appropriate. Comments refresh every 20 seconds while the tab is visible and when it becomes visible or connectivity returns. Comment panels and the workspace/editor status bars have no manual Refresh/Retry sync buttons. Settings may offer **Sync now** for an actual warning/error.
- Explicit user actions such as Save, Post comment, import/export, diagnostics, and requested history loading may show progress and prevent duplicate submissions. Unread counts, presence, source versions, and access guidance remain useful content.
- Reuse the existing `browserWork` spinner for substantive preparation, Dictionary work or saved-translation uploads; routine polling remains silent.
- Comments use a small yellow information icon when source hashes differ. Hover text includes **Different version**, an explanation, and the full source hash.

## Docs

- [Workspace Status Contract](docs/workspace_statuses.md) — status intent, scope, diagnostics, migration and export rules
- [Editor Guide](docs/editor_guide.md) — user-facing UI and translator workflow
- [Import Workflow](docs/import_workflow.md) — import/export workflow
- [Cloud Backup](docs/cloud_backup.md) — access, synchronization, recovery, validation and deployment order
- [Multi-Version Support](docs/multi_version.md) — game/source identities, storage and migration
- [Local-first Server Storage](docs/local_first_server_storage.md) — baseline boundary, client collections, payload reduction and operational rollout
- [Storage Performance Design](docs/storage_performance_design.md) — scoped records, atomic saves, cooperative preparation, measurements and future content-mode adapters
- [Regex Guide](docs/regex_guide.md) — pattern reference
- [Test Mode](docs/test-mode.md) — editor fixtures and validation limits
- [TODO](TODO.md) — developer TODO list

## What NOT to do

- Do not introduce build steps, bundlers, or frameworks not already present.
- Do not add external test frameworks unless explicitly asked; extend the existing direct checks and Node built-in tests.
- Do not expect TypeScript to catch errors — `checkJs: false`.
