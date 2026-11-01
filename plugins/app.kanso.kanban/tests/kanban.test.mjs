import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin, assertSafe, checkXml, prng, pick, THEME } from './support.mjs';

const { render, registered } = loadPlugin(import.meta.url, 'kanban');
const draw = (source) => render({ source, theme: THEME });

test('registers only the kanban language', () => {
  assert.deepEqual(Object.keys(registered), ['kanban']);
});

test('draws columns and cards', () => {
  const svg = draw('## To do\n- One\n- Two\n## Done\n- [x] Three');
  checkXml(svg);
  for (const w of ['To do', 'Done', 'One', 'Two', 'Three']) assert.ok(svg.includes(w), w);
});

test('done cards are ticked and struck through; open checkboxes are empty circles', () => {
  const done = draw('## A\n- [x] Finished');
  assert.match(done, /<path /);
  assert.match(done, /<line /);
  const open = draw('## A\n- [ ] Open');
  assert.ok(!open.includes('<path '));
  assert.match(open, /fill="none" stroke="#777777"/);
  const plain = draw('## A\n- Plain');
  assert.ok(!plain.includes('<circle'));
  assert.ok(draw('## A\n- [X] Upper').includes('<path '));
});

test('empty columns and long cards work', () => {
  checkXml(draw('## Empty\n## Also empty'));
  checkXml(draw('## A\n- ' + 'word '.repeat(80) + '\n- ' + 'x'.repeat(200)));
});

test('clear errors on bad input', () => {
  const bad = [
    ['', /Write "## Column"/],
    ['- card', /before the first card|heading before/],
    ['## \n- a', /needs a name/],
    ['## A\nfree text', /expected "## Column"/],
    ['## A\n- ', /expected|empty/],
    ['## A\n- [x] ', /empty/],
  ];
  for (const [src, re] of bad) assert.throws(() => draw(src), (e) => e.constructor === Error && re.test(e.message), JSON.stringify(src));
  assert.throws(() => draw(Array.from({ length: 13 }, (_, i) => `## c${i}`).join('\n')), /At most 12/);
  assert.throws(() => draw('## A\n' + Array.from({ length: 101 }, () => '- x').join('\n')), /At most 100/);
});

test('text is escaped', () => {
  const evil = '<b>&"x';
  const svg = draw(`## ${evil}\n- ${evil}\n- [x] ${evil}`);
  checkXml(svg);
  assert.ok(svg.includes('&lt;b&gt;&amp;&quot;x'));
  assert.ok(!svg.includes('<b>'));
});

test('property: random inputs give clear Errors or well-formed SVG', () => {
  const rand = prng(99);
  const bits = ['## ', '# ', '- ', '* ', '[x] ', '[ ] ', '[X] ', '\n', ' ', 'word', 'Column', '<', '&', '"', "'", '\u0000', '\ud800', '😀', 'x'.repeat(40), '-', '[]'];
  let ok = 0;
  for (let n = 0; n < 3000; n++) {
    let s = '';
    for (let k = Math.floor(rand() * 30); k > 0; k--) s += pick(rand, bits);
    if (assertSafe(render, s)) ok++;
  }
  assert.ok(ok > 10, 'got ' + ok);
});

test('property: random valid boards always draw within limits', () => {
  const rand = prng(5);
  for (let n = 0; n < 200; n++) {
    const lines = [];
    for (let c = 0, cols = 1 + Math.floor(rand() * 12); c < cols; c++) {
      lines.push(`## Column ${c}`);
      for (let k = Math.floor(rand() * 15); k > 0; k--) {
        const mark = pick(rand, ['', '[ ] ', '[x] ']);
        lines.push(`- ${mark}${'lorem '.repeat(1 + Math.floor(rand() * 20))}`);
      }
    }
    assert.ok(assertSafe(render, lines.join('\n')));
  }
});
