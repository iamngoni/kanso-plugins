import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const commands = new Map();
let selection = null;
let replaced = null;
let failWith = null;
globalThis.kanso = {
  commands: { register: (c) => commands.set(c.id, c) },
  editor: {
    selection: () => selection,
    replaceSelection: (a) => { if (failWith) throw failWith; replaced = a; },
  },
};
const T = createRequire(import.meta.url)(path.join(here, '../source/main.js'));

function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const NOW = Date.UTC(2025, 0, 15, 10, 0);
const conv = (s) => T.convertText(s, NOW);
const ZONE = (name) => T.findZone(name);
const at = (zone, y, mo, d, h, mi) => T.offsetAt(ZONE(zone), Date.UTC(y, mo - 1, d, h, mi));

test('units', () => {
  assert.equal(conv('5 km to mi').text, '3.106855961 mi');
  assert.equal(conv('5 in to cm').text, '12.7 cm');
  assert.equal(conv('72 F to C').text, '22.22222222 °C');
  assert.equal(conv('-40 c in f').text, '-40 °F');
  assert.equal(conv('0 K to C').text, '-273.15 °C');
  assert.equal(conv('1,000 ft in m').text, '304.8 m');
  assert.equal(conv('10 m/s to km/h, mph').text, '36 km/h, 22.36936292 mph');
  assert.equal(conv('1 GiB to MB').text, '1073.741824 MB');
  assert.equal(conv('100 Mb to MB').text, '12.5 MB');
  assert.equal(conv('1 gal to L').text, '3.785411784 L');
  assert.equal(conv('60 mph to knots').text, '52.13857451 kn');
  assert.equal(conv('2 kg to lbs').text, '4.409245244 lb');
  assert.equal(conv('98.6°F to °C').text, '37 °C');
  assert.match(conv('5 km to kg').error, /length to mass/);
  assert.ok(conv('hello').error);
  assert.ok(conv('').error);
});

test('unit round trips', () => {
  const rand = rng(8);
  const cats = {};
  for (const [cat, def] of Object.entries(T.LINEAR)) cats[cat] = def.units.map((u) => T.findUnit(u[2][0]));
  cats.temperature = ['c', 'f', 'k'].map(T.findUnit);
  for (let i = 0; i < 3000; i += 1) {
    const list = Object.values(cats)[Math.floor(rand() * 6)];
    const a = list[Math.floor(rand() * list.length)];
    const b = list[Math.floor(rand() * list.length)];
    const v = (rand() - 0.3) * 10 ** Math.floor(rand() * 8);
    const back = T.convertValue(T.convertValue(v, a, b), b, a);
    assert.ok(Math.abs(back - v) <= 1e-9 * Math.max(1, Math.abs(v)), `${a.symbol} ${b.symbol} ${v}`);
  }
});

test('formatNumber', () => {
  const rand = rng(4);
  for (let i = 0; i < 2000; i += 1) {
    const x = (rand() - 0.5) * 10 ** (Math.floor(rand() * 40) - 15);
    const s = T.formatNumber(x);
    assert.match(s, /^-?\d+(\.\d+)?(e-?\d+)?$/);
    assert.ok(Math.abs(Number(s) - x) <= 1e-8 * Math.abs(x), `${x} ${s}`);
  }
  assert.equal(T.formatNumber(0.1 + 0.2), '0.3');
  assert.equal(T.formatNumber(-0), '0');
});

test('daylight saving rules', () => {
  const U = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi);
  const ny = ZONE('new york');
  assert.equal(T.offsetAt(ny, U(2025, 3, 9, 6, 59)), -300);
  assert.equal(T.offsetAt(ny, U(2025, 3, 9, 7, 0)), -240);
  assert.equal(T.offsetAt(ny, U(2025, 11, 2, 5, 59)), -240);
  assert.equal(T.offsetAt(ny, U(2025, 11, 2, 6, 0)), -300);
  assert.equal(at('London', 2025, 3, 30, 0, 59), 0);
  assert.equal(at('London', 2025, 3, 30, 1, 0), 60);
  assert.equal(at('Paris', 2025, 10, 26, 0, 59), 120);
  assert.equal(at('Paris', 2025, 10, 26, 1, 0), 60);
  assert.equal(at('Sydney', 2025, 1, 15, 0, 0), 660);
  assert.equal(at('Sydney', 2025, 4, 5, 15, 59), 660);
  assert.equal(at('Sydney', 2025, 4, 5, 16, 0), 600);
  assert.equal(at('Sydney', 2025, 10, 4, 16, 0), 660);
  assert.equal(at('Auckland', 2025, 9, 27, 13, 59), 720);
  assert.equal(at('Auckland', 2025, 9, 27, 14, 0), 780);
  assert.equal(at('Harare', 2025, 7, 1, 0, 0), 120);
  assert.equal(at('Phoenix', 2025, 7, 1, 0, 0), -420);
  assert.equal(T.sunday(2025, 2, 0), 30);
  assert.equal(T.sunday(2025, 2, 2), 9);
});

