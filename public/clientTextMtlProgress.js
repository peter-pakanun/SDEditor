/* Read-only, request-local MTL progress. Provisional text is never an editor value. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api; else root.ClientTextMtlProgress = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    const labels = Object.freeze({ waiting: 'Waiting for translation', receiving: 'Receiving translation', validating: 'Validating translation',
        reconnecting: 'Waiting for connection', cancelling: 'Stopping translation' });
    function elapsed(state, now = Date.now()) {
        if (!state) return 0;
        return Math.max(0, Number.isFinite(state.elapsedMs) ? state.elapsedMs : 0)
            + Math.max(0, now - (Number.isFinite(state.receivedAt) ? state.receivedAt : now));
    }
    function formatElapsed(value) {
        const seconds = Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) / 1000));
        return seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
    }
    const Preview = {
        props: { state: Object }, emits: ['cancel'],
        data: () => ({ hovered: false, focused: false, pinned: false, dismissed: false, now: Date.now(), x: 8, y: 8 }),
        computed: {
            shown() { return !!this.state && !this.dismissed && (this.hovered || this.focused || this.pinned); },
            phase() { return labels[this.state?.phase] || labels.waiting; },
            duration() { return formatElapsed(elapsed(this.state, this.now)); },
            preview() { return typeof this.state?.text === 'string' ? this.state.text : ''; },
            popupId() { return 'ct-mtl-progress-' + String(this.state?.requestId || '').replace(/[^a-zA-Z0-9_-]/g, ''); },
        },
        watch: {
            state(value, previous) {
                if (value?.requestId !== previous?.requestId) { this.dismissed = false; this.pinned = false; }
                if (value && !this._clock) this._clock = setInterval(() => { this.now = Date.now(); }, 1000);
                if (!value) { clearInterval(this._clock); this._clock = null; this.close(); }
                this.now = Date.now();
            },
            shown(value) {
                if (!value) { this._observer?.disconnect(); return; }
                this.$nextTick(() => {
                    if (!this.shown || !this.$refs.popup) return;
                    this._observer ||= new ResizeObserver(() => this.place()); this._observer.observe(this.$refs.popup); this.place();
                });
            },
        },
        mounted() {
            this._place = () => { if (this.shown) this.place(); };
            root.addEventListener('resize', this._place); root.document.addEventListener('scroll', this._place, true);
            this._outside = event => {
                if (this.pinned && !this.$el.contains(event.target) && !this.$refs.popup?.contains(event.target)) this.close(false);
            };
            root.document.addEventListener('pointerdown', this._outside, true);
            this._pointer = event => this.pointerMove(event);
            root.document.addEventListener('pointermove', this._pointer, true);
            if (this.state) this._clock = setInterval(() => { this.now = Date.now(); }, 1000);
        },
        beforeUpdate() {
            const text = this.$refs.text;
            this._follow = !text || text.scrollHeight - text.scrollTop - text.clientHeight < 20;
        },
        updated() { if (this._follow && this.$refs.text) this.$refs.text.scrollTop = this.$refs.text.scrollHeight; },
        beforeUnmount() {
            if (this.$refs.popup?.contains(root.document.activeElement)) this.$refs.live?.focus({ preventScroll: true });
            clearInterval(this._clock); clearTimeout(this._leave); this._observer?.disconnect();
            root.removeEventListener('resize', this._place); root.document.removeEventListener('scroll', this._place, true);
            root.document.removeEventListener('pointerdown', this._outside, true);
            root.document.removeEventListener('pointermove', this._pointer, true);
        },
        methods: {
            enter() { clearTimeout(this._leave); this.hovered = true; },
            leave() { clearTimeout(this._leave); this._leave = setTimeout(() => { this.hovered = false; }, 120); },
            pointerMove(event) {
                if (!this.state) return;
                const previous = this._pointerPosition;
                this._pointerPosition = [event.clientX, event.clientY];
                if (!this.dismissed || previous && previous[0] === event.clientX && previous[1] === event.clientY) return;
                const inside = this.$el.contains(event.target) || this.$refs.popup?.contains(event.target);
                // Layout changes can generate enter/leave events under a still
                // pointer. Only a moved pointer leaving and returning reopens it.
                if (!inside) this._pointerLeft = true;
                else if (this._pointerLeft) { this._pointerLeft = false; this.dismissed = false; this.enter(); }
            },
            focusIn(event) {
                this.focused = true;
                if (!this._restoringFocus && !this.$el.contains(event?.relatedTarget) && !this.$refs.popup?.contains(event?.relatedTarget)) this.dismissed = false;
            },
            focusOut(event) {
                if (this.$el.contains(event.relatedTarget) || this.$refs.popup?.contains(event.relatedTarget)) return;
                this.focused = false; if (this.pinned) this.close(false);
            },
            async toggle() {
                if (this.pinned && this.shown) { this.close(); return; }
                this.dismissed = false; this.pinned = true; await this.$nextTick();
                this.$refs.text?.focus({ preventScroll: true });
            },
            cancel(event) {
                if (!this.state?.canCancel || this.state.phase === 'cancelling') return;
                // A native button loses focus when disabled. Move it to the
                // stable, read-only preview before the cancellation update.
                if (event?.currentTarget === root.document?.activeElement) this.$refs.text?.focus({ preventScroll: true });
                this.$emit('cancel');
            },
            close(restore = true) {
                const owned = this.$refs.popup?.contains(root.document?.activeElement);
                this.dismissed = true; this.pinned = false; this._pointerLeft = false;
                if (restore && owned) {
                    const anchor = this.state && this.$refs.live?.isConnected ? this.$refs.live : this.$el;
                    this._restoringFocus = true;
                    anchor?.focus({ preventScroll: true });
                    this._restoringFocus = false;
                    // Request cleanup enables Translate in the same Vue update.
                    // Keep focus on the stable wrapper until that button is ready.
                    if (anchor === this.$el) this.$nextTick(() => {
                        if (root.document?.activeElement === this.$el) this.$el.querySelector('.ctMtlButton:not(:disabled)')?.focus({ preventScroll: true });
                    });
                }
            },
            escape(event) { if (this.shown) { event.preventDefault(); event.stopPropagation(); this.close(); } },
            place() {
                if (!this.$refs.popup) return;
                const anchor = this.$el.getBoundingClientRect(), popup = this.$refs.popup.getBoundingClientRect();
                const clamp = (value, max) => Math.max(8, Math.min(value, max));
                this.x = clamp(anchor.right - popup.width, root.innerWidth - popup.width - 8);
                this.y = clamp(anchor.bottom + popup.height + 8 <= root.innerHeight ? anchor.bottom + 6 : anchor.top - popup.height - 6,
                    root.innerHeight - popup.height - 8);
            },
        },
        template: `<span class="ctMtlProgressTarget" tabindex="-1" @mouseenter="enter" @mouseleave="leave" @focusin="focusIn" @focusout="focusOut" @keydown.esc="escape"
          :aria-describedby="shown ? popupId : undefined">
          <slot></slot><button v-if="state" ref="live" class="ctMtlLiveButton" type="button" :aria-expanded="pinned && shown" aria-haspopup="dialog"
            :aria-controls="shown ? popupId : undefined" :aria-label="phase+' · '+duration+' · Open MTL live preview'" @click.stop="toggle">Live</button>
          <teleport to="body"><section v-if="shown" ref="popup" class="ctMtlProgressPopup" data-inline-focus-surface :id="popupId"
            :role="pinned ? 'dialog' : 'tooltip'" :aria-label="pinned ? 'MTL live preview' : undefined" :style="{left:x+'px',top:y+'px'}"
            @mouseenter="enter" @mouseleave="leave" @focusout="focusOut" @keydown.stop @keydown.esc.prevent="close()">
            <header><strong role="status" aria-live="polite">{{ phase }}</strong><span>{{ duration }}</span><button v-if="pinned" type="button" aria-label="Close MTL live preview" @click="close()">×</button></header>
            <p class="ctMtlProvisionalLabel">Working preview · not yet validated</p>
            <pre ref="text" :tabindex="pinned ? 0 : undefined" aria-label="Provisional translation">{{ preview || 'Text will appear as it is received.' }}</pre>
            <p class="ctMtlProgressHelp">This text is incomplete and may change. It is separate from your draft and exports. Review and Save are required after validation.</p>
            <button v-if="pinned && (state.canCancel || state.phase==='cancelling')" type="button" :disabled="state.phase==='cancelling'" @click="cancel($event)">Stop translation</button>
          </section></teleport>
        </span>`,
    };
    return { labels, elapsed, formatElapsed, Preview };
});
