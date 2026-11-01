import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin, assertSafe, checkXml, prng, pick, THEME } from './support.mjs';

const { render, registered } = loadPlugin(import.meta.url, 'chart');
const draw = (source) => render({ source, theme: THEME });

test('registers only the chart language', () => {
  assert.deepEqual(Object.keys(registered), ['chart']);
});

test('draws each chart type from label: value lines', () => {
  for (const type of ['bar', 'line', 'area', 'pie']) {
    const svg = draw(`type: ${type}\nApples: 4\nPears: 7.5\nPlums: 2`);
    checkXml(svg);
    assert.match(svg, /Apples/);
  }
});

test('defaults to a bar chart', () => {
  const svg = draw('A: 1\nB: 2');
  assert.match(svg, /<rect /);
});

test('CSV with a header makes a legend of series names', () => {
  const svg = draw('type: line\nmonth, Alpha, Beta\nJan, 1, 2\nFeb, 3, 1\nMar, 2, 5');
  checkXml(svg);
  assert.match(svg, />Alpha</);
  assert.match(svg, />Beta</);
  assert.equal((svg.match(/<polyline/g) || []).length, 2);
});

test('CSV without a header works', () => {
  checkXml(draw('Jan, 1, 2\nFeb, 3, 1'));
});

test('negative values draw below the axis', () => {
  checkXml(draw('type: area\nA: -3\nB: 4\nC: -1'));
  checkXml(draw('A: -3\nB: -4'));
});

test('pie handles a single non-zero slice and shows percentages', () => {
  const svg = draw('type: pie\nA: 5\nB: 0');
  assert.match(svg, /<circle /);
  assert.match(svg, /100%/);
});

test('clear errors on bad input', () => {
  const bad = [
    ['', /label: value/],
    ['type: donut\nA: 1', /type must be/],
    ['A 1', /expected "label: value"/],
    ['A: x', /not a number/],
    ['type: pie\nA: -1\nB: 2', /negative/],
    ['type: pie\nA: 0', /above zero/],
    ['a, b\n1, 2, 3', /columns/],
    ['A: 1e999', /too large/],
  ];
  for (const [src, re] of bad) assert.throws(() => draw(src), (e) => e.constructor === Error && re.test(e.message), src);
});

test('limits points and series', () => {
  const many = Array.from({ length: 201 }, (_, i) => `p${i}: ${i}`).join('\n');
  assert.throws(() => draw(many), /At most 200/);
  assert.throws(() => draw('x, ' + 'a,b,c,d,e,f,g,h,i\n' + 'r, 1,2,3,4,5,6,7,8,9'), /At most 8/);
  checkXml(draw(Array.from({ length: 200 }, (_, i) => `p${i}: ${i}`).join('\n')));
});

test('text is escaped everywhere', () => {
  const evil = '<b>&"x';
  const escaped = '&lt;b&gt;&amp;&quot;x';
  for (const type of ['bar', 'line', 'pie']) {
    const svg = draw(`type: ${type}\n${evil}: 3\nz: 1`);
    checkXml(svg);
    assert.ok(svg.includes(escaped), type);
    assert.ok(!svg.includes('<b>'));
  }
  const legend = draw(`type: bar\nm, ${evil}, y\nJan, 1, 2`);
  checkXml(legend);
  assert.ok(legend.includes(escaped));
  assert.ok(!draw("A'B: 1").includes("A'B"));
});

test('uses only theme colours and stays within size limits', () => {
  assertSafe(render, 'type: pie\nA: 1\nB: 2\nC: 3\nD: 4\nE: 5\nF: 6\nG: 7\nH: 8\nI: 9');
  assertSafe(render, 'x, a, b, c, d, e, f, g, h\n1, 1,2,3,4,5,6,7,8\n2, 8,7,6,5,4,3,2,1');
});

test('property: random inputs give clear Errors or well-formed SVG', () => {
  const rand = prng(20261101);
  const bits = ['type:', 'bar', 'line', 'pie', 'area', ',', ':', '\n', ' ', '1', '2.5', '-7', '0', '1e3', 'x', 'Jan', '<', '&', '"', "'", '\u0000', '\ud800', '😀', '1e999', '.', '-', 'type: pie\n', 'a, b\n'];
  let ok = 0;
  for (let n = 0; n < 3000; n++) {
    let s = '';
    for (let k = Math.floor(rand() * 30); k > 0; k--) s += pick(rand, bits);
    if (assertSafe(render, s)) ok++;
  }
  assert.ok(ok > 10, 'some random inputs should be valid, got ' + ok);
});

test('property: random valid data always draws', () => {
  const rand = prng(7);
  for (let n = 0; n < 300; n++) {
    const type = pick(rand, ['bar', 'line', 'area', 'pie']);
    const rows = 1 + Math.floor(rand() * 40);
    const cols = type === 'pie' ? 1 : 1 + Math.floor(rand() * 8);
    const scale = pick(rand, [1, 0.001, 1000, 1e9, 1e-6]);
    const lines = [`type: ${type}`];
    let any = false;
    for (let r = 0; r < rows; r++) {
      const vals = Array.from({ length: cols }, () => {
        const v = (type === 'pie' ? rand() : rand() * 2 - 1) * scale;
        if (v > 0) any = true;
        return v.toFixed(6);
      });
      lines.push(`row ${r}, ${vals.join(', ')}`);
    }
    if (type === 'pie' && !any) continue;
    if (cols === 1 && type !== 'pie') lines.push('last, 1');
    const out = assertSafe(render, lines.join('\n'));
    assert.ok(out, lines.join('\n'));
  }
});
