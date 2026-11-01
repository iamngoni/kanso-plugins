import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const commands = new Map();
let selection = null;
let replaced = null;
let failWith = null;
globalThis.kanso = {
  commands: { register: (c) => commands.set(c.id, c) },
  editor: {
    selection: () => selection,
    replaceSelection: (args) => {
      if (failWith) throw failWith;
      replaced = args;
    },
  },
};
const T = createRequire(import.meta.url)(path.join(here, '../source/main.js'));

// Deterministic random strings, ASCII and Unicode.
function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const ALPHABET = ['a', 'B', 'z', 'Z', '0', '7', '10', ' ', ' ', '\n', '\n', '\r\n', '\t', '-', '_', '.', '!', '?', '|', '\\', "'", 'é', 'Ñ', 'ß', 'ǆ', 'İ', 'ς', 'Σ', '日本', '😀', 'é', 'я', ' '];
function randomString(rand, max = 40) {
  let out = '';
  const n = Math.floor(rand() * max);
  for (let i = 0; i < n; i += 1) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}
function each(fn, n = 400) {
  const rand = rng(12345);
  for (let i = 0; i < n; i += 1) fn(randomString(rand), i);
}

test('sorting', () => {
  assert.equal(T.sortAsc('b\nA\nc\n'), 'A\nb\nc\n');
  assert.equal(T.sortDesc('b\nA\nc'), 'c\nb\nA');
  assert.equal(T.sortNatural('file10\nfile2\nfile1'), 'file1\nfile2\nfile10');
  assert.equal(T.sortAsc('b\r\na'), 'a\r\nb');
});

test('sorting is idempotent, a permutation, and never throws', () => {
  for (const f of [T.sortAsc, T.sortDesc, T.sortNatural]) {
    each((s) => {
      const once = f(s);
      assert.equal(f(once), once);
      // A blank last line and a trailing newline look the same once joined,
      // so compare the non-blank lines.
      const keep = (x) => T.splitLines(x).lines.filter((l) => l !== '').sort();
      assert.deepEqual(keep(once), keep(s), JSON.stringify([s, once]));
    });
  }
});

test('dedupe and reverse', () => {
  assert.equal(T.dedupeLines('a\nb\na\nc\nb'), 'a\nb\nc');
  assert.equal(T.reverseLines('a\nb\nc\n'), 'c\nb\na\n');
  each((s) => {
    const d = T.dedupeLines(s);
    assert.equal(T.dedupeLines(d), d);
    const lines = T.splitLines(d).lines;
    assert.equal(new Set(lines).size, lines.length);
    const keep = (x) => T.splitLines(x).lines.filter((l) => l !== '');
    assert.deepEqual(keep(T.reverseLines(T.reverseLines(s))), keep(s));
  });
});

test('case', () => {
  assert.equal(T.titleCase('the lord of the rings'), 'The Lord of the Rings');
  assert.equal(T.titleCase("don't STOP believing"), "Don't Stop Believing");
  assert.equal(T.sentenceCase('HELLO there. how are you? FINE'), 'Hello there. How are you? Fine');
  assert.equal(T.upper('straße'), 'STRASSE');
  assert.equal(T.lower('ÀB'), 'àb');
  for (const f of [T.titleCase, T.sentenceCase, T.upper, T.lower]) {
    each((s) => {
      const once = f(s);
      assert.equal(f(once), once, JSON.stringify(s));
    });
  }
});

test('slugify', () => {
  assert.equal(T.slugify('  Héllo, Wörld! 2024  '), 'hello-world-2024');
  assert.equal(T.slugify('Straße & Æther'), 'strasse-aether');
  each((s) => {
    const slug = T.slugify(s);
    assert.match(slug, /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/);
    assert.equal(T.slugify(slug), slug);
  });
});

