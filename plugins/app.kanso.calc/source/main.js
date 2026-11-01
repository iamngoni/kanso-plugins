// Calc table: draws a ```calc block, a Markdown pipe table whose cells may be
// formulas like =SUM(B2:B4) or =A1*2, as an SVG table of computed values.
// Formulas are parsed by a small recursive-descent parser; nothing is eval'd.

var CALC_MAX_ROWS = 100;
var CALC_MAX_COLS = 26;
var CALC_MAX_FORMULA = 300;
var CALC_MAX_CELL_TEXT = 60;

function calcEscape(text) {
  return String(text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function CalcError(code) {
  this.calcCode = code;
}

function calcSplitRow(line) {
  var s = line.trim();
  if (s.charAt(0) === '|') s = s.slice(1);
  if (s.length > 0 && s.charAt(s.length - 1) === '|' && s.charAt(s.length - 2) !== '\\') s = s.slice(0, -1);
  var cells = [];
  var cur = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === '\\' && s.charAt(i + 1) === '|') {
      cur += '|';
      i++;
    } else if (c === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

// Returns { rows: [[text]], align: ['l'|'c'|'r'], header: bool }.
function calcParseTable(source) {
  var lines = source.split(/\r?\n/).filter(function (l) {
    return l.trim() !== '';
  });
  if (lines.length === 0) throw new Error('Write a pipe table, for example "| Item | Price |" then a row of "|---|---|" then rows.');
  var rows = [];
  var align = [];
  var header = false;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('|') === -1) throw new Error('Line ' + (i + 1) + ' is not a table row: it needs | between cells.');
    var cells = calcSplitRow(lines[i]);
    var isRule = cells.every(function (c) {
      return /^:?-{1,}:?$/.test(c);
    });
    if (isRule && i === 1) {
      header = true;
      align = cells.map(function (c) {
        var l = c.charAt(0) === ':';
        var r = c.charAt(c.length - 1) === ':';
        return l && r ? 'c' : r ? 'r' : 'l';
      });
      continue;
    }
    rows.push(cells);
  }
  if (rows.length > CALC_MAX_ROWS) throw new Error('Too many rows: at most ' + CALC_MAX_ROWS + '.');
  var cols = 0;
  rows.forEach(function (r) {
    cols = Math.max(cols, r.length);
  });
  if (cols > CALC_MAX_COLS) throw new Error('Too many columns: at most ' + CALC_MAX_COLS + ' (A to Z).');
  rows.forEach(function (r) {
    while (r.length < cols) r.push('');
  });
  while (align.length < cols) align.push('l');
  return { rows: rows, align: align.slice(0, cols), header: header };
}

// ---- Formulas -------------------------------------------------------------

function calcTokenize(text) {
  var tokens = [];
  var i = 0;
  while (i < text.length) {
    var c = text.charAt(i);
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      var m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));
      if (!m) throw new CalcError('#ERR!');
      tokens.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      var w = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(text.slice(i))[0];
      tokens.push({ t: 'word', v: w.toUpperCase() });
      i += w.length;
    } else if ('+-*/^(),:%'.indexOf(c) !== -1) {
      tokens.push({ t: c });
      i++;
    } else throw new CalcError('#ERR!');
  }
  return tokens;
}

function calcRef(word) {
  var m = /^([A-Z])([0-9]+)$/.exec(word);
  if (!m) return null;
  var row = parseInt(m[2], 10);
  if (row < 1 || row > CALC_MAX_ROWS) return { bad: true };
  return { col: m[1].charCodeAt(0) - 65, row: row - 1 };
}

