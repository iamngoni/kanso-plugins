# Timeline

Draws a `timeline` block of dated items as a timeline, or as a Gantt chart
when any item is a date range. Dates are `YYYY-MM-DD` (year 1000 or later); items can be in any
order.

## Usage

````
```timeline
2026-01-05: Kickoff
2026-01-05..2026-02-01: Build
2026-02-01..2026-02-20: Beta
2026-03-01: Launch
```
````

Single dates become milestones (diamonds on a Gantt chart); ranges become
bars. With only single dates you get a horizontal timeline with labels above
and below the line. Up to 100 items. An impossible date, a range that ends
before it starts, or a line it can't read shows a message naming the line.

## Permissions

- `fences: timeline`: to draw `timeline` blocks. Nothing else is requested:
  the plugin can't read your notes, use the network or run commands.
