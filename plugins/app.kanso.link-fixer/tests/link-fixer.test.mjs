import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, load, texts, nodes } from './harness.mjs';

const MAIN = new URL('../source/main.js', import.meta.url);

function setup(items, extra = {}) {
  const notes = items.map((it, i) => ({ id: `note:${i}`, title: it[0], body: it[1] ?? '' }));
  const world = makeWorld({ notes, ...extra });
  const ctx = load(MAIN, world);
  return { world, ctx };
}

const plain = (v) => JSON.parse(JSON.stringify(v));

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const WORDS = ['Alpha', ' beta ', 'Gamma Delta', 'x', 'Résumé', 'a b', ''];
function randomDoc(rand) {
  let out = '';
  const n = Math.floor(rand() * 6);
  for (let i = 0; i < n; i++) {
    out += pick(rand, ['text ', '\n', 'more text\n', '`code [[no]]` ', '```\n[[fenced]]\n```\n', '[single] ', '[[ ']);
    const target = pick(rand, WORDS);
    const link =
      (rand() < 0.2 ? '!' : '') +
      '[[' + target + (rand() < 0.3 ? '#Heading' : '') + (rand() < 0.3 ? '|shown as' : '') + ']]';
    out += link;
  }
  return out;
}

test('property: wikilink parsing round-trips', () => {
  const { ctx } = setup([]);
  const rand = rng(21);
  for (let i = 0; i < 500; i++) {
    const doc = randomDoc(rand);
    const links = ctx.parseLinks(doc);
    let rebuilt = '';
    let at = 0;
    for (const l of links) {
      rebuilt += doc.slice(at, l.start) + ctx.serializeLink(l);
      at = l.end;
    }
    rebuilt += doc.slice(at);
    assert.equal(rebuilt, doc);
    for (const l of links) assert.equal(doc.slice(l.start, l.end), ctx.serializeLink(l));
  }
});

test('property: no fixes leaves the text identical, and fixing then fixing back restores it', () => {
  const { ctx } = setup([]);
  const rand = rng(33);
  for (let i = 0; i < 500; i++) {
    const doc = randomDoc(rand);
    assert.equal(ctx.rewriteLinks(doc, {}), doc);
    const fwd = ctx.rewriteLinks(doc, { alpha: 'Zed' });
    const rewritten = ctx.parseLinks(fwd).filter((l) => l.target === 'Zed').length;
    const original = ctx.parseLinks(doc).filter((l) => ctx.norm(l.target) === 'alpha').length;
    assert.equal(rewritten, original);
    // a fix is stable: applying it again changes nothing more
    assert.equal(ctx.rewriteLinks(fwd, { alpha: 'Zed' }), fwd);
  }
});

test('links in code are ignored, aliases and headings are kept', () => {
  const { ctx } = setup([]);
  const doc = 'see [[Foo bar#Part|the foo]] and `[[Code]]`\n```\n[[Fenced]]\n```\n[[Other]]';
  const targets = ctx.parseLinks(doc).map((l) => l.target);
  assert.deepEqual(plain(targets), ['Foo bar', 'Other']);
  assert.equal(
    ctx.rewriteLinks(doc, { 'foo bar': 'Foo Bar' }),
    'see [[Foo Bar#Part|the foo]] and `[[Code]]`\n```\n[[Fenced]]\n```\n[[Other]]',
  );
});

test('brokenLinks respects case, spacing and file embeds', () => {
  const { ctx } = setup([]);
  const known = { 'meeting notes': true };
  const found = ctx.brokenLinks('[[Meeting  Notes]] [[ meeting notes ]] [[Nope]] ![[pic.png]] [[#Here]]', known);
  assert.deepEqual(plain(found.map((l) => l.target)), ['Nope']);
});

test('property: suggestions never include a title twice and the exact-ish title ranks first', () => {
  const { ctx } = setup([]);
  const titles = ['Project plan', 'Meeting notes', 'Reading list', 'Plan for the project', 'Recipes'];
  const s = ctx.suggest('Meeting notess', titles, 3);
  assert.equal(s[0], 'Meeting notes');
  assert.equal(new Set(s).size, s.length);
  assert.deepEqual(plain(ctx.suggest("zzzzqqq", titles, 3)), []);
});

test('property: similarity is symmetric', () => {
  const { ctx } = setup([]);
  const rand = rng(77);
  const letters = 'abcde ';
  const word = () => Array.from({ length: 1 + Math.floor(rand() * 10) }, () => pick(rand, letters)).join('');
  for (let i = 0; i < 300; i++) {
    const a = word();
    const b = word();
    assert.equal(ctx.dice(ctx.bigrams(a), ctx.bigrams(b)), ctx.dice(ctx.bigrams(b), ctx.bigrams(a)));
    assert.equal(ctx.editDistance(a, b), ctx.editDistance(b, a));
  }
});

