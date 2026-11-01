import test from 'node:test';
import assert from 'node:assert/strict';
import { load, forAll, panelText } from '../../../scripts/testkit.mjs';

const ID = 'app.kanso.lookup';
const dictBody = [{ word: 'ephemeral', meanings: [
  { partOfSpeech: 'adjective', definitions: [{ definition: 'Lasting a very short time.' }, { definition: 'Short-lived.' }, { definition: 'third' }] },
  { partOfSpeech: 'noun', definitions: [{ definition: 'A thing that is brief.' }] },
] }];
const wikiBody = { title: 'Ephemerality', type: 'standard', extract: 'Ephemerality is the concept of things being transitory.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ephemerality' } } };

function setup(routes = {}) {
  const calls = [];
  const h = load(ID, {
    notes: [{ id: 'open', bookId: 'b1', title: 'N', body: 'An ephemeral thing, really.' }],
    noteId: 'open',
    fetch: (req) => {
      calls.push(req.url);
      if (req.url.startsWith('https://api.dictionaryapi.dev/')) return routes.dict ?? { body: dictBody };
      if (req.url.startsWith('https://en.wikipedia.org/')) return routes.wiki ?? { body: wikiBody };
      assert.fail(req.url);
    },
  });
  return { h, calls };
}

test('looks up the selection and shows definitions and the summary', () => {
  const { h, calls } = setup();
  h.select('ephemeral');
  h.run('lookup');
  const text = panelText(h.state.panel);
  assert.match(text, /Lasting a very short time/);
  assert.match(text, /transitory/);
  assert.ok(!text.includes('third'), 'at most two definitions a meaning');
  assert.deepEqual(calls, [
    'https://api.dictionaryapi.dev/api/v2/entries/en/ephemeral',
    'https://en.wikipedia.org/api/rest_v1/page/summary/ephemeral',
  ]);
  assert.ok(JSON.stringify(h.state.panel).includes('"id":"insert"'));
});

test('the button inserts the result after the selection as one edit', () => {
  const { h } = setup();
  h.select('ephemeral');
  h.run('lookup');
  h.press('insert');
  const body = h.note('open').body;
  assert.match(body, /^An ephemeral\n\n> \*\*ephemeral\*\*\n>\n> \*adjective\* - Lasting a very short time\./);
  assert.match(body, /\(\[Wikipedia\]\(https:\/\/en\.wikipedia\.org\/wiki\/Ephemerality\)\)\n thing, really\.$/);
});

test('phrases are encoded; not-found answers still render what exists', () => {
  const { h, calls } = setup({ dict: { status: 404, body: { title: 'No Definitions Found' } } });
  h.state.notes[0].body = 'the "big bang"?';
  h.select('"big bang"?');
  h.run('lookup');
  assert.ok(calls[1].endsWith('/summary/big_bang'));
  assert.match(panelText(h.state.panel), /No dictionary definition found/);
  assert.match(panelText(h.state.panel), /transitory/);
});

test('nothing found anywhere offers no insert button', () => {
  const { h } = setup({ dict: { status: 404, body: {} }, wiki: { status: 404, body: {} } });
  h.select('ephemeral');
  h.run('lookup');
  assert.ok(!JSON.stringify(h.state.panel).includes('"id":"insert"'));
});

test('429 and server errors are explained', () => {
  const { h } = setup({ dict: { status: 429, body: '' }, wiki: { status: 500, body: '' } });
  h.select('ephemeral');
  h.run('lookup');
  assert.match(panelText(h.state.panel), /Could not reach the dictionary \(rate-limited\) or Wikipedia \(status 500\)/);
});

test('empty or very long selections are refused without any request', () => {
  const { h, calls } = setup();
  h.state.notes[0].body = `   ${'x'.repeat(300)}`;
  h.select('   ');
  assert.match(h.run('lookup').text, /Select a word or phrase/);
  h.select('x'.repeat(300));
  assert.match(h.run('lookup').text, /Select a word or phrase/);
  assert.equal(calls.length, 0);
});

test('a disambiguation page is not inserted as a summary', () => {
  const { h } = setup({ wiki: { body: { ...wikiBody, type: 'disambiguation' } } });
  h.select('ephemeral');
  h.run('lookup');
  h.press('insert');
  assert.ok(!h.note('open').body.includes('transitory'));
});

test('property: generated markdown escapes what the web sends', () => {
  const { h } = setup();
  const { escapeText, unescapeText, renderInsert, readWiki } = h.pure;
  forAll(200, (r) => r.string(60), (s) => {
    const out = escapeText(s);
    assert.equal(unescapeText(out), s.replace(/\r\n|\r/g, '\n'));
    assert.ok(!/(^|[^\\])(\\\\)*[<\[]/.test(out));
  });
  forAll(100, (r) => r.string(40), (s) => {
    const md = renderInsert(s, [{ partOfSpeech: s, definitions: [s] }], { summary: s, url: null });
    // every line stays inside the blockquote and no raw HTML or link survives
    for (const line of md.split('\n')) assert.ok(line.startsWith('>'), JSON.stringify(line));
    assert.ok(!/<[a-z!\/]/i.test(md.replace(/\\</g, '')));
  });
  assert.equal(readWiki({ extract: 'x', content_urls: { desktop: { page: 'https://evil.example/wiki/x' } } }).url, null);
  assert.equal(readWiki({ extract: 'x', content_urls: { desktop: { page: 'javascript:alert(1)' } } }).url, null);
});
