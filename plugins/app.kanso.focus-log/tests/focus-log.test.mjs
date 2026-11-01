import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '../source/main.js'), 'utf8');

function load({ notes = {}, open = null, settings = null, deny = false } = {}) {
  const r = { commands: {}, presses: {}, panels: [], settings, notes, updates: [], data: {} };
  const kanso = {
    commands: { register: (c) => { r.commands[c.id] = c; } },
    ui: { panel: (t) => r.panels.push(t), onPress: (id, fn) => { r.presses[id] = fn; } },
    editor: { noteId: () => open },
    notes: {
      get: (id) => notes[id],
      update: (id, f, o) => {
        if (deny) throw Object.assign(new Error('no'), { code: 'denied' });
        if (o.baseRev !== notes[id].rev) throw Object.assign(new Error('c'), { code: 'conflict' });
        r.updates.push([id, f]);
      },
      pluginData: {
        get: (id) => r.data[id] ?? null,
        set: (id, v) => { if (deny) throw Object.assign(new Error('no'), { code: 'denied' }); r.data[id] = v; },
      },
    },
    settings: { get: () => r.settings, set: (v) => { r.settings = JSON.parse(JSON.stringify(v)); } },
  };
  const module = { exports: {} };
  new Function('kanso', 'module', src)(kanso, module);
  return { api: module.exports, r };
}
const { api } = load();
const at = (h, m, d = 1) => new Date(2026, 2, d, h, m).getTime();

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

test('the log line has the documented shape', () => {
  assert.equal(api.logLine(at(14, 0), at(14, 45), 'Write report'), '- 14:00\u201314:45 (45 min) Write report');
  assert.equal(api.logLine(at(9, 5), at(9, 5), ''), '- 09:05\u201309:05 (0 min)');
});

test('a label can never add lines to the note', () => {
  const line = api.logLine(at(1, 0), at(1, 10), 'a\n- [ ] sneaky\r\nline');
  assert.equal(line.split('\n').length, 1);
});

test('start, stop and today total, with no timer', () => {
  const s = api.freshState();
  assert.equal(api.start(s, at(14, 0), 'Deep work'), true);
  assert.equal(api.start(s, at(14, 5), 'again'), false);
  const out = api.stop(s, at(14, 45), '');
  assert.equal(out.line, '- 14:00\u201314:45 (45 min) Deep work');
  assert.equal(api.stop(s, at(15, 0), ''), null);
  api.start(s, at(16, 0), 'x');
  api.stop(s, at(16, 30), 'x');
  assert.equal(api.todayTotal(s, at(17, 0)), 75);
  assert.equal(api.todayTotal(s, at(17, 0, 2)), 0);
});

test('appendLine keeps the note on separate lines', () => {
  assert.equal(api.appendLine('', '- a'), '- a\n');
  assert.equal(api.appendLine('hi', '- a'), 'hi\n- a\n');
  assert.equal(api.appendLine('hi\n', '- a'), 'hi\n- a\n');
});

test('Stop appends to the open note text', () => {
  const { r } = load({ notes: { n: { title: 't', body: 'Notes', rev: 'r1' } }, open: 'n' });
  r.presses.start({ label: 'Plan', dest: 'Note text' });
  assert.equal(r.settings.running.label, 'Plan');
  r.presses.stop({ label: '', dest: 'Note text' });
  assert.equal(r.updates.length, 1);
  assert.match(r.updates[0][1].body, /^Notes\n- \d\d:\d\d\u2013\d\d:\d\d \(\d+ min\) Plan\n$/);
  assert.equal(r.settings.running, null);
});

test('Stop can save in plugin data instead', () => {
  const { r } = load({ notes: { n: { body: '', rev: 'r' } }, open: 'n' });
  r.presses.start({ label: 'L', dest: 'Note data' });
  r.presses.stop({ label: '', dest: 'Note data' });
  assert.equal(r.data.n.sessions.length, 1);
  assert.equal(r.updates.length, 0);
});

test('a refused write still logs in the panel and keeps the session', () => {
  const { r } = load({ notes: { n: { body: '', rev: 'r' } }, open: 'n', deny: true });
  r.presses.start({ label: 'L' });
  r.presses.stop({ label: '' });
  assert.match(JSON.stringify(r.panels.at(-1)), /panel only/);
  assert.equal(Object.values(r.settings.days).flat().length, 1);
});

test('with no open note Stop logs in the panel only', () => {
  const { r } = load();
  r.presses.start({ label: '' });
  r.presses.stop({ label: '' });
  assert.match(JSON.stringify(r.panels.at(-1)), /No note is open/);
});

test('Stop with nothing running says so', () => {
  const { r } = load();
  r.presses.stop({});
  assert.match(JSON.stringify(r.panels[0]), /Nothing is running/);
});

test('property: minutes are non-negative, additive per day and the total is their sum', () => {
  const rand = rng(5);
  for (let i = 0; i < 200; i++) {
    const s = api.freshState();
    let t = at(8, 0);
    let sum = 0;
    for (let j = Math.floor(rand() * 150); j > 0; j--) {
      t += Math.floor(rand() * 40 * 60000);
      api.start(s, t, 'label ' + j);
      const len = Math.floor(rand() * 90 * 60000);
      t += len;
      const out = api.stop(s, t, rand() < 0.3 ? 'ñ\n x' : '');
      assert.ok(out.entry.min >= 0);
      assert.equal(out.entry.min, api.minutesBetween(t - len, t));
      if (api.dayKey(t) === '2026-03-01') sum += out.entry.min;
    }
    for (const day of Object.values(s.days)) assert.ok(day.length <= 100 && day.every((e) => e.min >= 0));
    if (s.days['2026-03-01'] && sum > 0 && Object.values(s.days['2026-03-01']).length < 100) {
      assert.equal(api.todayTotal(s, at(12, 0)), sum);
    }
    assert.ok(api.todayTotal(s, t) >= 0);
  }
});

test('property: panel trees stay within 500 nodes and 8 levels with unique ids', () => {
  const rand = rng(9);
  for (let i = 0; i < 100; i++) {
    const s = api.freshState();
    let t = at(0, 1);
    for (let j = Math.floor(rand() * 200); j > 0; j--) {
      api.start(s, t, 'x'.repeat(Math.floor(rand() * 300)));
      t += Math.floor(rand() * 60000 * 20);
      api.stop(s, t, '');
      t += 1000;
    }
    if (rand() < 0.5) api.start(s, t, 'running');
    const tree = api.buildPanel(s, t, rand() < 0.5 ? 'Note' : '');
    const m = measure(tree);
    assert.ok(m.count <= 500 && m.deepest <= 8, `${m.count} ${m.deepest}`);
    const all = ids(tree);
    assert.equal(new Set(all).size, all.length);
  }
});

test('normalize repairs damaged settings', () => {
  for (const raw of [null, 3, { running: { start: 'x' }, days: 5 }, { days: { '2026-01-01': [{ from: 1 }, null], bad: [] } }]) {
    const s = api.normalize(raw);
    assert.equal(s.running, null);
    assert.ok(Object.keys(s.days).every((k) => /^\d{4}-/.test(k)));
  }
});
