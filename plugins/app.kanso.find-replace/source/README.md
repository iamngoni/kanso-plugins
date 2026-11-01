# Find and replace

Find text across your notes, see the matches note by note, then replace.

## Use

Run **Find and replace across notes** from the command palette. Type what
to find and what to put in its place, choose **Plain text** or **Regular
expression**, and tick **Match case** if the case matters. Press **Preview
matches**. The panel lists each note with its number of matches and a line
of context; untick any note you want left alone, then press **Apply**.

Example: to turn `2024-05-06` style dates into `06/05/2024`, choose
**Regular expression**, find `(\d+)-(\d+)-(\d+)`, replace with `$3/$2/$1`.
In a regular expression, `$1` to `$9`, `$&` and `$$` work in the
replacement. In plain text everything is taken literally.

Nothing is written until **Apply**. Changes are then staged and, unless you
turned **Ask before changing notes** off, shown for review. **Undo** in the
notification takes a whole step back. A note edited after the preview is
skipped rather than overwritten.

Reading a note costs one call and Kanso allows 60 calls a minute, so large
libraries go in steps. The panel says how many notes it has read, and
**Keep looking** or **Keep applying** carry on. By default plain-text
searches use Kanso's own search to pick the notes to read, which is much
faster but can miss a match inside part of a word; untick the option to
read every note. A very expensive regular expression can run into the
two-second limit; Kanso stops the plugin if so and nothing is changed.

## Permissions

| Permission | Why |
|---|---|
| `commands` | The palette command that opens the panel |
| `ui: panel` | The form, the preview and progress |
| `notes.read` | Reads note text to find matches. You pick the notebooks when you install it |
| `notes.write` | Rewrites the text of the notes you applied it to, in the notebooks you chose |

It does not create notes, use the network or touch the open editor.
