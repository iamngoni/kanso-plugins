# Month calendar

Draws a `calendar` block as a month grid. Days you list are marked with a
filled circle, a shaded cell and their labels.

## Usage

````
```calendar
month: 2026-11
2026-11-03: Dentist
2026-11-03: Call Sam
2026-11-27: Release
```
````

Weeks start on Monday; add `week: sun` for Sunday. Several lines for one day
all show (two, then "+N more"). Every dated line must fall inside the month,
and the date must exist (no 31 November); otherwise a message names the
line. Up to 200 marked days.

## Permissions

- `fences: calendar`: to draw `calendar` blocks. Nothing else is requested:
  the plugin can't read your notes, use the network or run commands.
