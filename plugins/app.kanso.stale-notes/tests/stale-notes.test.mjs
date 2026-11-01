import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, load, texts } from './harness.mjs';

const MAIN = new URL('../source/main.js', import.meta.url);
const DAY = 86400000;
const NOW = Date.parse('2026-11-01T12:00:00Z');
const plain = (v) => JSON.parse(JSON.stringify(v));

function setup(ages, extra = {}) {
  const notes = ages.map((a, i) => ({
    id: `note:${i}`,
    title: `Note ${i}`,
    tags: a.tags ?? [],
    createdAt: NOW - 900 * DAY,
    updatedAt: NOW - a.days * DAY,
  }));
  const world = makeWorld({ notes, tags: { 'tag:stale': 'stale', 'tag:x': 'x' }, ...extra });
  return { world, ctx: load(MAIN, world) };
}
function withNow(fn) {
  const real = Date.now;
  Date.now = () => NOW;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('property: tagging is idempotent and never loses or duplicates tags', () => {
  const { ctx } = setup([]);
  const rand = rng(12);
  const ids = ['tag:a', 'tag:b', 'tag:stale', 'tag:c'];
  for (let i = 0; i < 300; i++) {
    const tags = ids.filter(() => rand() < 0.5);
    const once = plain(ctx.withTag(tags, 'tag:stale'));
    assert.deepEqual(plain(ctx.withTag(once, 'tag:stale')), once);
    assert.ok(tags.every((t) => once.includes(t)));
    assert.equal(once.filter((t) => t === 'tag:stale').length, 1);
  }
});

test('property: a longer wait is a subset of a shorter one', () => {
  const { ctx } = setup([]);
  const rand = rng(3);
  for (let i = 0; i < 200; i++) {
    const note = { updatedAt: NOW - Math.floor(rand() * 1000) * DAY };
    if (ctx.isStale(note, ctx.cutoffFor(NOW, 12))) assert.ok(ctx.isStale(note, ctx.cutoffFor(NOW, 6)));
  }
});

test('lists only notes older than the chosen months, untagged ones only', () => {
  const { world } = setup([{ days: 10 }, { days: 200 }, { days: 400 }, { days: 800, tags: ['tag:stale'] }]);
  withNow(() => world.press('list', { months: '6' }));
  const t = texts(world.panelTree);
  assert.match(t, /2 untouched for 6 months/);
  assert.doesNotMatch(t, /Note 0\b/);
  withNow(() => world.press('list', { months: '12' }));
  assert.match(texts(world.panelTree), /1 untouched for 12 months/);
});

test('tags them and a second run finds nothing left to do', () => {
  const { world } = setup([{ days: 10 }, { days: 400, tags: ['tag:x'] }, { days: 500 }, { days: 900, tags: ['tag:stale'] }]);
  withNow(() => {
    world.press('list', { months: '6' });
    world.press('tag', { months: '6' });
  });
  assert.deepEqual(world.note('note:1').tags, ['tag:x', 'tag:stale']);
  assert.deepEqual(world.note('note:2').tags, ['tag:stale']);
  assert.deepEqual(world.note('note:0').tags, []);
  withNow(() => world.press('list', { months: '6' }));
  assert.match(texts(world.panelTree), /0 untouched/);
});

test('asks for a first #stale tag when none exists', () => {
  const notes = [{ id: 'note:0', title: 'x', updatedAt: NOW - 400 * DAY }];
  const world = makeWorld({ notes, tags: {} });
  load(MAIN, world);
  withNow(() => {
    world.press('list', { months: '6' });
    world.press('tag', { months: '6' });
  });
  assert.match(texts(world.panelTree), /no tag called stale/);
  assert.deepEqual(world.note('note:0').tags, []);
});

test('a big library is read in steps and tagged in steps, within budget', () => {
  const { world } = setup(Array.from({ length: 400 }, (_, i) => ({ days: 400 + i, tags: i === 0 ? ['tag:stale'] : [] })));
  const text = () => texts(world.panelTree);
  withNow(() => {
    for (let pass = 0; pass < 4 && !world.notes.every((n) => n.tags.includes('tag:stale')); pass++) {
      world.newMinute();
      world.press('list', { months: '6' });
      assert.ok(world.calls <= 55);
      let rounds = 0;
      while (/Keep looking/.test(text()) && rounds++ < 10) {
        world.newMinute();
        world.press('more', { months: '6' });
      }
      rounds = 0;
      world.newMinute();
      world.press('tag', { months: '6' });
      assert.ok(world.calls <= 55, `calls ${world.calls}`);
      while (/Keep tagging/.test(text()) && rounds++ < 20) {
        world.newMinute();
        world.press('tag', { months: '6' });
        assert.ok(world.calls <= 55);
      }
    }
  });
  assert.ok(world.notes.every((n) => n.tags.includes('tag:stale')));
});

test('a conflict skips the note and the minute limit does not throw', () => {
  const { world } = setup([{ days: 400 }, { days: 401 }, { days: 402 }, { days: 1, tags: ['tag:stale'] }]);
  withNow(() => world.press('list', { months: '6' }));
  world.touch('note:1');
  withNow(() => world.press('tag', { months: '6' }));
  assert.match(texts(world.panelTree), /1 skipped/);
  const tiny = setup([{ days: 400 }, { days: 401 }], { callsPerMinute: 1 });
  assert.doesNotThrow(() => withNow(() => tiny.world.press('list', { months: '6' })));
});
