# SDEditor
*browser-based editor for `StatDescriptions.zip` (stat translation).*
You can access the live version [here](<https://sdeditor.pages.dev/>), or if you prefer not to use online version you can clone the [repo](<https://github.com/peter-pakanun/SDEditor>) and run it locally.

## How to use
[**Full Editor Guide**](#)
1) Open the [**web app**](<https://sdeditor.pages.dev/>) and pick your target language and settings
2) Import `StatDescriptions.zip` using the 📦 Import Next Version button
3) Click any row or use `F1/F2` hotkey to edit
4) While editing, use `Ctrl + Space` to open the autocomplete menu
5) After you are done, click on 💾 to export `StatDescriptions_Translated.zip` and submit your work
> Your in-progress edits are stored in your browser (`indexedDB`)
## Keyboard shortcuts
- **Ctrl + Space (default):** during editing to open the autocomplete menu. SDEditor leaves keys to an active IME composition; the binding can be changed to **Ctrl + I** or disabled in Settings, and `[` will still open the menu.
  - **Autocomplete menu:** while it’s open, **Ctrl + Enter** will jump to/edit the matching Dictionary entry, or create one (and focus the right Replace field)
  - **When you’re done:** use the configured autocomplete shortcut again (or `[`) to use the entry you just created; this returns to the translation field
- **Ctrl + S:** save the current file
- **Ctrl + F:** focus on the search bar
- **F1** / **F2** or **Ctrl + Comma** / **Ctrl + Period**: move to the previous/next file, saving the current file if it has changes
- **Highlighted text**: in the source file there is a highlighted text that you can interact with
  - **Click:** on the highlighted text to paste it down, replacing the current selection
  - **Ctrl + Click:** on the highlighted text to jump to the Dictionary entry (or create it if it doesn't exist)
  - **Alt + Click:** on the highlighted text to copy it
  - **Alt + number:** paste the highlighted text down by the order number, replacing the current selection
## Threads
:bug: [Bug Reports / Feature Requests](#)
:pencil: [Patch Notes](#)
