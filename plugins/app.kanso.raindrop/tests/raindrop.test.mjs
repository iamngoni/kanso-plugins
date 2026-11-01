import test from 'node:test';
import assert from 'node:assert/strict';
import { load, forAll } from '../../../scripts/testkit.mjs';

const ID = 'app.kanso.raindrop';
const item = (n, extra = {}) => ({
  _id: 1000 + n, title: `Title ${n}`, link: `https://example.com/${n}`, excerpt: `ex ${n}`,
  note: '', tags: ['a'], created: new Date(Date.UTC(2026, 0, 1) + n * 60000).toISOString(), domain: 'example.com', ...extra,
});

// A fake Raindrop: newest first, paged by `page`/`perpage`.
function fake(items, collections = [{ _id: 55, title: 'Reading' }]) {
  return (req) => {
    assert.equal(req.headers.Authorization, 'Bearer tok');
    const u = new URL(req.url);
    if (u.pathname === '/rest/v1/collections') return { body: { result: true, items: collections } };
    if (u.pathname === '/rest/v1/collections/childrens') return { body: { result: true, items: [] } };
    const per = Number(u.searchParams.get('perpage'));
    const page = Number(u.searchParams.get('page'));
    const sorted = [...items].sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
    return { body: { result: true, items: sorted.slice(page * per, page * per + per) } };
  };
}
const setup = (items, settings = {}, extra = {}) =>
  load(ID, {
    secrets: { token: 'tok' },
    notes: [{ id: 'open', bookId: 'b1', title: 'Open', body: '' }],
    noteId: 'open',
    settings: { collection: 'Reading', ...settings },
    fetch: fake(items),
    ...extra,
  });
const made = (h) => h.notesIn('b1').filter((n) => n.id !== 'open');

test('imports a named collection as notes, then only new bookmarks', () => {
  const items = [item(1), item(2), item(3)];
  const h = setup(items);
  assert.match(h.run('import').text, /3 new notes from Reading.*Up to date/);
  assert.equal(made(h).length, 3);
  assert.match(made(h)[0].body, /<!-- raindrop:\d+ -->\n\n<https:\/\/example\.com\//);
  items.push(item(4));
  assert.match(h.run('import').text, /1 new notes/);
  assert.equal(made(h).length, 4);
  assert.match(h.run('import').text, /0 new notes/);
  assert.equal(made(h).length, 4);
});

test('property: importing twice never duplicates, in either mode', () => {
  forAll(25, (r) => ({
    n: r.int(30),
    mode: r.pick(['notes', 'list']),
    titles: Array.from({ length: 30 }, () => r.string(20)),
  }), ({ n, mode, titles }) => {
    const items = Array.from({ length: n }, (_, i) => item(i + 1, { title: titles[i] }));
    const h = setup(items, { mode });
    for (let i = 0; i < 6; i++) h.run('import');
    const snap = JSON.stringify(h.state.notes);
    for (let i = 0; i < 3; i++) h.run('import');
    assert.equal(JSON.stringify(h.state.notes), snap);
    const ids = made(h).flatMap((x) => [...x.body.matchAll(/<!-- raindrop:(\d+) -->/g)].map((m) => m[1]));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, n);
  });
});

test('big collections take several runs, within budgets', () => {
  const items = Array.from({ length: 130 }, (_, i) => item(i + 1));
  const h = setup(items);
  let runs = 0;
  while (runs < 20) {
    const out = h.run('import');
    runs += 1;
    assert.ok(h.state.kansoCalls <= 60 && h.state.fetches.length <= 30);
    if (!/run it again/.test(out.text)) break;
  }
  assert.ok(runs >= 3 && runs < 20);
  assert.equal(made(h).length, 130);
});

test('list mode keeps one list note, newest first, and appends on later runs', () => {
  const items = [item(1), item(2)];
  const h = setup(items, { mode: 'list' });
  h.run('import');
  assert.equal(made(h).length, 1);
  assert.equal(made(h)[0].title, 'Raindrop: Reading');
  items.push(item(3));
  h.run('import');
  assert.equal(made(h).length, 1);
  const lines = made(h)[0].body.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Title 3/);
});

test('property: the cursor only moves forward', () => {
  forAll(30, (r) => ({ a: r.int(1e9), b: r.int(1e9) }), ({ a, b }) => {
    const { laterOf } = setup([]).pure;
    const A = new Date(1.7e12 + a * 1000).toISOString();
    const B = new Date(1.7e12 + b * 1000).toISOString();
    const out = laterOf(A, B);
    assert.ok(Date.parse(out) >= Math.max(Date.parse(A), Date.parse(B)));
  });
  const items = [item(1), item(2)];
  const h = setup(items);
  h.run('import');
  const c1 = Object.values(h.state.settings.cursors)[0];
  h.state.settings.cursors[Object.keys(h.state.settings.cursors)[0]] = '2999-01-01T00:00:00.000Z';
  h.run('import');
  assert.equal(Object.values(h.state.settings.cursors)[0], '2999-01-01T00:00:00.000Z');
  assert.ok(c1);
});

test('property: generated markdown escapes its input', () => {
  const h = setup([]);
  const { escapeText, unescapeText, noteBody, listLine } = h.pure;
  forAll(200, (r) => r.string(60), (s) => {
    const out = escapeText(s);
    assert.equal(unescapeText(out), s.replace(/\r\n|\r/g, '\n'));
    assert.ok(!/(^|[^\\])(\\\\)*[<\[]/.test(out));
  });
  const evil = item(9, { title: '](javascript:x) <img onerror=1> [a', link: 'javascript:alert(1)', excerpt: '<!-- raindrop:1 -->', tags: ['<b>'] });
  for (const text of [noteBody(evil), listLine(evil)]) {
    assert.ok(!/(^|[^\\])\]\(javascript/.test(text) && !/<javascript/.test(text), 'no live javascript: link');
    assert.deepEqual([...h.pure.idsIn(text)], ['1009']);
    assert.ok(!/(^|[^\\])<(img|b)/.test(text));
  }
  assert.equal(h.pure.safeUrl('https://a.com/x(1)'), 'https://a.com/x%281%29');
  assert.equal(h.pure.safeUrl('data:text/html,x'), null);
});

test('401, 429, unknown collection', () => {
  const h401 = setup([], {}, { fetch: () => ({ status: 401, body: {} }) });
  assert.match(h401.run('import').text, /rejected the token/);
  const h429 = setup([], {}, { fetch: () => ({ status: 429, headers: { 'Retry-After': '12' }, body: {} }) });
  assert.match(h429.run('import').text, /slow down.*12s/);
  const none = setup([item(1)], { collection: 'Nope' });
  assert.match(none.run('import').text, /no collection called "Nope"/);
  assert.equal(made(none).length, 0);
  const num = setup([item(1)], { collection: '55' });
  assert.match(num.run('import').text, /1 new notes/);
});

test('the panel saves collection and mode', () => {
  const h = setup([item(1)], {});
  h.press('import', { collection: 'Reading', mode: 'One list note' });
  assert.equal(h.state.settings.mode, 'list');
  assert.equal(made(h).length, 1);
});
