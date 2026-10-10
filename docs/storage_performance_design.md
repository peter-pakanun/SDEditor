# Storage and preparation performance design

Recorded: 2026-10-09; ClientText update: 2026-10-10. The original frontend design at `3107a34` includes the local readiness work in `595caf1` and the preceding normalized storage, durable save, and Dictionary worker changes. TM added IndexedDB v10/API v17; ClientText added browser v11/API v18, with bounded ClientText persistence and transport fenced by browser v12. Measurements are local observations, not guaranteed startup times or hosted deployment confirmation.

Use this design when adding another content mode with comparable original content, editable fields, saved work, recovery, and shared editing. StatDescription and ClientText workbook adapters are implemented in source; deployment remains separate.

The [Workspace Status Contract](workspace_statuses.md) governs status and recovery meaning. [Local-first Server Storage](local_first_server_storage.md) governs accepted baseline retention, publication, exports, server payloads, and rollout. Read those documents before changing their boundaries.

## Why storage became part of responsiveness

The original single-user design could keep a complete working object in memory and serialize it to LocalStorage. Online collaboration introduces independent durable facts: accepted originals, selected-language saved translations, dropped copies, drafts, queued submissions, shared revisions, conflicts, replay cursors, and acknowledgement receipts. They must survive reloads and commit consistently across the page and save worker.

LocalStorage is synchronous and cannot atomically update these records across stores. Rewriting a whole workspace on every small save also makes the cost grow with total original content. IndexedDB provides transactions, indexes, worker access, and smaller updates. It still incurs structured cloning, object allocation, result delivery, and garbage collection. Moving data to IndexedDB does not automatically make a full-workspace read inexpensive. IndexedDB was introduced in May 2026 before online collaboration; the later per-file refactor removes aggregate habits that collaboration made more expensive.

The current design therefore distinguishes durable records from materialized read views. Ordinary saves operate on affected units. Opening a workspace may materialize a complete view, but must avoid repeated reads, copies, and thousands of independent callbacks.

## Ownership and data layers

| Layer | Authority and lifetime | Rules |
| --- | --- | --- |
| Accepted original | Complete parsed baseline, accepted archive descriptor and proof tree; tied to source identity | Immutable. Includes original English, all original languages, and entry metadata. UI decoration, saves, shared edits and recovery do not rewrite it. |
| Durable authored work | Per-language staged translations, recovery/provenance, drafts, submissions, history, operations and receipts | Persist facts with captured scopes and revisions. Dropped text is separate recovery evidence, never fallback current text. |
| Workspace/editor views | Detached source, overlaid descriptions, computed statuses, search rows and editor models | Derived, independently mutable read views. Do not persist status booleans as authority. Rendering edits cannot mutate the baseline. |
| Assistance cache | Dictionary/TM snapshots, compiled indexes and English matches | Rebuildable memory data. Same-scope older generations are valid until a completed replacement is applied; hard scope changes invalidate them. |

`baseline_files` is reusable by game/source identity. Workspace and collaboration work additionally require account, branch and selected-language isolation. The browser still loads content into memory for editing; IndexedDB is the durable source of facts rather than a prohibition on memory caches.

## Scope and asynchronous fences

Capture identity before the first await, queue insertion, IndexedDB request or worker message. Do not read a mutable selected version later to choose the destination of already-started work.

- Workspace identity: account, game, branch (initially `default`) and source hash; explicit content groups also capture version/group IDs.
- Translation and collaboration identity: workspace identity plus selected language; preserve role/access context guards in the UI and requests.
- Dictionary scope: account, selected language, game and effective access context. Source/branch changes can reuse the dictionary index while invalidating editor results.
- TM durable scope: account/profile and selected language. Units carry game scope and source/branch provenance; the compiled assistance index also captures selected game/access context.
- Editor result identity: scope plus source, branch, file, editor session and exact English input. Inline/full handoff must retain the intended session and draft ancestry.
- Hard context change: advance the relevant epoch immediately, cancel obsolete requests, and reject late publication.
- Same-scope Dictionary change: advance cache generation; allow a query pinned to an older completed generation unless a newer result has already been applied.

`OfflineStore.activateVersion` also fences the durable active pointer. A token is allocated per account/game/branch pointer before awaits. Superseded activation is checked before and inside pointer writes, and an already queued older pointer transaction is aborted when a newer selection starts. A late activation rejects with `WORKSPACE_ACTIVATION_SUPERSEDED` and `stale: true`; it must not overwrite the active pointer or cached context, even if the newer selection fails. Independent pointer keys remain independent.

