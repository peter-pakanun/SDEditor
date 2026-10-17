/* Scoped skill-card UI; catalog content and images arrive only through the private API. */
(function (root) {
    'use strict';
    const emptyKeys = Object.freeze([]);
    const raw = value => root.Vue?.markRaw ? root.Vue.markRaw(value) : value;
    const mixin = {
        data: () => ({ ctSkillCatalog: null, ctSkillRelatedId: '', ctSkillContextId: '', ctSkillImages: {}, ctSkillDrafts: {} }),
        computed: {
            ctSkillScope() { return { ...(this.ctWorkspace?.scope || {}), accessKey: this.privateMediaKey }; },
            ctSkillContextKey() {
                return this.ctActive && this.gameVersion === 'poe2' && this.privateMediaAllowed
                    ? JSON.stringify([this.privateMediaKey, this.ctWorkspace?.scope]) : '';
            },
            ctSkillResolver() {
                return this.ctSkillCatalog && this.ctActive
                    ? raw(root.ClientTextSkillCards.createResolver(this.ctSkillCatalog, this.ctUnits, this.ctSkillScope)) : null;
            },
            ctSkillBaseModel() {
                return this.ctCurrentUnit && this.ctSkillResolver?.compose({ scope: this.ctSkillScope,
                    unit: this.ctCurrentUnit, cardId: this.ctSkillSelectedId || undefined });
            },
            ctSkillChoices() {
                const choices = this.ctSkillResolver?.candidates(this.ctCurrentUnit) || [];
                return choices.map(id => this.ctSkillCatalog.cards.find(card => card.id === id)).filter(Boolean)
                    .sort((a,b) => a.title.source.localeCompare(b.title.source) || a.id.localeCompare(b.id));
            },
            ctSkillSelectedId() {
                const choices = this.ctSkillResolver?.candidates(this.ctCurrentUnit) || [];
                return [this.ctSkillRelatedId, this.ctSkillContextId].find(id => choices.includes(id)) || '';
            },
            ctSkillVariableKeys() {
                return this.ctSkillBaseModel?.state !== 'unavailable' && this.ctSkillBaseModel?.variableKeys?.length
                    ? this.ctSkillBaseModel.variableKeys : emptyKeys;
            },
            ctSkillPreviewModel() {
                this.ctRevision;
                if (!this.ctSkillBaseModel || this.ctSkillBaseModel.state === 'unavailable') return null;
                return this.ctSkillResolver.compose({ scope: this.ctSkillScope, unit: this.ctCurrentUnit,
                    cardId: this.ctSkillSelectedId || undefined, fieldId: this.ctPreviewField?.id, saved: this.ctSaved,
                    draft: { scope: this.ctSkillScope, unitId: this.ctCurrentUnit.id, values: this.ctValues }, drafts: this.ctSkillDrafts, variables: this.ctPreviewGggVars });
            },
            ctSkillDraftKey() {
                return this.ctSkillBaseModel?.skillId ? JSON.stringify([this.ctSkillContextKey,this.ctSkillBaseModel.skillId,this.ctSelection,this.ctRevision]) : '';
            },
            ctSkillAssetKey() {
                const assets = this.ctSkillBaseModel?.assets;
                return assets && this.privateMediaAllowed ? JSON.stringify([this.privateMediaKey, assets.game, assets.id]) : '';
            }
        },
        watch: {
            ctSkillContextKey: { immediate: true, flush: 'sync', handler() { this.ctLoadSkillCatalog(); } },
            ctSkillAssetKey: { immediate: true, flush: 'sync', handler() { this.ctLoadSkillImages(); } },
            ctSkillDraftKey: { immediate: true, handler() { this.ctLoadSkillDrafts(); } },
            ctSelection() { this.ctSkillRelatedId = ''; },
            ctSkillBaseModel(model) { if (model?.skillId) this.ctSkillContextId = model.skillId; }
        },
        mounted() {
            this._ctSkillOnline = () => { if (this.ctSkillContextKey) { if (!this.ctSkillCatalog) this.ctLoadSkillCatalog(); else this.ctLoadSkillImages(); } };
            root.addEventListener?.('online', this._ctSkillOnline);
        },
        beforeUnmount() {
            this._ctSkillCatalogRun = null; this._ctSkillDraftRun = null; this._ctSkillNavigateRun = null; this._ctSkillCatalogAbort?.abort(); this.ctClearSkillImages();
            root.removeEventListener?.('online', this._ctSkillOnline);
        },
        methods: {
            async ctLoadSkillCatalog() {
                this._ctSkillCatalogAbort?.abort();
                const key = this.ctSkillContextKey, run = this._ctSkillCatalogRun = {};
                this.ctSkillCatalog = null; this.ctSkillRelatedId = ''; this.ctSkillContextId = ''; this.ctSkillDrafts = {}; this._ctSkillDraftRun = null;
                if (!key) return;
                const controller = this._ctSkillCatalogAbort = new AbortController();
                try {
                    await this.$nextTick();
                    if (run !== this._ctSkillCatalogRun || key !== this.ctSkillContextKey) return;
                    const catalog = await this.privateMediaJson('/v1/skill-card-catalogs/poe2/v1', { signal: controller.signal });
                    if (run !== this._ctSkillCatalogRun || key !== this.ctSkillContextKey) return;
                    root.ClientTextSkillCards.validateCatalog(catalog);
                    this.ctSkillCatalog = raw(catalog);
                } catch (_) { /* Missing access/catalog keeps the ordinary local field preview usable. */ }
            },
            ctClearSkillImages() {
                this._ctSkillImageRun = null;
                this._ctSkillImageAbort?.abort(); this._ctSkillImageAbort = null;
                for (const lease of this._ctSkillImageLeases || []) lease.release();
                this._ctSkillImageLeases = []; this.ctSkillImages = {};
            },
            async ctLoadSkillImages() {
                this.ctClearSkillImages();
                const key = this.ctSkillAssetKey, assets = this.ctSkillBaseModel?.assets;
                if (!key || !assets) return;
                const run = this._ctSkillImageRun = {};
                await this.$nextTick();
                if (run !== this._ctSkillImageRun || key !== this.ctSkillAssetKey) return;
                let context;
                try { context = this.privateMediaContext(); } catch (_) { return; }
                const controller = this._ctSkillImageAbort = new AbortController();
                await Promise.all(['icon', 'background'].filter(kind => assets[kind]).map(async kind => {
                    try {
                        const lease = await this.privateMediaLoad('/skill-assets/' + assets.game + '/' + assets.id + '/' + kind, 'image', { context, signal: controller.signal });
                        if (run !== this._ctSkillImageRun || key !== this.ctSkillAssetKey) { lease.release(); return; }
                        this._ctSkillImageLeases.push(lease); this.ctSkillImages = { ...this.ctSkillImages, [kind]: lease.url };
                    } catch (_) { /* Text is sufficient when artwork cannot be loaded. */ }
                }));
            },
            ctResetSkillExamples() { this.ctPreviewGggVars = root.ClientTextSkillCards.resetExamples(this.ctPreviewGggVars); },
            async ctLoadSkillDrafts() {
                const key = this.ctSkillDraftKey, run = this._ctSkillDraftRun = {}, resolver = this.ctSkillResolver;
                if (!key || !this.ctStorage || !this.ctContext) return;
                const scope = this.ctSkillScope, context = this.ctContext(), units = resolver.referencedUnits(this.ctSkillBaseModel.skillId);
                try {
                    const rows = await Promise.all(units.map(async unit => [unit.id, await this.ctStorage(context.scope).getDraft(context.scope,unit.id)]));
                    if (run !== this._ctSkillDraftRun || key !== this.ctSkillDraftKey || resolver !== this.ctSkillResolver) return;
                    const next = { ...this.ctSkillDrafts };
                    for (const [id,draft] of rows) { if (draft?.values) next[id] = { scope, unitId:id, values:draft.values }; else delete next[id]; }
                    this.ctSkillDrafts = next;
                } catch (_) { /* The active field draft remains live when related drafts cannot be read. */ }
            },
            ctSkillCanEdit(entry) { return entry?.origin === 'workbook' && !!this.ctSkillResolver?.resolveReference(entry.reference, this.ctSkillScope); },
            async ctSkillEditField(entry) {
                if (!this.ctSkillCanEdit(entry) || this.ctBusy || this.ctBrowseBusy) return false;
                const resolver = this.ctSkillResolver, target = resolver.resolveReference(entry.reference, this.ctSkillScope);
                if (!target) return false;
                const key = this.ctSkillContextKey, cardId = this.ctSkillPreviewModel?.skillId, run = this._ctSkillNavigateRun = {}, full = this.ctEditor;
                const current = () => this._ctSkillNavigateRun === run && key === this.ctSkillContextKey
                    && this.ctSkillResolver === resolver && this._ctUnitIndex?.get(target.unit.id) === target.unit;
                if (target.unit !== this.ctCurrentUnit && !await this.ctChangeBrowse(() => {
                    this.ctBrowseMode = 'sheets'; this.ctSheet = JSON.stringify([target.unit.role,target.unit.sheet]);
                    this.ctSearch = ''; this.ctAppliedSearch = ''; this.ctFilter = '';
                    this.ctSelectedFilters = ['missing','outdated','revised','saved','unchanged']; this.ctPage = 1;
                })) return false;
                if (!current() || !await this.ctSelect(target.unit, full, { focus: false, guard: current }) || !current()) return false;
                this.ctTool = 'preview'; if (cardId) this.ctSkillContextId = cardId;
                const index = this.ctRows.findIndex(unit => unit.id === target.unit.id);
                if (index >= 0) this.ctPage = Math.floor(index / this.ctEffectivePageSize) + 1;
                await this.$nextTick();
                if (!current() || this.ctSelection !== target.unit.id) return false;
                return this.ctFocusTarget(false, target.field.id);
            },
            ctSkillExampleLabel(key) {
                const model = this.ctSkillPreviewModel;
                const label = side => [...(side?.properties || []), ...(side?.shortProperties || [])].find(property => property.key === key)?.label;
                const translated = label(model?.target), source = label(model?.source);
                return translated?.available ? { text: translated.text, translated: true } : { text: source?.text || key, translated: false };
            }
        }
    };
    const Text = {
        name: 'SkillCardText', props: { host: Object, text: String, translated: Boolean, entry: Object, clickToEdit: Boolean },
        computed: { segments() { return this.host.buildGamePreviewSegments(this.text || '', { contentMode: 'clienttext' }).segments; },
            editable() { return this.host.ctSkillCanEdit?.(this.entry); },
            editLabel() { return this.editable ? (this.clickToEdit ? 'Click or Alt+Click' : 'Alt+Click')+' to edit '+this.entry.reference.field+' in '+this.entry.reference.sheet+' ('+this.host.ctSkillScope.language+')' : undefined; } },
        methods: { edit(event) {
            if (!this.entry || !event || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented || event.button !== 0) return false;
            if (!event.altKey && (!this.clickToEdit || event.target?.closest?.('.gamePreviewKw'))) return false;
            // Capture before a nested keyword's click handler can pin its popup.
            // An unavailable destination still consumes this navigation gesture.
            event.preventDefault(); event.stopPropagation();
            return this.editable ? this.host.ctSkillEditField(this.entry) : false;
        } },
        template: `<span class="skillCardText" :class="{skillCardEditable:editable,skillCardClickEditable:editable && clickToEdit}" :title="editLabel" @click.capture="edit"><template v-for="(seg,index) in segments" :key="index">
            <span v-if="seg.type==='text'" :style="seg.decorStyle">{{seg.text}}</span>
            <span v-else-if="seg.type==='kw'" class="gamePreviewKw" :style="seg.decorStyle" tabindex="0" role="button" aria-haspopup="dialog"
                @mouseenter="host.previewKeywordEnter?.($event,seg,translated)" @mouseleave="host.previewKeywordLeave?.($event)"
                @focus="host.previewKeywordEnter?.($event,seg,translated)" @blur="host.previewKeywordLeave?.($event)"
                @click.stop="host.previewKeywordActivate?.($event,seg,translated)" @keydown.enter.prevent.stop="host.previewKeywordActivate?.($event,seg,translated)"
                @keydown.space.prevent.stop="host.previewKeywordActivate?.($event,seg,translated)">{{host.gamePreviewKeywordText(seg)}}</span>
            <span v-else-if="seg.type==='var'" :style="seg.decorStyle">{{seg.prefix + (host.gamePreviewVarValues[seg.key] ?? host.defaultPreviewVarValue(seg.key))}}{{seg.trailingPercent?'%':''}}</span>
            <br v-else-if="seg.type==='break'">
        </template></span>`
    };
    const Card = {
        name: 'ClientTextSkillCard', components: { 'skill-card-text': Text },
        props: { host: Object, model: Object, translated: Boolean }, data: () => ({ selectedTab: '' }),
        computed: {
            side() { return this.translated ? this.model.target : this.model.source; },
            shortProperties() {
                return this.side.shortProperties.filter(property => property.available && property.label?.available && property.text);
            },
            tab() { return this.side.tabs.find(tab => tab.id === this.selectedTab) || this.side.tabs[0]; },
            style() {
                const background = this.host.ctSkillImages.background;
                return { fontFamily: this.translated ? this.host.gamePreviewFontFamily : this.host.gamePreviewSourceFontFamily,
                    ...(background?.startsWith('blob:') ? { backgroundImage: 'linear-gradient(0deg,#101514 12%,transparent 85%),url("' + background + '")' } : {}) };
            }
        },
        template: `<div class="ctSkillCards"><article class="ctSkillCard ctSkillFullCard" :style="style" :aria-label="(translated?'Translation':'English')+' skill-card preview'">
            <header class="ctSkillCardHeading"><img v-if="host.ctSkillImages.icon" :src="host.ctSkillImages.icon" alt="" width="56" height="56">
                <div><h3 :class="{'ctSkillFocused':side.title.focused}"><skill-card-text :host="host" :entry="side.title" :text="side.title.text || '(empty)'" :translated="translated" click-to-edit/></h3>
                    <div class="ctSkillCardType"><template v-for="(tag,index) in side.tags.filter(tag=>tag.position==='type' && tag.available)" :key="index"><skill-card-text :host="host" :entry="tag" :text="tag.text" :translated="translated"/></template></div>
                </div></header>
            <div class="ctSkillCardTags"><template v-for="(tag,index) in side.tags.filter(tag=>tag.position==='tag' && tag.available)" :key="index"><span v-if="index">, </span><skill-card-text :host="host" :entry="tag" :text="tag.text" :translated="translated"/></template></div>
            <dl class="ctSkillCardProperties"><template v-for="property in side.properties" :key="property.key"><dt><skill-card-text :host="host" :entry="property.label" :text="property.label.text" :translated="translated"/>:</dt><dd><skill-card-text :host="host" :text="property.text || '(empty)'" :translated="translated"/></dd></template></dl>
            <p v-if="side.properties.length" class="ctSkillCardExample">Preview examples · change values in the variable list</p>
            <p class="ctSkillCardDescription" :class="{'ctSkillFocused':side.description.focused}"><skill-card-text :host="host" :entry="side.description" :text="side.description.text || '(empty)'" :translated="translated" click-to-edit/></p>
            <div v-if="side.tabs.length" class="ctSkillCardTabs" role="tablist" aria-label="Skill modes"><button v-for="item in side.tabs" :key="item.id" type="button" role="tab" :aria-selected="tab?.id===item.id" @click="selectedTab=item.id"><skill-card-text :host="host" :entry="item.label" :text="item.label.text || '(empty)'" :translated="translated"/></button></div>
            <p v-if="!tab?.lines.length" class="ctSkillCardOmitted">Combat values omitted from this translation preview.</p>
            <footer v-if="side.footer?.available"><skill-card-text :host="host" :entry="side.footer" :text="side.footer.text" :translated="translated"/></footer>
            <p v-if="model.warnings.includes('partial-workbook')" class="ctSkillCardPartial">Related workbook text is unavailable; missing translations remain empty.</p>
        </article>
        <article v-if="side.shortDescription" class="ctSkillCard ctSkillShortCard" :style="style" :aria-label="(translated?'Translation':'English')+' short skill-card preview'">
            <header class="ctSkillCardHeading">
                <img v-if="host.ctSkillImages.icon" :src="host.ctSkillImages.icon" alt="" width="56" height="56">
                <h3 class="ctSkillShortTitle" :class="{'ctSkillFocused':side.skillTitle.focused}"><skill-card-text :host="host" :entry="side.skillTitle" :text="side.skillTitle.text || '(empty)'" :translated="translated" click-to-edit/></h3>
                <dl v-if="shortProperties.length" class="ctSkillShortProperties"><div v-for="property in shortProperties" :key="property.key">
                    <dt><skill-card-text :host="host" :entry="property.label" :text="property.label.text" :translated="translated"/></dt>
                    <dd><skill-card-text :host="host" :text="property.text" :translated="translated"/></dd>
                </div></dl>
            </header>
            <p class="ctSkillShortDescription" :class="{'ctSkillFocused':side.shortDescription.focused}"><skill-card-text :host="host" :entry="side.shortDescription" :text="side.shortDescription.text || '(empty)'" :translated="translated" click-to-edit/></p>
        </article></div>`
    };
    root.ClientTextSkillCardUI = { mixin, Card, Text };
})(typeof window !== 'undefined' ? window : globalThis);
