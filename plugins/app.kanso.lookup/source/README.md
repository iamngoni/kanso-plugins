# Look up

Select a word or phrase, run **Look up the selection**, and read its
definitions and a short Wikipedia summary in the panel. **Insert at the
selection** puts them in a block quote right after the selected text, as one
edit that Undo takes back. No account or token is needed.

## Setup

None. Install it and allow the panel. It reads and changes nothing but the
text you select.

## Example

Select `ephemeral` in a note and run the command. Pressing the button leaves:

```
ephemeral

> **ephemeral**
>
> *adjective* - Lasting a very short time.
>
> Ephemerality is the concept of things being transitory. ([Wikipedia](https://en.wikipedia.org/wiki/Ephemerality))
```

Up to 3 meanings with 2 definitions each are shown. A Wikipedia
disambiguation page is shown as such and not inserted. If one service has
nothing (404) or is busy (429), the other's result is still shown. Phrases up
to 100 characters are accepted.

## Why each permission

| Permission | Why |
|---|---|
| `commands`, `ui: panel` | The command and the result panel |
| `editor: selection.read` | To read the word or phrase to look up |
| `editor: selection.replace` | To insert the result after the selection |
| `network: api.dictionaryapi.dev` | Definitions, `https://api.dictionaryapi.dev/api/v2/entries/en/<word>` |
| `network: en.wikipedia.org` | Summary, `https://en.wikipedia.org/api/rest_v1/page/summary/<title>` |

The selected text is sent to those two services to look it up.
