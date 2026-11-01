# GitHub

Creates a GitHub issue from the selected text, and shows the state of the
GitHub issue and pull request links in the open note.

## Setup

1. On GitHub, create a **fine-grained personal access token**
   (Settings › Developer settings › Personal access tokens › Fine-grained).
   Limit it to the one repository (or the few) you file issues in.
2. Repository permissions, the minimum:
   - **Issues: Read and write** (create issues, read issue state)
   - **Pull requests: Read-only** (read the state of pull request links)
   - Metadata: Read-only is added automatically.
3. In Kanso, open Settings › Plugins › GitHub and paste the token under the
   secret named **`token`**.
4. At install, choose the notebooks the plugin may read and change. Saving the
   issue link on a note needs the note's notebook to be one of them.
5. Run **GitHub: show the status of linked issues and pull requests**, type
   the repository as `owner/name` in the panel and press **Save repository**.

## Use

Select text such as:

```
Crash when saving an empty note
Steps: open a new note, press Cmd+S.
Expected: it saves.
```

and run **GitHub: create an issue from the selection**. The first line is the
title and the rest is the body. The issue's URL is saved in the note's plugin
data, and shown in the notification. The panel lists every
`https://github.com/<owner>/<repo>/issues/<n>` or `/pull/<n>` link in the note
(plus the issues made from it) with its state: open, closed, closed (not
planned) or merged. It reads at most 20 links per refresh to stay inside the
30 requests a minute Kanso allows.

## Why each permission

| Permission | Why |
|---|---|
| `commands` | The two palette commands |
| `editor`: `note.read`, `selection.read` | Read the open note for links, and the selection for the issue |
| `notes.read` | Read the open note's plugin data (you choose the notebooks) |
| `notes.write` | Save the created issue's URL in the note's plugin data (you choose the notebooks) |
| `ui: panel` | The status panel and repository setting |
| `secrets: token` | The GitHub token, never logged or shown |
| `network: api.github.com` | The only host it talks to, over HTTPS |

The plugin does not change a note's text. A 401, 403 or 429 from GitHub is
shown as a plain message, and the token never appears in messages or logs.

Tests: `node --test plugins/app.kanso.github/tests`.
