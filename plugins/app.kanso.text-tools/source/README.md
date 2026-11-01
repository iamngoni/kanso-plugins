# Text tools

Palette commands that rewrite the text you have selected. Select text, open
the command palette and pick one.

| Command | What it does |
|---|---|
| Sort lines A to Z / Z to A | Sorts ignoring case |
| Sort lines naturally | `file2` before `file10` |
| Remove duplicate lines | Keeps the first of each |
| Reverse lines | |
| Title Case, Sentence case, UPPER CASE, lower case | |
| Slugify | `Héllo, Wörld!` becomes `hello-world` (URL-safe) |
| Trim trailing whitespace | On every selected line |
| List to markdown table | Bullets, numbers, tab, ` \| ` or comma separated rows; the first row is the header |
| Align markdown table | Pads cells so the pipes line up, keeping `:---:` alignment |
| Insert lorem ipsum | Select a number (1 to 20) to replace it with that many paragraphs; with other text selected, 3 paragraphs are added after it |

Example: select `10\n2\n1` (one number per line) and run **Sort lines
naturally** to get `1`, `2`, `10`.

If the selection moves while a command runs, nothing is changed and a
notification asks you to select again.

## Permissions

- `commands`: to add the palette commands.
- `editor: selection.read`: to read the text you selected.
- `editor: selection.replace`: to put the result back, as one edit Undo takes back.

It cannot read other notes and has no network access.
