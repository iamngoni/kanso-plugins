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
vm.runInContext(src + '\n;globalThis.T = { calcParseTable, calcEvaluate, calcShown, calcFormat };', ctx);
const T = ctx.T;
const isError = (e) => Object.prototype.toString.call(e) === '[object Error]' && typeof e.message === 'string';
const render = (source, theme = THEMES[0]) => renderers.calc({ source, theme });

// Evaluates a table and returns what each cell shows.
function shown(source) {
  const table = T.calcParseTable(source);
  const grid = T.calcEvaluate(table);
  return grid.map((line, r) => line.map((res, c) => T.calcShown(res, table.rows[r][c])));
}
// One formula in B2, with data in A2 (=10) and A3 (=4).
const one = (formula) => shown(`| x | y |\n|---|---|\n| 10 | ${formula} |\n| 4 | 2 |`)[1][1];

test('registers the calc fence', () => {
  assert.deepEqual(Object.keys(renderers), ['calc']);
});

test('SUM over a range, as in the docs', () => {
  const out = shown('| Item | Price |\n|---|---:|\n| Tea | 3 |\n| Cake | 4.5 |\n| Jam | 2.25 |\n| Total | =SUM(B2:B4) |');
  assert.equal(out[4][1], '9.75');
  assert.equal(out[0][0], 'Item');
});

test('arithmetic and precedence', () => {
  assert.equal(one('=A2*2'), '20');
  assert.equal(one('=1+2*3'), '7');
  assert.equal(one('=(1+2)*3'), '9');
  assert.equal(one('=2^3^2'), '512');
  assert.equal(one('=-2^2'), '-4');
  assert.equal(one('=2^-1'), '0.5');
  assert.equal(one('=10/4'), '2.5');
  assert.equal(one('=50%'), '0.5');
  assert.equal(one('=0.1+0.2'), '0.3');
  assert.equal(one('=1e3+1'), '1,001');
  assert.equal(one('=A2-A3'), '6');
});

test('functions', () => {
  assert.equal(one('=SUM(A2:A3)'), '14');
  assert.equal(one('=SUM(A2, A3, 6)'), '20');
  assert.equal(one('=AVERAGE(A2:A3)'), '7');
  assert.equal(one('=avg(A2:A3)'), '7');
  assert.equal(one('=MIN(A2:A3)'), '4');
  assert.equal(one('=MAX(A2:A3, 99)'), '99');
  assert.equal(one('=COUNT(A1:A3)'), '2'); // the text in A1 is skipped
  assert.equal(one('=PRODUCT(A2:A3)'), '40');
  assert.equal(one('=ABS(-3)'), '3');
  assert.equal(one('=SQRT(16)'), '4');
  assert.equal(one('=POW(2,10)'), '1,024');
  assert.equal(one('=ROUND(2.567, 1)'), '2.6');
  assert.equal(one('=ROUND(1234, -2)'), '1,200');
  assert.equal(one('=FLOOR(2.9)'), '2');
  assert.equal(one('=CEIL(2.1)'), '3');
});

test('references chain and ranges skip text and blanks', () => {
  const out = shown('| a | b | c |\n|---|---|---|\n| 1 | =A2+1 | =B2*2 |\n| x |  | =SUM(A2:C2) |');
  assert.deepEqual(Array.from(out[1]), ['1', '2', '4']);
  assert.equal(out[2][2], '7');
});

test('errors show as spreadsheet codes and stay in their cell', () => {
  assert.equal(one('=1/0'), '#DIV/0!');
  assert.equal(one('=A1+1'), '#VALUE!'); // A1 is the text "x"
  assert.equal(one('=FOO(1)'), '#NAME?');
  assert.equal(one('=ZZ1'), '#NAME?');
  assert.equal(one('=A99'), '#REF!');
  assert.equal(one('=A0'), '#REF!');
  assert.equal(one('=SQRT(-1)'), '#NUM!');
  assert.equal(one('=1+'), '#ERR!');
  assert.equal(one('=(1'), '#ERR!');
  assert.equal(one('=1 2'), '#ERR!');
  assert.equal(one('=2 $ 3'), '#ERR!');
  assert.equal(one('=A2:A3'), '#VALUE!');
  assert.equal(one('=ABS(1,2)'), '#ERR!');
  assert.equal(one('=10^1000'), '#NUM!');
  assert.equal(one('=AVERAGE(A1:A1)'), '#DIV/0!');
  assert.equal(one('=SUM(A2:A9)'), '#REF!');
});

test('cycles are detected, and cells outside them still compute', () => {
  const out = shown('| a | b |\n|---|---|\n| =B2 | =A2 |\n| =A2 | 5 |');
  assert.equal(out[1][0], '#CYCLE!');
  assert.equal(out[1][1], '#CYCLE!');
  assert.equal(out[2][0], '#CYCLE!');
  assert.equal(out[2][1], '5');
  assert.equal(shown('| a |\n|---|\n| =A2 |')[1][0], '#CYCLE!');
});

