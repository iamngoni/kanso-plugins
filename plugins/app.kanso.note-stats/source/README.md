# Note stats

A panel in the inspector with facts about the open note:

- reading time (at 200 words a minute) and word count
- a Flesch reading ease score, 0 to 100, with a plain-words band
- the heading outline
- counts of links, wikilinks and tasks (done of total)

Front matter, fenced code, inline code and URLs are left out of the word count.

## Using it

Open a note and run **Show note stats** from the command palette. The panel
is drawn when that command or its **Refresh** button runs, and not
automatically as you type or switch notes, because plugins don't run in the
background. Press **Refresh** after editing or opening another note.

Example: a note with a title, two headings, one wikilink and a task list of
two shows `Words 214`, `Reading time 1 min`, `Readability 68 (plain)`,
`Wikilinks 1`, `Tasks 1 of 2 done`, and both headings in the outline.

## Permissions

| Permission | Why |
|---|---|
| `commands` | The palette command that opens the panel |
| `editor: note.read` | To read the open note. It reads no other note |
| `ui: panel` | To show the panel in the inspector |

It has no network, no write access and no notebook access.
