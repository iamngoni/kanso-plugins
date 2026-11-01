# Linear

Creates a Linear issue from the selected text, in a team you choose, and shows
the state of the Linear issues linked in the open note. It uses Linear's
GraphQL API.

## Setup

1. In Linear, open Settings › Account › Security & access › Personal API keys
   and create a key. If Linear offers to limit the key's permissions or teams,
   allow only reading and creating issues in the team you file in; this
   plugin needs nothing more. Keep the key to yourself and revoke it if it
   leaks.
2. In Kanso, open Settings › Plugins › Linear and paste the key under the
   secret named **`token`**.
3. At install, choose the notebooks the plugin may read and change. Saving the
   issue link on a note needs the note's notebook to be one of them.
4. Run **Linear: show the state of linked issues**, press **Load my teams**,
   pick the team and press **Save team**. (You can also type the team key,
   such as `ENG`.)

## Use

Select text such as:

```
Search results flicker on slow networks
Seen on 0.9.0, steps: ...
```

and run **Linear: create an issue from the selection**. The first line is the
title, the rest the description (Markdown). The issue's URL is saved in the
note's plugin data. The panel lists each `https://linear.app/<workspace>/issue/<TEAM-n>`
link in the note, plus issues made from it, with its workflow state (Todo, In
Progress, Done...). All of them are read in one request, at most 20.

## Why each permission

| Permission | Why |
|---|---|
| `commands` | The two palette commands |
| `editor`: `note.read`, `selection.read` | Read the open note for links, and the selection for the issue |
| `notes.read` | Read the open note's plugin data (you choose the notebooks) |
| `notes.write` | Save the created issue's URL in the note's plugin data (you choose the notebooks) |
| `ui: panel` | The status panel and team setting |
| `secrets: token` | The Linear API key, never logged or shown |
| `network: api.linear.app` | The only host it talks to, over HTTPS |

User text is sent only as GraphQL variables, never spliced into the query. The
plugin does not change a note's text. A 401, 403 or rate-limit answer is shown
as a plain message, and the key never appears in messages or logs.

Tests: `node --test plugins/app.kanso.linear/tests`.
