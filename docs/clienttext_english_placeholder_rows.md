# Use English cue inside status-colored rows

Follow-up to `a367e8da7172befbffd6e736d26d1c4de333e5cd`. The reported dark-theme BaseItemTypes layout was reproduced with three synthetic records at workbook rows 3–5. Each record started with a complete English-identical target; real Eng actions cleared the target and created a saved Revised record through the local workbook worker/store.

The cue's opacity was already correct. Two inherited properties made it prominent:

- `client-text.css` sets `--ui-muted:var(--ct-revised-ink)` on Revised rows. The cue used that row-local variable, so it became the same lavender as Revised metadata.
- `index.css` makes the translation cell of a `hasChanges` row bold. Native placeholders, whitespace-overlay spans and collapsed-list spans inherited that weight.

On the released CSS, dark inline/list cues computed to `rgb(221, 194, 244)`, weight `700`, opacity `0.65`. The full editor, outside the row, computed to neutral `rgb(185, 187, 190)`, weight `400`, opacity `0.65`. The focused inline input and inactive list rows reproduced the reported appearance. Fresh remote master and all eight inspected public runtime assets matched `a367e8d`; stale server assets are unnecessary to explain the issue. This does not establish what an already-open user tab had cached.

The product fix changes two CSS declarations: resolve a dedicated cue ink variable from `--ui-muted` at the document root, before row-level status overrides, and explicitly use regular weight for the cue. Theme changes still recompute the root ink. Dark inline/list cues now match the full editor's neutral color and regular weight. Existing opacity stays 85% in light/grey and 65% in dark/modern-dark. Revised row backgrounds, metadata, labels and emphasis on real translated text remain unchanged. The exact string, Eng actions, source preview, counters, history, persistence, export, schema and API behavior are unchanged.

## Regression coverage

Run `node scripts/clienttext-browser-fixture.cjs --english-row-style-only --keep` with installed project dependencies available through `NODE_PATH`. The normal-mode fixture uses current Vue/components and real local workbook/worker/IndexedDB saves, with generated data only. It checks:

- Three actual Revised rows and visible Missing 0 after approval.
- **368 rendered cases**: four themes × compact/spacious density × one full-editor case plus five row surfaces × nine status-class combinations. Surfaces are focused and unfocused inline placeholders, the whitespace overlay, selected collapsed rows and inactive collapsed rows. Status-class projections cover Revised, Saved, Unchanged, Missing, Outdated, Warning, Error, Revised+Warning and Revised+Error; these are explicit DOM cascade projections, not invented persisted statuses.
- Every candidate cue has the neutral theme ink, weight 400, original opacity and exact string. Revised metadata remains status-colored, and saved translation cells and real translated drafts remain bold. Real text hides the cue. Presentation projections do not change saved work.
- Revocation removes the cue and restores Missing; reapproval and actual XLSX download preserve blank targets and source text without persisting/exporting the placeholder.

Set `ENG_ROW_STYLE_PHASE=baseline` while using the released CSS to record its computed appearance without the candidate-style assertions. The recorded baseline has **264 color/weight mismatches** among 368 cases; the candidate has zero. Each report records color, weight, opacity, focus, row classes, metadata color and row background. Twenty screenshots per phase show all four themes and five row surfaces. Four candidate focused-inline screenshots were visually inspected across the supported themes.

The existing `--english-presentation-only --english-placeholder-style` fixture additionally covers normal/shared HTTP saves, reload, source-invalid/conflict/suspended decisions, English rendering, visible Missing/progress, durable/export safety and 32 contrast/theme/density cases. Those existing contrast measurements concern their original normal-row fixture; the new status-class matrix asserts the neutral cue color/weight and does not claim a new contrast threshold for every colored row.

Evidence paths are recorded in the independent-review package. No private workbook, live inference, API change, push or deployment is part of this follow-up.

The full frontend suite passed **3,797 tests**, with zero failures/skips/cancellations. The initial restricted-shell run blocked its localhost API connections (`connect EACCES 127.0.0.1`); the normal approved localhost test run then passed the entire suite. Both fixture scripts pass syntax checks and `git diff --check` passes.

## Screenshot access limit

The parent visually inspected the user's Library screenshot. This task successfully read its Library metadata/OCR (`libfile_a1c4016b495c81919adae5edf8477fe7`). The authorized materialization helper then failed on Windows with `AttributeError: module 'os' has no attribute 'setxattr'`, before installing the destination file. This is a helper/platform failure, not an approval denial. Materialization was stopped without bypass or retry. The synthetic reproduction and computed-style evidence independently establish the cause; the original user screenshot is not included in the review package.
