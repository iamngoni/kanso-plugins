// Look up: select a word or phrase, run "Look up the selection", read the
// definitions (api.dictionaryapi.dev) and the Wikipedia summary
// (en.wikipedia.org) in a panel, and press a button to insert them after the
// selection. No token is needed.

const DICT = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const WIKI = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const MAX_TERM = 100;
const MAX_MEANINGS = 3;
const MAX_DEFS = 2;
const MAX_SUMMARY = 700;

// ---- Pure helpers -------------------------------------------------------

const SPECIALS = /([\\`*_\[\]<>#~|&])/g;

function escapeLine(line) {
  return line
    .replace(SPECIALS, '\\$1')
    .replace(/^(\s*)([-+=])/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/, '$1\\$2');
}

function escapeText(text) {
  return String(text == null ? '' : text).split(/\r\n|\r|\n/).map(escapeLine).join('\n');
}

function unescapeText(text) {
  return text.replace(/\\([\\`*_\[\]<>#~|&\-+=.)])/g, '$1');
}

function oneLine(text, max) {
  const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? chars.slice(0, max - 1).join('').trimEnd() + '…' : flat;
}

// The term to look up: one line, no surrounding punctuation, or null.
function cleanTerm(text) {
  const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const stripped = flat.replace(/^[\s"'“‘(\[{.,;:!?-]+|[\s"'”’)\]}.,;:!?-]+$/g, '');
  if (!stripped || Array.from(stripped).length > MAX_TERM) return null;
  return stripped;
}

// Reads the dictionary answer into [{ partOfSpeech, definitions: [] }].
function readDictionary(data) {
  const out = [];
  if (!Array.isArray(data)) return out;
  for (const entry of data) {
    for (const meaning of Array.isArray(entry && entry.meanings) ? entry.meanings : []) {
      const defs = (Array.isArray(meaning.definitions) ? meaning.definitions : [])
        .map((d) => oneLine(d && d.definition, 300))
        .filter(Boolean)
        .slice(0, MAX_DEFS);
      if (defs.length) out.push({ partOfSpeech: oneLine(meaning.partOfSpeech, 30), definitions: defs });
      if (out.length >= MAX_MEANINGS) return out;
    }
  }
  return out;
}

function readWiki(data) {
  if (!data || typeof data !== 'object' || typeof data.extract !== 'string' || !data.extract.trim()) return null;
  const page = data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page;
  const url = typeof page === 'string' && /^https:\/\/en\.wikipedia\.org\/wiki\/[^\s<>()]+$/.test(page) ? page : null;
  return {
    title: oneLine(data.title, 120),
    summary: oneLine(data.extract, MAX_SUMMARY),
    disambiguation: data.type === 'disambiguation',
    url,
  };
}

// The Markdown inserted after the selection.
function renderInsert(term, meanings, wiki) {
  const lines = [`> **${escapeText(oneLine(term, MAX_TERM))}**`];
  for (const m of meanings) {
    for (const d of m.definitions) {
      lines.push('>', `> ${m.partOfSpeech ? `*${escapeText(oneLine(m.partOfSpeech, 30))}* - ` : ''}${escapeText(oneLine(d, 300))}`);
    }
  }
  if (wiki && !wiki.disambiguation) {
    lines.push('>', `> ${escapeText(oneLine(wiki.summary, MAX_SUMMARY))}${wiki.url ? ` ([Wikipedia](${wiki.url}))` : ' (Wikipedia)'}`);
  }
  return lines.join('\n');
}

// ---- Kanso side ----------------------------------------------------------

let last = null; // { term, meanings, wiki }

function get(url) {
  const res = kanso.fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 200) {
    try {
      return { data: JSON.parse(res.body) };
    } catch (e) {
      return { error: 'unreadable' };
    }
  }
  if (res.status === 404) return { missing: true };
  if (res.status === 429) return { error: 'rate-limited' };
  return { error: `status ${res.status}` };
}

function lookup(term) {
  const dict = get(DICT + encodeURIComponent(term));
  const wiki = get(WIKI + encodeURIComponent(term.replace(/ /g, '_')));
  const problems = [];
  if (dict.error) problems.push(`the dictionary (${dict.error})`);
  if (wiki.error) problems.push(`Wikipedia (${wiki.error})`);
  return {
    term,
    meanings: dict.data ? readDictionary(dict.data) : [],
    wiki: wiki.data ? readWiki(wiki.data) : null,
    problems,
  };
}

function show(result) {
  const kids = [{ type: 'heading', value: result.term }];
  if (result.meanings.length === 0) kids.push({ type: 'text', value: 'No dictionary definition found.', style: 'muted' });
  for (const m of result.meanings) {
    if (m.partOfSpeech) kids.push({ type: 'badge', value: m.partOfSpeech });
    kids.push({ type: 'list', items: m.definitions.map((d) => ({ type: 'text', value: d })) });
  }
  kids.push({ type: 'divider' });
  if (result.wiki) {
    kids.push({ type: 'text', value: result.wiki.disambiguation ? `${result.wiki.title} may mean several things on Wikipedia.` : result.wiki.summary });
    if (result.wiki.url) kids.push({ type: 'link', label: 'Read more on Wikipedia', url: result.wiki.url });
  } else {
    kids.push({ type: 'text', value: 'No Wikipedia article found.', style: 'muted' });
  }
  if (result.problems.length) kids.push({ type: 'text', value: `Could not reach ${result.problems.join(' or ')}. Try again in a moment.`, style: 'caption' });
  const nothing = result.meanings.length === 0 && !(result.wiki && !result.wiki.disambiguation);
  if (!nothing) kids.push({ type: 'button', id: 'insert', label: 'Insert at the selection', tone: 'primary' });
  kanso.ui.panel({ type: 'column', gap: 10, children: kids });
}

kanso.commands.register({
  id: 'lookup',
  title: 'Look up the selection',
  keywords: ['define', 'dictionary', 'wikipedia', 'meaning'],
  when: 'selection',
  run: () => {
    const sel = kanso.editor.selection();
    const term = sel ? cleanTerm(sel.text) : null;
    if (!term) return { text: `Select a word or phrase (up to ${MAX_TERM} characters) first.` };
    last = lookup(term);
    show(last);
    return null;
  },
});

kanso.ui.onPress('insert', () => {
  if (!last) return { text: 'Look something up first.' };
  const sel = kanso.editor.selection();
  if (!sel) return { text: 'Select the place to insert at first.' };
  const block = renderInsert(last.term, last.meanings, last.wiki);
  kanso.editor.replaceSelection({
    text: `${sel.text}\n\n${block}\n`,
    selection: { start: sel.start, end: sel.end },
  });
  return { text: 'Inserted after the selection.' };
});

if (typeof globalThis.__kansoTest === 'object') {
  globalThis.__kansoTest.exports = { escapeText, unescapeText, cleanTerm, readDictionary, readWiki, renderInsert };
}
