/* App-owned preview windows. Each root freezes its workbook, language and values;
 * descendants never consult the subsequently selected file or workspace. */
(function (root) {
  'use strict';
  const raw = value => root.Vue?.markRaw ? root.Vue.markRaw(value) : value;
  const copy = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, maximum) => Math.max(8, Math.min(value, maximum));
  function adjacentPosition(anchor, size, viewport, nested = false) {
    const width = Math.min(size.width, viewport.width - 16), height = Math.min(size.height, viewport.height - 16);
    const room = { bottom: viewport.height - 8 - anchor.bottom, top: anchor.top - 8,
      right: viewport.width - 8 - anchor.right, left: anchor.left - 8 };
    const sides = nested ? ['right', 'left', 'bottom', 'top'] : ['bottom', 'top', 'right', 'left'];
    const required = side => ['top', 'bottom'].includes(side) ? height : width;
    const side = sides.find(side => room[side] >= required(side))
      || sides.reduce((best, side) => room[side] / required(side) > room[best] / required(best) ? side : best);
    const vertical = side === 'top' || side === 'bottom';
    const maxWidth = vertical ? viewport.width - 16 : Math.max(1, room[side]);
    const maxHeight = vertical ? Math.max(1, room[side]) : viewport.height - 16;
    const w = Math.min(width, maxWidth), h = Math.min(height, maxHeight);
    const x = side === 'left' ? anchor.left - w : side === 'right' ? anchor.right : (anchor.left + anchor.right - w) / 2;
    const y = side === 'top' ? anchor.top - h : side === 'bottom' ? anchor.bottom : (anchor.top + anchor.bottom - h) / 2;
    return { x: clamp(x, viewport.width - w - 8), y: clamp(y, viewport.height - h - 8), maxWidth, maxHeight, side };
  }
  function snapshot(host, sources, translated, approvedOnly=false) {
    const entries = new Map();
    const selected = host.ctActive ? host.ctWorkspace?.scope || {} : root.EditorReferenceCatalog?.sessionFor(host)?.scope || {game:host.gameVersion};
    let scope = {};
    for (const source of sources) {
      // Defense in depth for stale catalog results and identical tag/unit IDs
      // in the two games. A sibling may differ in group, but not release scope.
      if (['game','accountId','branchId','versionId'].some(key => selected[key] && source.scope?.[key] !== selected[key])
        || selected.language && source.scope?.language !== selected.language) continue;
      for (const unit of source.units || []) {
        if (unit.sheet !== 'KeywordPopups' || unit.role !== 'normal') continue;
        if (entries.has(unit.recordId)) continue; // Active workbook wins over sibling references.
        if (!entries.size) scope = source.scope || {};
        const originalValues = root.ClientTextState.valuesFor(unit, source.saved?.[unit.id]);
        const values = unit.id === host.ctCurrentUnit?.id && host.ctActive && source.scope?.groupId === selected.groupId ? { ...originalValues, ...host.ctValues } : originalValues;
        const read = name => {
          const field = unit.fields.find(field => field.name === name);
          if(translated&&approvedOnly)return field?root.ClientTextMtlContext?.approvedTranslation(unit,field,source.saved)||'':'';
          const value = String((translated ? values?.[field?.id] : field?.source) ?? '');
          return translated && field && !value.trim() && root.ClientTextState.englishIntentFor(field, source.saved?.[unit.id], { game: source.scope?.game }) ? field.source : value;
        };
        entries.set(unit.recordId, { title: read('Info Title'), content: read('Info Content'), scope: copy(source.scope || {}) });
      }
    }
    const language = translated ? host.ctWorkspace?.scope?.language || host.lang : 'English';
    return raw({ entries, language, translated, scope: copy(scope),
      variables: { ...host.gamePreviewVarValues }, font: host.getGamePreviewFontFamily(language) });
  }
  function cardContent(host, tag, context, extra = {}) {
    const entry = context.entries.get(tag);
    const parse = text => host.buildGamePreviewSegments(text, { contentMode: 'clienttext' }).segments;
    return { context, tagName: tag, title: parse(entry?.title || (entry ? '(empty)' : tag)), content: parse(entry?.content || '(empty)'),
      notice: !context.entries.size ? 'KeywordPopups data unavailable. Prepare ClientText references in Lookup.'
        : !entry ? 'Keyword not found in this workbook.'
          : context.translated && (!entry.title.trim() || !entry.content.trim()) ? 'Missing ' + context.language + ' translation.' : '', ...extra };
  }
  const mixin = {
    data: () => ({ keywordWindows: [], keywordWindowSequence: 0, keywordAutocomplete: null, keywordActiveId: null }),
    computed: {
      keywordReferenceKey() {
        const catalog = root.EditorReferenceCatalog, session = catalog?.sessionFor(this);
        return session ? catalog.contextKey(this, session) : JSON.stringify([this.ctActive ? this.ctWorkspace?.scope : this.sourceIdentity,
          this.gameVersion, this.branchId, this.lang, this.cloudUser?.id]);
      },
      keywordPreviewOrigin() {
        return JSON.stringify([this.keywordReferenceKey, this.ctActive, this.ctActive ? this.ctWorkspace?.scope : this.sourceIdentity,
          this.gameVersion, this.lang, this.ctActive ? this.ctSelection : this.editorCurrentEditingDesc?.filepath,
          this.cloudUser?.id]);
      },
      keywordSheetPreviewKeys() {
        const unit = this.ctCurrentUnit;
        if (!this.ctActive || unit?.sheet !== 'KeywordPopups') return [];
        return [...new Set(unit.fields.filter(field => ['Info Title', 'Info Content'].includes(field.name))
          .flatMap(field => [field.source, this.ctValues[field.id] ?? ''])
          .flatMap(text => this.buildGamePreviewSegments(text, { contentMode: 'clienttext' }).keysOrder))];
      },
      keywordAutocompleteTag() {
        const item = this.ctActive ? this.ctCompletion?.items?.[this.ctCompletion.selectedIndex]
          : this.hlPopup?.visible ? this.hlPopup.filtered?.[this.hlPopup.selectedIndex] : null;
        return String(item?.kwTagName || /^\[([^|\]]+)(?:\|[^\]]*)?\]$/.exec(item?.value || '')?.[1] || '').trim();
      },
      keywordAutocompleteKey() {
        if (!this.keywordAutocompleteTag) return '';
        return JSON.stringify([this.keywordPreviewOrigin, this.keywordAutocompleteTag, this.ctRevision,
          this.ctActive ? this.ctCompletion?.fieldId : [this.hlPopup.editorIndex, this.hlPopup.columnIndex],
          this.ctActive && this.ctCurrentUnit?.sheet === 'KeywordPopups' ? this.ctValues : null]);
      },
    },
    watch: {
      keywordReferenceKey: { flush: 'sync', handler() { this.fenceKeywordContext(); } },
      keywordPreviewOrigin() {
        this._keywordAnchor = null; this._keywordPointerTarget = null;
        this.dismissKeywordWindows(null);
      },
      keywordAutocompleteKey: { immediate: true, handler() { this.updateKeywordAutocomplete(); } },
      keywordAutocomplete() {
        if (!this.ctActive && this.hlPopup?.visible) this.$nextTick(() => {
          if (this.hlPopup.visible) this.positionHlPopup(this.hlPopup.editorIndex, this.hlPopup.columnIndex);
        });
      },
    },
    mounted() {
      this._keywordEscape = event => {
        this._keywordKeyboardFocus = true;
        if (event.key !== 'Escape' || event.isComposing) return;
        const id = event.target?.closest?.('[data-keyword-window]')?.dataset.keywordWindow;
        if (!id || Number(id) !== this.keywordActiveId) return;
        event.preventDefault(); event.stopImmediatePropagation();
        this.closeKeywordWindow(Number(id));
      };
      document.addEventListener('keydown', this._keywordEscape, true);
      this._keywordPointer = event => {
        if (event.type === 'pointermove' || event.type === 'pointerdown') this._keywordKeyboardFocus = false;
        if (event.type === 'pointerdown') {
          const anchor = event.target?.closest?.('.gamePreviewKw[role="button"]');
          this._keywordClick = null;
          this._keywordPress = anchor && event.button === 0 ? { anchor, pointerId: event.pointerId,
            parentId: Number(anchor.closest('[data-keyword-window]')?.dataset.keywordWindow) || null } : null;
          // Native mousedown focus on a nested link must not activate its parent
          // before we know whether this is a completed keyword click.
          if (this._keywordPress) event.preventDefault();
          else if (!event.target?.closest?.('[data-keyword-window]')) this.clearKeywordFocus();
        }
        this._keywordPointerTarget = event.type === 'pointerout' ? event.relatedTarget : event.target;
        this.dismissKeywordWindows(this._keywordPointerTarget, this._keywordKeyboardFocus ? document.activeElement : null);
      };
      this._keywordRelease = event => {
        const press = this._keywordPress;
        if (!press || press.pointerId !== event.pointerId) return;
        this._keywordPress = null;
        if (event.type === 'pointercancel') { this._keywordClick = null; return; }
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const inside = press.anchor.contains(target);
        this._keywordClick = { anchor: press.anchor, inside };
        if (inside && !press.parentId) this.clearKeywordFocus();
        if (!inside) {
          const id = Number(target?.closest?.('[data-keyword-window]')?.dataset.keywordWindow);
          const parent = this.keywordWindows.find(item => item.id === id && id === press.parentId);
          if (parent) this.focusKeywordWindow(parent);
          else if (!id) this.clearKeywordFocus();
        }
      };
      this._keywordFocus = event => {
        if (this._keywordPress?.anchor.contains(event.target)) return;
        const id = Number(event.target?.closest?.('[data-keyword-window]')?.dataset.keywordWindow);
        this.keywordActiveId = this.keywordWindows.some(item => item.id === id) ? id : null;
      };
      document.addEventListener('pointerover', this._keywordPointer, true);
      document.addEventListener('pointerout', this._keywordPointer, true);
      document.addEventListener('pointermove', this._keywordPointer, true);
      document.addEventListener('pointerdown', this._keywordPointer, true);
      document.addEventListener('pointerup', this._keywordRelease, true);
      document.addEventListener('pointercancel', this._keywordRelease, true);
      document.addEventListener('focusin', this._keywordFocus, true);
    },
    beforeUnmount() {
      this._keywordAutocompleteRun = null; this._keywordAutocompleteCache = null;
      document.removeEventListener('keydown', this._keywordEscape, true);
      document.removeEventListener('pointerover', this._keywordPointer, true);
      document.removeEventListener('pointerout', this._keywordPointer, true);
      document.removeEventListener('pointermove', this._keywordPointer, true);
      document.removeEventListener('pointerdown', this._keywordPointer, true);
      document.removeEventListener('pointerup', this._keywordRelease, true);
      document.removeEventListener('pointercancel', this._keywordRelease, true);
      document.removeEventListener('focusin', this._keywordFocus, true);
      this._keywordCatalog?.dispose();
    },
    methods: {
      fenceKeywordContext() {
        this._keywordContextGeneration = (this._keywordContextGeneration || 0) + 1;
        this._keywordCatalog?.dispose();
        this._keywordAutocompleteRun = null; this._keywordAutocompleteCache = null;
        this._keywordAnchor = null; this._keywordPointerTarget = null;
        this._keywordPress = null; this._keywordClick = null; this._keywordRestoreAnchor = null;
        this.clearKeywordAutocomplete(); this.dismissKeywordWindows(null);
      },
      async keywordContext(translated,options={}) {
        const generation = this._keywordContextGeneration || 0, key = this.keywordReferenceKey;
        let sources;
        if (this.ctActive) sources = [{ units: this.ctUnits, saved: this.ctSaved, scope: this.ctWorkspace?.scope }];
        else if (root.EditorReferenceCatalog) {
          this._keywordCatalog ||= root.EditorReferenceCatalog.create(this);
          try { sources = (await this._keywordCatalog.load(root.EditorReferenceCatalog.sessionFor(this), this.lang)).sources; }
          catch (error) {
            if (error.stale || error.name === 'AbortError') return null;
            sources = [];
          }
        }
        if (generation !== (this._keywordContextGeneration || 0) || key !== this.keywordReferenceKey) return null;
        return snapshot(this, sources || [], translated,options.approvedOnly===true);
      },
      keywordCard(tag, context, extra = {}) {
        return cardContent(this, tag, context, { id: ++this.keywordWindowSequence, pinned: false, ...extra });
      },
      clearKeywordAutocomplete() {
        const previous = this.keywordAutocomplete; this.keywordAutocomplete = null;
        if (previous) this.removeKeywordBranch(previous.id);
      },
      async updateKeywordAutocomplete() {
        const key = this.keywordAutocompleteKey, run = this._keywordAutocompleteRun = {};
        this.clearKeywordAutocomplete();
        if (!key) {
          if (!(this.ctActive ? this.ctCompletion : this.hlPopup?.visible)) this._keywordAutocompleteCache = null;
          return;
        }
        const origin = this.keywordPreviewOrigin, tag = this.keywordAutocompleteTag;
        const signature = JSON.stringify([origin, this.ctRevision, this.ctActive && this.ctCurrentUnit?.sheet === 'KeywordPopups' ? this.ctValues : null]);
        let cache = this._keywordAutocompleteCache;
        if (!cache || cache.signature !== signature) {
          cache = this._keywordAutocompleteCache = { signature, promise: this.keywordContext(true) };
          cache.promise.then(context => { cache.context = context; });
        }
        const context = cache.context || await cache.promise;
        if (!context || run !== this._keywordAutocompleteRun || key !== this.keywordAutocompleteKey || origin !== this.keywordPreviewOrigin) return;
        if (context.entries.has(tag)) this.keywordAutocomplete = this.keywordCard(tag, context, { origin });
      },
      autocompleteDetailsStyle(popup) {
        const width = Math.max(1, popup.noteWidth), height = Math.max(1, popup.noteMaxHeight);
        return { left: `clamp(8px, ${popup.noteX}px, max(8px, calc(100vw - ${width + 8}px)))`,
          top: `clamp(8px, ${popup.noteY}px, max(8px, calc(100vh - ${height + 8}px)))`,
          width: `min(${width}px, calc(100vw - 16px))`, maxHeight: `min(${height}px, calc(100vh - 16px))` };
      },
      async previewKeywordEnter(event, segment, translated, parent = null) {
        const anchor = event.currentTarget;
        if (this._keywordRestoreAnchor === anchor) { this._keywordRestoreAnchor = null; return; }
        // A covering card owns hit testing, even if a stale enter arrives from
        // a keyword underneath it while layout or stacking changes.
        const pointer = event.type === 'mouseenter';
        if (pointer && !anchor.contains(document.elementFromPoint(event.clientX, event.clientY))) return;
        const origin = parent ? parent.origin : this.keywordPreviewOrigin;
        this._keywordAnchor = anchor;
        this.dismissKeywordWindows(pointer ? anchor : this._keywordPointerTarget, pointer ? null : anchor);
        const matches = item => item.anchor === anchor && item.origin === origin && item.parentId === (parent?.id || null);
        const existing = this.keywordWindows.find(matches);
        if (existing) return existing;
        let context = parent?.context;
        if (!context) {
          context = await this.keywordContext(translated);
          if (!context || this.keywordPreviewOrigin !== origin || this._keywordAnchor !== anchor || !anchor.isConnected) return;
          if (pointer && !anchor.contains(document.elementFromPoint(event.clientX, event.clientY))) return;
        }
        const opened = this.keywordWindows.find(matches);
        if (opened) return opened;
        const tag = segment.tagName || /^\[([^|\]]+)/.exec(segment.full || '')?.[1];
        const item = this.keywordCard(tag, context, { parentId: parent?.id || null, origin, anchor: raw(anchor) });
        this.keywordWindows.push(item);
        return item;
      },
      previewKeywordLeave(event) {
        if (this._keywordAnchor === event.currentTarget) this._keywordAnchor = null;
        if (event.type === 'blur') this.dismissKeywordWindows(this._keywordPointerTarget, event.relatedTarget);
        else {
          this._keywordPointerTarget = event.relatedTarget;
          this.dismissKeywordWindows(event.relatedTarget, this._keywordKeyboardFocus ? document.activeElement : null);
        }
      },
      async previewKeywordActivate(event, segment, translated, parent = null) {
        if (event.type === 'click' && event.detail > 0 && this._keywordClick?.anchor === event.currentTarget) {
          const inside = this._keywordClick.inside; this._keywordClick = null;
          if (!inside) return;
        }
        const item = await this.previewKeywordEnter(event, segment, translated, parent);
        if (item) {
          this.pinKeywordWindow(item); await this.$nextTick();
          if (this.keywordActiveId === item.id) document.getElementById('keyword-window-' + item.id)?.focus({ preventScroll: true });
        }
      },
      dismissKeywordWindows(pointerTarget = this._keywordPointerTarget, focusTarget = null) {
        const keep = new Set();
        for (const target of [pointerTarget, focusTarget]) {
          for (const item of this.keywordWindows) if (item.anchor === target || item.anchor.contains?.(target)) keep.add(item.id);
        }
        const retained = this.keywordWindows.filter(item => item.pinned || keep.has(item.id));
        if (retained.length !== this.keywordWindows.length) this.keywordWindows = retained;
        if (!retained.some(item => item.id === this.keywordActiveId)) this.keywordActiveId = null;
      },
      raiseKeywordWindow(item) {
        if (!this.keywordWindows.some(value => value.id === item.id)) return;
        if (this.keywordWindows.at(-1)?.id === item.id) return;
        this.keywordWindows = [...this.keywordWindows.filter(value => value.id !== item.id), item];
      },
      focusKeywordWindow(item, focus = true) {
        if (!this.keywordWindows.some(value => value.id === item.id)) return;
        this.keywordActiveId = item.id; this.raiseKeywordWindow(item);
        if (focus) document.getElementById('keyword-window-' + item.id)?.focus({ preventScroll: true });
      },
      clearKeywordFocus() {
        this.keywordActiveId = null;
        if (document.activeElement?.closest?.('[data-keyword-window]')) document.activeElement.blur?.();
      },
      pinKeywordWindow(item) { item.pinned = true; this.focusKeywordWindow(item, false); },
      removeKeywordBranch(id) {
        const remove = new Set([id]);
        let changed = true;
        while (changed) { changed = false; for (const value of this.keywordWindows) if (!value.pinned && remove.has(value.parentId) && !remove.has(value.id)) { remove.add(value.id); changed = true; } }
        this.keywordWindows = this.keywordWindows.filter(value => !remove.has(value.id));
        if (remove.has(this.keywordActiveId)) this.keywordActiveId = null;
      },
      closeKeywordWindow(id) {
        const item = this.keywordWindows.find(value => value.id === id);
        if (!item) return;
        const focused = document.activeElement?.closest?.('[data-keyword-window]')?.dataset.keywordWindow === String(id);
        // Independent pinned descendants survive closing their parent.
        this.removeKeywordBranch(id);
        if (focused && item.anchor.isConnected) {
          this._keywordRestoreAnchor = item.anchor;
          item.anchor.focus({ preventScroll: true });
          this._keywordRestoreAnchor = null;
        }
      },
    },
  };
  const Text = {
    name: 'KeywordPreviewText',
    props: ['host', 'segments', 'item'],
    methods: { value(segment) { return (segment.prefix || '') + (this.item.context.variables[segment.key] ?? this.host.defaultPreviewVarValue(segment.key)) + (segment.trailingPercent ? '%' : ''); } },
    template: `<template v-for="(segment,index) in segments" :key="index">
      <span v-if="segment.type === 'text'" :style="segment.decorStyle">{{ segment.text }}</span>
      <span v-else-if="segment.type === 'kw'" class="gamePreviewKw" :style="segment.decorStyle" tabindex="0" role="button" aria-haspopup="dialog"
        @mouseenter="host.previewKeywordEnter($event,segment,item.context.translated,item)" @mouseleave="host.previewKeywordLeave($event)"
        @focus="host.previewKeywordEnter($event,segment,item.context.translated,item)" @blur="host.previewKeywordLeave($event)"
        @click.stop="host.previewKeywordActivate($event,segment,item.context.translated,item)" @keydown.enter.prevent.stop="host.previewKeywordActivate($event,segment,item.context.translated,item)" @keydown.space.prevent.stop="host.previewKeywordActivate($event,segment,item.context.translated,item)">
        <keyword-preview-text v-if="segment.parts" :host="host" :segments="segment.parts" :item="item"></keyword-preview-text><template v-else>{{ segment.text }}</template>
      </span>
      <span v-else-if="segment.type === 'var'" :style="segment.decorStyle">{{ value(segment) }}</span>
      <br v-else-if="segment.type === 'break'">
      <span v-else-if="segment.type === 'continue'" class="gamePreviewContinue">Continue</span>
      <span v-else>{{ segment.full || segment.text }}</span>
    </template>`,
  };
  Text.components = { 'keyword-preview-text': Text };
  const Card = {
    props: { host: Object, item: Object, draggable: Boolean, linkedTitle: Boolean }, components: { 'keyword-preview-text': Text },
    emits: ['dragstart', 'dragmove', 'dragfinish'],
    computed: {
      heading() { return this.linkedTitle ? [{ type: 'kw', tagName: this.item.tagName, parts: this.item.title }] : this.item.title; },
    },
    template: `<div :class="{keywordPreviewHeader:draggable}" :title="draggable ? 'Drag to move' : undefined" @pointerdown="draggable && $emit('dragstart',$event)" @pointermove="draggable && $emit('dragmove',$event)" @pointerup="draggable && $emit('dragfinish',$event)" @pointercancel="draggable && $emit('dragfinish',$event)" @lostpointercapture="draggable && $emit('dragfinish',$event)"><div class="keywordPreviewTitle" :id="'keyword-title-'+item.id"><keyword-preview-text :host="host" :segments="heading" :item="item"></keyword-preview-text></div></div>
      <div class="gamePreviewContinue keywordPreviewSeparator" role="separator"></div>
      <div class="keywordPreviewContent"><keyword-preview-text :host="host" :segments="item.content" :item="item"></keyword-preview-text></div>
      <p v-if="item.notice" class="keywordPreviewNotice">{{ item.notice }}</p>`,
  };
  const Details = {
    props: ['host'], components: { 'keyword-preview-card': Card },
    template: `<section v-if="host.keywordAutocomplete" class="keywordPreviewWindow keywordAutocompleteCard" :data-keyword-detail="host.keywordAutocomplete.id" :data-language="host.keywordAutocomplete.context.language" :style="{fontFamily:host.keywordAutocomplete.context.font}" aria-label="Keyword information" @mousedown.prevent><keyword-preview-card :host="host" :item="host.keywordAutocomplete" linked-title></keyword-preview-card></section>`,
  };
  const SheetPreview = {
    props: { host: Object, translated: Boolean }, components: { 'keyword-preview-card': Card },
    computed: {
      units() { return this.host.ctUnits.filter(unit => unit.role === 'normal' && unit.sheet === 'KeywordPopups'); },
      context() {
        this.host.ctRevision;
        return snapshot(this.host, [{ units: this.units, saved: this.host.ctSaved, scope: this.host.ctWorkspace?.scope }], this.translated);
      },
      sheetId() { return this.translated ? -2 : -1; },
      item() { return cardContent(this.host, this.host.ctCurrentUnit?.recordId || '', this.context,
        { id: this.sheetId, origin: this.host.keywordPreviewOrigin }); }
    },
    watch: { item() { this.host.removeKeywordBranch(this.sheetId); } },
    beforeUnmount() { this.host.removeKeywordBranch(this.sheetId); },
    template: `<section class="keywordPreviewWindow keywordSheetPreview" :data-language="item.context.language" :style="{fontFamily:item.context.font}" :aria-label="(translated?'Translation':'English')+' keyword-card preview'"><keyword-preview-card :host="host" :item="item"></keyword-preview-card></section>`
  };
  const Window = {
    props: ['host', 'item', 'order'], components: { 'keyword-preview-card': Card },
    data: () => ({ x: 8, y: 8, maxWidth: null, maxHeight: null, dragging: false }),
    mounted() {
      this._resize = new ResizeObserver(() => this.place()); this._resize.observe(this.$el);
      this._place = () => this.place(); window.addEventListener('resize', this._place); this.place();
      document.addEventListener('scroll', this._place, true);
    },
    beforeUnmount() { this.finishDrag(); this._resize.disconnect(); window.removeEventListener('resize', this._place); document.removeEventListener('scroll', this._place, true); },
    methods: {
      place() {
        const bounds = this.$el.getBoundingClientRect(), anchor = this.item.anchor.getBoundingClientRect();
        if (this._placed && this.item.pinned) {
          this.maxWidth = Math.min(this.maxWidth, innerWidth - 16); this.maxHeight = Math.min(this.maxHeight, innerHeight - 16);
          this.x = clamp(this.x, innerWidth - Math.min(bounds.width, this.maxWidth) - 8);
          this.y = clamp(this.y, innerHeight - Math.min(bounds.height, this.maxHeight) - 8);
        } else {
          Object.assign(this, adjacentPosition(anchor, bounds, { width: innerWidth, height: innerHeight }, !!this.item.parentId));
        }
        this._placed = true;
      },
      startDrag(event) {
        if (!this.item.pinned || event.button !== 0 || this._drag || event.target.closest('button,[role="button"]')) return;
        event.preventDefault(); event.stopPropagation();
        this._drag = { id: event.pointerId, handle: event.currentTarget, x: this.x, y: this.y, clientX: event.clientX, clientY: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      moveDrag(event) {
        const drag = this._drag;
        if (!drag || drag.id !== event.pointerId) return;
        if (!this.dragging) {
          if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4) return;
          this.host.focusKeywordWindow(this.item); this.dragging = true;
        }
        const bounds = this.$el.getBoundingClientRect();
        this.x = clamp(drag.x + event.clientX - drag.clientX, innerWidth - bounds.width - 8);
        this.y = clamp(drag.y + event.clientY - drag.clientY, innerHeight - bounds.height - 8);
      },
      finishDrag(event) {
        const drag = this._drag;
        if (!drag || event && drag.id !== event.pointerId) return;
        this._drag = null; this.dragging = false;
        if (drag.handle.hasPointerCapture(drag.id)) drag.handle.releasePointerCapture(drag.id);
      },
      click(event) {
        if (!event.target.closest('.gamePreviewKw[role="button"]')) this.host.focusKeywordWindow(this.item);
      },
    },
    template: `<section class="keywordPreviewWindow" :id="'keyword-window-'+item.id" :data-keyword-window="item.id" :data-language="item.context.language" tabindex="-1" role="dialog" aria-modal="false" :aria-labelledby="'keyword-title-'+item.id"
      :style="{left:x+'px',top:y+'px',maxWidth:maxWidth+'px',maxHeight:maxHeight+'px',zIndex:order+1,fontFamily:item.context.font}" :class="{keywordPreviewDragging:dragging,keywordPreviewActive:host.keywordActiveId===item.id}" @keydown.stop @focusout="host.dismissKeywordWindows(host._keywordPointerTarget,$event.relatedTarget)" @click="click">
      <button v-if="item.pinned" class="keywordPreviewClose" type="button" aria-label="Close keyword popup" @click.stop="host.closeKeywordWindow(item.id)">×</button>
      <keyword-preview-card :host="host" :item="item" draggable @dragstart="startDrag" @dragmove="moveDrag" @dragfinish="finishDrag"></keyword-preview-card>
    </section>`,
  };
  const Overlay = {
    props: ['host'], components: { 'keyword-preview-window': Window },
    template: `<teleport to="body"><div class="keywordPreviewOverlay" data-inline-focus-surface :data-density="host.uiDensity"><keyword-preview-window v-for="(item,index) in host.keywordWindows" :key="item.id" :host="host" :item="item" :order="index"></keyword-preview-window></div></teleport>`,
  };
  root.KeywordPopups = { mixin, Overlay, Details, SheetPreview, Card, Text, snapshot, cardContent, adjacentPosition };
})(typeof window === 'object' ? window : globalThis);