## Normalized IndexedDB records

IndexedDB v12 retains the v9/v10 scoped stores in [normalizedStore.js](../public/normalizedStore.js) and the ClientText stores introduced in v11:

| Store group | Purpose |
| --- | --- |
| `baseline_files`, `baseline_assets` | Accepted per-file originals; archive decisions and proof/tree assets |
| `translation_workspaces`, `workspace_files`, `workspace_records` | Workspace metadata, factual per-file overrides, staged/recovery/provenance records |
| `translation_drafts` | Durable private checkpoints and captured base/source references |
| `collaboration_rooms`, `collaboration_files`, `collaboration_operations`, `collaboration_records` | Accepted shared state, authored operations, conflicts, carries and recovery |
| `save_submissions`, `save_receipts` | Durable submitted commands and idempotent commit evidence |
| `storage_migrations` | Resumable normalization readiness and progress |
| `tm_units`, `tm_meta`, `tm_outbox`, `tm_records` | Active/suppressed units, local/cloud revisions, pending mutations, conflicts, history and receipts |
| `clienttext_workspaces`, `clienttext_assets`, `clienttext_units` | Ready/importing workspace metadata, exact original workbooks/proof trees and immutable per-ID baselines |
| `clienttext_saved`, `clienttext_drafts`, `clienttext_history`, `clienttext_outbox`, `clienttext_receipts` | Per-ID authored values/reviews, private drafts, history, captured retry commands and durable save evidence |
| `clienttext_requests` | Scoped publication, collection and comment request journals with stable IDs |
| `clienttext_memory`, `clienttext_memory_history` | Local field-aware TM projection from valid durable and accepted shared saves |

Aggregate source/workspace/room objects are adapters for consumers, not another copy to rewrite on every save. Existing revision stores remain available. Legacy aggregate KV data remains frozen recovery evidence; once normalized readiness is established, normalized absence is authoritative. Do not dual-write aggregates or clear storage to bypass a blocked upgrade.

### Bounded ClientText preparation

Workbook ZIP size does not represent the size of its parsed data. The supplied Thai workbook has 149,550 IDs: its parsed-unit JSON is about 152 MB, compact manifest 145 MB and proof tree 30 MB. Returning database rows with both units and compact metadata, or journaling both predecessor and incoming witnesses for every carried ID as one value, can exceed Chromium's serialization limit.

ClientText original reads now use primary-key pages of at most 128 rows and discard unneeded compact copies per page. Fresh immutable import batches validate accepted compact metadata and enqueue writes without a separate asynchronous existence read per ID. Worker inputs and outputs stream bounded collections, with oversized individual records fragmented into transferable bytes. Journal and proof-tree fragments retain exact materialized compatibility views; small committed headers reference completed fragments, and older direct records remain readable. Repeated publication checkpoints reuse immutable carry fragments while preserving request IDs and scope guards.

Carry-forward loads each predecessor proof tree once per workbook, rather than rereading its full asset per affected ID. Individual saves read only their necessary proof chunks. Equivalent hashing reuses bounded scratch/cache data; the Thai manifest benchmark improved from 28.7 to 13.3 seconds with the same baseline ID and Merkle root. The API reuses prepared SQL statements, aggregates staged chunk counts and copies accepted rows in one transaction. A local synthetic 20,000-ID fixture reduced staging/finalization from 3.94 to 1.74 seconds. Capability-gated gzip reduced its compact JSON from 20.36 to 3.29 MB; expanded validation limits remain in force. These timings measure particular local fixtures, not total production upload duration.

### Atomic saves and deferred navigation

[pendingSaves.js](../public/pendingSaves.js), [saveWorkerClient.js](../public/saveWorkerClient.js), [saveWorker.js](../public/saveWorker.js) and [offlineStore.js](../public/offlineStore.js) separate navigation from durable save acknowledgement:

1. Capture and detach the command, its scope, stable job ID, expected base and checkpoint revision.
2. Journal the compact submission durably before releasing the current editor. Prepare and paint the destination before dispatching heavy queued work where the navigation path holds the queue.
3. Execute the same affected-file storage command in the save worker or direct fallback.
4. Commit translation facts, history, exact recovery/checkpoint consumption, collaboration retry work and receipt together.
5. Publish Saved/status only after durable acknowledgement. Consume only the submitted checkpoint revision; newer typing remains recoverable.
6. On uncertain worker completion, retry the same job ID/content and read its receipt. Never create a fresh ID and blindly resend. Reload replays durable submissions with their original identity and scope.

