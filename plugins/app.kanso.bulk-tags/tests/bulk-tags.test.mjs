import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, load, texts } from './harness.mjs';

const MAIN = new URL('../source/main.js', import.meta.url);
const TAGS = { 'tag:a': 'alpha', 'tag:b': 'beta', 'tag:c': 'gamma' };

function setup(count, tagsFor = () => ['tag:a'], extra = {}) {
  const notes = [];
  for (let i = 0; i < count; i++) notes.push({ id: `note:${i}`, title: `Note ${i}`, tags: tagsFor(i) });
  const world = makeWorld({ notes, tags: TAGS, ...extra });
  const ctx = load(MAIN, world);
  return { world, ctx };
}

// Small deterministic generator for the property-style checks.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const IDS = ['tag:a', 'tag:b', 'tag:c', 'tag:d'];
function randomTags(rand) {
  return IDS.filter(() => rand() < 0.5);
}

test('retag: adding twice equals adding once, for any tag list', () => {
  const { ctx } = setup(0);
  const rand = rng(1);
  for (let i = 0; i < 300; i++) {
    const tags = randomTags(rand);
    const from = IDS[Math.floor(rand() * 4)];
    const to = IDS[Math.floor(rand() * 4)];
    for (const action of ['add', 'remove', 'rename']) {
      const once = ctx.retag(tags, action, from, to);
      assert.deepEqual(ctx.retag(once, action, from, to), once, `${action} ${tags} ${from} ${to}`);
    }
  }
});

test('retag: remove drops the tag, rename moves it, add never duplicates', () => {
  const { ctx } = setup(0);
  assert.deepEqual(ctx.retag(['tag:a', 'tag:b'], 'remove', 'tag:a', null), ['tag:b']);
  assert.deepEqual(ctx.retag(['tag:a', 'tag:b'], 'rename', 'tag:a', 'tag:c'), ['tag:b', 'tag:c']);
  assert.deepEqual(ctx.retag(['tag:b'], 'rename', 'tag:a', 'tag:c'), ['tag:b']);
  assert.deepEqual(ctx.retag(['tag:a'], 'add', null, 'tag:a'), ['tag:a']);
  assert.deepEqual(ctx.retag(['tag:a', 'tag:c'], 'rename', 'tag:a', 'tag:c'), ['tag:c']);
});

test('retag: an op that matches nothing leaves the list alone', () => {
  const { ctx } = setup(0);
  const rand = rng(7);
  for (let i = 0; i < 200; i++) {
    const tags = randomTags(rand).filter((t) => t !== 'tag:d');
    assert.deepEqual(ctx.retag(tags, 'remove', 'tag:d', null), tags);
    assert.deepEqual(ctx.retag(tags, 'rename', 'tag:d', 'tag:a'), tags);
  }
});

test('cleanTag strips hashes and space', () => {
  const { ctx } = setup(0);
  assert.equal(ctx.cleanTag('  ##Work '), 'Work');
  assert.equal(ctx.cleanTag(null), '');
});

test('removing a tag stages one update per carrying note and nothing else', () => {
  const { world } = setup(5, (i) => (i % 2 ? ['tag:a', 'tag:b'] : ['tag:b']));
  world.run('bulk-tags');
  world.press('run', { action: 'Remove a tag', tag: '#alpha' });
  const withAlpha = world.notes.filter((n) => n.tags.includes('tag:a'));
  assert.equal(withAlpha.length, 0);
  assert.ok(world.notes.every((n) => n.tags.includes('tag:b')));
  assert.match(texts(world.panelTree), /changed 2/);
});

test('rename works when the new tag exists, and is idempotent', () => {
  const { world } = setup(4, (i) => (i === 0 ? ['tag:b'] : ['tag:a']));
  world.press('run', { action: 'Rename a tag', tag: 'alpha', to: 'beta' });
  assert.ok(world.notes.every((n) => n.tags.join() === 'tag:b'));
  const before = JSON.stringify(world.notes);
  world.press('run', { action: 'Rename a tag', tag: 'alpha', to: 'beta' });
  assert.equal(JSON.stringify(world.notes), before);
  assert.match(texts(world.panelTree), /No note you've allowed has a tag called alpha/);
});

test('add skips notes that already have the tag and narrows by a second tag', () => {
  const { world } = setup(6, (i) => (i < 3 ? ['tag:a'] : ['tag:b']));
  world.press('run', { action: 'Add a tag', tag: 'gamma', scope: 'alpha' });
  // gamma is on no note, so it cannot be resolved
  assert.match(texts(world.panelTree), /no tag called gamma/);
  const w2 = setup(6, (i) => (i === 5 ? ['tag:b', 'tag:c'] : i < 3 ? ['tag:a'] : ['tag:b']));
  w2.world.press('run', { action: 'Add a tag', tag: 'gamma', scope: 'alpha' });
  const withC = w2.world.notes.filter((n) => n.tags.includes('tag:c')).map((n) => n.id);
  assert.deepEqual(withC.sort(), ['note:0', 'note:1', 'note:2', 'note:5']);
});

test('a conflict is counted, not fatal', () => {
  const { world } = setup(3);
  // the second note changes between the list and the update
  const real = world.kanso.notes.update;
  world.kanso.notes.update = (id, f, o) => {
    if (id === 'note:1') world.touch(id);
    return real(id, f, o);
  };
  world.press('run', { action: 'Remove a tag', tag: 'alpha' });
  assert.match(texts(world.panelTree), /1 could not be changed/);
});

test('stays inside the call budget and Continue finishes the job', () => {
  const { world } = setup(300, () => ['tag:a', 'tag:b']);
  world.press('run', { action: 'Remove a tag', tag: 'alpha' });
  assert.ok(world.calls <= 55, `used ${world.calls} calls`);
  assert.match(texts(world.panelTree), /Check the changes, then press Continue/);
  let rounds = 0;
  while (world.notes.some((n) => n.tags.includes('tag:a')) && rounds++ < 20) {
    world.newMinute();
    world.press('continue', { action: 'Remove a tag', tag: 'alpha' });
    assert.ok(world.calls <= 55);
  }
  assert.equal(world.notes.filter((n) => n.tags.includes('tag:a')).length, 0);
  assert.match(texts(world.panelTree), /Done|No note/);
});

test('add continues from where it stopped without repeating work', () => {
  const { world } = setup(120, (i) => (i === 0 ? ['tag:b', 'tag:c'] : ['tag:b']));
  world.press('run', { action: 'Add a tag', tag: 'gamma' });
  const firstCalls = world.totalCalls;
  assert.ok(firstCalls <= 55);
  let rounds = 0;
  while (/Continue/.test(texts(world.panelTree)) && rounds++ < 20) {
    world.newMinute();
    world.press('continue', { action: 'Add a tag', tag: 'gamma' });
  }
  assert.ok(world.notes.every((n) => n.tags.includes('tag:c')));
});

test('hitting the per-minute limit mid-run stops cleanly', () => {
  const { world } = setup(100, () => ['tag:a'], { callsPerMinute: 10 });
  assert.doesNotThrow(() => world.press('run', { action: 'Remove a tag', tag: 'alpha' }));
  assert.match(texts(world.panelTree), /Stopped here/);
});

test('a missing tag name is asked for, not guessed', () => {
  const { world } = setup(2);
  world.press('run', { action: 'Add a tag', tag: '' });
  assert.match(texts(world.panelTree), /Type the tag/);
  assert.equal(world.totalCalls, 0);
});
