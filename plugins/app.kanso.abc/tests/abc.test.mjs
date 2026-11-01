import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { assertWellFormed, assertThemeColors, THEMES, rng } from './xml.mjs';

const src = fs.readFileSync(fileURLToPath(new URL('../source/main.js', import.meta.url)), 'utf8');
const renderers = {};
const ctx = { kanso: { fences: { register: (lang, fn) => (renderers[lang] = fn) } } };
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.T = { abcParse, abcKey, abcShape };', ctx);
const T = ctx.T;
const isError = (e) => Object.prototype.toString.call(e) === '[object Error]' && typeof e.message === 'string';
const abc = (source, theme = THEMES[0]) => renderers.abc({ source, theme });
const H = 'X:1\nM:4/4\nL:1/8\nK:C\n';
const notes = (body) => T.abcParse(H + body).events.filter((e) => e.type !== 'bar');

test('registers the abc fence', () => {
  assert.deepEqual(Object.keys(renderers), ['abc']);
});

test('pitches: letters, octave marks, and steps', () => {
  const p = (s) => notes(s)[0].pitches[0];
  assert.equal(p('C').oct, 4);
  assert.equal(p('c').oct, 5);
  assert.equal(p("c'").oct, 6);
  assert.equal(p('C,').oct, 3);
  assert.equal(p("c''").oct, 7);
  assert.equal(p('E').step, 4 * 7 + 2);
  assert.equal(p('B').step - p('C').step, 6);
  assert.equal(p('^F').acc, '^');
  assert.equal(p('__B').acc, '__');
  assert.equal(p('=A').acc, '=');
});

test('lengths with L:1/8', () => {
  const w = (s) => notes(s)[0].whole;
  assert.equal(w('C'), 1 / 8);
  assert.equal(w('C2'), 1 / 4);
  assert.equal(w('C4'), 1 / 2);
  assert.equal(w('C8'), 1);
  assert.equal(w('C/'), 1 / 16);
  assert.equal(w('C//'), 1 / 32);
  assert.equal(w('C3/2'), 3 / 16);
  assert.equal(w('C/4'), 1 / 32);
});

test('unit note length defaults from the meter, and L overrides', () => {
  assert.equal(T.abcParse('M:2/4\nK:C\nC').events[0].whole, 1 / 16);
  assert.equal(T.abcParse('M:6/8\nK:C\nC').events[0].whole, 1 / 8);
  assert.equal(T.abcParse('K:C\nC').events[0].whole, 1 / 8);
  assert.equal(T.abcParse('L:1/4\nK:C\nC').events[0].whole, 1 / 4);
});

test('rests, ties, chords, broken rhythm', () => {
  const ev = notes('z2 C-C [CEG]2 A>B c<d');
  assert.equal(ev[0].type, 'rest');
  assert.equal(ev[0].whole, 1 / 4);
  assert.ok(ev[1].tie && !ev[2].tie);
  assert.equal(ev[3].pitches.length, 3);
  assert.equal(ev[3].whole, 1 / 4);
  assert.equal(ev[4].whole, (1 / 8) * 1.5);
  assert.equal(ev[5].whole, (1 / 8) * 0.5);
  assert.equal(ev[6].whole, (1 / 8) * 0.5);
  assert.equal(ev[7].whole, (1 / 8) * 1.5);
});

test('bars', () => {
  const kinds = T.abcParse(H + '|: C | C || C :| C |] C ::').events.filter((e) => e.type === 'bar').map((e) => e.kind);
  assert.deepEqual(Array.from(kinds), ['start', 'single', 'double', 'end', 'final', 'both']);
  assert.equal(T.abcParse(H + 'C |1 D :|2 E |]').events.length, 6);
});

test('keys', () => {
  const k = (s) => T.abcKey(s);
  assert.equal(k('C'), 0);
  assert.equal(k('G'), 1);
  assert.equal(k('D'), 2);
  assert.equal(k('F'), -1);
  assert.equal(k('Bb'), -2);
  assert.equal(k('F#'), 6);
  assert.equal(k('Am'), 0);
  assert.equal(k('Em'), 1);
  assert.equal(k('F#m'), 3);
  assert.equal(k('A minor'), 0);
  assert.equal(k('D dor'), 0);
  assert.equal(k('G mix'), 0);
  assert.equal(k('C lyd'), 1);
  assert.equal(k(''), 0);
  assert.throws(() => k('H'), /not a key/);
  assert.throws(() => k('C xyz'), /unknown mode/);
  assert.throws(() => k('G# major'), /more than 7/);
});

test('shapes', () => {
  assert.deepEqual({ ...T.abcShape(1) }, { hollow: true, stem: false, flags: 0, dots: 0 });
  assert.equal(T.abcShape(0.5).hollow, true);
  assert.equal(T.abcShape(0.25).hollow, false);
  assert.equal(T.abcShape(0.125).flags, 1);
  assert.equal(T.abcShape(1 / 16).flags, 2);
  assert.equal(T.abcShape(0.375).dots, 1);
});

test('headers, comments, decorations, chord symbols and tuplets are accepted', () => {
  const svg = abc('X:1\nT:A <tune> & "co"\nC:Anon\nM:C\nL:1/4\nQ:1/4=96\nK:G % key\nw: la la\n"Am" !fermata! (3CDE .F ~G | z4 |]');
  assertWellFormed(svg);
  assert.ok(svg.includes('A &lt;tune&gt; &amp; &quot;co&quot;'));
  assert.ok(svg.includes('1/4=96'));
});

