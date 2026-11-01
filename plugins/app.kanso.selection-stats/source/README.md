# Selection stats

Select some text, open the command palette and run **Selection statistics**.
A notification shows:

```
42 words
251 characters (210 without spaces)
5 lines
3 sentences
Reading time: 11 sec
```

- Words are runs of letters and digits (`don't`, `well-known` and `3.14` are one
  each); every Han or kana character counts as one word.
- Characters are Unicode characters, so an emoji or an accented letter is one.
- Sentences end at `.`, `!`, `?` (or their full-width forms) before a space or
  the end; trailing text without an ending counts as one more.
- Reading time assumes 230 words a minute.

## Permissions

- `commands`: to add the palette command.
- `editor: selection.read`: to read the text you selected.

It cannot change anything, cannot read other notes and has no network access.
