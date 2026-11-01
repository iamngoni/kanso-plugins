import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const commands = new Map();
let selection = null;
globalThis.kanso = {
  commands: { register: (c) => commands.set(c.id, c) },
  editor: { selection: () => selection },
};
const T = createRequire(import.meta.url)(path.join(here, '../source/main.js'));

function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const PIECES = ['word', 'Hello', "don't", 'well-known', '3.14', 'é', 'Ünï', '日本語', 'かな', '😀', '.', '!', '?', '...', '。', '"', ')', ' ', ' ', ' ', '\n', '\r\n', '\t', ' ', '-', '_', '1,000', 'é'];
function random(rand, max = 40) {
  let s = '';
  const n = Math.floor(rand() * max);
  for (let i = 0; i < n; i += 1) s += PIECES[Math.floor(rand() * PIECES.length)];
  return s;
}

test('counts', () => {
  const s = T.stats("Hello, world! It's 3.14 pm.\nA well-known fact?\n");
  assert.equal(s.words, 8);
  assert.equal(s.sentences, 3);
  assert.equal(s.lines, 2);
  assert.equal(s.characters, 47);
  assert.equal(T.countWords('日本語のテスト'), 7);
  assert.equal(T.countWords('日本語 and text'), 5);
  assert.equal(T.countWords('😀 ... !!'), 0);
  assert.equal(T.countSentences('No ending here'), 1);
  assert.equal(T.countSentences('Wait... what? Yes.'), 3);
  assert.deepEqual(T.countLines('a\n\nb'), T.countLines('a\r\n\r\nb'));
  assert.deepEqual(T.countLines('a\n\nb'), { lines: 3, nonEmpty: 2 });
  assert.equal(T.readingTime(0), '0 min');
  assert.equal(T.readingTime(115), '30 sec');
  assert.equal(T.readingTime(2300), '10 min');
});

test('property: never throws, counts are consistent', () => {
  const rand = rng(5);
  for (let i = 0; i < 2000; i += 1) {
    const text = random(rand);
    const s = T.stats(text);
    for (const k of ['words', 'characters', 'charactersNoSpaces', 'lines', 'nonEmptyLines', 'sentences']) {
      assert.ok(Number.isInteger(s[k]) && s[k] >= 0, k);
    }
    assert.ok(s.charactersNoSpaces <= s.characters);
    assert.ok(s.nonEmptyLines <= s.lines);
    assert.ok(s.sentences <= s.words);
    assert.ok(s.words <= s.characters);
    assert.equal(s.characters, Array.from(text).length);
    // Adding blank space changes no word or sentence count.
    const padded = T.stats(`  \n${text}\n  `);
    assert.equal(padded.words, s.words);
    assert.equal(padded.sentences, s.sentences);
    // Two copies give twice the words.
    assert.equal(T.countWords(`${text}\n${text}`), 2 * s.words);
    assert.equal(typeof T.describe(s), 'string');
  }
});

test('command', () => {
  const run = (sel) => { selection = sel; return commands.get('stats').run({}); };
  assert.match(run(null).text, /Select/);
  assert.match(run({ text: '', start: 0, end: 0 }).text, /Select/);
  const r = run({ text: 'One two. Three!', start: 3, end: 18 });
  assert.match(r.text, /^3 words\n15 characters/);
  assert.match(r.text, /2 sentences/);
  assert.equal(commands.get('stats').when, 'selection');
});
