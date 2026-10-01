# Cloud Backup, Shared Dictionaries, and Translation Collaboration

SDEditor saves locally in IndexedDB first. Google sign-in adds personal settings backup, a shared dictionary, translation collaboration for your assigned language, and file discussions with all translator teams. The static editor calls the separate API at `https://sdeditor-api.poemaid.com`; these instructions describe the implementation, not confirmation that the public API has been deployed.

## What Is Saved Where

| Data | Browser storage | Cloud |
| --- | --- | --- |
| Editor preferences and Regex rules | Saved for the current local/account profile | Personal to your Google account |
| Dictionary, including Alternates and TL notes | Separate dictionary for each language and profile | Shared among translators assigned to that language |
| Editor clipboard | Local to the profile | Not uploaded |
| Original source ZIP, unsaved typing, and legacy translation history | Local only | Not uploaded |
| Source manifest and saved translations | Cached locally with pending changes and recovery state | Shared by game, source version, and assigned language |
| New shared translation history | Available alongside local history | Author, timestamp, origin, and before/after versions |
| Selected/open file presence | Current browser session | Visible to participants in the same collaboration workspace; expires on disconnect |
| File comments and read receipts | Loaded into the current tab; unsent text stays in the tab | Comments shared by game and file path across all team languages and hashes; read receipts private to each account |

PoE1 and PoE2 use the same dictionary for a given language. Regex rules are personal; changing a Regex does not change another translator's rules. Translation collaboration separates each game, source version, and assigned language. Account changes detach the current collaboration session; pending work retains the account and version that created it. Continue exporting translated ZIPs as portable copies of your work.

## Sign In and Get Assigned

1. Open **Settings → Cloud backup → Backup using Google account** and choose your Google account. If a popup cannot open, sign-in uses a page redirect.
2. A new account shows **Not configured — awaiting admin language assignment**. You can keep editing locally, but settings and dictionaries do not sync until an administrator assigns your account.
3. After assignment, return to the editor to refresh access automatically. Settings shows your account and assigned language; sync warnings and errors appear when something needs attention.

The administrator opens **Settings → Cloud backup → Manage users**. Accounts appear after their first Google sign-in. Choose one language per account, including the administrator's own account when it needs backup. Clearing an assignment stops cloud access and preserves the user's local drafts. Reassignment does not delete or transfer the old language's shared dictionary.

You may still select another language in the editor. Its dictionary and translations stay local; your account cannot read or publish another language's dictionaries or translation workspace. File comments are shared across languages. Changing the language dropdown does not change the administrator's assignment or the team language shown on your comments.

The editor renews its session when you visit, return to the tab, or use the tool. A session expires after 30 days without renewal. If it expires, sign in again or choose **Return to local profile**; saved account drafts remain in this browser. Signing out also returns to the signed-out profile. A newly used account adopts the signed-out profile's starting data, never another account's private settings.

## Sync, Restore and Offline Work

Changes save in IndexedDB before cloud synchronization. Sync runs after edits, periodically while the editor is visible, and when connectivity or focus returns. Healthy sync is silent: there are no loading messages, success timestamps, or routine refresh/retry buttons. Existing content, scroll position, focus, and empty states stay stable during background requests. A cloud-unavailable warning means local work can continue; pending changes retry automatically. Settings offers **Sync now** only when a sync warning or error needs attention.

Warnings, errors, and conflicts remain visible until the relevant operation recovers successfully. Starting another attempt does not briefly dismiss a failure. Explicit actions such as saving, posting a comment, importing/exporting, scanning diagnostics, or requesting history can still show progress. Unread counts, translator presence, and source versions remain visible as useful workspace information.

When this browser first connects an account that already has cloud settings, those settings are restored automatically. The previous local settings and dictionaries are kept as a recovery copy. If there is no settings backup yet, the current settings become the account's initial backup. Later preference changes merge automatically; when the same preference changed both here and remotely, this browser's changed value is retained. The dictionary has its own merge and conflict workflow below.

If **Could not save in this browser** appears, keep the tab open and use **Retry local save**. A cloud status is not proof that an unsaved translation file has been exported. Do not clear site data to fix connection problems: it contains local translations, history and drafts.

Use one editor tab when possible. Independent changes from two tabs can merge, but conflicting local saves stop and preserve the current editor draft. If the warning asks you to export and reload, export the current settings/dictionary before reloading that tab so its pending changes remain recoverable.

## Resolve Dictionary Conflicts

Changes to different terms, independent fields and compatible alternate additions are combined automatically. When both sides change the same content incompatibly, a **⚡ count** button appears immediately before **Scan diagnostics**. The same resolver is available from Settings.

