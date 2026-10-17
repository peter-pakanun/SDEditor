'use strict';
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));

async function geometry(page) {
    return page.locator('.ctSkillRelatedChoice').evaluate(footer => {
        const strip = footer.closest('.gamePreviewStrip'), row = strip.querySelector('.gamePreviewMainRow');
        const rect = node => {
            const box = node.getBoundingClientRect();
            return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
        };
        return { footer: rect(footer), strip: rect(strip), row: rect(row), select: rect(footer.querySelector('select')),
            frames: rect(row.querySelector('.gamePreviewFrameWrap')),
            handle: strip.closest('.editorPreviewPane')?.querySelector('.editorPreviewResizeHandle')?.getBoundingClientRect().top,
            overflow: [strip, row, footer, ...strip.querySelectorAll('.gamePreviewSourcePane, .gamePreviewTargetPane')]
                .map(node => node.scrollWidth - node.clientWidth),
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            inlineHost: strip.closest('.inlineEditorSidebar') ? rect(strip.closest('.inlineEditorSidebar')) : null };
    });
}

function checkGeometry(value, message) {
    assert.ok(value.footer.top >= value.row.bottom - 1, message + ': footer stays below all scrolling preview content');
    assert.ok(value.strip.bottom - value.footer.bottom >= 0 && value.strip.bottom - value.footer.bottom < 16,
        message + ': footer stays at the bottom of the preview');
    assert.ok(value.footer.height <= 40, message + ': selector remains one compact row');
    assert.ok(value.select.width >= 100 && value.select.right <= value.footer.right + 1,
        message + ': selector fits within the available width');
    assert.ok(Math.abs(value.frames.left - value.row.left) <= 1, message + ': cards reclaim the former selector column');
    assert.ok(value.overflow.every(width => width <= 1) && value.documentOverflow <= 1,
        message + ': no horizontal overflow: ' + JSON.stringify(value));
    if (value.handle !== undefined) assert.ok(value.footer.bottom <= value.handle, message + ': footer clears the resize handle');
    if (value.inlineHost) assert.ok(value.footer.bottom <= value.inlineHost.bottom && value.row.height > 50,
        message + ': inline footer stays visible within its sidebar');
}

