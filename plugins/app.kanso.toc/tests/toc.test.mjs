import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const commands = new Map();
let state = {};
globalThis.kanso = {
  commands: { register: (c) => commands.set(c.id, c) },
  editor: {
    noteId: () => state.noteId,
    selection: () => state.selection,
    replaceSelection: (a) => {
      if (state.fail) throw state.fail;
      state.replaced = a;
    },
  },
  notes: { get: () => ({ body: state.body }) },
};
const T = createRequire(import.meta.url)(path.join(here, '../source/main.js'));

function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const PIECES = ['# ', '## ', '### ', '####### ', '#', ' ', '\n', '\n', '\n', '```', '~~~', '---', '===', 'Title', 'héllo', 'Ünï', '日本語', '😀', '[a](b)', '[[w|x]]', '`c`', '*e*', '_u_', '(', ')', '[', ']', '\\', '<!-- toc -->', '<!-- /toc -->', '- ', '1. ', '\t', '\r\n', 'a', '#x'];
function random(rand, max = 30) {
  let s = '';
  const n = Math.floor(rand() * max);
  for (let i = 0; i < n; i += 1) s += PIECES[Math.floor(rand() * PIECES.length)];
  return s;
}

test('headings', () => {
  const body = '---\ntitle: x\n# not\n---\n# One\ntext\n## Two ##\n```\n# code\n```\nSetext\n======\nSub\n---\n#nospace\n### [Link](u) and `code` *em*\n';
  assert.deepEqual(T.headings(body), [
    { level: 1, text: 'One' }, { level: 2, text: 'Two' }, { level: 1, text: 'Setext' },
    { level: 2, text: 'Sub' }, { level: 3, text: 'Link and code em' },
  ]);
});

test('toc output', () => {
  const body = '# A\n## B c\n## B c\n### D?\n# A\n';
  assert.equal(T.buildToc(body).text, '<!-- toc -->\n- [A](#a)\n  - [B c](#b-c)\n  - [B c](#b-c-1)\n    - [D?](#d)\n- [A](#a-1)\n<!-- /toc -->');
  assert.equal(T.buildToc('## x\n#### y').text, '<!-- toc -->\n- [x](#x)\n    - [y](#y)\n<!-- /toc -->');
  assert.match(T.buildToc('no headings').text, /No headings yet/);
  assert.match(T.buildToc('# Ünï 日本 😀').text, /\(#ünï-日本\)/);
});

test('refresh replaces only the marked block', () => {
  const body = 'intro\n<!-- toc -->\n- [Old](#old)\n<!-- /toc -->\n# New\n';
  const r = T.refreshIn(body, body);
  assert.equal(r.text, 'intro\n<!-- toc -->\n- [New](#new)\n<!-- /toc -->\n# New\n');
  assert.equal(T.refreshIn('nothing', body), null);
});

test('property: never throws, unique safe anchors, idempotent refresh', () => {
  const rand = rng(2024);
  for (let i = 0; i < 1500; i += 1) {
    const body = random(rand);
    const list = T.headings(body);
    const toc = T.buildToc(body);
    assert.equal(toc.count, list.length);
    const slugs = T.anchors(list);
    assert.equal(new Set(slugs).size, slugs.length);
    for (const s of slugs) assert.match(s, /^[\p{L}\p{N}\p{M}_-]+$/u);
    assert.equal(toc.text.split('\n').length, 2 + Math.max(1, list.length));
    const doc = `${random(rand, 6)}\n${toc.text}\n${body}`;
    const once = T.refreshIn(doc, doc);
    assert.ok(once);
    const twice = T.refreshIn(once.text, once.text);
    // Refreshing against the refreshed text finds the same headings.
    assert.equal(T.refreshIn(once.text, doc).text, once.text);
    assert.ok(twice.text.includes(OPEN_MARK));
  }
});
const OPEN_MARK = '<!-- toc -->';

function run(id, s) {
  state = { noteId: 'n1', ...s, replaced: null };
  return commands.get(id).run({});
}

test('insert command keeps the selection offsets (non-ASCII safe)', () => {
  const sel = { text: 'é 日本', start: 14, end: 22 };
  const r = run('insert-toc', { body: '# Héllo\n## Wörld\n', selection: sel });
  assert.match(r.text, /Inserted .* \(2 headings\)/);
  assert.deepEqual(state.replaced.selection, { start: 14, end: 22 });
  assert.equal(state.replaced.text, '<!-- toc -->\n- [Héllo](#héllo)\n  - [Wörld](#wörld)\n<!-- /toc -->\n\né 日本');
  run('insert-toc', { body: '# A', selection: { text: '', start: 3, end: 3 } });
  assert.equal(state.replaced.text, '<!-- toc -->\n- [A](#a)\n<!-- /toc -->');
});

test('command edge cases', () => {
  assert.match(run('insert-toc', { noteId: null, selection: null }).text, /No note/);
  assert.match(run('insert-toc', { body: '# A', selection: null }).text, /cursor/);
  const body = '# A\n<!-- toc -->\n- [x](#x)\n<!-- /toc -->\n';
  assert.match(run('insert-toc', { body, selection: { text: 'A', start: 2, end: 3 } }).text, /already has/);
  assert.equal(state.replaced, null);
  assert.match(run('refresh-toc', { body: '# A', selection: { text: 'A', start: 0, end: 1 } }).text, /No table/);
  const ok = run('insert-toc', { body, selection: { text: body, start: 0, end: body.length } });
  assert.match(ok.text, /Refreshed/);
  assert.equal(state.replaced.text, '# A\n<!-- toc -->\n- [A](#a)\n<!-- /toc -->\n');
  const fresh = state.replaced.text;
  assert.match(run('insert-toc', { body: fresh, selection: { text: fresh, start: 0, end: fresh.length } }).text, /up to date/);
  assert.match(run('refresh-toc', { body, selection: { text: body, start: 0, end: 5 }, fail: Object.assign(new Error('x'), { code: 'conflict' }) }).text, /moved/);
});
