// Disposable UI fixture: node scripts/inline-connection-browser-fixture.cjs
// http://127.0.0.1:3360/?testMode=1&lang=Thai
// Uses the real collaboration Client with an in-memory room and fake WebSocket
// transport. No login, external API or IndexedDB data is accessed.
const express = require('express');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const publicDir = resolve(__dirname, '../public');

function installFixture() {
  const panel = document.createElement('aside');
  panel.id = 'inline-connection-fixture';
  panel.setAttribute('aria-label', 'Disposable inline connection fixture');
  panel.setAttribute('data-inline-focus-surface', ''); panel.tabIndex = -1;
  panel.style.cssText = 'position:fixed;left:12px;bottom:24px;z-index:2147483000;width:385px;max-height:48vh;overflow:auto;box-sizing:border-box;padding:10px;border:2px solid #926400;border-radius:8px;background:#fff8de;color:#28220e;font:12px/1.4 system-ui;box-shadow:0 4px 16px #0004';
  const title = document.createElement('strong'); title.textContent = 'Inline connection · disposable memory fixture';
  const description = document.createElement('p'); description.textContent = 'Real Client, fake socket, test-mode source/drafts. Use table ArrowDown or translation Ctrl+ArrowDown. Reload resets fixture work.';
  const controls = document.createElement('div'); controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px';
  const status = document.createElement('pre'); status.id = 'inline-connection-status';
  status.setAttribute('role', 'status'); status.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0;font:11px/1.5 monospace';
  panel.append(title, description, controls, status); document.body.append(panel);
  const copy = value => JSON.parse(JSON.stringify(value));
  const getApp = () => window.__inlineConnectionFixtureApp || document.querySelector('#app')?.__vue_app__?._instance?.proxy;
  let vm, client, dropNext = false, failNext = false, busy = false, message = 'Waiting for test-mode app…';
  const claims = [], sockets = [], saves = [];
  const button = (label, action) => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
    node.style.cssText = 'padding:5px 7px;border:1px solid #a78237;border-radius:4px;background:#fff;color:#28220e;font:12px system-ui';
    node.addEventListener('pointerdown', event => event.preventDefault());
    node.onclick = async () => {
      if (!client || busy) return;
      busy = true; node.disabled = true;
      try { await action(); } catch (error) { message = 'Fixture error: ' + error.message; console.error(error); }
      finally { busy = false; node.disabled = false; inspect(); }
    };
    controls.append(node);
  };
  function inspect() {
    if (!vm || !client) { status.textContent = message; return; }
    const current = vm.editorCurrentEditingDesc?.filepath || '(none)';
    const draft = vm.inlineDraftRows?.[current]?.translations || [];
    const lines = [message, 'Connected: ' + client.connected + ' | disconnected: ' + client.disconnected,
      'Inline: ' + !!vm.inlineActive + ' | full editor: ' + !!vm.editorVisible + ' | ready: ' + !!vm.editorReady,
      'Active: ' + current + ' | selected: ' + vm.selectedFilepath,
      'Navigation busy: ' + !!vm.navigationBusy + ' | transition busy: ' + !!vm.inlineTransitionBusy,
      'Pending claims: ' + client.claims.size + ' | sockets: ' + sockets.length,
      'Load error: ' + (vm.editorLoadError || '(none)'),
      'Shared error: ' + (vm.collaborationState.error || '(none)'),
      'Notice: ' + (vm.collaborationNotice || '(none)'),
      'Draft: ' + JSON.stringify(draft), 'Claims: ' + claims.slice(-6).join(' → '),
      'Memory saves: ' + saves.length];
    const next = lines.join('\n'); if (status.textContent !== next) status.textContent = next;
  }
  class FakeSocket {
    constructor() { this.readyState = 0; sockets.push(this); setTimeout(() => this.open(), 0); }
    open() { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.(); }
    send(text) {
      const packet = JSON.parse(text);
      if (packet.type !== 'claim') return;
      claims.push(packet.filepath);
      if (dropNext) {
        dropNext = false; message = 'Dropped the pending claim. The row can finish opening locally. Press Reconnect to restore presence.';
        this.drop(); return;
      }
      if (failNext) {
        failNext = false; message = 'Simulated an editing-availability failure on the real pending claim.';
        const pending = client.claims.get(packet.requestId);
        if (pending) {
          clearTimeout(pending.timer); client.claims.delete(packet.requestId);
          pending.reject(new Error('Could not confirm editing availability. Try again.'));
        }
        return;
      }
      setTimeout(() => this.receive({ type: 'claim-result', requestId: packet.requestId, granted: true, peers: [] }), 0);
    }
    receive(packet) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(packet) }); }
    close() { this.readyState = 3; }
    drop() { this.readyState = 3; this.onclose?.(); inspect(); }
  }
  async function setup() {
    for (let count = 0; count < 200; count++) {
      vm = getApp();
      if (vm?.testMode && vm.sourceLoaded && vm.descs?.length) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!vm?.testMode || !vm.sourceLoaded) throw new Error('Open this fixture with ?testMode=1&lang=Thai.');
    const initial = vm.descs.map(desc => ({ filepath: desc.filepath, translations: [...(desc.translations.Thai || [])],
      needsReview: false, trackedForExport: false, revision: 1 }));
    vm.lang = 'Thai'; vm.inlineEditor = true; vm.inlineSidebarVisible = true; vm.hideDNT = false;
    vm.versionChooserVisible = false; vm.showSetting = false; vm.needsInitialSettings = false;
    vm.searchText = ''; vm.currentPage = 1; vm.selectAllFileFilters(); vm.filterDesc();
    const files = Object.fromEntries(initial.map(file => [file.filepath, file]));
    const room = { identity: { accountId: 'fixture-user', game: vm.gameVersion, language: vm.lang, sourceHash: vm.sourceIdentity },
      roomId: 'fixture-room', sequence: 0, local: files, shared: copy(files), outbox: [], conflicts: [] };
    client = new CollaborationSync.Client({ apiBase: location.origin, WebSocket: FakeSocket,
      onChange(state) { if (vm._collaboration === client) vm.collabReceiveState(state); inspect(); },
      onStatus(value) { if (vm._collaboration === client) vm.collabReceiveState({ ...client.snapshot({ includeFiles: false }),
        status: value.message, error: value.error ? value.message : '' }); inspect(); },
    });
    client.key = 'fixture-room'; client.state = { rooms: { [client.key]: room } };
    client.api = async path => { if (path.endsWith('/ticket')) return { ticket: 'fixture-ticket' };
      throw new Error('Unexpected fixture endpoint: ' + path); };
    client.retry = () => Promise.resolve(client.snapshot({ includeFiles: false }));
    client.schedule = () => {};
    vm._collaboration = client;
    await client.openSocket(client.epoch);
    // Test mode skips normal persistence. Mirror its validated explicit saves
    // into the fixture room so fileBase does not replace newly typed text.
    const persist = vm.persistTranslationBatch.bind(vm);
    vm.persistTranslationBatch = async (updates, origin, options = {}) => {
      if (vm._collaboration === client) {
        for (const { desc, lines } of updates) room.local[desc.filepath] = { ...room.local[desc.filepath],
          translations: [...lines], needsReview: false, trackedForExport: true };
        saves.push(...updates.map(({ desc, lines }) => ({ filepath: desc.filepath, translations: [...lines] })));
      }
      return persist(updates, origin, options);
    };
    await vm.$nextTick();
    message = 'Ready. Select a file, arm a claim drop, then navigate with the keyboard.';
    inspect();
  }
  button('Drop next claim', () => { dropNext = true; failNext = false; message = 'Armed: the next claim closes its socket before receiving a reply.'; });
  button('Fail next claim (simulated)', () => { failNext = true; dropNext = false; message = 'Armed: a simulated failure rejects the next pending claim.'; });
  button('Reconnect', async () => { client.socket?.drop(); await client.openSocket(client.epoch); message = 'Opened a replacement presence socket.'; });
  button('Focus first file', async () => { await vm.activateInlineRow(vm.descs[0].filepath); await vm.$nextTick();
    vm.getEditorRef('translation', 0, vm.editorBlocks[0]?.isTable ? 0 : null)?.focus(); message = 'Focused the first inline translation.'; });
  button('Retry current inline row', async () => { const filepath = vm.editorCurrentEditingDesc?.filepath || vm.selectedFilepath;
    message = 'Inline retry returned: ' + await vm.activateInlineRow(filepath); });
  button('Open current full editor', async () => { message = 'Full-editor open returned: ' + await vm.openInlineFullEditor(); });
  setInterval(inspect, 200);
  setup().catch(error => { message = 'Fixture setup failed: ' + error.message; console.error(error); inspect(); });
}

const app = express();
app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.get('/', (req, res) => {
  if (req.query.testMode !== '1') return res.redirect('/?testMode=1&lang=Thai');
  const html = readFileSync(resolve(publicDir, 'index.html'), 'utf8');
  res.type('html').send(html.replace('</body>', '<script>(' + installFixture.toString() + ')();</script></body>'));
});
app.get('/index.js', (_req, res) => {
  const source = readFileSync(resolve(publicDir, 'index.js'), 'utf8');
  res.type('js').send(source.replace("app.mount('#app');", "window.__inlineConnectionFixtureApp = app.mount('#app');"));
});
app.use(express.static(publicDir));
app.listen(3360, '127.0.0.1', () => console.log('Inline connection fixture: http://127.0.0.1:3360/?testMode=1&lang=Thai'));
