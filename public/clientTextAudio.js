(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ClientTextAudio = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    function normalizeReference(value) {
        if (typeof value !== 'string') return null;
        const path = value.trim().replace(/^Audio\/Dialogue\//i, '');
        if (!path || path.length > 1024 || !/^[a-z0-9_.=/-]+\.(ogg|wav)$/i.test(path)
            || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..' || part !== part.trim())) return null;
        return path.toLowerCase();
    }

    function clipsFor(unit) {
        if (!/^(NPCTextAudio|NPCTalkDialogueTextAudio)(?:_Gender)?$/.test(unit?.sheet || '')) return [];
        const value = unit?.metadata?.['Audio File'];
        if (typeof value !== 'string') return [];
        const clips = [], seen = new Set();
        for (const reference of value.split(',')) {
            const path = normalizeReference(reference);
            if (!path || seen.has(path)) continue;
            seen.add(path);
            clips.push({ path, label: reference.trim().split('/').pop() });
        }
        return clips;
    }

    function audioUrl(path) {
        const reference = normalizeReference(path);
        if (!reference || typeof root.CloudUI?.apiBase !== 'function') return '';
        try { return root.CloudUI.apiBase() + '/audio/poe2db?path=' + encodeURIComponent(reference); }
        catch (_) { return ''; }
    }

    const component = {
        name: 'ClientTextAudio',
        props: { host: Object, surface: { type: String, default: 'both' } },
        data() { return { selectedIndex: 0, request: null, error: '' }; },
        computed: {
            clips() { return clipsFor(this.host.ctCurrentUnit); },
            selectedClip() { return this.clips[this.selectedIndex] || this.clips[0] || null; },
            visible() {
                const host = this.host;
                return host.ctActive && !host.versionChooserVisible && !host.needsInitialSettings && !host.workspaceInitializationActive
                    && !!host.ctCurrentUnit && (this.surface === 'both' ? host.ctEditor
                        : !host.ctEditor && host.inlineEditor && !host.ctInlineClosed);
            },
            contextKey() {
                const host = this.host;
                return JSON.stringify([host.ctWorkspace?.scope, host.cloudProfileId, host.cloudUser?.id, host.managedCatalogScope,
                    host.gameVersion, host.branchId, host.lang, host.ctCurrentUnit?.id, host.ctCurrentUnit?.metadata?.['Audio File']]);
            },
        },
        watch: {
            contextKey: { flush: 'sync', handler() { this.reset(); this.selectedIndex = 0; } },
            visible: { flush: 'sync', handler(value) { if (!value) this.reset(); } },
        },
        beforeUnmount() { this._disposed = true; this.reset(); },
        methods: {
            player() { return Array.isArray(this.$refs.player) ? this.$refs.player[0] : this.$refs.player; },
            reset() {
                const player = this.player();
                this.request = null;
                this.error = '';
                if (player) {
                    player.pause();
                    player.removeAttribute('src');
                    player.load();
                }
            },
            choose(event) { this.reset(); this.selectedIndex = Number(event.target.value); },
            current(request, player) {
                return !this._disposed && this.visible && this.request === request && request.context === this.contextKey
                    && (!player || player === this.player());
            },
            async play() {
                if (!this.visible || !this.selectedClip || this.host.ctBusy) return;
                this.reset();
                const url = audioUrl(this.selectedClip.path);
                if (!url) { this.error = 'Audio is unavailable. Try again.'; return; }
                this._requestSerial = (this._requestSerial || 0) + 1;
                this.request = { url, path: this.selectedClip.path, context: this.contextKey, token: this._requestSerial };
                const request = this.request;
                await this.$nextTick();
                if (!this.current(request)) return;
                const player = this.player();
                if (!player) return;
                try { await player.play(); }
                catch (error) {
                    if (this.current(request, player) && error?.name !== 'AbortError') {
                        this.error = error?.name === 'NotAllowedError' ? 'Use the audio controls to play this clip.' : 'Audio is unavailable. Try again.';
                    }
                }
            },
            failed(event, request) {
                if (this.current(request, event.currentTarget)) this.error = 'Audio is unavailable. Try again.';
            },
            ready(event, request) { if (this.current(request, event.currentTarget)) this.error = ''; },
        },
        template: `<section v-if="clips.length" class="ctDialogueAudio" aria-label="Dialogue audio" @click.stop @dblclick.stop>
            <div class="ctAudioHeading"><strong>Dialogue audio</strong><span v-if="clips.length > 1" class="ctAudioCount">{{ selectedIndex + 1 }} / {{ clips.length }}</span></div>
            <label v-if="clips.length > 1" class="ctAudioClipPicker"><span class="srOnly">Dialogue audio clip</span><select :value="selectedIndex" aria-label="Dialogue audio clip" @change="choose" :disabled="host.ctBusy"><option v-for="(clip,index) in clips" :key="clip.path" :value="index">{{ clip.label }}</option></select></label>
            <span v-else class="ctAudioFilename" :title="selectedClip.label">{{ selectedClip.label }}</span>
            <div class="ctAudioPlayback"><button v-if="!request || error" type="button" class="ctAudioPlay" :disabled="host.ctBusy" :aria-label="(error ? 'Retry dialogue audio: ' : 'Play dialogue audio: ') + selectedClip.label" @click="play">{{ error ? 'Try again' : 'Play audio' }}</button>
            <template v-for="active in request ? [request] : []" :key="active.token"><audio ref="player" :src="active.url" controls preload="none" tabindex="0" :aria-label="'Dialogue audio: '+selectedClip.label" @error="failed($event,active)" @canplay="ready($event,active)"></audio></template></div>
            <small v-if="error" class="ctAudioError" role="status">{{ error }}</small>
        </section>`,
    };
    return { normalizeReference, clipsFor, audioUrl, component };
});
