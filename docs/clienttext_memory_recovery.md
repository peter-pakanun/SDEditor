# Recovering values from a still-open temporary ClientText session

This guide applies to older tabs running the memory-only release. New **Local workbooks** use [durable local recovery](clienttext_local_workbooks.md). A refreshed or closed old memory tab cannot be recovered from IndexedDB; it never wrote the workbook there.

Keep the affected tab open. Do not reload, close it, change workbooks or accounts, or clear browser storage. Dictionary/TM synchronization does not persist the temporary workbook's edits. A deployed code fix cannot replace the code already running in that tab.

The reviewed [local recovery script](../scripts/clienttext-memory-recovery-console.js) reads the active temporary session's committed values, all stored drafts and the active unsaved field values. It downloads `SDEditor-ClientText-memory-recovery.json` locally. It does not call the API, start a workbook worker, change saved/draft values, write browser storage, or switch or reload the workbook. The snapshot contains translation text; keep it local unless deliberately sharing it for recovery.

After the failed export has finished, close only its export dialog and stop editing. Open the browser developer tools Console in that same tab, review the script and run its complete contents once. Its result reports counts and bytes without printing translation values. Check that the JSON file exists in the browser's downloads and has nonzero size. Keep the original workbook files and this tab open.

This is an edit-data recovery snapshot, not an XLSX export or a built-in import format. Restoration needs the matching original workbook(s) and parser descriptors. Committed values and draft values remain separate; active unsaved values take precedence only as a draft. Do not declare the session recoverable solely because a download was initiated; retain the tab until the downloaded file is verified and reconstruction succeeds.

## Export with reselected matching originals

The error `A requested file or directory could not be found at the time an operation was processed.` can occur when the session retains a disk-backed browser `File` and its selected source becomes unavailable. Moving a generated original after preparation reproduces this exact message and the four-row timing report. Parsed records and authored values remain in memory, but the original package is needed to reconstruct the workbook. Diagnostics does not need to reread that package.

After verifying the JSON download, the reviewed [matching-original recovery export](../scripts/clienttext-memory-reexport-console.js) can run in the same still-open tab. It prompts for all original workbooks in the group. Select the exact unchanged originals at their current locations; another version or an exported/edited workbook is rejected by complete SHA-256 identity. It reads retained record metadata and committed values, then uses a dedicated worker to generate a workbook or paired ZIP. It does not replace any app/store methods, reset the workspace, write values, call the API or reread the inaccessible old File. Unsaved drafts remain excluded from the workbook and retained separately in the JSON snapshot. Keep editing paused while it runs.

Check the downloaded workbook(s) for a known committed edit and preserve the JSON for any unsaved text. Keep the tab open until both have been verified. If matching originals cannot be obtained, retain the JSON and the open tab for reconstruction; do not substitute a different original.

Validation covers disposable browser memory sessions held across frontend `15a39e8`/`486a57c` and worker assets from `356c47f`. Moving only generated originals reproduces `NotFoundError` and the reported message. JSON recovery and exact-original reselection then recover the committed edit into both workbooks while preserving saved values, drafts, diagnostics and history; changed originals are rejected before worker export. A separate test restores exact authored strings (actual newlines, literal `\\n`, whitespace and Unicode), stored drafts and active unsaved text into an independent memory session against matching descriptors. This reproduces the failure mechanism without establishing what made the reporter's particular file inaccessible or inspecting their live session.

New preparations snapshot the already-read, verified bytes into an owned Blob rather than retaining the selected disk-backed File. This prevents later source-path changes from breaking exports in newly opened sessions. It does not retrofit an already-open older session.
