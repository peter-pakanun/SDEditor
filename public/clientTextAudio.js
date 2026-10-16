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
            if (!path || /(?:^|\/)nullfile\//.test(path) || seen.has(path)) continue;
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

    function previewSegments(segments, clips) {
        if (!Array.isArray(segments) || !clips?.length) return segments;
        const blocks = [[]];
        for (const segment of segments) {
            if (segment.type === 'continue') blocks.push([]);
            else blocks.at(-1).push(segment);
        }
        const spoken = blocks.map((block,index) => block.some(segment => segment.type === 'var' || segment.type === 'kw'
            || segment.type === 'text' && String(segment.text || '').trim()) ? index : -1).filter(index => index >= 0);
        if (!spoken.length) spoken.push(blocks.length - 1);
        const result = [], separators = segments.filter(segment => segment.type === 'continue');
        let nextTrack = 0;
        blocks.forEach((block,index) => {
            const tracks = [];
            if (spoken.includes(index) && nextTrack < clips.length) {
                const end = index === spoken.at(-1) ? clips.length : nextTrack + 1;
                while (nextTrack < end) tracks.push(nextTrack++);
            }
            let end = block.length;
            while (end && (block[end - 1].type === 'break' || block[end - 1].type === 'text' && !String(block[end - 1].text || '').trim())) end--;
            result.push(...block.slice(0,end));
            if (tracks.length) result.push({ type:'playback', tracks });
            result.push(...block.slice(end));
            if (separators[index]) result.push(separators[index]);
        });
        return result;
    }

    let playbackOwner = null;

    const component = {
        name: 'ClientTextAudio',
        props: { host: Object, surface: { type: String, default: 'both' } },
        data() { return { selectedIndex: 0, request: null, error: '', trackErrors: {}, playbackState: 'idle', footerHeight: 110 }; },
        computed: {
            clips() { return clipsFor(this.host.ctCurrentUnit); },
            selectedClip() { return this.clips[this.selectedIndex] || this.clips[0] || null; },
            visible() {
                const host = this.host;
                return host.ctActive && !host.versionChooserVisible && !host.needsInitialSettings && !host.workspaceInitializationActive
                    && !host.settingsDialogVisible && !host.showSetting
                    && !!host.ctCurrentUnit && (this.surface === 'both' ? host.ctEditor
                        : !host.ctEditor && host.inlineEditor);
            },
            contextKey() {
                const host = this.host;
                return JSON.stringify([host.ctWorkspace?.scope, host.cloudProfileId, host.cloudUser?.id, host.managedCatalogScope,
                    host.gameVersion, host.branchId, host.lang, host._ctEpoch, host.ctSelection, host.ctCurrentUnit?.role,
                    host.ctCurrentUnit?.sheet, host.ctCurrentUnit?.id, host.ctCurrentUnit?.metadata?.['Audio File']]);
            },
        },
        watch: {
            contextKey: { flush: 'sync', handler() { this.reset(true); this.selectedIndex = 0; } },
            visible: { flush: 'sync', handler(value) { if (!value) this.reset(true); } },
            surface: { flush:'sync', handler() { this.reset(true); } },
            'host.ctInlineClosed': { flush:'sync', handler(value) { if (value) this.reset(true); } },
        },
        mounted() {
            this.host.ctAudioController = root.Vue?.markRaw ? root.Vue.markRaw(this) : this;
            this.measureFooter();
            this._audioResize = () => this.measureFooter();
            root.addEventListener?.('resize', this._audioResize);
        },
        beforeUnmount() {
            this._disposed = true;
            this.reset(true);
            if (this.host.ctAudioController === this) this.host.ctAudioController = null;
            this._footerObserver?.disconnect();
            root.removeEventListener?.('resize', this._audioResize);
        },
        methods: {
            showTooltip(event, text) { this.host.showTooltip?.(event, text); },
            hideTooltip() { this.host.hideTooltip?.(); },
            measureFooter() {
                const footer = Array.from(root.document?.querySelectorAll('.workspaceFooter') || [])
                    .find(element => element.getBoundingClientRect().height > 0);
                if (footer) this.footerHeight = footer.getBoundingClientRect().height;
                if (footer !== this._observedFooter) {
                    this._footerObserver?.disconnect();
                    this._observedFooter = footer;
                    if (footer && root.ResizeObserver) {
                        this._footerObserver = new root.ResizeObserver(() => this.measureFooter());
                        this._footerObserver.observe(footer);
                    }
                }
            },
            player() { return Array.isArray(this.$refs.player) ? this.$refs.player[0] : this.$refs.player; },
            trackButton() {
                if (this._originButton?.isConnected !== false && this._originButton?.getAttribute?.('data-audio-path') === this.selectedClip?.path) return this._originButton;
                for (const controls of this._controls || []) {
                    const button = Array.from(controls.$el?.querySelectorAll?.('.ctAudioTrack') || [])
                        .find(button => button.getAttribute('data-audio-path') === this.selectedClip?.path);
                    if (button) return button;
                }
                return this.$el?.querySelectorAll?.('.ctAudioTrack')[this.selectedIndex];
            },
            holdTrackFocus(event, request) {
                const button = event?.currentTarget;
                if (button) this._originButton = button;
                if (root.document?.activeElement === button) this.holdFocus(button, request);
            },
            holdPlayerFocus(request) {
                const player = this.player(), active = root.document?.activeElement;
                if (active !== player && !player?.closest?.('.ctAudioFloating')?.contains(active)) return;
                const button = this.trackButton();
                this.holdFocus(button, request);
            },
            holdFocus(button, request) {
                const wrapper = button?.closest?.('.ctAudioTrackTarget');
                if (!wrapper?.focus) return;
                wrapper.focus({ preventScroll: true });
                this._trackFocus = { request, button, wrapper };
            },
            async releaseTrackFocus(request) {
                const held = this._trackFocus;
                if (!held || held.request !== request) return;
                await this.$nextTick();
                if (this._trackFocus !== held || !this.current(request) || this.playbackState === 'loading') return;
                this._trackFocus = null;
                if (root.document?.activeElement === held.wrapper && held.button.isConnected !== false && !held.button.disabled) {
                    held.button.focus({ preventScroll: true });
                }
            },
            cancelDiagnosis() {
                this._diagnosis?.controller?.abort();
                if (this._diagnosis?.timer != null) root.clearTimeout?.(this._diagnosis.timer);
                this._diagnosis = null;
            },
            reset(clearErrors = false) {
                const player = this.player();
                this.request = null;
                this._trackFocus = null;
                this._originButton = null;
                this.error = '';
                this.playbackState = 'idle';
                if (clearErrors) this.trackErrors = {};
                if (playbackOwner === this) playbackOwner = null;
                this.cancelDiagnosis();
                this.hideTooltip();
                if (player) {
                    player.pause();
                    player.removeAttribute('src');
                    player.load();
                }
            },
            trackState(index) {
                const clip = this.clips[index];
                if (this.request?.path === clip?.path) return this.playbackState;
                return clip && this.trackErrors[clip.path] ? 'error' : 'idle';
            },
            trackTooltip(clip, index) {
                const state = this.trackState(index);
                if (state === 'loading') return (this.request?.started ? 'Buffering ' : 'Loading ') + clip.label;
                if (state === 'playing') return 'Stop ' + clip.label;
                if (state === 'error') return clip.label + ': ' + (this.trackErrors[clip.path] || this.error) + ' Click to retry.';
                return 'Play ' + clip.label;
            },
            current(request, player) {
                return !this._disposed && this.visible && this.request === request && request.context === this.contextKey
                    && (!player || player === this.player());
            },
            async play(index = this.selectedIndex, event) {
                const clip = this.clips[index];
                if (!this.visible || !clip || this.host.ctBusy || this.trackState(index) === 'loading') return;
                if (this.request?.path === clip.path && this.playbackState === 'playing') { this.reset(); return; }
                if (playbackOwner && playbackOwner !== this) playbackOwner.reset();
                if (this.request?.path === clip.path && this.playbackState === 'idle') {
                    this.holdTrackFocus(event, this.request);
                    this.playbackState = 'loading';
                    playbackOwner = this;
                    this.hideTooltip();
                    await this.start(this.request);
                    return;
                }
                this.reset();
                this.selectedIndex = index;
                delete this.trackErrors[clip.path];
                const url = audioUrl(clip.path);
                if (!url) {
                    this.error = this.trackErrors[clip.path] = 'Audio is unavailable.';
                    this.playbackState = 'error';
                    return;
                }
                this._requestSerial = (this._requestSerial || 0) + 1;
                this.request = { url, path: clip.path, label: clip.label, context: this.contextKey, token: this._requestSerial, started: false };
                const request = this.request;
                this.holdTrackFocus(event, request);
                this.playbackState = 'loading';
                this.hideTooltip();
                playbackOwner = this;
                this.measureFooter();
                await this.$nextTick();
                await this.start(request);
            },
            async start(request) {
                if (!this.current(request)) return;
                const player = this.player();
                if (!player) { this.setFailure(request, 'The audio player is unavailable.'); return; }
                try { await player.play(); }
                catch (error) {
                    if (!this.current(request, player) || request.diagnosing || error?.name === 'AbortError') return;
                    this.setFailure(request, error?.name === 'NotAllowedError'
                        ? 'Playback was blocked by the browser.' : 'Audio is unavailable.');
                }
            },
            setFailure(request, detail) {
                if (!this.current(request)) return;
                this.holdPlayerFocus(request);
                this.playbackState = 'error';
                this.error = this.trackErrors[request.path] = detail;
                this.player()?.pause();
                this.hideTooltip();
                return this.releaseTrackFocus(request);
            },
            failed(event, request) {
                const player = event.currentTarget;
                if (!this.current(request, player) || request.diagnosing) return;
                const code = player.error?.code;
                const detail = code === 2 ? 'The audio could not be downloaded.' : code === 3 ? 'The audio could not be decoded.'
                    : code === 4 ? 'The audio is unavailable or its format is unsupported.' : 'Audio is unavailable.';
                this.setFailure(request, detail);
                return this.diagnoseFailure(request, player);
            },
            async diagnoseFailure(request, player) {
                if (typeof root.fetch !== 'function' || !this.current(request, player)) return;
                this.cancelDiagnosis();
                request.diagnosing = true;
                const controller = root.AbortController ? new root.AbortController() : null;
                const diagnosis = this._diagnosis = { controller, timer: null };
                if (controller && root.setTimeout) diagnosis.timer = root.setTimeout(() => controller.abort(), 5000);
                try {
                    const response = await root.fetch(request.url, { method: 'HEAD', credentials: 'omit', ...(controller ? { signal: controller.signal } : {}) });
                    if (this._diagnosis === diagnosis && this.current(request, player) && !response.ok) {
                        this.setFailure(request, 'Audio request failed (HTTP ' + response.status + ').');
                    }
                } catch (_) { /* The native media error remains useful when HEAD or CORS fails. */ }
                finally {
                    if (diagnosis.timer != null) root.clearTimeout?.(diagnosis.timer);
                    if (this._diagnosis === diagnosis) this._diagnosis = null;
                }
            },
            playing(event, request) {
                if (!this.current(request, event.currentTarget)) return;
                request.started = true;
                this.cancelDiagnosis();
                request.diagnosing = false;
                this.playbackState = 'playing';
                this.error = '';
                delete this.trackErrors[request.path];
                this.hideTooltip();
                return this.releaseTrackFocus(request);
            },
            waiting(event, request) {
                if (!this.current(request, event.currentTarget) || this.playbackState === 'error') return;
                if (event.currentTarget.paused && this.playbackState === 'idle') return;
                this.holdPlayerFocus(request);
                this.playbackState = 'loading';
                this.hideTooltip();
            },
            stalled(event, request) {
                const player = event.currentTarget;
                if (this.current(request, player) && !player.paused && player.readyState < 3) this.waiting(event, request);
            },
            paused(event, request) {
                if (!this.current(request, event.currentTarget) || this.playbackState === 'error') return;
                this.holdPlayerFocus(request);
                this.playbackState = 'idle';
                this.hideTooltip();
                return this.releaseTrackFocus(request);
            },
            ended(event, request) {
                if (!this.current(request, event.currentTarget)) return;
                this.holdPlayerFocus(request);
                const held = this._trackFocus;
                if (held && root.document?.activeElement === held.wrapper && !held.button.disabled) held.button.focus({ preventScroll: true });
                this.reset();
            },
        },
        template: `<span class="ctAudioSession">
            <span class="srOnly" role="status" aria-live="polite">{{ error }}</span>
            <teleport to="body"><div v-show="playbackState === 'playing'" class="ctAudioFloating" :class="{ctAudioFloatingFull:surface === 'both'}" :style="{'--ct-audio-footer-height':footerHeight+'px'}" data-inline-focus-surface @focusout="host.ctInlineFocusOut?.($event)" @click.stop @dblclick.stop>
                <template v-for="active in request ? [request] : []" :key="active.token"><audio ref="player" :src="active.url" controls preload="none" tabindex="0" :aria-label="'Dialogue audio: '+active.label" @error="failed($event,active)" @playing="playing($event,active)" @waiting="waiting($event,active)" @stalled="stalled($event,active)" @pause="paused($event,active)" @ended="ended($event,active)"></audio></template>
            </div></teleport>
        </span>`,
    };
    const controlsComponent = {
        name:'ClientTextAudioControls',
        props:{host:Object,indices:{type:Array,default:null},preview:Boolean},
        computed:{
            session() { return this.host.ctAudioController || null; },
            tracks() {
                const clips=this.session?.clips || [];
                return (this.indices || clips.map((_,index)=>index)).filter(index=>clips[index]).map(index=>({index,clip:clips[index]}));
            },
        },
        watch:{session:{immediate:true,handler(next,previous) {
            previous?._controls?.delete(this);
            if(next){next._controls ||= new Set();next._controls.add(this);}
        }}},
        beforeUnmount() { this.session?._controls?.delete(this); },
        methods:{
            showTooltip(event,text) { this.host.showTooltip?.(event,text); },
            hideTooltip() { this.host.hideTooltip?.(); },
        },
        template:`<span v-if="tracks.length" :class="preview ? 'ctPreviewAudioControls' : 'ctDialogueAudio'" role="group" aria-label="Dialogue audio" data-inline-focus-surface @focusout="host.ctInlineFocusOut?.($event)" @click.stop @dblclick.stop>
            <span v-for="track in tracks" :key="track.clip.path" class="ctAudioTrackTarget" :tabindex="session.trackState(track.index) === 'loading' ? 0 : -1" :title="session.trackTooltip(track.clip,track.index)" :aria-label="session.trackTooltip(track.clip,track.index)" v-tooltip="session.trackTooltip(track.clip,track.index)">
                <button type="button" class="ctAudioTrack" :data-audio-path="track.clip.path" :data-audio-index="track.index" :class="{active:session.trackState(track.index) === 'playing',loading:session.trackState(track.index) === 'loading',error:session.trackState(track.index) === 'error'}" :disabled="host.ctBusy || !session.visible || session.trackState(track.index) === 'loading'" :aria-label="session.trackTooltip(track.clip,track.index)" :aria-pressed="session.trackState(track.index) === 'playing'" :aria-busy="session.trackState(track.index) === 'loading'" @click="session.play(track.index,$event)">
                    <span v-if="session.trackState(track.index) === 'loading'" class="spinner ctAudioSpinner" aria-hidden="true"></span>
                    <svg v-else class="ctAudioSpeakIcon" aria-hidden="true" viewBox="0 0 24 24"><path d="M6 2c.5 1.3 1.3 2.7 1.1 3.9-.1 1-.7 2-.6 2.8.1.8 1 1.6 1.3 2.5.2.8-.9 1-1.4 1.3-.5.3-.6.7-.2 1.2.5.5.9.6 1 1 .1.5-.8.5-.9.9.1.5.8.5.8 1.1.1.9-.4 1.9-1.3 2.1-.9.2-1.9-.1-2.6.2-.8.4-1.3 1.7-1.8 3"></path><path d="M11.4 10.5a4.1 4.1 0 0 1 0 5.8M14.9 8a7.7 7.7 0 0 1 0 10.8M18.4 5.5a11.3 11.3 0 0 1 0 15.8"></path></svg>
                </button>
            </span>
        </span>`,
    };
    return { normalizeReference, clipsFor, audioUrl, previewSegments, component, controlsComponent };
});
