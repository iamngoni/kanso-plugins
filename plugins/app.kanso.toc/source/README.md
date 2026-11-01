# Table of contents

Builds a table of contents from the open note's headings, as markdown links
to the heading anchors, between marker comments:

```
<!-- toc -->
- [Intro](#intro)
  - [Setup](#setup)
- [Usage](#usage)
<!-- /toc -->
```

## Commands

- **Insert or refresh table of contents**: put the cursor where it should go
  and run it. The block is inserted there (any selected text is kept, after
  the block). If the note already has a block, select it, or the whole note
  (Select All), and run it again to refresh it in place.
- **Refresh table of contents in the selection**: the same refresh, and it
  does nothing when the selection holds no block.

Headings inside code fences, front matter and the block itself are ignored.
Both `#` and underlined headings count. Duplicate headings get `-1`, `-2`
anchors, and levels are indented relative to the shallowest heading.

Kanso lets a plugin change only the selection, which is why refreshing needs
the existing block to be inside it. If the selection moves while the command
runs, nothing is changed and you are asked to try again. The selection's byte
offsets are passed back exactly as read, so non-ASCII text is safe.

## Permissions

- `commands`: to add the palette commands.
- `editor: note.read`: to read the open note's headings.
- `editor: selection.read`: to know where to write, and to find an existing block.
- `editor: selection.replace`: to write the block, as one edit Undo takes back.

No other notes are read and there is no network access.
