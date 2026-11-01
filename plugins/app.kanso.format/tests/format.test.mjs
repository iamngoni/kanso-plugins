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
    replaceSelection: (a) => { if (failWith) throw failWith; replaced = a; },
  },
};
const T = createRequire(import.meta.url)(path.join(here, '../source/main.js'));

function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const CHARS = ['a', 'Z', '1', ' ', '\n', '\t', "'", '"', '`', '[', ']', '(', ')', ',', ';', '.', '-', '--', '/*', '*/', '*', '=', ':', '::', ':x', 'é', '日本', '😀', 'select', 'FROM', 'where', 'and', 'group', 'by', 'order', 'left', 'join', 'on', 'between', 'case', 'end', 'union', 'values', 'set', 'update', 'insert', 'into', 'limit', '{', '}', '\\', 'e5', '1.5'];
// Unterminated quotes, brackets and comments swallow what follows, and a
// formatter can't be idempotent over text that only becomes a quote or a
// comment once its neighbours move. Idempotence is held over well-formed
// text; garbage must only never throw.
const GARBAGE = new Set(['"', '`', '[', ']', '/*', '*/', '--', "'", '\\']);
function random(rand, max = 30, tame = false) {
  let out = '';
  const n = Math.floor(rand() * max);
  for (let i = 0; i < n; i += 1) {
    const c = CHARS[Math.floor(rand() * CHARS.length)];
    if (tame && GARBAGE.has(c)) continue;
    out += c + (rand() < 0.5 ? ' ' : '');
  }
  return out;
}

test('json pretty and minify keep literals', () => {
  const src = '{"a":[1,2,{"b":null}],"c":{},"d":[],"n":12345678901234567890,"a":1.50,"s":"x\\"}, ["}';
  const pretty = T.prettyJson(src).text;
  assert.equal(pretty, '{\n  "a": [\n    1,\n    2,\n    {\n      "b": null\n    }\n  ],\n  "c": {},\n  "d": [],\n  "n": 12345678901234567890,\n  "a": 1.50,\n  "s": "x\\"}, ["\n}');
  assert.equal(T.minifyJson(pretty).text, src);
  assert.equal(T.prettyJson('  42 ').text, '42');
});

test('invalid json gives a clear error and no text', () => {
  for (const bad of ['{"a":}', '', '{', "{'a':1}", '[1,]']) {
    const r = T.prettyJson(bad);
    assert.match(r.error, /^Invalid JSON/);
    assert.equal(r.text, undefined);
  }
  assert.deepEqual(T.locate('ab\ncd', 'x at position 4'), { line: 2, column: 2 });
});

test('json formatting is idempotent and round-trips on random values', () => {
  const rand = rng(3);
  const gen = (d) => {
    const k = Math.floor(rand() * (d > 3 ? 4 : 6));
    if (k === 0) return String(Math.floor(rand() * 1e6) / 7);
    if (k === 1) return JSON.stringify(random(rand, 6));
    if (k === 2) return rand() < 0.5 ? 'true' : 'null';
    if (k === 3) return '-0.5e3';
    if (k === 4) return '[' + Array.from({ length: Math.floor(rand() * 4) }, () => gen(d + 1)).join(' , ') + ']';
    return '{' + Array.from({ length: Math.floor(rand() * 4) }, () => JSON.stringify(random(rand, 4)) + ' : ' + gen(d + 1)).join(',\n') + '}';
  };
  for (let i = 0; i < 300; i += 1) {
    const src = gen(0);
    const p = T.prettyJson(src).text;
    assert.deepEqual(JSON.parse(p), JSON.parse(src));
    assert.equal(T.prettyJson(p).text, p);
    const m = T.minifyJson(src).text;
    assert.equal(T.minifyJson(m).text, m);
    assert.equal(T.minifyJson(p).text, m);
    assert.equal(T.prettyJson(m).text, p);
  }
  for (let i = 0; i < 500; i += 1) {
    const s = random(rand);
    const r = T.prettyJson(s);
    assert.ok(r.text !== undefined || r.error);
  }
});

test('sql layout', () => {
  const out = T.formatSql("select a, count(*) as n from t left join u on t.id=u.id and u.x = 1 where a between 1 and 2 and b like 'x' group by a order by n desc limit 5");
  assert.equal(out, "SELECT\n  a,\n  COUNT(*) AS n\nFROM t\nLEFT JOIN u\n  ON t.id = u.id\n  AND u.x = 1\nWHERE a BETWEEN 1 AND 2\n  AND b LIKE 'x'\nGROUP BY a\nORDER BY n DESC\nLIMIT 5");
  assert.equal(T.formatSql("select 'from where' as \"order\", t.order from t"), "SELECT\n  'from where' AS \"order\",\n  t.order\nFROM t");
  assert.match(T.formatSql('select 1 -- hi\nfrom t'), /-- hi\nFROM t/);
});

test('sql formatting is idempotent and never throws', () => {
  const rand = rng(77);
  for (let i = 0; i < 1500; i += 1) {
    const wild = T.formatSql(random(rand, 40));
    assert.equal(typeof wild, 'string');
    const s = random(rand, 40, true);
    const once = T.formatSql(s);
    assert.equal(T.formatSql(once), once, JSON.stringify(s));
    assert.ok(!/[ \t]+$/m.test(once), JSON.stringify([s, once]));
  }
});

function run(id, sel) { selection = sel; replaced = null; return commands.get(id).run({}); }

test('commands', () => {
  const sel = { text: 'é {"a":1}', start: 3, end: 12 };
  assert.match(run('json-pretty', sel).text, /Invalid JSON/);
  assert.equal(replaced, null);
  const ok = { text: '{"a":"é"}', start: 5, end: 15 };
  assert.match(run('json-pretty', ok).text, /pretty/);
  assert.deepEqual(replaced.selection, { start: 5, end: 15 });
  assert.match(run('sql-format', null).text, /Select/);
  failWith = Object.assign(new Error('x'), { code: 'conflict' });
  assert.match(run('json-minify', { text: '{ "a" : 1 }', start: 0, end: 11 }).text, /moved/);
  failWith = null;
  assert.ok([...commands.values()].every((c) => c.when === 'selection'));
});