test('scan finds missing targets, suggests, and fix rewrites only the chosen', () => {
  const { world } = setup([
    ['Meeting notes', 'real'],
    ['Plan', 'see [[Meeting notess]] and [[Meeting notes]] and [[Totally gone]]'],
    ['Other', 'again [[meeting notess|alias]]'],
  ]);
  world.run('link-fixer');
  world.press('scan');
  const selects = nodes(world.panelTree).filter((n) => n.type === 'select');
  assert.equal(selects.length, 2);
  const first = selects.find((s) => /Meeting notess/i.test(s.label));
  assert.match(first.label, /in 2 notes/);
  assert.equal(first.options[1], 'Meeting notes');
  const idx = selects.indexOf(first);
  world.press('fix', { ['fix-' + idx]: 'Meeting notes' });
  assert.equal(world.note('note:1').body, 'see [[Meeting notes]] and [[Meeting notes]] and [[Totally gone]]');
  assert.equal(world.note('note:2').body, 'again [[Meeting notes|alias]]');
  assert.match(texts(world.panelTree), /Fixed 2 notes/);
  // the unchosen one remains listed
  assert.equal(nodes(world.panelTree).filter((n) => n.type === 'select').length, 1);
});

test('choosing nothing writes nothing', () => {
  const { world } = setup([['A', '[[Bee]]'], ['B', '']]);
  world.press('scan');
  world.press('fix', {});
  assert.equal(world.staged.size, 0);
  assert.match(texts(world.panelTree), /Nothing chosen/);
});

test('a big library scans in steps within the call budget', () => {
  const items = Array.from({ length: 120 }, (_, i) => [`Note ${i}`, i % 10 === 0 ? `[[Missing ${i}]]` : `[[Note ${i}]]`]);
  const { world } = setup(items);
  world.press('scan');
  assert.ok(world.calls <= 55, `calls ${world.calls}`);
  let rounds = 0;
  while (/Keep scanning/.test(texts(world.panelTree)) && /Stopped/.test(texts(world.panelTree)) && rounds++ < 30) {
    world.newMinute();
    world.press('more');
    assert.ok(world.calls <= 55);
  }
  assert.match(texts(world.panelTree), /Read 120 notes/);
  assert.equal(nodes(world.panelTree).filter((n) => n.type === 'select').length, 12);
});

test('fixing many notes splits across presses; scanning again catches the rest', () => {
  const items = [['Real', '']].concat(Array.from({ length: 60 }, (_, i) => [`N${i}`, '[[Reel]]']));
  const { world } = setup(items);
  const scanAll = () => {
    world.newMinute();
    world.press('scan');
    let rounds = 0;
    while (/Stopped/.test(texts(world.panelTree)) && rounds++ < 30) {
      world.newMinute();
      world.press('more');
    }
  };
  for (let pass = 0; pass < 5; pass++) {
    scanAll();
    if (!nodes(world.panelTree).some((n) => n.type === 'select')) break;
    if (pass === 0) assert.match(nodes(world.panelTree).map((n) => n.label || '').join(), /\+ notes/);
    world.newMinute();
    world.press('fix', { 'fix-0': 'Real' });
    assert.ok(world.calls <= 55);
    let rounds = 0;
    while (/Keep fixing/.test(texts(world.panelTree)) && rounds++ < 20) {
      world.newMinute();
      world.press('resume');
    }
  }
  assert.ok(world.notes.slice(1).every((n) => n.body === '[[Real]]'));
});

test('a limit error mid-scan does not escape', () => {
  const { world } = setup(Array.from({ length: 50 }, (_, i) => [`N${i}`, '[[x]]']), { callsPerMinute: 6 });
  assert.doesNotThrow(() => world.press('scan'));
  assert.match(texts(world.panelTree), /Stopped/);
});

test('a note changed since the scan is not overwritten', () => {
  const { world } = setup([['A', '[[Bee]]'], ['Bee2', '']]);
  world.press('scan');
  const real = world.kanso.notes.update;
  world.kanso.notes.update = (id, f, o) => {
    world.touch(id);
    return real(id, f, o);
  };
  world.press('fix', { 'fix-0': 'Bee2' });
  assert.equal(world.note('note:0').body, '[[Bee]]');
  assert.match(texts(world.panelTree), /1 skipped/);
});