test('table parsing: edges, escapes, alignment, ragged rows', () => {
  const t = T.calcParseTable('a | b\n:--|--:\n1 | 2 | 3\nx |');
  assert.equal(t.header, true);
  assert.equal(t.rows[0].length, 3);
  assert.deepEqual(Array.from(t.align), ['l', 'r', 'l']);
  assert.equal(T.calcParseTable('| a \\| b | c |').rows[0][0], 'a | b');
  assert.equal(T.calcParseTable('| 1 | 2 |').header, false);
});

test('deep dependency chains fail clearly or compute, never crash', () => {
  let s = '| a |\n|---|\n| 1 |\n';
  for (let i = 3; i <= 100; i++) s += `| =A${i - 1}+1 |\n`;
  assert.equal(shown(s)[99][0], '99');
  assert.doesNotThrow(() => render(s));
});

test('limits give clear errors', () => {
  assert.throws(() => render(''), (e) => isError(e) && /pipe table/.test(e.message));
  assert.throws(() => render('just words'), (e) => isError(e) && /not a table row/.test(e.message));
  assert.throws(() => render('|' + 'a|'.repeat(27)), (e) => isError(e) && /columns/.test(e.message));
  assert.throws(() => render('|a|\n'.repeat(101)), (e) => isError(e) && /rows/.test(e.message));
});

test('rendering: well formed, theme colors only, text escaped', () => {
  const md = '| <b>"x" | y & z |\n|:--:|--:|\n| <script> | =1+1 |\n| =1/0 | \'q\' |';
  for (const theme of THEMES) {
    const svg = render(md, theme);
    assertWellFormed(svg);
    assertThemeColors(svg, theme);
    assert.ok(!svg.includes('<script>') && !svg.includes('<b>'));
    assert.ok(svg.includes('&lt;script&gt;') && svg.includes('y &amp; z') && svg.includes('&quot;x&quot;'));
    assert.ok(svg.includes('#DIV/0!'));
  }
});

test('a formula is never evaluated as code', () => {
  const out = shown('| a |\n|---|\n| =constructor |\n| =this |\n| =process.exit() |\n| =globalThis |');
  assert.ok(out.slice(1).every((r) => /^#/.test(r[0])));
});

test('number formatting', () => {
  assert.equal(T.calcFormat(1234567.891), '1,234,567.891');
  assert.equal(T.calcFormat(-0), '0');
  assert.equal(T.calcFormat(1 / 3), '0.333333333333');
  assert.equal(T.calcFormat(1e21), '1e+21');
});

test('property: random tables never throw anything but a clear Error, and the SVG is well formed', () => {
  const rand = rng(1234);
  const bits = ['=', 'SUM(', 'AVG(', ')', 'A1', 'B2', 'C3', 'A1:B2', ':', '+', '-', '*', '/', '^', '%', ',', '(', '1', '2.5', '0', ' ', 'x', '<', '&', '"', '$', 'é', '1e999', 'ROUND(', 'Z9', '|', '|', '|', '\n', ':--', '---'];
  for (let n = 0; n < 400; n++) {
    let s = '';
    const len = Math.floor(rand() * 60);
    for (let i = 0; i < len; i++) s += bits[Math.floor(rand() * bits.length)];
    try {
      const svg = render(s, THEMES[n % 2]);
      assertWellFormed(svg);
      assertThemeColors(svg, THEMES[n % 2]);
    } catch (e) {
      assert.ok(isError(e) && e.message.length > 10 && e.name === 'Error', 'unclear failure for ' + JSON.stringify(s) + ': ' + e);
    }
  }
});

test('property: formulas built from a grammar always evaluate to a number or a code', () => {
  const rand = rng(99);
  const atom = () => ['1', '2.5', '0', 'A2', 'B2', 'C3', 'SUM(A2:B3)', 'MAX(A2:C3)', '(' + '3' + ')'][Math.floor(rand() * 9)];
  const expr = (d) => (d <= 0 || rand() < 0.3 ? atom() : '(' + expr(d - 1) + ['+', '-', '*', '/', '^'][Math.floor(rand() * 5)] + expr(d - 1) + ')');
  for (let n = 0; n < 200; n++) {
    const out = shown(`| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | =${expr(3)} | =${expr(2)} |`);
    for (const v of [out[2][1], out[2][2]]) assert.match(v, /^(-?[\d,]+(\.\d+)?(e[+-]\d+)?|#[A-Z/0!?]+)$/);
  }
});

test('property: text cells survive escaping', () => {
  const rand = rng(5);
  const chars = ['a', '<', '>', '&', '"', "'", ' ', '=', '1', 'é'];
  for (let n = 0; n < 100; n++) {
    let t = '';
    for (let i = 0; i < 8; i++) t += chars[Math.floor(rand() * chars.length)];
    if (t.trim().startsWith('=')) continue;
    assertWellFormed(render(`| h |\n|---|\n| ${t} |`));
  }
});
