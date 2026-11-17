# StatDescription publication memory investigation

## Observed incident

On 2026-11-17, a manager reported **Failed to fetch** after preparing a
StatDescriptions group for seven teams. Host logs showed repeated V8
`Reached heap limit` crashes at roughly 480–500 MB. The host had 961 MB RAM
and about 3 GB swap. This establishes API heap exhaustion; the browser message
alone would not distinguish a crash, network failure or proxy timeout.

Read-only public checks subsequently found the API healthy, its deployed commit
matching the local starting commit, and upload CORS preflights succeeding. Those
checks do not establish successful authenticated publication or server disk space.

## Implemented local mitigation

- The server-owned parser applies duplicate choices to its own fresh objects,
  avoiding a JSON serialization/deep clone of the complete multilingual catalog.
  Other codec callers retain the default detached-copy behavior.
- New managed publication summarizes parsed files directly, without allocating
  a complete intermediate compact catalog. Persisted storage remains aggregate
  summaries and affected facts, with the exact ZIP as source authority.
- Publication releases completed derived baseline caches before loading incoming
  and predecessor sources. Carry parsing omits export-only conditions/remarks;
  an export upgrades a cached parse from the verified original when needed.
- One new-style SD finalization runs at a time. An exact concurrent retry shares
  the operation; competing work receives `503 CONTENT_PUBLICATION_BUSY`. This is
  a process-local gate, not a durable background queue. Durable upload IDs,
  exact request bodies, receipts and atomic acceptance remain unchanged.
- Transport failures identify the publication phase and explain uncertain
  acceptance. Retry the same prepared publication instead of preparing again.
  Non-JSON proxy errors retain their HTTP status. Storage errors report
  `507 SERVER_STORAGE_FULL` without destroying a usable upload response socket.

## Validation and limits

Two existing PoE2 originals, containing 20,547 and 20,732 descriptions, reproduced
the old heap failure with `--max-old-space-size=384`. The patched code completed
three successive seven-team publications, alternating those originals, without
profiling-only cache clearing. Sampled heap peaks were about 306 MiB at an
old-space setting of 384 MiB and 277 MiB at 320 MiB. A 256 MiB setting still
failed. These are Windows development measurements; V8's total heap ceiling is
larger than the old-space setting, sampling can miss peaks, and RSS also includes
buffers and other native memory. They are not a production capacity guarantee.

Focused checks cover parser identity/duplicate choices, cache upgrades including
concurrent readers, exact retry coalescing, failure recovery, storage failures,
and browser publication warnings. The full API suite reported 900 passes and
eight failures; the same eight migration failures were independently reproduced
against unchanged HEAD. Syntax and whitespace checks pass. No deployment or live
authenticated publication was performed during this investigation.

Concurrent legacy preparation and existing baseline readers may still overlap
publication. Full parsed catalogs remain in process memory during comparisons.
Increasing Node's old-space ceiling to 3,000 MiB on this approximately 1 GB RAM
host can trade a V8 failure for swapping or operating-system memory pressure.

## Client-prepared publication follow-up

The separate SDEditor2 project prepares SD sources and advancement in the browser.
It uploads exact originals separately in resumable 4 MiB parts, pages frozen
predecessor records at 100 per request, and sends decisions in parts bounded by
512 KiB and 1,000 records. Server validation binds compact source facts,
snapshots, revisions and prepared generations before coordinated acceptance;
the server does not reparse the ZIP to independently prove the supplied facts.
The browser still materializes source catalogs and team decision arrays.

SDEditor now implements [client-prepared SD publication](sd_client_publication.md)
under negotiated `sd-client-publication-v1` and API schema 32. It uses frozen
per-team predecessor snapshots, bounded facts/disposition parts and atomic final
acceptance while preserving retry bodies and server ownership of authored
targets/history/recovery. This is implemented source, not deployment.

Three real-ZIP publications (20,547 → 20,732 → 20,547 descriptions), each for
seven teams, passed with API old-space capped at 128 MiB and browser parsing in
a separate Edge renderer. API parser hooks were configured to throw and were
never called. Sampled API peak heap was 68.35 MiB and RSS 144.93 MiB. This fixture
had no authored predecessor work; the separate synthetic native browser fixture
checks Saved/recovery/history preservation and recalled-text Save with a normal
draft present. V8's total heap ceiling differs from the old-space setting, and
these development measurements are not a production capacity guarantee.

SDEditor currently creates automatic Dropped copies of untouched predecessor ZIP
translations when incoming text disappears. SDEditor2 instead permits on-demand
client recall through **Compare English source**: it prefers an exact frozen
recovery, then historical authored work, then the matching historical original's
translation. Its English diff highlights additions/removals, with whitespace and
character options; recalled targets enter a separate unsaved review buffer.
The final entry confirmation may Save the complete reviewed file. Simply viewing
the reference does not create authored work. The original fallback requires a
complete translation and an available matching ZIP/client cache; this particular
loader also makes a historical-work request before trying that fallback.

The user selected on-demand recall for new client-prepared managed publications.
Old automatically created Dropped copies remain intact, and local import/legacy
request semantics stay compatible. Untouched ZIP-only text is recalled from its
exact original instead of manufactured as a new Dropped copy.
Missing historical ZIPs remain optional; never invent unavailable old text.
Permanent extracted catalogs or additional full source catalogs in SQLite are
unnecessary. Temporary server extraction alone would not remove the catalog
allocations that caused this incident.
