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
- Shared dictionaries per language, with local/remote conflict choices; Translators use their assignment, while Managers/Admins use the selected language
- Shared translation workspaces for the same game, accepted source baseline and language, with live presence, offline saves and audited history
- Preserve and synchronize Dropped translation copies separately for review and recovery
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
  - Click 💾 to export **Saved** files for the selected language, including unchanged or intentionally blank saves retained across sessions
  - Ctrl+Click 💾 to export the current ZIP/staged translations; an incomplete ZIP translation with an unresolved Dropped copy is omitted unless you saved a staged translation
  - Dropped snapshots and unsaved typing are never exported directly
- Import:
  - After the table loads, click 📦 to import a ZIP file
  - You can import a previously exported `StatDescriptions_Translated.zip` to restore your edits
- Translator workflow guide: see [docs/editor_guide.md](docs/editor_guide.md).
- PoE1/PoE2 storage and migration details: see [docs/multi_version.md](docs/multi_version.md).
- Workspace labels, counts and export scope: see [docs/workspace_statuses.md](docs/workspace_statuses.md).
- Google sign-in, language assignment, shared dictionaries, translation collaboration and recovery: see [docs/cloud_backup.md](docs/cloud_backup.md). Managers and Admins can access every supported language without an assignment; Translators synchronize their assigned language. Personal settings and Regex rules remain per account.
- **Versions** offers manager-published Online versions and the existing Offline import workflow with local names. Managers upload one original ZIP for all 12 teams, review validation, set an informational deadline and collect immutable Saved-only translated ZIPs per team. Ended windows warn before editing. Each game initially uses one `default` branch and one HEAD; selecting retained versions preserves their source/work/history.
- Standalone shared rooms keep their complete parsed baseline in the browser and share a ZIP/import descriptor, affected-language originals, saved translations and authenticated history. Manager publication explicitly stores the original ZIP and complete parsed baseline on the separately deployed API. First sparse saves supply a baseline witness/proof. Dropped snapshots synchronize separately with old source text, metadata and version assignment provenance. Existing local history stays local. Deploy API schema v13 and reference-aware restore before the IndexedDB v8 frontend. Operational backups exclude ZIP files; retain API artifacts separately.
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
