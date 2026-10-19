/* Public font reads are separate from authenticated image/audio resources. */
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
                return JSON.stringify([this.gamePreviewFontFamily, this.gamePreviewSourceFontFamily]);
            }
        },
        watch: {
            previewFontsKey: { immediate: true, flush: 'sync', handler() { this.previewFontsRefresh(); } }
        },
        mounted() {
            this._previewFontOnline = () => this.previewFontsRefresh();
            root.addEventListener?.('online', this._previewFontOnline);
        },
        beforeUnmount() {
            this.previewFontsClear(); this._previewFontCache = null;
            root.removeEventListener?.('online', this._previewFontOnline);
        },
        methods: {
            previewFontsClear() {
                this._previewFontEpoch = (this._previewFontEpoch || 0) + 1;
                for (const face of this._previewFontFaces || []) root.document.fonts.delete(face);
                this._previewFontFaces = [];
            },
            previewFontsRefresh() {
                this.previewFontsClear();
                if (!root.FontFace || !root.document?.fonts) return;
                const epoch = this._previewFontEpoch, cache = this._previewFontCache ||= new Map();
                const base = root.CloudUI.apiBase();
                const families = new Set((this.gamePreviewFontFamily + ',' + this.gamePreviewSourceFontFamily)
                    .split(',').map(value => value.trim().replace(/^['"]|['"]$/g, '').toLowerCase()));
                this._previewFontsReady = Promise.all(faces.filter(([, names]) => names.some(name => families.has(name.toLowerCase()))).map(async ([filename, names, descriptors]) => {
                    const url = base + '/fonts/' + filename;
                    try {
                        // Native CORS font requests carry no bearer token and use
                        // normal HTTP caching in signed-out and local/test sessions.
                        if (!cache.has(url)) cache.set(url, Promise.all(names.map(name => new root.FontFace(name, 'url("' + url + '")', { style: 'normal', weight: '400', display: 'swap', ...descriptors }).load())));
                        const loaded = await cache.get(url);
                        if (epoch !== this._previewFontEpoch) return;
                        for (const face of loaded) { root.document.fonts.add(face); this._previewFontFaces.push(face); }
                    } catch (_) {
                        cache.delete(url); // A later online event can retry failures.
                    }
                }));
            }
        }
    };
    root.PreviewFonts = { mixin };
})(typeof window !== 'undefined' ? window : globalThis);
