import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin, assertSafe, checkXml, prng, pick, THEME } from './support.mjs';

const { render, registered } = loadPlugin(import.meta.url, 'timeline');
const draw = (source) => render({ source, theme: THEME });

test('registers only the timeline language', () => {
  assert.deepEqual(Object.keys(registered), ['timeline']);
});

test('single dates make a timeline', () => {
  const svg = draw('2026-01-05: Kickoff\n2026-03-01: Launch\n2026-02-01: Middle');
  checkXml(svg);
  assert.match(svg, /Kickoff/);
  assert.match(svg, /2026-03-01/);
  assert.ok(!svg.includes('<rect'));
});

test('a single item still draws', () => {
  checkXml(draw('2026-01-05: Only'));
});

test('ranges make a Gantt chart, with milestones as diamonds', () => {
  const svg = draw('2026-01-05..2026-02-01: Build\n2026-03-01: Launch');
  checkXml(svg);
  assert.match(svg, /<rect /);
  assert.match(svg, /<polygon /);
  assert.match(svg, /Jan 5 – Feb 1/);
});

test('rows are sorted by start date', () => {
  const svg = draw('2026-05-01..2026-05-09: Later\n2026-01-01..2026-01-09: Earlier');
  assert.ok(svg.indexOf('Earlier') < svg.indexOf('Later'));
});

test('handles spans from one day to centuries', () => {
  checkXml(draw('2026-01-05..2026-01-05: Same day'));
  checkXml(draw('2026-01-05..2026-01-09: Short\n2026-01-06: m'));
  checkXml(draw('1900-01-01..2100-12-31: Long\n2026-06-06: m'));
  checkXml(draw('1000-01-01: Old\n9999-12-31: Far'));
});

test('clear errors on bad input', () => {
  const bad = [
    ['', /Write dated items/],
    ['hello', /expected "2026-01-05: Label"/],
    ['2026-02-30: x', /not a real date/],
    ['2026-13-01: x', /not a real date/],
    ['2026-01-05..2026-02-30: x', /not a real date/],
    ['2026-02-01..2026-01-05: x', /ends before/],
    ['2026-01-05:', /add a label/],
    ['0999-01-05: x', /not a real date/],
  ];
  for (const [src, re] of bad) assert.throws(() => draw(src), (e) => e.constructor === Error && re.test(e.message), src);
  const many = Array.from({ length: 101 }, (_, i) => `2026-01-05: n${i}`).join('\n');
  assert.throws(() => draw(many), /At most 100/);
  checkXml(draw(many.split('\n').slice(0, 100).join('\n')));
});

test('text is escaped', () => {
  const evil = '<b>&"x';
  const escaped = '&lt;b&gt;&amp;&quot;x';
  for (const src of [`2026-01-05: ${evil}`, `2026-01-05..2026-01-09: ${evil}`]) {
    const svg = draw(src);
    checkXml(svg);
    assert.ok(svg.includes(escaped));
    assert.ok(!svg.includes('<b>'));
  }
});

test('property: random inputs give clear Errors or well-formed SVG', () => {
  const rand = prng(1101);
  const bits = ['2026-01-05', '2026-12-31', '2024-02-29', '2025-02-29', '..', ':', ': ', '\n', ' ', 'x', 'Label', '<', '&', '"', '\u0000', '\ud800', '😀', '1999-', '-', '2026-1-1'];
  let ok = 0;
  for (let n = 0; n < 3000; n++) {
    let s = '';
    for (let k = Math.floor(rand() * 25); k > 0; k--) s += pick(rand, bits);
    if (assertSafe(render, s)) ok++;
  }
  assert.ok(ok > 5, 'got ' + ok);
});

test('property: random valid items always draw', () => {
  const rand = prng(42);
  const iso = (d) => new Date(d * 86400000).toISOString().slice(0, 10);
  for (let n = 0; n < 300; n++) {
    const count = 1 + Math.floor(rand() * 40);
    const spread = pick(rand, [3, 40, 400, 20000]);
    const base = 10000 + Math.floor(rand() * 5000);
    const lines = [];
    for (let i = 0; i < count; i++) {
      const a = base + Math.floor(rand() * spread);
      const b = a + Math.floor(rand() * spread * 0.3);
      lines.push(rand() < 0.5 ? `${iso(a)}: item ${i}` : `${iso(a)}..${iso(b)}: item ${i}`);
    }
    assert.ok(assertSafe(render, lines.join('\n')), lines.join('\n'));
  }
});
