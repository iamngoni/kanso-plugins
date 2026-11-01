# Format

Palette commands that format the text you have selected.

| Command | What it does |
|---|---|
| Pretty-print JSON | Two-space indent. Works on the text itself, so number literals (even 20-digit ids), key order and duplicate keys are kept as written |
| Minify JSON | Removes all whitespace outside strings |
| Format SQL | Upper-cases keywords and common functions, puts clauses (`FROM`, `WHERE`, `GROUP BY`, joins, `UNION` ...) on new lines, one item per line in long `SELECT` lists, and indents `AND`/`OR`/`ON` and subqueries. Strings, quoted names and comments are untouched |

Example: select `select a, b from t where x = 1 and y = 2` and run
**Format SQL**:

```
SELECT
  a,
  b
FROM t
WHERE x = 1
  AND y = 2
```

Invalid JSON is never changed. A notification says where it is wrong, for
example `Invalid JSON at line 3, column 5: ...`. If the selection moves
while a command runs, nothing is changed and you are asked to select again.

## Permissions

- `commands`: to add the palette commands.
- `editor: selection.read`: to read the text you selected.
- `editor: selection.replace`: to put the formatted text back, as one edit Undo takes back.

No other notes are read and there is no network access.
