/* Private preview faces share the authenticated media loader and scope guard. */
(function (root) {
    'use strict';
    const faces = [
        ['Fontin-Regular.woff2', ['Fontin'], { weight: '400' }],
        ['Fontin-Bold.woff2', ['Fontin'], { weight: '700' }],
        ['Fontin-Italic.woff2', ['Fontin'], { weight: '400', style: 'italic' }],
        ['Fontin-SmallCaps.woff2', ['Fontin Smallcaps'], {}],
        ['FrizQuadrataITC.woff2', ['FrizQuadrataITC', 'Friz Quadrata ITC', 'Friz Quadrata'], {}],
        ['FrizQuadrataStd.woff2', ['FrizQuadrataStd'], {}],
        ['Koruri-Regular.woff2', ['Koruri Regular', 'Koruri'], {}],
        ['Fontin-SmallCaps-tr-TR.ttf', ['Fontin-SmallCaps-tr-TR'], {}],
        ['OptimusPrincepsSemiBold-tr-TR.ttf', ['OptimusPrincepsSemiBold-tr-TR'], {}],
    ];
    const mixin = {
        computed: {
            previewFontsKey() {
                return JSON.stringify([this.privateMediaKey, this.gamePreviewFontFamily, this.gamePreviewSourceFontFamily]);
            }
        },
        watch: {
            previewFontsKey: { immediate: true, flush: 'sync', handler() { this.previewFontsRefresh(); } }
        },
        beforeUnmount() { this.previewFontsClear(); },
        methods: {
            previewFontsClear() {
                this._previewFontEpoch = (this._previewFontEpoch || 0) + 1;
                this._previewFontAbort?.abort();
                for (const face of this._previewFontFaces || []) root.document.fonts.delete(face);
                this._previewFontFaces = [];
            },
            previewFontsRefresh() {
                this.previewFontsClear();
                if (!this.privateMediaAllowed || !root.FontFace || !root.document?.fonts) return;
                let context;
                try { context = this.privateMediaContext(); } catch (_) { return; }
                const epoch = this._previewFontEpoch, controller = new root.AbortController();
                this._previewFontAbort = controller;
                const families = new Set((this.gamePreviewFontFamily + ',' + this.gamePreviewSourceFontFamily)
                    .split(',').map(value => value.trim().replace(/^['"]|['"]$/g, '').toLowerCase()));
                const current = () => epoch === this._previewFontEpoch && !controller.signal.aborted && this.privateMediaCurrent(context);
                this._previewFontsReady = Promise.all(faces.filter(([, names]) => names.some(name => families.has(name.toLowerCase()))).map(async ([filename, names, descriptors]) => {
                    let lease;
                    try {
                        lease = await this.privateMediaLoad('/fonts/' + filename, 'font', { context, signal: controller.signal });
                        const loaded = await Promise.all(names.map(name => new root.FontFace(name, 'url("' + lease.url + '")', { style: 'normal', weight: '400', display: 'swap', ...descriptors }).load()));
                        if (!current()) return;
                        for (const face of loaded) { root.document.fonts.add(face); this._previewFontFaces.push(face); }
                    } catch (_) {
                        // Keep the language's CSS fallbacks; never persist private bytes.
                    } finally { lease?.release(); }
                }));
            }
        }
    };
    root.PreviewFonts = { mixin };
})(typeof window !== 'undefined' ? window : globalThis);
