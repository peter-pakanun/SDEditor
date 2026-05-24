# SDEditor — Agent Guide

Verified facts for working in this repo after the Nuxt migration.

## Project

- **PoE StatDescriptions.zip translation editor** migrated to **Nuxt 3 + Vue 3 + TypeScript + Pinia**.
- The app is client-side rendered (`ssr: false`) because ZIP parsing, file downloads, and IndexedDB are browser-only workflows.
- Legacy Express is no longer the application server. Nuxt/Nitro serves development and production builds.

## Commands

| Command | Purpose |
|---|---|
| `npm install` | Install Nuxt/Vue/testing dependencies |
| `npm run dev -- --host 127.0.0.1 --port 3333` | Start Nuxt dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run test:unit` | Run Vitest unit tests |
| `npm run test:e2e` | Run Playwright end-to-end tests |
| `npm test` | Run unit and e2e tests |

Environment variables are documented in `.env.example`:

- `NUXT_PUBLIC_APP_NAME`
- `NUXT_PUBLIC_LOG_LEVEL`
- `NUXT_PUBLIC_MONITORING_ENDPOINT`
- `NITRO_PRESET`

## Structure

- `app.vue` — Nuxt app shell
- `pages/index.vue` — main editor route
- `pages/version/[gameVersion].vue` — dynamic route for `poe1` / `poe2`
- `components/editor/` — client-only editor host, migrated editor app, extracted editor UI components, and remaining Options API shell
- `stores/editor.ts` — Pinia state extracted from old `data()`
- `utils/` — parser, ZIP helpers, regex engine, diagnostics, IndexedDB adapter, constants, logging
- `plugins/monitoring.client.ts` — client error logging/monitoring hook
- `tests/unit/` — Vitest tests
- `tests/e2e/` — Playwright tests
- `docs/migration_nuxt.md` — migration and deployment notes

## Key Source Files

- `utils/statDescParser.ts` — StatDescription parser and UTF-16LE BOM encoder
- `utils/regexEngine.ts` — regex/dictionary matching engine
- `utils/translationDiagnostics.ts` — translation warning/error scanner
- `utils/offlineStore.ts` — IndexedDB persistence (DB `sdeditor`, stores `kv` + revisions)
- `utils/helper.ts` — shared ZIP/local-desc helpers
- `utils/dummyFiles.ts` — test-mode data
- `stores/editor.ts` — editor state managed by Pinia

## Testing

- Test mode remains available at `http://127.0.0.1:3333/?testMode=1&lang=Thai`.
- Unit tests use Vitest + happy-dom.
- E2E tests use Playwright and start the Nuxt dev server automatically.

## Conventions

- Keep browser-only logic behind client-only components/plugins or `import.meta.client` guards.
- Prefer extracting new behavior into `components/`, `stores/`, `composables/`, or `utils/` instead of growing `components/editor/sdeEditorOptions.ts`.
- Do not reintroduce CDN script dependencies, Express-only serving, bundler alternatives, or global browser modules.
- Preserve UTF-16LE with BOM behavior for StatDescription export.
- Git commit style: conventional prefixes (`feat:`, `fix:`, `style:`, `refactor:`, `docs:`).

## Docs

- `docs/migration_nuxt.md` — Nuxt migration, environment, and deployment
- `docs/editor_guide.md` — editor UI walkthrough
- `docs/import_workflow.md` — import/export workflow
- `docs/regex_guide.md` — regex pattern reference
- `docs/test-mode.md` — test mode details
- `TODO.md` — developer TODO list
