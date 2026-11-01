// Raindrop.io: imports the bookmarks of one collection as one note each, or
// as a single list note, newest first, and only the new ones on later runs.
//
// `cursor` is the `created` time of the newest bookmark already imported;
// a run stops at the first bookmark not newer than it. A run handles only a
// few pages (Kanso allows 60 calls a minute, 5 seconds a command) and says
// "run again" if there is more; where it stopped is kept in `run`. Notes
// carry <!-- raindrop:ID --> and the ids imported lately are remembered in
// settings, so a run repeated or resumed never makes the same note twice.

const API = 'https://api.raindrop.io/rest/v1';
const MODES = {
  notes: { perpage: 20, pages: 2 }, // one Kanso call per note
  list: { perpage: 50, pages: 4 },
};
const MAX_RECENT = 1500;
const MAX_LIST_PAGES = 15;

// ---- Pure helpers -------------------------------------------------------

const SPECIALS = /([\\`*_\[\]<>#~|&])/g;

function escapeLine(line) {
  return line
    .replace(SPECIALS, '\\$1')
    .replace(/^(\s*)([-+=])/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/, '$1\\$2');
}

function escapeText(text) {
  return String(text == null ? '' : text)
    .split(/\r\n|\r|\n/)
    .map(escapeLine)
    .join('\n');
}

function unescapeText(text) {
  return text.replace(/\\([\\`*_\[\]<>#~|&\-+=.)])/g, '$1');
}

function oneLine(text, max) {
  const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, max).join('');
}

// An http(s) address safe to put in a Markdown link, or null.
function safeUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\/[^\s<>]+$/i.test(url)) return null;
  return url.replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'));
}

function cleanId(id) {
  return String(id).replace(/[^0-9A-Za-z_-]/g, '');
}

function marker(item) {
  return `<!-- raindrop:${cleanId(item._id)} -->`;
}

function titleOf(item) {
  return oneLine(item.title, 120) || oneLine(item.domain, 120) || 'Untitled';
}

function tagLine(item) {
  const tags = (Array.isArray(item.tags) ? item.tags : []).map((t) => oneLine(t, 60)).filter(Boolean);
  return tags.length ? `Tags: ${tags.map(escapeText).join(', ')}` : '';
}

function noteBody(item) {
  const lines = [marker(item), ''];
  const url = safeUrl(item.link);
  lines.push(url ? `<${url}>` : escapeText(oneLine(item.link, 300)));
  if (typeof item.excerpt === 'string' && item.excerpt.trim()) lines.push('', escapeText(item.excerpt.trim()));
  if (typeof item.note === 'string' && item.note.trim()) lines.push('', `**Note:** ${escapeText(item.note.trim()).replace(/\n/g, '  \n')}`);
  const tags = tagLine(item);
  if (tags) lines.push('', tags);
  return lines.join('\n') + '\n';
}

function listLine(item) {
  const url = safeUrl(item.link);
  const title = escapeText(titleOf(item));
  let line = url ? `- [${title}](${url})` : `- ${title}`;
  const excerpt = oneLine(item.excerpt, 200);
  if (excerpt) line += ` - ${escapeText(excerpt)}`;
  const tags = tagLine(item);
  if (tags) line += ` (${tags.replace(/^Tags: /, '')})`;
  return `${line} ${marker(item)}`;
}

function listHeader(key, name) {
  return `<!-- raindrop-list:${cleanId(key)} -->\n\nBookmarks from ${escapeText(oneLine(name, 120))}, newest first.\n`;
}

function idsIn(body) {
  const ids = new Set();
  const re = /<!-- raindrop:([0-9A-Za-z_-]+) -->/g;
  let m;
  while ((m = re.exec(body)) !== null) ids.add(m[1]);
  return ids;
}

// New lines go right under the header, so the list stays newest first.
function addToList(body, items) {
  const have = idsIn(body);
  const fresh = items.filter((i) => !have.has(cleanId(i._id)));
  if (fresh.length === 0) return { body, added: 0 };
  const lines = body.split('\n');
  let at = lines.findIndex((l) => l.startsWith('- ') && l.includes('<!-- raindrop:'));
  if (at < 0) at = lines.length;
  const block = fresh.map(listLine);
  lines.splice(at, 0, ...block);
  let out = lines.join('\n');
  if (!out.endsWith('\n')) out += '\n';
  return { body: out, added: fresh.length };
}