// Parses to a tree: {k:'num',v} {k:'ref',col,row} {k:'range',a,b}
// {k:'neg',x} {k:'pct',x} {k:'bin',op,a,b} {k:'call',name,args}
function calcParse(text) {
  if (text.length > CALC_MAX_FORMULA) throw new CalcError('#ERR!');
  var tokens = calcTokenize(text);
  var pos = 0;
  function peek() {
    return tokens[pos] ? tokens[pos].t : null;
  }
  function expect(t) {
    if (peek() !== t) throw new CalcError('#ERR!');
    pos++;
  }
  var depth = 0;
  function enter() {
    if (++depth > 40) throw new CalcError('#ERR!');
  }
  function sum() {
    var left = product();
    while (peek() === '+' || peek() === '-') {
      var op = tokens[pos++].t;
      left = { k: 'bin', op: op, a: left, b: product() };
    }
    return left;
  }
  function product() {
    var left = unary();
    while (peek() === '*' || peek() === '/') {
      var op = tokens[pos++].t;
      left = { k: 'bin', op: op, a: left, b: unary() };
    }
    return left;
  }
  function unary() {
    if (peek() === '-' || peek() === '+') {
      var neg = tokens[pos++].t === '-';
      enter();
      var x = unary();
      depth--;
      return neg ? { k: 'neg', x: x } : x;
    }
    return power();
  }
  function power() {
    var base = postfix();
    if (peek() === '^') {
      pos++;
      enter();
      var exp = unary(); // right associative
      depth--;
      return { k: 'bin', op: '^', a: base, b: exp };
    }
    return base;
  }
  function postfix() {
    var x = atom();
    while (peek() === '%') {
      pos++;
      x = { k: 'pct', x: x };
    }
    return x;
  }
  function atom() {
    var tok = tokens[pos];
    if (!tok) throw new CalcError('#ERR!');
    if (tok.t === 'num') {
      pos++;
      return { k: 'num', v: tok.v };
    }
    if (tok.t === '(') {
      pos++;
      enter();
      var inner = sum();
      depth--;
      expect(')');
      return inner;
    }
    if (tok.t === 'word') {
      pos++;
      if (peek() === '(') {
        pos++;
        var args = [];
        if (peek() !== ')') {
          for (;;) {
            enter();
            args.push(sum());
            depth--;
            if (peek() === ',') pos++;
            else break;
          }
        }
        expect(')');
        return { k: 'call', name: tok.v, args: args };
      }
      var ref = calcRef(tok.v);
      if (!ref) throw new CalcError('#NAME?');
      if (ref.bad) throw new CalcError('#REF!');
      if (peek() === ':') {
        pos++;
        var t2 = tokens[pos];
        if (!t2 || t2.t !== 'word') throw new CalcError('#ERR!');
        pos++;
        var ref2 = calcRef(t2.v);
        if (!ref2) throw new CalcError('#NAME?');
        if (ref2.bad) throw new CalcError('#REF!');
        return { k: 'range', a: ref, b: ref2 };
      }
      return { k: 'ref', col: ref.col, row: ref.row };
    }
    throw new CalcError('#ERR!');
  }
  var tree = sum();
  if (pos !== tokens.length) throw new CalcError('#ERR!');
  return tree;
}

var CALC_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

