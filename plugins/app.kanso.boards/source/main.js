// Board diagrams: a ```chess block (a FEN position) and a ```go block (simple
// SGF or a list of moves), drawn as SVG in the theme's colors.

function boardsEscape(text) {
  return String(text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function boardsSvg(w, h, body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + body + '</svg>';
}

// "key: value" option lines shared by both fences. Returns the other lines.
function boardsOptions(source, allowed) {
  var options = {};
  var rest = [];
  source.split(/\r?\n/).forEach(function (line) {
    var m = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(line);
    if (m && allowed.indexOf(m[1].toLowerCase()) !== -1) options[m[1].toLowerCase()] = m[2];
    else if (line.trim() !== '') rest.push(line.trim());
  });
  return { options: options, rest: rest };
}

function boardsFlag(value, name) {
  if (value === undefined) return null;
  var v = value.toLowerCase();
  if (v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === 'no' || v === 'off') return false;
  throw new Error('"' + name + '" must be true or false.');
}

// ---- Chess ----------------------------------------------------------------

var CHESS_GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

// Returns { board: [8 rows from rank 8 down, 8 cells: '' or a piece letter],
// turn, extra }.
function chessParseFen(fen) {
  var fields = fen.trim().split(/\s+/);
  var ranks = fields[0].split('/');
  if (ranks.length !== 8) throw new Error('A FEN position needs 8 ranks separated by "/", and this has ' + ranks.length + '.');
  var board = [];
  var kings = { K: 0, k: 0 };
  ranks.forEach(function (rank, r) {
    var row = [];
    for (var i = 0; i < rank.length; i++) {
      var c = rank.charAt(i);
      if (/[1-8]/.test(c)) {
        for (var n = 0; n < parseInt(c, 10); n++) row.push('');
      } else if (/[pnbrqkPNBRQK]/.test(c)) {
        row.push(c);
        if (c === 'K' || c === 'k') kings[c]++;
      } else throw new Error('Rank ' + (8 - r) + ' has "' + c + '", which is not a piece (pnbrqk, upper case for white) or a digit 1 to 8.');
    }
    if (row.length !== 8) throw new Error('Rank ' + (8 - r) + ' covers ' + row.length + ' squares, not 8.');
    board.push(row);
  });
  if (kings.K > 1 || kings.k > 1) throw new Error('A side has more than one king.');
  var turn = null;
  if (fields.length > 1) {
    if (fields[1] !== 'w' && fields[1] !== 'b') throw new Error('The side to move must be w or b, not "' + fields[1].slice(0, 10) + '".');
    turn = fields[1];
  }
  return { board: board, turn: turn };
}

function chessSquare(name) {
  var m = /^([a-h])([1-8])$/.exec(name);
  if (!m) throw new Error('"' + String(name).slice(0, 12) + '" is not a square; use a1 to h8.');
  return { file: m[1].charCodeAt(0) - 97, rank: parseInt(m[2], 10) };
}

function chessRender(source, theme) {
  var parsed = boardsOptions(source, ['flip', 'coords', 'highlight', 'caption']);
  var fenLine = parsed.rest.filter(function (l) {
    return l.indexOf('/') !== -1;
  });
  if (fenLine.length === 0) throw new Error('Put a FEN position in the block, for example: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w');
  if (fenLine.length > 1 || parsed.rest.length > fenLine.length) throw new Error('Use one FEN line, and options such as "flip: true", "highlight: e2 e4", "coords: false", "caption: text".');
  var pos = chessParseFen(fenLine[0]);
  var flip = boardsFlag(parsed.options.flip, 'flip') === true;
  var coords = boardsFlag(parsed.options.coords, 'coords') !== false;
  var marks = {};
  if (parsed.options.highlight) {
    parsed.options.highlight.split(/[\s,]+/).filter(Boolean).slice(0, 16).forEach(function (s) {
      var q = chessSquare(s.toLowerCase());
      marks[q.file + ',' + q.rank] = true;
    });
  }
  var caption = (parsed.options.caption || '').slice(0, 120);
  var cell = 44;
  var margin = coords ? 18 : 0;
  var size = cell * 8;
  var top = 0;
  var width = size + margin;
  var capH = caption || pos.turn ? 24 : 0;
  var height = size + margin + capH;
  var out = '';
  for (var r = 0; r < 8; r++) {
    for (var f = 0; f < 8; f++) {
      var file = flip ? 7 - f : f;
      var rank = flip ? r + 1 : 8 - r;
      var x = margin + f * cell;
      var y = top + r * cell;
      var dark = (file + rank) % 2 === 0;
      out += '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" fill="' + (dark ? theme.muted : theme.surface) + '"' + (dark ? ' fill-opacity="0.45"' : '') + '/>';
      if (marks[file + ',' + rank]) out += '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" fill="' + theme.accent + '" fill-opacity="0.45"/>';
      var piece = pos.board[8 - rank][file];
      if (piece) {
        var white = piece === piece.toUpperCase();
        out +=
          '<text x="' + (x + cell / 2) + '" y="' + (y + cell - 9) + '" text-anchor="middle" font-size="36" font-family="\'Apple Symbols\', \'Segoe UI Symbol\', \'DejaVu Sans\', serif" fill="' +
          (white ? theme.background : theme.text) + '" stroke="' + theme.text + '" stroke-width="' + (white ? 1.2 : 0.6) + '">' + CHESS_GLYPH[piece.toLowerCase()] + '</text>';
      }
    }
  }
  out += '<rect x="' + (margin + 0.5) + '" y="0.5" width="' + (size - 1) + '" height="' + (size - 1) + '" fill="none" stroke="' + theme.border + '"/>';
  if (coords) {
    for (var i = 0; i < 8; i++) {
      var fl = String.fromCharCode(97 + (flip ? 7 - i : i));
      var rk = flip ? i + 1 : 8 - i;
      out += '<text x="' + (margin + i * cell + cell / 2) + '" y="' + (size + 13) + '" text-anchor="middle" font-size="11" fill="' + theme.muted + '">' + fl + '</text>';
      out += '<text x="' + (margin - 6) + '" y="' + (i * cell + cell / 2 + 4) + '" text-anchor="end" font-size="11" fill="' + theme.muted + '">' + rk + '</text>';
    }
  }
  if (capH) {
    var label = caption || (pos.turn === 'w' ? 'White to move' : 'Black to move');
    out += '<text x="' + margin + '" y="' + (size + margin + 16) + '" font-size="12" fill="' + theme.muted + '">' + boardsEscape(label) + '</text>';
  }
  return boardsSvg(width, height, out);
}

// ---- Go -------------------------------------------------------------------

var GO_COLS = 'ABCDEFGHJKLMNOPQRST'; // no I

function goPoint(token, size) {
  var m = /^([A-Ta-t])(\d{1,2})$/.exec(token);
  if (!m) return null;
  var col = GO_COLS.indexOf(m[1].toUpperCase());
  var row = parseInt(m[2], 10);
  if (col === -1 || col >= size || row < 1 || row > size) throw new Error('"' + token + '" is off the ' + size + 'x' + size + ' board.');
  return { x: col, y: size - row };
}

function goSgfPoint(value, size) {
  if (value === '' || (value === 'tt' && size <= 19)) return null; // pass
  var m = /^([a-s])([a-s])$/.exec(value);
  if (!m) throw new Error('"' + value.slice(0, 10) + '" is not an SGF point such as dd.');
  var p = { x: m[1].charCodeAt(0) - 97, y: m[2].charCodeAt(0) - 97 };
  if (p.x >= size || p.y >= size) throw new Error('SGF point "' + value + '" is off the ' + size + 'x' + size + ' board.');
  return p;
}

// Parses the block into { size, setup: [{c,x,y}], moves: [{c,x,y}|{c,pass}] }.
function goParse(source) {
  var parsed = boardsOptions(source, ['size', 'caption', 'coords']);
  var body = parsed.rest.join('\n');
  var size = 19;
  var setup = [];
  var moves = [];
  if (body.indexOf('(;') !== -1 || /^\s*\(?\s*;/.test(body)) {
    var sz = /SZ\[(\d+)\]/.exec(body);
    if (sz) size = parseInt(sz[1], 10);
    if (parsed.options.size) size = parseInt(parsed.options.size, 10);
    goCheckSize(size);
    // Properties are an upper-case name followed by one or more [value]s.
    var re = /([A-Z]+)((?:\s*\[[^\]]*\])+)/g;
    var m;
    var seen = 0;
    while ((m = re.exec(body))) {
      var name = m[1];
      var values = [];
      m[2].replace(/\[([^\]]*)\]/g, function (_, v) {
        values.push(v);
      });
      if (name === 'B' || name === 'W') {
        var pt = goSgfPoint(values[0], size);
        moves.push(pt ? { c: name, x: pt.x, y: pt.y } : { c: name, pass: true });
      } else if (name === 'AB' || name === 'AW') {
        values.forEach(function (v) {
          // compressed point lists "aa:cc" are rectangles
          var span = /^([a-s][a-s]):([a-s][a-s])$/.exec(v);
          if (span) {
            var a = goSgfPoint(span[1], size);
            var b = goSgfPoint(span[2], size);
            for (var yy = Math.min(a.y, b.y); yy <= Math.max(a.y, b.y); yy++) for (var xx = Math.min(a.x, b.x); xx <= Math.max(a.x, b.x); xx++) setup.push({ c: name.charAt(1), x: xx, y: yy });
          } else {
            var p = goSgfPoint(v, size);
            if (p) setup.push({ c: name.charAt(1), x: p.x, y: p.y });
          }
        });
      }
      if (++seen > 5000) throw new Error('That SGF is too long.');
    }
    if (moves.length === 0 && setup.length === 0) throw new Error('No moves found. SGF moves look like ;B[dd];W[pp].');
  } else {
    if (parsed.options.size) size = parseInt(parsed.options.size, 10);
    goCheckSize(size);
    var tokens = body.split(/[\s,;]+/).filter(Boolean);
    var next = 'B';
    var colorWord = { b: 'B', black: 'B', w: 'W', white: 'W', x: 'B', o: 'W' };
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var lower = t.toLowerCase();
      var sgf = /^([BW])\[([a-s]{0,2})\]$/i.exec(t);
      if (sgf) {
        var sp = goSgfPoint(sgf[2].toLowerCase(), size);
        moves.push(sp ? { c: sgf[1].toUpperCase(), x: sp.x, y: sp.y } : { c: sgf[1].toUpperCase(), pass: true });
        next = sgf[1].toUpperCase() === 'B' ? 'W' : 'B';
        continue;
      }
      var color = next;
      if (colorWord[lower] && i + 1 < tokens.length) {
        color = colorWord[lower];
        t = tokens[++i];
        lower = t.toLowerCase();
      } else if (/^[bw][a-t]\d{1,2}$/i.test(t)) {
        color = colorWord[lower.charAt(0)];
        t = t.slice(1);
        lower = t.toLowerCase();
      } else if (/^[bw]:[a-t]\d{1,2}$/i.test(t)) {
        color = colorWord[lower.charAt(0)];
        t = t.slice(2);
        lower = t.toLowerCase();
      }
      if (lower === 'pass') {
        moves.push({ c: color, pass: true });
      } else {
        var p2 = goPoint(t, size);
        if (!p2) throw new Error('"' + t.slice(0, 16) + '" is not a move. Write points like D4 or Q16, optionally after B or W.');
        moves.push({ c: color, x: p2.x, y: p2.y });
      }
      next = color === 'B' ? 'W' : 'B';
    }
    if (moves.length === 0) throw new Error('Write moves like "B D4  W Q16", or an SGF such as (;SZ[9];B[ee];W[cc]).');
  }
  if (moves.length > 400) throw new Error('Too many moves: at most 400.');
  return { size: size, setup: setup, moves: moves, options: parsed.options };
}

