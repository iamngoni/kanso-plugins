// Text tools: palette commands that rewrite the selected text. Every
// transform is a pure function of a string; `run` only reads the selection,
// applies one, and writes the result back with the selection it read, so a
// selection that moved in the meantime is reported instead of overwritten.

// ---- lines -------------------------------------------------------------

// Splits text into lines, remembering the line ending and whether the text
// ended with one, so a transform can put both back unchanged.
function splitLines(text) {
  const eol = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\n|\r/);
  let trailing = false;
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
    trailing = true;
  }
  return { lines, eol, trailing };
}

function joinLines(parts, lines) {
  return lines.join(parts.eol) + (parts.trailing ? parts.eol : '');
}

function mapLines(text, fn) {
  const parts = splitLines(text);
  return joinLines(parts, fn(parts.lines));
}

// ---- sorting -----------------------------------------------------------

function compareText(a, b) {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la < lb) return -1;
  if (la > lb) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Digit runs compare as numbers (without parsing them, so any length works).
function compareDigits(a, b) {
  const x = a.replace(/^0+(?=\d)/, '');
  const y = b.replace(/^0+(?=\d)/, '');
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

function compareNatural(a, b) {
  const pa = a.match(/\d+|\D+/g) || [];
  const pb = b.match(/\d+|\D+/g) || [];
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const da = /^\d/.test(pa[i]);
    const db = /^\d/.test(pb[i]);
    let c;
    if (da && db) c = compareDigits(pa[i], pb[i]);
    else if (da !== db) c = da ? -1 : 1;
    else c = compareText(pa[i], pb[i]);
    if (c !== 0) return c;
  }
  if (pa.length !== pb.length) return pa.length < pb.length ? -1 : 1;
  return compareText(a, b);
}

function sortWith(text, cmp) {
  return mapLines(text, (lines) => lines.slice().sort(cmp));
}
function sortAsc(text) { return sortWith(text, compareText); }
function sortDesc(text) { return sortWith(text, (a, b) => compareText(b, a)); }
function sortNatural(text) { return sortWith(text, compareNatural); }

function dedupeLines(text) {
  return mapLines(text, (lines) => {
    const seen = new Set();
    return lines.filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
  });
}

function reverseLines(text) {
  return mapLines(text, (lines) => lines.slice().reverse());
}

function trimTrailing(text) {
  return mapLines(text, (lines) => lines.map((l) => l.replace(/[^\S\r\n]+$/, '')));
}

// ---- case --------------------------------------------------------------

function upper(text) { return text.toUpperCase(); }
function lower(text) { return text.toLowerCase(); }

function capitalFirst(word) {
  const chars = Array.from(word);
  const head = chars[0];
  const up = head.toUpperCase();
  const first = Array.from(up).length === 1 ? up : head;
  return first + chars.slice(1).join('').toLowerCase();
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'up', 'via', 'vs']);
const WORD = /[\p{L}\p{N}\p{M}]+(?:['\u2019][\p{L}\p{M}]+)*/gu;

function titleCase(text) {
  return mapLines(text, (lines) => lines.map((line) => {
    const matches = Array.from(line.matchAll(WORD));
    return line.replace(WORD, (word, offset) => {
      const index = matches.findIndex((m) => m.index === offset);
      const edge = index === 0 || index === matches.length - 1;
      const small = word.toLowerCase();
      if (!edge && SMALL.has(small)) return small;
      return capitalFirst(word);
    });
  }));
}

function sentenceCase(text) {
  const low = text.toLowerCase();
  let out = '';
  let start = true;
  for (const ch of low) {
    if (start && /[\p{L}]/u.test(ch)) {
      const up = ch.toUpperCase();
      out += Array.from(up).length === 1 ? up : ch;
      start = false;
    } else {
      out += ch;
      if (/[.!?\n]/.test(ch)) start = true;
      else if (/[\p{L}\p{N}]/u.test(ch)) start = false;
    }
  }
  return out;
}

// ---- slugify -----------------------------------------------------------

const FOLD = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ł': 'l', 'þ': 'th', 'ð': 'd', 'ı': 'i' };

function slugify(text) {
  const folded = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[ßæœøđłþðı]/g, (c) => FOLD[c]);
  return folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---- tables ------------------------------------------------------------

function charWidth(ch) {
  const c = ch.codePointAt(0);
  if (/\p{M}/u.test(ch) || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) return 0;
  if (
    (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f900 && c <= 0x1f9ff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  ) return 2;
  return 1;
}

function textWidth(s) {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

function pad(s, width, align) {
  const gap = Math.max(0, width - textWidth(s));
  if (align === 'right') return ' '.repeat(gap) + s;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + s + ' '.repeat(gap - left);
  }
  return s + ' '.repeat(gap);
}

// Cells of one table row, split on pipes that are not escaped.
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  const cells = [];
  let cur = '';
  let closed = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      cur += ch + s[i + 1];
      i += 1;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
      closed = i === s.length - 1;
    } else {
      cur += ch;
      closed = false;
    }
  }
  if (!closed) cells.push(cur.trim());
  return cells;
}