// Evaluates every cell. Returns a grid of { text, num } or { err }, where
// text is what is shown, and num is the number or null for text and empties.
function calcEvaluate(table) {
  var rows = table.rows;
  var memo = {};
  var visiting = {};

  function cell(col, row) {
    if (row >= rows.length || col >= (rows[0] || []).length) return { empty: true };
    var key = row + ',' + col;
    if (memo[key]) return memo[key];
    if (visiting[key]) throw new CalcError('#CYCLE!');
    var raw = rows[row][col];
    var result;
    if (raw.charAt(0) === '=') {
      visiting[key] = true;
      try {
        var v = calcEval(calcParse(raw.slice(1)));
        if (typeof v !== 'number' || !isFinite(v)) throw new CalcError(typeof v === 'number' ? '#NUM!' : '#VALUE!');
        result = { num: v };
      } catch (e) {
        if (!(e instanceof CalcError)) throw e;
        result = { err: e.calcCode };
      }
      delete visiting[key];
      // A cycle poisons everything on it; leave nothing half-computed behind.
    } else if (raw === '') {
      result = { empty: true };
    } else if (CALC_NUMBER.test(raw)) {
      result = { num: parseFloat(raw), literal: true };
    } else result = { text: raw };
    memo[key] = result;
    return result;
  }

  // A referenced cell's value as a number: empty is 0, text is #VALUE!.
  function scalar(col, row) {
    var c = cell(col, row);
    if (c.err) throw new CalcError(c.err);
    if (c.empty) return 0;
    if (c.num !== undefined) return c.num;
    throw new CalcError('#VALUE!');
  }

  function rangeValues(node) {
    var c0 = Math.min(node.a.col, node.b.col);
    var c1 = Math.max(node.a.col, node.b.col);
    var r0 = Math.min(node.a.row, node.b.row);
    var r1 = Math.max(node.a.row, node.b.row);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > 5200) throw new CalcError('#REF!');
    var values = [];
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        if (r >= rows.length || c >= rows[0].length) throw new CalcError('#REF!');
        var x = cell(c, r);
        if (x.err) throw new CalcError(x.err);
        if (x.num !== undefined) values.push(x.num); // text and empties are skipped
      }
    }
    return values;
  }

  function args(node) {
    var out = [];
    node.args.forEach(function (a) {
      if (a.k === 'range') out = out.concat(rangeValues(a));
      else out.push(calcEval(a));
    });
    return out;
  }

  function calcEval(node) {
    switch (node.k) {
      case 'num':
        return node.v;
      case 'ref':
        if (node.row >= rows.length || node.col >= rows[0].length) throw new CalcError('#REF!');
        return scalar(node.col, node.row);
      case 'range':
        throw new CalcError('#VALUE!');
      case 'neg':
        return -calcEval(node.x);
      case 'pct':
        return calcEval(node.x) / 100;
      case 'bin': {
        var a = calcEval(node.a);
        var b = calcEval(node.b);
        if (node.op === '+') return a + b;
        if (node.op === '-') return a - b;
        if (node.op === '*') return a * b;
        if (node.op === '/') {
          if (b === 0) throw new CalcError('#DIV/0!');
          return a / b;
        }
        return Math.pow(a, b);
      }
      case 'call':
        return callFunction(node);
    }
    throw new CalcError('#ERR!');
  }

  function callFunction(node) {
    var name = node.name;
    var vals;
    var need = function (n) {
      if (node.args.length !== n) throw new CalcError('#ERR!');
    };
    switch (name) {
      case 'SUM':
        return args(node).reduce(function (s, v) {
          return s + v;
        }, 0);
      case 'AVG':
      case 'AVERAGE':
      case 'MEAN':
        vals = args(node);
        if (vals.length === 0) throw new CalcError('#DIV/0!');
        return (
          vals.reduce(function (s, v) {
            return s + v;
          }, 0) / vals.length
        );
      case 'MIN':
        vals = args(node);
        return vals.length ? Math.min.apply(null, vals) : 0;
      case 'MAX':
        vals = args(node);
        return vals.length ? Math.max.apply(null, vals) : 0;
      case 'COUNT':
        return args(node).length;
      case 'PRODUCT':
        return args(node).reduce(function (s, v) {
          return s * v;
        }, 1);
      case 'ABS':
        need(1);
        return Math.abs(calcEval(node.args[0]));
      case 'SQRT': {
        need(1);
        var x = calcEval(node.args[0]);
        if (x < 0) throw new CalcError('#NUM!');
        return Math.sqrt(x);
      }
      case 'POW':
        need(2);
        return Math.pow(calcEval(node.args[0]), calcEval(node.args[1]));
      case 'ROUND':
      case 'FLOOR':
      case 'CEIL': {
        if (node.args.length < 1 || node.args.length > 2) throw new CalcError('#ERR!');
        var v = calcEval(node.args[0]);
        var digits = node.args.length === 2 ? Math.trunc(calcEval(node.args[1])) : 0;
        if (digits < -15 || digits > 15) throw new CalcError('#NUM!');
        var f = Math.pow(10, digits);
        var fn = name === 'ROUND' ? Math.round : name === 'FLOOR' ? Math.floor : Math.ceil;
        return fn(v * f) / f;
      }
      default:
        throw new CalcError('#NAME?');
    }
  }

  var grid = [];
  for (var r = 0; r < rows.length; r++) {
    var line = [];
    for (var c = 0; c < rows[0].length; c++) {
      var res;
      try {
        res = cell(c, r);
      } catch (e) {
        if (!(e instanceof CalcError)) throw e;
        res = { err: e.calcCode };
        memo[r + ',' + c] = res;
      }
      line.push(res);
    }
    grid.push(line);
  }
  return grid;
}

