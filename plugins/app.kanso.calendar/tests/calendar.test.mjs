import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin, assertSafe, checkXml, prng, pick, THEME } from './support.mjs';

const { render, registered } = loadPlugin(import.meta.url, 'calendar');
const draw = (source) => render({ source, theme: THEME });

test('registers only the calendar language', () => {
  assert.deepEqual(Object.keys(registered), ['calendar']);
});

test('draws a month grid with marked days', () => {
  const svg = draw('month: 2026-11\n2026-11-03: Dentist\n2026-11-30: End');
  checkXml(svg);
  assert.match(svg, /November 2026/);
  assert.match(svg, /Dentist/);
  assert.equal((svg.match(/<circle /g) || []).length, 2);
});

test('week count and first weekday are right', () => {
  // 1 Nov 2026 is a Sunday: Monday-first needs 6 rows, Sunday-first 5.
  const mon = draw('month: 2026-11');
  const sun = draw('month: 2026-11\nweek: sun');
  const rows = (s) => +/height="(\d+)"/.exec(s)[1];
  assert.ok(rows(mon) > rows(sun));
  assert.ok(sun.indexOf('>Sun<') < sun.indexOf('>Mon<'));
  assert.ok(mon.indexOf('>Mon<') < mon.indexOf('>Sun<'));
  // Feb 2027 starts on Monday and has 28 days: exactly 4 rows.
  assert.ok(rows(draw('month: 2027-02')) < rows(sun));
});

test('leap days and month ends', () => {
  checkXml(draw('month: 2028-02\n2028-02-29: Leap'));
  assert.throws(() => draw('month: 2026-02\n2026-02-29: x'), /not a real date/);
});

test('extra events collapse to +N more', () => {
  const svg = draw('month: 2026-11\n2026-11-03: a\n2026-11-03: b\n2026-11-03: c\n2026-11-03: d');
  assert.match(svg, /\+2 more/);
});

test('clear errors on bad input', () => {
  const bad = [
    ['', /Start with "month/],
    ['2026-11-03: x', /Start with "month/],
    ['month: 2026-13', /month must look like/],
    ['month: nov', /month must look like/],
    ['month: 2026-11\nmonth: 2026-12', /only one/],
    ['month: 2026-11\nweek: tue', /week must be/],
    ['month: 2026-11\nhello', /expected/],
    ['month: 2026-11\n2026-11-03:', /add a label/],
    ['month: 2026-11\n2026-12-03: x', /outside 2026-11/],
    ['month: 2026-11\n2026-11-31: x', /not a real date/],
    ['month: 2026-11\n2026-11-00: x', /not a real date/],
  ];
  for (const [src, re] of bad) assert.throws(() => draw(src), (e) => e.constructor === Error && re.test(e.message), JSON.stringify(src));
  const many = 'month: 2026-11\n' + Array.from({ length: 201 }, () => '2026-11-03: x').join('\n');
  assert.throws(() => draw(many), /At most 200/);
});

test('text is escaped', () => {
  const evil = '<b>&"x';
  const svg = draw(`month: 2026-11\n2026-11-03: ${evil}`);
  checkXml(svg);
  assert.ok(svg.includes('&lt;b&gt;&amp;&quot;x'));
  assert.ok(!svg.includes('<b>'));
});

test('property: random inputs give clear Errors or well-formed SVG', () => {
  const rand = prng(314);
  const bits = ['month: ', '2026-11', '2026-02', '2026-11-03', '2024-02-29', '2026-11-31', 'week: ', 'sun', 'mon', ': ', ':', '\n', ' ', 'x', 'Label', '<', '&', '"', '\u0000', '\ud800', '😀', '-', '99999'];
  let ok = 0;
  for (let n = 0; n < 4000; n++) {
    let s = rand() < 0.5 ? 'month: 2026-11\n' : '';
    for (let k = Math.floor(rand() * 20); k > 0; k--) s += pick(rand, bits);
    if (assertSafe(render, s)) ok++;
  }
  assert.ok(ok > 3, 'got ' + ok);
});

test('property: every month of many years draws, with random events', () => {
  const rand = prng(8);
  for (let y = 1000; y <= 3000; y += 37) {
    for (let m = 1; m <= 12; m++) {
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const lines = [`month: ${y}-${String(m).padStart(2, '0')}`, pick(rand, ['week: sun', 'week: mon'])];
      for (let k = Math.floor(rand() * 6); k > 0; k--) {
        const d = 1 + Math.floor(rand() * days);
        lines.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}: event ${k}`);
      }
      assert.ok(assertSafe(render, lines.join('\n')), lines.join('\n'));
    }
  }
});
