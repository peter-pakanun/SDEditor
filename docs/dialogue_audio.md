# ClientText dialogue audio

ClientText records with an `Audio File` reference offer an icon bar immediately below the English field in the inline and full editors. Each speaking icon plays one track; hover or focus it for the filename. A disabled spinner indicates loading. The active icon uses the field toolbar's accent color and stops that track when clicked. A red icon indicates an error; its tooltip gives the available failure details, and clicking retries the track. Opening a record does not download audio.

The English preview also places playback icons at the end of the text. When `<continue>` separates dialogue blocks, each block gets one track in order, with any remaining tracks at the end of the last block. Empty blocks do not consume a track. The translation preview has no playback icons. The field and preview buttons share one audio player and the same loading, playing and error states; either button can stop playback or retry a failed track.

Native browser audio controls float at the bottom right only while a track is playing. In the file list they sit above the status bar; in the full editor they sit nearer the bottom edge. The controls use 70% opacity and become opaque on hover or keyboard focus. Pausing, stopping or finishing a track hides the controls. Playback also stops when the record, workspace or editor surface changes. Audio is reference material and does not change translations, review state or workbook exports.

The editor requests `GET /audio/poe2db?path=<reference>` from its configured companion API. The endpoint accepts individual relative `.ogg` and `.wav` references, normalizes their case and resolves them under the fixed `https://cdn.poe2db.tw/audio/dialogue/` host/path. Comma-separated workbook references become separate clip choices. Absolute URLs, traversal, query strings and redirects are rejected. The API sends a fixed PoE2DB referrer upstream and never forwards editor credentials or arbitrary client headers.

This is a public media endpoint, including for guests using **Test Sheet Offline**. It uses the API's allowed-origin checks and a separate request limit. No account token is placed in an audio URL. Upstream missing files and failures appear in the track's tooltip, without affecting translation saves or synchronization. If native playback fails, a bounded HEAD request retrieves an HTTP status when possible; stale or cancelled requests cannot change another track's tooltip.

## Cache policy

| Setting | Default | Meaning |
| --- | --- | --- |
| `AUDIO_CACHE_MAX_BYTES` | `268435456` (256 MiB) | Maximum disposable server cache size. `0` disables disk caching. |
| `AUDIO_CACHE_TTL_SECONDS` | `604800` (7 days) | Maximum server entry age since download. |
| `AUDIO_BROWSER_MAX_AGE_SECONDS` | `604800` (7 days) | Browser HTTP cache freshness for successful audio responses. |
| `AUDIO_MAX_FILE_BYTES` | `16777216` (16 MiB) | Maximum downloaded clip size, including responses without a declared length. |
| `AUDIO_FETCH_TIMEOUT_MS` | `20000` | Upstream request deadline, including the body. |
| `AUDIO_FETCH_CONCURRENCY` | `4` | Maximum concurrent admitted audio requests. |

Successful responses use `Cache-Control: private, max-age=604800` by default. Browsers may reuse fresh audio without contacting the API; actual retention and eviction remain browser-controlled. Strong ETags support conditional requests, and byte ranges support seeking. Failed requests are `no-store`. The policy is finite because a source path can receive updated audio.

Server clips live under `DATA_DIR/audio-cache`, separately from SQLite, source originals and collection artifacts. Cache entries expire after the configured age, and the least recently used entries are evicted to stay within the size limit. Cache initialization reconciles retained entries after a restart. Concurrent misses for the same clip share one upstream download. Oversized clips, HTML error pages and failed or incomplete downloads are not installed in the cache. Request admission and response sizes also bound memory and network work.

This cache is disposable and is excluded from database backups. Losing it only causes another upstream download. It contains no translations, workbook baselines, authored history or recovery data. The editor relies on the normal browser HTTP cache; it does not add IndexedDB audio records, a service worker or a browser Cache Storage database.

## Deployment and validation

Deploy the compatible API before the frontend, then reload editor tabs. No database or browser-storage migration is required. Configure cache limits in the API environment and restart the API to apply them. The proxy still depends on PoE2DB having the requested file and accepting the upstream request.

Local checks cover mocked upstream failures, validation, cache lifecycle and playback responses. Browser validation uses a disposable origin and generated audio. These checks do not establish hosted API availability or production cache behavior.

Run `node scripts/test-clienttext-audio.cjs` and `node scripts/test-clienttext-ui.cjs` in the editor checkout. `node scripts/clienttext-audio-browser-fixture.cjs` checks the actual media route, native playback and seeking, browser cache reuse, editor transitions and desktop themes; it uses the same installed-browser and cached-Vue setup as the existing ClientText browser fixtures. In the API checkout, run `node --test test/audio-proxy.test.js`, `npm run check` and `npm test`.