test('rendering draws staff lines, notes, ledger lines, ties and wraps into systems', () => {
  const one = abc(H + 'C D E F | G A B c |]');
  assertWellFormed(one);
  assert.ok((one.match(/<ellipse/g) || []).length === 8);
  assert.ok((abc(H + 'C,,').match(/<line/g) || []).length > (abc(H + 'E').match(/<line/g) || []).length);
  assert.ok(abc(H + 'C-C').includes(' Q'));
  const long = abc(H + 'C D E F G A B c |'.repeat(12));
  assert.ok(Number(/height="(\d+)"/.exec(long)[1]) > Number(/height="(\d+)"/.exec(one)[1]));
  assertWellFormed(long);
});

test('themes: only theme colors', () => {
  for (const theme of THEMES) {
    const svg = abc(H + '|: ^C _D =E [CEG]2 z4 :|\nc4 B- B2 |]', theme);
    assertWellFormed(svg);
    assertThemeColors(svg, theme);
  }
});

test('errors name the problem', () => {
  const bad = [
    ['', /key line/],
    ['X:1\nK:C', /no notes/],
    ['X:1\nT:x\nC D E', /header fields come first/],
    ['X:1\nL:1/0\nK:C\nC', /fraction/],
    ['X:1\nM:3-4\nK:C\nC', /fraction/],
    ['K:C\nC $ D', /"\$" is not supported/],
    ['K:C\n^', /expected a note letter/],
    ['K:C\n^^^C', /odd accidental/],
    ['K:C\n-C', /needs a note before/],
    ['K:C\n>C', /needs a note before/],
    ['K:C\n[CE', /not closed/],
    ['K:C\n"Am C', /not closed/],
    ['K:C\n!x C', /not closed/],
    ["K:C\nc''''''''", /off the staff/],
    ['K:C\nC0', /out of range/],
    ['K:H\nC', /not a key/],
    ['K:C\n' + 'C '.repeat(700), /Too many notes/],
    ['X:one\nK:C\nC', /tune number/],
  ];
  for (const [s, re] of bad) assert.throws(() => abc(s), (e) => isError(e) && re.test(e.message), JSON.stringify(s.slice(0, 30)));
});

test('property: random ABC is a clear Error or a well-formed staff', () => {
  const rand = rng(555);
  const bits = ['C', 'D', 'e', 'g', 'A,', "b'", '^', '_', '=', '2', '3/2', '/', '//', 'z', 'z4', '|', '||', '|]', '|:', ':|', '::', '-', '[CEG]', '[', ']', '>', '<', '(3', '(', ')', ' ', ' ', ' ', '"Am"', '!f!', '\n', '%c\n', 'T:t<&\n', 'M:3/4\n', 'L:1/16\n', 'K:D\n', 'K:Bbm\n', 'Q:1/4=90\n', '$', '0', '9'];
  for (let n = 0; n < 700; n++) {
    let s = n % 4 === 0 ? '' : 'X:1\nK:G\n';
    const len = Math.floor(rand() * 60);
    for (let i = 0; i < len; i++) s += bits[Math.floor(rand() * bits.length)];
    try {
      const svg = abc(s, THEMES[n % 2]);
      assertWellFormed(svg);
      assertThemeColors(svg, THEMES[n % 2]);
    } catch (e) {
      assert.ok(isError(e) && e.name === 'Error' && e.message.length > 10, 'unclear failure for ' + JSON.stringify(s) + ': ' + e);
    }
  }
});

test('property: random valid tunes draw one note head per pitch', () => {
  const rand = rng(11);
  for (let n = 0; n < 80; n++) {
    let body = '';
    let heads = 0;
    const count = 1 + Math.floor(rand() * 40);
    for (let i = 0; i < count; i++) {
      const r = rand();
      if (r < 0.15) body += 'z' + (1 + Math.floor(rand() * 4)) + ' ';
      else if (r < 0.25) body += '| ';
      else if (r < 0.35) {
        body += '[' + 'CEG' + ']' + (1 + Math.floor(rand() * 4)) + ' ';
        heads += 3;
      } else {
        body += ['', '^', '_', '='][Math.floor(rand() * 4)] + 'ABCDEFGabcdefg'[Math.floor(rand() * 14)] + [',', '', "'"][Math.floor(rand() * 3)] + (1 + Math.floor(rand() * 8)) + ' ';
        heads++;
      }
    }
    if (heads === 0) continue;
    const svg = abc('M:4/4\nK:' + ['C', 'G', 'Eb', 'F#m'][n % 4] + '\n' + body);
    assertWellFormed(svg);
    assert.equal((svg.match(/<ellipse/g) || []).length, heads, body);
  }
});

test('property: title and composer text is escaped', () => {
  const rand = rng(9);
  const chars = ['a', '<', '>', '&', '"', "'", ' '];
  for (let n = 0; n < 100; n++) {
    let t = 'x';
    for (let i = 0; i < 12; i++) t += chars[Math.floor(rand() * chars.length)];
    assertWellFormed(abc('T:' + t + '\nC:' + t + '\nK:C\nC'));
  }
});
