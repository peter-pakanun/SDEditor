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
| Missing | Current committed translation has a blank entry or a different entry count from English. | Red |
| Dropped | An unresolved preserved translation exists separately from current committed text. | Orange |
| Revised | A saved correction to a complete original ZIP translation outside this version's Missing/Dropped assignment scope. | Purple |
| Saved | A staged translation exists, including an unchanged or intentionally blank save. | Green |
| Error | A manual diagnostic scan reports an error in this file. | Red |
| Warning | A manual diagnostic scan reports a warning in this file. | Orange |
| Unchanged | Complete current translation with no staged save or unresolved dropped copy. | Neutral |

Statuses are derived from immutable ZIP content, staged translations, dropped snapshots and their source-version provenance, and diagnostic results. Do not persist or trust UI status booleans. Legacy wire/history fields remain compatibility data. Revised is **not** any edit or a difference from the previous save: a file originally Missing or Dropped remains ordinary Saved work after later edits in that version. Reverting a correction to the ZIP translation removes Revised while keeping Saved. Counts overlap; Revised is also Saved, and Dropped may also be Missing. Review is an action on a dropped translation, not a status. Dropped copies retain their own source and translation locally and in cloud sync until an explicit save/promotion/discard resolves them; they are never active text or exported directly.

## Access and language scope

- Use the `translator`, `manager` and configured `admin` roles for access; `all` is not a supported assigned language. Manager/Admin can read and edit every language's shared dictionary and translation work/history with or without an assignment. Their selected editor language controls shared editing and synchronization.
- Translator cloud access is limited to their assigned language. Settings can select another language for local editing; assignment and selected language are separate concepts. User management remains Admin-only. Personal settings and Regex rules remain per account.
- The navbar game link is available to everyone; the navbar language link is for signed-in Manager/Admin. Settings can change language for every role.
- Comments default to the Translator's assigned team or the Manager/Admin's selected language. Global posting requires the explicit, initially unchecked audience choice. Manager/Admin can read all teams. Preserve game, language, account and audience guards for drafts and requests.

## Data and persistence boundaries

- Keep the original ZIP and immutable parsed baseline separate from staged translations. Saves, translated imports, restores and shared edits must not rewrite the baseline or its identity.
- Standalone sparse collaboration starts with an archive descriptor and agreed import decisions. It shares per-file baseline proofs, saved translations and server-authored history; Dropped copies synchronize separately with their old English/entry metadata and translation where available. The API contains per-file data, not only hashes. Manager publication explicitly uploads the original ZIP and complete parsed baseline for all 12 teams, with durable translated collection artifacts. Legacy rooms may retain source manifests. Do not add full-ZIP uploads to ordinary translator saves or bulk-upload legacy history; recovery can share a per-file snapshot derived from local history.
- Modern `baselineId` combines the raw ZIP SHA-256, parser/duplicate-decision configuration hash and Merkle root. Legacy rooms use a canonical parsed source-manifest hash. Keep these identities distinct.
- Commit workspace, history, retry outbox and save receipt atomically before reporting a successful local save. Normal translation persistence uses `saveWorker.js`, with a fallback to the same storage command. After uncertain worker completion, retry with the same job ID and durable receipt; never resend blindly. Source imports also commit their baseline, source, workspace and recovery history together.
- Preserve account/game/source/language/access guards across requests, queued operations and asynchronous callbacks. Never publish a pending operation into another scope. Wait for local saves before switching context or exporting. Detach Vue-reactive objects and nested arrays before IndexedDB writes or worker messages.
- Keep legacy stores/history and recoverable data through migrations; prune current status caches after migration. IndexedDB uses `sdeditor` with `kv`, legacy `revisions`, and `revisions_poe1`/`revisions_poe2`; see `DB_VERSION` in `offlineStore.js`. Preserve older-writer exclusion and close connections on `versionchange`. Never clear storage to bypass a blocked upgrade.
- A new explicit history recovery gets a stable `recoveryId`; retries reuse it even after resolution. Automatic migration, import, peer retargeting and provenance uploads must not create new recovery generations. Preserve resolved archives, source-version assignment provenance and revision-checked conflicts.
- IndexedDB v8 indexes workspaces/sources by account, game, branch and baseline, with a separate active pointer. Use branch `default` initially. Activation selects an existing snapshot; source advancement performs carry-forward. Selection/join must not add Dropped `targetSourceHashes` or contaminate another version's history. Capture scopes before awaits/worker queues. Existing default-branch draft keys and receipt/mutation IDs remain compatible; legacy per-game slots are retained.
- Managed version deadlines and ended state are advisory metadata. Collections contain immutable server-accepted Saved work, exclude drafts/pending local uploads, and become durable before marking a team ended. Upload/collection retries retain durable request IDs. Keep catalog caches account-scoped and reuse matching-baseline rooms/history during publication. Deploy API schema v13/reference-aware restore before the frontend. Backups exclude ZIP files and retain only archive references/checksums; keep `DATA_DIR/artifacts` separately for restoration.

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
| Workspace and durable saves | `workspaceState.js`, `offlineStore.js`, `saveWorker.js`, `saveWorkerClient.js`, `pendingSaves.js` |
| Settings, Dictionary and account sync | `dictionarySync.js`, `cloudSync.js`, `cloudUi.js`, `cloudHistoryUi.js` |
| Shared translations | `collaborationProtocol.js`, `collaborationSync.js`, `collaborationIntegration.js`, `collaborationUi.js` |
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
- [Regex Guide](docs/regex_guide.md) — pattern reference
- [Test Mode](docs/test-mode.md) — editor fixtures and validation limits
- [TODO](TODO.md) — developer TODO list

## What NOT to do

- Do not introduce build steps, bundlers, or frameworks not already present.
- Do not add external test frameworks unless explicitly asked; extend the existing direct checks and Node built-in tests.
- Do not expect TypeScript to catch errors — `checkJs: false`.
