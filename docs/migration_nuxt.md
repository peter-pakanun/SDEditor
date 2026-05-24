# Nuxt Migration

SDEditor has been migrated from a static Vue CDN prototype served by Express to a Nuxt 3 application with TypeScript, Pinia, Vite, Vitest, and Playwright.

## Structure

- `pages/` contains routable Nuxt pages. `/` opens the editor and `/version/:gameVersion` can preselect `poe1` or `poe2`.
- `components/editor/` contains the client-only editor host and the migrated editor component.
- `legacy/` keeps the compatibility template and Options API shell while the large editor surface is split further over time.
- `stores/` contains Pinia state. The former top-level `data()` object now lives in `stores/editor.ts`.
- `utils/` contains the parser, ZIP helpers, regex engine, diagnostics, IndexedDB adapter, runtime constants, and logging utilities as ES modules.
- `plugins/monitoring.client.ts` captures Vue, browser, and unhandled promise errors and optionally posts them to `NUXT_PUBLIC_MONITORING_ENDPOINT`.
- `tests/unit/` covers reusable parser/diagnostic/regex behavior with Vitest.
- `tests/e2e/` covers browser workflows with Playwright.

## Development

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 3333
```

Test mode still works:

```
http://127.0.0.1:3333/?testMode=1&lang=Thai
```

## Verification

```bash
npm run test:unit
npm run test:e2e
npm run build
npm run preview
```

## Environment

Copy `.env.example` and set:

- `NUXT_PUBLIC_LOG_LEVEL`: `debug`, `info`, `warn`, `error`, or `silent`.
- `NUXT_PUBLIC_MONITORING_ENDPOINT`: optional POST/beacon endpoint for client errors.
- `NITRO_PRESET`: Nuxt/Nitro deployment preset. The default is `node-server`.

## Deployment

Node deployment:

```bash
npm ci
npm run build
node .output/server/index.mjs
```

Docker deployment:

```bash
docker build -t sdeditor .
docker run --rm -p 3000:3000 sdeditor
```

## Migration Notes

The first migration keeps the existing editor behavior intact by preserving the proven template and methods, while moving state, dependencies, and reusable logic into Nuxt-managed modules. Future refactors can continue extracting focused components from `legacy/sdeEditorTemplate.html` without changing parser/storage behavior.
