# SDEditor
*browser-based editor for `StatDescriptions.zip` (translation stat files).*
You can access the live version [here](<https://sdeditor.pages.dev/>), or if you prefer not to use online version you can clone the [repo](<https://github.com/peter-pakanun/SDEditor>) and run it locally. 
## How to use
[Read Translator full workflow here](#)
1) Open the [web app](<https://sdeditor.pages.dev/>) and pick your target language
2) Drag & drop `StatDescriptions.zip` into the page
3) Click any row to edit, then save
4) Click :floppy_disk: to export `StatDescriptions_Translated.zip` (**Ctrl + Click :floppy_disk:** = full export)
## Threads
:pencil: [Patch notes](#)
:bug: [Suggestions / Bug reports](#)
## Notes
- Your in-progress edits are stored in your browser (`localStorage`)
- You can drag & drop a previously exported ZIP onto the table to re-import edits
- Only supported browser is Chromium-based (e.g. Chrome, Brave, Edge)
## Keyboard shortcuts
- **Ctrl + Space:** during editing to open the autocomplete menu
  - **Autocomplete menu:** while it’s open, **Ctrl + Enter** will jump to/edit the matching Dictionary entry, or create one (and focus the right Replace field)
- **Ctrl + S:** save the current file
- **Shift + Enter:** save and move to the next file
- **Ctrl + F:** focus on the search bar
- **Highlighted text**: in the source file there is a highlighted text that you can interact with
  - **Click:** on the highlighted text to paste it down, replacing the current selection
  - **Ctrl + Click:** on the highlighted text to jump to the Dictionary entry (or create it if it doesn't exist)
  - **Alt + Click:** on the highlighted text to copy it
  - **Alt + number:** paste the highlighted text down by the order number, replacing the current selection