function time(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function laterOf(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return time(b) > time(a) ? b : a;
}

// Items newer than `cursor` and not in `seen`, in the order given.
function fresh(items, cursor, seen) {
  const out = [];
  for (const item of items) {
    if (item && item._id != null && cursor && time(item.created) <= time(cursor)) continue;
    if (item && item._id != null && !seen.has(cleanId(item._id))) out.push(item);
  }
  return out;
}

function header(res, name) {
  const h = (res && res.headers) || {};
  for (const k of Object.keys(h)) if (k.toLowerCase() === name) return h[k];
  return null;
}

// ---- Kanso side ----------------------------------------------------------

function state() {
  const s = kanso.settings.get();
  return s && typeof s === 'object' ? s : {};
}

function openBook() {
  const id = kanso.editor.noteId();
  return id === null ? null : kanso.notes.get(id).bookId;
}

function api(token, path) {
  return kanso.fetch(API + path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
}

function problem(res) {
  if (res.status === 401 || res.status === 403) return { text: 'Raindrop rejected the token. Check the "token" secret in Settings > Plugins.' };
  if (res.status === 429) {
    const wait = header(res, 'retry-after');
    return { text: `Raindrop asked us to slow down${wait ? ` (try again in ${wait}s)` : ''}. Run it again shortly.`, paused: true };
  }
  if (res.status === 404) return { text: 'Raindrop could not find that collection.' };
  if (res.status !== 200) return { text: `Raindrop answered ${res.status}.` };
  return null;
}

function parse(res) {
  try {
    return JSON.parse(res.body);
  } catch (e) {
    return null;
  }
}

// A collection given as a number, or looked up by name among the user's
// collections and their children. Returns { id, name } or an error text.
function resolveCollection(token, wanted) {
  const text = String(wanted == null || wanted === '' ? '0' : wanted).trim();
  if (/^-?\d+$/.test(text)) {
    const names = { '0': 'All bookmarks', '-1': 'Unsorted', '-99': 'Trash' };
    return { id: Number(text), name: names[text] || `collection ${text}` };
  }
  const all = [];
  for (const path of ['/collections', '/collections/childrens']) {
    const res = api(token, path);
    const bad = problem(res);
    if (bad) return { error: bad };
    const data = parse(res);
    if (data && Array.isArray(data.items)) all.push(...data.items);
  }
  const lower = text.toLowerCase();
  const hit = all.find((c) => typeof c.title === 'string' && c.title.toLowerCase() === lower);
  if (!hit) return { error: { text: `Raindrop has no collection called "${oneLine(text, 80)}". Use its exact name, or its number.` } };
  return { id: hit._id, name: hit.title };
}

function titleIndex(bookId) {
  const index = new Map();
  let cursor;
  for (let i = 0; i < MAX_LIST_PAGES; i++) {
    const page = kanso.notes.list({ bookId, limit: 100, cursor });
    for (const n of page.notes) {
      if (!index.has(n.title)) index.set(n.title, []);
      index.get(n.title).push(n.id);
    }
    if (!page.cursor) return index;
    cursor = page.cursor;
  }
  return null;
}

function importNow() {
  const token = kanso.secrets.get('token');
  if (!token) return { text: 'Raindrop: add your token as the secret "token" in Settings > Plugins first.' };
  const st = state();
  if (!st.bookId) {
    const book = openBook();
    if (!book) return { text: 'Raindrop: open a note in the notebook to import into, then run this again.' };
    st.bookId = book;
  }
  const mode = st.mode === 'list' ? 'list' : 'notes';
  const limits = MODES[mode];
  const found = resolveCollection(token, st.collection);
  if (found.error) return found.error;
  const key = String(found.id);
  // A different collection or mode starts from its own cursor.
  const cursors = st.cursors && typeof st.cursors === 'object' ? st.cursors : {};
  const slot = `${mode}:${key}`;
  const cursor = cursors[slot] || null;
  const run = st.run && st.run.slot === slot ? st.run : null;
  const seen = new Set(Array.isArray(st.recent) ? st.recent : []);
  let page = run ? run.page : 0;
  let newest = run ? run.newest : null;
  const collected = [];
  let reachedOld = false;
  let fetched = 0;
  let more = false;

  while (fetched < limits.pages) {
    const res = api(token, `/raindrops/${encodeURIComponent(found.id)}?sort=-created&perpage=${limits.perpage}&page=${page}`);
    fetched += 1;
    const bad = problem(res);
    if (bad) {
      if (bad.paused) {
        st.run = { slot, page, newest };
        kanso.settings.set(st);
      }
      return { text: bad.text };
    }
    const data = parse(res);
    const items = data && Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) {
      reachedOld = true;
      break;
    }
    if (page === 0 || !newest) newest = laterOf(newest, items[0].created);
    for (const item of items) newest = laterOf(newest, item.created);
    const news = fresh(items, cursor, seen);
    collected.push(...news);
    if (items.some((i) => cursor && time(i.created) <= time(cursor)) || items.length < limits.perpage) {
      reachedOld = true;
      break;
    }
    page += 1;
    more = true;
  }
  if (!reachedOld) more = true;

  let made = 0;
  if (collected.length) {
    if (mode === 'notes') {
      for (const item of collected) {
        kanso.notes.create({ bookId: st.bookId, title: titleOf(item), body: noteBody(item) });
        made += 1;
      }
    } else {
      const index = titleIndex(st.bookId);
      if (index === null) return { text: 'Raindrop: that notebook has too many notes to check safely. Pick a smaller notebook for the import.' };
      const title = `Raindrop: ${oneLine(found.name, 100)}`;
      const marked = `<!-- raindrop-list:${cleanId(key)} -->`;
      let existing = null;
      for (const id of index.get(title) || []) {
        const full = kanso.notes.get(id);
        if (full.body.includes(marked)) existing = full;
      }
      if (existing) {
        const r = addToList(existing.body, collected);
        made = r.added;
        if (r.added) kanso.notes.update(existing.id, { body: r.body }, { baseRev: existing.rev });
      } else {
        const r = addToList(listHeader(key, found.name), collected);
        made = r.added;
        kanso.notes.create({ bookId: st.bookId, title, body: r.body });
      }
    }
    const recent = (Array.isArray(st.recent) ? st.recent : []).concat(collected.map((i) => cleanId(i._id)));
    st.recent = recent.slice(-MAX_RECENT);
  }

  if (more) {
    st.run = { slot, page, newest };
  } else {
    cursors[slot] = laterOf(cursor, newest);
    st.cursors = cursors;
    st.run = null;
    st.lastSync = new Date().toISOString();
  }
  kanso.settings.set(st);
  const what = mode === 'notes' ? `${made} new notes` : `${made} bookmarks added to the list note`;
  return { text: `Raindrop: ${what} from ${found.name}.${more ? ' There are more: run it again to continue.' : ' Up to date.'}` };
}

function panel(message) {
  const st = state();
  const kids = [
    { type: 'heading', value: 'Raindrop.io' },
    { type: 'input', id: 'collection', label: 'Collection (name or number; blank for all)', value: st.collection == null ? '' : String(st.collection), placeholder: 'Reading list' },
    { type: 'select', id: 'mode', label: 'Import as', value: st.mode === 'list' ? 'One list note' : 'One note per bookmark', options: ['One note per bookmark', 'One list note'] },
    { type: 'text', value: st.bookId ? 'Importing into a notebook you chose.' : 'No notebook chosen: open a note in it and press "Use the open note\'s notebook".', style: 'muted' },
  ];
  if (st.run) kids.push({ type: 'text', value: 'An import is partly done: press Import to continue.' });
  if (message) kids.push({ type: 'text', value: message });
  kids.push({ type: 'row', gap: 8, children: [
    { type: 'button', id: 'import', label: 'Save and import', tone: 'primary' },
    { type: 'button', id: 'set-notebook', label: "Use the open note's notebook" },
  ] });
  kanso.ui.panel({ type: 'column', gap: 12, children: kids });
}

function shown(result) {
  panel(result && result.text);
  return result;
}

function save(values) {
  const st = state();
  if (values && typeof values === 'object') {
    if (typeof values.collection === 'string') st.collection = values.collection.trim();
    if (typeof values.mode === 'string') st.mode = values.mode === 'One list note' ? 'list' : 'notes';
    kanso.settings.set(st);
  }
}

kanso.commands.register({
  id: 'import',
  title: 'Raindrop: import bookmarks',
  keywords: ['raindrop', 'bookmarks', 'import'],
  run: () => shown(importNow()),
});
kanso.commands.register({
  id: 'panel',
  title: 'Raindrop: choose collection and mode',
  keywords: ['raindrop', 'settings'],
  run: () => {
    panel();
    return null;
  },
});
kanso.ui.onPress('import', (values) => {
  save(values);
  return shown(importNow());
});
kanso.ui.onPress('set-notebook', (values) => {
  save(values);
  const book = openBook();
  if (!book) return shown({ text: 'Open a note first.' });
  const st = state();
  st.bookId = book;
  kanso.settings.set(st);
  return shown({ text: "Importing into this note's notebook from now on." });
});

if (typeof globalThis.__kansoTest === 'object') {
  globalThis.__kansoTest.exports = { escapeText, unescapeText, noteBody, listLine, addToList, listHeader, idsIn, fresh, laterOf, safeUrl };
}
