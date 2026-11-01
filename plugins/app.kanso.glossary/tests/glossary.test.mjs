import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '../source/main.js'), 'utf8');

function load({ notes = {}, open = null, settings = null, selection = null } = {}) {
  const r = { commands: {}, presses: {}, panels: [], settings, gets: 0, edits: [], selection };
  const order = Object.keys(notes);
  const kanso = {
    commands: { register: (c) => { r.commands[c.id] = c; } },
    ui: { panel: (t) => r.panels.push(t), onPress: (id, fn) => { r.presses[id] = fn; } },
    editor: {
      noteId: () => open,
      selection: () => r.selection,
      replaceSelection: (e) => {
        if (e.selection.start !== r.selection.start) throw Object.assign(new Error('c'), { code: 'conflict' });
        r.edits.push(e);
      },
    },
    notes: {
      list: ({ cursor } = {}) => {
        const from = cursor ? Number(cursor) : 0;
        const page = order.slice(from, from + 100);
        return { notes: page.map((id) => ({ id, title: notes[id].title, updatedAt: notes[id].updatedAt })), cursor: from + 100 < order.length ? String(from + 100) : null };
      },
      get: (id) => { r.gets += 1; return { id, ...notes[id] }; },
    },
    settings: { get: () => r.settings, set: (v) => { r.settings = JSON.parse(JSON.stringify(v)); } },
  };
  const module = { exports: {} };
  new Function('kanso', 'module', src)(kanso, module);
  return { api: module.exports, r };
}
const { api } = load();

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
function measure(node, depth = 1) {
  let count = 1, deepest = depth;
  for (const c of node.children || node.items || []) {
    const m = measure(c, depth + 1);
    count += m.count;
    deepest = Math.max(deepest, m.deepest);
  }
  return { count, deepest };
}
function ids(node, out = []) {
  if (node.id) out.push(node.id);
  for (const c of node.children || node.items || []) ids(c, out);
  return out;
}

test('finds Term:: definition lines in prose, lists and bold', () => {
  const found = api.extract('Intro\nAPI:: Application programming interface\n- **CPU**:: central processing unit\n- [[Node]]:: a thing\nnot:: \nplain text: nope\n');
  assert.deepEqual(found.map((f) => f.term), ['API', 'CPU', 'Node']);
  assert.equal(found[0].def, 'Application programming interface');
});

test('reads entries under a Glossary heading and stops at the next section', () => {
  const body = '# Doc\n## Glossary\n- **Idempotent**: same result twice\n- Latency - delay\nThroughput: how much\n### Sub\n- Deep: still inside\n## Other\n- Outside: not a term\n';
  assert.deepEqual(api.extract(body).map((f) => f.term), ['Idempotent', 'Latency', 'Throughput', 'Deep']);
});

test('ignores fenced code, front matter and repeats', () => {
  const body = '---\nTitle:: Not a term\n---\n```\nFoo:: bar\n```\nA:: first\na:: second\n';
  assert.deepEqual(api.extract(body), [{ term: 'A', def: 'first' }]);
});

test('search ranks term matches before definition matches', () => {
  const s = api.freshState();
  api.record(s, 'n1', 1, 'N', [{ term: 'Cache', def: 'fast store' }, { term: 'Store', def: 'holds a cache' }, { term: 'Cachet', def: 'prestige' }]);
  assert.deepEqual(api.search(s, 'cache').map((r) => r.term), ['Cache', 'Cachet', 'Store']);
  assert.equal(api.search(s, 'zzz').length, 0);
  assert.equal(api.search(s, '').length, 3);
});

test('insertion keeps selected words and adds the definition after them', () => {
  assert.equal(api.insertion('', 'a def'), 'a def');
  assert.equal(api.insertion('CPU', 'a def'), 'CPU (a def)');
});

test('property: extraction is bounded and additive for Term:: lines', () => {
  const r = rng(21);
  const toks = ['Alpha:: one', 'Beta:: two words', 'plain text', '- [ ] task', '# Heading', '> quote', '', 'x:: y', 'Cafe:: caf\u00e9'];
  const make = () => Array.from({ length: Math.floor(r() * 30) }, () => toks[Math.floor(r() * toks.length)]).join('\n');
  for (let i = 0; i < 300; i++) {
    const a = make(), b = make();
    const fa = api.extract(a), fb = api.extract(b);
    assert.ok(fa.length >= 0 && fa.length <= 30);
    const uniqueA = new Set(fa.map((f) => f.term.toLowerCase()));
    const uniqueB = new Set(fb.map((f) => f.term.toLowerCase()));
    const union = new Set([...uniqueA, ...uniqueB]);
    const both = api.extract(a + '\n\n' + b);
    assert.deepEqual(new Set(both.map((f) => f.term.toLowerCase())), union);
    for (const f of both) assert.ok(f.term.length <= 80 && f.def.length <= 240 && f.def !== '');
  }
});

