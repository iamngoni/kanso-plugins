import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { assertWellFormed, assertThemeColors, THEMES, rng } from './xml.mjs';

const src = fs.readFileSync(fileURLToPath(new URL('../source/main.js', import.meta.url)), 'utf8');
const renderers = {};
const ctx = { kanso: { fences: { register: (lang, fn) => (renderers[lang] = fn) } } };
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.T = { chessParseFen, goParse, goPlay };', ctx);
const T = ctx.T;
const isError = (e) => Object.prototype.toString.call(e) === '[object Error]' && typeof e.message === 'string';
const chess = (source, theme = THEMES[0]) => renderers.chess({ source, theme });
const go = (source, theme = THEMES[0]) => renderers.go({ source, theme });
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const count = (s, re) => (s.match(re) || []).length;

// Board contents after the moves, as rows of 'B', 'W' and '.'.
function position(source) {
  const g = T.goParse(source);
  return Array.from(T.goPlay(g).board, (row) => Array.from(row, (c) => c || '.').join(''));
}

test('registers both fences', () => {
  assert.deepEqual(Object.keys(renderers).sort(), ['chess', 'go']);
});

test('chess: the start position has 32 pieces and 64 squares', () => {
  const svg = chess(START);
  assertWellFormed(svg);
  assert.equal(count(svg, /font-size="36"/g), 32);
  assert.equal(count(svg, /width="44" height="44"/g), 64);
  assert.ok(svg.includes('White to move'));
  for (const g of ['♚', '♛', '♜', '♝', '♞', '♟']) assert.ok(svg.includes('>' + g + '<'));
});

test('chess: FEN parsing', () => {
  const p = T.chessParseFen(START);
  assert.equal(p.turn, 'w');
  assert.equal(p.board[0][0], 'r');
  assert.equal(p.board[7][4], 'K');
  assert.equal(T.chessParseFen('8/8/8/8/8/8/8/8').turn, null);
  assert.equal(T.chessParseFen('4k3/8/8/8/8/8/8/4K3 b').turn, 'b');
});

test('chess: flip, coords, highlight and caption options', () => {
  const flipped = chess(START + '\nflip: true');
  assert.ok(flipped.indexOf('>h<') < flipped.indexOf('>a<'));
  assert.ok(!chess(START + '\ncoords: false').includes('font-size="11"'));
  const hl = chess(START + '\nhighlight: e2 E4');
  assert.equal(count(hl, /fill-opacity="0.45"/g) - count(chess(START), /fill-opacity="0.45"/g), 2);
  const cap = chess('8/8/8/8/8/8/8/8\ncaption: A <b>&</b> "q"');
  assert.ok(cap.includes('A &lt;b&gt;&amp;&lt;/b&gt; &quot;q&quot;'));
  assertWellFormed(cap);
});

test('chess: errors name the problem', () => {
  const bad = [
    ['', /Put a FEN/],
    ['8/8/8', /8 ranks.*has 3/],
    ['8/8/8/8/8/8/8/9', /not a piece/],
    ['8/8/8/8/8/8/8/7', /covers 7 squares/],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX', /"X"/],
    ['kk6/8/8/8/8/8/8/8', /more than one king/],
    [START.replace(' w ', ' z '), /w or b/],
    [START + '\nhighlight: z9', /not a square/],
    [START + '\nflip: maybe', /true or false/],
    [START + '\nrandom words', /one FEN line/],
  ];
  for (const [src, re] of bad) assert.throws(() => chess(src), (e) => isError(e) && re.test(e.message), src);
});

test('go: coordinate list, alternating colors from black', () => {
  const rows = position('size: 9\nD4 E5 pass F6');
  assert.equal(rows[5][3], 'B'); // D4 is column 3, row 9-4=5
  assert.equal(rows[4][4], 'W');
  assert.equal(rows[3][5], 'W'); // the pass was black's turn
});

test('go: explicit colors and SGF-style tokens', () => {
  assert.equal(position('size: 9\nW D4 W E4 B F4')[5].slice(3, 6), 'WWB');
  assert.equal(position('size: 9\nwd4 be4')[5].slice(3, 5), 'WB');
  assert.equal(position('size: 9\nB[cc] W[gg]')[2][2], 'B');
});

test('go: SGF with setup stones and a size', () => {
  const rows = position('(;GM[1]SZ[9]AB[aa][bb]AW[cc:dd];B[ee];W[])');
  assert.equal(rows.length, 9);
  assert.equal(rows[0][0], 'B');
  assert.equal(rows[1][1], 'B');
  assert.equal(rows[2].slice(2, 4), 'WW');
  assert.equal(rows[3].slice(2, 4), 'WW');
  assert.equal(rows[4][4], 'B');
});

test('go: captures remove stones, including edges and groups', () => {
  // White stone at A1 (corner) captured by black B1 and A2.
  assert.equal(position('size: 9\nW A1 B B1 B A2')[8][0], '.');
  // A two-stone group captured by the last liberty.
  assert.equal(position('size: 5\nW A1 W B1 B A2 B B2 B C1')[4].slice(0, 3), '..B');
});

test('go: suicide is removed, retaking an occupied point is an error', () => {
  assert.equal(position('size: 5\nW A2 W B1 B A1')[4][0], '.');
  assert.throws(() => go('size: 9\nD4 D4'), (e) => isError(e) && /played twice/.test(e.message));
});

