# Kanban board

Draws a `kanban` block as a board: each `## Heading` is a column and each
`- item` under it is a card. Cards written `- [x]` are shown as done (ticked
and struck through); `- [ ]` cards show an empty tick circle.

## Usage

````
```kanban
## To do
- Write the docs
- [ ] Review the PR

## Doing
- Build the importer

## Done
- [x] Ship 1.0
```
````

Up to 12 columns and 100 cards a column. Long cards wrap onto up to four
lines. A card before the first heading, or a line that is neither, shows a
message naming the line.

## Permissions

- `fences: kanban`: to draw `kanban` blocks. Nothing else is requested: the
  plugin can't read your notes, use the network or run commands.