Receipts verify command signatures. A reused ID with different content is an error. UI callbacks run after durable acknowledgement and must not turn an observer failure into a duplicate saved revision. Remote event changes and replay cursor commit together; a mutation acknowledgement does not skip unseen events.

TM learning prepares only the saved file's complete English/target entry pairs, then joins the same affected-file transaction. It does not rescan the workspace or modify the immutable baseline. Nonblank syntax/structure-compatible pairs are eligible; unresolved Dropped text and drafts are not. Unit identity uses raw source and canonical context within language/game scope. Corrections update the active unit and append history; tombstones prevent automatic relearning. Revision and mutation checks preserve replay safety across local saves and cloud events.

Core normalization shares the API's field limits: source/target 32,768 characters, note/condition/remarks 4,096, filepath 2,048, and at most 128 stat IDs of 1,024 characters each. Oversized auxiliary learning is excluded without failing the translation save. Explicit imports/edits must validate before queuing; wire mutations additionally respect 100-unit and 1 MiB limits.

## Combined activation and immutable source reuse

Before the optimization, opening could separately read source, materialize workspace, fetch imported baseline, and then copy original content again for rendering. Profiling showed repeated copies, allocation and garbage collection rather than Dictionary worker activity.

The implemented activation path is:

1. Capture the workspace scope and complete any required readiness conversion.
2. In one readonly transaction, capture metadata, workspace file rows, workspace records, accepted original rows and baseline assets in parallel.
3. Wait for the readonly transaction to complete. IndexedDB responses are already detached values.
4. Materialize source, workspace overlays and retained baseline views cooperatively outside the transaction.
5. Return `{ workspace, source, baseline, scope, sourceBaselineId }` where the provider can prove accepted source provenance.
6. Apply selected-language translations/statuses to the detached source, wait for the first Dictionary snapshot and prepare cached shared work before releasing the local initialization gate.

`materializeActivation` checks work inside array/object copying, stable merge sorting, recovery assembly and file overlays. `runActivation` targets 4 ms slices, checking the clock after 32 generator steps and yielding through an actual task. This is a cooperative target, not a bound on native IndexedDB cloning, a single primitive operation, browser GC or OS scheduling.

Do not insert task yields into an active readwrite transaction: the browser can close the transaction between tasks and break atomic work. The post-transaction capture/assembly split is deliberate. Captured rows remain a consistent snapshot if the live workspace changes during assembly.

The source, workspace descriptions and imported baseline source are independent views. [index.js](../public/index.js) reuses the supplied detached source only when `sourceBaselineId`, archive ID, game, account, branch, source hash and description count agree and the source array does not alias the imported baseline. Legacy or unproven adapters retain the baseline as authority and copy it. A marker alone is not permission to trust an arbitrary mutable source.

The accepted baseline need not be recursively frozen in production; freezing the whole corpus itself costs time. Tests use deeply frozen baselines to enforce the invariant. Language changes during preparation rerun the overlay with the latest language before publication.

### Transaction-local read reuse

Immutable baseline reads are shared within one transaction, including in-flight selected reads requested by room and workspace adapters. Missing baseline rows remain uncached because an import may insert them later in that transaction. Caches end at transaction boundaries.

Baseline asset reads are reused only in readonly transactions. Assets may be replaced by a same-identity import, so readwrite reads must see subsequent puts. Avoid broad process-level caching of mutable assets under an assumed immutable identity.

## Bounded selected reads

Thousands of point requests can occupy the event loop with success callbacks even when individual requests are small. [normalizedStore.js](../public/normalizedStore.js) and [normalizedRooms.js](../public/normalizedRooms.js) use an adaptive strategy:

- Fewer than 128 selected keys: preserve exact point/index reads. Ordinary one-file saves and draft lookups remain narrow.
- Larger selections: deduplicate and sort encoded keys, then process batches of at most 128 keys.
- Count the bounded range between the first and last key before materializing it.
- If the range exceeds eight rows per selected key, use exact requests for that batch; otherwise read the range and retain only rows with the expected scope and selected keys/paths.
- Deduplicate results by primary key, preserve established requested-file/per-path order where required, and keep absent baseline rows insertable.

