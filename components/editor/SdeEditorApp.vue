<template>
  <div class="appRoot" :data-density="uiDensity">
    <form ref="importUpdateZipFileForm" style="display: none;">
      <input type="file" ref="importUpdateZipFile" accept="application/zip,.zip" @change="importUpdateZipChanged">
    </form>
    <form ref="importTranslatedZipFileForm" style="display: none;">
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

    <div class="settingPage centerContainer" v-if="gameVersionSelected && (showSetting || needsInitialSettings)">
      <div class="box">
        <h3>Language to translate</h3>
        <select v-model="lang">
          <option v-for="lang in langs">{{ lang }}</option>
        </select>
        <h3>Theme</h3>
        <div class="inputField">
          <select v-model="theme">
            <option value="light">Light</option>
            <option value="grey">Grey</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <h3>Other settings</h3>
        <div class="inputField">
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
            accept="application/json" style="visibility: hidden; width: 0; padding: 0;">
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
      <div class="topbar">
        <div class="pagination">
          <button @click.exact="exportZip(false)" @click.ctrl="exportZip(true)" title="Ctrl + Click to do a full export">💾</button>
          <button @click="showSetting = true">⚙️</button>
          <button @click="importZipClicked" title="Import ZIP">📦</button>
          <input type="number" v-model.number="currentPage" min="1" v-bind:max="pageCount">
          <button @click="prevPage">⯇</button>
          <button v-for="n in pageButtons" @click="gotoPage(n)" v-bind:class="{ active: currentPage == n }">{{ n }}</button>
          <button @click="nextPage">⯈</button>
        </div>
        <div>
          <input style="width: 9em;" type="text" readonly v-bind:value="'Missing: ' + statistic.isMissing" title="File missing translation">
          <input style="width: 9em;" type="text" readonly v-bind:value="'Done: ' + statistic.hasChanges" title="Files with saved translations">
          <input style="width: 9em;" type="text" readonly v-bind:value="'Review: ' + statistic.needsReview" title="Source changed since last translation save">
          <span></span>
          <input id="searchInp" ref="searchInput" type="text" placeholder="Search..." v-model="searchText" @input="filterDesc">

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

    <div class="editor" v-if="editorVisible" @keydown.esc="editorEsc" @keydown.shift.enter="editorShiftEnter">
      <div class="edit">
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

        <div class="editBlock" v-for="(editorBlock, index) in editorBlocks">
          <div class="inputField">
            <div v-if="editorBlock.isTable" class="tableEditorStack" :style="{ '--table-columns': editorTableColumnCount(editorBlock) }">
              <div class="tableEditorRow">
                <div class="tableEditorCell" v-for="(column, colIndex) in editorBlock.tableColumns" :class="{ missingSource: !column.englishExists, missingTranslation: !column.translationExists }">
                  <div v-if="editorShowEnglishDiff" class="englishDiff tableEnglishDiff" v-html="column.englishDiffHtml"></div>
                  <div v-else class="textHL" :class="{ multiline: column.isMultiline }">
                    <input v-if="!column.isMultiline" type="text" placeholder="English" readonly lang="en" v-model="column.english" tabindex="-1">
                    <textarea v-else placeholder="English" readonly lang="en" v-model="column.english" :ref='"english_" + index + "_" + colIndex' tabindex="-1" rows="3" @scroll="syncHlScroll('english', index, colIndex)"></textarea>
                    <div class="HLter" :ref='"englishHLter_" + index + "_" + colIndex' v-html="column.englishHLter" @click.ctrl="altClickHighlight($event, column)" @click.alt="copySpanToClipboard" @click.exact="copySpanToTranslation($event, column, index, colIndex)"></div>
                  </div>
                </div>
              </div>
              <div v-if="editorCompareActive && editorCompareMode === 'translation'" class="tableEditorRow tableEditorTranslation">
                <div class="tableEditorCell" v-for="(diffColumn, colIndex) in editorBlock.translationCompareColumns" :class="{ missingTranslation: !diffColumn.oldTranslationExists || !diffColumn.newTranslationExists }">
                  <div class="englishDiff tableEnglishDiff" v-html="diffColumn.translationDiffHtml"></div>
                </div>
              </div>
              <div v-else class="tableEditorRow tableEditorTranslation">
                <div class="tableEditorCell" v-for="(column, colIndex) in editorBlock.tableColumns" :class="{ missingSource: !column.englishExists, missingTranslation: !column.translationExists }">
                  <div class="textHL" :class="{ multiline: column.isMultiline }">
                    <input v-if="!column.isMultiline" type="text" placeholder="Translation" v-model="column.translation" :lang="translationEditorBcp47" :readonly="editorTranslationReadOnly" :ref='"translation_" + index + "_" + colIndex' @focus="setEditorFocus(index, colIndex)" @keydown="translationKeydown($event, index, colIndex)" @keyup.alt="hotkeyPasteHL($event, editorBlock, index, colIndex)" @input="tableColumnInput(editorBlock, index, colIndex)">
                    <textarea v-else class="multilineField" rows="4" placeholder="Translation" v-model="column.translation" :lang="translationEditorBcp47" :readonly="editorTranslationReadOnly" :ref='"translation_" + index + "_" + colIndex' @focus="setEditorFocus(index, colIndex)" @keydown="translationKeydown($event, index, colIndex)" @keyup.alt="hotkeyPasteHL($event, editorBlock, index, colIndex)" @input="tableColumnInput(editorBlock, index, colIndex)" @scroll="syncHlScroll('translation', index, colIndex)"></textarea>
                    <div class="HLter noPointer" :ref='"translationHLter_" + index + "_" + colIndex' v-html="column.translationHLter" @mousedown="diagnosticHighlightMouseDown($event, index, colIndex)"></div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="textHL" :class="{ multiline: editorBlock.isMultiline }">
              <div v-if="editorShowEnglishDiff" class="englishDiff" v-html="editorBlock.englishDiffHtml"></div>
              <template v-else>
                <input v-if="!editorBlock.isMultiline" type="text" placeholder="English" readonly lang="en" v-model="editorBlock.english" tabindex="-1">
                <textarea v-else placeholder="English" readonly lang="en" v-model="editorBlock.english" :ref='"english_" + index' tabindex="-1" rows="3" @scroll="syncHlScroll('english', index)"></textarea>
                <div class="HLter" :ref='"englishHLter_" + index' v-html="editorBlock.englishHLter" @click.ctrl="altClickHighlight($event, editorBlock)" @click.alt="copySpanToClipboard" @click.exact="copySpanToTranslation($event, editorBlock, index)"></div>
              </template>
            </div>
            <div v-if="editorBlock.isTable" class="multilineIcon" :class="{ mismatch: editorBlock.metaColsTr !== editorBlock.metaColsEn }" title="Table content">@</div>
            <div v-if="editorBlock.isMultiline" class="multilineIcon" :class="{ mismatch: editorBlock.multilineLineMismatch }" title="Multiline content">↵</div>
            <button @click="useRegex(editorBlock)" tabindex="-1">📑</button>
          </div>
          <div v-if="editorCompareActive && editorCompareMode === 'translation' && !editorBlock.isTable" class="englishDiff" v-html="editorBlock.translationDiffHtml"></div>
          <template v-else-if="editorBlock.isTable"></template>
          <div v-else-if="!editorBlock.isMultiline" class="textHL">
            <input type="text" placeholder="Translation" v-model="editorBlock.translation" :lang="translationEditorBcp47" :readonly="editorTranslationReadOnly" :ref='"translation_" + index' @focus="setEditorFocus(index)" @keydown="translationKeydown($event, index)" @keyup.alt="hotkeyPasteHL($event, editorBlock, index)" @input="translationInput(editorBlock, index)">
            <div class="HLter noPointer" :ref='"translationHLter_" + index' v-html="editorBlock.translationHLter" @mousedown="diagnosticHighlightMouseDown($event, index)"></div>
          </div>
          <div v-else class="textHL multiline">
            <textarea class="multilineField" rows="4" placeholder="Translation" v-model="editorBlock.translation" :lang="translationEditorBcp47" :readonly="editorTranslationReadOnly" :ref='"translation_" + index' @focus="setEditorFocus(index)" @keydown="translationKeydown($event, index)" @keyup.alt="hotkeyPasteHL($event, editorBlock, index)" @input="normalizeMultilineEditorBlock(editorBlock, index)" @scroll="syncHlScroll('translation', index)"></textarea>
            <div class="HLter noPointer" :ref='"translationHLter_" + index' v-html="editorBlock.translationHLter" @mousedown="diagnosticHighlightMouseDown($event, index)"></div>
          </div>
          <EditorBlockMeta
            :editor-block="editorBlock"
            :block-diagnostic-title="blockDiagnosticTitle"
          />
          <div class="inputField" v-for="word in editorBlock.words">
            <input type="text" placeholder="Captured" v-model="word.captured" readonly>
            <input type="text" placeholder="Replace" v-model="word.replace" :lang="translationEditorBcp47" @input="doTranslationReplace(editorBlock, true)">
          </div>
        </div>
      </div>

      <div class="side fixed">
        <div class="twoSided sideHeader">
          <div class="sideTabs">
            <button class="tabBtn" :class="{ active: sideTab === 'dictionary' }" @click="sideTab = 'dictionary'">📚 Dictionary</button>
            <button class="tabBtn" :class="{ active: sideTab === 'regex' }" @click="sideTab = 'regex'">📑 Regex</button>
            <button class="tabBtn" :class="{ active: sideTab === 'history' }" @click="sideTab = 'history'">🕒 History</button>
          </div>
          <button v-if="sideTab !== 'history'" @click="sideAddClicked()">➕</button>
        </div>

        <div v-if="sideTab === 'dictionary'">
          <input class="sideFilter" type="text" v-model="dictionaryFilter" ref="dictionaryFilterInput" placeholder="Filter dictionary..." @keydown.esc="dictionaryFilter = ''">
          <div class="editBlock" v-for="word in filteredDictionary" :key="word._id" :class="{ dictFound: isDictionaryEntryFound(word), dictNew: word._id === dictionaryFlashId }">
            <div class="twoSided dictEntryBlock">
              <div>
                <div class="dictRow" :data-dict-id="word._id">
                  <input type="text" v-model="word.find" placeholder="Find" lang="en" :class="{ dictExactMatchFind: isDictionaryEntryFindMatched(word) }">
                  <input type="text" v-model="word.replace" placeholder="Replace" :lang="translationEditorBcp47" @keydown.enter="onDictionaryReplaceEnter">
                </div>
                <div class="dictAltHeader">
                  <span>Alternates</span>
                  <button @click="addDictionaryAltRow(word)">➕</button>
                </div>
                <div class="dictAltRow" v-for="alt in (word.alts || [])" :key="alt._id" :data-dict-id="word._id" :data-dict-alt-id="alt._id">
                  <input type="text" v-model="alt.find" placeholder="Find" lang="en" :class="{ dictExactMatchFind: isDictionaryAltFindMatched(word, alt) }">
                  <input type="text" v-model="alt.replace" placeholder="Replace" :lang="translationEditorBcp47" @keydown.enter="onDictionaryReplaceEnter">
                  <button @click="removeDictionaryAltRow(word, alt)">🗑️</button>
                </div>
                <details class="dictTlnote">
                  <summary>TL note</summary>
                  <textarea rows="3" v-model="word.tlnote" placeholder="Translator note (shared)" :lang="translationEditorBcp47"></textarea>
                </details>
              </div>
              <button class="dictDeleteBtn" @click="removeVocab(word)">🗑️</button>
            </div>
          </div>
        </div>

        <div v-if="sideTab === 'regex'">
          <input class="sideFilter" type="text" v-model="regexFilter" ref="regexFilterInput" placeholder="Filter regex..." @keydown.esc="regexFilter = ''">
          <div class="editBlock" v-for="regex in filteredRegexes">
            <div class="twoSided">
              <div>
                <div class="inputField">
                  <input type="text" v-model="regex.find" autocorrect="off" autocomplete="off" placeholder="Find (regex)">
                  <button @click="moveRegexUp(regex)">🡩</button>
                </div>
                <div class="inputField">
                  <input type="text" v-model="regex.replace" autocorrect="off" autocomplete="off" placeholder="Replace">
                  <button @click="moveRegexDown(regex)">🡫</button>
                </div>
              </div>
              <button @click="removeRegex(regex)">🗑️</button>
            </div>
          </div>
        </div>

        <div v-if="sideTab === 'history'" class="historyPanel">
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

      <div v-if="hlPopup.visible" class="hlPopupBackdrop" @mousedown="closeHlPopup">
        <div class="hlPopup" :style="{ left: hlPopup.x + 'px', top: hlPopup.y + 'px', width: hlPopup.width + 'px' }" @mousedown.stop>
          <input class="hlPopupFilter" type="text" ref="hlPopupFilter" v-model="hlPopup.filter" placeholder="Filter highlights" @keydown="hlPopupFilterKeydown" @input="applyHlPopupFilter">
          <div class="hlPopupList">
            <div v-for="(item, i) in hlPopup.filtered" class="hlPopupItem" :class="{ active: i === hlPopup.selectedIndex, alt: item.isAlt, exact: item.exactMatch, mustCreate: item.mustCreate }" @mouseenter="hlPopup.selectedIndex = i" @mousedown.prevent="insertHlPopupItem(item)">
              <span class="hlPopupItemLabel">{{ item.label }}</span>
              <span v-if="i === hlPopup.selectedIndex && hlPopupCtrlEnterPillText(item)" class="hlPopupHotkeyPill">{{ hlPopupCtrlEnterPillText(item) }}</span>
            </div>
            <div v-if="hlPopup.filtered.length === 0" class="hlPopupEmpty">No highlights</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" src="./sdeEditorOptions.ts"></script>
