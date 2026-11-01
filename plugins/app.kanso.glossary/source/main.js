// Glossary: terms defined across the notes it may read, as `Term:: definition`
// lines or entries under a `## Glossary` heading. Reading a note costs one
// call and a plugin gets 60 a minute, so each Refresh reads at most 40 changed
// notes and keeps what it found in settings; press Refresh again to continue.

var MAX_TERM = 80;
var MAX_DEF = 240;
var MAX_PER_NOTE = 30;
var MAX_TITLE = 60;
var MAX_PAGES = 5;
var MAX_READS = 40;
var MAX_INDEX_BYTES = 56000;
var MAX_RESULTS = 30;
var MAX_OPTIONS = 50;

function clip(text, n) {
  var t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function cleanTerm(text) {
  return String(text).replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
}

function goodTerm(term) {
  return term.length >= 1 && term.length <= MAX_TERM && !/^[#>|!\-]/.test(term) && !/^\d+[.)]?$/.test(term);
}

// Every definition in `body`, first one wins per term: [{ term, def }].
function extract(body) {
  var text = String(body).replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
  var lines = text.split(/\r?\n/);
  var out = [];
  var seen = {};
  var fence = null;
  var glossary = 0; // heading level of the open Glossary section, or 0
  function add(term, def) {
    term = cleanTerm(term);
    def = clip(def, MAX_DEF);
    var key = term.toLowerCase();
    if (!goodTerm(term) || def === '' || seen[key] === true || out.length >= MAX_PER_NOTE) return;
    seen[key] = true;
    out.push({ term: term, def: def });
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) { fence = f[1]; continue; }
    var h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      var level = h[1].length;
      if (/^glossary$/i.test(cleanTerm(h[2]))) glossary = level;
      else if (glossary && level <= glossary) glossary = 0;
      continue;
    }
    var m = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?([^\s:][^:]*?)(?:\*\*|__)?::[ \t]+(\S.*?)\s*$/.exec(line);
    if (m) { add(m[1], m[2]); continue; }
    if (!glossary) continue;
    m = /^\s*(?:[-*+]\s+)?(?:\*\*|__)([^*_\n]+?)(?:\*\*|__)\s*(?::|[-–—])\s*(\S.*?)\s*$/.exec(line)
      || /^\s*[-*+]\s+([^:\n–—]{1,60}?)\s*(?::|–|—|\s-\s)\s*(\S.*?)\s*$/.exec(line)
      || /^([A-Za-z][^:\n]{0,59}):\s+(\S.*?)\s*$/.exec(line);
    if (m) add(m[1], m[2]);
  }
  return out;
}

function freshState() {
  return { notes: {}, q: '' };
}

// Settings are untrusted once read back: keep only well-formed entries.
function normalize(raw) {
  var s = freshState();
  if (!raw || typeof raw !== 'object') return s;
  if (typeof raw.q === 'string') s.q = raw.q.slice(0, 200);
  if (raw.notes && typeof raw.notes === 'object') {
    Object.keys(raw.notes).forEach(function (id) {
      var e = raw.notes[id];
      if (!e || typeof e !== 'object' || !Array.isArray(e.t)) return;
      var terms = e.t.filter(function (p) {
        return Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string' && goodTerm(p[0]);
      }).slice(0, MAX_PER_NOTE).map(function (p) { return [clip(p[0], MAX_TERM), clip(p[1], MAX_DEF)]; });
      s.notes[id] = { u: typeof e.u === 'number' || typeof e.u === 'string' ? e.u : 0, n: clip(typeof e.n === 'string' ? e.n : '', MAX_TITLE), t: terms };
    });
  }
  return s;
}

function record(state, id, updated, title, found) {
  delete state.notes[id];
  state.notes[id] = {
    u: updated,
    n: clip(title || 'Untitled', MAX_TITLE),
    t: found.map(function (d) { return [d.term, d.def]; }),
  };
}

// Drops the notes that were read longest ago (empty ones first) until the
// index fits what settings can hold.
function prune(state) {
  function size() { return JSON.stringify(state).length; }
  var ids = Object.keys(state.notes);
  for (var i = 0; i < ids.length && size() > MAX_INDEX_BYTES; i++) {
    if (state.notes[ids[i]].t.length === 0) delete state.notes[ids[i]];
  }
  ids = Object.keys(state.notes);
  for (var j = 0; j < ids.length && size() > MAX_INDEX_BYTES; j++) delete state.notes[ids[j]];
}

function allTerms(state) {
  var out = [];
  Object.keys(state.notes).forEach(function (id) {
    var e = state.notes[id];
    e.t.forEach(function (p) { out.push({ term: p[0], def: p[1], note: e.n, id: id }); });
  });
  return out;
}

// Terms matching `q` (case-insensitive), best first: term starts with it,
// term contains it, definition contains it; then alphabetical.
function search(state, q) {
  var needle = String(q || '').trim().toLowerCase();
  var rows = [];
  allTerms(state).forEach(function (e) {
    var t = e.term.toLowerCase();
    var rank = needle === '' ? 3 : t.indexOf(needle) === 0 ? 0 : t.indexOf(needle) >= 0 ? 1 : e.def.toLowerCase().indexOf(needle) >= 0 ? 2 : -1;
    if (rank >= 0) rows.push({ term: e.term, def: e.def, note: e.note, rank: rank });
  });
  rows.sort(function (a, b) {
    return a.rank - b.rank || (a.term.toLowerCase() < b.term.toLowerCase() ? -1 : a.term.toLowerCase() > b.term.toLowerCase() ? 1 : 0);
  });
  return rows;
}

function definitionOf(state, term) {
  var key = String(term).toLowerCase();
  var rows = allTerms(state);
  for (var i = 0; i < rows.length; i++) if (rows[i].term.toLowerCase() === key) return rows[i];
  return null;
}

