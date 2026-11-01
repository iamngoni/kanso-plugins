import test from 'node:test';
import assert from 'node:assert/strict';
import { load, forAll } from '../../../scripts/testkit.mjs';

const ID = 'app.kanso.readwise';
const hl = (id, text, extra = {}) => ({ id, text, location: id, location_type: 'order', is_discard: false, ...extra });
const book = (id, title, highlights, extra = {}) => ({
  user_book_id: id, title, author: 'A. Writer', category: 'books',
  source_url: 'https://example.com/a', highlights, ...extra,
});

// A fake Readwise: honours updatedAfter and pageCursor, 2 books a page.
function fakeReadwise(books, pageSize = 2) {
  const calls = [];
  const handler = (req) => {
    calls.push(req.url);
    assert.equal(req.headers.Authorization, 'Token tok');
    const u = new URL(req.url);
    const after = u.searchParams.get('updatedAfter');
    const start = Number(u.searchParams.get('pageCursor') || 0);
    const visible = books.filter((b) => !after || b.updated > after);
    const page = visible.slice(start, start + pageSize).map(({ updated, ...b }) => b);
    const next = start + pageSize < visible.length ? String(start + pageSize) : null;
    return { status: 200, body: { count: visible.length, nextPageCursor: next, results: page } };
  };
  return { handler, calls };
}

const base = (extra = {}) => ({
  secrets: { token: 'tok' },
  notes: [{ id: 'open', bookId: 'b1', title: 'Open', body: '' }],
  noteId: 'open',
  ...extra,
});

test('imports one note per book, then adds only new highlights', () => {
  const books = [
    book(1, 'Deep Work', [hl(10, 'Focus matters.'), hl(11, 'Line one\nline two')], { updated: '2026-01-01' }),
    book(2, 'Essays', [hl(20, 'Short.')], { updated: '2026-01-01' }),
  ];
  const rw = fakeReadwise(books);
  const h = load(ID, base({ fetch: rw.handler }));
  assert.match(h.run('import').text, /2 new/);
  const made = h.notesIn('b1').filter((n) => n.id !== 'open');
  assert.equal(made.length, 2);
  const deep = made.find((n) => n.title === 'Deep Work');
  assert.match(deep.body, /^<!-- readwise:1 -->/);
  assert.match(deep.body, /> Focus matters\. <!-- rw:10 -->/);
  assert.match(deep.body, /> line two <!-- rw:11 -->/);

  books[0].highlights.push(hl(12, 'A later one'));
  books[0].updated = '2026-02-01';
  const first = h.state.settings.cursor;
  h.state.settings.cursor = '2026-01-15T00:00:00Z'; // as if the last run had been then
  assert.match(h.run('import').text, /1 updated/);
  const body = h.notesIn('b1').find((n) => n.title === 'Deep Work').body;
  assert.equal(body.match(/<!-- rw:\d+ -->/g).length, 3);
  assert.ok(first);
});

test('property: running the import twice creates no duplicates', () => {
  forAll(25, (r) => {
    const n = 1 + r.int(6);
    return Array.from({ length: n }, (_, i) =>
      book(100 + i, r.string(15) || 'x', Array.from({ length: 1 + r.int(4) }, (_, j) => hl(1000 * i + j + 1, r.string(40) || 'text'))));
  }, (books) => {
    const rw = fakeReadwise(books.map((b) => ({ ...b, updated: '2026-01-01' })));
    const h = load(ID, base({ fetch: rw.handler }));
    for (let i = 0; i < 6 && !h.state.settings.cursor; i++) h.run('import');
    const before = JSON.stringify(h.state.notes.map((n) => [n.id, n.body]));
    // a full re-sync must change nothing
    h.run('import'); // cursor set: nothing new
    h.press('resync');
    for (let i = 0; i < 6; i++) { h.run('import'); if (h.state.settings.cursor) break; }
    assert.equal(JSON.stringify(h.state.notes.map((n) => [n.id, n.body])), before);
    assert.equal(h.state.notes.length, books.length + 1);
  });
});