Open it to compare **Local · yours** on the left, **Remote · shared** on the right, and the **Result** in the center. There are only two choice groups:

- **Alternates** includes the main Find/Replace pair, alternate rows and their ordering. Choose **Keep local alternates** or **Keep remote alternates** when needed.
- **TL note** chooses the local or remote note independently.

Independent changes are already included in both candidates. A group without a conflict says **Automatically merged** and needs no choice. The center is a preview until you select each conflicting group and press **Save result**. Use **Previous** and **Next** to review other entries.

If one side deleted an entry while the other edited it, **Alternates** also lets you choose the surviving entry or **Entry deleted**. A deleted entry has no TL note to choose. If another translator updates the dictionary while you decide, the resolver refreshes and asks you to review again. Unresolved entries remain local; other compatible changes can continue syncing.

## Shared Dictionary History

Open **Settings → Cloud backup → Shared dictionary history** to inspect changes to your assigned language's shared dictionary, even without a translation workspace loaded. Each dictionary entry also has a small history icon beside its **Alternates** controls. That shortcut opens the same view with the entry's stable ID already selected. It occupies the existing control row and does not enlarge the entry box. Entries in a different, local-only language cannot use this shortcut.

History records additions, changes, deletions and restores, with the translator's name, time, shared revision and changed fields. Filter by entry ID, text, translator, change type, how the change happened, or a date range. Date filters use UTC; displayed timestamps use your browser's local timezone. **Apply filters** refreshes the list, **Clear** removes the filters, and **Load more** retrieves older matching changes. **Automatic merge** and **Conflict resolved** identify decisions reported by the synchronizing editor; the API records the actual author and before/after contents of the committed change. Unsynchronized local edits do not appear here yet.

Select a change to compare complete **Before** and **After** versions, including the main Find/Replace pair, ordered Alternates and TL note. Choose **Restore this version**, review the current shared entry alongside the proposed result, then **Confirm shared restore**. The restore keeps the same entry ID, affects everyone assigned to that language, and creates a new history event while preserving the older events. A version already matching the shared entry is labelled **Already current**. Selecting a version in which the entry does not exist deletes that entry; the confirmation makes this explicit.

Before a restore is sent, the editor saves a local recovery copy. Any earlier cloud write awaiting confirmation must finish syncing first. If another translator changes the shared dictionary after the preview was loaded, the restore is rejected and you must select the history event again to review a fresh preview. Network-interrupted restores remain pending and retry automatically; **Sync now** is available in Settings while a sync warning or error remains. Account changes, sign-out, language changes and expired sessions close the history view rather than displaying a previous account's results.

History starts when the API's history migration is installed. Existing live entries receive an **Existing entry** baseline without an invented author. The version before that baseline is unavailable. Entries deleted before history recording began have no saved content to restore; the view reports this limitation. Shared dictionary history is separate from local and shared translation-file history.

## Translation Collaboration

With a signed-in account and your assigned language selected, loading a source workspace automatically joins collaborators using the same **game + source version + language**. A content hash identifies the source version from its file paths, description names, English entries, stats, variables, and remarks. ZIP timestamps, compression, file ordering, and translated text do not change that source identity. Different source content stays in a different workspace.

The first eligible translator to create a shared workspace seeds it from their saved translations. Later browsers download shared work and reconcile differing local work without silently overwriting it. The status bar shows actionable collaboration warnings, errors, and translation conflicts. Healthy connections and routine pending saves do not add status messages or retry controls; reconnecting and queued work retry automatically. Signing out or switching to an unassigned language returns to local editing.

A colored outline appears on the translation cell when another translator selects the file; their name appears on hover. The cell darkens while their editor is open and their Editing badge stays visible, including inside the editor. Opening an occupied file directly asks whether you want to edit alongside them. This is an advisory warning: both people can edit after confirmation. Unsaved typing stays private; saved changes are synchronized. The source version stays in the bottom status bar; both the status bar and editor show only actionable collaboration warnings, errors, and conflicts.

Circular initials avatars before the **Show all comments** button and pagination show everyone connected to this workspace, including you. Their borders match their file-selection colors. The initials turn grey after two minutes of inactivity or while that person's tab is hidden; hovering or focusing the avatar shows their name and Active/Away status. Multiple sessions for the same account share one avatar and count as active while any session is active. Away status does not release an open file's editing claim.

