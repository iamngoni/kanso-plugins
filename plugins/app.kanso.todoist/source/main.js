// Todoist: pushes the open note's open "- [ ]" tasks to Todoist, and later
// pulls back which ones you completed there and ticks their boxes.
//
// Each pushed task is remembered in the note's plugin data under the task's
// text, with its Todoist id, so pushing again never creates it twice. Editing
// a task's text in the note makes it a new task. Todoist API v1:
// https://developer.todoist.com/api/v1/

const API = 'https://api.todoist.com/api/v1';
const MAX_PUSH = 15; // 30 requests a minute is the plugin's network limit
const MAX_COMPLETED_PAGES = 4;

// ---- Pure helpers -------------------------------------------------------

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\](\s+)(.*\S)\s*$/;

function taskKey(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// The checkbox tasks of a note body, outside fenced code.
function parseTasks(body) {
  const lines = body.split('\n');
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = TASK.exec(line);
    if (m) out.push({ line: i, done: m[2] !== ' ', text: m[4], key: taskKey(m[4]) });
  }
  return out;
}

// Ticks the open boxes whose key is in `doneKeys`. Returns the new body.
function tick(body, doneKeys) {
  const lines = body.split('\n');
  let changed = 0;
  for (const t of parseTasks(body)) {
    if (t.done || !doneKeys.has(t.key)) continue;
    lines[t.line] = lines[t.line].replace(/\[ \]/, '[x]');
    changed += 1;
  }
  return { body: lines.join('\n'), changed };
}

function toPush(tasks, known) {
  const seen = new Set();
  const out = [];
  for (const t of tasks) {
    if (t.done || known[t.key] || seen.has(t.key)) continue;
    seen.add(t.key);
    out.push(t);
  }
  return out;
}

function header(res, name) {
  const h = (res && res.headers) || {};
  for (const k of Object.keys(h)) if (k.toLowerCase() === name) return h[k];
  return null;
}

function failure(res) {
  if (res.status === 401 || res.status === 403) return 'Todoist rejected the token. Check the "token" secret in Settings > Plugins.';
  if (res.status === 429) {
    const wait = header(res, 'retry-after');
    return `Todoist asked us to slow down${wait ? ` (try again in ${wait}s)` : ''}.`;
  }
  return `Todoist answered ${res.status}.`;
}

// ---- Kanso side ----------------------------------------------------------

function openNote() {
  const id = kanso.editor.noteId();
  return id === null ? null : kanso.notes.get(id);
}

function dataOf(note) {
  const d = kanso.notes.pluginData.get(note.id);
  const tasks = d && typeof d === 'object' && d.tasks && typeof d.tasks === 'object' ? d.tasks : {};
  return { tasks: { ...tasks } };
}

function push() {
  const token = kanso.secrets.get('token');
  if (!token) return { text: 'Todoist: add your API token as the secret "token" in Settings > Plugins first.' };
  const note = openNote();
  if (!note) return { text: 'Todoist: open a note first.' };
  const data = dataOf(note);
  const todo = toPush(parseTasks(note.body), data.tasks);
  if (todo.length === 0) return { text: 'Todoist: every open task here is already in Todoist.' };
  let sent = 0;
  let problem = null;
  for (const t of todo.slice(0, MAX_PUSH)) {
    const payload = { content: t.text.trim(), description: `From the Kanso note "${(note.title || 'Untitled').slice(0, 120)}"` };
    const res = kanso.fetch(`${API}/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status !== 200 && res.status !== 201) {
      problem = failure(res);
      break;
    }
    let created = null;
    try {
      created = JSON.parse(res.body);
    } catch (e) {
      /* handled below */
    }
    if (!created || created.id == null) {
      problem = 'Todoist sent back something unexpected.';
      break;
    }
    data.tasks[t.key] = { id: String(created.id), at: new Date().toISOString(), done: false };
    sent += 1;
  }
  // Remember what was sent, even if a later task failed.
  if (sent > 0) kanso.notes.pluginData.set(note.id, data);
  const left = todo.length - sent;
  let text = `Todoist: sent ${sent} task${sent === 1 ? '' : 's'}.`;
  if (problem) text += ` ${problem}`;
  if (left > 0 && !problem) text += ` ${left} more: run it again to continue.`;
  return { text };
}

function pull() {
  const token = kanso.secrets.get('token');
  if (!token) return { text: 'Todoist: add your API token as the secret "token" in Settings > Plugins first.' };
  const note = openNote();
  if (!note) return { text: 'Todoist: open a note first.' };
  const data = dataOf(note);
  const open = parseTasks(note.body).filter((t) => !t.done && data.tasks[t.key] && !data.tasks[t.key].done);
  if (open.length === 0) return { text: 'Todoist: no pushed tasks here are waiting on Todoist.' };
  const wanted = new Map(); // todoist id -> key
  let oldest = Date.now();
  for (const t of open) {
    const entry = data.tasks[t.key];
    wanted.set(entry.id, t.key);
    oldest = Math.min(oldest, Date.parse(entry.at) || oldest);
  }
  // The completed-tasks endpoint covers at most 3 months.
  const since = new Date(Math.max(oldest - 60000, Date.now() - 89 * 86400000)).toISOString();
  const until = new Date(Date.now() + 60000).toISOString();
  const doneKeys = new Set();
  let cursor = null;
  for (let page = 0; page < MAX_COMPLETED_PAGES; page++) {
    const q = `since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = kanso.fetch(`${API}/tasks/completed/by_completion_date?${q}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status !== 200) return { text: `Todoist: ${failure(res)} Nothing was changed.` };
    let body;
    try {
      body = JSON.parse(res.body);
    } catch (e) {
      return { text: 'Todoist sent something unexpected. Nothing was changed.' };
    }
    for (const item of Array.isArray(body.items) ? body.items : []) {
      for (const id of [item.id, item.task_id]) {
        if (id != null && wanted.has(String(id))) doneKeys.add(wanted.get(String(id)));
      }
    }
    cursor = body.next_cursor || null;
    if (!cursor || doneKeys.size === wanted.size) break;
  }
  if (doneKeys.size === 0) return { text: 'Todoist: none of the pushed tasks are completed there yet.' };
  const result = tick(note.body, doneKeys);
  if (result.changed > 0) kanso.notes.update(note.id, { body: result.body }, { baseRev: note.rev });
  for (const key of doneKeys) data.tasks[key].done = true;
  kanso.notes.pluginData.set(note.id, data);
  return { text: `Todoist: ticked ${result.changed} completed task${result.changed === 1 ? '' : 's'}.` };
}

kanso.commands.register({
  id: 'push',
  title: 'Todoist: send open tasks',
  keywords: ['todoist', 'tasks', 'push', 'send'],
  when: 'note-open',
  run: () => push(),
});
kanso.commands.register({
  id: 'sync',
  title: 'Todoist: sync completed tasks',
  keywords: ['todoist', 'sync', 'pull', 'done'],
  when: 'note-open',
  run: () => pull(),
});

if (typeof globalThis.__kansoTest === 'object') {
  globalThis.__kansoTest.exports = { parseTasks, tick, toPush, taskKey };
}