test('a run stops within the budgets and continues where it left off', () => {
  const books = Array.from({ length: 25 }, (_, i) => book(i + 1, `Book ${i + 1}`, [hl(i * 10 + 1, `h${i}`)], { updated: '2026-01-01' }));
  const rw = fakeReadwise(books, 5);
  const h = load(ID, base({ fetch: rw.handler }));
  let runs = 0;
  const cursors = [];
  while (!h.state.settings.cursor && runs < 10) {
    const out = h.run('import');
    runs += 1;
    assert.ok(h.state.kansoCalls <= 60, 'at most 60 Kanso calls');
    if (!h.state.settings.cursor) assert.match(out.text, /Run it again/);
    cursors.push(h.state.settings.cursor ?? null);
  }
  assert.ok(runs >= 3);
  assert.equal(h.notesIn('b1').length - 1, 25);
  const titles = new Set(h.notesIn('b1').map((n) => n.title));
  assert.equal(titles.size, 26);
});

test('property: the cursor only moves forward', () => {
  forAll(30, (r) => ({ a: r.int(1e9), b: r.int(1e9) }), ({ a, b }) => {
    const h = load(ID, base({ fetch: () => ({ body: { results: [], nextPageCursor: null } }) }));
    const A = new Date(1.7e12 + a * 1000).toISOString();
    const B = new Date(1.7e12 + b * 1000).toISOString();
    const out = h.pure.laterOf(A, B);
    assert.ok(Date.parse(out) >= Date.parse(A) && Date.parse(out) >= Date.parse(B));
    assert.equal(h.pure.laterOf(null, A), A);
  });
  // and a finished run never lowers a cursor set in the future
  const future = '2999-01-01T00:00:00.000Z';
  const h = load(ID, base({ settings: { cursor: future, bookId: 'b1' }, fetch: () => ({ body: { results: [], nextPageCursor: null } }) }));
  h.run('import');
  assert.equal(h.state.settings.cursor, future);
});

test('property: generated markdown escapes its input', () => {
  forAll(200, (r) => r.string(60), (s) => {
    const { escapeText, unescapeText } = load(ID, base({ fetch: () => ({}) })).pure;
    const out = escapeText(s);
    assert.equal(unescapeText(out), s.replace(/\r\n|\r/g, '\n'));
    // no raw HTML, link or comment can survive
    assert.ok(!/(^|[^\\])(\\\\)*[<\[]/.test(out), JSON.stringify(out));
  });
});

test('hostile highlight text cannot forge markers or links', () => {
  const evil = hl(5, '<!-- rw:999 --> [x](javascript:alert(1)) # Heading\n- item\n1. one', { note: '<script>' });
  const h = load(ID, base({ fetch: fakeReadwise([book(7, '<b>T</b>', [evil], { source_url: 'javascript:alert(1)', updated: 'x' })]).handler }));
  h.run('import');
  const n = h.notesIn('b1').find((x) => x.id !== 'open');
  assert.deepEqual([...h.pure.knownIds(n.body)], ['5']);
  assert.ok(!/(^|[^\\])\[x\]\(/m.test(n.body), 'no live link');
  assert.ok(!n.body.includes('<javascript') && !n.body.includes('<https://javascript'));
  assert.ok(!n.body.includes('<script>'));
  assert.ok(!/\n- item/.test(n.body) && !/\n> 1\. one/.test(n.body));
});

test('401 and 429 are reported clearly, without the token', () => {
  const h401 = load(ID, base({ fetch: () => ({ status: 401, body: { detail: 'Invalid token.' } }) }));
  const out = h401.run('import');
  assert.match(out.text, /rejected the token/);
  assert.ok(!out.text.includes('tok"') && !JSON.stringify(h401.state.logs).includes('tok'));

  const h429 = load(ID, base({ fetch: () => ({ status: 429, headers: { 'Retry-After': '30' }, body: '' }) }));
  const r = h429.run('import');
  assert.match(r.text, /slow down.*30s.*Run it again/);
  assert.ok(h429.state.settings.run);
  assert.equal(h429.state.settings.cursor, undefined);
});

test('no token: asks for the secret and fetches nothing', () => {
  const h = load(ID, { notes: [], fetch: () => assert.fail('no fetch') });
  assert.match(h.run('import').text, /secret "token"/);
});