**F1/F2**, **Ctrl+, / Ctrl+.**, and automatic next-file navigation skip files that other people are editing across the current filtered and sorted list, including later pages. They stop at the end instead of wrapping. If no eligible file remains, the current view stays open and a status message explains why. A save must finish in browser storage before navigation continues.

Offline saves stay durable in browser storage and are marked pending. On reconnection, changes to different translation entries combine automatically. If two people change the same entry differently, **Resolve translation conflicts** shows **Base**, **Yours**, **Shared**, and an editable **Result**. Choose a version or edit the result for each conflicting entry, then **Save result**. A complete translation entry is the merge unit: visual lines and table columns within that entry are kept together. An empty result is a real choice that clears the translation. If shared content changes during review, the dialog refreshes, retains custom result text, and requires a fresh choice or **Keep this result** confirmation. Closing the dialog or switching files retains result drafts in the current tab's memory. Use **Save result** before reloading, signing out, changing accounts, or changing workspaces to keep those proposed edits. Original saved conflict versions remain durable in browser storage.

The editor's **History** tab labels existing records **Local history · saved in this browser**. **Shared translation history** opens changes for the current game, source version, language, and file, with author, time, origin, and before/after versions. Select a change, choose **Restore before** or **Restore after**, review the current and proposed versions, then **Confirm shared restore**. Restores create a new history event and retain earlier events. Concurrent changes use the same merge/conflict protection as ordinary saves. History before the first shared version is unavailable in the shared view; legacy local records stay local.

Shared accepted work participates in normal ZIP export for everyone in the room. Pending local saves may appear in that browser's export; a sync failure shows a warning while they wait for automatic retry. **Import Next Version** leaves the old source workspace and joins or creates the new one after the import is saved. Old pending changes keep their original source identity and cannot be sent to the new version.

## Shared File Comments

The **Comments** tab beside **History** in the editor's right pane opens the current file's discussion. **Show all comments**, between the participant avatars and pagination, toggles a right sidebar listing discussions from every file in the selected game. This includes paths absent from the currently loaded source. A file link opens its editor when the path is available; **Load older comments** retrieves earlier posts.

Comments belong to **game + file path**. They are shared across every assigned translator's language and every source hash. PoE1 and PoE2 stay separate, and importing a new hash keeps discussions attached to matching file paths. Comments do not grant access to another language's dictionary or translations. Each comment records its author's name, assigned team language, posting time, and source hash. **Different version** appears when the comment's source hash differs from the source currently loaded. Hover over the badge to see the full hash; the visible badge contains no hash prefix.

Sign in with an assigned account to read comments. Posting also requires a loaded source and file, so every comment records the source version being discussed. The language selected in the editor does not change your account's team label. Comments are plain text. A failed post keeps its text in the current tab for retry; it is not a durable offline queue or part of a translated ZIP/settings export.

Red numbered badges show unread comments for the current file and, on **Show all comments**, the selected game's total. Own comments never count as unread. Read receipts belong to the signed-in account and are shared across its sessions. Only comment cards actually visible in an open panel while the browser tab is visible are marked read. Off-screen cards and older comments not yet loaded remain unread; opening the all-files sidebar does not mark the entire game read. Either comments panel updates the same receipts and badge totals.

Comments and counts refresh automatically every 20 seconds while the tab is visible, when you return to the tab, and when connectivity returns. There is no **Refresh** button or loading/status message during normal refreshes. Existing cards, scroll position, focus, and settled empty states remain stable. The panels show only actionable sync warnings or errors, and a failed operation's warning stays visible until that operation succeeds.

## Existing Data and Manual Exports

On upgrade, the old dictionary is placed under its previously selected language. It is not copied into every language. If the old settings had no language, Settings asks you to choose one before attaching that dictionary. The original settings are retained locally as a recovery source. This is separate from the older PoE1/PoE2 workspace migration described in [Multi-Version Support](multi_version.md).

**Settings → 📤 Export settings** downloads `sdeditor_settings.json`: the current language's dictionary, your preferences, personal Regex rules and local editor clipboard. It does not include authentication tokens, translation ZIPs, history or dictionaries for other languages. Select and export each language separately if you need portable copies of all dictionaries.

**📥 Import settings** requires typing `YES` and keeps a recovery copy before replacing the current profile's settings and the imported language's dictionary. When signed in and assigned, imported changes enter the normal sync/merge workflow. Importing a file is not an administrator language assignment.

**Download local recovery copies** appears after a first cloud-settings restore, settings import or shared history restore. It downloads `sdeditor_local_recovery.json` with the retained original settings and dated copies. This is a recovery archive, not a file to import directly with **Import settings**. To restore a dated copy, make a standard settings JSON from that copy's `settings`, add `dictionary` from its `dictionaries[settings.lang]` and `editorClipboard` from the same copy, then use the normal import. The archive's `legacySettings` object can also be saved as a standard settings JSON. Keep the original archive unchanged while recovering.

