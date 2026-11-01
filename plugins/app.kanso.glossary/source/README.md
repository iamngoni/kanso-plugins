# Glossary

Collects the terms you define across your notes into one searchable panel,
and inserts a definition into the note you are writing.

## What counts as a definition

- A line of the form `Term:: definition`, optionally as a list item or with
  the term in bold: `- **API**:: Application programming interface`.
- Entries under a heading called `Glossary` (any level), until the next
  heading of the same or a higher level: `- **Latency**: the delay`,
  `- Throughput - how much per second`, or `Term: definition`.

Fenced code and front matter are skipped. A term is taken once per note
(the first definition wins), up to 30 per note.

## Using it

1. Run **Show glossary** from the command palette. It reads the open note and
   the notes that changed since it last looked, and keeps what it found in
   its settings.
2. Type in **Search** and press **Search**. It matches the term first, then the
   definition. Searching reads no notes.
3. Pick a term in **Insert definition of**, put the cursor in the note (or
   select a word), and press **Insert at selection**. With nothing selected the
   definition is inserted; with `kitten` selected you get `kitten (a young cat)`.
   Undo takes it back.

A plugin gets 60 calls a minute, so each **Refresh** reads at most 40 changed
notes. If more are waiting the panel says how many; press Refresh again to
continue. Notes you haven't changed are not read again.

Example: a note holding `Idempotent:: safe to repeat` shows up when you search
"repeat", and the Insert button writes `safe to repeat` at the cursor.

## Permissions

| Permission | Why |
|---|---|
| `commands` | The palette command that opens the panel |
| `editor: note.read` | To read the open note, even outside the notebooks you chose |
| `editor: selection.read` | To see where the cursor or selection is, for Insert |
| `editor: selection.replace` | To put the definition there, as one edit Undo takes back |
| `notes.read` | To find definitions in the notebooks you choose at install. It never changes notes |
| `ui: panel` | To show the panel |

No write access to notes outside the selection edit, and no network.
