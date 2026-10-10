/* Whole-entry alignment edits a scoped local draft; Save retains the original in history. */
(function (root) {
  'use strict';
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const copy = value => JSON.parse(JSON.stringify(value));
  const mixin = {
    data() { return { entryAlignment: null, entryAlignmentSelected: null, entryAlignmentApplying: false, entryAlignmentError: '' }; },
    computed: {
      entryAlignmentWarningPath() {
        const prefix = 'Translation count exceeds source entry count: ';
        const message = this.collaborationState?.error || '';
        const path = message.startsWith(prefix) ? message.slice(prefix.length) : '';
        return path && this.getDescByFilepath(path) ? path : '';
      },
      editorHasExcessTranslationEntries() {
        return !!this.editorCurrentEditingDesc && this.editorBlocks.length > this.editorCurrentEditingDesc.translations.English.length;
      },
      editorEntryAlignmentRequired() { return !this.editorCompareActive && this.editorHasExcessTranslationEntries; },
      entryAlignmentPending() { return this.entryAlignment ? root.EntryAlignment.pending(this.entryAlignment) : { unresolved: 0, unassigned: 0 }; },
      entryAlignmentReady() { return !!this.entryAlignment && root.EntryAlignment.ready(this.entryAlignment); },
      entryAlignmentPool() {
        const state = this.entryAlignment;
        return state ? state.items.filter(item => !state.slots.includes(item.id)) : [];
      },
    },
    watch: {
      editorCurrentEditingDesc() { this.clearEntryAlignment(); },
      editorSessionActive(active) { if (!active) this.clearEntryAlignment(); },
      editorToolsScope() { this.clearEntryAlignment(); },
      activeContentGroup() { this.clearEntryAlignment(); },
    },
    methods: {
      clearEntryAlignment() {
        this.entryAlignment = null; this.entryAlignmentSelected = null;
        this.entryAlignmentError = ''; this.entryAlignmentApplying = false;
        this._entryAlignmentBinding = null;
      },
      fileNeedsEntryAlignment(desc) {
        const lines = this.inlineDraftFor?.(desc.filepath)?.translations || desc.translations?.[this.lang] || [];
        return lines.length > (desc.translations?.English || []).length;
      },
      offerEntryAlignment() {
        if (!this.editorVisible || this.editorLoading || this.entryAlignment) return;
        if (this.editorEntryAlignmentRequired) this.startEntryAlignment();
        else if (this.editorDroppedCandidate && !this.editorDroppedConflict && !this._draftSession?.record
          && this.editorDroppedCandidate.snapshot.translations.length !== this.editorCurrentEditingDesc.translations.English.length) this.startEntryAlignment('dropped');
      },
      async openFileEntryAlignment(filepath) {
        if (await this.openInlineFullEditor(filepath, 'alignment') === false) return false;
        return !!this.entryAlignment;
      },
      startEntryAlignment(kind = 'draft', recovery = null) {
        if (!this.editorVisible || !this.editorReady || this.editorSaving || this.entryAlignmentApplying
          || this.editorCompareActive || this.editorDroppedConflict || this.ctActive) return false;
        const desc = this.editorCurrentEditingDesc;
        if (!desc) return false;
        const candidate = this.editorDroppedCandidate;
        if (kind === 'dropped' && !candidate) return false;
        const lines = kind === 'dropped' ? candidate.snapshot.translations.slice()
          : kind === 'history' ? recovery.translations.slice() : this.serializeEditorTranslations();
        // Old English is evidence only for the exact preserved translation being aligned.
        const oldEnglish = kind === 'history' ? recovery.english || []
          : candidate?.originSourceAvailable !== false && candidate
            && equal(lines, candidate.snapshot.translations) ? candidate.snapshot.english || [] : [];
        this.clearEntryAlignment();
        this._entryAlignmentBinding = { desc, blocks: this.editorBlocks, session: this._draftSession,
          scope: this.editorDraftScope(desc.filepath), context: this.captureCollaborationContext(),
          run: this._editorOpenRun, base: this._editorCollabBase, kind,
          english: JSON.stringify(desc.translations.English), lines: JSON.stringify(this.serializeEditorTranslations()),
          oldSnapshot: candidate?.originSourceAvailable !== false && candidate && equal(lines, candidate.snapshot.translations) ? copy(candidate.snapshot) : null,
          candidate: kind === 'dropped' ? JSON.stringify(candidate) : null };
        this.entryAlignment = root.EntryAlignment.create(desc.translations.English, lines, oldEnglish);
        this.closeHlPopup();
        return true;
      },
      entryAlignmentCurrent(binding = this._entryAlignmentBinding) {
        return !!binding && this._entryAlignmentBinding === binding && this.editorVisible && !this.editorLoading
          && !this.editorCompareActive
          && this.editorCurrentEditingDesc === binding.desc && this.editorBlocks === binding.blocks
          && this._draftSession === binding.session && this._editorOpenRun === binding.run
          && this._editorCollabBase === binding.base && this.draftScopeCurrent(binding.scope)
          && this.collaborationContextCurrent(binding.context)
          && JSON.stringify(binding.desc.translations.English) === binding.english
          && JSON.stringify(this.serializeEditorTranslations()) === binding.lines
          && (!binding.candidate || JSON.stringify(this.editorDroppedCandidate) === binding.candidate)
          && !this.editorDroppedConflict;
      },
      mutateEntryAlignment(action, ...args) {
        if (this.entryAlignmentApplying) return false;
        if (!this.entryAlignmentCurrent()) {
          this.entryAlignmentError = 'The file or editing context changed. Cancel alignment and reopen the file to review its current text.';
          return false;
        }
        root.EntryAlignment[action](this.entryAlignment, ...args);
        this.entryAlignmentError = '';
        return true;
      },
      selectEntryAlignmentItem(id) { if (!this.entryAlignmentApplying) this.entryAlignmentSelected = id; },
      entryAlignmentCondition(index, old = false) {
        const source = old ? this._entryAlignmentBinding?.oldSnapshot : this.editorCurrentEditingDesc;
        return [source?.variables?.[index], source?.remarks?.[index]].filter(value => value != null && String(value).trim()).join(' · ');
      },
      assignEntryAlignmentItem(index) {
        if (this.entryAlignmentSelected == null) return;
        if (this.mutateEntryAlignment('assign', this.entryAlignmentSelected, index)) this.entryAlignmentSelected = null;
      },
      dragEntryAlignmentItem(event, id) {
        if (this.entryAlignmentApplying || !this.entryAlignmentCurrent()) { event.preventDefault(); return; }
        this.entryAlignmentSelected = id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-sdeditor-entry', String(id));
      },
      dropEntryAlignmentItem(event, index) {
        event.preventDefault();
        const raw = event.dataTransfer.getData('application/x-sdeditor-entry');
        if (!/^\d+$/.test(raw)) return;
        const id = Number(raw);
        // Only accept a drag begun by a card in this scoped alignment session.
        if (!Number.isInteger(id) || id !== this.entryAlignmentSelected) return;
        this.assignEntryAlignmentItem(index);
      },
      async applyEntryAlignment() {
        if (!this.entryAlignmentReady || this.entryAlignmentApplying || this.editorSaving) return false;
        if (!this.entryAlignmentCurrent()) {
          this.entryAlignmentError = 'The file or editing context changed. Cancel alignment and reopen the file to review its current text.';
          return false;
        }
        const binding = this._entryAlignmentBinding, state = this.entryAlignment;
        const lines = root.EntryAlignment.translations(state);
        this.entryAlignmentApplying = true; this.entryAlignmentError = '';
        try {
          const blocks = await this.prepareMatchedEditorBlocks(state.english, lines, () => this.entryAlignmentCurrent(binding));
          if (!blocks || !this.entryAlignmentCurrent(binding)) {
            if (this._entryAlignmentBinding === binding) this.entryAlignmentError = 'The file changed while preparing alignment. Cancel alignment and reopen the file.';
            return false;
          }
          const session = binding.session;
          if (session) {
            const recovery = { translations: state.items.map(item => item.translation),
              english: state.items.map(item => item.english), savedAt: Date.now() };
            session.alignmentRecovery ||= [];
            if (!session.alignmentRecovery.some(item => equal(item.translations, recovery.translations))) session.alignmentRecovery.push(recovery);
            const current = JSON.parse(binding.lines);
            if (!equal(current, recovery.translations) && !session.alignmentRecovery.some(item => equal(item.translations, current))) {
              session.alignmentRecovery.push({ translations: current,
                english: current.map((_, index) => current.length === state.english.length ? state.english[index] : null), savedAt: Date.now() });
            }
          }
          this.applyPreparedEditorBlocks(blocks);
          this.editorShowEnglishDiff = false;
          this.clearEntryAlignment();
          this.refreshGamePreview();
          this.scheduleEditorDraft();
          const retained = await this.flushEditorDraft({ force: true });
          if (!retained || this.editorCurrentEditingDesc !== binding.desc || this._draftSession !== session
            || !this.draftScopeCurrent(binding.scope) || !this.collaborationContextCurrent(binding.context)) return false;
          this.$nextTick(() => {
            if (this.editorCurrentEditingDesc === binding.desc && this._draftSession === session
              && this.draftScopeCurrent(binding.scope) && this.collaborationContextCurrent(binding.context))
              this.getEditorRef('translation', 0, this.editorBlocks[0]?.isTable ? 0 : null)?.focus();
          });
          return true;
        } catch (error) {
          if (this._entryAlignmentBinding === binding) this.entryAlignmentError = 'Could not prepare the aligned draft. ' + error.message;
          return false;
        } finally { if (this._entryAlignmentBinding === binding) this.entryAlignmentApplying = false; }
      },
      entryAlignmentSaveRevisions(lines) {
        const recovery = this._draftSession?.alignmentRecovery;
        if (!recovery?.length) return null;
        const desc = this.editorCurrentEditingDesc, now = Date.now();
        const metadata = { filepath: desc.filepath, filename: desc.filename, filedir: desc.filedir,
          lang: this.lang, sourceHash: this.sourceIdentity };
        return [...recovery.map(item => ({ ...metadata, ...copy(item), note: 'Before entry alignment' })),
          { ...metadata, savedAt: now, note: 'save', translations: [...lines] }];
      },
      async alignHistoryRevision(revision) {
        const desc = this.editorCurrentEditingDesc;
        if (!desc || !revision || revision.legacyReference || this.editorSaving || this.entryAlignmentApplying
          || revision.filepath !== desc.filepath || revision.lang !== this.lang
          || (revision.sourceHash && revision.sourceHash !== this.sourceIdentity)
          || (revision.branchId && revision.branchId !== (this.branchId || 'default'))) return false;
        const scope = this.editorDraftScope(desc.filepath), context = this.captureCollaborationContext();
        if (this.inlineActive && await this.openInlineFullEditor(desc.filepath) === false) return false;
        if (!this.draftScopeCurrent(scope) || !this.collaborationContextCurrent(context)) return false;
        this.exitEditorCompareMode();
        return this.startEntryAlignment('history', revision);
      },
    },
  };
  const component = {
    props: { controller: { type: Object, required: true } },
    computed: { c() { return this.controller; } },
    mounted() { this.$el.querySelector('h2')?.focus(); },
    template: `
      <section class="entryAlignmentPanel" aria-label="Align translation entries" :aria-busy="c.entryAlignmentApplying">
        <h2 tabindex="-1">Align translation entries</h2>
        <p>{{ c.entryAlignment.english.length }} current English entries · {{ c.entryAlignment.items.length }} translation blocks.
          Drag a block onto its English entry, or select a block and click Place selected. Each block can be used once.</p>
        <p>Unique exact matches with preserved old English are placed automatically. Choose Leave blank for new entries and mark removed blocks as unused. Continue creates a local draft; Save keeps the original blocks in local history.</p>
        <div class="entryAlignmentColumns">
          <section>
            <h3>Current English → translation</h3>
            <div class="entryAlignmentSlots">
              <div v-for="(english, index) in c.entryAlignment.english" :key="index" class="entryAlignmentSlot" :class="{ resolved: c.entryAlignment.slots[index] !== null }" @dragover.prevent @drop="c.dropEntryAlignmentItem($event, index)">
                <strong>English #{{ index + 1 }}</strong><pre lang="en">{{ c.decodeEscapedNewlines(english) }}</pre>
                <small v-if="c.entryAlignmentCondition(index)">Entry condition: {{ c.entryAlignmentCondition(index) }}</small>
                <div v-if="Number.isInteger(c.entryAlignment.slots[index])" class="entryAlignmentCard" :class="{ selected: c.entryAlignmentSelected === c.entryAlignment.slots[index] }" :draggable="!c.entryAlignmentApplying" @dragstart="c.dragEntryAlignmentItem($event, c.entryAlignment.slots[index])" @dragend="c.entryAlignmentSelected = null">
                  <small>Translation block #{{ c.entryAlignment.slots[index] + 1 }}</small>
                  <pre :lang="c.translationEditorBcp47">{{ c.decodeEscapedNewlines(c.entryAlignment.items[c.entryAlignment.slots[index]].translation) || '(Blank block)' }}</pre>
                  <button type="button" @click="c.selectEntryAlignmentItem(c.entryAlignment.slots[index])" :aria-pressed="c.entryAlignmentSelected === c.entryAlignment.slots[index]" :disabled="c.entryAlignmentApplying">Select block #{{ c.entryAlignment.slots[index] + 1 }}</button>
                </div>
                <p v-else>{{ c.entryAlignment.slots[index] === 'blank' ? 'Left blank for translation' : 'Choose a translation block or leave this entry blank.' }}</p>
                <div class="entryAlignmentButtons">
                  <button type="button" @click="c.assignEntryAlignmentItem(index)" :disabled="c.entryAlignmentSelected === null || c.entryAlignmentApplying">Place selected at #{{ index + 1 }}</button>
                  <button type="button" @click="c.mutateEntryAlignment('leaveBlank', index)" :disabled="c.entryAlignmentApplying">Leave #{{ index + 1 }} blank</button>
                  <button v-if="c.entryAlignment.slots[index] !== null" type="button" @click="c.mutateEntryAlignment('unassign', index)" :disabled="c.entryAlignmentApplying">Clear #{{ index + 1 }}</button>
                </div>
              </div>
            </div>
          </section>
          <section>
            <h3>Available translation blocks</h3>
            <p v-if="!c.entryAlignmentPool.length">All blocks have been placed.</p>
            <div class="entryAlignmentPool">
              <div v-for="item in c.entryAlignmentPool" :key="item.id" class="entryAlignmentCard" :class="{ selected: c.entryAlignmentSelected === item.id, obsolete: item.obsolete }" :draggable="!c.entryAlignmentApplying" @dragstart="c.dragEntryAlignmentItem($event, item.id)" @dragend="c.entryAlignmentSelected = null">
                <small>Translation block #{{ item.id + 1 }}{{ item.obsolete ? ' · Unused' : '' }}</small>
                <pre :lang="c.translationEditorBcp47">{{ c.decodeEscapedNewlines(item.translation) || '(Blank block)' }}</pre>
                <details v-if="item.english !== null"><summary>Old English</summary><pre lang="en">{{ c.decodeEscapedNewlines(item.english) }}</pre><small v-if="c.entryAlignmentCondition(item.id, true)">Old entry condition: {{ c.entryAlignmentCondition(item.id, true) }}</small></details>
                <div class="entryAlignmentButtons">
                  <button type="button" @click="c.selectEntryAlignmentItem(item.id)" :aria-pressed="c.entryAlignmentSelected === item.id" :disabled="c.entryAlignmentApplying">Select block #{{ item.id + 1 }}</button>
                  <label><input type="checkbox" :checked="item.obsolete" @change="c.mutateEntryAlignment('setObsolete', item.id, $event.target.checked)" :disabled="c.entryAlignmentApplying"> Unused in this version</label>
                </div>
              </div>
            </div>
          </section>
        </div>
        <div class="entryAlignmentFooter">
          <p role="status">{{ c.entryAlignmentPending.unresolved }} English entries need a decision · {{ c.entryAlignmentPending.unassigned }} blocks need a position or an unused decision</p>
          <button type="button" class="btnPrimary" @click="c.applyEntryAlignment" :disabled="!c.entryAlignmentReady || c.entryAlignmentApplying">{{ c.entryAlignmentApplying ? 'Preparing…' : 'Continue editing' }}</button>
          <button type="button" @click="c.clearEntryAlignment" :disabled="c.entryAlignmentApplying">Cancel alignment</button>
          <p v-if="c.entryAlignmentError" class="collaborationError" role="alert">{{ c.entryAlignmentError }}</p>
        </div>
      </section>`,
  };
  root.EntryAlignmentUI = { mixin, component };
})(typeof window !== 'undefined' ? window : globalThis);
