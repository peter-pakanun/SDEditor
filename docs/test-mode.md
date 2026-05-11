# Test Mode (Automation / AI)

SDEditor normally starts by asking you to drag & drop `StatDescriptions.zip` into the browser.

For debugging and automation (including AI-driven testing), the app supports a `testMode` that skips file drag & drop and loads built-in dummy data instead.

## Usage

- Enable test mode:
  - `?testMode=1`
- Select language (must match one of the in-app languages):
  - `&lang=Thai`

Example:

`http://127.0.0.1:3333/?testMode=1&lang=Thai`

## Behavior

- Loads a small built-in dummy dataset (no ZIP required).
- Does not read or write `localStorage`, so your real saved settings/local changes won’t be modified.

## Local server notes

When running locally, [server.js](file:///d:/WorkDir/SDEditor/server.js) auto-opens a browser by default.

Disable auto-open for automation runs with:

- `node server.js --no-open`
- or `NO_OPEN_BROWSER=1 node server.js`
