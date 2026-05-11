const path = require('path');
const express = require('express');

const argv = new Set(process.argv.slice(2));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3333);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

const DISABLE_OPEN_BROWSER =
  argv.has('--no-open') ||
  process.env.NO_OPEN_BROWSER === '1' ||
  process.env.SDEDITOR_NO_OPEN === '1' ||
  process.env.CI === '1';

const SHOULD_OPEN_BROWSER = !DISABLE_OPEN_BROWSER;
const LOG_REQUESTS = argv.has('--log-requests') || process.env.LOG_REQUESTS === '1';

let app = express();

if (LOG_REQUESTS) {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

app.use(express.static(PUBLIC_DIR));

app.listen(PORT, HOST, () => {
  console.log(`[SDEditor] Serving: ${PUBLIC_DIR}`);
  console.log(`[SDEditor] URL: ${BASE_URL}/`);
  console.log(`[SDEditor] Open browser: ${SHOULD_OPEN_BROWSER ? 'yes' : 'no'} (use --no-open or NO_OPEN_BROWSER=1 to disable)`);
  console.log(`[SDEditor] AI test URL: ${BASE_URL}/?testMode=1&lang=Thai`);
  console.log(`[SDEditor] Log requests: ${LOG_REQUESTS ? 'yes' : 'no'} (use --log-requests to enable)`);

  if (SHOULD_OPEN_BROWSER) {
    const opn = require('opn');
    opn(`${BASE_URL}/`);
  }
});


