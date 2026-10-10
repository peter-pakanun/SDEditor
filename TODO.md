# TODO

- [x] Add independent named version IDs with assigned StatDescription/ClientText groups and preserve legacy all-team StatDescription versions.
- [x] Parse/export ClientText XLSX/XLSM locally, retain Developer notes/raw text and require the configurable French normal/Gender pair.
- [x] Add per-field Missing/Outdated/review/Revised rules, durable per-ID saves/history/retries and local TM learned from valid shared saves.
- [x] Validate shared ClientText publication/collection and a second production-file browser run; record phase timings and concurrent-load limits.
- [x] Validate ClientText draft reload, failed upload/resume, proof-verified saves and frozen collection export.
- [x] Validate mixed new StatDescription/ClientText groups and both frozen collection formats in a disposable browser.
- [x] Add ClientText local/shared history and field-aware diff, guarded draft restores, and lazy verified previous-version comparisons.
- [x] Resolve predecessors through release ancestry past omitted content, including independent per-team StatDescription carry; validate with a limited catalog and changed English.
- [x] Validate repeated-original StatDescription versions, independent group saves, cancelled selection and offline activation in a disposable browser.
- [ ] Deploy API schema v18 first, then the IndexedDB v11 frontend; verify original artifacts, production backup restore and hosted access/synchronization.

- [x] In statfiles with several lines, compare these lines and mark differences with another color
- [x] Mark block of symbols with variable (like space_{xxx}%space), copy this block to clipboard with ctrl+click, or paste them below with single click
- [x] Add function of viewing/comparing files, that were changed for set period of time
- [x] Add sorting variant "like in Missing***"
- [x] Add counter of files, that needed to be translated
- [x] Saving a file with empty translation field with remove it from list. Add a confirmation window please
- [x] Add an option to save Dictionary. If there is a word in line for translation, that is already in dictionary, move it on top of dictionary list and mark it red. If there are many, move and mark all of them
- [x] If there is a variable with {} in line, but there is no {} in translation line - make a confirmation window noting on that
- [x] Make an option not to remove translated in one session files from the list, but to mark them with other color like green
- [x] Make a small clipboard window on page with translation, under dictionary and regex to past and copy and text
- [x] Make a full name of file appear on translation page
- [ ] Refactor file navigation, add a hotkey to navigate to next/previous file and with shift to skip translated files
- [ ] Refactor to 3 layers of data: master, staged, changed
  - Master layer: original files, readonly, only update on importing next version
  - Staged layer: when user save a file, it is added to this layer
    - When you export files, you export only files from this layer
  - Changed layer: when user change a file, the changes are added to this layer
