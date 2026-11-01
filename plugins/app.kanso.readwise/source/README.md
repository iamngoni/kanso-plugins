# Readwise

Imports your Readwise highlights as one note per book or article, in the
notebook you choose. Later runs add only new highlights to the same note.

## Setup

1. Copy your access token from <https://readwise.io/access_token>.
2. In Kanso, open Settings > Plugins > Readwise and save it as the secret
   named `token`. The plugin never prints or logs it.
3. When installing, allow the plugin to read and change the notebook you want
   the notes in (it also needs to make notes there).
4. Open any note in that notebook and run **Readwise: show panel**, then press
   **Use the open note's notebook**. The plugin remembers the choice.

## Use

Run **Readwise: import highlights** (or press **Import now** in the panel).

Each book or article becomes a note titled after it, starting with an
invisible `<!-- readwise:ID -->` marker, with each highlight as a quote
followed by its own `<!-- rw:ID -->` marker. Running again fetches only items
Readwise changed since the last finished run (`updatedAfter`) and appends
highlights whose marker is not in the note yet, so nothing is duplicated and
your own edits to a note are kept.

A run handles at most 10 books and 3 pages so it stays inside Kanso's limits
(60 calls a minute, 5 seconds a command; Readwise allows 20 export requests a
minute). If there is more it says **Run it again to continue** and resumes
where it stopped. A 429 from Readwise stops the run the same way. A 401 or 403
tells you to check the token. **Start over** makes the next run re-check
everything (still without duplicates).

Changes to more than the open note wait for your review in Kanso unless you
turned **Ask before changing notes** off.

## Why each permission

| Permission | Why |
|---|---|
| `commands`, `ui: panel` | The import command and the small status panel |
| `editor: note.read` | To learn which notebook the open note is in |
| `notes.read` (notebooks you choose) | To find notes already imported, so it appends instead of duplicating |
| `notes.write`, `notes.create` | To add the notes and highlights |
| `secrets: token` | Your Readwise access token |
| `network: readwise.io` | The export API, `https://readwise.io/api/v2/export/`, the only host used |
