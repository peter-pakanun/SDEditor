'use strict';
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const artifactDir = join(__dirname, '../temp/diagnostic-scanner-fixture');

const commonChecks = ['Whitespace', 'Dash spacing', 'Tag syntax', 'Variable tags', 'Keyword popup tags',
  'Text decoration tags', 'Inconsistent translations', 'Dictionary terminology'];
const source = '[Fire] damage and [Cold] chance';
const target = 'Feu  damage and [Cold|Froid] chance';
const plainTarget = 'Plain translation without tags';

// These are disposable presentation records, not real imports or save fixtures.
// Scanner analysis and all modal actions use the application's real controllers.
async function prepare(page, mode) {
  await page.evaluate(async ({ mode, source, target }) => {
    const host = window.__sharedFixtureApp;
    document.activeElement?.blur(); host.hideTooltip(); host.closeHlPopup(); host.ctCloseCompletion();
    host.getEditorComponentRef('diagnosticScanDialog')?.close();
    host.commentsAllVisible = false; host.editorVisible = false; host.editorReady = false;
    host.inlineActive = false; host.inlineEditor = false; host.ctEditor = false; host.ctBusy = false;
    host.ctHistoryViewer = false; host.showSetting = false; host.needsInitialSettings = false;
    host.versionChooserVisible = false; host.hideDNT = false; host.dictionary = [];
    host.saveSettings = async () => true;
    host.ctQueueDraft = () => {}; host.ctFlushDraft = async () => true;
    host.ctQueueCommentDraft = () => {}; host.ctFlushCommentDraft = async () => {};
    if (mode === 'statdescription') {
      host.ctActive = false;
      const content = 'description\n\t1 fixture_diagnostic_stat\n\t1\n\t\t# "' + source
        + '"\n\tlang "Thai"\n\t1\n\t\t# "' + target + '"\n';
      const descs = Array.from({ length: 45 }, (_, index) => parseDesc('fixture/scan-' + String(index).padStart(3, '0') + '.txt', content, host.lang));
      host._workspaceSourceBaseline = host.toPlainForStorage(descs); host._workspaceBaselineIndex = null;
      host.descs = descs; host.sourceLoaded = true; host.loadingProgress = 100;
      host.clearDiagnosticScanResults(); host.searchText = 'no-visible-fixture-records'; host.applyFileSearch();
    } else {
      const units = Array.from({ length: 45 }, (_, index) => Vue.markRaw({
        id: 'normal|Diagnostics|Scan' + String(index).padStart(3, '0'), role: 'normal', sheet: 'Diagnostics',
        recordId: 'Scan' + String(index).padStart(3, '0'), notes: [], fields: [{ id: 'diagnostic-text',
          name: 'Text', kind: 'text', source, target, targetCell: 'B2', required: true, originalMissing: false, outdated: false }],
      }));
      host.ctWorkspace = { scope: { accountId: 'guest', game: host.gameVersion, branchId: host.branchId || 'default',
        versionId: 'diagnostic-fixture', groupId: 'local:diagnostic-fixture', language: host.lang },
        metadata: { version: { name: 'Diagnostic browser fixture' }, descriptors: [{ role: 'normal', baselineId: 'a'.repeat(64) }] } };
      host.ctUnits = Vue.markRaw(units); host._ctUnitIndex = Vue.markRaw(new Map(units.map(unit => [unit.id, unit])));
      host._ctWorkUnits = Vue.markRaw(new Map(units.map(unit => [unit.id, unit])));
      host._ctSheets = Vue.markRaw([{ role: 'normal', name: 'Diagnostics', key: JSON.stringify(['normal', 'Diagnostics']) }]);
      host.ctSheet = JSON.stringify(['normal', 'Diagnostics']); host.ctSelection = ''; host.ctSaved = Vue.markRaw({});
      host.ctValues = {}; host.ctReviewed = {}; host.ctDraftDirty = false; host.ctInitializing = false;
      host.ctActive = true; host.ctTool = 'dictionary'; host.ctSelectedFilters = ['unchanged', 'missing', 'saved'];
      host.ctSearch = host.ctAppliedSearch = 'no-visible-fixture-records'; host.ctClearScanResults(); host.ctRevision++;
      // Test mode has no durable workspace for these synthetic records. Selection
      // still uses ctSelect; only the backing reads are settled empty fixtures.
      host._ctStore.getDraft = async () => null;
      host.ctLoadHistory = async () => {}; host.ctLoadCommentDraft = async () => {};
      host.ctRefreshDraftSummaries = async () => {}; host.ctPresence = () => {};
    }
    await host.$nextTick();
  }, { mode, source, target });
}

