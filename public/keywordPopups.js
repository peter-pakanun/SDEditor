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
  function snapshot(host, sources, translated) {
    const entries = new Map();
    let scope = {};
    for (const source of sources) for (const unit of source.units || []) {
      if (unit.sheet !== 'KeywordPopups' || unit.role !== 'normal') continue;
      if (entries.has(unit.recordId)) continue; // Active workbook wins over sibling references.
      if (!entries.size) scope = source.scope || {};
      const values = unit.id === host.ctCurrentUnit?.id && host.ctActive ? host.ctValues
        : root.ClientTextState.valuesFor(unit, source.saved?.[unit.id]);
      const read = name => {
        const field = unit.fields.find(field => field.name === name);
        return String((translated ? values?.[field?.id] : field?.source) ?? '');
      };
      entries.set(unit.recordId, { title: read('Info Title'), content: read('Info Content'), scope: copy(source.scope || {}) });
    }
    const language = translated ? host.ctWorkspace?.scope?.language || host.lang : 'English';
    return raw({ entries, language, translated, scope: copy(scope),
      variables: { ...host.gamePreviewVarValues }, font: host.getGamePreviewFontFamily(language) });
  }
  const mixin = {
    data: () => ({ keywordWindows: [], keywordWindowSequence: 0 }),
    computed: {
      keywordPreviewOrigin() {
        return JSON.stringify([this.ctActive, this.ctActive ? this.ctWorkspace?.scope : this.sourceIdentity,
          this.gameVersion, this.lang, this.ctActive ? this.ctSelection : this.editorCurrentEditingDesc?.filepath,
          this.cloudUser?.id]);
      },
    },
    watch: {
      keywordPreviewOrigin() {
        this._keywordAnchor = null; this._keywordPointerTarget = null;
        this.dismissKeywordWindows(null);
      },
    },
    mounted() {
      this._keywordEscape = event => {
        this._keywordKeyboardFocus = true;
        if (event.key !== 'Escape' || event.isComposing) return;
        const id = event.target?.closest?.('[data-keyword-window]')?.dataset.keywordWindow;
        if (!id) return;
        event.preventDefault(); event.stopImmediatePropagation();
        this.closeKeywordWindow(Number(id));
      };
      document.addEventListener('keydown', this._keywordEscape, true);
      this._keywordPointer = event => {
        if (event.type === 'pointermove' || event.type === 'pointerdown') this._keywordKeyboardFocus = false;
        this._keywordPointerTarget = event.type === 'pointerout' ? event.relatedTarget : event.target;
        this.dismissKeywordWindows(this._keywordPointerTarget, this._keywordKeyboardFocus ? document.activeElement : null);
      };
      document.addEventListener('pointerover', this._keywordPointer, true);
      document.addEventListener('pointerout', this._keywordPointer, true);
      document.addEventListener('pointermove', this._keywordPointer, true);
      document.addEventListener('pointerdown', this._keywordPointer, true);
    },
    beforeUnmount() {
      document.removeEventListener('keydown', this._keywordEscape, true);
      document.removeEventListener('pointerover', this._keywordPointer, true);
      document.removeEventListener('pointerout', this._keywordPointer, true);
      document.removeEventListener('pointermove', this._keywordPointer, true);
      document.removeEventListener('pointerdown', this._keywordPointer, true);
      this._keywordCatalog?.dispose();
    },
    methods: {
      async previewKeywordEnter(event, segment, translated, parent = null) {
        const anchor = event.currentTarget;
        if (this._keywordRestoreAnchor === anchor) { this._keywordRestoreAnchor = null; return; }
        // A covering card owns hit testing, even if a stale enter arrives from
        // a keyword underneath it while layout or stacking changes.
        const pointer = event.type === 'mouseenter';
        if (pointer && !anchor.contains(document.elementFromPoint(event.clientX, event.clientY))) return;
        const origin = parent ? parent.origin : this.keywordPreviewOrigin;
        this._keywordAnchor = anchor;
        this.dismissKeywordWindows(pointer ? anchor : this._keywordPointerTarget, pointer ? null : anchor, parent?.id);
        const matches = item => item.anchor === anchor && item.origin === origin && item.parentId === (parent?.id || null);
        const existing = this.keywordWindows.find(matches);
        if (existing) return existing;
        let context = parent?.context;
        if (!context) {
          let sources;
          if (this.ctActive) sources = [{ units: this.ctUnits, saved: this.ctSaved, scope: this.ctWorkspace?.scope }];
          else if (root.EditorReferenceCatalog) {
            const session = root.EditorReferenceCatalog.sessionFor(this);
            this._keywordCatalog ||= root.EditorReferenceCatalog.create(this);
            try { sources = (await this._keywordCatalog.load(session, this.lang)).sources; }
            catch (error) {
              if (error.stale || error.name === 'AbortError') return;
              sources = []; // Unavailable storage still gets an actionable empty popup.
            }
          }
          if (this.keywordPreviewOrigin !== origin || this._keywordAnchor !== anchor || !anchor.isConnected) return;
          if (pointer && !anchor.contains(document.elementFromPoint(event.clientX, event.clientY))) return;
          context = snapshot(this, sources || [], translated);
        }
        const opened = this.keywordWindows.find(matches);
        if (opened) return opened;
        const tag = segment.tagName || /^\[([^|\]]+)/.exec(segment.full || '')?.[1];
        const entry = context.entries.get(tag);
        const parse = text => this.buildGamePreviewSegments(text, { contentMode: 'clienttext' }).segments;
        const item = { id: ++this.keywordWindowSequence, parentId: parent?.id || null, context, origin,
          anchor: raw(anchor), pinned: false, title: parse(entry?.title || (entry ? '(empty)' : tag)),
          content: parse(entry?.content || '(empty)'),
          notice: !context.entries.size ? 'KeywordPopups data unavailable. Prepare ClientText references in Lookup.'
            : !entry ? 'Keyword not found in this workbook.'
              : context.translated && (!entry.title.trim() || !entry.content.trim()) ? 'Missing ' + context.language + ' translation.' : '' };
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
        const item = await this.previewKeywordEnter(event, segment, translated, parent);
        if (item) { this.pinKeywordWindow(item); await this.$nextTick(); document.getElementById('keyword-window-' + item.id)?.focus({ preventScroll: true }); }
      },
      dismissKeywordWindows(pointerTarget = this._keywordPointerTarget, focusTarget = null, parentId = null) {
        const keep = new Set();
        const retain = id => { while (id && !keep.has(id)) { keep.add(id); id = this.keywordWindows.find(item => item.id === id)?.parentId; } };
        retain(parentId);
        for (const target of [pointerTarget, focusTarget]) {
          retain(Number(target?.closest?.('[data-keyword-window]')?.dataset.keywordWindow));
          for (const item of this.keywordWindows) if (item.anchor === target || item.anchor.contains?.(target)) retain(item.id);
        }
        const retained = this.keywordWindows.filter(item => item.pinned || keep.has(item.id));
        if (retained.length !== this.keywordWindows.length) this.keywordWindows = retained;
      },
      raiseKeywordWindow(item) {
        if (!this.keywordWindows.some(value => value.id === item.id)) return;
        this.keywordWindows = [...this.keywordWindows.filter(value => value.id !== item.id), item];
      },
      pinKeywordWindow(item) { item.pinned = true; this.raiseKeywordWindow(item); },
      closeKeywordWindow(id) {
        const item = this.keywordWindows.find(value => value.id === id);
        if (!item) return;
        const focused = document.activeElement?.closest?.('[data-keyword-window]')?.dataset.keywordWindow === String(id);
        const remove = new Set([id]);
        // Independent pinned descendants survive closing their parent.
        let changed = true;
        while (changed) { changed = false; for (const value of this.keywordWindows) if (!value.pinned && remove.has(value.parentId) && !remove.has(value.id)) { remove.add(value.id); changed = true; } }
        this.keywordWindows = this.keywordWindows.filter(value => !remove.has(value.id));
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
  const Window = {
    props: ['host', 'item', 'order'], components: { 'keyword-preview-text': Text },
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
        if (event.button !== 0 || this._drag || event.target.closest('button,[role="button"]')) return;
        event.preventDefault(); event.stopPropagation();
        this.host.pinKeywordWindow(this.item); this.$el.focus({ preventScroll: true });
        this._drag = { id: event.pointerId, handle: event.currentTarget, x: this.x, y: this.y, clientX: event.clientX, clientY: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId); this.dragging = true;
      },
      moveDrag(event) {
        const drag = this._drag;
        if (!drag || drag.id !== event.pointerId) return;
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
      click(event) { this.host.pinKeywordWindow(this.item); if (!event.target.closest('button,[role="button"]')) this.$el.focus({ preventScroll: true }); },
    },
    template: `<section class="keywordPreviewWindow" :id="'keyword-window-'+item.id" :data-keyword-window="item.id" :data-language="item.context.language" tabindex="-1" role="dialog" aria-modal="false" :aria-labelledby="'keyword-title-'+item.id"
      :style="{left:x+'px',top:y+'px',maxWidth:maxWidth+'px',maxHeight:maxHeight+'px',zIndex:order+1,fontFamily:item.context.font}" :class="{keywordPreviewDragging:dragging}" @keydown.stop @focusin="host.raiseKeywordWindow(item)" @focusout="host.dismissKeywordWindows(host._keywordPointerTarget,$event.relatedTarget)" @click="click">
      <button v-if="item.pinned" class="keywordPreviewClose" type="button" aria-label="Close keyword popup" @click.stop="host.closeKeywordWindow(item.id)">×</button>
      <div class="keywordPreviewHeader" title="Drag to move and pin" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="finishDrag" @pointercancel="finishDrag" @lostpointercapture="finishDrag"><div class="keywordPreviewTitle" :id="'keyword-title-'+item.id"><keyword-preview-text :host="host" :segments="item.title" :item="item"></keyword-preview-text></div></div>
      <div class="gamePreviewContinue keywordPreviewSeparator" role="separator"></div>
      <div class="keywordPreviewContent"><keyword-preview-text :host="host" :segments="item.content" :item="item"></keyword-preview-text></div>
      <p v-if="item.notice" class="keywordPreviewNotice">{{ item.notice }}</p>
    </section>`,
  };
  const Overlay = {
    props: ['host'], components: { 'keyword-preview-window': Window },
    template: `<teleport to="body"><div class="keywordPreviewOverlay" data-inline-focus-surface :data-density="host.uiDensity"><keyword-preview-window v-for="(item,index) in host.keywordWindows" :key="item.id" :host="host" :item="item" :order="index"></keyword-preview-window></div></teleport>`,
  };
  root.KeywordPopups = { mixin, Overlay, snapshot, adjacentPosition };
})(typeof window === 'object' ? window : globalThis);
