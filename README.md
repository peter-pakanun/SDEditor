# SDEditor

Browser-based editor for `StatDescriptions.zip` (stat description translation files).

## Features

- Load `StatDescriptions.zip` via the import button
- Filter/search and paginate entries
- Edit translations with dictionary + regex helpers
- Separate PoE1 and PoE2 source/workspace/history storage
- Highlights and metadata to help catch mismatches (lines / `{}` variables / `[]` tags)
- Saves your in-progress work to `indexedDB`
- Export a translated ZIP (`StatDescriptions_Translated.zip`)

## Quick Start (Local)

Prerequisites: Node.js and a modern browser.

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 3333
```

Then open the printed URL (defaults to `http://127.0.0.1:3333/`), choose PoE1 or PoE2, select your language, and use the 📦 **Import** button to load `StatDescriptions.zip`.

## Usage Notes

- Export:
  - Click 💾 to export files you changed in this session
  - Ctrl+Click 💾 to do a full export
- Import:
  - After the table loads, click 📦 to import a ZIP file
  - You can import a previously exported `StatDescriptions_Translated.zip` to restore your edits
- Import/export workflow guide: see [docs/import_workflow.md](docs/import_workflow.md).
- PoE1/PoE2 storage and migration details: see [docs/multi_version.md](docs/multi_version.md).

## Debug / Test Mode

For automation-friendly startup (no ZIP required) and URL parameters like `testMode=1` and `lang=Thai`, see [docs/test-mode.md](docs/test-mode.md).

## Build And Test

- `npm run build` creates a production Nuxt/Nitro build.
- `npm run preview` serves the production build locally.
- `npm run test:unit` runs Vitest unit tests.
- `npm run test:e2e` runs Playwright browser tests.
- Deployment notes are in [docs/migration_nuxt.md](docs/migration_nuxt.md).

## License

MIT (see [LICENSE.md](LICENSE.md))
