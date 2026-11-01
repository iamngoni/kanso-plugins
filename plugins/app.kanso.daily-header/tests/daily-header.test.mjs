import test from 'node:test';
import assert from 'node:assert/strict';
import { load, forAll } from '../../../scripts/testkit.mjs';

const ID = 'app.kanso.daily-header';
const geo = { results: [{ name: 'Harare', country: 'Zimbabwe', latitude: -17.83, longitude: 31.05 }] };
const forecast = {
  current: { time: '2026-11-01T11:45', temperature_2m: 24.4, weather_code: 2 },
  daily: { time: ['2026-11-01'], temperature_2m_max: [28.2], temperature_2m_min: [16.6], precipitation_probability_max: [20] },
};

function setup(body, settings = { city: 'Harare' }, routes = {}) {
  const calls = [];
  const h = load(ID, {
    settings,
    notes: [{ id: 'open', bookId: 'b1', title: 'Day', body }],
    noteId: 'open',
    fetch: (req) => {
      calls.push(req.url);
      const u = new URL(req.url);
      if (u.hostname === 'geocoding-api.open-meteo.com') return routes.geo ?? { body: geo };
      if (u.hostname === 'api.open-meteo.com') return routes.forecast ?? { body: forecast };
      assert.fail(req.url);
    },
  });
  return { h, calls };
}

test('inserts the date and weather at the top', () => {
  const { h, calls } = setup('# Notes\ntext');
  assert.match(h.run('insert').text, /24°C in Harare, Zimbabwe/);
  assert.equal(
    h.note('open').body,
    '<!-- daily-header -->\n**Sunday, 1 November 2026** · Harare, Zimbabwe · 24°C, partly cloudy · high 28°C, low 17°C · 20% chance of rain\n\n# Notes\ntext',
  );
  assert.match(calls[0], /geocoding-api\.open-meteo\.com\/v1\/search\?name=Harare&count=1/);
  assert.match(calls[1], /latitude=-17\.83&longitude=31\.05.*timezone=auto$/);
});

test('running again replaces the header, and the city lookup is remembered', () => {
  const { h, calls } = setup('body');
  h.run('insert');
  const once = h.note('open').body;
  h.run('insert');
  h.run('insert');
  assert.equal(h.note('open').body, once);
  assert.equal(once.match(/daily-header/g).length, 1);
  assert.equal(calls.filter((u) => u.includes('geocoding')).length, 1);
});

test('property: inserting is idempotent for any note body and replaces only our header', () => {
  forAll(60, (r) => r.string(80), (text) => {
    const body = text.replace(/^\s+/, '');
    const { h } = setup(body);
    h.run('insert');
    const once = h.note('open').body;
    h.run('insert');
    assert.equal(h.note('open').body, once);
    assert.ok(once.endsWith(body));
    assert.ok(once.startsWith('<!-- daily-header -->\n'));
  });
});

test('an older header from another day is replaced', () => {
  const { h } = setup('<!-- daily-header -->\n**Monday, 2 March 2026** · Oslo\n\n# Notes');
  h.run('insert');
  const body = h.note('open').body;
  assert.ok(!body.includes('Oslo') && body.endsWith('\n\n# Notes'));
  assert.equal(body.match(/daily-header/g).length, 1);
});

test('fahrenheit, and no city means a date-only header', () => {
  const f = setup('x', { city: 'Harare', unit: 'F' });
  f.h.run('insert');
  assert.ok(f.calls[1].includes('temperature_unit=fahrenheit'));
  assert.match(f.h.note('open').body, /24°F/);
  const none = setup('x', {});
  none.h.run('insert');
  assert.equal(none.calls.length, 0);
  assert.match(none.h.note('open').body, /^<!-- daily-header -->\n\*\*\w+, \d+ \w+ \d{4}\*\*\n\nx$/);
});

test('unknown city, 429 and server errors leave the note unchanged', () => {
  const a = setup('keep', { city: 'Nowhereville' }, { geo: { body: {} } });
  assert.match(a.h.run('insert').text, /does not know a place called "Nowhereville"/);
  assert.equal(a.h.note('open').body, 'keep');
  const b = setup('keep', undefined, { forecast: { status: 429, headers: { 'retry-after': '40' }, body: '' } });
  assert.match(b.h.run('insert').text, /slow down.*40s.*unchanged/);
  assert.equal(b.h.note('open').body, 'keep');
  const c = setup('keep', undefined, { geo: { status: 500, body: '' } });
  assert.match(c.h.run('insert').text, /answered 500/);
});

test('the settings panel saves the city and clears the saved place', () => {
  const { h } = setup('x', { city: 'Harare', geo: { query: 'Harare', lat: 1, lon: 2, name: 'H' } });
  h.run('settings');
  h.press('save', { city: ' Oslo ', unit: 'Fahrenheit' });
  assert.equal(h.state.settings.city, 'Oslo');
  assert.equal(h.state.settings.unit, 'F');
  assert.equal(h.state.settings.geo, null);
});

test('property: dates are right and markdown escapes its input', () => {
  const { h } = setup('x');
  const { longDate, escapeText, unescapeText, headerLines } = h.pure;
  assert.equal(longDate('2024-02-29'), 'Thursday, 29 February 2024');
  assert.equal(longDate('2023-02-29'), null);
  forAll(200, (r) => r.string(60), (s) => {
    const out = escapeText(s);
    assert.equal(unescapeText(out), s.replace(/\r\n|\r/g, '\n'));
    assert.ok(!/(^|[^\\])(\\\\)*[<\[]/.test(out));
  });
  forAll(100, (r) => r.string(40), (s) => {
    const lines = headerLines({ dateIso: '2026-11-01', place: s, weather: null }).split('\n');
    assert.equal(lines.length, 2, 'a place name cannot add lines');
    assert.ok(!/(^|[^\\])(\\\\)*<(?!!-- daily-header)/.test(lines[1]));
  });
});