function goCheckSize(size) {
  if (!(size >= 5 && size <= 19)) throw new Error('Board size must be a number from 5 to 19.');
}

// Plays the stones, removing captured groups. Returns { board, last }.
function goPlay(game) {
  var n = game.size;
  var board = [];
  for (var y = 0; y < n; y++) {
    board.push([]);
    for (var x = 0; x < n; x++) board[y].push('');
  }
  game.setup.forEach(function (s) {
    board[s.y][s.x] = s.c;
  });
  function group(x0, y0) {
    var color = board[y0][x0];
    var seen = {};
    var stack = [[x0, y0]];
    var stones = [];
    var liberties = 0;
    seen[x0 + ',' + y0] = true;
    while (stack.length) {
      var p = stack.pop();
      stones.push(p);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = p[0] + d[0];
        var ny = p[1] + d[1];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n || seen[nx + ',' + ny]) return;
        if (board[ny][nx] === '') {
          liberties++;
          seen[nx + ',' + ny] = true;
        } else if (board[ny][nx] === color) {
          seen[nx + ',' + ny] = true;
          stack.push([nx, ny]);
        }
      });
    }
    return { stones: stones, liberties: liberties };
  }
  var last = null;
  game.moves.forEach(function (mv) {
    if (mv.pass) {
      last = null;
      return;
    }
    if (board[mv.y][mv.x] !== '') throw new Error('Point ' + GO_COLS.charAt(mv.x) + (n - mv.y) + ' is played twice: it is already taken.');
    board[mv.y][mv.x] = mv.c;
    var foe = mv.c === 'B' ? 'W' : 'B';
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var nx = mv.x + d[0];
      var ny = mv.y + d[1];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n || board[ny][nx] !== foe) return;
      var g = group(nx, ny);
      if (g.liberties === 0) g.stones.forEach(function (s) {
        board[s[1]][s[0]] = '';
      });
    });
    var own = group(mv.x, mv.y);
    if (own.liberties === 0) own.stones.forEach(function (s) {
      board[s[1]][s[0]] = ''; // suicide is removed
    });
    last = { x: mv.x, y: mv.y };
  });
  return { board: board, last: last };
}