test('go: rendering has a board, stones, hoshi and a last-move marker', () => {
  const svg = go('size: 9\nD4 E5');
  assertWellFormed(svg);
  assert.equal(count(svg, /r="2.5"/g), 9);
  assert.equal(count(svg, /r="14.72"/g), 2);
  assert.ok(svg.includes('>J<') && !svg.includes('>I<'));
  assertWellFormed(go('(;SZ[19];B[dd];W[pp])'));
  assert.ok(!go('size: 9\nD4\ncoords: false').includes('font-size="10"'));
  assert.ok(go('size: 9\nD4\ncaption: <i>x</i>').includes('&lt;i&gt;x&lt;/i&gt;'));
});

test('go: errors name the problem', () => {
  const bad = [
    ['', /Write moves/],
    ['size: 4\nD4', /5 to 19/],
    ['size: 9\nK10', /off the 9x9 board/],
    ['size: 9\nZ9', /not a move/],
    ['size: 9\nhello', /not a move/],
    ['(;SZ[9]RE[B+R])', /No moves/],
    ['(;SZ[9];B[zz])', /not an SGF point/],
    ['(;SZ[9];B[jj])', /off the 9x9/],
    ['(;SZ[30];B[aa])', /5 to 19/],
    ['size: 9\n' + 'A1 '.repeat(401), /Too many|played twice/],
  ];
  for (const [src, re] of bad) assert.throws(() => go(src), (e) => isError(e) && re.test(e.message), src);
});

test('themes: only theme colors are used', () => {
  for (const theme of THEMES) {
    for (const svg of [chess(START + '\nhighlight: e4', theme), go('size: 9\nD4 E5\ncaption: hi', theme)]) {
      assertWellFormed(svg);
      assertThemeColors(svg, theme);
    }
  }
});

test('property: random chess input is a clear Error or a well-formed board', () => {
  const rand = rng(2024);
  const bits = ['r', 'n', 'b', 'q', 'k', 'P', 'N', 'K', '1', '2', '3', '8', '/', '/', '/', ' ', 'w', 'b', 'x', '9', '<', '&', '\n', 'flip: true\n', 'highlight: e4\n', 'caption: a<b\n'];
  for (let n = 0; n < 500; n++) {
    let s = n % 3 === 0 ? '' : '8/8/8/8/8/8/8/8 ';
    const len = Math.floor(rand() * 40);
    for (let i = 0; i < len; i++) s += bits[Math.floor(rand() * bits.length)];
    try {
      assertWellFormed(chess(s, THEMES[n % 2]));
    } catch (e) {
      assert.ok(isError(e) && e.name === 'Error' && e.message.length > 10, 'unclear failure for ' + JSON.stringify(s) + ': ' + e);
    }
  }
});

test('property: random valid FENs always draw one glyph per piece', () => {
  const rand = rng(77);
  const letters = 'pnbrqPNBRQ';
  for (let n = 0; n < 100; n++) {
    let pieces = 0;
    const ranks = [];
    for (let r = 0; r < 8; r++) {
      let rank = '';
      let f = 0;
      while (f < 8) {
        if (rand() < 0.4) {
          rank += letters[Math.floor(rand() * letters.length)];
          pieces++;
          f++;
        } else {
          const k = 1 + Math.floor(rand() * (8 - f));
          rank += k;
          f += k;
        }
      }
      ranks.push(rank);
    }
    const svg = chess(ranks.join('/') + ' b');
    assertWellFormed(svg);
    assert.equal(count(svg, /font-size="36"/g), pieces);
  }
});

test('property: random go input is a clear Error or a well-formed board', () => {
  const rand = rng(31337);
  const bits = ['B ', 'W ', 'D4 ', 'Q16 ', 'a1 ', 'pass ', 'T19 ', 'I5 ', 'size: 9\n', 'size: 19\n', '(;', ';B[dd]', ';W[pp]', 'SZ[9]', 'AB[aa]', 'AW[bb:cc]', '[', ']', ')', ' ', '\n', '<', '&', 'caption: x<y\n', 'zz', ';W[]'];
  for (let n = 0; n < 500; n++) {
    let s = '';
    const len = Math.floor(rand() * 25);
    for (let i = 0; i < len; i++) s += bits[Math.floor(rand() * bits.length)];
    try {
      assertWellFormed(go(s, THEMES[n % 2]));
    } catch (e) {
      assert.ok(isError(e) && e.name === 'Error' && e.message.length > 10, 'unclear failure for ' + JSON.stringify(s) + ': ' + e);
    }
  }
});

test('property: legal random games keep stones off captured points and never exceed the board', () => {
  const rand = rng(8);
  for (let n = 0; n < 60; n++) {
    const size = 5 + Math.floor(rand() * 15);
    const taken = new Set();
    const moves = [];
    for (let i = 0; i < 80; i++) {
      const x = Math.floor(rand() * size);
      const y = Math.floor(rand() * size);
      if (taken.has(x + ',' + y)) continue;
      taken.add(x + ',' + y);
      moves.push('abcdefghjklmnopqrst'[x].toUpperCase() + (y + 1));
    }
    // Each point is only ever named once, so every game is legal to replay.
    const g = T.goParse('size: ' + size + '\n' + moves.join(' '));
    const board = T.goPlay(g).board;
    assert.equal(board.length, size);
    let stones = 0;
    for (const row of board) {
      assert.equal(row.length, size);
      for (const c of row) if (c) stones++;
    }
    assert.ok(stones <= moves.length);
    assertWellFormed(go('size: ' + size + '\n' + moves.join(' ')));
  }
});

test('property: free text in captions is escaped', () => {
  const rand = rng(3);
  const chars = ['a', '<', '>', '&', '"', "'", ' ', ':'];
  for (let n = 0; n < 100; n++) {
    let t = 'x';
    for (let i = 0; i < 10; i++) t += chars[Math.floor(rand() * chars.length)];
    assertWellFormed(chess(START + '\ncaption: ' + t));
    assertWellFormed(go('size: 9\nD4\ncaption: ' + t));
  }
});