The row-count guard prevents a sparse selection from decoding an unlimited interval of unrelated recovery text. It is a row bound, not a byte bound: an exceptionally large row can still be expensive. Increasing batch size or overfetch allowance needs a profile and recovery/isolation tests.

Room selection preserves operation closure: if an operation spans several files, all its member paths and required operation IDs enter the final selection. It reads headers for selected recovery groups without hydrating their unrelated file members. Cold sparse reconnect discovers actual shared/authored/recoverable work instead of expanding every immutable manifest original into workspace descriptions. Partial projections must not erase unloaded groups or load cold import-recovery archives merely to save one file.

The exact selected originals are hydrated only after the final affected-path set is known. Granular room/workspace writes remain atomic and preserve unchanged rows, ordering, carries, conflicts and recovery identity.

## Dictionary preparation and two cache generations

[dictionaryMatching.js](../public/dictionaryMatching.js) is a shared DOM-free engine used by [dictionaryWorker.js](../public/dictionaryWorker.js) and the cooperative main-thread fallback. HTML rendering and translation diagnostics remain on the main thread.

The worker owns the trie and compiled matching state. Plain snapshots contain definitions, replacements, alternates, notes and game membership. Matching preserves game overrides, alternate normalization, keyword handling, longest-first ordering, boundaries, overlap rules and escaped-text coordinates. Each query owns its matching state.

- `ready` is the completed index available to queries; `building` constructs its replacement.
- A query pins `ready` when it begins and retains it until completion/cancellation.
- Publication changes the ready pointer atomically. Queries already pinned to the old snapshot finish consistently.
- A pinned old ready index becomes `retired`. Another build waits until it is released, limiting the runtime to two compiled indexes. Raw transfer/capture snapshots can still occupy additional memory.
- Queries run round-robin in approximately 4 ms cooperative slices. At most four query slices occur before one available build slice, so queries remain responsive and rebuilds eventually progress.
- An active same-scope build finishes. Only the newest pending input is then built; continuous edits do not repeatedly discard construction.

[dictionaryWorkerUi.js](../public/dictionaryWorkerUi.js) coalesces actual changes with a 150 ms trailing delay and 500 ms maximum delay. Capture detaches rows in bounded work, journals affected IDs, recopies changed rows/membership before sealing, and restarts on wholesale replacement. Never submit Vue proxies or label a mixed capture as a completed revision.

[dictionaryWorkerClient.js](../public/dictionaryWorkerClient.js) transfers bounded plain packets, attaches request ID/scope epoch/cache generation, cancels queries, and retains the plain published snapshot for failure recovery. Worker creation failure, a five-second startup handshake timeout, or crash activates the same cooperative engine on the main thread. Keep rendered assistance while fallback rebuilds; do not introduce a synchronous rebuild. Routine preparation/refresh remains silent. An actionable failure is shown only when worker and fallback cannot prepare.

An open file batches decoded English blocks/table fields once. Translation typing and popup navigation reuse captured results synchronously. On a new publication, refresh assistance without replacing translation text, drafts, inputs, selection, focus, scroll, held dictionary row order or editor session. An open autocomplete popup keeps its results until it closes. Paste, highlights, suggestions and notes use one captured snapshot; dictionary Add/Jump/Edit validates current editable IDs and duplicate creation against the live model.

Closing an editor cancels its queries, not app-level background preparation. Full/inline opening, handoff, draft recovery, restored translations and table/source-diff paths share preparation; reuse exact-English matches when scope/input identity permits. Opening a file does not run an optional full-workspace diagnostic scan.

## TM retrieval and preparation

[translationMemory.js](../public/translationMemory.js) is shared by the worker, cooperative fallback, save capture and Node checks. It groups eligible units by game and raw source, then builds exact/safe-variable maps, source lengths and bigram postings. Game-specific raw sources override All. A query first retrieves exact/context matches and verified variable adaptations, then uses admissible length/bigram lower bounds and banded Unicode Levenshtein distance for fuzzy candidates. It has no fixed candidate shortlist: pruning preserves the deterministic top results. Exact identity is raw English; NFC/case/whitespace normalization affects only fuzzy lookup. Ambiguity considers every target variant, including variants beyond the visible result limit.

[tmWorkerClient.js](../public/tmWorkerClient.js) transfers bounded detached packets and fragments large fields. [tmWorker.js](../public/tmWorker.js) publishes completed generations atomically. Queries pin their index until completion/cancellation; a retired pinned index delays the next build, keeping at most two compiled generations. Construction and retrieval yield in approximately 4 ms slices, with captured scope epochs and cancellable requests. Worker failure restores the last published snapshot into the same cooperative engine before building the newest input. Raw snapshots, transfer buffers and garbage can consume memory beyond the compiled index limit.

