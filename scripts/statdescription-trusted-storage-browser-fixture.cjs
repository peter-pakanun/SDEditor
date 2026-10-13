// Real IndexedDB proof-cache retirement on a disposable origin and profile.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const modules = 'C:/Users/lpeac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [modules] }));
const executablePath = process.env.FIXTURE_BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);

(async () => {
    const server = createServer((req, res) => {
        if (req.url === '/') { res.end('<!doctype html><script src="/statDescCodec.js"></script><script src="/workspaceState.js"></script><script src="/normalizedStore.js"></script>'); return; }
        const allowed = ['statDescCodec.js', 'workspaceState.js', 'normalizedStore.js', 'offlineStore.js'];
        const file = req.url.slice(1);
        if (!allowed.includes(file)) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', 'application/javascript'); res.end(readFileSync(join(__dirname, '..', 'public', file)));
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await chromium.launch({ headless: true, executablePath });
        const page = await browser.newPage();
        await page.goto('http://127.0.0.1:' + server.address().port);
        const result = await page.evaluate(async () => {
            const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
            const completed = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); });
            const open = indexedDB.open('sdeditor', 19);
            open.onupgradeneeded = () => {
                open.result.createObjectStore('kv', { keyPath: 'key' });
                NormalizedStore.upgrade(open.result, open.transaction);
            };
            const old = await request(open), id = 'a'.repeat(64);
            const archive = { version: 1, baselineId: id, treeRoot: 'b'.repeat(64), zipHash: 'c'.repeat(64) };
            const source = [{ filepath: 'source/a.txt', stats: ['a'], variables: ['#'], remarks: [''], translations: { English: ['Original'], Thai: ['Original target'] } }];
            const baseline = { archive, source, rawSource: structuredClone(source), tree: { root: archive.treeRoot, paths: ['source/a.txt'], levels: [['d'.repeat(64)]] }, baselineTree: { obsolete: true } };
            const pending = { mutationId: 'old-command', files: [{ baseline: source[0], proof: { index: 0, siblings: [] } }] };
            const rows = {
                kv: [
                    { key: 'settings', value: { lang: 'Thai' } },
                    { key: 'import_baseline_poe1_' + id, value: structuredClone(baseline) },
                    { key: 'source_poe1', value: structuredClone(source) },
                    { key: 'collaboration_v1', value: { rooms: { one: { outbox: [{ id: 'pending-id', wire: pending }] } } } },
                    { key: 'translation_save_receipts_poe1', value: [{ jobId: 'stable-job', signature: 'unchanged' }] },
                ],
                baseline_assets: [{ key: '["poe1","' + id + '"]', value: structuredClone(baseline) }],
                baseline_files: [{ key: 'original-file', value: structuredClone(source[0]) }],
                collaboration_operations: [{ key: 'pending-operation', value: { wire: pending, id: 'pending-id' } }],
                workspace_records: [{ key: 'recovery', value: { recoveryId: 'stable-recovery', translations: ['Recoverable saved text'] } }],
                save_submissions: [{ key: 'submitted-job', value: { id: 'stable-job', command: pending } }],
                save_receipts: [{ key: 'receipt', value: { jobId: 'stable-job', signature: 'unchanged' } }],
            };
            const write = old.transaction(Object.keys(rows), 'readwrite'), ready = completed(write);
            for (const [name, values] of Object.entries(rows)) for (const row of values) write.objectStore(name).put(row);
            await ready;
            let closed = false;
            old.onversionchange = () => { closed = true; old.close(); };
            await new Promise((resolve, reject) => {
                const script = document.createElement('script'); script.src = '/offlineStore.js'; script.onload = resolve; script.onerror = reject; document.head.append(script);
            });
            await OfflineStore.getSettings();
            const current = await request(indexedDB.open('sdeditor', 20));
            const snapshot = async () => {
                const tx = current.transaction(Object.keys(rows), 'readonly'), ready = completed(tx);
                const result = Object.fromEntries(await Promise.all(Object.keys(rows).map(async name => [name, await request(tx.objectStore(name).getAll())])));
                await ready; return result;
            };
            const after = await snapshot();
            const archives = await OfflineStore.findImportedArchives(archive.zipHash, 'poe1');
            const otherGame = await OfflineStore.findImportedArchives(archive.zipHash, 'poe2');
            await OfflineStore.getSettings();
            const again = await snapshot();
            current.close();
            return { before: rows, after, again, closed, version: current.version, archives, otherGame };
        });
        assert.equal(result.version, 20); assert.equal(result.closed, true);
        const expected = structuredClone(result.before);
        for (const row of expected.baseline_assets) { delete row.value.tree; delete row.value.baselineTree; }
        for (const row of expected.kv) if (row.key.startsWith('import_baseline_')) { delete row.value.tree; delete row.value.baselineTree; }
        const sorted = rows => Object.fromEntries(Object.entries(rows).map(([name, records]) => [name, records.sort((a, b) => a.key.localeCompare(b.key))]));
        assert.deepEqual(sorted(result.after), sorted(expected));
        assert.deepEqual(sorted(result.again), sorted(expected));
        assert.deepEqual(result.archives, [expected.baseline_assets[0].value.archive]);
        assert.deepEqual(result.otherGame, []);
        console.log('PASS: native v19→v20 cleanup removes proof trees, preserves legacy IDs, originals, pending bodies, receipts and recovery, and fences old writers.');
    } finally {
        await browser?.close(); await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