test('trim trailing whitespace', () => {
  assert.equal(T.trimTrailing('a  \nb\t\n  c   '), 'a\nb\n  c');
  each((s) => {
    const once = T.trimTrailing(s);
    assert.equal(T.trimTrailing(once), once);
    assert.ok(!/[^\S\r\n]$/m.test(once));
  });
});

test('markdown tables', () => {
  const out = T.alignTable('|a|bb|\n|:-|-:|\n|longer|1|\n');
  assert.equal(out.text, '| a      |  bb |\n| :----- | --: |\n| longer |   1 |\n');
  assert.ok(T.alignTable('just text').error);
  assert.equal(T.listToTable('- apple\n- pear').text, '| Item  |\n| ----- |\n| apple |\n| pear  |');
  assert.equal(T.listToTable('1. a, 1\n2. b, 2').text, '| a   | 1   |\n| --- | --- |\n| b   | 2   |');
  assert.ok(T.listToTable('\n\n').error);
});

test('table alignment is idempotent, aligned, and never throws', () => {
  each((s) => {
    const r = T.alignTable(s);
    if (r.text === undefined) return;
    const again = T.alignTable(r.text);
    assert.equal(again.text, r.text, JSON.stringify(s));
    const widths = r.text.split('\n').filter(Boolean).map(T.textWidth);
    assert.equal(new Set(widths).size, 1, JSON.stringify(r.text));
  }, 800);
  const rand = rng(99);
  for (let i = 0; i < 200; i += 1) {
    const cols = 1 + Math.floor(rand() * 4);
    const row = () => '|' + Array.from({ length: cols }, () => randomString(rand, 8).replace(/[\n\r|\\]/g, '')).join('|') + '|';
    const text = [row(), '|' + Array(cols).fill('---').join('|') + '|', row(), row()].join('\n');
    const r = T.alignTable(text);
    assert.ok(r.text, text);
    assert.equal(T.alignTable(r.text).text, r.text);
  }
  each((s) => { T.listToTable(s); });
});

test('lorem', () => {
  const l = T.lorem(3);
  assert.equal(l.split('\n\n').length, 3);
  assert.ok(l.startsWith('Lorem ipsum dolor sit amet'));
  assert.equal(T.lorem(3), l);
  assert.equal(T.lorem(0).split('\n\n').length, 1);
  assert.equal(T.lorem(1000).split('\n\n').length, 20);
});

function run(id, sel) {
  selection = sel;
  replaced = null;
  return commands.get(id).run({});
}

test('commands read the selection and write it back with the same offsets', () => {
  const sel = { text: 'b\nC\na', start: 7, end: 13 };
  const r = run('sort-az', sel);
  assert.equal(replaced.text, 'a\nb\nC');
  assert.deepEqual(replaced.selection, { start: 7, end: 13 });
  assert.match(r.text, /Sorted/);
  assert.ok([...commands.values()].every((c) => c.when === 'selection'));
});

test('commands cope with no selection, no change and a moved selection', () => {
  assert.match(run('slugify', null).text, /Select/);
  assert.equal(replaced, null);
  assert.match(run('sort-az', { text: 'a\nb', start: 0, end: 3 }).text, /Nothing to change/);
  failWith = Object.assign(new Error('the selection changed'), { code: 'conflict' });
  assert.match(run('reverse', { text: 'a\nb', start: 0, end: 3 }).text, /moved/);
  assert.match(run('lorem', { text: '2', start: 0, end: 1 }).text, /moved/);
  failWith = null;
  assert.match(run('align-table', { text: 'nope', start: 0, end: 4 }).text, /table/);
});

test('lorem command', () => {
  run('lorem', { text: '2', start: 5, end: 6 });
  assert.equal(replaced.text.split('\n\n').length, 2);
  run('lorem', { text: 'Intro', start: 0, end: 5 });
  assert.ok(replaced.text.startsWith('Intro\n\nLorem'));
  assert.match(run('lorem', { text: '99', start: 0, end: 2 }).text, /between/);
});
