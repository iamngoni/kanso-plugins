# Daily header

Inserts a line at the top of the open note with the date and the weather in
your city, from [Open-Meteo](https://open-meteo.com) (free, no key or account).

```
<!-- daily-header -->
**Sunday, 1 November 2026** · Harare, Zimbabwe · 24°C, partly cloudy · high 28°C, low 17°C · 20% chance of rain
```

## Setup

1. Run **Daily header settings (city)**, type your city, choose Celsius or
   Fahrenheit, and press Save. With no city the header shows only the date.
2. When installing, allow the plugin to read and change the notebooks you keep
   daily notes in.

## Use

Run **Insert the daily header (date and weather)** in a note. Running it again,
on the same or a later day, replaces the header it added (found by the
invisible `<!-- daily-header -->` line) instead of adding another. The date is
the one at the city, taken from the forecast. The city is looked up once and
remembered until you change it. If Open-Meteo cannot find the city, is busy
(429) or fails, the note is left unchanged and the message says why.

Changes wait for your review unless you turned off **Ask before changing
notes**.

## Why each permission

| Permission | Why |
|---|---|
| `commands`, `ui: panel` | The command and the settings panel |
| `editor: note.read`, `notes.read` | To read the open note |
| `notes.write` | To put the header at its top |
| `network: geocoding-api.open-meteo.com` | City name to coordinates, `/v1/search` |
| `network: api.open-meteo.com` | Today's weather, `/v1/forecast` |

Only the city name and its coordinates are sent.
