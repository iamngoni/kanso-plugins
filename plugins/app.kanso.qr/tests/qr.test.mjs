import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertWellFormed, assertThemeColors, THEMES, rng } from './xml.mjs';

const src = fs.readFileSync(fileURLToPath(new URL('../source/main.js', import.meta.url)), 'utf8');
const renderers = {};
const ctx = { kanso: { fences: { register: (lang, fn) => (renderers[lang] = fn) } } };
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.T = { qrEncode, qrUtf8, qrRsRemainder, qrFormatBits, qrVersionBits, qrCapacity };', ctx);
const T = ctx.T;
// Errors thrown inside the vm context are not instances of this realm's Error.
const isError = (e) => Object.prototype.toString.call(e) === '[object Error]' && typeof e.message === 'string';
const render = (source, theme = THEMES[0]) => renderers.qr({ source, theme });

const digest = (q) => {
  let rows = '';
  for (const row of q.modules) rows += row.map((b) => (b ? '1' : '0')).join('') + '\n';
  return crypto.createHash('sha256').update(rows).digest('hex');
};

test('registers the qr fence', () => {
  assert.deepEqual(Object.keys(renderers), ['qr']);
});

test('Reed-Solomon matches the published 1-M example', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(Array.from(T.qrRsRemainder(data, 10)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('format and version information words', () => {
  assert.equal(T.qrFormatBits(0), 0b101010000010010); // M, mask 0
  assert.equal(T.qrFormatBits(1), 0b101000100100101);
  assert.equal(T.qrFormatBits(2), 0b101111001111100);
  assert.equal(T.qrFormatBits(3), 0b101101101001011);
  assert.equal(T.qrVersionBits(7), 0b000111110010010100);
  assert.equal(T.qrVersionBits(10), 0b001010010011010011);
});

// Matrices below were produced by an independent encoder (node-qrcode)
// forced to byte mode at level M; only their hashes are kept.
const VECTORS = [
  ['hello', 1, 0, '2ba361c2109506ba0b2ae3e9b31586004a4c4d050a6d34ba704e68370a5cf8e1'],
  ['https://kanso.app/plugins?x=1&y=2', 3, 7, '32e03fa47d6e34a6fcbf175b71e6140d0d7f47db1ec217db677436b744823e54'],
  ['héllo ✓ 日本', 2, 4, 'b36fd38fd31510805ddf9e52294c770487514fe60afd9d361c019f4ddafc6bbf'],
  ['abcdefghij'.repeat(6), 4, 2, '6a10b03caee29722cc18d6022bb69a41b2709be606856a1faedf354a28944aab'],
];
for (const [text, version, mask, sha] of VECTORS) {
  test('known vector: ' + JSON.stringify(text.slice(0, 20)), () => {
    const q = T.qrEncode(T.qrUtf8(text));
    assert.equal(q.version, version);
    assert.equal(q.mask, mask);
    assert.equal(digest(q), sha);
  });
}

const LONG = [
  [100, 6, 'ffbc5c46a644aedb6487ed069a69f100b3629ff0bd87ad144ecc99dae0427de5'],
  [130, 8, '117614c50b0e809b87afd8098034b0e19cd18f8eb347be0a3d06018883381d50'],
  [160, 9, 'aa43b2dfb3a67e140ec338fdd1e923b38c25e43f68502901affe5885aee2b1f5'],
  [190, 10, 'b4c797736bb0caeef80e854c7d72389920fa1ca03ec58e55758eb627d31f2d33'],
  [213, 10, 'a23032ec69a5ce8a280f396c72bf58ce07fa8c391e01c9c20b35439da4cbc11c'],
];
for (const [len, version, sha] of LONG) {
  test('known vector: ' + len + ' bytes, version ' + version, () => {
    const s = Array.from({ length: len }, (_, i) => String.fromCharCode(97 + ((i * 7 + len) % 26))).join('');
    const q = T.qrEncode(T.qrUtf8(s));
    assert.equal(q.version, version);
    assert.equal(digest(q), sha);
  });
}

test('capacity steps up through versions 1 to 10', () => {
  const caps = [];
  for (let v = 1; v <= 10; v++) caps.push(T.qrCapacity(v));
  assert.deepEqual(caps, [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  for (let v = 1; v <= 10; v++) {
    assert.equal(T.qrEncode(new Array(caps[v - 1]).fill(65)).version, v);
    if (v < 10) assert.equal(T.qrEncode(new Array(caps[v - 1] + 1).fill(65)).version, v + 1);
  }
});

test('finder patterns and the dark module are in place', () => {
  const q = T.qrEncode(T.qrUtf8('x'));
  assert.equal(q.size, 21);
  for (const [ox, oy] of [[0, 0], [14, 0], [0, 14]]) {
    assert.ok(q.modules[oy][ox] && q.modules[oy + 6][ox + 6] && !q.modules[oy + 1][ox + 1] && q.modules[oy + 3][ox + 3]);
  }
  assert.ok(q.modules[13][8]);
});

test('utf8 encoding', () => {
  assert.deepEqual(Array.from(T.qrUtf8('aé€\u{1F600}')), [97, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);
  assert.deepEqual(Array.from(T.qrUtf8('\ud800')), [0xef, 0xbf, 0xbd]);
});

test('rendering is well formed, uses theme colors, and adapts to dark mode', () => {
  for (const theme of THEMES) {
    const svg = render('https://kanso.app', theme);
    assertWellFormed(svg);
    assertThemeColors(svg, theme);
  }
  const light = render('x', THEMES[0]);
  const dark = render('x', THEMES[1]);
  assert.match(light, /<rect[^>]*fill="#ffffff"/);
  assert.match(dark, /<rect[^>]*fill="#eeeeee"/); // light paper even in dark mode
});

test('errors are clear', () => {
  assert.throws(() => render(''), /Write the text/);
  assert.throws(() => render('\n\n'), /Write the text/);
  assert.throws(() => render('x'.repeat(214)), (e) => isError(e) && /too long.*213/.test(e.message));
});

test('property: random text never throws anything but a clear Error, and the SVG is well formed', () => {
  const rand = rng(42);
  const alphabet = ['a', 'Z', '0', ' ', '<', '>', '&', '"', "'", '\n', 'é', '日', '\u{1F600}', '\ud800', '/'];
  for (let n = 0; n < 150; n++) {
    const len = Math.floor(rand() * (n % 10 === 0 ? 300 : 80));
    let s = '';
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
    try {
      const svg = render(s, THEMES[n % 2]);
      assertWellFormed(svg);
    } catch (e) {
      assert.ok(isError(e) && e.message.length > 10, 'unclear failure: ' + e);
      assert.match(e.message, /too long|Write the text/);
    }
  }
});

test('property: text never appears in the SVG, so nothing in it needs escaping', () => {
  const svg = render('<script>alert("x")</script>&');
  assert.ok(!svg.includes('script') && !svg.includes('alert'));
  assertWellFormed(svg);
});

test('property: every matrix has exactly the version size and a stable result', () => {
  const rand = rng(7);
  for (let n = 0; n < 40; n++) {
    const bytes = Array.from({ length: 1 + Math.floor(rand() * 213) }, () => Math.floor(rand() * 256));
    const a = T.qrEncode(bytes);
    const b = T.qrEncode(bytes);
    assert.equal(a.modules.length, a.version * 4 + 17);
    assert.ok(a.modules.every((r) => r.length === a.size));
    assert.equal(digest(a), digest(b));
  }
});
