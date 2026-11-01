import test from 'node:test';
import assert from 'node:assert/strict';
import { load, forAll } from '../../../scripts/testkit.mjs';

const ID = 'app.kanso.cite';
const msg = (doi, extra = {}) => ({
  DOI: doi, type: 'journal-article', title: ['Deep <i>learning</i> &amp; things'], 'container-title': ['Nature'],
  author: [{ given: 'Yann', family: 'LeCun' }, { given: 'Jean-Paul', family: 'Sartre' }, { given: 'Ada', family: 'Lovelace' }],
  issued: { 'date-parts': [[2015, 5, 28]] }, volume: '521', issue: '7553', page: '436-444', publisher: 'Springer', ...extra,
});
const DOIS = { '10.1038/nature14539': msg('10.1038/nature14539'), '10.1000/b1': msg('10.1000/b1', { type: 'book', title: ['A Book'], author: [{ given: 'Zed', family: 'Able' }], 'container-title': [] }) };

function setup(body, settings = {}, more = {}) {
  const calls = [];
  const h = load(ID, {
    settings,
    notes: [{ id: 'open', bookId: 'b1', title: 'Paper', body }],
    noteId: 'open',
    fetch: (req) => {
      calls.push(req.url);
      const doi = decodeURIComponent(req.url.replace('https://api.crossref.org/works/', ''));
      if (more.status) return { status: more.status, headers: more.headers, body: 'x' };
      const m = DOIS[doi.toLowerCase()] ?? more.extra?.[doi.toLowerCase()];
      return m ? { body: { status: 'ok', message: m } } : { status: 404, body: 'Resource not found.' };
    },
  });
  return { h, calls };
}

test('cites the DOI in the selection in APA by default', () => {
  const { h } = setup('See 10.1038/nature14539.');
  h.select('10.1038/nature14539');
  h.run('cite');
  assert.equal(
    h.note('open').body,
    'See LeCun, Y., Sartre, J.-P., \\& Lovelace, A. (2015). Deep learning \\& things. *Nature*, *521*(7553), 436–444. <https://doi.org/10.1038/nature14539>.',
  );
});

test('MLA and BibTeX styles', () => {
  const a = setup('10.1038/nature14539', { style: 'mla' });
  a.h.select('10.1038/nature14539');
  a.h.run('cite');
  assert.equal(a.h.note('open').body, 'LeCun, Yann, et al. "Deep learning \\& things." *Nature*, vol. 521, no. 7553, 2015, pp. 436–444, <https://doi.org/10.1038/nature14539>.');
  const b = setup('Ref: https://doi.org/10.1038/nature14539', { style: 'bibtex' });
  b.h.select('https://doi.org/10.1038/nature14539');
  b.h.run('cite');
  const body = b.h.note('open').body;
  assert.match(body, /```bibtex\n@article\{lecun2015deep,\n  author = \{LeCun, Yann and Sartre, Jean-Paul and Lovelace, Ada\},\n  title = \{\{Deep learning \\& things\}\},\n  journal = \{Nature\}/);
  assert.match(body, /pages = \{436--444\}/);
});

test('settings panel saves the style', () => {
  const { h } = setup('x');
  h.run('settings');
  h.press('save-style', { style: 'BibTeX' });
  assert.equal(h.state.settings.style, 'bibtex');
  h.press('save-style', { style: 'nonsense' });
  assert.equal(h.state.settings.style, 'bibtex');
});

test('bibliography is built from every DOI, sorted, and rebuilt in place (idempotent)', () => {
  const body = '# Paper\n\nRefs 10.1038/nature14539, and [b](https://doi.org/10.1000/B1). Again 10.1038/NATURE14539.\n\n## Next\ntext';
  const { h, calls } = setup(body);
  h.run('bibliography');
  const once = h.note('open').body;
  assert.match(once, /## Bibliography\n<!-- kanso-bibliography -->\n\nAble, Z\. \(2015\)|Able, Z\. \(n\.d\.\)/);
  assert.ok(once.indexOf('Able') < once.indexOf('LeCun'));
  assert.ok(once.includes('\n## Next\ntext'));
  const fetched = calls.length;
  assert.equal(fetched, 2);
  h.run('bibliography');
  h.run('bibliography');
  assert.equal(h.note('open').body, once);
  assert.equal(calls.length, fetched, 'cached');
  assert.equal([...once.matchAll(/kanso-bibliography/g)].length, 1);
});

test('property: rebuilding a bibliography twice changes nothing, wherever it sits', () => {
  forAll(30, (r) => ({ pre: r.string(40).replace(/10\.\d/g, ''), post: r.string(40).replace(/10\.\d/g, ''), style: r.pick(['apa', 'mla', 'bibtex']) }), ({ pre, post, style }) => {
    const { h } = setup(`${pre}\n10.1038/nature14539\n\n## After\n${post}`, { style });
    h.run('bibliography');
    const once = h.note('open').body;
    h.run('bibliography');
    assert.equal(h.note('open').body, once);
    assert.ok(once.startsWith(pre));
    assert.ok(once.includes(post.trimEnd()));
  });
});