// What replaces the selection: the definition, or the selected words with
// the definition after them in brackets.
function insertion(selectedText, def) {
  var t = String(selectedText);
  return t.trim() === '' ? def : t + ' (' + def + ')';
}

function buildPanel(state, q, status, pending) {
  var rows = search(state, q);
  var shown = rows.slice(0, MAX_RESULTS).map(function (r) {
    return { type: 'text', value: r.term + ' — ' + r.def + ' [' + r.note + ']' };
  });
  var options = [];
  rows.forEach(function (r) { if (options.length < MAX_OPTIONS && options.indexOf(r.term) < 0) options.push(r.term); });
  var total = allTerms(state).length;
  var children = [
    { type: 'heading', value: 'Glossary' },
    { type: 'text', value: total + (total === 1 ? ' term' : ' terms') + ' from ' + Object.keys(state.notes).filter(function (id) { return state.notes[id].t.length > 0; }).length + ' notes.' + (pending > 0 ? ' ' + pending + ' more to read: press Refresh.' : ''), style: 'muted' },
  ];
  if (status) children.push({ type: 'text', value: status });
  children.push(
    { type: 'input', id: 'q', label: 'Search', value: q, placeholder: 'Term or part of a definition' },
    {
      type: 'row', gap: 8,
      children: [
        { type: 'button', id: 'search', label: 'Search', tone: 'primary' },
        { type: 'button', id: 'refresh', label: 'Refresh' },
      ],
    },
    shown.length ? { type: 'list', items: shown } : { type: 'text', value: total === 0 ? 'No definitions found yet. Write Term:: definition, or a Glossary heading.' : 'No matches.', style: 'muted' }
  );
  if (rows.length > MAX_RESULTS) children.push({ type: 'text', value: 'Showing ' + MAX_RESULTS + ' of ' + rows.length + '. Narrow the search.', style: 'caption' });
  if (options.length > 0) {
    children.push(
      { type: 'divider' },
      { type: 'select', id: 'term', label: 'Insert definition of', value: options[0], options: options },
      { type: 'button', id: 'insert', label: 'Insert at selection' }
    );
  }
  return { type: 'column', gap: 12, children: children };
}

// Reads the open note and then the notes whose last change differs from the
// index, newest first. Returns how many are still waiting.
function scan(state) {
  var seen = {};
  var waiting = [];
  var cursor;
  var complete = true;
  for (var page = 0; page < MAX_PAGES; page++) {
    var res = kanso.notes.list({ limit: 100, cursor: cursor });
    res.notes.forEach(function (n) {
      seen[n.id] = true;
      var known = state.notes[n.id];
      if (!known || known.u !== n.updatedAt) waiting.push(n);
    });
    cursor = res.cursor;
    if (!cursor) break;
    if (page === MAX_PAGES - 1) complete = false;
  }
  if (complete) {
    Object.keys(state.notes).forEach(function (id) { if (!seen[id]) delete state.notes[id]; });
  }
  var open = kanso.editor.noteId();
  var reads = 0;
  function take(id) {
    var note = kanso.notes.get(id);
    reads += 1;
    record(state, id, note.updatedAt, note.title, extract(note.body));
  }
  if (open !== null) {
    take(open);
    waiting = waiting.filter(function (n) { return n.id !== open; });
  }
  for (var i = 0; i < waiting.length && reads < MAX_READS; i++) {
    take(waiting[i].id);
  }
  return Math.max(0, waiting.length - (reads - (open !== null ? 1 : 0)));
}

function show(values, mode) {
  var state = normalize(kanso.settings.get());
  var q = values && typeof values.q === 'string' ? values.q.slice(0, 200) : state.q;
  var status = '';
  var pending = 0;
  if (mode === 'scan') {
    try {
      pending = scan(state);
    } catch (e) {
      if (e && e.code === 'limit') status = 'Too many reads this minute. Wait a little and press Refresh.';
      else throw e;
    }
  }
  state.q = q;
  prune(state);
  kanso.settings.set(state);
  kanso.ui.panel(buildPanel(state, q, status, pending));
}

function insert(values) {
  var state = normalize(kanso.settings.get());
  var q = values && typeof values.q === 'string' ? values.q : state.q;
  var hit = values ? definitionOf(state, values.term) : null;
  var status;
  if (!hit) {
    status = 'Pick a term first.';
  } else {
    var sel = kanso.editor.selection();
    if (sel === null) {
      status = 'Put the cursor in the note, or select some text, then press Insert.';
    } else {
      try {
        kanso.editor.replaceSelection({ text: insertion(sel.text, hit.def), selection: { start: sel.start, end: sel.end } });
        status = 'Inserted the definition of ' + hit.term + '.';
      } catch (e) {
        if (e && e.code === 'conflict') status = 'The selection moved. Select again and press Insert.';
        else throw e;
      }
    }
  }
  kanso.ui.panel(buildPanel(state, q, status, 0));
}

if (typeof module !== 'undefined') {
  module.exports = { extract: extract, normalize: normalize, record: record, prune: prune, search: search, insertion: insertion, buildPanel: buildPanel, freshState: freshState, allTerms: allTerms, definitionOf: definitionOf };
}

if (typeof kanso !== 'undefined') {
  kanso.commands.register({
    id: 'show-glossary',
    title: 'Show glossary',
    keywords: ['terms', 'definitions', 'dictionary', 'vocabulary'],
    run: function () { show(null, 'scan'); return null; },
  });
  kanso.ui.onPress('refresh', function (v) { show(v, 'scan'); return null; });
  kanso.ui.onPress('search', function (v) { show(v, 'search'); return null; });
  kanso.ui.onPress('insert', function (v) { insert(v); return null; });
}