async function inspectField(page, mode) {
  const selector = mode === 'clienttext' ? '.ctFullEditor [data-ct-target="diagnostic-text"]' : '.editor [data-editor-ref="translation_0"]';
  const input = page.locator(selector);
  await input.waitFor({ state: 'visible' });
  const block = mode === 'clienttext' ? input.locator('xpath=ancestor::*[contains(@class,"ctTarget")][1]')
    : input.locator('xpath=ancestor::*[contains(@class,"editBlock")][1]');
  const snapshot = await input.locator('..').evaluate(element => ({
    errors: [...element.querySelectorAll('.diagnosticRange.diagError')].map(span => span.textContent),
    warnings: [...element.querySelectorAll('.diagnosticRange.diagWarning')].map(span => span.textContent),
  }));
  assert.deepEqual(snapshot.errors, [], mode + ': missing keywords leave valid target tags neutral');
  assert.deepEqual(snapshot.warnings, ['  '], mode + ': whitespace warning marks only the extra spaces');
  assert.equal(await block.locator('.diagnosticErrorPill .metaNum').textContent(), '1');
  assert.equal(await block.locator('.diagnosticWarningPill .metaNum').textContent(), '1');
  await block.locator('.diagnosticWarningPill').hover();
  await page.waitForFunction(() => document.querySelector('.appTooltip')?.textContent.includes('Consecutive whitespace'));
  await block.locator('.diagnosticErrorPill').hover();
  await page.waitForFunction(() => /keyword/i.test(document.querySelector('.appTooltip')?.textContent || ''));
  const missing = block.locator('.diagnosticMissingTagPill');
  assert.equal(await missing.textContent(), 'Missing tag: [Fire]');
  assert.equal(await missing.evaluate(element => getComputedStyle(element).borderStyle), 'dashed');
  await missing.focus();
  assert.equal(await missing.evaluate(element => element === document.activeElement), true);
  await page.waitForFunction(() => document.querySelector('.appTooltip')?.textContent.includes('[Fire]'));
  const fits = await missing.evaluate(element => {
    const box = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect();
    return box.left >= parent.left - 1 && box.right <= parent.right + 1;
  });
  assert.ok(fits, mode + ': missing label wraps within the field metadata');
  return { input, block };
}