test('property: the panel stays within limits for large random indexes', () => {
  const r = rng(77);
  for (let i = 0; i < 60; i++) {
    const s = api.freshState();
    for (let n = Math.floor(r() * 120); n > 0; n--) {
      const found = Array.from({ length: Math.floor(r() * 30) }, (_, k) => ({ term: 'term' + Math.floor(r() * 400) + 'x'.repeat(k % 5), def: 'definition '.repeat(1 + Math.floor(r() * 25)) }));
      api.record(s, 'n' + n, n, 'Note ' + n, found);
    }
    api.prune(s);
    assert.ok(JSON.stringify(s).length <= 56000 + 400);
    const q = ['', 'term', 'def', 'zzz', 'term1'][Math.floor(r() * 5)];
    const tree = api.buildPanel(s, q, r() < 0.5 ? 'status' : '', Math.floor(r() * 50));
    const m = measure(tree);
    assert.ok(m.count <= 500 && m.deepest <= 8, `${m.count} ${m.deepest}`);
    const all = ids(tree);
    assert.equal(new Set(all).size, all.length);
    const select = JSON.stringify(tree).match(/"type":"select".*?"value":"([^"]*)","options":\[(.*?)\]/);
    if (select) assert.ok(JSON.parse('[' + select[2] + ']').includes(select[1]));
    assert.ok(JSON.stringify(tree).length < 256 * 1024);
  }
});

test('refresh reads the open note and changed notes, at most 40 reads', () => {
  const notes = {};
  for (let i = 0; i < 90; i++) notes['n' + i] = { title: 'T' + i, body: `Term${i}:: def ${i}`, updatedAt: i };
  const { r } = load({ notes, open: 'n3' });
  r.presses.refresh({ q: '' });
  assert.ok(r.gets <= 40, String(r.gets));
  assert.match(JSON.stringify(r.panels.at(-1)), /more to read/);
  const before = r.gets;
  r.presses.refresh({ q: '' });
  assert.ok(r.gets - before <= 40);
  r.presses.refresh({ q: '' });
  const total = Object.keys(r.settings.notes).length;
  assert.equal(total, 90);
  const after = r.gets;
  r.presses.refresh({ q: '' });
  assert.equal(r.gets - after, 1, 'only the open note is read again');
});

test('Search filters without reading notes', () => {
  const { r } = load({ notes: { a: { title: 'A', body: 'Cat:: feline\nDog:: canine', updatedAt: 1 } } });
  r.commands['show-glossary'].run();
  const reads = r.gets;
  r.presses.search({ q: 'feli' });
  assert.equal(r.gets, reads);
  const text = JSON.stringify(r.panels.at(-1));
  assert.match(text, /Cat/);
  assert.doesNotMatch(text, /Dog \\u2014/);
});

test('Insert replaces the selection with the definition', () => {
  const { r } = load({ notes: { a: { title: 'A', body: 'Cat:: feline', updatedAt: 1 } }, selection: { text: 'kitten', start: 4, end: 10 } });
  r.presses.refresh({ q: '' });
  r.presses.insert({ q: '', term: 'cat' });
  assert.equal(r.edits[0].text, 'kitten (feline)');
  r.selection = null;
  r.presses.insert({ q: '', term: 'Cat' });
  assert.match(JSON.stringify(r.panels.at(-1)), /cursor/);
  r.selection = { text: '', start: 1, end: 1 };
  r.presses.insert({ q: '', term: 'nope' });
  assert.match(JSON.stringify(r.panels.at(-1)), /Pick a term/);
});

test('damaged settings are repaired', () => {
  for (const raw of [null, 4, { notes: 5 }, { notes: { a: { t: 'x' }, b: { t: [[1, 2], ['#bad', 'x'], ['ok', 'fine']] } } }]) {
    const s = api.normalize(raw);
    assert.ok(Object.values(s.notes).every((e) => Array.isArray(e.t)));
  }
});