Insertion validates the live unit's shared/local revisions and the captured editor session, English and draft after any confirmation. It creates a draft only. Prefill additionally requires an unambiguous compatible raw exact/context result and rechecks every row across awaits. Background TM changes preserve current text and actionable errors.

The read-only Monday-labelled PoE2 ZIP benchmark (`2026-10-05_POE2_StatDescriptions.zip`, SHA-256 `1a2a6115f7807e0c95d0d4f537dac0d8fd3eb1f2c551d1e48d8ff14ee4d3f884`) yielded 30,103 eligible Thai pairs and 26,277 distinct sources. A local Node run built the index in 314 ms and matched seven exact, typo, polarity, variable, short, table and multiline queries identically to exhaustive search; indexed query times ranged from 2 to 264 ms. Retained heap after explicit GC was 68 MiB. These are single-run Node observations, not browser latency guarantees. A separate synthetic 100,000-source check exercises construction/cancellation and reports its larger memory footprint.

Reproduce with `node --expose-gc scripts/test-translation-memory-performance.cjs <zip-path>`; omit the path for the synthetic corpus. Archive decoding uses the sibling API's installed parser/JSZip. It does not mutate the input ZIP or import units into browser storage. Keep exhaustive equivalence checks when adjusting pruning or score normalization.

## Local readiness and background work

[workspaceInitialization.js](../public/workspaceInitialization.js), [index.js](../public/index.js), [cloudUi.js](../public/cloudUi.js) and [collaborationIntegration.js](../public/collaborationIntegration.js) make the readiness boundary explicit:

1. Establish local profile, game, selected language and active source.
2. Load/verify local content, recover queued local work, prepare translation/status/search views, prepare the first Dictionary generation, and reconcile the cached shared room.
3. Publish the usable local workspace and complete Initialization.
4. Start session/network synchronization in a later task after the prepared workspace has had a paint opportunity. Remote synchronization does not own the local readiness gate.

An uncached source download or missing required version facts still needs the appropriate explicit network work. Cached opening should not wait for authentication/network synchronization when local facts are sufficient. Background jobs retain captured contexts, preserve editing, remain silent when healthy, and show relevant failures until resolved. Updating remote work refreshes affected rows rather than reapplying the full corpus.

Lookup rows are lazy: preparing a hidden lookup panel previously walked/reactively copied the whole corpus. [editorLookup.js](../public/editorLookup.js) builds the required visible scope on demand and uses scoped indexes rather than eagerly rendering hidden rows.

## Measurements and remaining work

The supplied Thai logs show selected-version opening decreasing from 53.3 s to 5.4 s after local readiness/read reuse changes, then 5.1 s after the activation/batching pass. Cached startup decreased from 37.7 s to 4.4 s. These are observed user runs, not controlled before/after measurements; the large early reduction includes moving remote synchronization beyond the local gate, not only faster disk access. Parent and child log rows overlap and must not be added together.

The later profiled opening was 5.5 s: cached-source read 1.0 s, activation 3.2 s, cached collaboration 1.2 s. Displayed 0.0 s means below the one-decimal display precision, not literally no work.

The user also reported saving decreasing from 2.5–3.5 s to under 40 ms during the same development period. The exact measurement boundary was not supplied. Preserve this as an observed user-facing saving result, not a transaction-only or remote-acknowledgement benchmark. Deferred navigation, granular writes and background work all affect perceived saving; future measurements should separate journaling, local commit and remote synchronization.

The 15.46 capture showed 18,730 IndexedDB success events in five seconds and substantial cloning/GC; this motivated batched selections. The 16.18 capture still showed 6,670 events and timer overhead. Captures cover different windows, so these counts are evidence of work patterns, not a controlled event-count improvement percentage.

Open follow-ups, **not implemented by these patches**:

| Finding | Next design step and constraint |
| --- | --- |
| Activation yielded 127 times with about 534 ms in timer waits; typical waits were about 4.3 ms | Evaluate a shared task scheduler that yields through actual tasks without repeated nested `setTimeout(0)` clamping. Keep injectable deterministic scheduling and fair query/build progress. Promises/microtasks alone do not let input/rendering run. |
| Initialization can appear paused in an inactive tab | Distinguish focus from `document.hidden`. Inactive timers are throttled; animation frames may stop. Current paint helpers check visibility before requesting a frame but do not fully protect against becoming hidden while awaiting it. Make paint waits settle across visibility transitions, with cleanup/cancellation and scope fences. Browsers can suspend a tab entirely, so promise no guaranteed hidden-tab throughput. |
| `continueManagedVersion` reads the entire cached source just to test its length before activation reads it again | Add a cheap readiness-aware source-existence/count operation, preserving legacy conversion/absence semantics and scope. Do not infer existence from an unready migration marker or unrelated baseline. |
| Sparse cached connection rebuilds complete manifests and baseline-derived maps | Cache/reuse validated immutable derived data under accepted baseline identity; separate language-specific baseline states. Account/access and room state remain separately scoped. Do not reuse mutable edited descriptions as accepted originals. |
| Activation remains a several-second phase | Split log timings into storage result delivery and cooperative construction before choosing more changes. Native structured clone and GC cannot be made interruptible by inserting JS budget checks. |

The 16.18 profile contained only a short blur/focus transition, so it does not establish a prolonged hidden-tab stall. Validate that case explicitly before attributing all delay to throttling.

### Measurement policy

- Preserve user production files and storage. Reproduce on disposable normal-mode origins/profiles; test mode bypasses real IndexedDB/authenticated startup.
- Record corpus size/shape, languages, alternates, large entries, affected paths, cache warmth, visibility, hardware/browser, network condition and whether profiling was enabled.
- Capture local readiness separately from subsequent remote work; report parent/child overlaps clearly.
- Measure query p50/p95, rebuild duration, serialization/transfer cost, storage request counts, construction CPU, GC and frame/input gaps. A native API callback leaf is not automatically disk time.
- Use deterministic scheduler assertions for fairness, cancellation and publication. Avoid machine-dependent timing thresholds in automated checks.
- Test a cold initialization, a cached reopen, immediate editor interaction and a delayed open after CPU settles. Use a longer capture or successive windows where the profiler limits capture to five seconds.
- Include hidden-to-visible and visible-to-hidden transitions; do not use keyboard focus alone as visibility evidence.
- Local synthetic fixture timings are not hosted production guarantees. Retest after deployment with comparable inputs and capture windows.

## ClientText implementation and measured preparation

[contentAdapters.js](../public/contentAdapters.js) supplies shared serialization/history/lookup/TM contracts; ClientText preserves raw `@`, actual newlines and literal `\n` rather than applying StatDescription editor transformations. Field kind and grammatical form constrain memory matching; heading, workbook role, sheet and record/field IDs remain context/provenance. Gender enum cells, blanks, `NONEXISTENT`, unreviewed Outdated values, conflicted records and source-only carries do not teach TM. Accepted shared events teach the local projection, independently of legacy cloud TM.

Workbook parsing, manifest hashing and full export run through the ClientText worker. Immutable units are written in resumable batches, then materialized once for editing; a save touches its unit, draft, history, outbox, receipt and memory projection atomically. Worker/transaction uncertainty retries the identical job ID. Polling reuses unchanged saved objects and status caches, and event pages commit their cursor with accepted work. An acknowledgement cannot skip unread events. This avoids routing a 100,000-plus-row workbook through StatDescription aggregate storage.

The initial disposable normal-mode browser run used the attached production workbooks: **149,550 Thai units, 89,659 French normal units and 68,250 French Gender units**. Combined preparation took **53.5 s** and storage **73.1 s**. Cached Thai opening took **6.1 s** and full export **8.2 s**; French paired opening took **9.35 s** and paired export **15.5 s**. A second successful production-file run under concurrent load recorded **97.8 s** preparation, **139.5 s** storage and **2.75 s** maximum event-loop lag; Thai opening/export took **6.0/8.15 s**, and French pair opening/export **7.72/12.36 s**. Different load conditions prevent a direct before/after speed comparison. These are local phase observations, not a hosted service benchmark or a promise for every machine.

After bounded reads/writes/worker transport and equivalent hashing changes, the same three files passed again: **43.65 s** preparation, **22.23 s** local storage and **9 ms** maximum measured event-loop lag across 658 timer ticks. Cached Thai opening/edit/export took **2.90/0.90/5.20 s**; French Normal/Gender opening/edit/paired export took **2.89/0.93/6.09 s**. All 307,459 IDs, theme layouts, F2 saves, workload fills and untouched workbook package parts were checked. This local import/export run does not measure network publication. `node scripts/clienttext-browser-fixture.cjs --production --keep` reproduces it; `CLIENTTEXT_PRODUCTION_DIRECTORY` overrides the sample folder.