function calcFormat(n) {
  if (Object.is(n, -0)) n = 0;
  var s = String(parseFloat(n.toPrecision(12)));
  if (/e/.test(s)) return s;
  var parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function calcShown(res, raw) {
  if (res.err) return res.err;
  if (res.empty) return '';
  if (res.num !== undefined) return res.literal ? raw : calcFormat(res.num);
  return res.text;
}

function calcRender(source, theme) {
  var table = calcParseTable(source);
  var grid;
  try {
    grid = calcEvaluate(table);
  } catch (e) {
    if (e && (e.name === 'RangeError' || e.name === 'InternalError')) throw new Error('The formulas depend on each other too deeply to work out.');
    throw e;
  }
  var cols = table.rows[0].length;
  var shown = grid.map(function (line, r) {
    return line.map(function (res, c) {
      var s = calcShown(res, table.rows[r][c]);
      return s.length > CALC_MAX_CELL_TEXT ? s.slice(0, CALC_MAX_CELL_TEXT - 1) + '…' : s;
    });
  });
  var charW = 7.6;
  var pad = 12;
  var rowH = 28;
  var widths = [];
  for (var c = 0; c < cols; c++) {
    var w = 3;
    shown.forEach(function (line) {
      w = Math.max(w, line[c].length);
    });
    widths.push(Math.ceil(w * charW + pad * 2));
  }
  var total = widths.reduce(function (s, w) {
    return s + w;
  }, 0);
  var height = shown.length * rowH;
  var out = '<rect x="0.5" y="0.5" width="' + (total - 1) + '" height="' + (height - 1) + '" rx="4" fill="' + theme.surface + '" stroke="' + theme.border + '"/>';
  var y = 0;
  shown.forEach(function (line, r) {
    var isHeader = table.header && r === 0;
    if (isHeader) out += '<rect x="1" y="1" width="' + (total - 2) + '" height="' + (rowH - 1) + '" fill="' + theme.border + '" fill-opacity="0.5"/>';
    if (r > 0) out += '<line x1="0" y1="' + y + '" x2="' + total + '" y2="' + y + '" stroke="' + theme.border + '"/>';
    var x = 0;
    line.forEach(function (text, c) {
      var res = grid[r][c];
      var al = table.align[c];
      if (al === 'l' && res.num !== undefined && !isHeader) al = 'r';
      var tx = al === 'r' ? x + widths[c] - pad : al === 'c' ? x + widths[c] / 2 : x + pad;
      var anchor = al === 'r' ? 'end' : al === 'c' ? 'middle' : 'start';
      var isFormula = table.rows[r][c].charAt(0) === '=';
      var fill = res.err ? theme.text : isFormula ? theme.accent : theme.text;
      var extra = isHeader || res.err ? ' font-weight="600"' : '';
      if (text !== '') out += '<text x="' + tx + '" y="' + (y + 18) + '" text-anchor="' + anchor + '" font-size="13" font-family="monospace" fill="' + fill + '"' + extra + '>' + calcEscape(text) + '</text>';
      x += widths[c];
    });
    y += rowH;
  });
  var vx = 0;
  for (var k = 0; k < cols - 1; k++) {
    vx += widths[k];
    out += '<line x1="' + vx + '" y1="0" x2="' + vx + '" y2="' + height + '" stroke="' + theme.border + '"/>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + total + '" height="' + height + '" viewBox="0 0 ' + total + ' ' + height + '">' + out + '</svg>';
}

kanso.fences.register('calc', function (args) {
  return calcRender(args.source, args.theme);
});
