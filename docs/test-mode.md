# Test Mode (Automation / AI)

SDEditor normally starts with an empty table and requires you to use the 📦 **Import** button to load `StatDescriptions.zip`.

For debugging and automation (including AI-driven testing), the app supports a `testMode` that skips the import requirement and loads built-in dummy data instead.

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
- Skips the launch version selector and uses PoE1 for the browser title/test state.

## Local server notes

When running locally, [server.js](file:///d:/WorkDir/SDEditor/server.js) auto-opens a browser by default.

Disable auto-open for automation runs with:

- `node server.js --no-open`
- or `NO_OPEN_BROWSER=1 node server.js`
