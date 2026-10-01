# SDEditor

Desktop-first browser-based editor for `StatDescriptions.zip` (stat description translation files).

## Platform Support

SDEditor supports desktop and laptop browsers with a keyboard and mouse or trackpad. As of October 1, 2026, mobile phone and tablet support is discontinued.

Future UI design, bug fixes, and validation target desktop workflows, including resized desktop windows. Mobile layouts, touch-only workflows, and desktop/mobile feature parity are outside the supported scope.

## Features

- Load `StatDescriptions.zip` via the import button
- Filter/search and paginate entries
- Edit translations with dictionary + regex helpers
- Separate PoE1 and PoE2 source/workspace/history storage
- Highlights and metadata to help catch mismatches (lines / `{}` variables / `[]` tags)
- Saves your in-progress work to `indexedDB`
- Optional Google account backup for personal settings and Regex rules
- Shared dictionaries per assigned language, with local/remote conflict choices
- Export a translated ZIP (`StatDescriptions_Translated.zip`)

## Quick Start (Local)

Prerequisites: Node.js (for the local web server) and a modern desktop browser.

```bash
npm install
node server.js
```

Then open the printed URL (defaults to `http://127.0.0.1:3333/`), choose PoE1 or PoE2, select your language, and use the 📦 **Import** button to load `StatDescriptions.zip`.

## Usage Notes

- Export:
  - Click 💾 to export files you changed in this session
  - Ctrl+Click 💾 to do a full export
- Import:
  - After the table loads, click 📦 to import a ZIP file
  - You can import a previously exported `StatDescriptions_Translated.zip` to restore your edits
- Translator workflow guide: see [docs/workflow.md](docs/workflow.md).
- PoE1/PoE2 storage and migration details: see [docs/multi_version.md](docs/multi_version.md).
- Google sign-in, language assignment, shared dictionaries and recovery: see [docs/cloud_backup.md](docs/cloud_backup.md). Translation files and history remain local; cloud backup requires the separately deployed SDEditor API.
- Public privacy policy: [https://sdeditor.pages.dev/policy](https://sdeditor.pages.dev/policy). The standalone `public/policy.html` page needs no login or JavaScript; Cloudflare Pages serves it at `/policy`, and the local server supports the same URL. After deploying, use that URL in Google Auth Platform's Branding privacy-policy field. Keep the policy, contact address, and update date aligned with the service's actual practices.

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
