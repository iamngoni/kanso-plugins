import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, load, texts } from './harness.mjs';

const MAIN = new URL('../source/main.js', import.meta.url);
const DAY = 86400000;
const NOW = Date.parse('2026-11-01T12:00:00Z');

function setup(items, extra = {}) {
  const notes = items.map((it, i) => ({
    id: `note:${i}`,
    title: it.title ?? `Note ${i}`,
    bookId: it.book ?? 'book:a',
    createdAt: NOW - (it.created ?? 30) * DAY,
    updatedAt: NOW - (it.updated ?? 30) * DAY,
  }));
  const world = makeWorld({ notes, ...extra });
  const realNow = Date.now;
  const ctx = load(MAIN, world);
  return { world, ctx, realNow };
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('property: every note in the window is linked exactly once, none outside it', () => {
  const { ctx } = setup([]);
  const rand = rng(2);
  for (let round = 0; round < 100; round++) {
    const notes = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      title: `Title${i}`,
      bookId: `book:${i % 3}`,
      createdAt: NOW - Math.floor(rand() * 20) * DAY,
      updatedAt: NOW - Math.floor(rand() * 20) * DAY,
    }));
    notes.forEach((n) => (n.updatedAt = Math.max(n.updatedAt, n.createdAt)));
    const r = ctx.buildReview(notes, NOW, 7, false);
    notes.forEach((n) => {
      const inside = n.updatedAt >= NOW - 7 * DAY || n.createdAt >= NOW - 7 * DAY;
      const count = r.body.split(`[[${n.title}]]`).length - 1;
      assert.equal(count, inside ? 1 : 0, n.title);
    });
  }
});

test('property: the review does not depend on the order of the input', () => {
  const { ctx } = setup([]);
  const rand = rng(6);
  const notes = Array.from({ length: 15 }, (_, i) => ({
    id: `n${i}`, title: `T${i}`, bookId: `book:${i % 4}`,
    createdAt: NOW - Math.floor(rand() * 10) * DAY, updatedAt: NOW - Math.floor(rand() * 5) * DAY,
  }));
  const a = ctx.buildReview(notes, NOW, 7, false).body;
  const b = ctx.buildReview([...notes].reverse(), NOW, 7, false).body;
  assert.equal(a, b);
});

test('groups by notebook, splits new and changed, escapes link text, skips earlier reviews', () => {
  const { ctx } = setup([]);
  const notes = [
    { id: 'a', title: 'New one', bookId: 'book:x', createdAt: NOW - DAY, updatedAt: NOW - DAY },
    { id: 'b', title: 'Old [one]|#', bookId: 'book:x', createdAt: NOW - 40 * DAY, updatedAt: NOW - 2 * DAY },
    { id: 'c', title: 'Elsewhere', bookId: 'book:y', createdAt: NOW - DAY, updatedAt: NOW - DAY },
    { id: 'd', title: 'Weekly review 2026-10-01 to 2026-10-08', bookId: 'book:x', createdAt: NOW - DAY, updatedAt: NOW - DAY },
  ];
  const r = ctx.buildReview(notes, NOW, 7, false);
  assert.match(r.body, /## Notebook x[\s\S]*### New[\s\S]*\[\[New one\]\][\s\S]*### Changed[\s\S]*\[\[Old one\]\]/);
  assert.match(r.body, /## Notebook y/);
  assert.doesNotMatch(r.body, /Weekly review 2026-10-01/);
  assert.equal(r.newCount, 2);
  assert.equal(r.changedCount, 1);
});

test('toMs accepts seconds and milliseconds', () => {
  const { ctx } = setup([]);
  assert.equal(ctx.toMs(1700000000), 1700000000000);
  assert.equal(ctx.toMs(1700000000000), 1700000000000);
});

test('the command stages one new note in the chosen notebook', () => {
  const items = [
    { title: 'Fresh', created: 1, updated: 1 },
    { title: 'Edited', created: 50, updated: 3, book: 'book:b' },
    { title: 'Ancient', created: 90, updated: 80 },
  ];
  const { world } = setup(items);
  const fakeNow = Date.now;
  Date.now = () => NOW;
  try {
    world.run('weekly-review');
    world.press('create', { days: '7', book: 'book:a' });
  } finally {
    Date.now = fakeNow;
  }
  assert.equal(world.created.length, 1);
  const c = world.created[0];
  assert.equal(c.bookId, 'book:a');
  assert.match(c.title, /^Weekly review 2026-10-25 to 2026-11-01$/);
  assert.match(c.body, /\[\[Fresh\]\]/);
  assert.match(c.body, /\[\[Edited\]\]/);
  assert.doesNotMatch(c.body, /Ancient/);
  assert.match(texts(world.panelTree), /Staged/);
});

test('a big library stays inside the call budget and says if it stopped early', () => {
  const items = Array.from({ length: 1200 }, (_, i) => ({ title: `N${i}`, created: 1, updated: 1 }));
  const { world } = setup(items);
  const fakeNow = Date.now;
  Date.now = () => NOW;
  try {
    world.press('create', { days: '7', book: 'book:a' });
  } finally {
    Date.now = fakeNow;
  }
  assert.ok(world.totalCalls <= 12, `calls ${world.totalCalls}`);
  assert.match(world.created[0].body, /stops early/);
});

test('the minute limit is reported, not thrown', () => {
  const { world } = setup([{ title: 'x', created: 1, updated: 1 }], { callsPerMinute: 1 });
  const fakeNow = Date.now;
  Date.now = () => NOW;
  try {
    assert.doesNotThrow(() => world.press('create', { days: '7', book: 'book:a' }));
  } finally {
    Date.now = fakeNow;
  }
  assert.match(texts(world.panelTree), /Stopped/);
});
