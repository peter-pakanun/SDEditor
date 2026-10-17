/* Admin request inspection is read-only and session-local. No inference on open. */
(function (root, factory) {
    const api = factory(root, typeof module === 'object' && module.exports ? require('./clientTextMtlTiming.js') : root.ClientTextMtlTiming);
    if (typeof module === 'object' && module.exports) module.exports = api; else root.ClientTextMtlDebug = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, Timing) {
    'use strict';
    const raw = value => root.Vue?.markRaw ? root.Vue.markRaw(value) : value;
    const allowed = host => host.cloudSignedIn === true && host.cloudUser?.isAdmin === true && host.cloudUser.role === 'admin'
        && typeof host.cloudUser.id === 'string' && !!host.cloudUser.id && host.cloudUser.id === host.cloudProfileId
        && host.cloudUser.id === host.ctWorkspace?.scope?.accountId && !!host._cloud && !host._cloud.destroyed;
    function redact(value, depth = 0) {
        if (depth > 20) return '[truncated]';
        if (typeof value === 'string') return value.slice(0, 196608)
            .replace(/\bBearer\s+[^\s"\\,}]+/gi, 'Bearer [redacted]')
            .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
            .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
            .replace(/(["']?(?:authorization|cookie|set-cookie|password|secret|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|session[_-]?(?:id|token))["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1[redacted]');
        if (Array.isArray(value)) return value.slice(0, 64).map(item => redact(item, depth + 1));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, item]) => [key,
            /^(?:authorization|proxy-authorization|cookie|set-cookie|password|secret|credentials?|(?:access|refresh|id)[_-]?token|api[_-]?key|session(?:id|token)?)$/i.test(key) ? '[redacted]' : redact(item, depth + 1)]));
        return value === null || ['boolean', 'number'].includes(typeof value) ? value : null;
    }
    function streamDetails(summary) {
        if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return undefined;
        const kinds = ['missing', 'null', 'array', 'object', 'string', 'number', 'boolean', 'other'];
        const events = ['response.created', 'response.queued', 'response.in_progress', 'response.completed', 'response.failed', 'response.incomplete', 'error',
            'response.output_item.added', 'response.output_item.done', 'response.content_part.added', 'response.content_part.done',
            'response.output_text.delta', 'response.output_text.done', 'response.refusal.delta', 'response.refusal.done',
            'response.reasoning_text.delta', 'response.reasoning_text.done', 'response.reasoning_summary_text.delta', 'response.reasoning_summary_text.done',
            'response.reasoning_summary_part.added', 'response.reasoning_summary_part.done'];
        const known = (value, allowed) => typeof value === 'string' && [...allowed, 'missing', 'null', 'other'].includes(value) ? value : 'other';
        const result = {};
        for (const field of ['events', 'outputItems', 'outputTextCharacters', 'textDeltaEvents', 'textDoneEvents', 'contentPartDoneEvents', 'outputItemDoneEvents'])
            result[field] = Number.isSafeInteger(summary[field]) && summary[field] >= 0 && summary[field] <= 2 * 1024 * 1024 ? summary[field] : null;
        for (const field of ['completedEventSeen', 'outputItemsTruncated', 'contentPartsTruncated', 'reconstructedOutput']) result[field] = summary[field] === true;
        for (const [field, allowed] of Object.entries({ eventKind: kinds, eventType: events, eventTypeKind: kinds, sseEventType: events,
            responseKind: kinds, responseStatus: ['completed', 'failed', 'in_progress', 'cancelled', 'queued', 'incomplete'], outputKind: kinds }))
            result[field] = known(summary[field], allowed);
        for (const [field, allowed] of Object.entries({ outputItemTypes: ['message', 'reasoning', 'function_call', 'custom_tool_call'],
            contentTypes: ['output_text', 'refusal', 'not-array'], textValueTypes: kinds }))
            result[field] = Array.isArray(summary[field]) ? summary[field].slice(0, 16).map(value => known(value, allowed)) : [];
        return result;
    }
    // A labeled selection of actual fields, not a raw transport dump. Preserve
    // quoted prompt/workbook/response text; omit connection configuration.
    function present(record) {
        const server = record.server, snapshot = record.snapshot || {}, request = server?.providerRequest;
        let upstreamResponse;
        const metadata = server?.upstreamResponse;
        if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
            upstreamResponse = { contentType: typeof metadata.contentType === 'string' ? metadata.contentType.slice(0, 256) : null };
            for (const field of ['hasBody', 'readableBody', 'bodyUsed', 'bodyLocked', 'redirected'])
                if (typeof metadata[field] === 'boolean') upstreamResponse[field] = metadata[field];
            if (['basic', 'cors', 'default', 'error', 'opaque', 'opaqueredirect', 'unknown'].includes(metadata.responseType)) upstreamResponse.responseType = metadata.responseType;
        }
        const value = { requestId: record.requestId, status: server?.status || record.status,
            scope: server?.scope || snapshot.scope, unit: snapshot.unit || (server?.unitId ? { id: server.unitId } : undefined),
            field: snapshot.field || server?.field, source: server?.source ?? snapshot.source, language: server?.language || snapshot.language,
            context: server?.context || snapshot.context, inferenceSettings: server?.inferenceSettings || snapshot.inferenceSettings,
            ...(request ? { prompt: { instructions: request.instructions, messages: request.input } } : {}),
            ...(server && Object.hasOwn(server, 'response') ? { response: server.response ? { translation: server.response.translation } : null } : {}), lookup: server?.lookup,
            validation: server?.validation, failureReason: server?.failureReason, failureStage: server?.failureStage,
            validationReason: server?.validationReason, protocolCheck: server?.protocolCheck, protocolExplanation: server?.protocolExplanation,
            upstreamStatus: server?.upstreamStatus, upstreamResponse, streamSummary: streamDetails(server?.streamSummary), apiStatus: server?.apiStatus,
            startedAt: server?.startedAt ?? record.submittedAt, sentAt: server?.sentAt, finishedAt: server?.finishedAt,
            elapsedMs: server?.elapsedMs ?? record.elapsedMs, error: server?.error || record.error };
        return redact(Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)));
    }
    function sectionText(record,section){
        if(!['prompt','context'].includes(section))return '';
        const value=present(record)[section];return value===undefined?'':JSON.stringify(value,null,2);
    }
    const mixin = {
        data: () => ({ ctMtlDebugWindow: null, ctMtlDebugRecords: raw({}) }),
        computed: {
            ctMtlDebugAllowed() { return allowed(this); },
            ctMtlDebugOrigin() {
                return JSON.stringify([this.ctActive, this.ctWorkspace?.scope, this.ctSelection, this.lang, this.gameVersion,
                    this.cloudSignedIn, this.cloudProfileId, this.cloudUser?.id, this.cloudUser?.role, this.cloudUser?.isAdmin,
                    this.cloudUser?.assignmentVersion, this.cloudUser?.language, this._cloud?.epoch,
                    this.ctCurrentUnit?.fields.map(field => [field.id, field.source])]);
            },
        },
        watch: { ctMtlDebugOrigin() { this.ctMtlDebugReset(); } },
        beforeUnmount() { this.ctMtlDebugReset(); },
        methods: {
            ctMtlDebugReset() { for(const info of this._ctMtlTimingRuns?.values()||[])for(const frame of info.frames||[])root.cancelAnimationFrame?.(frame); this._ctMtlTimingRuns?.clear(); this._ctMtlDebugLoad?.abort(); this._ctMtlDebugLoad = null; this.ctMtlDebugWindow = null; this.ctMtlDebugRecords = raw({}); },
            ctMtlDebugClose() {
                const anchor = this.ctMtlDebugWindow?.anchor;
                this._ctMtlDebugLoad?.abort(); this.ctMtlDebugWindow = null;
                if (anchor?.isConnected) anchor.focus({ preventScroll: true });
            },
            ctMtlDebugTimingStart(field) {
                if(!allowed(this)||!this.ctActive||!this.ctCurrentUnit?.fields.includes(field)||this.ctMtlBusy?.(field))return null;
                const runs=this._ctMtlTimingRuns ||=new Map(),origin=this.ctMtlDebugOrigin,unit=this.ctCurrentUnit;
                const previous=runs.get(field.id);if(previous?.timing.snapshot().outcome==='running')return null;
                if(previous)for(const frame of previous.frames)root.cancelAnimationFrame?.(frame);
                runs.delete(field.id);
                while(runs.size>=32){const oldest=runs.keys().next().value,info=runs.get(oldest);for(const frame of info.frames)root.cancelAnimationFrame?.(frame);runs.delete(oldest);
                    const records={...this.ctMtlDebugRecords};delete records[oldest];this.ctMtlDebugRecords=raw(records);}
                let info;
                const current=()=>allowed(this)&&origin===this.ctMtlDebugOrigin&&runs.get(field.id)===info;
                const publish=()=>{if(!info||!current())return;const before=this.ctMtlDebugRecords[field.id];if(!before||before.origin!==origin)return;
                    const record={...before,browserTiming:info.timing.snapshot()};this.ctMtlDebugRecords=raw({...this.ctMtlDebugRecords,[field.id]:record});
                    if(this.ctMtlDebugWindow?.fieldId===field.id)this.ctMtlDebugWindow={...this.ctMtlDebugWindow,record};};
                const timing=Timing?.create({...(this._ctMtlTimingNow?{now:this._ctMtlTimingNow}:{}),onChange:publish});if(!timing)return null;
                info={timing,origin,unit,frames:new Set(),scheduled:new Set(),current};runs.set(field.id,info);
                this.ctMtlDebugRecords=raw({...this.ctMtlDebugRecords,[field.id]:{origin,status:'preparing',submittedAt:Date.now(),snapshot:this.ctMtlDebugSnapshot(field),browserTiming:timing.snapshot()}});
                publish();return timing;
            },
            ctMtlDebugTimingBind(timing,field,requestId){
                const info=this._ctMtlTimingRuns?.get(field.id);if(!timing||info?.timing!==timing||!info.current())return;
                const record={...this.ctMtlDebugRecords[field.id],requestId};this.ctMtlDebugRecords=raw({...this.ctMtlDebugRecords,[field.id]:record});
                if(this.ctMtlDebugWindow?.fieldId===field.id)this.ctMtlDebugWindow={...this.ctMtlDebugWindow,record};
            },
            ctMtlDebugTimingFrame(timing,name,fieldId,requireText=false){
                const info=this._ctMtlTimingRuns?.get(fieldId);if(!timing||info?.timing!==timing||!info.current()||info.scheduled.has(name)||timing.snapshot().milestonesMs[name]!==null||!root.requestAnimationFrame)return;
                info.scheduled.add(name);
                this.$nextTick?.(()=>{if(!info.current()||root.document?.hidden){info.scheduled.delete(name);return;}
                    const frame=root.requestAnimationFrame(()=>{info.frames.delete(frame);info.scheduled.delete(name);if(!info.current()||root.document?.hidden)return;
                        const element=this.ctDictionaryTarget?.(fieldId),container=element?.closest?.('.ctTarget');
                        if(!element?.getClientRects?.().length||requireText&&!container?.querySelector('.ctMtlStreamText')?.textContent)return;
                        timing.mark(name);
                    });info.frames.add(frame);
                });
            },
            ctMtlDebugSnapshot(field, context) {
                const unit = this.ctCurrentUnit;
                return redact({ scope: this.ctWorkspace.scope, unit: { id: unit.id, sheet: unit.sheet, recordId: unit.recordId, role: unit.role },
                    field: { id: field.id, name: field.name, kind: field.kind, form: field.form || null }, source: field.source,
                    language: this.ctWorkspace.scope.language, context });
            },
            ctMtlDebugBegin(field, body, timing) {
                if (!allowed(this)) return;
                const record = { requestId: body.requestId, origin: this.ctMtlDebugOrigin, submittedAt: Date.now(),
                    snapshot: {...this.ctMtlDebugSnapshot(field, body.context), inferenceSettings: body.inferenceSettings ? {...body.inferenceSettings} : {version:'mtl-inference-settings-v1',model:'gpt-6-luna',effort:'xhigh'}}, status: 'submitted', server: null,
                    ...(timing ? {browserTiming:timing.snapshot()} : {}) };
                this.ctMtlDebugRecords = raw({ ...this.ctMtlDebugRecords, [field.id]: record });
                if (this.ctMtlDebugWindow?.fieldId === field.id) this.ctMtlDebugWindow = { ...this.ctMtlDebugWindow, record };
            },
            async ctMtlDebugFinish(field, requestId, error) {
                const before = this.ctMtlDebugRecords[field.id];
                if (!allowed(this) || before?.requestId !== requestId || before.origin !== this.ctMtlDebugOrigin) return;
                const record = { ...before, status: error ? 'failed or uncertain' : 'completed', elapsedMs: Date.now() - before.submittedAt,
                    ...(error ? { error: { code: /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'MTL_REQUEST_FAILED' } } : {}) };
                this.ctMtlDebugRecords = raw({ ...this.ctMtlDebugRecords, [field.id]: record });
                if (this.ctMtlDebugWindow?.fieldId === field.id) {
                    this.ctMtlDebugWindow = { ...this.ctMtlDebugWindow, record }; await this.ctMtlDebugLoad();
                }
            },
            async ctMtlDebugOpen(field, event) {
                if (!allowed(this) || !this.ctActive || !this.ctCurrentUnit?.fields.includes(field)) return false;
                let record = this.ctMtlDebugRecords[field.id];
                if (!record || record.origin !== this.ctMtlDebugOrigin) {
                    try { record = { status: 'preview', snapshot: this.ctMtlDebugSnapshot(field, this.ctMtlBuildContext(field).initial) }; }
                    catch (_) { record = { status: 'preview', error: { code: 'CONTEXT_UNAVAILABLE' } }; }
                }
                this.ctMtlDebugWindow = { fieldId: field.id, anchor: event?.currentTarget, record, loading: false, error: '' };
                if (record.requestId) await this.ctMtlDebugLoad();
                return true;
            },
            async ctMtlDebugLoad() {
                const window = this.ctMtlDebugWindow;
                if (!allowed(this) || !window?.record.requestId) return;
                this._ctMtlDebugLoad?.abort(); const controller = this._ctMtlDebugLoad = new AbortController(),
                    origin = this.ctMtlDebugOrigin, client = this._cloud, requestId = window.record.requestId;
                const current = () => allowed(this) && !controller.signal.aborted && this._cloud === client && origin === this.ctMtlDebugOrigin
                    && this.ctMtlDebugWindow?.fieldId === window.fieldId && this.ctMtlDebugWindow?.record.requestId === requestId;
                this.ctMtlDebugWindow = { ...window, loading: true };
                try {
                    const result = await client.request('/v1/admin/mtl/requests/' + encodeURIComponent(requestId) + '/debug', { signal: controller.signal });
                    if (!current()) return;
                    const record = { ...this.ctMtlDebugWindow.record, server: redact(result.diagnostics) };
                    this.ctMtlDebugRecords = raw({ ...this.ctMtlDebugRecords, [window.fieldId]: record });
                    this.ctMtlDebugWindow = { ...this.ctMtlDebugWindow, record, error: '' };
                } catch (error) {
                    if (current()) this.ctMtlDebugWindow = { ...this.ctMtlDebugWindow, error: error.status === 403 ? 'Administrator access is required.'
                        : 'Server diagnostics are unavailable or expired. The submitted browser context is shown below.' };
                } finally { if (current()) this.ctMtlDebugWindow = { ...this.ctMtlDebugWindow, loading: false }; }
            },
        },
    };
    const Dialog = {
        props: ['host'], data: () => ({ x: 24, y: 24, dragging: false,copyBusy:{},copyMessage:{},copyError:{} }),
        computed: { item() { return this.host.ctMtlDebugWindow; },
            promptText(){return sectionText(this.item.record,'prompt');},contextText(){return sectionText(this.item.record,'context');},
            timingGroups(){return Timing?.groups(this.item.record)||[];},
            timingState(){return Timing?.states(this.item.record)||{};},
            details() { const value=present(this.item.record);delete value.prompt;delete value.context;return JSON.stringify(value,null,2); } },
        watch:{item(){this.resetCopy();}},
        mounted() {
            this._resize = () => this.place(); window.addEventListener('resize', this._resize);
            this._observer = new ResizeObserver(this._resize); this._observer.observe(this.$refs.dialog);
            this.place(true); this.$refs.close.focus({ preventScroll: true });
        },
        beforeUnmount() { this.resetCopy();this.finishDrag(); window.removeEventListener('resize', this._resize); this._observer.disconnect(); },
        methods: {
            timingValue(value){return Timing.format(value);},
            resetCopy(){for(const timer of Object.values(this._copyTimers||{}))clearTimeout(timer);this._copyTimers={};this._copyRuns={};this.copyBusy={};this.copyMessage={};this.copyError={};},
            async copySection(section){
                if(!['prompt','context'].includes(section)||!allowed(this.host)||this.copyBusy[section])return false;
                const item=this.item,origin=this.host.ctMtlDebugOrigin;
                if(!item?.record)return false;
                const text=sectionText(item.record,section);
                if(!text)return false;
                const run={},runs=this._copyRuns||={};runs[section]=run;clearTimeout(this._copyTimers?.[section]);
                const current=()=>runs[section]===run&&this._copyRuns===runs&&allowed(this.host)&&this.item===item&&this.host.ctMtlDebugOrigin===origin;
                this.copyBusy={...this.copyBusy,[section]:true};this.copyMessage={...this.copyMessage,[section]:''};this.copyError={...this.copyError,[section]:''};
                try{
                    if(!root.navigator?.clipboard?.writeText)throw new Error('Clipboard unavailable');
                    await root.navigator.clipboard.writeText(text);if(!current())return false;
                    this.copyMessage={...this.copyMessage,[section]:'Copied'};
                    (this._copyTimers||={})[section]=setTimeout(()=>{if(current())this.copyMessage={...this.copyMessage,[section]:''};},1400);
                    return true;
                }catch(_){
                    if(!current())return false;
                    const reference=this.$refs[section+'Text'],field=Array.isArray(reference)?reference[0]:reference;let selected=false;
                    try{if(field&&root.document?.createRange&&root.getSelection){
                        field.focus({preventScroll:true});const range=root.document.createRange();range.selectNodeContents(field);
                        const selection=root.getSelection();selection?.removeAllRanges();selection?.addRange(range);selected=!!selection;
                    }}catch(_){}
                    this.copyError={...this.copyError,[section]:selected?'Could not copy automatically. Press Ctrl+C to copy the selected '+section+'.':'Could not copy automatically. Select the '+section+' and press Ctrl+C.'};
                    return false;
                }finally{if(current())this.copyBusy={...this.copyBusy,[section]:false};}
            },
            place(center = false) {
                const bounds = this.$refs.dialog.getBoundingClientRect(), clamp = (value, max) => Math.max(8, Math.min(value, max));
                this.x = clamp(center ? (innerWidth - bounds.width) / 2 : this.x, innerWidth - bounds.width - 8);
                this.y = clamp(center ? (innerHeight - bounds.height) / 2 : this.y, innerHeight - bounds.height - 8);
            },
            startDrag(event) {
                if (event.button !== 0 || this._drag || event.target.closest('button')) return;
                event.preventDefault(); event.stopPropagation();
                this._drag = { id: event.pointerId, handle: event.currentTarget, x: this.x, y: this.y, clientX: event.clientX, clientY: event.clientY };
                event.currentTarget.setPointerCapture(event.pointerId);
            },
            moveDrag(event) {
                const drag = this._drag; if (!drag || drag.id !== event.pointerId) return;
                if (!this.dragging && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4) return;
                this.dragging = true; this.x = drag.x + event.clientX - drag.clientX; this.y = drag.y + event.clientY - drag.clientY; this.place();
            },
            finishDrag(event) {
                const drag = this._drag; if (!drag || event && drag.id !== event.pointerId) return;
                this._drag = null; this.dragging = false;
                if (drag.handle.hasPointerCapture(drag.id)) drag.handle.releasePointerCapture(drag.id);
            },
            moveKey(event) {
                if (event.target !== event.currentTarget || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                event.preventDefault(); this.x += event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0;
                this.y += event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0; this.place();
            },
        },
        template: `<teleport to="body"><section ref="dialog" class="ctMtlDebugDialog" data-inline-focus-surface :class="{dragging}" :style="{left:x+'px',top:y+'px'}" role="dialog" aria-labelledby="ct-mtl-debug-title" @keydown.stop @keydown.esc.prevent="host.ctMtlDebugClose()">
          <header class="ctMtlDebugHeader" tabindex="0" aria-label="Move request details with arrow keys or drag" title="Drag to move · Arrow keys when focused" @keydown="moveKey" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="finishDrag" @pointercancel="finishDrag" @lostpointercapture="finishDrag">
            <strong id="ct-mtl-debug-title">MTL request details · Admin</strong><button ref="close" type="button" aria-label="Close request details" @click="host.ctMtlDebugClose()">×</button>
          </header>
          <div class="ctMtlDebugBody"><p class="ctMtlDebugMode">{{ item.record.status === 'preparing' ? 'Browser preparation' : item.record.status === 'preview' ? 'Preview · not executed' : 'Submitted request · ' + item.record.status }}</p>
            <p v-if="item.record.status === 'preview'">Current field and bounded context only. No request has been sent. The exact server prompt appears after Translate is used.</p>
            <p v-else>{{ item.record.server?.providerRequest ? 'Selected fields from the executed request and server validation.' : item.record.browserTiming?.milestonesMs.postStart === null ? 'No request has been sent. Browser preparation timings are shown below.' : 'Browser submission; an executed server prompt has not been confirmed.' }}</p>
            <p>Read-only. Sensitive values are redacted. Server details expire after ten minutes; browser details clear when the account, workspace, language, source or selected record changes.</p>
            <p v-if="item.loading" role="status">Loading request details…</p><p v-if="item.error" role="alert">{{ item.error }}</p>
            <details class="ctMtlTimingPanel"><summary>Timings (ms)</summary>
              <p>Browser outcome: {{ timingState.browser?.outcome || 'Unavailable' }}. API outcome: {{ timingState.api?.outcome || 'Unavailable' }}.</p>
              <p>Request: {{ item.record.requestId || 'Not submitted' }}. Browser and API clocks are independent. These rows overlap; do not add them or subtract timestamps across machines.</p>
              <p>Unavailable means not recorded, not reached, a hidden/unmounted field, older API, or expired diagnostics. Provider observations do not identify queue or reasoning time.</p>
              <section v-for="group in timingGroups" :key="group.title"><h5>{{ group.title }}</h5><p>{{ group.description }}</p>
                <table><caption class="srOnly">{{ group.title }} in milliseconds</caption><thead><tr><th scope="col">Measurement</th><th scope="col">Milliseconds</th></tr></thead>
                <tbody><tr v-for="row in group.rows" :key="row.key"><th scope="row">{{ row.label }}</th><td>{{ timingValue(row.value) }}</td></tr></tbody></table>
              </section>
            </details>
            <h4>Prompt and context</h4>
            <section v-for="section in ['prompt','context']" :key="section" class="ctMtlDebugSection">
              <div class="ctMtlDebugSectionTitle"><strong>{{ section === 'prompt' ? 'Prompt' : 'Context' }}</strong><button v-if="section === 'prompt' ? promptText : contextText" type="button" class="ctMtlCopyButton" :aria-label="'Copy '+section" :title="'Copy '+section" :aria-disabled="copyBusy[section] || undefined" @pointerdown.stop @click.stop="copySection(section)"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 8h12v13H8zM4 16H2V2h13v2"/></svg></button><small role="status" aria-live="polite">{{ copyMessage[section] }}</small></div>
              <pre v-if="section === 'prompt' ? promptText : contextText" :ref="section+'Text'" tabindex="0" :aria-label="section === 'prompt' ? 'Displayed MTL prompt' : 'Displayed MTL context'">{{ section === 'prompt' ? promptText : contextText }}</pre>
              <p v-else>{{ section === 'prompt' ? 'An executed prompt is available after Translate is used.' : 'Context is unavailable.' }}</p><p v-if="copyError[section]" role="alert">{{ copyError[section] }}</p>
            </section>
            <h4>Request and response</h4><pre tabindex="0" aria-label="Selected request fields">{{ details }}</pre>
          </div>
        </section></teleport>`,
    };
    return { mixin, Dialog, allowed, redact, present, sectionText };
});
