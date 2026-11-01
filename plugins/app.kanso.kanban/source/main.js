// Kanban: draws a ```kanban block as board columns, in the theme's colours.
//
//   ## To do
//   - Write the docs
//   ## Done
//   - [x] Ship it

var MAX_COLUMNS = 12;
var MAX_CARDS = 100;
var COL_W = 220;
var GAP = 16;
var PAD = 12;
var CHARS = 28;
var MAX_LINES = 4;

function esc(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�')
    .replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function trunc(text, max) {
  var chars = Array.from(String(text));
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, Math.max(1, max - 1)).join('') + '…';
}

function r2(n) { return Math.round(n * 100) / 100; }

// -> [{ title, cards: [{ text, done: bool|null }] }]; done is null when the
// card has no checkbox.
function parseBoard(source) {
  var cols = [];
  String(source).split(/\r?\n/).forEach(function (raw, i) {
    var t = raw.trim();
    if (!t) return;
    var no = i + 1;
    var h = /^#{1,6}(?:\s+(.*))?$/.exec(t);
    if (h) {
      if (!(h[1] || "").trim()) throw new Error('Line ' + no + ': a column needs a name after "##".');
      if (cols.length >= MAX_COLUMNS) throw new Error('At most ' + MAX_COLUMNS + ' columns.');
      cols.push({ title: h[1].trim(), cards: [] });
      return;
    }
    var c = /^[-*+]\s+(?:\[([ xX])\](?:\s+|$))?(.*)$/.exec(t);
    if (!c) throw new Error('Line ' + no + ': expected "## Column" or "- card".');
    if (!cols.length) throw new Error('Line ' + no + ': put a "## Column" heading before the first card.');
    if (!c[2].trim()) throw new Error('Line ' + no + ': the card is empty.');
    var col = cols[cols.length - 1];
    if (col.cards.length >= MAX_CARDS) throw new Error('At most ' + MAX_CARDS + ' cards a column.');
    col.cards.push({ text: c[2].trim(), done: c[1] === undefined ? null : c[1] !== ' ' });
  });
  if (!cols.length) throw new Error('Write "## Column" headings with "- card" lines under them.');
  return cols;
}

// Breaks text into at most MAX_LINES lines of CHARS characters.
function wrap(text, width) {
  var words = String(text).split(/\s+/).filter(Boolean);
  var lines = [];
  var cur = '';
  words.forEach(function (w) {
    w = Array.from(w).length > width ? trunc(w, width) : w;
    var next = cur ? cur + ' ' + w : w;
    if (Array.from(next).length > width && cur) { lines.push(cur); cur = w; } else { cur = next; }
  });
  if (cur) lines.push(cur);
  if (lines.length > MAX_LINES) {
    lines = lines.slice(0, MAX_LINES);
    lines[MAX_LINES - 1] = trunc(lines[MAX_LINES - 1] + '……', width);
    if (!/…$/.test(lines[MAX_LINES - 1])) lines[MAX_LINES - 1] += '…';
  }
  return lines.length ? lines : [''];
}

function renderBoard(source, theme) {
  var cols = parseBoard(source);
  var laid = cols.map(function (col) {
    return col.cards.map(function (card) {
      var indent = card.done === null ? 0 : 20;
      var lines = wrap(card.text, CHARS - (indent ? 3 : 0));
      return { card: card, lines: lines, h: 16 + lines.length * 17 };
    });
  });
  var colH = Math.max.apply(null, laid.map(function (cards) {
    return 44 + cards.reduce(function (a, c) { return a + c.h + 8; }, 0) + 4;
  }));
  colH = Math.max(colH, 80);
  var W = PAD * 2 + cols.length * COL_W + (cols.length - 1) * GAP;
  var H = colH + PAD * 2;
  var body = '';
  cols.forEach(function (col, ci) {
    var x = PAD + ci * (COL_W + GAP);
    body += '<rect x="' + x + '" y="' + PAD + '" width="' + COL_W + '" height="' + colH + '" rx="8" fill="' + theme.surface + '" stroke="' + theme.border + '"/>' +
      '<text x="' + (x + 12) + '" y="' + (PAD + 27) + '" font-size="14" font-weight="bold" fill="' + theme.text + '">' + esc(trunc(col.title, 22)) + '</text>' +
      '<text x="' + (x + COL_W - 12) + '" y="' + (PAD + 27) + '" font-size="12" text-anchor="end" fill="' + theme.muted + '">' + col.cards.length + '</text>';
    var y = PAD + 40;
    laid[ci].forEach(function (item) {
      var done = item.card.done === true;
      body += '<rect x="' + (x + 8) + '" y="' + y + '" width="' + (COL_W - 16) + '" height="' + item.h + '" rx="6" fill="' + theme.background + '" stroke="' + theme.border + '"/>';
      var tx = x + 18;
      if (item.card.done !== null) {
        var cx = x + 24, cy = y + 16;
        if (done) {
          body += '<circle cx="' + cx + '" cy="' + cy + '" r="7" fill="' + theme.accent + '"/>' +
            '<path d="M' + (cx - 3.5) + ' ' + cy + ' L' + (cx - 1) + ' ' + (cy + 3) + ' L' + (cx + 3.5) + ' ' + (cy - 3) + '" fill="none" stroke="' + theme.background + '" stroke-width="1.8"/>';
        } else {
          body += '<circle cx="' + cx + '" cy="' + cy + '" r="6.5" fill="none" stroke="' + theme.muted + '" stroke-width="1.5"/>';
        }
        tx = x + 38;
      }
      item.lines.forEach(function (line, li) {
        var ty = y + 20 + li * 17;
        body += '<text x="' + tx + '" y="' + ty + '" font-size="13" fill="' + (done ? theme.muted : theme.text) + '">' + esc(line) + '</text>';
        if (done) {
          var w = Array.from(line).length * 6.6;
          body += '<line x1="' + tx + '" y1="' + (ty - 4) + '" x2="' + r2(tx + w) + '" y2="' + (ty - 4) + '" stroke="' + theme.muted + '"/>';
        }
      });
      y += item.h + 8;
    });
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="sans-serif">' + body + '</svg>';
}

kanso.fences.register('kanban', function (args) {
  return renderBoard(args.source, args.theme);
});
