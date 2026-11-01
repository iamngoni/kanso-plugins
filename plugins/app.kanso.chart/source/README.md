# Charts

Draws a `chart` block as a bar, line, area or pie chart, with axes, value
labels and a legend, in your theme's colours. It is richer than the Bar chart
sample: several series, negative values, and four chart types.

## Usage

Write one `label: value` per line. An optional first line picks the type
(`bar` is the default):

````
```chart
type: pie
Rent: 1200
Food: 450
Travel: 180
```
````

For several series, use CSV. A first row of names becomes the legend:

````
```chart
type: line
month, 2025, 2026
Jan, 4, 6
Feb, 5, 9
Mar, 7, 8
```
````

Limits: 200 points and 8 series. Pie charts take the first series and no
negative values. A mistake shows its message (for example
`Line 3: "x" is not a number.`) instead of a chart.

## Permissions

- `fences: chart`: to draw `chart` blocks. Nothing else is requested: the
  plugin can't read your notes, use the network or run commands.