The separate `--large-journal` browser case persists and reloads a **294,954,780-byte** carry checkpoint, beyond the old 257,949,696-byte single-value limit. It verifies bounded writes, exact hydrated text after reload, preservation of the previous complete checkpoint on injected fragment failure, same-ID retry and deletion. Resume reads accepted compact records directly instead of rehashing all original units on the UI thread. API gzip routes and limits are covered by the sibling API tests; local browser fixtures do not establish hosted CORS or deployment.

The implementation checkpoint passed **346 focused checks** before later integration fixes; use current suite output for the final count. The disposable shared-publication/collection browser fixture also passed, followed by draft reload, injected failed-original-upload recovery, cached publication resume, proof-verified saves and frozen collection export. Mixed new StatDescription/ClientText group switching and both frozen collection formats passed. Repeated-original StatDescription versions also passed independent group saves, cancelled selection and actual offline activation of both groups. A cached immutable baseline and a ready group workspace are separate facts: opening a new group creates empty independent work from the verified retained original; it does not reuse another group's saves. Collaboration stays detached through version confirmation and central workspace activation, and resumes only when loaded workspace metadata matches the selected group/version. Production-file and synthetic local checks do not establish hosted authentication/deployment or restoration from production backups.

## Extending to another content mode

Keep the storage/lifecycle design common and place format-specific behavior behind an adapter. Start with explicit unit and field identities; do not make an array position or display name the durable ID if it can change.

| Adapter responsibility | Required contract |
| --- | --- |
| Parse and accepted configuration | Produce detached original units, ordered source fields, original language fields, validation metadata and accepted duplicate/parser decisions. |
| Unit/field identity | Stable path/unit ID plus stable field ID where a unit has several independently editable fields; define source advancement behavior when fields are added, reordered or removed. |
| Count/shape validation | Describe expected editable field count/order/types and explicit blank semantics. Do not assume every mode is one array of English lines. |
| Original witness/hash | Include all original fields needed for equality, Missing/Revised decisions, recovery and export; preserve canonical encoding/parser configuration in accepted identity. |
| Overlay and status | Apply selected-language staged work to an independent view and derive status facts from original/staged/recovery provenance. No persisted UI flags. |
| Serialize/export | Ordinary local export uses verified originals plus durably staged Saved text, including completed local saves still awaiting upload. Managed collections use their frozen server-accepted Saved manifest. Preserve untouched fields and encoding. Private drafts, uncommitted local submissions and unresolved Dropped copies are not fallback export text. |
| Assistance units | Supply exact decoded source text and field IDs to batched matching, then map escaped coordinates back to the renderer without reparsing on every translation keystroke. |
| Recovery and advancement | Preserve old source/field metadata with text and stable recovery ID; explicitly reconcile shape changes without silently promoting or discarding evidence. |

Reuse scopes, activation snapshots, atomic submission/receipt commands, affected-unit projections and worker assistance as infrastructure. Add a content-mode discriminator wherever identities or parser/serializer contracts could otherwise collide. A mode-specific source change remains a hard editor-result fence even if Dictionary scope is unchanged.

### Implementation checklist

1. Read the status/baseline contracts and identify the accepted source authority for the new mode.
2. Define stable unit/field IDs, canonical source identity, blank/shape rules and serializable plain payloads.
3. List durable facts, derived views and cache ownership separately. Prove edits cannot mutate accepted originals.
4. Capture full scope before awaits; test late replies, account/language/source/branch changes and overlapping activation writes.
5. Keep ordinary saves/queries bounded by affected units. Define bulk thresholds and overfetch guards using realistic record distributions.
6. Commit authored work, exact recovery consumption, history, retry operation and receipt atomically. Replay with the original command identity.
7. Capture bulk readonly rows consistently, close the transaction, then yield during construction. Never split atomic writes across tasks.
8. Reuse validated detached views and immutable derived data rather than cloning them again in each consumer.
9. Prepare local necessities before the gate, defer remote work, and preserve user editing during reconciliation.
10. Route every opening/recovery/handoff/render path through shared preparation and preserve popup snapshot consistency.
11. Exercise unsupported workers, uncertainty, interrupted conversion, absent source evidence and fallback preparation.
12. Validate real IndexedDB and keyboard interaction in disposable desktop profiles, including all four themes and visibility changes.

