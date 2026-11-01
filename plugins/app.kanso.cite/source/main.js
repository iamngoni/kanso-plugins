// Cite: select a DOI, run "Cite the DOI in the selection" and the selection
// becomes a formatted citation from Crossref (api.crossref.org). "Build a
// bibliography" does the same for every DOI in the open note, in a section
// that it rewrites in place each time. The style (APA, MLA or BibTeX) is
// chosen in the "Cite settings" panel.

const API = 'https://api.crossref.org/works/';
const STYLES = ['apa', 'mla', 'bibtex'];
const STYLE_LABEL = { apa: 'APA', mla: 'MLA', bibtex: 'BibTeX' };
const MAX_FETCH = 8; // per run: about 0.5 s each, 5 s in all
const MAX_CACHE = 60;
const BIB_MARK = '<!-- kanso-bibliography -->';

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

function flat(text, max) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return max ? Array.from(s).slice(0, max).join('') : s;
}

// Crossref titles carry a little markup (<i>, <jats:p>) and entities.
function plain(text) {
  return flat(
    String(text == null ? '' : text)
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&amp;/g, '&'),
    500,
  );
}

// DOIs in some text, in order, once each (DOIs ignore case).
function extractDois(text) {
  const out = [];
  const seen = new Set();
  const re = /10\.\d{4,9}\/[^\s"<>\]　]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let doi = m[0].replace(/[.,;:'"!?]+$/, '');
    while (doi.endsWith(')') && (doi.match(/\(/g) || []).length < (doi.match(/\)/g) || []).length) doi = doi.slice(0, -1);
    doi = doi.replace(/[.,;:'"!?]+$/, '');
    const key = doi.toLowerCase();
    if (doi.length > 8 && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function firstYear(msg) {
  for (const field of ['issued', 'published-print', 'published-online', 'published', 'created']) {
    const parts = msg[field] && msg[field]['date-parts'];
    const y = parts && parts[0] && parts[0][0];
    if (Number.isInteger(y) && y > 0) return y;
  }
  return null;
}

// Crossref's message cut down to what the formats use.
function compact(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const title = plain(first(msg.title));
  if (!title) return null;
  return {
    doi: String(msg.DOI || '').toLowerCase(),
    type: flat(msg.type, 40),
    title,
    container: plain(first(msg['container-title'])),
    authors: (Array.isArray(msg.author) ? msg.author : [])
      .map((a) => ({ given: plain(a.given), family: plain(a.family), name: plain(a.name) }))
      .filter((a) => a.family || a.name),
    year: firstYear(msg),
    volume: flat(msg.volume, 20),
    issue: flat(msg.issue, 20),
    pages: flat(msg.page, 30),
    publisher: plain(msg.publisher),
  };
}

function initials(given) {
  return given
    .split(/[\s]+/)
    .filter(Boolean)
    .map((part) => part.split('-').map((p) => `${Array.from(p)[0]}.`).join('-'))
    .join(' ');
}

function doiUrl(doi) {
  return `https://doi.org/${encodeURI(doi).replace(/[()#?]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

function endWith(text, mark) {
  return /[.?!]$/.test(text) ? text : text + mark;
}

function pagesDash(p) {
  return p.replace(/-+/g, '–');
}

function apaAuthors(list) {
  const one = (a) => (a.family ? `${a.family}${a.given ? `, ${initials(a.given)}` : ''}` : a.name);
  const names = list.map(one);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, & ${names[1]}`;
  if (names.length <= 20) return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(', ')}, ... ${names[names.length - 1]}`;
}

function mlaAuthors(list) {
  const first = list[0];
  const lead = first.family ? `${first.family}${first.given ? `, ${first.given}` : ''}` : first.name;
  const next = (a) => (a.family ? `${a.given ? `${a.given} ` : ''}${a.family}` : a.name);
  if (list.length === 1) return lead;
  if (list.length === 2) return `${lead}, and ${next(list[1])}`;
  return `${lead}, et al`;
}

function apa(m) {
  const authors = apaAuthors(m.authors);
  const head = authors ? `${escapeText(authors)} ` : '';
  const year = `(${m.year || 'n.d.'}).`;
  const isBook = /book|monograph|edited-book|reference-book/.test(m.type);
  const parts = [];
  if (isBook) {
    parts.push(`*${escapeText(endWith(m.title, '.')).replace(/\.$/, '')}*.`);
    if (m.publisher) parts.push(`${escapeText(endWith(m.publisher, '.'))}`);
  } else {
    parts.push(escapeText(endWith(m.title, '.')));
    if (m.container) {
      let c = `*${escapeText(m.container)}*`;
      if (m.volume) c += `, *${escapeText(m.volume)}*${m.issue ? `(${escapeText(m.issue)})` : ''}`;
      if (m.pages) c += `, ${escapeText(pagesDash(m.pages))}`;
      parts.push(`${c}.`);
    }
  }
  parts.push(`<${doiUrl(m.doi)}>`);
  return `${head}${year} ${parts.join(' ')}`.replace(/\s+/g, ' ');
}

function mla(m) {
  const authors = m.authors.length ? `${escapeText(endWith(mlaAuthors(m.authors), '.'))} ` : '';
  const isBook = /book|monograph/.test(m.type);
  const out = [];
  if (isBook) {
    out.push(`*${escapeText(m.title)}*.`);
    if (m.publisher) out.push(`${escapeText(m.publisher)}${m.year ? `, ${m.year}` : ''}.`);
  } else {
    out.push(`"${escapeText(endWith(m.title, '.')).replace(/"/g, '\\"')}"`);
    const bits = [];
    if (m.container) bits.push(`*${escapeText(m.container)}*`);
    if (m.volume) bits.push(`vol. ${escapeText(m.volume)}`);
    if (m.issue) bits.push(`no. ${escapeText(m.issue)}`);
    if (m.year) bits.push(String(m.year));
    if (m.pages) bits.push(`pp. ${escapeText(pagesDash(m.pages))}`);
    if (bits.length) out.push(`${bits.join(', ')},`);
  }
  out.push(`<${doiUrl(m.doi)}>.`);
  return `${authors}${out.join(' ')}`.replace(/\s+/g, ' ').replace(/,\s*<https/, ', <https');
}

