# Bulk tags

Add, remove or rename a tag across many notes at once, from a panel.

## Use

Run **Bulk tags: add, remove or rename a tag** from the command palette. In
the panel pick what to do, type the tag (a leading `#` is fine), and press
**Start**.

Example: to rename `#proj` to `#project`, choose **Rename a tag**, type
`proj` in **Tag** and `project` in **New name**, press **Start**. Only
notes that have `#proj` are touched. Type a tag in the optional third box
to limit the run to notes that also carry it.

Kanso lets a plugin make at most 60 calls a minute and run for two seconds
at a time, so a big run goes in steps. After each step the panel says how
many notes it looked at and changed; press **Continue** to go on. Changes
are staged and, unless you turned **Ask before changing notes** off, shown
for review first. **Undo** in the notification takes a whole step back.

Running the same thing twice changes nothing the second time. A tag has to
exist on at least one note you allowed already (Kanso does not let plugins
create tags), so tag one note by hand first if you are introducing a new
name.

## Permissions

| Permission | Why |
|---|---|
| `commands` | The palette command that opens the panel |
| `ui: panel` | The form and the progress report |
| `notes.read` | Finds the notes that carry the tag, and the tag's ID. Pick the notebooks you want it to cover when you install it |
| `notes.write` | Changes the tag list of those notes. It is limited to the notebooks you choose |

It does not read note bodies, create notes, use the network or touch the
open editor.