## Code and validation entry points

| Change | Implementation | Focused checks |
| --- | --- | --- |
| Normalized rows, bounded reads, transaction-local reuse and cooperative activation | [normalizedStore.js](../public/normalizedStore.js) | `node scripts/test-normalized-storage.cjs` |
| Room operation closure, recovery headers and partial projections | [normalizedRooms.js](../public/normalizedRooms.js) | `node scripts/test-normalized-rooms.cjs`, `node scripts/test-collaboration-storage.cjs`, `node scripts/test-collaboration-sparse-sync.cjs` |
| Pointer fencing, submissions/receipts and compatibility | [offlineStore.js](../public/offlineStore.js), [saveWorkerClient.js](../public/saveWorkerClient.js) | `node scripts/test-storage-upgrade.cjs`, `node scripts/test-save-worker.cjs`, `node scripts/test-editor-drafts-storage.cjs` |
| Local initialization gate and immutable render reuse | [index.js](../public/index.js), [workspaceInitialization.js](../public/workspaceInitialization.js), [collaborationIntegration.js](../public/collaborationIntegration.js) | `node scripts/test-collaboration-lifecycle.cjs`, `node scripts/test-initialization-phases.cjs`, `node scripts/test-workspace-initialization.cjs`, `node scripts/test-managed-versions.cjs` |
| Worker matching/capture/fallback | [dictionaryMatching.js](../public/dictionaryMatching.js), [dictionaryWorkerClient.js](../public/dictionaryWorkerClient.js), [dictionaryWorkerUi.js](../public/dictionaryWorkerUi.js) | `node scripts/test-dictionary-worker.cjs`, `node scripts/test-dictionary-worker-client.cjs`, `node scripts/test-editor-dictionary-index.cjs` |
| TM matching, worker fallback, draft insertion, durable learning and cloud replay | [translationMemory.js](../public/translationMemory.js), [tmWorkerClient.js](../public/tmWorkerClient.js), [tmUi.js](../public/tmUi.js), [tmCloudSync.js](../public/tmCloudSync.js) | `node scripts/test-translation-memory.cjs`, `node scripts/test-translation-memory-worker.cjs`, `node scripts/test-tm-ui.cjs`, `node scripts/test-tm-storage.cjs`, `node scripts/test-tm-cloud-sync.cjs` |
| Editor/lookup/render paths | [editorLookup.js](../public/editorLookup.js), [inlineEditor.js](../public/inlineEditor.js), [index.js](../public/index.js) | `node scripts/test-editor-lookup.cjs`, `node scripts/test-editor-lookup-ui.cjs`, `node scripts/test-editor-opening.cjs`, `node scripts/test-inline-editor.cjs`, `node scripts/test-render-safety.cjs` |
| ClientText parse/proofs, atomic saves, events and raw field adapters | [clientTextCodec.js](../public/clientTextCodec.js), [clientTextState.js](../public/clientTextState.js), [clientTextStore.js](../public/clientTextStore.js), [clientTextSync.js](../public/clientTextSync.js), [contentAdapters.js](../public/contentAdapters.js) | `node scripts/test-clienttext-codec.cjs`, `node scripts/test-clienttext-state.cjs`, `node scripts/test-clienttext-store.cjs`, `node scripts/test-clienttext-sync.cjs`, `node scripts/test-clienttext-ui.cjs`, `node scripts/test-content-adapters.cjs` |

Use [normalized-storage-browser-fixture.cjs](../scripts/normalized-storage-browser-fixture.cjs) for real IndexedDB behavior, source/workspace isolation, pointer races and dense versus scattered selections. Use [startup-performance-browser-fixture.cjs](../scripts/startup-performance-browser-fixture.cjs) for 20,000 controlled rows, all four desktop themes, hidden lookup laziness, immutable baseline reuse, local/remote gating and typing/focus/caret/scroll/layout preservation. Its controlled provider is not a production ZIP import or full hosted network test.

Extend existing tests rather than adding a framework. Syntax-check touched JavaScript and run `git diff --check`; `npm test` is an intentional frontend stub. Current frontend rollout requires API schema v18 and separate API checks first. TM's disposable normal-mode browser check is `node scripts/tm-browser-fixture.cjs --check`; ClientText uses `node scripts/clienttext-browser-fixture.cjs --check`. Browser fixtures do not establish hosted OAuth/CORS or production restoration readiness.
