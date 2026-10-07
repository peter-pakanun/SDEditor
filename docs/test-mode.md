# Test Mode (Automation / AI)

SDEditor normally starts with an empty table and requires you to use the 📦 **Import** button to load `StatDescriptions.zip`.

For debugging and automation (including AI-driven testing), the app supports a `testMode` that skips the import requirement and loads built-in dummy data instead.

## Validation Scope

UI validation targets desktop and laptop browsers, including resized desktop windows, keyboard navigation, and mouse/trackpad interactions. Mobile phone and tablet layouts and touch-only workflows are unsupported and do not require validation. See [Platform Support](../README.md#platform-support).

## Usage

- Enable test mode:
  - `?testMode=1`
- Select language (must match one of the in-app languages):
  - `&lang=Thai`

Example:

`http://127.0.0.1:3333/?testMode=1&lang=Thai`

## Behavior

- Loads a small built-in dummy dataset (no ZIP required).
- Bypasses normal IndexedDB startup and keeps dummy workspace edits in memory. It cannot validate durable saves, storage upgrades, or recovery after reloading.
- Disables Google login, cloud synchronization, and shared comments. For persistence and collaboration checks, use normal mode without `testMode=1` on a disposable browser origin or profile; see [Cloud Backup and Shared Dictionaries](cloud_backup.md#local-validation).
- Skips the launch version selector and uses PoE1 for the browser title/test state.

## Local server notes

When running locally, [server.js](../server.js) auto-opens a browser by default.

Disable auto-open for automation runs with:

- `node server.js --no-open`

Enable request logging without opening a browser with `node server.js --no-open --log-requests`.

## Large Dictionary Opening Fixture

Run `node scripts/editor-opening-browser-fixture.cjs` and open the loopback URL it prints. This uses test mode without storage or cloud synchronization. Click **Load 20,000 dictionary entries**, then open a dummy file by mouse or Enter. The fixture reports text-visible and ready times, retained input nodes, the largest field position/size change, and rendered dictionary rows. Matching entries are deliberately placed at the end of the dictionary; confirm they appear first, search can find the last unrelated entry, and paging keeps the list at 40 rows.

Use **Hold preparation for layout check**, then open a file. Source/translation text and preview should already be visible, fields read-only, Save and Apply regex disabled, and highlight layers absent. **Finish preparation** adds highlights and enables editing without replacing or moving the fields. Also test **Close** and **Escape** during the hold: the file must stay closed with no partial draft. The fixture is separate from the normal server and is intended for local comparisons, not production timing guarantees.

## Large Workspace Search Fixture

Run `node scripts/workspace-search-browser-fixture.cjs` and open its loopback URL. Click **Load 20,000 files**, then **Run search benchmark** to measure prepared local searches. **Simulate fast typing** sends four input events 45 ms apart and reports the number of searches and the longest synchronous input event. It should apply one search after typing stops. The fixture has Thai/German and all four theme controls; also check Clear, Escape, Enter, and arrow navigation from the main search field.

Use `--baseline <path-to-old-index.js>` to compare with an earlier implementation. The fixture keeps its immutable source separate from staged translations and bypasses storage/cloud. Timings describe this synthetic local workspace, not production performance.

## Shared Comments Fixture

Run `node scripts/comments-browser-fixture.cjs` after installing dependencies in the sibling `SDEditor-API` checkout. Open either editor URL printed by the script and click its **Bootstrap Thai** or **Bootstrap German** button. These are separate loopback origins with normal IndexedDB storage and an in-memory API, using disposable accounts rather than Google sign-in. Do not add `testMode=1` to their URLs.

The fixture loads 25 files, different source hashes for its Thai/German browsers, and comments from Thai, German and Japanese teams. PoE1 has 60 comments, initially 40 unread for Thai; PoE2 has a separate comment on the same path. `fixture/stat_01.txt` has enough comments to test pagination and unread cards below the visible area. One comment belongs to a file absent from the current source, and another contains literal markup for rendering checks.

Use the normal **Comments** tab beside **History** and **Show all comments** before pagination. Check numbered badges before opening either panel, scroll to confirm that only visible cards become read, load older comments, post in both browsers, and inspect the yellow version information icons and team language labels. Seeded comments are global and show **All languages**. Verify that **Post to all languages** starts unchecked in both composers: a default Thai post should appear only for Thai, while a checked post appears in both browsers. Hovering over a version icon shows the **Different version** explanation and full source hash. **Add German comment** creates a global remote comment through the real API; **Add German-only comment** creates one visible and counted only for German. Let the 20-second refresh discover it or leave and return to the browser tab. There is no manual **Refresh** button. **Switch game**, **Switch theme**, and **Simulate offline** exercise game isolation, both themes, and failed-request draft retention. Fixture controls can be hidden for screenshots.

In **Show all comments**, verify that each file has one card, cards follow latest activity, and comments inside each card run oldest to newest. Send from the single-line **Reply...** box using both Enter and the send icon. The reply should appear just above its input, move the card to the top, and preserve keyboard focus. Drafts and send errors must remain separate between files and from the editor's full comment composer. Check failed sends and retry with **Simulate offline**, and confirm that the compact reply row is absent from the file editor.

During repeated automatic refreshes, confirm that cards, scroll position, focus, and settled empty states stay stable, with no loading messages, syncing notices, or success timestamps. Check that connectivity returning and the tab becoming visible refresh comments automatically. A request failure must remain visible through retries until the relevant operation succeeds; an unrelated successful request must not dismiss it. Healthy collaboration must not add a footer/editor status message or **Retry sync** button, and Settings must offer **Sync now** only for an actual sync warning or error. Unread badges and presence remain visible, and explicit save, post, import/export, diagnostics, and history actions may still show progress.

Ports default to 34211, 34212 and 34213; change `FIXTURE_A_PORT`, `FIXTURE_B_PORT`, and `FIXTURE_API_PORT` for fresh browser storage. All fixture routes and injected controls are confined to this script. Its API data is discarded on exit, and its local checks do not establish live Google authentication or production deployment.