async function checkDiagnosticScanner(page) {
  mkdirSync(artifactDir, { recursive: true });
  let presentations = 0;
  for (const mode of ['statdescription', 'clienttext']) {
    await prepare(page, mode);
    assert.equal(await page.locator(mode === 'clienttext' ? '.ctTable tbody tr[data-unit-id]' : '.fileTable tbody tr[data-filepath]').count(), 0,
      'The fixture search hides every record before the workspace-wide scan');
    const dialog = page.locator('.diagnosticScanDialog');
    assert.equal(await dialog.count(), 1, mode + ': one shared Scanner exists outside both mode surfaces');
    const launcher = page.locator('.diagnosticScanButton:visible');
    await launcher.click();
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#diagnosticScanDialogTitle').textContent(), 'Scan diagnostics');
    const labels = await dialog.locator('.diagnosticScanOption strong').allTextContents();
    for (const label of commonChecks) assert.ok(labels.includes(label), mode + ': common option ' + label);
    assert.equal(await dialog.getByRole('checkbox', { name: 'Inconsistent translations', exact: true }).isChecked(), true, 'Both modes retain the SD consistency default');
    assert.equal(await dialog.getByRole('checkbox', { name: 'Dictionary terminology', exact: true }).isChecked(), false, 'Dictionary terminology is opt-in');
    assert.equal(await dialog.locator('.diagnosticScanOption input').evaluateAll(inputs => inputs.every(input =>
      document.getElementById(input.getAttribute('aria-describedby'))?.textContent.trim())), true, 'Every check has its accessible description');
    if (mode === 'clienttext') assert.ok(labels.length > commonChecks.length, 'ClientText has additional format checks');
    await dialog.locator('.diagnosticScanOptions input').evaluateAll(inputs => inputs.forEach(input => { if (input.checked) input.click(); }));
    assert.equal(await dialog.locator('.diagnosticScanStart').isDisabled(), true, 'No selected checks disables Start scan');
    await dialog.getByRole('checkbox', { name: 'Whitespace', exact: true }).check();
    await dialog.getByRole('checkbox', { name: 'Keyword popup tags', exact: true }).check();
    await dialog.getByRole('checkbox', { name: 'Inconsistent translations', exact: true }).check();
    // Invoke real DOM buttons in one event turn to inspect the first painted
    // progress state before the genuine scanner's cooperative timer advances.
    const stopped = await page.evaluate(async mode => {
      const host = window.__sharedFixtureApp, dialog = document.querySelector('.diagnosticScanDialog');
      dialog.querySelector('.diagnosticScanStart').click(); await host.$nextTick();
      const state = { running: mode === 'clienttext' ? host.ctScanRunning : host.diagnosticScanRunning,
        total: Number(dialog.querySelector('progress')?.max), disabled: dialog.querySelector('fieldset').disabled,
        progressLabel: dialog.querySelector('.diagnosticScanStatusText')?.textContent,
        progressAria: dialog.querySelector('progress')?.getAttribute('aria-label'), busy: host.ctBusy };
      dialog.querySelector('.diagnosticScanClose').click();
      if (mode === 'clienttext') host.ctOpenScanDialog(); else host.openDiagnosticScanDialog();
      await host.$nextTick(); state.reopened = dialog.open; state.retainedProgress = !!dialog.querySelector('progress');
      dialog.querySelector('.diagnosticScanStop').click(); await host.$nextTick();
      state.stopped = mode === 'clienttext' ? host.ctScanStopped : host.diagnosticScanStopped;
      state.resultCards = dialog.querySelectorAll('.diagnosticScanResultCard').length; return state;
    }, mode);
    assert.equal(stopped.running, true); assert.equal(stopped.total, 45, 'Scanner includes records hidden by search');
    assert.equal(stopped.disabled, true); assert.equal(stopped.reopened, true); assert.equal(stopped.retainedProgress, true);
    assert.equal(stopped.stopped, true); assert.equal(stopped.resultCards, 0);
    if (mode === 'clienttext') assert.equal(stopped.busy, false, 'Scanner does not lock ordinary ClientText workspace operations');
    assert.match(stopped.progressLabel, mode === 'clienttext' ? /45 records/ : /45 files/);
    assert.equal(stopped.progressAria, mode === 'clienttext' ? 'Records scanned' : 'Files scanned');
    assert.match(await dialog.locator('.diagnosticScanStatusText').textContent(), /Scan stopped/);
    await dialog.locator('.diagnosticScanStart').click();
    await page.waitForFunction(mode => mode === 'clienttext' ? window.__sharedFixtureApp.ctScanDone : window.__sharedFixtureApp.diagnosticScanCompleted, mode);
    assert.equal(await dialog.evaluate(element => element.open), true, 'Scan completion retains the modal');
    assert.match(await dialog.locator('.diagnosticScanStatusText').textContent(), /Scan complete.*45/);
    assert.equal(await dialog.locator('.diagnosticScanResultCard').count(), 20);
    const firstPage = await dialog.locator('.diagnosticScanResultCard h4').first().textContent();
    await dialog.getByRole('button', { name: 'Next scan results', exact: true }).click();
    assert.equal(await dialog.locator('.diagnosticScanResultPagination .fileRange').textContent(), '21–40 of 45');
    assert.notEqual(await dialog.locator('.diagnosticScanResultCard h4').first().textContent(), firstPage);
    await dialog.getByRole('button', { name: 'Previous scan results', exact: true }).click();
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) for (const width of [1440, 1100, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      const geometry = await dialog.evaluate(element => {
        const rect = element.getBoundingClientRect(), footer = element.querySelector('footer').getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, footerBottom: footer.bottom,
          bodyClient: element.querySelector('.diagnosticScanBody').clientHeight, bodyScroll: element.querySelector('.diagnosticScanBody').scrollHeight };
      });
      assert.ok(geometry.left >= -1 && geometry.right <= width + 1 && geometry.top >= -1 && geometry.bottom <= 901, mode + '/' + theme + ': Scanner fits desktop viewport');
      assert.ok(geometry.footerBottom <= 901 && geometry.bodyClient < geometry.bodyScroll, 'Long results scroll inside the modal and keep actions reachable');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const screenshot = join(artifactDir, 'sdeditor-diagnostic-scanner-' + mode + '.png');
    await page.screenshot({ path: screenshot }); console.log('Scanner screenshot: ' + screenshot);
    await dialog.locator('.diagnosticScanClose').click(); await launcher.click();
    assert.equal(await dialog.locator('.diagnosticScanResultCard').count(), 20, 'Close/reopen retains completed results');
    await dialog.press('Escape');
    assert.equal(await dialog.evaluate(element => element.open), false, 'Native Escape closes the shared modal');
    await launcher.evaluate(element => { if (document.activeElement !== element) throw new Error('Escape must return focus to Scan diagnostics'); });
    await launcher.click();
    await dialog.locator('.diagnosticScanResultCard').first().getByRole('button', { name: mode === 'clienttext' ? /Open normal/ : /Open fixture/ }).click();
    assert.equal(await dialog.evaluate(element => element.open), false, 'Open result closes Scanner');
    for (const theme of ['light', 'grey', 'dark', 'modern-dark']) for (const width of [1440, 1100, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      await inspectField(page, mode); presentations++;
    }
    const fieldScreenshot = join(artifactDir, 'sdeditor-diagnostic-field-' + mode + '.png');
    await page.screenshot({ path: fieldScreenshot }); console.log('Diagnostic screenshot: ' + fieldScreenshot);
    await page.evaluate(async ({ mode, plainTarget }) => {
      const host = window.__sharedFixtureApp; host.hideTooltip();
      if (mode === 'clienttext') host.ctValues['diagnostic-text'] = plainTarget;
      else { host.editorBlocks[0].translation = plainTarget; host.refreshEditorBlockMeta(host.editorBlocks[0], 0); host.refreshEditorBlockHLter(0); }
      await host.$nextTick();
    }, { mode, plainTarget });
    const targetInput = page.locator(mode === 'clienttext' ? '.ctFullEditor [data-ct-target="diagnostic-text"]' : '.editor [data-editor-ref="translation_0"]');
    assert.equal(await targetInput.locator('..').locator('.diagnosticRange').count(), 0, 'No target tag means no whole-field missing keyword paint');
    const targetBlock = mode === 'clienttext' ? targetInput.locator('xpath=ancestor::*[contains(@class,"ctTarget")][1]') : targetInput.locator('xpath=ancestor::*[contains(@class,"editBlock")][1]');
    assert.equal(await targetBlock.locator('.diagnosticErrorPill .metaNum').textContent(), '1');
    assert.deepEqual(await targetBlock.locator('.diagnosticMissingTagPill').allTextContents(), ['Missing tag: [Cold]', 'Missing tag: [Fire]']);
    assert.equal(await targetBlock.locator('.diagnosticWarningPill').count(), 0);
    await targetBlock.locator('.diagnosticErrorPill').hover();
    await page.waitForFunction(() => /keyword/i.test(document.querySelector('.appTooltip')?.textContent || ''));

    // The reported Escape Shot example uses each real mode's live draft checks.
    const english = 'Leap backwards, firing an icy arrow which can [Chill] or [Freeze] enemies around the location from which you escaped. This arrow will [Trigger] [IceFragment|Ice Fragments] on impact.';
    const french = "Un bond vers l'arrière accompagné d'un tir de flèche pouvant [Chill|Frigorifier] ou [Freeze|Geler] les ennemis qui se trouvent autour de votre emplacement initial. Cette flèche crée des [IceFragment|Fragments de glace] à l'impact.";
    await page.evaluate(async ({ mode, english, french }) => {
      const host = window.__sharedFixtureApp; host.hideTooltip();
      if (mode === 'clienttext') {
        const unit = host.ctCurrentUnit, replacement = Vue.markRaw({ ...unit, fields: unit.fields.map(field => ({ ...field, source: english })) });
        const units = Vue.markRaw(host.ctUnits.map(item => item.id === unit.id ? replacement : item));
        host._ctUnitIndex = Vue.markRaw(new Map(units.map(item => [item.id, item])));
        host._ctWorkUnits = Vue.markRaw(new Map(units.map(item => [item.id, item])));
        host.ctUnits = units;
        host.ctValues = { 'diagnostic-text': french }; host.ctRevision++;
      } else {
        host.editorBlocks[0].english = english; host.editorBlocks[0].translation = french;
        host.refreshEditorBlockMeta(host.editorBlocks[0], 0); host.refreshEditorBlockHLter(0);
      }
      await host.$nextTick(); host.ctResizeFields();
    }, { mode, english, french });
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(await targetBlock.locator('.diagnosticMissingTagPill').textContent(), 'Missing tag: [Trigger]');
    assert.equal(await targetInput.locator('..').locator('.diagError').count(), 0, 'Chill stays neutral in Escape Shot');
    await page.screenshot({ path: join(artifactDir, 'sdeditor-missing-trigger-' + mode + '.png') });
    await targetInput.fill(french.replace('crée', '[Trigger|crée]'));
    assert.equal(await targetBlock.locator('.diagnosticMissingTagPill').count(), 0, 'Adding Trigger clears the missing label immediately');
    assert.equal(await targetBlock.locator('.diagnosticErrorPill').count(), 0);
    await targetInput.fill(french + ' [Wrong]');
    assert.equal(await targetBlock.locator('.diagnosticMissingTagPill').textContent(), 'Missing tag: [Trigger]');
    assert.deepEqual(await targetInput.locator('..').locator('.diagError').allTextContents(), ['[Wrong]'], 'Only the unexpected tag receives a red range');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log('PASS shared Scanner SD/ClientText real actions, options, progress, Stop, Close/reopen, pagination and Open; ' + presentations + ' diagnostic span/pill/hover/focus presentations across four themes and resized desktop widths; Escape Shot missing Trigger, live correction and unexpected tag ranges.');
}
module.exports = { checkDiagnosticScanner };