function goStarPoints(n) {
  if (n === 19) return [3, 9, 15];
  if (n === 13) return [3, 6, 9];
  if (n === 9) return [2, 4, 6];
  return [];
}

function goRender(source, theme) {
  var game = goParse(source);
  var res = goPlay(game);
  var n = game.size;
  var coords = boardsFlag(game.options.coords, 'coords') !== false;
  var caption = (game.options.caption || '').slice(0, 120);
  var cell = n > 13 ? 26 : 32;
  var pad = 14;
  var margin = coords ? 20 : 0;
  var span = (n - 1) * cell;
  var side = span + pad * 2 + margin;
  var capH = caption ? 22 : 0;
  var ox = margin + pad;
  var oy = pad;
  var out = '<rect x="' + margin + '" y="0" width="' + (side - margin) + '" height="' + (span + pad * 2) + '" rx="4" fill="' + theme.surface + '" stroke="' + theme.border + '"/>';
  for (var i = 0; i < n; i++) {
    out += '<line x1="' + ox + '" y1="' + (oy + i * cell) + '" x2="' + (ox + span) + '" y2="' + (oy + i * cell) + '" stroke="' + theme.muted + '"/>';
    out += '<line x1="' + (ox + i * cell) + '" y1="' + oy + '" x2="' + (ox + i * cell) + '" y2="' + (oy + span) + '" stroke="' + theme.muted + '"/>';
  }
  var stars = goStarPoints(n);
  stars.forEach(function (sy) {
    stars.forEach(function (sx) {
      out += '<circle cx="' + (ox + sx * cell) + '" cy="' + (oy + sy * cell) + '" r="2.5" fill="' + theme.muted + '"/>';
    });
  });
  if (coords) {
    for (var c = 0; c < n; c++) {
      out += '<text x="' + (ox + c * cell) + '" y="' + (oy + span + pad + 14) + '" text-anchor="middle" font-size="10" fill="' + theme.muted + '">' + GO_COLS.charAt(c) + '</text>';
      out += '<text x="' + (margin - 6) + '" y="' + (oy + c * cell + 3.5) + '" text-anchor="end" font-size="10" fill="' + theme.muted + '">' + (n - c) + '</text>';
    }
  }
  for (var y = 0; y < n; y++) {
    for (var x = 0; x < n; x++) {
      var s = res.board[y][x];
      if (!s) continue;
      out += '<circle cx="' + (ox + x * cell) + '" cy="' + (oy + y * cell) + '" r="' + (cell * 0.46) + '" fill="' + (s === 'B' ? theme.text : theme.background) + '" stroke="' + theme.text + '"/>';
    }
  }
  if (res.last) {
    var stone = res.board[res.last.y][res.last.x];
    out += '<circle cx="' + (ox + res.last.x * cell) + '" cy="' + (oy + res.last.y * cell) + '" r="' + cell * 0.2 + '" fill="none" stroke="' + (stone === 'B' ? theme.background : theme.text) + '" stroke-width="2"/>';
    out += '<circle cx="' + (ox + res.last.x * cell) + '" cy="' + (oy + res.last.y * cell) + '" r="' + cell * 0.07 + '" fill="' + theme.accent + '"/>';
  }
  if (caption) out += '<text x="' + margin + '" y="' + (span + pad * 2 + (coords ? 34 : 16)) + '" font-size="12" fill="' + theme.muted + '">' + boardsEscape(caption) + '</text>';
  return boardsSvg(side, span + pad * 2 + capH + (coords ? 20 : 0), out);
}

kanso.fences.register('chess', function (args) {
  return chessRender(args.source, args.theme);
});

kanso.fences.register('go', function (args) {
  return goRender(args.source, args.theme);
});
