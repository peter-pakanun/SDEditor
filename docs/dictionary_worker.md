# Background Dictionary preparation

`dictionaryMatching.js` is the DOM-free cooperative engine shared by the dedicated `dictionaryWorker.js` and its main-thread fallback. `dictionaryWorkerClient.js` owns transport, readiness, cancellation and failover. `dictionaryWorkerUi.js` owns application scope, detached capture and mutation scheduling. `index.js` keeps HTML rendering, translation checks and editable Dictionary actions on the main thread.

## Publication and query ownership

The worker keeps a completed index while its replacement builds. Each query pins the completed generation at submission; publication changes the ready pointer atomically. A retired generation remains available until its queries finish or cancel. The next build waits for those pins to drain, limiting the runtime to two compiled indexes.

Construction and queries yield through timer tasks with a 4 ms budget, including inside character and definition loops. Queries run round-robin, with a build slice after at most four query slices. Dictionary changes use a 150 ms trailing delay and a 500 ms maximum delay. An active build finishes; only the newest pending input is retained.

Snapshots cross the worker boundary in bounded entry, alternate and text packets. Only `commitSnapshot` makes an assembled input eligible for indexing. Rows are copied from raw Vue data in bounded batches; changed IDs and membership are replayed before the revision is sealed. A wholesale replacement restarts capture.

## Integration rules

- Every in-place Dictionary mutation must call `dictionaryEntryInput(entry)` or `markDictionarySnapshotDirty(id, options)` after changing the model. Membership changes require `membership: true`; wholesale replacement uses `replace: true`. Unknown changes can call `invalidateEditorDictionaryIndex()` for a conservative full recopy. The shallow Dictionary watcher handles replacements; it deliberately avoids traversing every row on each keystroke.
- The mutation callback updates persistence and invalidates existing manual scan results. A publication refresh updates only assistance and English highlight HTML. It never starts a manual diagnostic scan or replaces translation inputs, drafts or editor sessions.
- Account, language, game and access changes fence the old scope immediately. Language capture waits for local dictionary selection to finish. No index is built before language and game selection. Cold workspace initialization starts preparation alongside storage reads and awaits the first ready local snapshot.
- File, source, branch, session, English text and matching-option guards reject unrelated replies. Older same-scope results remain usable until a newer result is applied. An open popup retains its suggestions and notes until close. Explicit Add/Jump/Edit actions resolve current entry and alternate IDs.
- Closing either editor surface cancels queries while the app-owned cache keeps preparing. Worker creation failure, a five-second handshake timeout, a crash or a worker query failure retries through the same cooperative engine. Rendered assistance and the published plain snapshot survive failover. Only a failed fallback produces an actionable preparation error. A failed replacement retains the compiled cache for queries; **Retry preparation** captures the current Dictionary again and clears the warning only after successful publication.

The cache is in memory. There are no storage migrations or server contracts.

## Local validation record

Run `node scripts/editor-opening-browser-fixture.cjs` and use its loopback test-mode page. It includes 20,000 varied entries, alternates, a 100,000-character definition and sixteen sustained note updates. The fixture records query latency, capture/transport/serialization cost, frame gaps, input identity and field geometry. Scheduling and publication assertions in the Node tests are deterministic; browser timings are observations rather than pass/fail thresholds.

On 2026-10-09, the desktop in-app browser produced the following results while focused Node checks also ran on this host:

| Theme | Queries | Query p50 / p95 (ms) | Replies during rebuilding | Updates settled (ms) | Last capture / serialization / transfer (ms) | Largest frame gap (ms) |
|---|---:|---:|---:|---:|---:|---:|
| Light | 370 | 1.6 / 20.5 | 323 | 5370 | 371 / 30.4 / 384 | 34 |
| Grey | 404 | 1.6 / 19.3 | 354 | 5781 | 333 / 33.0 / 355 | 33 |
| Dark | 191 | 3.6 / 24.5 | 151 | 3194 | 246 / 34.6 / 338 | 50 |
| Modern dark | 225 | 2.3 / 19.3 | 184 | 3361 | 239 / 30.1 / 355 | 42 |

All four retained 12/12 input nodes with zero field displacement. Keyboard popup opening, arrow navigation, Escape and newly typed translation text remained usable. A separate run measured a 633 ms first 20,000-entry replacement, including 85 ms detached capture, 10.1 ms cumulative serialization and 203 ms transfer. Another sustained-update run measured query p50/p95 of 0.3/9.9 ms and a 9 ms largest frame gap. These synthetic local measurements do not establish production performance.

A final run with the fixture's stricter focus check completed 176 queries, including 108 replies during rebuilding, at p50/p95 0.3/10.4 ms. It settled after 1576 ms, retained all twelve input nodes with zero displacement, and kept the focused translation field and its selection unchanged. The largest frame gap was 10 ms.
