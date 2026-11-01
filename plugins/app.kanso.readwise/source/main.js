// Readwise: imports highlights from the Readwise export API as one note per
// book or article, in one notebook, and adds new highlights to the same note
// on later runs.
//
// A run is incremental: `cursor` (the time of the last finished run) is sent
// as updatedAfter, so only changed items come back. A run stops after a few
// notes to stay inside Kanso's budgets and says "run again"; where it
// stopped is kept in `run`. Every highlight is written with an invisible
// <!-- rw:ID --> marker, and every note starts with <!-- readwise:ID -->, so
// running twice never duplicates anything.

const EXPORT_URL = 'https://readwise.io/api/v2/export/';
const MAX_BOOKS_PER_RUN = 10; // each costs about 3 calls to Kanso (60 a minute)
const MAX_PAGES_PER_RUN = 3; // Readwise allows 20 export requests a minute
const SKEW_MS = 60 * 1000;

// ---- Pure helpers -------------------------------------------------------

const SPECIALS = /([\\`*_\[\]<>#~|&])/g;

// Escapes one line of text so Markdown shows it as written.
function escapeLine(line) {
  return line
    .replace(SPECIALS, '\\$1')
    .replace(/^(\s*)([-+=])/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/, '$1\\$2');
}

function escapeText(text) {
  return String(text)
    .split(/\r\n|\r|\n/)
    .map(escapeLine)
    .join('\n');
}

// The inverse of escapeText, for tests.
function unescapeText(text) {
  return text.replace(/\\([\\`*_\[\]<>#~|&\-+=.)])/g, '$1');
}

function oneLine(text, max) {
  const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, max).join('');
}

function noteTitle(book) {
  return oneLine(book.readable_title || book.title, 120) || 'Untitled';
}

function safeUrl(url) {
  if (typeof url !== 'string') return null;
  if (!/^https?:\/\/[^\s<>]+$/i.test(url)) return null;
  return url.replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'));
}

function bookMarker(book) {
  return `<!-- readwise:${String(book.user_book_id).replace(/[^0-9A-Za-z_-]/g, '')} -->`;
}

function highlightMarker(h) {
  return `<!-- rw:${String(h.id).replace(/[^0-9A-Za-z_-]/g, '')} -->`;
}

function usable(highlights) {
  return (highlights || []).filter((h) => h && h.id != null && !h.is_discard && typeof h.text === 'string' && h.text.trim() !== '');
}

function renderHighlight(h) {
  const lines = escapeText(h.text.trim()).split('\n');
  const quote = lines.map((l) => `> ${l}`.trimEnd());
  quote[quote.length - 1] += ` ${highlightMarker(h)}`;
  const parts = [quote.join('\n')];
  const extra = [];
  if (h.location != null && h.location !== '') {
    extra.push(`${escapeText(h.location_type || 'location')} ${escapeText(h.location)}`);
  }
  if (Array.isArray(h.tags) && h.tags.length) {
    extra.push(h.tags.map((t) => escapeText(t && t.name ? t.name : t)).join(', '));
  }
  if (extra.length) parts.push(`*${extra.join(' · ')}*`.replace(/\n/g, ' '));
  if (typeof h.note === 'string' && h.note.trim() !== '') {
    parts.push(`**Note:** ${escapeText(h.note.trim()).replace(/\n/g, '  \n')}`);
  }
  return parts.join('\n\n');
}

function renderHeader(book) {
  const lines = [bookMarker(book), ''];
  if (book.author) lines.push(`**Author:** ${escapeText(oneLine(book.author, 200))}  `);
  if (book.category) lines.push(`**Type:** ${escapeText(oneLine(book.category, 40))}  `);
  const url = safeUrl(book.source_url) || safeUrl(book.readwise_url);
  if (url) lines.push(`**Source:** <${url}>  `);
  lines.push('', '## Highlights');
  return lines.join('\n');
}

function knownIds(body) {
  const ids = new Set();
  const re = /<!-- rw:([0-9A-Za-z_-]+) -->/g;
  let m;
  while ((m = re.exec(body)) !== null) ids.add(m[1]);
  return ids;
}

// What to do for one export entry given the existing note body (or null).
function plan(book, existingBody) {
  const all = usable(book.highlights);
  if (existingBody === null) {
    if (all.length === 0) return { action: 'none' };
    const body = [renderHeader(book), ...all.map(renderHighlight)].join('\n\n') + '\n';
    return { action: 'create', body, added: all.length };
  }
  const have = knownIds(existingBody);
  const fresh = all.filter((h) => !have.has(String(h.id).replace(/[^0-9A-Za-z_-]/g, '')));
  if (fresh.length === 0) return { action: 'none' };
  const sep = existingBody.endsWith('\n') ? '\n' : '\n\n';
  return { action: 'append', body: existingBody + sep + fresh.map(renderHighlight).join('\n\n') + '\n', added: fresh.length };
}

function laterOf(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
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
  if (id === null) return null;
  return kanso.notes.get(id).bookId;
}

// Titles of the notes in the notebook, read once a run (100 a call). The
// search is not relied on, so odd titles are always found. A notebook too
// big to list within the call budget is refused rather than risk duplicates.
const MAX_LIST_PAGES = 15;

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

function findNote(index, book) {
  const marker = bookMarker(book);
  for (const id of index.get(noteTitle(book)) || []) {
    const full = kanso.notes.get(id);
    if (full.body.includes(marker)) return full;
  }
  return null;
}

