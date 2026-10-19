# MTL extra-context lookup contract

New requests negotiate `clienttext-mtl-lookup-v1` through API capabilities.
Older APIs and existing request bodies retain the original translation-only
path; retries never add lookup, settings or context to an already admitted ID.
The bounded prompt variant is `clienttext-mtl-v8-lookup-v1`, preserving v7's
speaker/listener style limits and protected-token rules.

The existing asynchronous admission POST and authenticated status polling carry
one-use lookup challenges. Replies go to
`POST /v1/mtl/requests/:requestId/context-replies`. The collaboration WebSocket
does not authorize tools. Queries contain exactly `kind` (`keyword` or `record`),
`recordId` and `sheet`. Keyword queries require the exact KeywordPopups sheet or
its Gender variant. All queries are read-only equality matches over loaded
records in the selected workbook role. There is no broad search, regular
expression, external web request, shell, arbitrary tool or browser provider
credential. Workbook parsing stays entirely in the client.

The original account, team, language, source, field, workbook role, asset/parser,
game/branch and snapshot bind every challenge and reply. The server rechecks
permissions and the original authenticated session and rejects replay, stale,
out-of-order or mismatched responses. Lookup uses all loaded records regardless
of the editor filter. Source objects are immutable and approved Saved values
are detached at admission. Drafts, MTL overlays, provisional text and invalid,
unreviewed or conflicted translations do not become approved context. Exact
dialogue rows can be returned without inferring a participant. Missing optional
sheets/records are explicit unavailable results.

| Budget | Hard maximum |
| --- | --- |
| Extra lookup rounds | 2, with 2 exact queries each |
| Provider calls | 1 with no lookup; 2 with one round; 3 with two rounds; last call must translate |
| Results per round | 4 records, 2 fields each; source/approved target each at most 2,048 UTF-16 code units |
| Extra context | 8,192 UTF-8 JSON bytes per round; 16,384 bytes and 8,000 string/key UTF-16 code units total |
| Original + extra context | 57,344 UTF-8 JSON bytes and 24,000 string/key UTF-16 code units |
| Serialized requests | 65,536 UTF-8 JSON bytes reserved per call; 196,608 total before credentials/transport; these are bytes, not tokens |
| Observable output text | 131,072 UTF-8 bytes per call / 262,144 total; per-call assembled assistant JSON/text high-water marks, without counting repeated delta/done/final snapshots twice |
| Received SSE data | Abort after crossing 1,048,576 bytes per call / 3,145,728 total; count every delivered chunk, including the crossing chunk |
| Provider/hidden reasoning tokens | Unmeasured and not hard-capped by the app. SIWC does not support `max_output_tokens`; no provider token-spending guarantee is made |
| Deadline | Original job deadline, at most 180 seconds including all waits/calls |
| Challenge wait / browser lease | 15 seconds each; status polls from the original session renew the lease |

The provider HTTP envelope contains only `model`, `reasoning` (effort),
`instructions`, `input`, `store:false`, `stream:true` and `text` structured-output
settings. The official [SIWC preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
reject `max_output_tokens` and HTTP `previous_response_id`; neither is sent.

Every provider attempt reserves one durable provider round, including failed
attempts. All rounds share the existing one-request quota charge and
concurrency slot. Debug budget version `mtl-local-byte-budget-v1` reports
`callReservations`, `requestBytesReserved`, `receivedStreamBytes` and
`outputTextBytes`. The last metric sums per-call high-water marks of visible
assistant output text, including its JSON framing. It does not count reasoning
or estimate model tokens. `providerTokenCapEnforced:false`,
`providerTokens:null` and `reasoningTokens:null` state that limitation. An
observation can itself cross the byte threshold and is counted before local
abort; cancellation of upstream computation is best effort. Historical receipts
remain unchanged.
Context limits never widen automatically; oversized fields
and records are omitted whole and marked truncated. There are no automatic
provider retries or new inference IDs. A lost reply acknowledgement is checked
by polling the same request, without resubmitting a model request.

Workbook replacement, account/language/assignment changes, logout, offline and
page exit stop the browser attempt, requesting cancellation when possible.
The server lease handles a lost tab/network. Native drafts remain unchanged;
completion races retain explicit Review. A completed request can be recovered
without inference; a running lookup cannot reconstruct a lost original snapshot
after reload and is cancelled. A new translation requires an explicit action.

Admin Download all includes sanitized lookup rounds, results, executed calls,
wait timestamps/durations, byte accounting and provider-token limitations in `request.json`. The normal
context section remains the frozen initial packet. An explicit consented
dismissal retains the same evidence in the private server archive. Credentials,
transport headers, provider errors and chain of thought are excluded. Lookup
content is not ordinary Saved work, history, TM or export content.

Deploy the compatible API first, then the frontend; reload existing tabs without
clearing storage. Validate with synthetic records and a mock provider:

1. Local/shared zero-, one- and two-round paths; a filtered-out requested row;
   missing sheets, unavailable data, oversized/multibyte values and exhaustion.
2. Skeleton/stream, retrieval tooltip, Stop via mouse/keyboard, four themes and
   reduced motion. Check the ordinary draft remains unchanged.
3. Workbook replacement, language/account/assignment change, logout, offline and
   tab close during retrieval; verify cancellation/lease failure, released
   concurrency and rejected late replies.
4. Admin diagnostics ZIP and explicit dismissal archive, permission boundaries,
   injection/protected-token rejection and historical exact retries. Do not use
   real provider inference, production credentials or private workbook fixtures.

Run `node --test scripts/test-clienttext-mtl-lookup.cjs
scripts/test-clienttext-mtl-ui.cjs` and the normal related MTL regressions. The
public wire module and private API vendor copy must stay byte-identical; the
copy check skips when the sibling API is absent. The API documents its matching
contract in `docs/mtl-context-lookup.md`.

Selected KeywordPopups/KeywordPopups_Gender Info Title gets a bounded same-row
title/Info Content projection in the initial packet, including a valid scoped
Saved/original target title. Only the exact loaded selected row is used, with
at most two fields and whole-record/translation omissions under existing
context limits. Drafts, provisional MTL, stale/conflicted targets and other
roles never supply title translations. Missing definitions are not inferred.
Prompt v8 clarifies display title versus immutable recordId, retains v7 style
and injection rules, and keeps lookup discretionary. Existing v7 and
v7-lookup-v1 retries retain their original body, prompt, settings and result
without new inference. Deploy the compatible API first, then reload frontend;
inspect a synthetic bare-title request's first context and one-call fast path.
