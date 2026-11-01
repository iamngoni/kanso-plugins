# Writing goals

A daily word target in the inspector, with a progress bar and a streak.

- Set the target in the panel and press **Save**. It is kept in this plugin's
  settings, on this Mac only.
- Choose what to measure: **Today** (words added to the notes you have looked
  at today) or **Open note** (the open note's whole word count).
- The streak counts consecutive days on which the Today total reached the
  target. It shows 0 once a whole day passes without meeting it, and the best
  streak is remembered.

## Using it

Run **Show writing goal** from the command palette, write, then press
**Refresh**. A plugin can't run in the background, so words are counted only
when you press Refresh (or Save, or run the command). The count for a note
starts the first time the plugin sees it that day, so press Refresh before
you start writing in a note, and again when you finish.

Example: target 500, you press Refresh on a note of 1,200 words, write 340
more, press Refresh: `340 of 500 words` and a bar at 68%. Add 160 more and
Refresh: the streak becomes 1 day, then 2 the next day you do the same.

Front matter, fenced code, inline code and URLs are not counted.

## Permissions

| Permission | Why |
|---|---|
| `commands` | The palette command that opens the panel |
| `editor: note.read` | To read the open note's text and count its words |
| `ui: panel` | To show the panel |

Settings (the target, the streak and per-note word counts for today) need no
permission. It has no network and no write access to notes.
