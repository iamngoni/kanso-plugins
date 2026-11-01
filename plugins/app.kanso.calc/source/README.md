# Calc table

Draws a `calc` fenced block, a Markdown pipe table whose cells can be
formulas, as a table of computed values.

````
```calc
| Item  | Price |
|-------|------:|
| Tea   |     3 |
| Cake  |   4.5 |
| Jam   |  2.25 |
| Total | =SUM(B2:B4) |
| Tax   | =B5*20% |
```
````

## Cells

- Rows count from 1 at the first line of the table (the header is row 1) and
  columns run A to Z, so `B2` is the second cell of the second row.
- A cell starting with `=` is a formula. Formula results are shown in the
  accent color.
- Plain numbers are right-aligned; the separator row (`:---`, `---:`,
  `:---:`) aligns columns. Escape a pipe in a cell as `\|`.
- Up to 100 rows and 26 columns.

## Formulas

- Operators: `+ - * / ^`, unary `-`, postfix `%` (`=B5*20%`), parentheses.
- References `A1` and ranges `A1:B3` (ranges only as function arguments).
  Empty cells are 0 in arithmetic; text and empty cells are skipped in ranges.
- Functions: `SUM AVERAGE (or AVG) MIN MAX COUNT PRODUCT ABS SQRT POW ROUND
  FLOOR CEIL`. `ROUND`, `FLOOR` and `CEIL` take an optional digit count.
- Errors appear in the cell and stay there: `#DIV/0!`, `#VALUE!` (text in
  arithmetic), `#NAME?` (unknown name), `#REF!` (outside the table), `#NUM!`,
  `#CYCLE!` (formulas that depend on each other) and `#ERR!` (cannot parse).

Formulas are read by a small parser and worked out directly. Nothing is run
as code.

## Permissions

| Permission | Why |
|---|---|
| `fences: [{ "language": "calc" }]` | To draw `calc` blocks. Nothing else: no notes, no network, no commands. |