function importNow() {
  const token = kanso.secrets.get('token');
  if (!token) return { text: 'Readwise: add your access token as the secret "token" in Settings > Plugins first.' };
  const st = state();
  let bookId = st.bookId || null;
  if (!bookId) {
    bookId = openBook();
    if (!bookId) return { text: 'Readwise: open a note in the notebook to import into, then run this again.' };
    st.bookId = bookId;
  }
  const since = st.cursor || null;
  const run = st.run || null;
  const started = run ? run.started : new Date(Date.now() - SKEW_MS).toISOString();
  let pageCursor = run ? run.pageCursor : null;
  let skip = run ? run.skip : 0;
  const tally = { created: 0, appended: 0, unchanged: 0 };
  const madeThisRun = new Set();
  let handled = 0;
  let index = null;
  let pages = 0;

  const pause = (message) => {
    st.run = { started, pageCursor, skip };
    kanso.settings.set(st);
    return { text: `Readwise: ${message} Run it again to continue.` };
  };
  const summary = () => `${tally.created} new, ${tally.appended} updated, ${tally.unchanged} unchanged`;

  for (;;) {
    const query = [];
    if (since) query.push(`updatedAfter=${encodeURIComponent(since)}`);
    if (pageCursor) query.push(`pageCursor=${encodeURIComponent(pageCursor)}`);
    const res = kanso.fetch(EXPORT_URL + (query.length ? `?${query.join('&')}` : ''), {
      headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
    });
    pages += 1;
    if (res.status === 401 || res.status === 403) {
      return { text: 'Readwise rejected the token. Check the "token" secret in Settings > Plugins.' };
    }
    if (res.status === 429) {
      const wait = header(res, 'retry-after');
      return pause(`Readwise asked us to slow down${wait ? ` (try again in ${wait}s)` : ''}; ${summary()} so far.`);
    }
    if (res.status !== 200) return { text: `Readwise answered ${res.status}; nothing more was imported. ${summary()}.` };
    let data;
    try {
      data = JSON.parse(res.body);
    } catch (e) {
      return { text: 'Readwise sent something that is not JSON; try again later.' };
    }
    const results = Array.isArray(data.results) ? data.results : [];
    for (let i = skip; i < results.length; i++) {
      if (handled >= MAX_BOOKS_PER_RUN) {
        skip = i;
        return pause(`${summary()} (stopped to stay within Kanso's limits).`);
      }
      const book = results[i];
      handled += 1;
      const id = String(book.user_book_id);
      if (madeThisRun.has(id)) {
        tally.unchanged += 1;
        continue;
      }
      if (index === null) {
        index = titleIndex(bookId);
        if (index === null) return { text: 'Readwise: that notebook has too many notes to check for duplicates safely. Pick a smaller notebook for the import.' };
      }
      const existing = findNote(index, book);
      const p = plan(book, existing ? existing.body : null);
      if (p.action === 'create') {
        kanso.notes.create({ bookId, title: noteTitle(book), body: p.body });
        madeThisRun.add(id);
        tally.created += 1;
      } else if (p.action === 'append') {
        kanso.notes.update(existing.id, { body: p.body }, { baseRev: existing.rev });
        tally.appended += 1;
      } else {
        tally.unchanged += 1;
      }
    }
    skip = 0;
    if (!data.nextPageCursor) break;
    pageCursor = data.nextPageCursor;
    if (pages >= MAX_PAGES_PER_RUN) return pause(`${summary()}.`);
  }
  st.cursor = laterOf(since, started);
  st.run = null;
  st.lastSync = new Date().toISOString();
  kanso.settings.set(st);
  return { text: `Readwise: done. ${summary()}.` };
}

function panel(message) {
  const st = state();
  const children = [
    { type: 'heading', value: 'Readwise' },
    { type: 'text', value: st.bookId ? 'Importing into a notebook you chose.' : 'No notebook chosen yet. Open a note in the notebook you want, then press "Use the open note\'s notebook".', style: 'muted' },
    { type: 'text', value: st.cursor ? `Up to date as of ${st.cursor}.` : 'Never imported.', style: 'muted' },
  ];
  if (st.run) children.push({ type: 'text', value: 'An import is partly done. Press "Import now" to continue.' });
  if (message) children.push({ type: 'text', value: message });
  children.push(
    { type: 'row', gap: 8, children: [
      { type: 'button', id: 'import', label: 'Import now', tone: 'primary' },
      { type: 'button', id: 'set-notebook', label: "Use the open note's notebook" },
    ] },
    { type: 'button', id: 'resync', label: 'Start over (re-check everything)' },
  );
  kanso.ui.panel({ type: 'column', gap: 12, children });
}

function shown(result) {
  panel(result && result.text);
  return result;
}

kanso.commands.register({
  id: 'import',
  title: 'Readwise: import highlights',
  keywords: ['readwise', 'highlights', 'import', 'sync'],
  run: () => shown(importNow()),
});
kanso.commands.register({
  id: 'panel',
  title: 'Readwise: show panel',
  keywords: ['readwise'],
  run: () => {
    panel();
    return null;
  },
});
kanso.ui.onPress('import', () => shown(importNow()));
kanso.ui.onPress('set-notebook', () => {
  const book = openBook();
  if (!book) return shown({ text: 'Open a note first.' });
  const st = state();
  st.bookId = book;
  kanso.settings.set(st);
  return shown({ text: 'Importing into this note\'s notebook from now on.' });
});
kanso.ui.onPress('resync', () => {
  const st = state();
  st.cursor = null;
  st.run = null;
  kanso.settings.set(st);
  return shown({ text: 'Next import re-checks everything. Notes already imported are not duplicated.' });
});

if (typeof globalThis.__kansoTest === 'object') {
  globalThis.__kansoTest.exports = { escapeText, unescapeText, plan, renderHighlight, laterOf, noteTitle, knownIds };
}
