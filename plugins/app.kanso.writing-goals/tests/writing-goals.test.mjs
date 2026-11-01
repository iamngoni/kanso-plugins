import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '../source/main.js'), 'utf8');

function load({ notes = {}, open = null, settings = null } = {}) {
  const r = { commands: {}, presses: {}, panels: [], settings };
  const kanso = {
    commands: { register: (c) => { r.commands[c.id] = c; } },
    ui: { panel: (t) => r.panels.push(t), onPress: (id, fn) => { r.presses[id] = fn; } },
    editor: { noteId: () => open },
    notes: { get: (id) => notes[id] },
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
const TOKENS = ['one', 'two', 'three', 'café', '.', '\n', '\n# H', '`code`', '[a](https://x.y)', 'https://x.org'];
function text(r, max = 50) {
  let t = '';
  for (let i = Math.floor(r() * max); i > 0; i--) t += TOKENS[Math.floor(r() * TOKENS.length)] + ' ';
  return t;
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
const day = (y, m, d) => new Date(y, m - 1, d, 10);

test('counts words, ignoring front matter, code and urls', () => {
  assert.equal(api.countWords('---\na: b\n---\nHello [big world](https://x.y) `no` see https://z.org\n```\ncode here\n```\nend'), 5);
});

test('parseTarget accepts whole numbers only', () => {
  assert.equal(api.parseTarget(' 1,500 '), 1500);
  for (const bad of ['', '0', '-3', '1.5', 'abc', '99999999', null, undefined]) assert.equal(api.parseTarget(bad), null, String(bad));
});

test('words added today are counted from the first look, never negative', () => {
  const s = api.freshState();
  api.observe(s, day(2026, 3, 1), 'n1', 100);
  api.observe(s, day(2026, 3, 1), 'n1', 160);
  assert.equal(api.addedToday(s), 60);
  api.observe(s, day(2026, 3, 1), 'n1', 40);
  assert.equal(api.addedToday(s), 0);
});

test('streak grows on consecutive days, restarts after a gap, and lapses in display', () => {
  const s = api.freshState();
  s.target = 10;
  for (const d of [1, 2, 3]) {
    api.observe(s, day(2026, 3, d), 'n', 0);
    api.observe(s, day(2026, 3, d), 'n', 20);
  }
  assert.equal(s.streak, 3);
  assert.equal(api.shownStreak(s, day(2026, 3, 4)), 3);
  assert.equal(api.shownStreak(s, day(2026, 3, 5)), 0);
  api.observe(s, day(2026, 3, 6), 'n', 0);
  api.observe(s, day(2026, 3, 6), 'n', 20);
  assert.equal(s.streak, 1);
  assert.equal(s.best, 3);
  api.observe(s, day(2026, 3, 6), 'n', 90);
  assert.equal(s.streak, 1, 'once a day');
});

test('streak crosses month and year ends', () => {
  const s = api.freshState();
  s.target = 1;
  for (const d of [day(2025, 12, 31), day(2026, 1, 1)]) {
    api.observe(s, d, 'n', 0);
    api.observe(s, d, 'n', 5);
  }
  assert.equal(s.streak, 2);
});

test('normalize repairs damaged settings', () => {
  for (const raw of [null, 5, 'x', { target: -1, mode: 'x', streak: 'a', today: 7 }, { today: { date: 'd', notes: { a: { start: 'x' } } } }]) {
    const s = api.normalize(raw);
    assert.ok(s.target >= 1 && ['Today', 'Open note'].includes(s.mode) && s.streak >= 0);
    assert.deepEqual(s.today.notes, {});
  }
});

test('property: words are non-negative and additive across concatenated text', () => {
  const r = rng(3);
  for (let i = 0; i < 300; i++) {
    const a = text(r), b = text(r);
    assert.ok(api.countWords(a) >= 0);
    assert.equal(api.countWords(a + '\n\n' + b), api.countWords(a) + api.countWords(b), JSON.stringify([a, b]));
  }
});

test('property: progress and panel trees stay in bounds for random states', () => {
  const r = rng(11);
  for (let i = 0; i < 200; i++) {
    const s = api.freshState();
    s.target = 1 + Math.floor(r() * 5000);
    s.mode = r() < 0.5 ? 'Today' : 'Open note';
    for (let j = Math.floor(r() * 300); j > 0; j--) {
      api.observe(s, day(2026, 3, 1 + Math.floor(r() * 5)), 'n' + Math.floor(r() * 150), Math.floor(r() * 3000));
    }
    assert.ok(Object.keys(s.today.notes).length <= 100);
    assert.ok(api.addedToday(s) >= 0);
    const tree = api.buildPanel(s, day(2026, 3, 5), r() < 0.2 ? null : Math.floor(r() * 9000), r() < 0.5 ? 'Saved.' : '');
    const bar = JSON.stringify(tree).match(/"type":"progress","value":([0-9.e-]+)/);
    assert.ok(Number(bar[1]) >= 0 && Number(bar[1]) <= 1);
    const m = measure(tree);
    assert.ok(m.count <= 500 && m.deepest <= 8);
    assert.ok(Number.isInteger(s.streak) && s.streak >= 0 && s.best >= s.streak);
  }
});

test('the panel saves a target and mode, rejects a bad target, and persists the streak', () => {
  const { r } = load({ notes: { n1: { title: 't', body: 'a b c d e f' } }, open: 'n1' });
  r.presses.save({ target: '5', mode: 'Open note' });
  assert.equal(r.settings.target, 5);
  assert.equal(r.settings.mode, 'Open note');
  r.presses.save({ target: 'lots', mode: 'Open note' });
  assert.equal(r.settings.target, 5);
  assert.match(JSON.stringify(r.panels.at(-1)), /whole number/);
  r.commands['show-writing-goal'].run();
  assert.equal(r.panels.length, 3);
});

test('with no note open the panel still draws', () => {
  const { r } = load();
  r.presses.refresh({ target: '300', mode: 'Open note' });
  assert.match(JSON.stringify(r.panels[0]), /No note is open/);
});
