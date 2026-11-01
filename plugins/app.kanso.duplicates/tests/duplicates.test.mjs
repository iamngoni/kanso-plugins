import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, load, texts } from './harness.mjs';

const MAIN = new URL('../source/main.js', import.meta.url);
const plain = (v) => JSON.parse(JSON.stringify(v));

function setup(items, extra = {}) {
  const notes = items.map((it, i) => ({ id: `note:${i}`, title: it[0], body: it[1] ?? '' }));
  const world = makeWorld({ notes, ...extra });
  return { world, ctx: load(MAIN, world) };
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const VOCAB = 'the cat sat on a mat with red hat and big dog under old tree'.split(' ');
function randomText(rand, n = 40) {
  return Array.from({ length: Math.floor(rand() * n) + 3 }, () => VOCAB[Math.floor(rand() * VOCAB.length)]).join(' ');
}

test('property: Jaccard is symmetric and bounded; a text matches itself', () => {
  const { ctx } = setup([]);
  const rand = rng(4);
  for (let i = 0; i < 200; i++) {
    const a = ctx.shingles(randomText(rand));
    const b = ctx.shingles(randomText(rand));
    assert.equal(ctx.jaccard(a, b), ctx.jaccard(b, a));
    assert.ok(ctx.jaccard(a, b) >= 0 && ctx.jaccard(a, b) <= 1);
    assert.equal(ctx.jaccard(a, a), 1);
  }
});

test('property: sketch similarity is symmetric, 1 for equal text, close to Jaccard', () => {
  const { ctx } = setup([]);
  const rand = rng(8);
  let worst = 0;
  for (let i = 0; i < 100; i++) {
    const t1 = randomText(rand, 80);
    const t2 = rand() < 0.5 ? t1 + ' ' + randomText(rand, 8) : randomText(rand, 80);
    const a = plain(ctx.sketch(t1));
    const b = plain(ctx.sketch(t2));
    assert.equal(ctx.sketchSimilarity(a, b), ctx.sketchSimilarity(b, a));
    assert.equal(ctx.sketchSimilarity(a, a), 1);
    worst = Math.max(worst, Math.abs(ctx.sketchSimilarity(a, b) - ctx.jaccard(ctx.shingles(t1), ctx.shingles(t2))));
  }
  assert.ok(worst < 0.5, `worst error ${worst}`);
});

test('property: the duplicate finder is symmetric in the order of notes', () => {
  const { ctx } = setup([]);
  const rand = rng(15);
  for (let round = 0; round < 40; round++) {
    const base = randomText(rand, 60);
    const items = [];
    for (let i = 0; i < 8; i++) {
      const body = rand() < 0.4 ? base : randomText(rand, 60);
      items.push({ id: `n${i}`, title: rand() < 0.3 ? 'Same Title' : `T${i}`, sig: plain(ctx.sketch(body)) });
    }
    const forward = plain(ctx.findPairs(items, 0.7));
    const reversed = plain(ctx.findPairs([...items].reverse(), 0.7));
    assert.deepEqual(forward, reversed);
    for (const p of forward) assert.ok(p.a < p.b);
  }
});

test('titles: case, punctuation, copy and (2) suffixes are the same title', () => {
  const { ctx } = setup([]);
  const n = ctx.normTitle;
  assert.equal(n('Meeting Notes!'), n('meeting notes'));
  assert.equal(n('Meeting notes copy'), n('meeting notes'));
  assert.equal(n('Meeting notes 2'), n('meeting notes'));
  assert.notEqual(n('Meeting notes'), n('Meeting agenda'));
});

test('scan finds same-title and same-body pairs, and not unrelated notes', () => {
  const para = 'the quick brown fox jumps over the lazy dog near the quiet river bank today';
  const { world } = setup([
    ['Groceries', 'milk eggs bread'],
    ['Groceries copy', 'something else entirely'],
    ['Fox story', para],
    ['Other title', para + ' again'],
    ['Unrelated', 'completely different words here about space travel and planets in orbit'],
  ]);
  world.run('find-duplicates');
  world.press('scan', { level: 'Close (70%)' });
  const t = texts(world.panelTree);
  assert.match(t, /Groceries.*Groceries copy|Groceries copy.*Groceries/);
  assert.match(t, /Fox story.*Other title|Other title.*Fox story/);
  assert.doesNotMatch(t, /Unrelated  and|and  Unrelated/);
  assert.match(t, /same title/);
});

test('stays inside the call budget, resumes, and does not write', () => {
  const items = Array.from({ length: 150 }, (_, i) => [`Note ${i}`, `body number ${i} with some words ${i % 7}`]);
  const { world } = setup(items);
  world.press('scan', {});
  assert.ok(world.calls <= 55, `calls ${world.calls}`);
  let rounds = 0;
  while (/Keep scanning/.test(texts(world.panelTree)) && /Stopped/.test(texts(world.panelTree)) && rounds++ < 30) {
    world.newMinute();
    world.press('more', {});
    assert.ok(world.calls <= 55);
  }
  assert.match(texts(world.panelTree), /read the text of 150/);
  assert.equal(world.staged.size, 0);
});

test('a minute limit mid-scan does not throw', () => {
  const { world } = setup(Array.from({ length: 30 }, (_, i) => [`N${i}`, 'text ' + i]), { callsPerMinute: 5 });
  assert.doesNotThrow(() => world.press('scan', {}));
});
