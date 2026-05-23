# SDEditor — Agent Guide

Minimal, verified facts for working in this repo.

## Project

- **PoE StatDescriptions.zip translation editor** — vanilla JS SPA, Vue 3 loaded via CDN, Express dev server.
- Single monolithic Vue 3 Options API component in `public/index.js` (~3000 lines). No build step, no bundler, no router.

## Commands

| Command | Purpose |
|---|---|
| `node server.js` | Start dev server on `http://127.0.0.1:3333` |
| `node server.js --no-open` | Skip browser auto-open |
| `node server.js --log-requests` | Enable request logging |

Env vars: `PORT` (3333), `HOST` (127.0.0.1), `NO_OPEN_BROWSER`, `LOG_REQUESTS`, `CI`, `SDEDITOR_NO_OPEN`.

`npm test` is a stub (exits 1). There are no tests, no linter, no formatter, no type checker.

## Key source files (all in `public/`)

- `index.html` — entrypoint, loads Vue 3 / JSZip / jsdiff from CDN
- `index.js` — entire app component
- `statDescParser.js` — ZIP parser (UTF-16LE with BOM)
- `regexEngine.js` — regex / dictionary matching engine
- `translationDiagnostics.js` — translation warning/error scanner used by editor highlights and save guards
- `offlineStore.js` — IndexedDB persistence (DB `sdeditor`, stores `kv` + `revisions`)
- `helper.js` — utility functions
- `dummyFiles.js` — test data (3 files, 10 languages)
- `FileSaver.js` — client-side file download (not in package.json)

## Testing

- No test framework. Manual testing via `?testMode=1` URL param (e.g. `http://127.0.0.1:3333/?testMode=1&lang=Thai`).
- Test mode loads `dummyFiles.js` and bypasses IndexedDB entirely.
- Combine `--no-open` with test mode for automated runs.

## Toolchain quirks

- **CDN deps not in package.json:** Vue 3, JSZip, jsdiff loaded from CDN in `index.html`.
- **npm packages** (`express`, `opn`) are only for the dev server.
- **TypeScript is installed** (`tsconfig.json`, `checkJs: false`, `noEmit: true`) — purely for IDE intellisense via `types/vue-global.d.ts`, does not compile or check JS.
- **UTF-16LE with BOM** — StatDescription files use this encoding; parser reads via `FileReader.readAsText(blob, 'utf-16le')` and encodes manually with `Uint16Array`.

## Conventions

- No automated code quality tooling. Edit JS directly.
- Git commit style: conventional prefixes (`feat:`, `fix:`, `style:`, `refactor:`, `docs:`).
- Two CSS themes via `[data-theme]` on `<html>`: `grey` and `dark`. UI density via `--density` custom property.

## Docs

- `/docs/editor_guide.md` — full editor UI walkthrough
- `/docs/import_workflow.md` — import/export workflow
- `/docs/regex_guide.md` — regex pattern reference
- `/docs/test-mode.md` — test mode details
- `/TODO.md` — developer TODO list

## What NOT to do

- Do not introduce build steps, bundlers, or frameworks not already present.
- Do not add test frameworks unless explicitly asked — there is no test infrastructure.
- Do not expect TypeScript to catch errors — `checkJs: false`.
