# Stale notes

Lists notes you have not changed in a while, and tags them `#stale`.

## Use

Run **Find stale notes**, choose 3, 6, 12 or 24 months in the select, and
press **List stale notes**. The panel shows each untouched note with the
date it last changed (notes already tagged `#stale` are left out). Press
**Tag them #stale** to tag the listed notes; the change is staged and shown
for review unless you turned **Ask before changing notes** off.

Reading is newest first, 100 notes a call, and tagging is one call per
note, while Kanso allows 60 calls a minute. Large libraries therefore go in
steps; the panel says how far it got and offers **Keep looking** or **Keep
tagging**. At most 250 notes are held at a time: tag them, then look again
for more. Kanso does not let plugins create tags, so tag one note `#stale`
by hand the first time.

## Permissions

| Permission | Why |
|---|---|
| `commands` | The palette command |
| `ui: panel` | The month choice, the list and the buttons |
| `notes.read` | Reads titles, tags and change dates. You pick the notebooks at install |
| `notes.write` | Adds the `#stale` tag to notes in the notebooks you chose |

It never reads note text, creates notes or uses the network.