async function checkRelatedSkillFooter(page, folder) {
    const viewport = page.viewportSize(), snapshot = await page.evaluate(() => {
        window.fixtureFooterSaveSettings = fixtureApp.saveSettings;
        fixtureApp.saveSettings = async () => true;
        return { editor: fixtureApp.ctEditor, height: fixtureApp.fullEditorPreviewHeight,
            theme: document.documentElement.dataset.theme, selection: fixtureApp.ctSelection };
    });
    const picker = page.getByRole('combobox', { name: 'Related skill', exact: true }), measurements = [];
    try {
        for (const editor of [true, false]) for (const theme of ['light', 'grey', 'dark', 'modern-dark']) for (const width of [1440, 1000]) {
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(async ({ editor, theme }) => {
                fixtureApp.ctEditor = editor; fixtureApp.ctInlineClosed = false; fixtureApp.ctTool = 'preview';
                fixtureApp.fullEditorPreviewHeight = 360; document.documentElement.dataset.theme = theme;
                await fixtureApp.$nextTick();
                for (const node of document.querySelectorAll('.sharedEditorSidebar, .gamePreviewMainRow, .gamePreviewSourcePane, .gamePreviewTargetPane')) node.scrollTop = 0;
            }, { editor, theme });
            await settle(page);
            const message = (editor ? 'full' : 'inline') + '/' + theme + '/' + width;
            assert.equal(await picker.inputValue(), 'example', message + ': originating skill survives layout changes');
            const before = await geometry(page); checkGeometry(before, message);
            const scroller = page.locator(editor ? '.gamePreviewTargetPane' : '.gamePreviewMainRow');
            const box = await scroller.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 20000);
            await page.waitForFunction(selector => {
                const node = document.querySelector(selector); return node.scrollTop > 0 && node.scrollTop >= node.scrollHeight - node.clientHeight - 2;
            }, editor ? '.gamePreviewTargetPane' : '.gamePreviewMainRow');
            const after = await geometry(page); checkGeometry(after, message + '/scrolled');
            assert.deepEqual(after.footer, before.footer, message + ': scrolling does not move the footer');
            assert.equal(await picker.isVisible(), true);
            await picker.focus(); await picker.press('End');
            await page.waitForFunction(() => fixtureApp.ctSkillPreviewModel?.skillId === 'second-example');
            assert.match(await page.locator('.gamePreviewSourcePane .ctSkillFullCard h3').innerText(), /Second ability/);
            assert.match(await page.locator('.gamePreviewTargetPane .ctSkillFullCard h3').innerText(), /Target Second ability/);
            assert.equal(await page.evaluate(() => fixtureApp.ctSelection), snapshot.selection, message + ': picker does not navigate away from the definition');
            await picker.selectOption('example'); await page.waitForFunction(() => fixtureApp.ctSkillPreviewModel?.skillId === 'example');
            if (theme === 'light' && width === 1440) {
                const field = page.locator('textarea[data-ct-target="Display Name"]:visible'), savedText = await field.inputValue();
                await field.fill('Live related [Quality|tag]'); await settle(page);
                assert.equal(await field.evaluate(node => node === document.activeElement), true, message + ': live preview updates before blur');
                assert.equal(await page.locator('.gamePreviewTargetPane .ctSkillCardType').innerText(), 'Live related tag');
                assert.equal(await page.locator('.gamePreviewSourcePane .ctSkillCardType').innerText(), 'Example type');
                await field.fill(savedText); await settle(page);
                const level = page.getByRole('textbox', { name: 'Preview example: level', exact: true });
                await level.fill('6'); await settle(page);
                for (const pane of ['Source', 'Target']) assert.equal(await page.locator('.gamePreview' + pane + 'Pane .ctSkillCardProperties dd').first().innerText(), '6');
                await level.fill('1'); await settle(page);
            }
            if (editor) {
                const handle = page.locator('.editorPreviewResizeHandle');
                await handle.focus(); await handle.press('Home'); await settle(page); checkGeometry(await geometry(page), message + '/minimum');
                await handle.press('End'); await settle(page);
                const maximum = await geometry(page); checkGeometry(maximum, message + '/maximum');
                const drag = await handle.boundingBox();
                await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2); await page.mouse.down();
                await page.mouse.move(drag.x + drag.width / 2, drag.y - 80, { steps: 6 }); await page.mouse.up(); await settle(page);
                const resized = await geometry(page); checkGeometry(resized, message + '/drag');
                assert.ok(resized.strip.height < maximum.strip.height - 50, message + ': pointer resize remains responsive');
            }
            measurements.push({ mode: editor ? 'full' : 'inline', theme, width, ...await geometry(page) });
            await page.mouse.move(0, 0);
            await page.screenshot({ path: join(folder, 'related-footer-' + message.replaceAll('/', '-') + '.png') });
        }
        writeFileSync(join(folder, 'related-footer-layout.json'), JSON.stringify(measurements, null, 2));
    } finally {
        await page.evaluate(async snapshot => {
            fixtureApp.ctEditor = snapshot.editor; fixtureApp.fullEditorPreviewHeight = snapshot.height;
            fixtureApp.saveSettings = window.fixtureFooterSaveSettings; delete window.fixtureFooterSaveSettings;
            document.documentElement.dataset.theme = snapshot.theme; await fixtureApp.$nextTick();
        }, snapshot);
        await page.setViewportSize(viewport); await settle(page);
    }
    console.log('Related skill footer passed full/inline, four themes, wide/narrow desktops, real scrolling, keyboard selection and preview resize checks.');
}

module.exports = { checkRelatedSkillFooter };
