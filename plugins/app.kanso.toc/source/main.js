// Table of contents: lists the open note's headings as markdown links to
// their anchors, between <!-- toc --> and <!-- /toc --> marker comments.
// The only way a plugin can change text is by replacing the selection, so
// the block is written at the selection, and refreshing needs the existing
// block to be inside the selection (select the block, or the whole note).
// The selection's byte offsets are handed back untouched, so they stay right
// for non-ASCII text.

const OPEN = '<!-- toc -->';
const CLOSE = '<!-- /toc -->';
const BLOCK = /<!-- toc -->[\s\S]*?<!-- \/toc -->/;

// ---- headings ----------------------------------------------------------

// Heading text as plain text: links, images, emphasis, code and tags removed.
function plain(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/<[^>\n]*>/g, '')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__|~~|\*|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}]))/gu, '')
    .replace(/\\([\\`*_{}\[\]()#+\-.!|])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Headings of a markdown body, skipping front matter, code fences and an
// existing table of contents. Returns [{ level, text }].
function headings(body) {
  const lines = String(body).split(/\r\n|\n|\r/);
  const found = [];
  let i = 0;
  if (lines[0] !== undefined && /^---\s*$/.test(lines[0])) {
    let j = 1;
    while (j < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[j])) j += 1;
    if (j < lines.length) i = j + 1;
  }
  let fence = null;
  let inToc = false;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (inToc) {
      if (line.includes(CLOSE)) inToc = false;
      continue;
    }
    if (fence === null && line.includes(OPEN) && !line.includes(CLOSE)) {
      inToc = true;
      continue;
    }
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (atx) {
      const text = plain(atx[2] === undefined || /^#+$/.test(atx[2]) ? '' : atx[2]);
      if (text !== '') found.push({ level: atx[1].length, text });
      continue;
    }
    const next = lines[i + 1];
    if (next !== undefined && line.trim() !== '' && !/^\s{4}/.test(line) && !/^\s*([-*+>|]|\d+[.)])\s/.test(line)) {
      if (/^ {0,3}=+[ \t]*$/.test(next)) {
        const text = plain(line);
        if (text !== '') found.push({ level: 1, text });
        i += 1;
      } else if (/^ {0,3}-+[ \t]*$/.test(next)) {
        const text = plain(line);
        if (text !== '') found.push({ level: 2, text });
        i += 1;
      }
    }
  }
  return found;
}

// An anchor: lower case letters, numbers, marks, `_` and `-`; spaces become
// `-`. Safe inside a markdown link target.
function baseSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

// Unique anchors for a list of headings: repeats get -1, -2, ...
function anchors(list) {
  const used = new Set();
  return list.map((h) => {
    const base = baseSlug(h.text) || 'section';
    let candidate = base;
    let n = 0;
    while (used.has(candidate)) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    used.add(candidate);
    return candidate;
  });
}

function label(text) {
  return text.replace(/([\[\]\\])/g, '\\$1');
}

// The marked block for a body's headings: { text, count }.
function buildToc(body) {
  const list = headings(body);
  const slugs = anchors(list);
  const min = list.reduce((m, h) => Math.min(m, h.level), 6);
  const items = list.map((h, i) => `${'  '.repeat(h.level - min)}- [${label(h.text)}](#${slugs[i]})`);
  const inner = items.length > 0 ? items.join('\n') : '_No headings yet._';
  return { text: `${OPEN}\n${inner}\n${CLOSE}`, count: list.length };
}

// Selected text with its table of contents block (if any) rebuilt from
// `body`; null when the selection holds no block.
function refreshIn(selected, body) {
  const m = BLOCK.exec(selected);
  if (!m) return null;
  const toc = buildToc(body);
  return { text: selected.slice(0, m.index) + toc.text + selected.slice(m.index + m[0].length), count: toc.count };
}

// ---- commands ----------------------------------------------------------

function work(mode) {
  return () => {
    const id = kanso.editor.noteId();
    if (id === null) return { text: 'No note is open.' };
    const sel = kanso.editor.selection();
    if (!sel) return { text: mode === 'refresh' ? 'Select the table of contents, or the whole note, first.' : 'Put the cursor where the table of contents should go first.' };
    let body;
    try {
      body = kanso.notes.get(id).body;
    } catch (e) {
      return { text: `Could not read the note: ${e && e.message ? e.message : e}` };
    }
    let text;
    let count;
    let verb;
    const refreshed = refreshIn(sel.text, body);
    if (refreshed) {
      ({ text, count } = refreshed);
      verb = 'Refreshed';
    } else if (BLOCK.test(body) || mode === 'refresh') {
      return { text: BLOCK.test(body) ? 'This note already has a table of contents. Select it, or the whole note, and run this again to refresh it.' : 'No table of contents found in the selection.' };
    } else {
      const toc = buildToc(body);
      count = toc.count;
      text = sel.text === '' ? toc.text : `${toc.text}\n\n${sel.text}`;
      verb = 'Inserted';
    }
    if (text === sel.text) return { text: 'The table of contents is up to date.' };
    try {
      kanso.editor.replaceSelection({ text, selection: { start: sel.start, end: sel.end } });
    } catch (e) {
      if (e && e.code === 'conflict') return { text: 'The selection moved. Select again and rerun the command.' };
      return { text: `Could not change the note: ${e && e.message ? e.message : e}` };
    }
    return { text: `${verb} the table of contents (${count} ${count === 1 ? 'heading' : 'headings'}).` };
  };
}

kanso.commands.register({
  id: 'insert-toc',
  title: 'Insert or refresh table of contents',
  keywords: ['toc', 'contents', 'headings', 'outline'],
  when: 'note-open',
  run: work('insert'),
});
kanso.commands.register({
  id: 'refresh-toc',
  title: 'Refresh table of contents in the selection',
  keywords: ['toc', 'contents', 'update'],
  when: 'selection',
  run: work('refresh'),
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { headings, baseSlug, anchors, buildToc, refreshIn, plain };
}
