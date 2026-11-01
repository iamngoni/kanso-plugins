# Focus log

Start and Stop buttons in the inspector that log a focus session.

**There is no running timer.** A plugin can't run in the background or on a
timer, so Start only records the time you pressed it, and Stop works out the
length from the time you press Stop. The panel updates when you press a
button; it doesn't tick.

Pressing Stop writes one line:

```
- 14:00–14:45 (45 min) Write the report
```

and the panel shows today's total and the sessions logged today. The running
session, the sessions of the last 14 days and the **Save to** choice are kept
in the plugin's settings on this Mac.

## Using it

1. Open a note and run **Show focus log** from the command palette.
2. Type an optional label and press **Start**.
3. When you finish, press **Stop** (the label can be filled or changed now).

**Save to** picks where the line goes:

- **Note text**: appended as a new last line of the open note.
- **Note data**: kept in the note's plugin data, leaving the text alone.
- **This panel only**: kept only in today's list.

If the note can't be changed (no notebook was chosen for changing, or the
note changed meanwhile) the session is still logged in the panel, and the
panel says so.

## Permissions

| Permission | Why |
|---|---|
| `commands` | The palette command that opens the panel |
| `editor: note.read` | To know which note is open and read its text before appending |
| `notes.read` | You choose the notebooks at install. Kanso only lets a plugin change notebooks it can also read |
| `notes.write` | To append the line to the open note, or to save plugin data on it. Only in notebooks you choose. Leave it unticked to use **This panel only** |
| `ui: panel` | To show the panel |

The `*` in the manifest's `notes.write` is a placeholder: the notebooks are
the ones you choose when installing. With **Ask before changing notes** on,
Kanso shows each appended line for review. The plugin has no network access.
