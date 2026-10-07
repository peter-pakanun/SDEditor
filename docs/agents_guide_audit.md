# AGENTS.md audit and applied edit plan

Audit date: 2026-10-06; implementation follow-ups and the approved guide edits applied 2026-10-07. Scope: the frontend checkout and companion `../SDEditor-API` checkout. The findings below record the original guide before correction; the user approved the broader plan, which is now applied. Separate product fixes are recorded at the end.

The original guide described the desktop platform, development server, CDN dependencies and much of the intended sync UX correctly. Its architecture, testing, storage and theme descriptions had fallen behind. The most consequential omissions were the distinction between role and language assignment, the immutable ZIP versus staged/dropped data model, and the boundary between local source archives and data shared with the API. These are now covered in [AGENTS.md](../AGENTS.md).

The concise **Workspace status intent** section and its link to `workspace_statuses.md` were authorized separately and retained. The guide describes the implemented Revised/source-version contract without claiming that a hosted build has been verified.

## Statements to correct

Line references are evidence locations in the local snapshot, not suggested permanent documentation line numbers. Proposed text intentionally avoids line counts and test counts that would become stale.

| Existing statement | Finding and current evidence | Proposed replacement |
|---|---|---|
| “Single monolithic Vue 3 Options API component in `public/index.js` (~3000 lines).” | The main component remains large, but feature behavior also lives in modules and six composed mixins. `index.js` is currently roughly 6,800 lines, so the old estimate is misleading. See [public/index.js:101](../public/index.js#L101), [public/index.js:102](../public/index.js#L102), and the module load sequence at [public/index.html:1192](../public/index.html#L1192). | “One main Vue 3 Options API component in `public/index.js`, with plain JavaScript modules and mixins for storage, workspace state, cloud sync, collaboration, comments, history and lookup. No build step, bundler or router.” |
| “`npm test` is a stub (exits 1). There are no tests…” | The npm script really is a failing placeholder, but the repository contains 31 `scripts/test-*.cjs` files. Twenty-nine import Node’s built-in `node:test`; two run focused assertion checks directly. See [package.json:15](../package.json#L15), [scripts/test-workspace-state.cjs:1](../scripts/test-workspace-state.cjs#L1), [scripts/test-save-worker.cjs:1](../scripts/test-save-worker.cjs#L1), [scripts/test-comments-ui.cjs:3](../scripts/test-comments-ui.cjs#L3), and [scripts/test-pending-saves.cjs:3](../scripts/test-pending-saves.cjs#L3). | “Frontend `npm test` remains a failing placeholder. Run relevant focused checks directly with `node scripts/test-<area>.cjs`; many use Node’s built-in test runner. No configured linter or formatter.” |
| “No test framework. Manual testing via `?testMode=1`…” | Manual test mode is useful, but it is not the only test path. Domain, VM, persistence, cross-repository API and disposable browser fixtures already exist. The API integration suite uses a real in-memory SQLite API and WebSockets; test mode cannot substitute for it. See [scripts/test-collaboration-api.cjs:1](../scripts/test-collaboration-api.cjs#L1), [scripts/test-collaboration-api.cjs:34](../scripts/test-collaboration-api.cjs#L34), and [scripts/collaboration-browser-fixture.cjs:1](../scripts/collaboration-browser-fixture.cjs#L1). | “Use focused CJS checks for logic and regressions, test mode for editor UI, and disposable normal-mode browser/API fixtures for IndexedDB persistence and collaboration. Keep these validation scopes distinct.” |
| “Do not add test frameworks unless explicitly asked — there is no test infrastructure.” | The prohibition on introducing an external framework remains useful; the explanation is false and could discourage extending the existing tests. | “Extend the existing direct CJS checks and Node built-in tests. Do not introduce an external test framework or a build step unless explicitly requested.” |
| “`offlineStore.js` — IndexedDB persistence (DB `sdeditor`, stores `kv` + `revisions`).” | The database is still `sdeditor`, now at version 4. It has `kv`, legacy `revisions`, and game-specific `revisions_poe1`/`revisions_poe2`. Source/workspace keys, imported baseline caches, hybrid account profiles, collaboration state and save receipts live in `kv`. See [public/offlineStore.js:3](../public/offlineStore.js#L3), [public/offlineStore.js:8](../public/offlineStore.js#L8), [public/offlineStore.js:232](../public/offlineStore.js#L232), [public/offlineStore.js:272](../public/offlineStore.js#L272), and [public/offlineStore.js:322](../public/offlineStore.js#L322). | “`offlineStore.js` — IndexedDB storage, versioned source/workspace/history, immutable imported baselines, account profiles, collaboration caches and atomic save transactions. Keep legacy stores as recovery data.” Avoid fixing the schema version in the guide; point to the constants. |
| “`index.js` — entire app component.” | `index.js` owns the main component, but cloud, collaboration, comments, history and lookup methods are contributed by mixins. Storage, protocol and status calculation are also external. See [public/index.js:102](../public/index.js#L102). | “`index.js` — main Vue component and editor/import/export behavior; feature mixins and domain modules are listed below.” |
| “`statDescParser.js` — ZIP parser…” | JSZip handles the archive. `statDescParser.js` parses and encodes StatDescription text files; `helper.js` decodes ZIP entries. New source imports request strict parsing and preserve duplicate-language decisions in the baseline identity. See [public/statDescParser.js:29](../public/statDescParser.js#L29), [public/helper.js:76](../public/helper.js#L76), [public/index.js:4961](../public/index.js#L4961), and [public/collaborationProtocol.js:54](../public/collaborationProtocol.js#L54). | “`statDescParser.js` — StatDescription text parser and UTF-16 export encoder; `helper.js` decodes ZIP entries. JSZip reads/writes archives.” |
| “No automated code quality tooling.” | There is no configured lint/format/type-check workflow, but this wording hides the executable regression checks and syntax validation already documented. See [docs/cloud_backup.md:127](cloud_backup.md#L127) and [tsconfig.json:7](../tsconfig.json#L7). | “No configured linter or formatter. Use direct JavaScript edits, relevant focused tests, `node --check` for touched JavaScript, and `git diff --check`.” |
| “Two CSS themes… `grey` and `dark`.” | Four themes are selectable and validated: `light`, `grey`, `dark`, `modern-dark`. Base styles and `interface.css` both matter. See [public/index.html:133](../public/index.html#L133), [public/cloudSync.js:28](../public/cloudSync.js#L28), and [public/interface.css:38](../public/interface.css#L38). | “Four themes via `<html data-theme>`: `light`, `grey`, `dark`, `modern-dark`. Density uses `--density`, with compact/spacious preferences. Check changed UI in the applicable themes.” |
| The key-file list omits most current feature modules. | An agent following the list could put protocol or status changes into the main UI component, or miss the worker copy of storage code. See [public/index.html:1192](../public/index.html#L1192) and [public/saveWorker.js:3](../public/saveWorker.js#L3). | Expand the map by responsibility rather than listing every CSS/font/asset. The proposed map appears below. |
| The docs list omits cloud/collaboration and multi-version guidance. | `cloud_backup.md` already documents the role, sync, fixture and deployment boundaries; `multi_version.md` describes game separation and migration. Status guidance now has its separately approved document. See [docs/cloud_backup.md:20](cloud_backup.md#L20), [docs/cloud_backup.md:127](cloud_backup.md#L127), and [docs/multi_version.md:1](multi_version.md#L1). | Add pointers to `docs/cloud_backup.md`, `docs/multi_version.md`, and the approved `docs/workspace_statuses.md`. Keep the guide short by linking to detailed workflows. |

## Missing guidance worth adding

### Repository and validation boundaries

The frontend and API are separate repositories and deploy separately. Frontend `server.js` serves static files; it does not run the cloud API. The companion API is an ESM Express/WebSocket application with SQLite through `node:sqlite` and requires Node 24 or later. Evidence: [server.js:28](../server.js#L28), `../SDEditor-API/package.json:6–12`, and `../SDEditor-API/src/database.js:1`.

Proposed guide text:

> Cloud/backend behavior lives in the sibling `SDEditor-API` repository, with its own dependencies, schema migrations and tests. Run frontend checks in SDEditor and API checks in that checkout. A frontend change can require a compatible API deployment first; local tests do not establish production deployment, Google OAuth, public CORS, tunnel/service readiness or backup restoration.

Useful representative frontend commands:

```text
node scripts/test-workspace-state.cjs
node scripts/test-save-worker.cjs
node scripts/test-collaboration-storage.cjs
node scripts/test-collaboration-lifecycle.cjs
node scripts/test-collaboration-source.cjs
node scripts/test-dropped-sync.cjs
node scripts/test-collaboration-api.cjs
node --check public/index.js
git diff --check
```

These are examples, not a mandate to rerun unrelated suites after every small change. Select checks by the touched behavior. `test-collaboration-api.cjs` and API browser fixtures need the sibling API and installed dependencies. `docs/cloud_backup.md` contains additional focused commands and fixture instructions.

The API’s `npm test` is real (`node --test`), unlike the frontend placeholder. Its `npm run check` enumerates JavaScript files. The omission of the new `src/dropped-store.js` found in the original audit was corrected on 2026-10-07 as part of the recovery fix. Evidence: `../SDEditor-API/package.json:10–16`.

### Role and language scope

`translator`, `manager` and configured `admin` are different roles. Managers/admins can access every supported language’s shared dictionary, translation rooms/history and comments without an assigned language. The selected editor language controls their dictionary and translation room. Translators are cloud-authorized only for their assigned language, while Settings can still select another language for local editing. User management remains admin-only. Personal settings/Regex remain per account; Manager access does not expose everyone’s personal settings.

Evidence: [public/cloudSync.js:16](../public/cloudSync.js#L16), [public/cloudUi.js:28](../public/cloudUi.js#L28), `../SDEditor-API/src/database.js:158–164`, `../SDEditor-API/src/app.js:77`, `:138–180`, and `:171–175`; `../SDEditor-API/src/collaboration-store.js:15–25`.

Proposed guide text:

> Use roles for access, not a synthetic assigned language such as `all`. Manager/Admin access ignores assignment as a restriction and uses the selected language for shared editing. Translator assignment and selected editor language remain distinct. Preserve language/account guards across requests, queued saves and asynchronous callbacks. Navbar game switching is available to everyone; the navbar language link is only for signed-in Manager/Admin, while Settings can change language for every role.

`all` is not a supported language value. The API accepts the concrete language list or nullable assignments, and `canAccessAllLanguages` comes from the role. Evidence: `../SDEditor-API/src/config.js:7–10`, `../SDEditor-API/src/validation.js:26–29`, and `../SDEditor-API/src/app.js:140–144`.

Comments need an additional scope distinction: Translator posts default to the assigned language even when locally editing another language; Manager/Admin posts default to the selected language. Global posting is an explicit unchecked audience choice. Managers/admins may read all teams. Evidence: [public/commentsUi.js:12](../public/commentsUi.js#L12), [public/commentsUi.js:280](../public/commentsUi.js#L280), and `../SDEditor-API/src/comments-store.js:19–53`.

### Local source and cloud data

Modern ZIP imports keep an immutable parsed baseline and Merkle tree in this browser. Sparse rooms initially share an archive descriptor and agreed import decisions rather than uploading the full ZIP or every source file. First publication of an untouched file includes its baseline witness/proof. Reviewed translations and server-authored history are shared. Dropped copies now synchronize separately and include a per-file old English/variables/remarks/stats snapshot plus the preserved translation.

Evidence: [public/offlineStore.js:272](../public/offlineStore.js#L272), [public/offlineStore.js:277](../public/offlineStore.js#L277), [public/collaborationSync.js:280](../public/collaborationSync.js#L280), [public/collaborationSync.js:303](../public/collaborationSync.js#L303), [public/collaborationSync.js:886](../public/collaborationSync.js#L886), and `../SDEditor-API/src/dropped-store.js:34–45`, `:100–125`.

Proposed guide text:

> Keep the original ZIP and immutable baseline local. Sparse collaboration shares metadata, proofs and incremental saved/dropped data. Do not upload a full ZIP or bulk-upload legacy local history. Do not claim that the API contains only hashes: saved file baselines, translation history and dropped snapshots contain per-file data. Earlier legacy rooms may also retain source manifests.

The legacy API still has a source-manifest seed path (`../SDEditor-API/src/collaboration-store.js:178–195`), so “no source data ever exists on the server” would be false. Raw legacy history records remain local, but recovery can derive a dropped snapshot from those records and share that per-file snapshot. Those are different boundaries.

Do not conflate archive identities: modern `baselineId` combines raw ZIP SHA-256, parser/duplicate-decision configuration hash and Merkle root. Legacy rooms use the canonical parsed source manifest hash. Neither identifier should be substituted for the other. Evidence: [public/collaborationProtocol.js:25](../public/collaborationProtocol.js#L25), [public/collaborationProtocol.js:67](../public/collaborationProtocol.js#L67), [public/collaborationProtocol.js:71](../public/collaborationProtocol.js#L71), [public/collaborationProtocol.js:94](../public/collaborationProtocol.js#L94), and `../SDEditor-API/src/collaboration-validation.js:58–59`.

### Durability, migrations and asynchronous work

Local saves commit the workspace, history, retry outbox and receipt together before claiming success. A worker performs normal translation persistence; worker construction/import can fall back to the same storage command, while a crash after dispatch cannot safely claim failure or resend blindly. Source imports also commit source, immutable baseline, workspace and recovery history atomically. Evidence: [public/offlineStore.js:277](../public/offlineStore.js#L277), [public/offlineStore.js:303](../public/offlineStore.js#L303), [public/saveWorker.js:3](../public/saveWorker.js#L3), [public/saveWorkerClient.js:16](../public/saveWorkerClient.js#L16), and [scripts/test-save-worker.cjs:348](../scripts/test-save-worker.cjs#L348).

Proposed guide text:

> Preserve durable-first local saves, atomic workspace/history/outbox commits, idempotent receipts and account/game/source/language guards. Never reuse a pending operation in a different scope. Wait for local saves before switching context or exporting. Detach Vue-reactive arrays/objects before IndexedDB or worker messages. Keep old stores/history and dropped recovery data through migrations; cleanup current status caches only after their data has been migrated.

The new model derives statuses from immutable baseline/staged/dropped data. Modern local description/status boolean caches are pruned; selected-view booleans may still exist in memory, and legacy API/wire/history fields remain compatibility data. Removing or rewriting historical flags would change the meaning of old revisions. Evidence: [public/workspaceState.js:79](../public/workspaceState.js#L79), [public/workspaceState.js:97](../public/workspaceState.js#L97), [public/offlineStore.js:159](../public/offlineStore.js#L159), [public/offlineStore.js:371](../public/offlineStore.js#L371), and `../SDEditor-API/src/collaboration-store.js:52–54`.

The approved status section should remain the concise contract. The latest agreed Revised rule compares staged text with a complete immutable ZIP translation and excludes this source version’s Missing/Dropped workload; repeat saves and reversions compare against the ZIP, not the preceding save. Assignment scope here is a file workload, not an account’s language assignment. Source-version provenance must survive synchronization and resolved dropped records. This audit does not equate that approved intent with a verified hosted deployment.

### Diagnostics and desktop interaction

Keep completed diagnostic results when correcting a file or receiving a shared save; refresh the changed files and affected consistency peers rather than clearing unrelated results. Opening/editing a file must not silently run the optional full-workspace consistency or terminology scans. Evidence: [docs/editor_guide.md:94](editor_guide.md#L94), [docs/editor_guide.md:106](editor_guide.md#L106), [public/index.js:2260](../public/index.js#L2260), and [scripts/test-diagnostic-scan-options.cjs:1](../scripts/test-diagnostic-scan-options.cjs#L1).

This is useful agent guidance but does not need a detailed diagnostic tutorial in AGENTS.md. A short preservation rule and link to the editor guide are sufficient. Desktop-only scope should remain as the user’s product policy, even if older responsive CSS remains in the repository.

## Proposed source-file map

Keep the existing useful entries, but group the current responsibilities:

| Area | Files to identify in the guide |
|---|---|
| Main app and entrypoint | `public/index.html`, `public/index.js`, `server.js` |
| Parsing and translation content | `statDescParser.js`, `helper.js`, `regexEngine.js`, `translationDiagnostics.js`, `terminologyDiagnostics.js` |
| Workspace model and persistence | `workspaceState.js`, `offlineStore.js`, `saveWorker.js`, `saveWorkerClient.js`, `pendingSaves.js` |
| Settings, dictionaries and account sync | `dictionarySync.js`, `cloudSync.js`, `cloudUi.js`, `cloudHistoryUi.js` |
| Shared translation collaboration | `collaborationProtocol.js`, `collaborationSync.js`, `collaborationIntegration.js`, `collaborationUi.js` |
| Comments and lookup | `commentsUi.js`, `editorLookup.js`, `editorDictionaryIndex.js` |
| Shared surfaces and test fixtures | `appDialog.js`, `interface.css`, `index.css`, `dummyFiles.js`, `scripts/test-*.cjs`, `scripts/*-browser-fixture.cjs` |
| Companion backend | Sibling `SDEditor-API`; its `src/`, `test/`, README and own package scripts |

Load-order guidance should explicitly mention `workspaceState.js` before helpers/storage/protocol consumers and in `saveWorker.js` before `offlineStore.js`. The module supports browser, worker and Node tests; edits must preserve all three uses.

## Valid guide sections to retain

- **Project identity and no-build architecture:** vanilla JavaScript/Vue 3 from CDN, static SPA and Express development server. The architecture wording needs the module clarification above, not a framework migration.
- **Platform Support:** desktop/laptop browser, keyboard and mouse/trackpad, resized desktop windows; no mobile parity obligation. This is an explicit product constraint rather than a claim that every CSS rule lacks mobile history.
- **Server commands and defaults:** `node server.js`, `--no-open`, `--log-requests`, and the listed environment flags match [server.js:6](../server.js#L6) and [server.js:10](../server.js#L10).
- **Frontend npm placeholder:** keep the warning that `npm test` exits 1, paired with the actual direct test commands.
- **CDN dependencies/dev-server packages:** Vue, JSZip and jsdiff are loaded in [public/index.html:1186](../public/index.html#L1186); frontend npm dependencies remain Express/opn. `FileSaver.js` remains a vendored client file.
- **TypeScript limitation:** `checkJs: false` and `noEmit: true` remain true. The configured include is the main JS file plus declaration files, so TypeScript should not be presented as a repository-wide correctness gate.
- **UTF-16 encoding:** entry decoding uses `FileReader.readAsText(..., 'utf-16le')` in [public/helper.js:83](../public/helper.js#L83); export adds `FF FE` and encodes code units with `Uint16Array` in [public/statDescParser.js:335](../public/statDescParser.js#L335) and [public/statDescParser.js:366](../public/statDescParser.js#L366).
- **Dummy fixtures:** three description snippets remain, with twelve target-language blocks in the first fixture. Clarify that fixtures deliberately include missing translations and do not represent complete translations in every file/language.
- **Test mode:** it loads dummy files and bypasses normal IndexedDB startup and cloud login/sync; see [public/index.js:324](../public/index.js#L324), [public/cloudUi.js:100](../public/cloudUi.js#L100) and [public/commentsUi.js:12](../public/commentsUi.js#L12). It must not be used as proof of persistence or live authentication.
- **Commit convention and no unsolicited frameworks:** keep the existing conventional prefixes and the restriction on introducing build steps/bundlers/frameworks; correct only the claim about absent tests.
- **Silent sync policy:** keep stable content/focus/empty states, actionable failures, automatic retries and error-only Settings Sync now. Comments really use a 20-second timer and visibility/online hooks in [public/commentsUi.js:81](../public/commentsUi.js#L81). The information icon includes Different version and the full source hash in [public/index.html:466](../public/index.html#L466).

The silent-sync section is a UX requirement, not proof that every network race has been manually verified. Current UI also has a small work spinner for substantive preparation/dictionary/upload work ([public/index.html:435](../public/index.html#L435), [public/cloudSync.js:560](../public/cloudSync.js#L560)); routine polling stays silent. An optional clarification should distinguish that bounded work indicator from routine syncing messages, without weakening the stable-background-content policy.

## Related documentation drift

AGENTS.md should not become a second product manual, but its pointers should lead to consistent documents:

1. [README.md:45](../README.md#L45) and [docs/multi_version.md:42](multi_version.md#L42) still broadly describe sharing source manifests. Qualify the modern sparse path and retained legacy rooms, and mention separately synchronized dropped copies.
2. `docs/multi_version.md` still describes dictionary attachment primarily in terms of the assigned language. Align it with Manager/Admin selected-language access and the Translator restriction already described in [docs/cloud_backup.md:28](cloud_backup.md#L28).
3. [docs/test-mode.md:31](test-mode.md#L31) uses a machine-specific `file:///d:/WorkDir/SDEditor/server.js` link and shell-style environment assignment. Replace the link with `../server.js`; prefer the portable `--no-open` command or provide a PowerShell-specific environment example if needed.
4. `docs/cloud_backup.md` local-validation examples gained workspace-state, dropped-sync, storage-upgrade and worker suites on 2026-10-07. The API syntax check now includes the dropped module; both narrow tooling follow-ups are complete.
5. The updated editor/import/cloud docs and the new status contract should consistently use **Dropped** for the status and **Review** only for the action; replace old Edited descriptions with the final Revised rule. These status updates are already authorized in this conversation.

The approved follow-up aligns README and multi-version descriptions with sparse sharing, Dropped snapshots and role-based access; corrects test-mode links/commands and validation limits; and replaces README's missing `docs/workflow.md` link with the existing editor guide. The cloud validation/rollout notes were already updated with the product fixes. No runtime code change was needed for the guide edit.

## Approved edit plan — applied

1. **Already authorized:** retain the concise Workspace status intent section and its dedicated document link. Finish the agreed Revised/provenance implementation and keep the contract consistent with it.
2. **Correct factual claims:** replace the obsolete monolith/line-count, no-tests, two-theme and two-store descriptions. Keep verified command/CDN/encoding/type-check/platform facts.
3. **Replace Testing with a short operational workflow:** frontend npm stub; direct relevant CJS tests; touched-file syntax/whitespace checks; test-mode UI scope; normal-mode disposable fixtures and companion API requirements. Avoid fixed suite/test counts.
4. **Expand the file map by responsibility:** highlight workspace state, storage worker, pending saves, account/dictionary sync and collaboration protocol boundaries. Do not list every asset or repeat source implementation details.
5. **Add compact data/access rules:** immutable local baseline; sparse per-file sharing and legacy caveat; durable atomic saves; account/game/source/language guards; role-versus-assignment access; comments audience; preservation of recovery/history and completed diagnostics. Link to detailed docs rather than copying their full workflows.
6. **Refresh document pointers and linked drift:** add cloud/multi-version/status links and align the separate stale README/multi-version/test-mode statements. The user approved these changes on 2026-10-07.
7. **Validate the documentation edit:** check references against current files, search for contradictory no-tests/Edited/assigned-only/source-manifest language, and run `git diff --check`. A docs-only guide edit does not require rerunning unrelated product suites.

## Limits of this audit

This audit inspected source, package scripts, test structure and documentation in the local dirty checkouts. It did not run a fresh comprehensive test pass, contact production, inspect credentials, verify the hosted Pages/API versions, or deploy anything. Local suite/browser acceptance results reported elsewhere in this conversation remain separate evidence. Source line numbers can move as the concurrent implementation finishes; the file/function pointers and proposed statements are the useful long-term references.

The original audit made no broader AGENTS.md changes before approval. The approved documentation edits were then applied and checked against current source and file references; unrelated code was preserved. Documentation validation does not establish production deployment or repeat earlier product acceptance tests.

## Related implementation issue: explicit dropped-copy recovery after resolution

This was a separate product issue discovered during the status integration review. The user authorized its fix separately on 2026-10-07; the broader guide edit was subsequently approved and applied.

**Reproduction before the fix:** recover a legacy history entry as a dropped copy, discard or promote that copy, then explicitly recover the same entry again. [`restoreReviewCandidate`](../public/collaborationIntegration.js) and [`Client.registerDroppedCandidate`](../public/collaborationSync.js) called [`WorkspaceState.dropTranslation`](../public/workspaceState.js) with the same game, language, file, original source hash, and snapshot. The helper returned the identical resolved archive record instead of creating an unresolved copy. The recovery action reported success, but the Dropped status and comparison did not return.

A direct local model check confirmed `drop → discard → drop` with the same recovered text returns the same ID with `status: "discarded"`, while `droppedForFile` remains `null`. The API also deduplicates an identical snapshot against resolution records in `DroppedStore.upsert`, so changing only the frontend's local ID would not fix connected recovery. Automatic migration/import/retry deduplication remains useful; this failure is specific to a new explicit user recovery decision after resolution.

**Fix:** explicit recovery now captures a stable `recoveryId` for one user action across the workspace model, durable client outbox, and API schema v12 receipts. A new action can recover identical resolved text; retrying an old action returns its original generation without resurrection. Candidate conflicts retain revision checks, old resolved archives and source-version assignment provenance. Ordinary import, migration, peer retargeting and provenance uploads retain resolved-content deduplication. Regressions cover repeated recovery after discard/promotion, failed durable writes, ambiguous upload replies, resolved action replay and competing copies.

## Related implementation issue: older browser writers after migration

Also fixed separately on 2026-10-07: IndexedDB is upgraded from v4 to v5 without replacing its stores or clearing data. Older connections close on `versionchange`; older editors and workers cannot subsequently reopen v4 and write migrated workspaces. Pending old transactions finish before the upgrade. A disposable real-browser check confirmed saved text/history preservation, rejection of an already-open and newly opened old editor, and a new worker saving to v5. This does not cancel cloud requests already sent by an old tab. Deploy the compatible API before the frontend and reload older tabs; do not clear browser storage.