function alignOf(cell) {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return 'none';
}

// rows: arrays of cells; the header is rows[0]. aligns: per column.
function renderTable(rows, aligns) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const widths = [];
  for (let c = 0; c < cols; c += 1) {
    let w = 3;
    for (const r of rows) w = Math.max(w, textWidth(r[c] || ''));
    widths.push(w);
  }
  const line = (r) => '| ' + widths.map((w, c) => pad(r[c] || '', w, aligns[c] === 'none' ? 'left' : aligns[c])).join(' | ') + ' |';
  const sep = '| ' + widths.map((w, c) => {
    const a = aligns[c] || 'none';
    const dashes = '-'.repeat(w);
    if (a === 'center') return ':' + dashes.slice(2) + ':';
    if (a === 'right') return dashes.slice(1) + ':';
    if (a === 'left') return ':' + dashes.slice(1);
    return dashes;
  }).join(' | ') + ' |';
  return [line(rows[0]), sep, ...rows.slice(1).map(line)];
}

// Returns { text } or { error }.
function alignTable(text) {
  const parts = splitLines(text);
  const lines = parts.lines.filter((l) => l.trim() !== '');
  if (lines.length < 2 || !lines.every((l) => l.includes('|'))) {
    return { error: 'Select a markdown table (a header row, a --- row, then rows).' };
  }
  const sepCells = splitRow(lines[1]);
  if (!sepCells.every((c) => /^:?-+:?$/.test(c))) {
    return { error: 'The second line must be the --- row.' };
  }
  const header = splitRow(lines[0]);
  const body = lines.slice(2).map(splitRow);
  const cols = Math.max(header.length, sepCells.length, ...body.map((r) => r.length));
  const aligns = [];
  for (let c = 0; c < cols; c += 1) aligns.push(c < sepCells.length ? alignOf(sepCells[c]) : 'none');
  const out = renderTable([header, ...body], aligns);
  return { text: out.join(parts.eol) + (parts.trailing ? parts.eol : '') };
}

function escapeCell(s) {
  return s.replace(/\|/g, '\\|');
}

function listToTable(text) {
  const parts = splitLines(text);
  const items = parts.lines
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').trim())
    .filter((l) => l !== '');
  if (items.length === 0) return { error: 'Select a list first.' };
  let rows;
  if (items.some((l) => l.includes('\t'))) rows = items.map((l) => l.split('\t').map((c) => c.trim()));
  else if (items.some((l) => l.includes(' | '))) rows = items.map((l) => l.split(/\s\|\s/).map((c) => c.trim()));
  else {
    const counts = items.map((l) => l.split(',').length - 1);
    if (counts[0] >= 1 && counts.every((n) => n === counts[0])) rows = items.map((l) => l.split(',').map((c) => c.trim()));
    else rows = [['Item'], ...items.map((l) => [l])];
  }
  rows = rows.map((r) => r.map(escapeCell));
  const cols = Math.max(...rows.map((r) => r.length));
  const aligns = [];
  for (let c = 0; c < cols; c += 1) aligns.push('none');
  return { text: renderTable(rows, aligns).join(parts.eol) + (parts.trailing ? parts.eol : '') };
}

// ---- lorem ipsum -------------------------------------------------------

const LOREM_WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum').split(' ');
const LOREM_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
const MAX_PARAGRAPHS = 20;

function lorem(count) {
  const n = Math.max(1, Math.min(MAX_PARAGRAPHS, Math.floor(count) || 1));
  let seed = 7;
  const next = (m) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return Math.floor(seed / 65536) % m;
  };
  const paragraphs = [];
  for (let p = 0; p < n; p += 1) {
    const sentences = [];
    if (p === 0) sentences.push(LOREM_OPENING);
    const total = 4 + next(3);
    while (sentences.length < total) {
      const len = 7 + next(9);
      const ws = [];
      for (let i = 0; i < len; i += 1) ws.push(LOREM_WORDS[next(LOREM_WORDS.length)]);
      if (len > 10) ws[4 + next(3)] += ',';
      const s = ws.join(' ');
      sentences.push(s.charAt(0).toUpperCase() + s.slice(1) + '.');
    }
    paragraphs.push(sentences.join(' '));
  }
  return paragraphs.join('\n\n');
}

