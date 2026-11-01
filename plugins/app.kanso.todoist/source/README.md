# Todoist

Sends the open note's open `- [ ]` tasks to Todoist, and ticks the boxes of the
ones you finish there.

## Setup

1. In Todoist open Settings > Integrations > Developer and copy your **API
   token**.
2. In Kanso, Settings > Plugins > Todoist: save it as the secret named
   `token`. It is never logged.
3. When installing, allow the plugin to read and change the notebooks whose
   notes you will use it in.

## Use

- **Todoist: send open tasks** creates a Todoist task (in your Inbox) for each
  unticked `- [ ]` item in the open note (bullets or numbered, nested too,
  not inside code fences). Each task's Todoist id is saved in the note's plugin
  data under the task's text, so running it again sends only tasks that are
  new. Editing a task's text makes it a new task. At most 15 are sent per run;
  it says **run it again to continue** if there are more.
- **Todoist: sync completed tasks** asks Todoist which of the tasks you sent
  have been completed (within the last 3 months) and ticks those boxes in the
  note. A box you untick yourself is left alone afterwards.

A 401 or 403 tells you to check the token; a 429 says when to retry. Nothing
is lost if a run stops partway: what was sent is remembered. Changes to the
note wait for your review unless you turned off **Ask before changing notes**.

## Why each permission

| Permission | Why |
|---|---|
| `commands` | The two commands |
| `editor: note.read` | To know which note is open |
| `notes.read` | To read the open note's tasks and its saved task ids |
| `notes.write` | To tick boxes and save the ids on the note |
| `secrets: token` | Your Todoist API token |
| `network: api.todoist.com` | Todoist API v1 (`/api/v1/tasks`, `/api/v1/tasks/completed/by_completion_date`), the only host used |