const TEX = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_', '^': '\\^{}', '~': '\\~{}' };
function tex(text) {
  return String(text).replace(/[\\{}&%$#_^~]/g, (c) => TEX[c]);
}

function bibKey(m, taken) {
  const lead = m.authors.length ? m.authors[0].family || m.authors[0].name : 'ref';
  const word = (m.title.match(/[A-Za-z]{4,}/) || ['x'])[0];
  const base = (lead.normalize('NFD').replace(/[^A-Za-z]/g, '') || 'ref').toLowerCase() + (m.year || '') + word.toLowerCase();
  let key = base;
  for (let i = 0; taken.has(key); i++) key = base + String.fromCharCode(97 + (i % 26)) + (i >= 26 ? i : '');
  taken.add(key);
  return key;
}

function bibtex(m, taken) {
  const kind = /journal-article|article/.test(m.type) ? 'article' : /book|monograph/.test(m.type) ? 'book' : /proceedings/.test(m.type) ? 'inproceedings' : 'misc';
  const set = taken || new Set();
  const field = (name, value) => (value ? `  ${name} = {${tex(value)}},` : null);
  const authors = m.authors.map((a) => (a.family ? `${a.family}${a.given ? `, ${a.given}` : ''}` : `{${a.name}}`));
  const lines = [
    `@${kind}{${bibKey(m, set)},`,
    authors.length ? `  author = {${authors.map((a) => (a.startsWith('{') ? `{${tex(a.slice(1, -1))}}` : tex(a))).join(' and ')}},` : null,
    `  title = {{${tex(m.title)}}},`,
    field(kind === 'article' ? 'journal' : kind === 'inproceedings' ? 'booktitle' : 'howpublished', m.container),
    field('year', m.year ? String(m.year) : ''),
    field('volume', m.volume),
    field('number', m.issue),
    field('pages', m.pages ? m.pages.replace(/-+/g, '--') : ''),
    field('publisher', m.publisher),
    `  doi = {${m.doi.replace(/[{}\\]/g, '')}}`,
    '}',
  ];
  return lines.filter(Boolean).join('\n');
}

function format(style, m, taken) {
  if (style === 'mla') return mla(m);
  if (style === 'bibtex') return bibtex(m, taken);
  return apa(m);
}

// The text of a bibliography for these entries.
function renderBibliography(style, entries) {
  const sorted = [...entries].sort((a, b) => {
    const ka = `${a.authors[0] ? a.authors[0].family || a.authors[0].name : a.title} ${a.year || ''}`.toLowerCase();
    const kb = `${b.authors[0] ? b.authors[0].family || b.authors[0].name : b.title} ${b.year || ''}`.toLowerCase();
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  if (style === 'bibtex') {
    const taken = new Set();
    return '```bibtex\n' + sorted.map((m) => bibtex(m, taken)).join('\n\n') + '\n```';
  }
  return sorted.map((m) => format(style, m)).join('\n\n');
}

// The section from the marker to the next heading of level 1 or 2.
function bibliographyRange(body) {
  const at = body.indexOf(BIB_MARK);
  if (at < 0) return null;
  const lineStart = body.lastIndexOf('\n', at) + 1;
  let from = lineStart;
  // include a heading line right before the marker
  const before = body.slice(0, lineStart).replace(/\n$/, '');
  const prevStart = before.lastIndexOf('\n') + 1;
  if (/^#{1,2}\s/.test(before.slice(prevStart))) from = prevStart;
  const rest = body.slice(at + BIB_MARK.length);
  const next = /\n#{1,2}\s/.exec(rest);
  const to = next ? at + BIB_MARK.length + next.index + 1 : body.length;
  return { from, to };
}

function withBibliography(body, style, entries) {
  const section = `## Bibliography\n${BIB_MARK}\n\n${renderBibliography(style, entries)}\n`;
  const range = bibliographyRange(body);
  if (!range) return body.replace(/\s*$/, '') + `\n\n${section}`;
  const tail = body.slice(range.to);
  return body.slice(0, range.from) + section + (tail ? `\n${tail}` : '');
}

function withoutBibliography(body) {
  const range = bibliographyRange(body);
  return range ? body.slice(0, range.from) + body.slice(range.to) : body;
}

function header(res, name) {
  const h = (res && res.headers) || {};
  for (const k of Object.keys(h)) if (k.toLowerCase() === name) return h[k];
  return null;
}

// ---- Kanso side ----------------------------------------------------------

function style() {
  const s = kanso.settings.get();
  return s && STYLES.includes(s.style) ? s.style : 'apa';
}

// { meta } or { missing } or { error }
function fetchMeta(doi) {
  const res = kanso.fetch(API + encodeURI(doi).replace(/[?#]/g, (c) => (c === '?' ? '%3F' : '%23')), { headers: { Accept: 'application/json' } });
  if (res.status === 404) return { missing: true };
  if (res.status === 429) {
    const wait = header(res, 'retry-after');
    return { error: `Crossref asked us to slow down${wait ? ` (try again in ${wait}s)` : ''}.` };
  }
  if (res.status !== 200) return { error: `Crossref answered ${res.status}.` };
  let data;
  try {
    data = JSON.parse(res.body);
  } catch (e) {
    return { error: 'Crossref sent something unexpected.' };
  }
  const meta = compact(data && data.message);
  if (!meta) return { missing: true };
  meta.doi = doi;
  return { meta };
}

function readCache() {
  const s = kanso.settings.get();
  return s && s.cache && typeof s.cache === 'object' ? s.cache : {};
}

function saveCache(cache) {
  const keys = Object.keys(cache);
  while (keys.length > MAX_CACHE) delete cache[keys.shift()];
  const s = kanso.settings.get() || {};
  s.cache = cache;
  kanso.settings.set(s);
}

function citeSelection() {
  const sel = kanso.editor.selection();
  if (!sel) return { text: 'Select a DOI first.' };
  const dois = extractDois(sel.text);
  if (dois.length === 0) return { text: 'No DOI (like 10.1000/xyz123) in the selection.' };
  const cache = readCache();
  const chosen = style();
  const taken = new Set();
  let text = sel.text;
  const made = [];
  let fetches = 0;
  for (const doi of dois) {
    let meta = cache[doi];
    if (!meta) {
      if (fetches >= MAX_FETCH) return { text: 'Too many DOIs for one go: select fewer, or run it again on the rest.' };
      fetches += 1;
      const got = fetchMeta(doi);
      if (got.error) return { text: got.error };
      if (got.missing) return { text: `Crossref has no record of ${doi}.` };
      meta = got.meta;
      cache[doi] = meta;
    }
    made.push(meta);
  }
  saveCache(cache);
  if (chosen === 'bibtex') {
    const block = '```bibtex\n' + made.map((m) => bibtex(m, taken)).join('\n\n') + '\n```';
    kanso.editor.replaceSelection({ text: `${sel.text}\n\n${block}\n`, selection: { start: sel.start, end: sel.end } });
  } else {
    // Put the citation where the bare DOI (or its doi.org link) was.
    made.forEach((m) => {
      const citation = format(chosen, m);
      const re = new RegExp(`(?:https?://(?:dx\\.)?doi\\.org/|doi:\\s*)?${m.doi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      text = text.replace(re, () => citation);
    });
    kanso.editor.replaceSelection({ text, selection: { start: sel.start, end: sel.end } });
  }
  return { text: `Cited ${made.length} DOI${made.length === 1 ? '' : 's'} in ${STYLE_LABEL[chosen]}.` };
}

function bibliography() {
  const id = kanso.editor.noteId();
  if (id === null) return { text: 'Open a note first.' };
  const note = kanso.notes.get(id);
  const dois = extractDois(withoutBibliography(note.body));
  if (dois.length === 0) return { text: 'No DOIs in this note.' };
  const cache = readCache();
  const entries = [];
  const missing = [];
  let waiting = 0;
  let fetches = 0;
  let problem = null;
  for (const doi of dois) {
    if (cache[doi]) {
      entries.push(cache[doi]);
      continue;
    }
    if (fetches >= MAX_FETCH || problem) {
      waiting += 1;
      continue;
    }
    fetches += 1;
    const got = fetchMeta(doi);
    if (got.error) {
      problem = got.error;
      waiting += 1;
    } else if (got.missing) {
      missing.push(doi);
    } else {
      cache[doi] = got.meta;
      entries.push(got.meta);
    }
  }
  saveCache(cache);
  if (waiting > 0) {
    return { text: `${problem ? `${problem} ` : ''}Looked up ${entries.length} of ${dois.length} DOIs so far; run it again to continue. The note is unchanged.` };
  }
  if (entries.length === 0) return { text: `Crossref has no record of ${missing.join(', ')}.` };
  const chosen = style();
  const body = withBibliography(note.body, chosen, entries);
  if (body !== note.body) kanso.notes.update(note.id, { body }, { baseRev: note.rev });
  return { text: `Bibliography of ${entries.length} in ${STYLE_LABEL[chosen]}.${missing.length ? ` Not found at Crossref: ${missing.join(', ')}.` : ''}` };
}

function settingsPanel(message) {
  const kids = [
    { type: 'heading', value: 'Citation style' },
    { type: 'select', id: 'style', label: 'Style', value: STYLE_LABEL[style()], options: STYLES.map((s) => STYLE_LABEL[s]) },
    { type: 'button', id: 'save-style', label: 'Save', tone: 'primary' },
  ];
  if (message) kids.push({ type: 'text', value: message, style: 'muted' });
  kanso.ui.panel({ type: 'column', gap: 10, children: kids });
}

kanso.commands.register({
  id: 'cite',
  title: 'Cite the DOI in the selection',
  keywords: ['doi', 'citation', 'crossref', 'reference'],
  when: 'selection',
  run: () => citeSelection(),
});
kanso.commands.register({
  id: 'bibliography',
  title: 'Build a bibliography from the DOIs in this note',
  keywords: ['doi', 'citations', 'references', 'crossref'],
  when: 'note-open',
  run: () => bibliography(),
});
kanso.commands.register({
  id: 'settings',
  title: 'Cite settings (APA, MLA or BibTeX)',
  keywords: ['citation', 'style'],
  run: () => {
    settingsPanel();
    return null;
  },
});
kanso.ui.onPress('save-style', (values) => {
  const picked = STYLES.find((s) => STYLE_LABEL[s] === (values && values.style));
  if (!picked) {
    settingsPanel('Pick a style first.');
    return null;
  }
  const s = kanso.settings.get() || {};
  s.style = picked;
  kanso.settings.set(s);
  settingsPanel(`Saved: ${STYLE_LABEL[picked]}.`);
  return { text: `Citation style: ${STYLE_LABEL[picked]}.` };
});

if (typeof globalThis.__kansoTest === 'object') {
  globalThis.__kansoTest.exports = { escapeText, unescapeText, extractDois, compact, apa, mla, bibtex, renderBibliography, withBibliography, withoutBibliography, tex, doiUrl };
}
