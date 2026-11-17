# Explicit HEAD promotion

Implemented locally; this document does not establish hosted deployment.
Deploy API schema **33** before the frontend and reload older tabs. Keep the
normal pre-upgrade backup and required artifacts. No browser storage is cleared.

Fresh named versions negotiate `manual-v1` and send `promotion: 'manual'`.
Saving metadata creates a **Draft**. Publishing complete SD or ClientText groups
creates an **Awaiting promotion** candidate without moving HEAD, including the
first release. In **Manage version → Online**, choose **Promote** in the
candidate's Actions (inside the compact Actions menu in narrower windows).
Review the confirmation, then promote. Selecting or opening a candidate does
not promote it.

## Guards shared with SDE2

The API requires Manager/Admin access and exact game/branch, current HEAD,
candidate parent and membership revision. The candidate must have accepted
groups and assignments, remain published rather than Draft/Withdrawn, and never
have been promoted previously. Every outgoing HEAD assignment must be ended,
including teams or content modes absent from the candidate. Pending assignment
publications or collection preparation block promotion.

Each manual upload captures compact references to its latest matching promoted
ancestor assignments and their ending collections. Preparation, acceptance and
promotion recheck those references and team revisions. Reopening or replacing a
matching ending snapshot rejects the candidate with `CARRY_FORWARD_CHANGED`
(an open current HEAD is first rejected as `VERSION_TEAMS_UNFINISHED`). Prepare
a new candidate from final accepted work; the rejected candidate's authored
work, history and originals remain available. ClientText carry reads the frozen
ending snapshot, excluding later predecessor edits. Missing groups in intervening
releases are skipped through the promoted parent chain; unpromoted candidates
never become predecessors merely because they are newer.

SDE1 performs the guard checks, HEAD update, audit and idempotent receipt in one
synchronous SQLite write transaction. This provides the exclusion that SDE2
needs cross-object promotion fences for: Reopen, recollection, membership changes
and competing promotion cannot interleave with the decision. There is no
background promotion to recover after a crash. The browser persists the exact
account/game/branch command before sending it. **Resume promotion** reuses that
command after a lost response or reload; it never refreshes its guards silently.

Pending publications are discoverable under Online. **Resume publication**
continues their original request. **Cancel publication** cancels only unaccepted
uploads and retains originals and accepted work. A possibly accepted group must
be resumed to recover its acknowledgement. A Draft cannot be promoted; add and
publish complete assignments first.

## Existing versions and compatibility

The upgrade marks only versions in the actual existing HEAD ancestor chain as
previously promoted; names and dates never choose HEAD. An existing unpromoted
browser-prepared SD candidate can use its retained publication snapshot for the
same guarded promotion. Missing or stale evidence requires a newly prepared
candidate. Restoration changes visibility; it cannot replace an existing HEAD.
The historical empty-HEAD restoration path remains limited to a version already
known to have been promoted, preserving ended states.

Retained legacy publication requests keep their exact earlier bodies, receipts
and automatic-advancement behavior. New commands use explicit promotion; no
existing retry is rewritten to opt into it. Promotion changes no original,
translation, draft, recovery generation, collection or history entry.

## Verification

API `test/content-groups.test.js` covers promotion authorization, first release,
SD/CT membership, all outgoing teams, stale cutoffs and parents, competing
candidates, pending uploads, cancellation, receipt replay and compressed
backup/restart. Run the full API suite and `npm run check` before deployment.

Frontend `scripts/test-managed-versions.cjs` checks exact retries and account
changes. `scripts/sd-client-publication-browser-fixture.cjs` checks publication,
Draft/Awaiting promotion labels, cancelling and confirming promotion, keyboard
activation, a deliberately lost acknowledgement and its exact retry, all four
themes, and preservation of Saved/recovery/history and recall. It uses
disposable local data; it does not prove hosted rollout.
