# Raindrop.io

Imports bookmarks from one Raindrop.io collection into Kanso, either as one
note per bookmark or as a single list note. Later runs fetch only bookmarks
newer than the last import.

## Setup

1. In Raindrop.io open Settings > Integrations > For Developers, create an
   app, and create a **test token** (read access is enough).
2. In Kanso, Settings > Plugins > Raindrop.io: save it as the secret named
   `token`. It is never logged.
3. When installing, allow the plugin to read, change and make notes in the
   notebook for the import.
4. Open a note in that notebook, run **Raindrop: choose collection and mode**,
   type the collection's name (or its number; blank means all bookmarks),
   pick the mode, press **Use the open note's notebook**, then
   **Save and import**.

## Use

Run **Raindrop: import bookmarks**. Notes mode makes a note per bookmark with
its link, excerpt, your note and tags. List mode keeps one note called
`Raindrop: <collection>` with a line per bookmark, newest first, and adds new
lines to the top on later runs.

The cursor is the creation time of the newest bookmark imported, kept per
collection and mode, and it only moves forward. Every note or list line carries
an invisible `<!-- raindrop:ID -->` marker and recent ids are remembered, so
running twice, or resuming a half-finished run, never duplicates. A run does a
few pages (20 notes or 200 list lines at most); if there is more it says
**run it again to continue**. A 401 asks you to check the token; a 429 stops
the run and says when to retry.

Changes to more than the open note wait for your review unless you turned off
**Ask before changing notes**.

## Why each permission

| Permission | Why |
|---|---|
| `commands`, `ui: panel` | The commands and the small settings panel |
| `editor: note.read` | To learn the open note's notebook |
| `notes.read` | To find the list note and to check for duplicates |
| `notes.write`, `notes.create` | To create the notes and update the list note |
| `secrets: token` | Your Raindrop token |
| `network: api.raindrop.io` | `https://api.raindrop.io/rest/v1/` (collections and raindrops), the only host used |
