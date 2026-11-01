# Link fixer

Finds `[[wikilinks]]` that point at no note, suggests the closest note
titles, and fixes the ones you choose.

## Use

Run **Fix broken wikilinks** from the command palette and press **Scan**.
Each missing target is listed with the number of notes using it and a
choice of the three closest titles. Leave a link as it is, or pick a title,
then press **Fix chosen**. Example: `[[Meeting notess]]` offers
`Meeting notes`; choosing it rewrites every such link, keeping any
`#heading` and `|alias` part. Links inside code spans and fenced blocks
are ignored, as are embedded files like `![[pic.png]]`.

Reading a note costs one call and Kanso allows 60 calls a minute, so
scanning and fixing go in steps. The panel says how far it got; press
**Keep scanning** or **Keep fixing**. A target used in more than 25 notes
is marked with `+`: scan again after fixing to catch the rest. Changes are
staged and shown for review unless you turned **Ask before changing notes**
off; a note edited since the scan is skipped.

## Permissions

| Permission | Why |
|---|---|
| `commands` | The palette command |
| `ui: panel` | The list of missing links and your choices |
| `notes.read` | Reads titles and note text to find links. You pick the notebooks at install; links to notes outside them look missing |
| `notes.write` | Rewrites the links you chose, in the notebooks you allowed |

No network, no new notes.
