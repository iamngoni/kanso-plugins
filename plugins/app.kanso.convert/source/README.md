# Convert

Select text such as `5 km to mi` or `14:00 Harare in New York` and run one
of the two commands:

- **Convert units or time zones (replace selection)**: the selection becomes the result.
- **Convert units or time zones (add after selection)**: the result is added
  after it, as `5 km to mi = 3.106855961 mi`.

## Units

Length, mass, temperature, volume, speed and data sizes. Write a number
(`1,000.5`, `-40`, `1e3`; no number means one), a unit, `to` (or `in`, `as`,
`=`, `->`) and the unit you want. Several targets can be separated by commas.

```
5 km to mi              -> 3.106855961 mi
-40 c in f              -> -40 °F
10 m/s to km/h, mph     -> 36 km/h, 22.36936292 mph
1.5 GB to MB, MiB       -> 1500 MB, 1430.511475 MiB
```

Data sizes follow the case you type: `KB`, `MB`, `GB` are 1000-based, `KiB`,
`MiB`, `GiB` are 1024-based, `B` is a byte, `b` and `Kb`/`Mb`/`Gb` are bits.
Gallons are US unless you write `UK gal`. There is no currency: that needs a
network, and this plugin has none.

## Time zones

`[date] time zone to zone[, zone...]`. The time can be `14:00`, `2:30pm`,
`noon` or `midnight`; the date is `YYYY-MM-DD` and defaults to today in the
first zone. Zones are:

- fixed offsets: `UTC`, `UTC+5:30`, `GMT-8`, `+02:00`;
- abbreviations, as fixed offsets: `EST`, `PDT`, `CET`, `CAT`, `IST` (India), `BST` (British) ...;
- major cities or IANA names (`New York`, `America/Chicago`, `Harare`,
  `Tokyo`), with daylight saving time for the US, EU, Australia and New
  Zealand rules built in.

```
14:00 Harare in New York                 -> 07:00 New York (UTC-05:00)
2025-07-15 14:00 Harare in New York      -> 2025-07-15 08:00 New York (UTC-04:00)
2pm London to Tokyo, Sydney              -> 23:00 Tokyo (UTC+09:00); 01:00 Sydney (UTC+11:00) +1 day
```

The rules are compiled in and cover the current US, EU, Australian and New
Zealand schedules; zones with other rules (for example Israel, Chile, Egypt)
use a fixed offset or are left out. A time that daylight saving skips moves
forward; one that happens twice is read as the first time.

If the selection moves while the command runs, nothing is changed and you are
asked to select again.

## Permissions

- `commands`: to add the palette commands.
- `editor: selection.read`: to read the text you selected.
- `editor: selection.replace`: to put the result in its place, as one edit Undo takes back.

It cannot read other notes and has no network access.
