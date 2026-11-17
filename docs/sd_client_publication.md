# Client-prepared StatDescription publication and recall

Implemented in browser/API source, not confirmation of hosted deployment.
Deploy API schema **32** before the companion frontend. Retain the pre-upgrade
database/configuration backup and required artifacts. Do not clear browser data.

## Publication and source authority

The content policy advertises
`statDescriptionPublicationProtocols: ['sd-client-publication-v1']`. Fresh SD
preparations require that capability. The browser checks exact ZIP bytes, CRCs,
safe paths, expansion bounds, game, parser structure and duplicate choices. It
derives the immutable archive descriptor and all twelve teams' initial workload
summaries. Original content remains separate from drafts and Saved overlays.

The API retains the exact uploaded ZIP and verifies its size and SHA-256 by
streaming. It does not parse a multilingual catalog for this publication path.
Browser-derived source facts are trusted under the existing ZIP source-authority
decision, with immutable fingerprints and conflicting-fact rejection.

Preparation freezes each assigned team's matching predecessor Saved work and
existing recovery alternatives. Ended teams use their immutable ending-collection
cutoff. The API pages these records at at most 100 per response, also bounded by
bytes. The browser compares them against the incoming source and sends bounded
`carry`, `drop`, `baseline` or `remove` disposition parts. Every frozen record
requires exactly one disposition. SQL stores compact affected hashes/counts,
server-owned authored targets and lifecycle data, never a full source catalog.

The API obtains carried/dropped targets from its frozen records, not client
replacement targets. It checks completeness, original hashes, source identity,
team/candidate revisions, ancestry and membership before atomic group acceptance.
Prepared chunks are not active work. Snapshot/chunk/finalize requests retain
stable IDs and exact journaled bodies across uncertain responses and restart.
Legacy prepared uploads retain their original protocol and retry bodies.

New publications do not automatically create Dropped copies of untouched older
ZIP translations. Those are recalled explicitly. Existing Saved work, recovery
generations and archives, history, receipts and collections remain intact. Local
**Import Next Version** and legacy publication retain their current behavior.

## Recall and diff viewer

Choose **Recall translation…** in a full or inline SD editor. Prior references
are restricted to the same game, branch, logical group and assigned language,
with exact version/group/baseline bindings. Recall prefers an exact frozen
recovery, then historical accepted Saved text, then the complete original ZIP
translation. Multiple matching recovery copies require an explicit selection.
The browser verifies the original/cache and extracts only the requested file
through the existing source worker; the API does not parse it for this viewer.

The English pane highlights additions/removals, with **Show whitespace** and
**Character differences** options. The recalled translation has its own review
buffer. Viewing or editing it does not replace the normal draft or create Saved
work. Confirm unchanged entries with **Keep unchanged**, or correct them, then
choose **Save reviewed translation**. Every current entry must be complete.
The ordinary durable Save/history/receipt path commits the reviewed file. A
separate normal draft retains its existing revision/base guards. Only an exact
selected recovery can resolve through that Save; unrelated copies remain intact.

Different entry counts require manual alignment into every current entry while
the complete old target stays visible. Missing old source never substitutes
current English or discards authored targets. ZIP-only recall requires the exact
original/cache. If historical Saved work cannot be checked but a verified ZIP is
cached, the viewer labels that limitation instead of claiming the original is
the latest authored target.

## Checks and rollout

Run `scripts/test-sd-client-publication.cjs`, `scripts/test-sd-recall.cjs`,
`scripts/test-clienttext-ui.cjs`, and `scripts/test-clienttext-store.cjs` with Node.
The real-browser check is `node scripts/sd-client-publication-browser-fixture.cjs`.
It uses disposable normal-mode IndexedDB, workers, local authenticated API
sessions and synthetic originals to check publication without server parsing,
preserved Saved/recovery/history, full/inline recall and diff, reviewed Save,
normal drafts, and all four themes in a resized desktop window.

`FIXTURE_BROWSER_PATH`, `PLAYWRIGHT_MODULE_PATH`, `FIXTURE_VUE_PATH`, and
`FIXTURE_DIFF_PATH` can select installed fixture dependencies. Intermediates and
retained screenshots belong under `temp/`. Run API `npm run check` and `npm test`
before release; its protocol tests include frozen cutoffs, conflicts, coverage,
target authority, restart/retry and backup payload references. Local checks do
not establish hosted authentication, deployment or production restore readiness.
