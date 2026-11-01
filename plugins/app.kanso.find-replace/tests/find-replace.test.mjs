import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, load, texts, nodes } from './harness.mjs';

const MAIN = new URL('../source/main.js', import.meta.url);

function setup(bodies, extra = {}) {
  const notes = bodies.map((body, i) => ({ id: `note:${i}`, title: `Note ${i}`, body }));
  const world = makeWorld({ notes, ...extra });
  const ctx = load(MAIN, world);
  return { world, ctx };
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const ALPHABET = 'ab c.$\n*x';
function randomText(rand, max = 40) {
  let out = '';
  const n = Math.floor(rand() * max);
  for (let i = 0; i < n; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

test('property: a search with no matches changes nothing', () => {
  const { ctx } = setup([]);
  const rand = rng(3);
  for (let i = 0; i < 300; i++) {
    const text = randomText(rand);
    const m = ctx.buildMatcher('Q#Q', false, true); // the alphabet has no Q or #
    const r = ctx.replaceAll(text, m, 'anything $1 $&');
    assert.equal(r.text, text);
    assert.equal(r.count, 0);
  }
});

test('property: an empty search never matches or changes', () => {
  const { ctx } = setup([]);
  const m = ctx.buildMatcher('', false, true);
  assert.ok(m.error);
  const r = ctx.replaceAll('hello', m, 'x');
  assert.equal(r.text, 'hello');
});

test('property: plain text is literal, whatever the characters', () => {
  const { ctx } = setup([]);
  const rand = rng(11);
  for (let i = 0; i < 300; i++) {
    const needle = randomText(rand, 6) + 'k';
    const hay = randomText(rand) + needle + randomText(rand);
    const m = ctx.buildMatcher(needle, false, true);
    const r = ctx.replaceAll(hay, m, '$&$1');
    assert.equal(r.text.split('$&$1').length - 1, r.count);
    assert.ok(r.count >= 1);
    assert.equal(r.text.split('$&$1').join(needle), hay);
  }
});

test('property: replacing is idempotent when the replacement cannot match', () => {
  const { ctx } = setup([]);
  const rand = rng(5);
  for (let i = 0; i < 300; i++) {
    const text = randomText(rand);
    const m = ctx.buildMatcher('ab', false, true);
    const once = ctx.replaceAll(text, m, 'Z');
    const twice = ctx.replaceAll(once.text, ctx.buildMatcher('ab', false, true), 'Z');
    assert.equal(twice.text, once.text);
    assert.equal(twice.count, 0);
  }
});

test('property: replace then replace back restores the text', () => {
  const { ctx } = setup([]);
  const rand = rng(9);
  for (let i = 0; i < 300; i++) {
    const text = randomText(rand); // has no Q
    const there = ctx.replaceAll(text, ctx.buildMatcher('ab', false, true), 'Q');
    const back = ctx.replaceAll(there.text, ctx.buildMatcher('Q', false, true), 'ab');
    assert.equal(back.text, text);
  }
});

test('case option and regex groups', () => {
  const { ctx } = setup([]);
  assert.equal(ctx.replaceAll('Cat cat CAT', ctx.buildMatcher('cat', false, false), 'dog').text, 'dog dog dog');
  assert.equal(ctx.replaceAll('Cat cat CAT', ctx.buildMatcher('cat', false, true), 'dog').text, 'Cat dog CAT');
  assert.equal(ctx.replaceAll('2024-05-06', ctx.buildMatcher('(\\d+)-(\\d+)-(\\d+)', true, true), '$3/$2/$1').text, '06/05/2024');
  assert.equal(ctx.replaceAll('a.b', ctx.buildMatcher('.', false, true), '-').text, 'a-b');
  assert.equal(ctx.replaceAll('abc', ctx.buildMatcher('x*', true, true), '-').text, 'abc', 'empty matches are left alone');
  assert.ok(ctx.buildMatcher('(', true, true).error);
});

test('preview lists matches per note and does not write', () => {
  const { world } = setup(['one apple', 'no fruit', 'apple apple'], {});
  world.run('find-replace');
  world.press('preview', { find: 'apple', replace: 'pear' });
  assert.match(texts(world.panelTree), /3 matches in 2 notes/);
  assert.equal(world.staged.size, 0);
  assert.ok(world.notes.every((n) => !n.body.includes('pear')));
});

test('apply rewrites the matching notes and respects unticked notes', () => {
  const { world } = setup(['one apple', 'no fruit', 'apple apple']);
  world.press('preview', { find: 'apple', replace: 'pear' });
  const toggles = nodes(world.panelTree).filter((n) => n.type === 'toggle' && n.id.startsWith('inc-'));
  assert.equal(toggles.length, 2);
  // untick the first listed note (the most recently changed first)
  const keep = toggles[0].label.split(' ')[0] + ' ' + toggles[0].label.split(' ')[1];
  world.press('apply', { find: 'apple', replace: 'pear', 'inc-0': false, 'inc-1': true });
  const changed = world.notes.filter((n) => n.body.includes('pear'));
  assert.equal(changed.length, 1);
  assert.ok(!keep.includes(changed[0].title), 'the unticked note stayed');
  assert.match(texts(world.panelTree), /Applied to 1 notes/);
});

test('apply without a matching preview refuses', () => {
  const { world } = setup(['apple']);
  world.press('apply', { find: 'apple', replace: 'pear' });
  assert.match(texts(world.panelTree), /Preview again first/);
  assert.equal(world.notes[0].body, 'apple');
});

test('a note edited after the preview is skipped, not overwritten', () => {
  const { world } = setup(['apple one', 'apple two']);
  world.press('preview', { find: 'apple', replace: 'pear' });
  const real = world.kanso.notes.update;
  world.kanso.notes.update = (id, f, o) => {
    if (id === 'note:0') world.touch(id);
    return real(id, f, o);
  };
  world.press('apply', { find: 'apple', replace: 'pear' });
  assert.equal(world.note('note:0').body, 'apple one');
  assert.equal(world.note('note:1').body, 'pear two');
  assert.match(texts(world.panelTree), /1 skipped/);
});

test('scanning many notes stops under the call budget and resumes', () => {
  const bodies = Array.from({ length: 200 }, (_, i) => (i % 4 === 0 ? `needle ${i}` : `hay ${i}`));
  const { world } = setup(bodies);
  world.press('preview', { find: 'needle', replace: 'pin', narrow: false });
  assert.ok(world.calls <= 55, `calls ${world.calls}`);
  assert.match(texts(world.panelTree), /Keep looking/);
  let rounds = 0;
  while (/Stopped to stay/.test(texts(world.panelTree)) && rounds++ < 40) {
    world.newMinute();
    world.press('more', { find: 'needle', replace: 'pin', narrow: false });
    assert.ok(world.calls <= 55);
  }
  assert.match(texts(world.panelTree), /in 50 notes/);
});

test('narrowing with search reads far fewer notes', () => {
  const bodies = Array.from({ length: 200 }, (_, i) => (i === 7 ? 'needle' : `hay ${i}`));
  const { world } = setup(bodies);
  world.press('preview', { find: 'needle', replace: 'pin' });
  assert.ok(world.totalCalls < 10);
  assert.match(texts(world.panelTree), /in 1 notes/);
});

test('apply splits across presses and finishes', () => {
  const bodies = Array.from({ length: 90 }, (_, i) => `apple ${i}`);
  const { world } = setup(bodies);
  const form = { find: 'apple', replace: 'pear' };
  world.press('preview', form);
  world.newMinute();
  let guard = 0;
  while (world.notes.some((n) => n.body.startsWith('apple')) && guard++ < 20) {
    world.newMinute();
    if (/Keep looking/.test(texts(world.panelTree)) && !/Applied/.test(texts(world.panelTree))) {
      world.press('more', form);
      continue;
    }
    world.press('apply', form);
    assert.ok(world.calls <= 55);
  }
  assert.equal(world.notes.filter((n) => n.body.startsWith("pear")).length, 90);
});

test('hitting the minute limit does not throw out of a press', () => {
  const { world } = setup(Array.from({ length: 40 }, (_, i) => `apple ${i}`), { callsPerMinute: 8 });
  assert.doesNotThrow(() => world.press('preview', { find: 'apple', replace: 'pear', narrow: false }));
});

test('a bad regex is reported', () => {
  const { world } = setup(['x']);
  world.press('preview', { find: '(', replace: '', mode: 'Regular expression' });
  assert.match(texts(world.panelTree), /not a valid pattern/);
  assert.equal(world.totalCalls, 0);
});