test('time zones', () => {
  assert.equal(conv('14:00 Harare in New York').text, '07:00 New York (UTC-05:00)');
  assert.equal(conv('2025-07-15 14:00 Harare in New York').text, '2025-07-15 08:00 New York (UTC-04:00)');
  assert.equal(conv('2pm London to Tokyo, Sydney').text, '23:00 Tokyo (UTC+09:00); 01:00 Sydney (UTC+11:00) +1 day');
  assert.equal(conv('23:00 Harare to Tokyo').text, '06:00 Tokyo (UTC+09:00) +1 day');
  assert.equal(conv('12:00 UTC+5:30 to UTC-8').text, '22:30 UTC-08:00 -1 day');
  assert.equal(conv('9:30am PST to CET').text, '18:30 CET (UTC+01:00)');
  assert.equal(conv('noon America/Chicago to Europe/Berlin').text, '19:00 Berlin (UTC+01:00)');
  assert.match(conv('14:00 Harare to Atlantis').error, /Unknown time zone: Atlantis/);
  assert.ok(conv('25:00 Harare to Paris').error);
  assert.ok(conv('2025-02-30 10:00 UTC to Paris').error);
});

test('zone round trips', () => {
  const rand = rng(31);
  for (const z of T.ZONES) {
    const zone = ZONE(z[0]);
    assert.ok(zone, z[0]);
    for (let i = 0; i < 300; i += 1) {
      const t = Date.UTC(2000, 0, 1) + Math.floor(rand() * 40 * 365 * 86400000);
      const local = t + T.offsetAt(zone, t) * 60000;
      const back = T.toUtc(zone, local);
      assert.ok(back === t || back === t - 3600000, `${z[0]} ${new Date(t).toISOString()}`);
      assert.ok(T.offsetAt(zone, t) % 15 === 0);
    }
  }
});

const PIECES = ['5', '14:00', '2pm', ' ', ' ', ' to ', ' in ', ' = ', '->', 'km', 'mi', 'F', 'C', 'Harare', 'New York', 'UTC+3', ',', ';', '1e999', '-', '.', '°', '/', '2025-03-30', '99:99', '日本', '😀', '"', "'", 'GiB', 'noon', 'x'];
test('never throws on random text', () => {
  const rand = rng(1);
  for (let i = 0; i < 6000; i += 1) {
    let s = '';
    const n = Math.floor(rand() * 10);
    for (let j = 0; j < n; j += 1) s += PIECES[Math.floor(rand() * PIECES.length)];
    const r = conv(s);
    assert.ok(typeof r.text === 'string' || typeof r.error === 'string', s);
    assert.ok(!(r.text && /NaN|undefined|Infinity/.test(r.text)), `${s} -> ${r.text}`);
  }
});

function run(id, sel) { selection = sel; replaced = null; return commands.get(id).run({}); }

test('commands replace or append and keep offsets', () => {
  const sel = { text: '5 km to mi', start: 12, end: 22 };
  run('convert-replace', sel);
  assert.equal(replaced.text, '3.106855961 mi');
  assert.deepEqual(replaced.selection, { start: 12, end: 22 });
  run('convert-append', { text: '5 km to mi  ', start: 0, end: 12 });
  assert.equal(replaced.text, '5 km to mi = 3.106855961 mi');
  assert.match(run('convert-replace', { text: 'nonsense', start: 0, end: 8 }).text, /Could not read/);
  assert.equal(replaced, null);
  assert.match(run('convert-replace', null).text, /Select/);
  failWith = Object.assign(new Error('x'), { code: 'conflict' });
  assert.match(run('convert-replace', sel).text, /moved/);
  failWith = null;
  assert.ok([...commands.values()].every((c) => c.when === 'selection'));
});