test('missing DOIs are reported; partial lookups leave the note alone and resume', () => {
  const many = {};
  const dois = Array.from({ length: 12 }, (_, i) => `10.5555/p${i}`);
  dois.forEach((d) => (many[d] = msg(d, { title: [`Paper ${d}`] })));
  const { h, calls } = setup(`${dois.join(' ')} 10.9999/nope`, {}, { extra: many });
  const before = h.note('open').body;
  const first = h.run('bibliography');
  assert.match(first.text, /run it again/);
  assert.equal(h.note('open').body, before);
  assert.ok(calls.length <= 8);
  const second = h.run('bibliography');
  assert.match(second.text, /Bibliography of 12.*Not found at Crossref: 10\.9999\/nope/);
  assert.ok(h.state.fetches.length <= 30);
});

test('401/429 style failures are explained, and nothing is replaced', () => {
  const { h } = setup('10.1038/nature14539', {}, { status: 429, headers: { 'Retry-After': '20' } });
  h.select('10.1038/nature14539');
  assert.match(h.run('cite').text, /slow down.*20s/);
  assert.equal(h.note('open').body, '10.1038/nature14539');
  const u = setup('10.1038/nature14539', {}, { status: 500 });
  u.h.select('10.1038/nature14539');
  assert.match(u.h.run('cite').text, /answered 500/);
});

test('refuses a selection without a DOI and fetches nothing', () => {
  const { h, calls } = setup('plain words');
  h.select('plain');
  assert.match(h.run('cite').text, /No DOI/);
  assert.equal(calls.length, 0);
});

test('property: DOI extraction finds each DOI once and ignores trailing punctuation', () => {
  const { h } = setup('x');
  forAll(100, (r) => ({ suffix: r.string(8, 'abcXYZ019-_.'), punct: r.pick(['', '.', ',', ';', ')', '.)', '").']), n: 1 + r.int(3) }), ({ suffix, punct, n }) => {
    const doi = `10.1234/${suffix || 'a'}x`;
    const text = Array.from({ length: n }, () => `see ${doi}${punct} ok`).join(' ');
    const found = h.pure.extractDois(text);
    assert.equal(found.length, 1);
    assert.equal(found[0], doi.toLowerCase().replace(/[.,;:'"!?]+$/, ''));
  });
});

test('property: generated markdown and BibTeX escape their input', () => {
  const { h } = setup('x');
  const { escapeText, unescapeText, apa, mla, bibtex, tex } = h.pure;
  forAll(200, (r) => r.string(60), (s) => {
    const out = escapeText(s);
    assert.equal(unescapeText(out), s.replace(/\r\n|\r/g, '\n'));
    assert.ok(!/(^|[^\\])(\\\\)*[<\[]/.test(out));
  });
  forAll(100, (r) => r.string(30), (s) => {
    const m = h.pure.compact(msg('10.1/x', { title: [s || 't'], author: [{ given: s, family: s || 'f' }], 'container-title': [s || 'c'], publisher: s }));
    for (const text of [apa(m), mla(m)]) {
      assert.ok(!/(^|[^\\])(\\\\)*<(?!https:\/\/doi\.org\/)/.test(text), JSON.stringify(text));
      assert.ok(!/\n/.test(text));
    }
    const b = bibtex(m);
    // braces stay balanced even for hostile input
    let depth = 0;
    for (let i = 0; i < b.length; i++) {
      if (b[i] === '\\') { i++; continue; }
      if (b[i] === '{') depth++;
      if (b[i] === '}') depth--;
      assert.ok(depth >= 0);
    }
    assert.equal(depth, 0);
    assert.ok(!/(^|[^\\])[%$#^~]/.test(tex(s)), JSON.stringify(tex(s)));
  });
});
