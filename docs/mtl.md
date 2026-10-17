# ClientText MTL

MTL generates a suggestion for one ClientText text or grammatical-form field. Gender metadata and empty English fields are excluded. The field toolbar uses **A↔あ**, immediately before the history separator. An optional F8 or Ctrl+Alt+F8 shortcut can be selected in Settings; shortcuts are disabled initially.

Generation uses OpenAI through a separately configured Sign in with ChatGPT connection. The private backend selects `gpt-6-luna` with `xhigh` reasoning. Settings disclose the provider and ask permission to transmit the selected English field and bounded relevant workbook context, Developer notes and committed glossary terms. The browser continues parsing and exporting workbooks. No workbook-wide or external retrieval is performed. The provider connection is disabled until a human configures and authorizes it; there is no paid API fallback.

Generation needs a network connection in every editing mode. An in-memory workbook session is a storage choice, not an offline model. A cached online workspace retains its online identity while disconnected.

Admins can view nonsecret connection status and disconnect or revoke the server session in Settings. Changing that connection requires an Admin sign-in from the last five minutes. Setup uses a dedicated local SDEditor sign-in followed by a protected server import; no hosted one-click connection is offered. Renewable credentials live in a separate encrypted backend database, with its encryption key stored outside that database and excluded from content backups.

## Review and Save

A completed suggestion replaces the visible field as a cyan-accented MTL review overlay. The original or Saved translation and any ordinary draft remain underneath it. Typing, pasting, formatting, autocomplete and TM insertion in the overlay edit a separate review buffer. They do not mark the source reviewed, create Saved work, teach TM or change export data.

**Accept** copies the reviewed suggestion into the ordinary draft and acknowledges the exact current source. Apply it with normal **Save**. Before Save, the prior draft is retained for undo/recovery. Save records normal translation history and MTL provenance and resolves the selected candidate atomically. An unchanged explicit save remains allowed. Normal human edits after acceptance retain ClientText's support for intentionally blank fields.

**Dismiss** resolves the selected unaccepted candidate and restores the underlying draft or committed field without marking the source reviewed. Saving while a suggestion is unaccepted saves only the underlying ordinary draft. It does not accept the visible MTL suggestion.

The MTL count and field dots appear only when applicable unresolved candidates exist. Counts overlap existing content statuses and do not contribute to Saved/Revised or assignment progress. The MTL filter and attention navigation provide access to pending suggestions, including suggestions withheld because newer typing arrived during generation.

## Scope, lifetime and export

Online candidates and their lifecycle synchronize separately by content group, version, language, unit and field. Personal review edits stay in their own account-scoped browser store. One contributor's review buffer is not overwritten by another contributor's save, dismissal or regeneration. Conflicts require a fresh review.

Local in-memory workbook sessions retain candidates, review buffers and saved translations only in that session. Leaving or reloading disposes them. Download workbooks to keep explicitly saved translations.

Every suggestion binds to the immutable original, parser, exact field source and its raw content hash. Source changes silently make the suggestion inapplicable; candidates are not carried into another version. Pending results cannot replace newer edits or enter a different account, language or workspace.

Exports read ordinary Saved records and verified original workbook cells. Unaccepted suggestions and review-buffer edits are excluded from all exports and collections. Accepted but unsaved drafts are also excluded. Existing complete paired-workbook export requirements remain; absent optional context sheets do not invent context or create sheets.

## Host limits

The host reserves usage atomically before inference. Defaults are one active job per account, two across the process, five new jobs per minute per account, 50 per day and 250 per week per account, and 100 per day and 500 per week for the configured subscription. Day and Monday-start week boundaries use `Asia/Bangkok`. Identical retries count as the same job. Provider rounds are counted separately and capped at three. Source/context/output size and elapsed-time limits are also enforced. Operators can configure these limits in the private backend.

Uncertain requests retain their identity for recovery. Checking a request or replaying a save receipt does not request another generation. A failed or interrupted job does not automatically start another provider call.
