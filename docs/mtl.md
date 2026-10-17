# ClientText MTL

MTL generates a suggestion for one ClientText text or grammatical-form field. Gender metadata and empty English fields are excluded. The field toolbar uses **A↔あ**, immediately before the history separator. An optional F8 or Ctrl+Alt+F8 shortcut can be selected in Settings; shortcuts are disabled initially.

Generation uses OpenAI through a separately configured Sign in with ChatGPT connection. The private backend selects `gpt-6-luna` with `xhigh` reasoning. Settings disclose the provider and ask permission to transmit the selected English field and bounded relevant workbook context, Developer notes and committed glossary terms. The browser continues parsing and exporting workbooks. No workbook-wide or external retrieval is performed. The provider connection is disabled until a human configures and authorizes it; there is no paid API fallback.

Generation needs a network connection in every editing mode. An in-memory workbook session is a storage choice, not an offline model. A cached online workspace retains its online identity while disconnected.

Admins can view nonsecret connection status and disconnect or revoke the server session in Settings. Changing that connection requires an Admin sign-in from the last five minutes. Setup uses a dedicated local SDEditor sign-in followed by a protected server import; no hosted one-click connection is offered. Renewable credentials live in a separate encrypted backend database, with its encryption key stored outside that database and excluded from content backups.

Ordinary controls use neutral MTL wording. The **MTL data sharing and privacy** details beside consent identify the provider and explain which context leaves the browser.

An Admin-only information button next to Translate opens a movable, read-only request dialog. Before translation it shows a clearly labeled context preview without making an inference request. After translation it can show the actual executed prompt and request body, bounded context, response, structural validation, timing and safe error codes. Follow-up lookups are currently disabled; diagnostics say so explicitly. Drag the header or focus it and use arrow keys to move the dialog. Escape closes it and returns focus to the button.

Server diagnostics are captured only for an Admin's own request, checked against current Admin authorization, original workspace/language permissions and the same signed-in session. They stay in bounded process memory for up to ten minutes and never enter candidates, history, backups or logs. Browser details clear on logout or account, language, workspace, source or selected-record changes. Text is escaped and credential-like values are redacted; transport headers, credentials, raw provider errors and reasoning are excluded. Opening or reopening the dialog does not consume translation quota or invoke the provider. Expired details cannot be reconstructed from durable work.

## Review and Save

A completed suggestion replaces the visible field as a cyan-accented MTL review overlay. The original or Saved translation and any ordinary draft remain underneath it. Typing, pasting, formatting, autocomplete and TM insertion in the overlay edit a separate review buffer. They do not mark the source reviewed, create Saved work, teach TM or change export data.

**Accept** copies the reviewed suggestion into the ordinary draft and acknowledges the exact current source. Apply it with normal **Save**. Before Save, the prior draft is retained for undo/recovery. Save records normal translation history and MTL provenance and resolves the selected candidate atomically. An unchanged explicit save remains allowed. Normal human edits after acceptance retain ClientText's support for intentionally blank fields.

**Dismiss** resolves the selected unaccepted candidate and restores the underlying draft or committed field without marking the source reviewed. Saving while a suggestion is unaccepted saves only the underlying ordinary draft. It does not accept the visible MTL suggestion.

Translate and review actions preserve the inline editor, selected record and ordinary draft. Pointer translation keeps focus in the field; keyboard translation moves focus to the stable toolbar wrapper before its button is disabled. The field stays mounted when a suggestion arrives or is accepted/dismissed. Request-details dialogs participate in the editor's focus surfaces.

The MTL count and field dots appear only when applicable unresolved candidates exist. Counts overlap existing content statuses and do not contribute to Saved/Revised or assignment progress. The MTL filter and attention navigation provide access to pending suggestions, including suggestions withheld because newer typing arrived during generation.

## Scope, lifetime and export

Online candidates and their lifecycle synchronize separately by content group, version, language, unit and field. Personal review edits stay in their own account-scoped browser store. One contributor's review buffer is not overwritten by another contributor's save, dismissal or regeneration. Conflicts require a fresh review.

Local in-memory workbook sessions retain candidates, review buffers and saved translations only in that session. Leaving or reloading disposes them. Download workbooks to keep explicitly saved translations.

Every suggestion binds to the immutable original, parser, exact field source and its raw content hash. Source changes silently make the suggestion inapplicable; candidates are not carried into another version. Pending results cannot replace newer edits or enter a different account, language or workspace.

Exports read ordinary Saved records and verified original workbook cells. Unaccepted suggestions and review-buffer edits are excluded from all exports and collections. Accepted but unsaved drafts are also excluded. Existing complete paired-workbook export requirements remain; absent optional context sheets do not invent context or create sheets.

## Host limits

The host reserves usage atomically before inference. Defaults are one active job per account, two across the process, five new jobs per minute per account, 50 per day and 250 per week per account, and 100 per day and 500 per week for the configured subscription. Day and Monday-start week boundaries use `Asia/Bangkok`. Identical retries count as the same job. Provider rounds are counted separately and capped at three. Source/context/output size and elapsed-time limits are also enforced. Operators can configure these limits in the private backend.

Uncertain requests retain their identity for recovery. Checking a request or replaying a save receipt does not request another generation. A failed or interrupted job does not automatically start another provider call.

If a proxy masks a failed translation response as a network error, the browser reads the same request's status once. A confirmed validation failure gets a neutral MTL explanation; an unavailable status keeps the original request recoverable. This does not repeat inference. Admin details include the upstream HTTP status when received, a separate API error status, and a bounded validation reason without raw upstream errors or response payloads.

Completed translation output rejected by JSON/schema or application validation returns HTTP **422**. Genuine upstream protocol/transport failures retain **502**. Successful output still requires an actual `response.completed` event, a completed response with the expected message structure, consistent streamed/final text, strict translation JSON and all protected-token, audio-marker, syntax and line-break checks. Partial text never becomes a suggestion.

Admin diagnostics use fixed reason codes: `stream_content_type`, `stream_json`, `stream_incomplete`, `response_shape`, `delta_mismatch`, `output_json`, `output_schema`, `protected_tokens`, `line_breaks` and `text_syntax`. Additional fixed reasons distinguish stream limits/read failures, audio markers, refusals and HTTP/transport failures. For example, `upstreamStatus: 200`, `apiStatus: 422`, `failureReason: protected_tokens` means the upstream request completed but the returned translation changed protected tokens. A protocol failure can still be inspected through the Admin diagnostics GET after a proxy masks its failed POST, without another inference request. Old jobs and expired diagnostics retain only their historical error code; that code cannot retrospectively establish the precise cause.
