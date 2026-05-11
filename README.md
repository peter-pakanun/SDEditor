# SDEditor

## Debug / AI test mode

The app normally requires dropping `StatDescriptions.zip` into the browser to start.

For debugging (including AI-driven testing), you can start the app with URL params to skip drag & drop and load the built-in dummy data (`dummyFile`) instead:

- `?testMode=1&lang=Thai`

In `testMode`, the app does not read or write `localStorage`, so your real saved settings/local changes won’t be modified.

When running locally, `server.js` auto-opens a browser by default. To disable (for automated/AI runs), start it with `--no-open` or set `NO_OPEN_BROWSER=1`.