// ---- commands ----------------------------------------------------------

// A transform returns a string, or { text } / { error }.
function normalize(result) {
  if (typeof result === 'string') return { text: result };
  return result;
}

function apply(transform, done) {
  return () => {
    const sel = kanso.editor.selection();
    if (!sel || sel.text === '') return { text: 'Select some text first.' };
    let result;
    try {
      result = normalize(transform(sel.text));
    } catch (e) {
      return { text: `Could not change the text: ${e && e.message ? e.message : e}` };
    }
    if (result.error) return { text: result.error };
    if (result.text === sel.text) return { text: 'Nothing to change.' };
    try {
      kanso.editor.replaceSelection({ text: result.text, selection: { start: sel.start, end: sel.end } });
    } catch (e) {
      if (e && e.code === 'conflict') return { text: 'The selection moved. Select the text again and rerun the command.' };
      return { text: `Could not change the text: ${e && e.message ? e.message : e}` };
    }
    return { text: done };
  };
}

function loremCommand() {
  const sel = kanso.editor.selection();
  if (!sel) return { text: 'Place the cursor or select a number first.' };
  const typed = /^\s*(\d{1,3})\s*$/.exec(sel.text);
  const n = typed ? Number(typed[1]) : 3;
  if (n < 1 || n > MAX_PARAGRAPHS) return { text: `Choose between 1 and ${MAX_PARAGRAPHS} paragraphs.` };
  const text = typed ? lorem(n) : `${sel.text}\n\n${lorem(n)}`;
  try {
    kanso.editor.replaceSelection({ text, selection: { start: sel.start, end: sel.end } });
  } catch (e) {
    if (e && e.code === 'conflict') return { text: 'The selection moved. Select again and rerun the command.' };
    return { text: `Could not insert: ${e && e.message ? e.message : e}` };
  }
  return { text: `Inserted ${n} ${n === 1 ? 'paragraph' : 'paragraphs'}.` };
}

const COMMANDS = [
  ['sort-az', 'Sort lines A to Z', ['sort', 'alphabetical'], sortAsc, 'Sorted A to Z.'],
  ['sort-za', 'Sort lines Z to A', ['sort', 'reverse alphabetical'], sortDesc, 'Sorted Z to A.'],
  ['sort-natural', 'Sort lines naturally (2 before 10)', ['sort', 'numeric', 'natural'], sortNatural, 'Sorted naturally.'],
  ['dedupe', 'Remove duplicate lines', ['unique', 'duplicates'], dedupeLines, 'Removed duplicate lines.'],
  ['reverse', 'Reverse lines', ['flip', 'order'], reverseLines, 'Reversed the lines.'],
  ['title-case', 'Title Case', ['capitalize', 'headline'], titleCase, 'Changed to Title Case.'],
  ['sentence-case', 'Sentence case', ['capitalize'], sentenceCase, 'Changed to sentence case.'],
  ['upper', 'UPPER CASE', ['uppercase', 'capitals'], upper, 'Changed to upper case.'],
  ['lower', 'lower case', ['lowercase'], lower, 'Changed to lower case.'],
  ['slugify', 'Slugify', ['slug', 'url', 'kebab'], slugify, 'Made a slug.'],
  ['trim-trailing', 'Trim trailing whitespace', ['whitespace', 'spaces', 'clean'], trimTrailing, 'Trimmed trailing whitespace.'],
  ['list-to-table', 'List to markdown table', ['table', 'list', 'csv'], listToTable, 'Made a table.'],
  ['align-table', 'Align markdown table', ['table', 'format', 'pretty'], alignTable, 'Aligned the table.'],
];

for (const [id, title, keywords, fn, done] of COMMANDS) {
  kanso.commands.register({ id, title, keywords, when: 'selection', run: apply(fn, done) });
}
kanso.commands.register({
  id: 'lorem',
  title: 'Insert lorem ipsum (select a number for that many paragraphs)',
  keywords: ['lorem', 'ipsum', 'placeholder', 'dummy text'],
  when: 'selection',
  run: loremCommand,
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    splitLines, mapLines, sortAsc, sortDesc, sortNatural, dedupeLines, reverseLines, trimTrailing,
    upper, lower, titleCase, sentenceCase, slugify, alignTable, listToTable, lorem, textWidth, splitRow,
  };
}
