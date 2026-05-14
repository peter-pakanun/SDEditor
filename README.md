# SDEditor

Browser-based editor for `StatDescriptions.zip` (stat description translation files).

## Features

- Load `StatDescriptions.zip` via the import button
- Filter/search and paginate entries
- Edit translations with dictionary + regex helpers
- Highlights and metadata to help catch mismatches (lines / `{}` variables / `[]` tags)
- Saves your in-progress work to `localStorage`
- Export a translated ZIP (`StatDescriptions_Translated.zip`)

## Quick Start (Local)

Prerequisites: Node.js (for the local web server) and a modern browser.

```bash
npm install
node server.js
```

Then open the printed URL (defaults to `http://127.0.0.1:3333/`), select your language, and use the 📦 **Import** button to load `StatDescriptions.zip`.

## Usage Notes

- Export:
  - Click 💾 to export files you changed in this session
  - Ctrl+Click 💾 to do a full export
- Import:
  - After the table loads, click 📦 to import a ZIP file
  - You can import a previously exported `StatDescriptions_Translated.zip` to restore your edits
- Translator workflow guide: see [docs/workflow.md](docs/workflow.md).

## Debug / Test Mode

For automation-friendly startup (no ZIP required) and URL parameters like `testMode=1` and `lang=Thai`, see [docs/test-mode.md](docs/test-mode.md).

## Server Options

- Disable auto-open browser:
  - `node server.js --no-open`
  - or `NO_OPEN_BROWSER=1 node server.js`
- Log requests:
  - `node server.js --log-requests`
  - or `LOG_REQUESTS=1 node server.js`

## License

MIT (see [LICENSE.md](LICENSE.md))
