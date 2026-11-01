# Weekly review

Makes a note that lists what you created or changed in the last week,
grouped by notebook, each as a `[[link]]`.

## Use

Run **Make a weekly review note**, choose 7, 14 or 30 days and the notebook
to put the review in, and press **Make the review**. The note is called
`Weekly review 2026-10-25 to 2026-11-01` and looks like:

```
## Notebook work
### New
- [[Roadmap draft]] (2026-10-30)
### Changed
- [[Meeting notes]] (2026-10-28)
```

Notebooks appear by their ID, as Kanso does not tell plugins notebook
names. Earlier weekly reviews are left out. The note is staged and shown
for review unless you turned **Ask before changing notes** off; **Undo**
removes it. Reading is newest first and stops at the first note outside the
window, so it costs about one call per hundred notes. If a window holds
more than eight hundred notes the review says it stopped early.

## Permissions

| Permission | Why |
|---|---|
| `commands` | The palette command |
| `ui: panel` | The days and notebook choice |
| `notes.read` | Lists titles and dates. You pick the notebooks at install |
| `notes.write` and `notes.create` | Creating the review note (Kanso needs write access in a notebook before a plugin may create there). It never edits an existing note |
