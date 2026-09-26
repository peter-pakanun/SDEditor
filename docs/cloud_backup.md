# Cloud Backup and Shared Dictionaries

SDEditor saves locally in IndexedDB first. Google sign-in adds personal settings backup and a shared dictionary for your assigned language. The static editor calls the separate API at `https://sdeditor-api.poemaid.com`; these instructions describe the implementation, not confirmation that the public API has been deployed.

## What Is Saved Where

| Data | Browser storage | Cloud |
| --- | --- | --- |
| Editor preferences and Regex rules | Saved for the current local/account profile | Personal to your Google account |
| Dictionary, including Alternates and TL notes | Separate dictionary for each language and profile | Shared among translators assigned to that language |
| Editor clipboard | Local to the profile | Not uploaded |
| Source ZIP, translations and revision history | Separate PoE1/PoE2 workspaces | Not uploaded |

PoE1 and PoE2 use the same dictionary for a given language. Regex rules are personal; changing a Regex does not change another translator's rules. Translation workspaces remain local to this browser and game version; switching Google accounts does not create separate translation files. Continue exporting translated ZIPs for moving or backing up that work.

## Sign In and Get Assigned

1. Open **Settings → Cloud backup → Backup using Google account** and choose your Google account. If a popup cannot open, sign-in uses a page redirect.
2. A new account shows **Not configured — awaiting admin language assignment**. You can keep editing locally, but settings and dictionaries do not sync until an administrator assigns your account.
3. After assignment, use **Sync now** or return to the editor to refresh access. Settings shows your account, assigned language and latest sync status.

The administrator opens **Settings → Cloud backup → Manage users**. Accounts appear after their first Google sign-in. Choose one language per account, including the administrator's own account when it needs backup. Clearing an assignment stops cloud access and preserves the user's local drafts. Reassignment does not delete or transfer the old language's shared dictionary.

You may still select another language in the editor. Its dictionary stays local and is labelled **Current dictionary is local only**; your account cannot read or publish another language's shared dictionary. Changing the language dropdown does not change the administrator's assignment.

The editor renews its session when you visit, return to the tab, or use the tool. A session expires after 30 days without renewal. If it expires, sign in again or choose **Return to local profile**; saved account drafts remain in this browser. Signing out also returns to the signed-out profile. A newly used account adopts the signed-out profile's starting data, never another account's private settings.

## Sync, Restore and Offline Work

Changes save in IndexedDB before cloud synchronization. Sync runs after edits, periodically while the editor is visible, and when connectivity or focus returns. **Sync now** retries immediately. A cloud-unavailable status means local work can continue; pending changes are retried later.

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

## Existing Data and Manual Exports

On upgrade, the old dictionary is placed under its previously selected language. It is not copied into every language. If the old settings had no language, Settings asks you to choose one before attaching that dictionary. The original settings are retained locally as a recovery source. This is separate from the older PoE1/PoE2 workspace migration described in [Multi-Version Support](multi_version.md).

**Settings → 📤 Export settings** downloads `sdeditor_settings.json`: the current language's dictionary, your preferences, personal Regex rules and local editor clipboard. It does not include authentication tokens, translation ZIPs, history or dictionaries for other languages. Select and export each language separately if you need portable copies of all dictionaries.

**📥 Import settings** requires typing `YES` and keeps a recovery copy before replacing the current profile's settings and the imported language's dictionary. When signed in and assigned, imported changes enter the normal sync/merge workflow. Importing a file is not an administrator language assignment.

**Download local recovery copies** appears after a first cloud-settings restore or a settings import. It downloads `sdeditor_local_recovery.json` with the retained original settings and dated copies. This is a recovery archive, not a file to import directly with **Import settings**. To restore a dated copy, make a standard settings JSON from that copy's `settings`, add `dictionary` from its `dictionaries[settings.lang]` and `editorClipboard` from the same copy, then use the normal import. The archive's `legacySettings` object can also be saved as a standard settings JSON. Keep the original archive unchanged while recovering.

## Local Validation

The frontend's `npm test` remains a stub. Run the focused merge checks and syntax checks from the SDEditor directory:

```sh
node scripts/test-dictionary-sync.cjs
node scripts/test-cloud-sync.cjs
node scripts/test-render-safety.cjs
node --check public/dictionarySync.js
node --check public/cloudSync.js
node --check public/cloudUi.js
node server.js --no-open
```

For a local API on port 3334, open `http://127.0.0.1:3333/?cloudApi=http://127.0.0.1:3334`. The override is accepted only when **both** the editor and API use loopback hostnames (`localhost`, `127.0.0.1` or `::1`). The public Pages site always uses the production API. Configure the API's exact allowed frontend origin and OAuth callback as explained in the API repository README.

Use a separate browser profile for checks with real IndexedDB: edit offline, reload, reconnect, test two accounts/devices in one language, resolve conflicting Alternates/TL notes, and verify language reassignment and settings recovery. From the API directory, run `npm run check` and `npm test` for backend and deployment-helper checks.

`?testMode=1&lang=Thai` loads dummy files and bypasses **both IndexedDB and cloud login/sync**. It is useful for editor/diagnostic checks, but cannot validate persistent storage or live synchronization. See [Test Mode](test-mode.md). Local checks do not establish live Google sign-in, Pages-to-API CORS, PM2 or tunnel readiness.

For a disposable browser integration fixture, install the sibling API dependencies, then run `node scripts/cloud-browser-fixture.cjs`. It starts a separate editor origin on port 34191 and an in-memory API with fake `example.test` accounts on port 34192. The terminal prints the editor URL, fixture controls, and a settings file to import. The fixture administrator starts unassigned; assign Thai through Settings to exercise the normal authorization flow. Import the sample settings into the local profile before signing in as the translator to exercise first-merge conflicts. These are fixture identities, not Google accounts, and no authentication bypass is included in the deployed application. Use different `FIXTURE_FRONTEND_PORT` and `FIXTURE_API_PORT` values for a fresh browser origin on subsequent runs.
