# Duplicate finder

Lists notes with near-identical titles or near-identical text. It only
reads; you decide what to merge or delete.

## Use

Run **Find duplicate notes**, choose how alike the text must be, and press
**Scan**. Each pair is listed with a badge: `same title` (titles equal once
case, punctuation, "copy" and a trailing number are ignored) and/or the
estimated share of three-word phrases the two texts have in common. Example:
`Groceries` and `Groceries copy` show as "same title"; two notes pasted from
the same article show as "92% alike". **Compare again** re-lists with a new
threshold without reading anything.

Reading a note costs one call and Kanso allows 60 calls a minute, so a scan
goes in steps; press **Keep scanning** when the panel says it stopped. Each
text is boiled down to a small sketch, so only sketches are kept between
steps. The 700 most recently changed notes are checked by title and the
350 most recent by text; the panel says when a library is larger.

## Permissions

| Permission | Why |
|---|---|
| `commands` | The palette command |
| `ui: panel` | The list of look-alike pairs |
| `notes.read` | Reads titles and text. You pick the notebooks at install |

It cannot change notes, use the network or create anything.