## Local Validation

The frontend's `npm test` remains a stub. Run the focused merge checks and syntax checks from the SDEditor directory:

```sh
node scripts/test-dictionary-sync.cjs
node scripts/test-cloud-sync.cjs
node scripts/test-history-sync.cjs
node scripts/test-history-ui.cjs
node scripts/test-collaboration-ui.cjs
node scripts/test-collaboration-sync.cjs
node scripts/test-collaboration-storage.cjs
node scripts/test-collaboration-api.cjs
node scripts/test-collaboration-editor.cjs
node scripts/test-collaboration-lifecycle.cjs
node scripts/test-collaboration-source.cjs
node scripts/test-render-safety.cjs
node --check public/dictionarySync.js
node --check public/cloudSync.js
node --check public/cloudUi.js
node --check public/cloudHistoryUi.js
node --check public/collaborationUi.js
node --check public/collaborationIntegration.js
node server.js --no-open
```

For a local API on port 3334, open `http://127.0.0.1:3333/?cloudApi=http://127.0.0.1:3334`. The override is accepted only when **both** the editor and API use loopback hostnames (`localhost`, `127.0.0.1` or `::1`). The public Pages site always uses the production API. Configure the API's exact allowed frontend origin and OAuth callback as explained in the API repository README.

Use a separate browser profile for checks with real IndexedDB: edit offline, reload, reconnect, test two accounts/devices in one language, resolve conflicting Alternates/TL notes, and verify language reassignment and settings recovery. From the API directory, run `npm run check` and `npm test` for backend and deployment-helper checks.

`?testMode=1&lang=Thai` loads dummy files and bypasses **both IndexedDB and cloud login/sync**. It is useful for editor/diagnostic checks, but cannot validate persistent storage or live synchronization. See [Test Mode](test-mode.md). Local checks do not establish live Google sign-in, Pages-to-API CORS, PM2 or tunnel readiness.

For a disposable browser integration fixture, install the sibling API dependencies, then run `node scripts/cloud-browser-fixture.cjs`. It starts a separate editor origin on port 34191 and an in-memory API with fake `example.test` accounts on port 34192. The terminal prints the editor URL, fixture controls, and a settings file to import. The fixture administrator starts unassigned; assign Thai through Settings to exercise the normal authorization flow. Import the sample settings into the local profile before signing in as the translator to exercise first-merge conflicts. These are fixture identities, not Google accounts, and no authentication bypass is included in the deployed application. Use different `FIXTURE_FRONTEND_PORT` and `FIXTURE_API_PORT` values for a fresh browser origin on subsequent runs.

For translation collaboration, run `node scripts/collaboration-browser-fixture.cjs`. The terminal prints two editor URLs on ports 34201 and 34202, each with isolated browser storage, connected to the real API and WebSocket implementation on port 34203. Click the visible **Bootstrap translator A/B** buttons to load two disposable Thai accounts and 25 source files. Use the actual editor to test occupied-file confirmation, cross-page navigation, different-entry merging, same-entry conflicts, history, and restore. **Simulate offline** disables that fixture browser's API traffic and presence connection while allowing normal IndexedDB saves; **Restore connection** retries the queue. **Switch theme** checks grey and dark. Fixture-only routes and controls are injected by this script and are never served by the production server. Its API database is discarded when the process stops; use `FIXTURE_A_PORT`, `FIXTURE_B_PORT`, and `FIXTURE_API_PORT` to choose fresh origins if needed.

For shared comments, run `node scripts/comments-browser-fixture.cjs`. It starts Thai and German editor origins on ports 34211 and 34212 with an in-memory API on 34213. Click the visible **Bootstrap Thai/German** button to load 25 files and different source hashes. Seeded discussions include three team languages, 60 PoE1 comments (40 initially unread for Thai), a separate PoE2 comment on the same path, a missing-source file, literal markup, and enough comments on `fixture/stat_01.txt` to exercise **Load older comments**. **Add German comment** posts a new remote comment through the real API; **Switch game**, **Switch theme**, and **Simulate offline** support isolation, appearance and retry checks. Both browser origins retain their own local storage; the API database disappears when the fixture stops. Override `FIXTURE_A_PORT`, `FIXTURE_B_PORT`, and `FIXTURE_API_PORT` for fresh origins. The bootstrap and controls exist only in this disposable script, never in the production server.
