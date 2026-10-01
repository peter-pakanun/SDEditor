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
- Does not read or write `indexedDB`, so your real saved settings/local changes won’t be modified.
- Disables Google login, cloud synchronization, and shared comments. Use a separate normal browser profile for persistent storage and API tests; see [Cloud Backup and Shared Dictionaries](cloud_backup.md#local-validation).
- Skips the launch version selector and uses PoE1 for the browser title/test state.

## Local server notes

When running locally, [server.js](file:///d:/WorkDir/SDEditor/server.js) auto-opens a browser by default.

Disable auto-open for automation runs with:

- `node server.js --no-open`
- or `NO_OPEN_BROWSER=1 node server.js`

## Shared Comments Fixture

Run `node scripts/comments-browser-fixture.cjs` after installing dependencies in the sibling `SDEditor-API` checkout. Open either editor URL printed by the script and click its **Bootstrap Thai** or **Bootstrap German** button. These are separate loopback origins with normal IndexedDB storage and an in-memory API, using disposable accounts rather than Google sign-in. Do not add `testMode=1` to their URLs.

The fixture loads 25 files, different source hashes for its Thai/German browsers, and comments from Thai, German and Japanese teams. PoE1 has 60 comments, initially 40 unread for Thai; PoE2 has a separate comment on the same path. `fixture/stat_01.txt` has enough comments to test pagination and unread cards below the visible area. One comment belongs to a file absent from the current source, and another contains literal markup for rendering checks.

Use the normal **Comments** tab beside **History** and **Show all comments** before pagination. Check numbered badges before opening either panel, scroll to confirm that only visible cards become read, load older comments, post in both browsers, and inspect **Different hash** and team language labels. **Add German comment** creates a remote comment through the real API; allow the regular refresh to discover it or use **Refresh**. **Switch game**, **Switch theme**, and **Simulate offline** exercise game isolation, both themes, and failed-request draft retention. Fixture controls can be hidden for screenshots.

Ports default to 34211, 34212 and 34213; change `FIXTURE_A_PORT`, `FIXTURE_B_PORT`, and `FIXTURE_API_PORT` for fresh browser storage. All fixture routes and injected controls are confined to this script. Its API data is discarded on exit, and its local checks do not establish live Google authentication or production deployment.
