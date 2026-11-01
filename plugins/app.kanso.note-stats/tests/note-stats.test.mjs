import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '../source/main.js'), 'utf8');

function load(notes = {}, open = null) {
  const registered = { commands: {}, presses: {}, panels: [] };
  const kanso = {
    commands: { register: (c) => { registered.commands[c.id] = c; } },
    ui: { panel: (t) => registered.panels.push(t), onPress: (id, fn) => { registered.presses[id] = fn; } },
    editor: { noteId: () => open },
    notes: { get: (id) => notes[id] },
  };
  const module = { exports: {} };
  new Function('kanso', 'module', src)(kanso, module);
  return { api: module.exports, registered };
}

const { api } = load();

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const TOKENS = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dogs', 'reading', 'café', '.', '!', '?', '[[Page One]]',
  '[[a|b]]', '[a link](https://example.com/x)', '`code`', 'https://x.org/y', '\n', '\n- [ ] task', '\n- [x] done', '\n# Head', '\n## Sub', '\n> quote', '\n- item'];
function randomText(r, max = 60) {
  let t = '';
  const n = Math.floor(r() * max);
  for (let i = 0; i < n; i++) t += TOKENS[Math.floor(r() * TOKENS.length)] + ' ';
  return t;
}
const NUM = ['words', 'sentences', 'syllables', 'links', 'wikilinks', 'tasks', 'tasksDone'];

test('counts a known note', () => {
  const body = '---\ntitle: x\n---\n# Intro\nThe cat sat. The dog ran!\n\n## Todo\n- [ ] one\n- [x] two\nSee [[Other]] and [site](https://a.b) and ![img](x.png).\n```js\nlet a = b c d e;\n```\n';
  const s = api.analyze(body);
  assert.equal(s.links, 1);
  assert.equal(s.wikilinks, 1);
  assert.equal(s.tasks, 2);
  assert.equal(s.tasksDone, 1);
  assert.deepEqual(s.headings.map((h) => [h.level, h.text]), [[1, 'Intro'], [2, 'Todo']]);
  assert.ok(s.words >= 12 && s.words <= 20, String(s.words));
});

test('empty text has no score and no reading time', () => {
  const s = api.analyze('');
  assert.equal(s.words, 0);
  assert.equal(api.flesch(s), null);
  assert.equal(api.readingMinutes(0), 0);
});

test('easy prose scores above hard prose', () => {
  const easy = api.flesch(api.analyze('The cat sat. The dog ran. We go up.'));
  const hard = api.flesch(api.analyze('Institutional characterisation notwithstanding, comprehensive epistemological considerations necessitate extraordinarily sophisticated methodological frameworks.'));
  assert.ok(easy > hard);
});

test('property: stats are non-negative and additive across concatenated text', () => {
  const r = rng(42);
  for (let i = 0; i < 300; i++) {
    const a = randomText(r);
    const b = randomText(r);
    const sa = api.analyze(a), sb = api.analyze(b), sab = api.analyze(a + '\n\n' + b);
    for (const k of NUM) {
      assert.ok(sa[k] >= 0 && sb[k] >= 0 && sab[k] >= 0, k);
      assert.equal(sab[k], sa[k] + sb[k], `${k} for ${JSON.stringify([a, b])}`);
    }
    assert.equal(sab.headings.length, sa.headings.length + sb.headings.length);
    assert.ok(sa.tasksDone <= sa.tasks);
    const f = api.flesch(sab);
    assert.ok(f === null || (f >= 0 && f <= 100));
  }
});

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

test('property: every panel stays within 500 nodes and 8 levels with unique ids', () => {
  const r = rng(7);
  for (let i = 0; i < 100; i++) {
    const body = randomText(r, i % 10 === 0 ? 4000 : 80);
    const tree = api.buildPanel(randomText(r, 5), api.analyze(body));
    const { count, deepest } = measure(tree);
    assert.ok(count <= 500, `${count} nodes`);
    assert.ok(deepest <= 8, `${deepest} deep`);
    const all = ids(tree);
    assert.equal(new Set(all).size, all.length);
    assert.ok(JSON.stringify(tree).length < 256 * 1024);
  }
});

test('the command and Refresh draw the open note', () => {
  const { registered } = load({ n1: { title: 'Hello', body: '# Hi\nSome words here.' } }, 'n1');
  registered.commands['show-note-stats'].run();
  registered.presses.refresh();
  assert.equal(registered.panels.length, 2);
  assert.equal(registered.panels[0].children[0].value, 'Hello');
});

test('with no open note it says so', () => {
  const { registered } = load({}, null);
  registered.presses.refresh();
  assert.equal(registered.panels[0].children[1].value, 'No note is open.');
});
