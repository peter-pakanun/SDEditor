<template>
  <div class="appRoot" :data-density="uiDensity">
    <form ref="importUpdateZipFileForm" class="hidden">
      <input type="file" ref="importUpdateZipFile" accept="application/zip,.zip" @change="importUpdateZipChanged">
    </form>
    <form ref="importTranslatedZipFileForm" class="hidden">
      <input type="file" ref="importTranslatedZipFile" accept="application/zip,.zip" @change="importTranslatedZipChanged">
    </form>

    <EditorVersionGate
      :test-mode="testMode"
      :game-version-selected="gameVersionSelected"
      @select="selectGameVersion"
    />

    <EditorMigrationGate
      :pending-migration="pendingSingleVersionMigration"
      :migration-in-progress="migrationInProgress"
      :format-game-version="formatGameVersion"
      @confirm="confirmSingleVersionMigration"
    />

    <div class="settingPage centerContainer fixed inset-0 z-[2] flex items-center justify-center bg-app-bg" v-if="gameVersionSelected && (showSetting || needsInitialSettings)">
      <div class="box rounded-[5px] bg-app-bg2 px-[calc(5em*var(--density))] py-[calc(3em*var(--density))] shadow-app">
        <h3>Language to translate</h3>
        <select v-model="lang">
          <option v-for="lang in langs">{{ lang }}</option>
        </select>
        <h3>Theme</h3>
        <div class="inputField flex items-center gap-[calc(0.4em*var(--density))] [&>.textHL]:grow [&>input]:grow">
          <select v-model="theme">
            <option value="light">Light</option>
            <option value="grey">Grey</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <h3>Other settings</h3>
        <div class="inputField flex items-center gap-[calc(0.4em*var(--density))] [&>.textHL]:grow [&>input]:grow">
          <label for="uiDensity">UI density</label>
          <select id="uiDensity" v-model="uiDensity">
            <option value="compact">Compact</option>
            <option value="spacious">Spacious</option>
          </select>
        </div>
        <input type="checkbox" id="hideDNT" name="hideDNT" v-model="hideDNT">
        <label for="hideDNT"> Hide DNT</label>
        <br>
        <input type="checkbox" id="highlightDict" name="highlightDict" v-model="highlightDict">
        <label for="highlightDict"> Highlight words from Dictionary</label>
        <br>
        <input type="checkbox" id="shiftEnterSave" name="shiftEnterSave" v-model="shiftEnterSave">
        <label for="shiftEnterSave"> Shift + Enter to Save</label>
        <br>
        <input type="checkbox" id="autoOpenNextFile" name="autoOpenNextFile" v-model="autoOpenNextFile">
        <label for="autoOpenNextFile"> Auto open next file on save</label>
        <br>
        <button @click="settingsSaveClose">💾</button>
        <button @click="exportSettingsClicked" title="Export settings">📤</button>
        <button @click="importSettingsClicked" title="Import settings">📥</button>
        <button @click.stop.prevent="startFromScratch" title="Delete selected-version translated workspace and history">Start from scratch</button>
        <form ref="importSettingsFileForm">
          <input type="file" id="importSettingsFile" @change="importSettingsFileChanged" ref="importSettingsFile"
            accept="application/json" class="invisible w-0 p-0">
        </form>
      </div>
    </div>

    <EditorMultiInstanceGate
      :visible="showMultiInstanceGate"
      @bypass="bypassMultiInstanceGate"
      @close-this="closeThisInstance"
    />

    <EditorLoadingPanel
      :game-version-selected="gameVersionSelected"
      :loading-progress="loadingProgress"
      :lang="lang"
      :needs-initial-settings="needsInitialSettings"
      :needs-post-migration-import="needsPostMigrationImport"
      @import-update="showImportUpdateZipDialog"
      @start-from-scratch="startFromScratch"
    />

    <div v-if="gameVersionSelected && loadingProgress >= 100 && !editorVisible && !needsInitialSettings">
      <div class="topbar flex items-center justify-between bg-app-bg2 [&>div>button]:mr-[calc(0.5em*var(--density))] [&>div>button]:w-[4em] [&>div>button]:align-middle [&>div>input]:mr-[calc(0.5em*var(--density))] [&>div>input]:w-[7em] [&>div>input]:align-middle [&>div]:inline-block [&>div]:px-[calc(1.5em*var(--density))] [&>div]:py-[calc(1em*var(--density))]">
        <div class="pagination">
          <button @click.exact="exportZip(false)" @click.ctrl="exportZip(true)" title="Ctrl + Click to do a full export">💾</button>
          <button @click="showSetting = true">⚙️</button>
          <button @click="importZipClicked" title="Import ZIP">📦</button>
          <input type="number" v-model.number="currentPage" min="1" v-bind:max="pageCount">
          <button @click="prevPage">⯇</button>
          <button v-for="n in pageButtons" @click="gotoPage(n)" :class="currentPage == n ? 'bg-app-highlight' : ''">{{ n }}</button>
          <button @click="nextPage">⯈</button>
        </div>
        <div>
          <input class="!w-[9em]" type="text" readonly v-bind:value="'Missing: ' + statistic.isMissing" title="File missing translation">
          <input class="!w-[9em]" type="text" readonly v-bind:value="'Done: ' + statistic.hasChanges" title="Files with saved translations">
          <input class="!w-[9em]" type="text" readonly v-bind:value="'Review: ' + statistic.needsReview" title="Source changed since last translation save">
          <span></span>
          <input id="searchInp" ref="searchInput" class="!w-[10em] transition-[width] duration-300 ease-in-out focus:!w-[20em]" type="text" placeholder="Search..." v-model="searchText" @input="filterDesc">

          <select v-model="filterSelect">
            <option value="new">New statfiles</option>
            <option value="blank">Blank only</option>
            <option value="done">Done only</option>
            <option value="review">Need review only</option>
            <option value="all">Show All</option>
          </select>
        </div>
      </div>

      <EditorImportDialog
        :visible="importDialogVisible"
        @close="closeImportDialog"
        @import-next-version="importNextVersionZipClicked"
        @import-translated="importTranslatedZipClicked"
      />

      <EditorFileListTable
        :descs-display="descsDisplay"
        :current-sort="currentSort"
        :current-sort-icon="currentSortIcon"
        :elipsis-renderer="elipsisRenderer"
        @sort="sort"
        @edit="editFile"
      />
    </div>

    <div
      class="editor [--side-width:480px] [&_button]:!px-[calc(0.75em*var(--density))] [&_button]:!py-[calc(0.35em*var(--density))] [&_button]:!text-[calc(13px*var(--density))] [&_button]:!leading-[calc(2em*var(--density))] [&_h1]:m-0 [&_h1]:text-[calc(18px*var(--density))] [&_h3]:my-[calc(0.4em*var(--density))] [&_h3]:mb-[calc(0.6em*var(--density))] [&_h3]:text-[calc(12px*var(--density))] [&_h3]:font-semibold [&_input]:!px-[calc(0.75em*var(--density))] [&_input]:!py-[calc(0.35em*var(--density))] [&_input]:!text-[calc(13px*var(--density))] [&_input]:!leading-[calc(2em*var(--density))] [&_select]:!px-[calc(0.75em*var(--density))] [&_select]:!py-[calc(0.35em*var(--density))] [&_select]:!text-[calc(13px*var(--density))] [&_select]:!leading-[calc(2em*var(--density))] [&_textarea]:!px-[calc(0.75em*var(--density))] [&_textarea]:!py-[calc(0.35em*var(--density))] [&_textarea]:!text-[calc(13px*var(--density))] [&_textarea]:!leading-[calc(2em*var(--density))]"
      v-if="editorVisible"
      @keydown.esc="editorEsc"
      @keydown.shift.enter="editorShiftEnter"
    >
      <div class="edit box-border mr-[var(--side-width)] px-[calc(0.35em*var(--density))] [&::-webkit-scrollbar]:w-0">
        <EditorGamePreview
          :game-preview-frame="gamePreviewFrame"
          :game-preview-font-family="gamePreviewFontFamily"
          :game-preview-segments="gamePreviewSegments"
          :game-preview-var-key-list="gamePreviewVarKeyList"
          :preview-ggg-vars="previewGggVars"
          :translation-editor-bcp47="translationEditorBcp47"
          @set-frame="setGamePreviewFrame"
          @update-var="updatePreviewGggVar"
        />

        <EditorActionBar
          :warning-count="editorDiagnosticWarningCount"
          :warning-title="editorDiagnosticWarningTitle"
          :error-count="editorDiagnosticErrorCount"
          :error-title="editorDiagnosticErrorTitle"
          :translation-read-only="editorTranslationReadOnly"
          @save="editorSave"
          @exit="editorExit"
        />

        <EditorStatusBanners
          :current-desc="editorCurrentEditingDesc"
          :compare-active="editorCompareActive"
          :compare-title="editorCompareTitle"
          @exit-compare="exitEditorCompareMode"
          @show-source-history="sideTab = 'history'; setHistoryMode('source')"
          @toggle-english-diff="toggleEditorEnglishDiff"
          @confirm-unchanged="confirmTranslationUnchanged"
        />

        <div class="editBlock mt-[calc(0.6em*var(--density))] bg-app-bg2 px-[calc(1em*var(--density))] py-[calc(0.6em*var(--density))] [&>*]:my-[calc(0.6em*var(--density))] [&_input]:block [&_input]:w-full [&_textarea]:block [&_textarea]:w-full" v-for="(editorBlock, index) in editorBlocks">
          <div class="inputField flex items-center gap-[calc(0.4em*var(--density))] [&>.textHL]:grow [&>input]:grow">
            <div v-if="editorBlock.isTable" class="tableEditorStack min-w-0 grow overflow-x-auto p-[calc(0.15em*var(--density))]" :style="{ '--table-columns': editorTableColumnCount(editorBlock) }">
              <div class="tableEditorRow grid w-full min-w-max grid-cols-[repeat(var(--table-columns,_1),_minmax(12em,_1fr))] gap-[calc(0.45em*var(--density))]">
                <div class="tableEditorCell relative min-w-0" v-for="(column, colIndex) in editorBlock.tableColumns" :class="!column.englishExists || !column.translationExists ? 'shadow-[inset_0_0_0_1px_var(--color-line-diff)]' : ''">
                  <div v-if="editorShowEnglishDiff" class="englishDiff tableEnglishDiff min-h-[calc(2em*var(--density))] whitespace-pre-wrap border border-black bg-app-element px-[calc(0.6em*var(--density))] py-[calc(0.35em*var(--density))] text-[calc(13px*var(--density))] leading-[calc(2em*var(--density))]" v-html="column.englishDiffHtml"></div>
                  <div v-else class="textHL" :class="{ multiline: column.isMultiline }">
                    <input v-if="!column.isMultiline" type="text" placeholder="English" readonly lang="en" v-model="column.english" tabindex="-1">
                    <textarea v-else placeholder="English" readonly lang="en" v-model="column.english" :ref='"english_" + index + "_" + colIndex' tabindex="-1" rows="3" @scroll="syncHlScroll('english', index, colIndex)"></textarea>
                    <div class="HLter" :ref='"englishHLter_" + index + "_" + colIndex' v-html="column.englishHLter" @click.ctrl="altClickHighlight($event, column)" @click.alt="copySpanToClipboard" @click.exact="copySpanToTranslation($event, column, index, colIndex)"></div>
                  </div>
                </div>
              </div>
              <div v-if="editorCompareActive && editorCompareMode === 'translation'" class="tableEditorRow tableEditorTranslation mt-[calc(0.35em*var(--density))] grid w-full min-w-max grid-cols-[repeat(var(--table-columns,_1),_minmax(12em,_1fr))] gap-[calc(0.45em*var(--density))]">
                <div class="tableEditorCell relative min-w-0" v-for="(diffColumn, colIndex) in editorBlock.translationCompareColumns" :class="!diffColumn.oldTranslationExists || !diffColumn.newTranslationExists ? 'shadow-[inset_0_0_0_1px_var(--color-line-diff)]' : ''">
                  <div class="englishDiff tableEnglishDiff min-h-[calc(2em*var(--density))] whitespace-pre-wrap border border-black bg-app-element px-[calc(0.6em*var(--density))] py-[calc(0.35em*var(--density))] text-[calc(13px*var(--density))] leading-[calc(2em*var(--density))]" v-html="diffColumn.translationDiffHtml"></div>
                </div>
              </div>
              <div v-else class="tableEditorRow tableEditorTranslation mt-[calc(0.35em*var(--density))] grid w-full min-w-max grid-cols-[repeat(var(--table-columns,_1),_minmax(12em,_1fr))] gap-[calc(0.45em*var(--density))]">
                <div class="tableEditorCell relative min-w-0" v-for="(column, colIndex) in editorBlock.tableColumns" :class="!column.englishExists || !column.translationExists ? 'shadow-[inset_0_0_0_1px_var(--color-line-diff)]' : ''">
                  <div class="textHL" :class="{ multiline: column.isMultiline }">
                    <input v-if="!column.isMultiline" type="text" placeholder="Translation" v-model="column.translation" :lang="translationEditorBcp47" :readonly="editorTranslationReadOnly" :ref='"translation_" + index + "_" + colIndex' @focus="setEditorFocus(index, colIndex)" @keydown="translationKeydown($event, index, colIndex)" @keyup.alt="hotkeyPasteHL($event, editorBlock, index, colIndex)" @input="tableColumnInput(editorBlock, index, colIndex)">
                    <textarea v-else class="multilineField border-app-accent bg-app-element" rows="4" placeholder="Translation" v-model="column.translation" :lang="translationEditorBcp47" :readonly="editorTranslationReadOnly" :ref='"translation_" + index + "_" + colIndex' @focus="setEditorFocus(index, colIndex)" @keydown="translationKeydown($event, index, colIndex)" @keyup.alt="hotkeyPasteHL($event, editorBlock, index, colIndex)" @input="tableColumnInput(editorBlock, index, colIndex)" @scroll="syncHlScroll('translation', index, colIndex)"></textarea>
                    <div class="HLter noPointer" :ref='"translationHLter_" + index + "_" + colIndex' v-html="column.translationHLter" @mousedown="diagnosticHighlightMouseDown($event, index, colIndex)"></div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="textHL" :class="{ multiline: editorBlock.isMultiline }">
              <div v-if="editorShowEnglishDiff" class="englishDiff whitespace-pre-wrap border border-black bg-app-element px-[calc(0.6em*var(--density))] py-[calc(0.35em*var(--density))] text-[calc(13px*var(--density))] leading-[calc(2em*var(--density))]" v-html="editorBlock.englishDiffHtml"></div>
              <template v-else>
                <input v-if="!editorBlock.isMultiline" type="text" placeholder="English" readonly lang="en" v-model="editorBlock.english" tabindex="-1">
                <textarea v-else placeholder="English" readonly lang="en" v-model="editorBlock.english" :ref='"english_" + index' tabindex="-1" rows="3" @scroll="syncHlScroll('english', index)"></textarea>
                <div class="HLter" :ref='"englishHLter_" + index' v-html="editorBlock.englishHLter" @click.ctrl="altClickHighlight($event, editorBlock)" @click.alt="copySpanToClipboard" @click.exact="copySpanToTranslation($event, editorBlock, index)"></div>
              </template>
            </div>
            <div v-if="editorBlock.isTable" class="multilineIcon flex select-none items-center px-[0.5em] opacity-[0.85]" :class="editorBlock.metaColsTr !== editorBlock.metaColsEn ? 'font-bold text-[#B00000]' : ''" title="Table content">@</div>
            <div v-if="editorBlock.isMultiline" class="multilineIcon flex select-none items-center px-[0.5em] opacity-[0.85]" :class="editorBlock.multilineLineMismatch ? 'font-bold text-[#B00000]' : ''" title="Multiline content">↵</div>
            <button @click="useRegex(editorBlock)" tabindex="-1">📑</button>
          </div>
          <div v-if="editorCompareActive && editorCompareMode === 'translation' && !editorBlock.isTable" class="englishDiff whitespace-pre-wrap border border-black bg-app-element px-[calc(0.6em*var(--density))] py-[calc(0.35em*var(--density))] text-[calc(13px*var(--density))] leading-[calc(2em*var(--density))]" v-html="editorBlock.translationDiffHtml"></div>
          <template v-else-if="editorBlock.isTable"></template>
          <div v-else-if="!editorBlock.isMultiline" class="textHL">
            <input type="text" placeholder="Translation" v-model="editorBlock.translation" :lang="translationEditorBcp47" :readonly="editorTranslationReadOnly" :ref='"translation_" + index' @focus="setEditorFocus(index)" @keydown="translationKeydown($event, index)" @keyup.alt="hotkeyPasteHL($event, editorBlock, index)" @input="translationInput(editorBlock, index)">
            <div class="HLter noPointer" :ref='"translationHLter_" + index' v-html="editorBlock.translationHLter" @mousedown="diagnosticHighlightMouseDown($event, index)"></div>
          </div>
          <div v-else class="textHL multiline">
            <textarea class="multilineField border-app-accent bg-app-element" rows="4" placeholder="Translation" v-model="editorBlock.translation" :lang="translationEditorBcp47" :readonly="editorTranslationReadOnly" :ref='"translation_" + index' @focus="setEditorFocus(index)" @keydown="translationKeydown($event, index)" @keyup.alt="hotkeyPasteHL($event, editorBlock, index)" @input="normalizeMultilineEditorBlock(editorBlock, index)" @scroll="syncHlScroll('translation', index)"></textarea>
            <div class="HLter noPointer" :ref='"translationHLter_" + index' v-html="editorBlock.translationHLter" @mousedown="diagnosticHighlightMouseDown($event, index)"></div>
          </div>
          <EditorBlockMeta
            :editor-block="editorBlock"
            :block-diagnostic-title="blockDiagnosticTitle"
          />
          <div class="inputField flex items-center gap-[calc(0.4em*var(--density))] [&>.textHL]:grow [&>input]:grow" v-for="word in editorBlock.words">
            <input type="text" placeholder="Captured" v-model="word.captured" readonly>
            <input type="text" placeholder="Replace" v-model="word.replace" :lang="translationEditorBcp47" @input="doTranslationReplace(editorBlock, true)">
          </div>
        </div>
      </div>

      <div class="side fixed right-0 top-0 z-[1] box-border h-[calc(100%_-_(120px*var(--density)))] w-[var(--side-width)] overflow-y-auto overflow-x-hidden px-[calc(0.35em*var(--density))] [&::-webkit-scrollbar]:w-0 [&_button]:!px-[calc(0.5em*var(--density))] [&_button]:!py-[calc(0.25em*var(--density))] [&_button]:!leading-[calc(2em*var(--density))] [&_input]:!px-[calc(0.5em*var(--density))] [&_input]:!py-[calc(0.25em*var(--density))] [&_input]:!leading-[calc(2em*var(--density))] [&_select]:!px-[calc(0.5em*var(--density))] [&_select]:!py-[calc(0.25em*var(--density))] [&_select]:!leading-[calc(2em*var(--density))] [&_textarea]:!px-[calc(0.5em*var(--density))] [&_textarea]:!py-[calc(0.25em*var(--density))] [&_textarea]:!leading-[calc(2em*var(--density))]">
        <div class="twoSided sideHeader sticky top-0 z-[2] flex items-center justify-between gap-[calc(0.5em*var(--density))] bg-app-bg py-[calc(0.25em*var(--density))]">
          <div class="sideTabs flex gap-[calc(0.25em*var(--density))]">
            <button class="tabBtn" :class="sideTab === 'dictionary' ? 'bg-app-highlight' : ''" @click="sideTab = 'dictionary'">📚 Dictionary</button>
            <button class="tabBtn" :class="sideTab === 'regex' ? 'bg-app-highlight' : ''" @click="sideTab = 'regex'">📑 Regex</button>
            <button class="tabBtn" :class="sideTab === 'history' ? 'bg-app-highlight' : ''" @click="sideTab = 'history'">🕒 History</button>
          </div>
          <button v-if="sideTab !== 'history'" @click="sideAddClicked()">➕</button>
        </div>

        <div v-if="sideTab === 'dictionary'">
          <input class="sideFilter mt-[calc(0.5em*var(--density))] w-full" type="text" v-model="dictionaryFilter" ref="dictionaryFilterInput" placeholder="Filter dictionary..." @keydown.esc="dictionaryFilter = ''">
          <div
            class="editBlock relative mt-[calc(0.5em*var(--density))] bg-app-bg2 px-[calc(0.6em*var(--density))] py-[calc(0.5em*var(--density))] transition-[transform,box-shadow] duration-[320ms] before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[4px] before:bg-transparent before:content-[''] after:pointer-events-none after:absolute after:inset-0 after:bg-app-highlight after:opacity-0 after:transition-opacity after:duration-[320ms] after:content-[''] [&_input]:block [&_input]:w-full [&_textarea]:block [&_textarea]:w-full"
            v-for="word in filteredDictionary"
            :key="word._id"
            :class="[
              isDictionaryEntryFound(word) ? 'shadow-[inset_0_0_0_1px_var(--color-element-highlight)] before:bg-app-highlight' : '',
              word._id === dictionaryFlashId ? '-translate-x-[6px] after:opacity-20' : '',
            ]"
          >
            <div class="twoSided dictEntryBlock relative flex justify-between">
              <div class="w-full flex-1">
                <div class="dictRow flex grow gap-[calc(0.4em*var(--density))] pr-[calc(2.6em*var(--density))] [&>input]:w-1/2" :data-dict-id="word._id">
                  <input type="text" v-model="word.find" placeholder="Find" lang="en" :class="isDictionaryEntryFindMatched(word) ? 'shadow-[inset_3px_0_0_var(--color-element-highlight)]' : ''">
                  <input type="text" v-model="word.replace" placeholder="Replace" :lang="translationEditorBcp47" @keydown.enter="onDictionaryReplaceEnter">
                </div>
                <div class="dictAltHeader mt-[calc(0.35em*var(--density))] flex items-center justify-between gap-[calc(0.5em*var(--density))] opacity-90">
                  <span class="text-[calc(0.9em*var(--density))]">Alternates</span>
                  <button class="!px-[calc(0.35em*var(--density))] !py-[calc(0.15em*var(--density))]" @click="addDictionaryAltRow(word)">➕</button>
                </div>
                <div class="dictAltRow mt-[calc(0.25em*var(--density))] flex gap-[calc(0.4em*var(--density))] pl-[calc(0.9em*var(--density))] opacity-95 [&>button]:!px-[calc(0.35em*var(--density))] [&>button]:!py-[calc(0.15em*var(--density))] [&>input]:w-1/2 [&>input]:text-[calc(0.9em*var(--density))]" v-for="alt in (word.alts || [])" :key="alt._id" :data-dict-id="word._id" :data-dict-alt-id="alt._id">
                  <input type="text" v-model="alt.find" placeholder="Find" lang="en" :class="isDictionaryAltFindMatched(word, alt) ? 'shadow-[inset_3px_0_0_var(--color-element-highlight)]' : ''">
                  <input type="text" v-model="alt.replace" placeholder="Replace" :lang="translationEditorBcp47" @keydown.enter="onDictionaryReplaceEnter">
                  <button @click="removeDictionaryAltRow(word, alt)">🗑️</button>
                </div>
                <details class="dictTlnote mt-[calc(0.35em*var(--density))]">
                  <summary class="cursor-pointer select-none opacity-[0.85]">TL note</summary>
                  <textarea class="mt-[calc(0.35em*var(--density))] resize-y" rows="3" v-model="word.tlnote" placeholder="Translator note (shared)" :lang="translationEditorBcp47"></textarea>
                </details>
              </div>
              <button class="dictDeleteBtn absolute right-0 top-0 !px-[calc(0.35em*var(--density))] !py-[calc(0.15em*var(--density))]" @click="removeVocab(word)">🗑️</button>
            </div>
          </div>
        </div>

        <div v-if="sideTab === 'regex'">
          <input class="sideFilter mt-[calc(0.5em*var(--density))] w-full" type="text" v-model="regexFilter" ref="regexFilterInput" placeholder="Filter regex..." @keydown.esc="regexFilter = ''">
          <div class="editBlock relative mt-[calc(0.5em*var(--density))] bg-app-bg2 px-[calc(0.6em*var(--density))] py-[calc(0.5em*var(--density))] transition-[transform,box-shadow] duration-[320ms] before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[4px] before:bg-transparent before:content-[''] after:pointer-events-none after:absolute after:inset-0 after:bg-app-highlight after:opacity-0 after:transition-opacity after:duration-[320ms] after:content-[''] [&_input]:block [&_input]:w-full [&_textarea]:block [&_textarea]:w-full" v-for="regex in filteredRegexes">
            <div class="twoSided flex justify-between gap-[calc(0.5em*var(--density))]">
              <div class="flex-1">
                <div class="inputField flex items-center gap-[calc(0.4em*var(--density))] [&>.textHL]:grow [&>input]:grow">
                  <input type="text" v-model="regex.find" autocorrect="off" autocomplete="off" placeholder="Find (regex)">
                  <button @click="moveRegexUp(regex)">🡩</button>
                </div>
                <div class="inputField flex items-center gap-[calc(0.4em*var(--density))] [&>.textHL]:grow [&>input]:grow">
                  <input type="text" v-model="regex.replace" autocorrect="off" autocomplete="off" placeholder="Replace">
                  <button @click="moveRegexDown(regex)">🡫</button>
                </div>
              </div>
              <button @click="removeRegex(regex)">🗑️</button>
            </div>
          </div>
        </div>

        <div v-if="sideTab === 'history'" class="historyPanel pt-[calc(0.5em*var(--density))]">
          <EditorHistoryPanel
            :current-desc="editorCurrentEditingDesc"
            :history-mode="historyMode"
            :lang="lang"
            :history-loading="historyLoading"
            :history-items="historyItems"
            :history-selected-a="historySelectedA"
            :history-selected-b="historySelectedB"
            :history-diff-html="historyDiffHtml"
            :format-history-time="formatHistoryTime"
            @set-mode="setHistoryMode"
            @pick="pickHistoryRevision"
            @restore="restoreHistoryRevision"
            @clear="clearHistorySelection"
          />
        </div>
      </div>

      <EditorClipboardDock
        v-model="editorClipboard"
        :translation-editor-bcp47="translationEditorBcp47"
      />

      <div v-if="hlPopup.visible" class="hlPopupBackdrop fixed inset-0 z-50" @mousedown="closeHlPopup">
        <div class="hlPopup fixed rounded border border-black bg-app-bg2 p-[calc(0.5em*var(--density))] shadow-popup" :style="{ left: hlPopup.x + 'px', top: hlPopup.y + 'px', width: hlPopup.width + 'px' }" @mousedown.stop>
          <input class="hlPopupFilter mb-[calc(0.5em*var(--density))] w-full" type="text" ref="hlPopupFilter" v-model="hlPopup.filter" placeholder="Filter highlights" @keydown="hlPopupFilterKeydown" @input="applyHlPopupFilter">
          <div class="hlPopupList max-h-[40vh] overflow-auto border border-black bg-app-element">
            <div
              v-for="(item, i) in hlPopup.filtered"
              class="hlPopupItem flex min-w-0 cursor-pointer select-none items-center gap-[calc(0.6em*var(--density))] px-[calc(0.6em*var(--density))] py-[calc(0.4em*var(--density))] hover:bg-[color-mix(in_srgb,var(--color-element-highlight)_20%,transparent)]"
              :class="[
                i === hlPopup.selectedIndex ? 'bg-[color-mix(in_srgb,var(--color-element-highlight)_20%,transparent)]' : '',
                item.isAlt ? 'pl-[calc(1.2em*var(--density))] opacity-[0.92]' : '',
                item.exactMatch ? 'font-bold' : '',
                item.mustCreate ? 'font-bold text-app-accent' : '',
              ]"
              @mouseenter="hlPopup.selectedIndex = i"
              @mousedown.prevent="insertHlPopupItem(item)"
            >
              <span class="hlPopupItemLabel min-w-0 flex-auto overflow-hidden text-ellipsis whitespace-nowrap">{{ item.label }}</span>
              <span v-if="i === hlPopup.selectedIndex && hlPopupCtrlEnterPillText(item)" class="hlPopupHotkeyPill flex-none rounded-full border border-[rgba(0,0,0,0.55)] bg-[rgba(0,0,0,0.1)] px-[calc(0.5em*var(--density))] py-[calc(0.12em*var(--density))] text-[calc(0.78em*var(--density))] opacity-90">{{ hlPopupCtrlEnterPillText(item) }}</span>
            </div>
            <div v-if="hlPopup.filtered.length === 0" class="hlPopupEmpty p-[calc(0.6em*var(--density))] opacity-80">No highlights</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" src="./sdeEditorOptions.ts"></script>
