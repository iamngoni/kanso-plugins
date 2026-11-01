// Charts: draws a ```chart block as an SVG bar, line, area or pie chart with
// axes, labels and a legend, using only the theme's colours.
//
//   type: line            (optional first line: bar, line, pie or area)
//   label: value          (one point per line)
//
// or CSV, with an optional header row naming the series:
//
//   month, 2025, 2026
//   Jan, 4, 6
//   Feb, 5, 9

var CHART_TYPES = ['bar', 'line', 'pie', 'area'];
var MAX_POINTS = 200;
var MAX_SERIES = 8;
var MAX_ABS = 1e15;

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

function parseNumber(text, lineNo) {
  var t = text.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) {
    throw new Error('Line ' + lineNo + ': "' + trunc(t, 24) + '" is not a number.');
  }
  var n = Number(t);
  if (!isFinite(n) || Math.abs(n) > MAX_ABS) {
    throw new Error('Line ' + lineNo + ': the number "' + trunc(t, 24) + '" is too large.');
  }
  return n;
}

function isNumeric(text) { return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text.trim()); }

// -> { type, labels: [string], series: [{ name, values: [number] }], named }
function parseChart(source) {
  var lines = [];
  String(source).split(/\r?\n/).forEach(function (raw, i) {
    var t = raw.trim();
    if (t) lines.push({ no: i + 1, text: t });
  });
  var type = 'bar';
  if (lines.length && /^type\s*:/i.test(lines[0].text)) {
    var v = lines[0].text.replace(/^type\s*:/i, '').trim().toLowerCase();
    if (CHART_TYPES.indexOf(v) < 0) {
      throw new Error('Line ' + lines[0].no + ': type must be one of ' + CHART_TYPES.join(', ') + '.');
    }
    type = v;
    lines.shift();
  }
  if (!lines.length) {
    throw new Error('Write one "label: value" per line, or CSV rows like "label, 1, 2". Start with "type: bar|line|pie|area" to pick a chart.');
  }
  var csv = lines.some(function (l) { return l.text.indexOf(',') >= 0; });
  var labels = [];
  var series = [];
  var named = false;
  if (!csv) {
    var values = [];
    lines.forEach(function (l) {
      var at = l.text.lastIndexOf(':');
      if (at < 1) throw new Error('Line ' + l.no + ': expected "label: value".');
      labels.push(l.text.slice(0, at).trim());
      values.push(parseNumber(l.text.slice(at + 1), l.no));
    });
    series.push({ name: 'Value', values: values });
  } else {
    var rows = lines.map(function (l) {
      return { no: l.no, cells: l.text.split(',').map(function (c) { return c.trim(); }) };
    });
    var cols = rows[0].cells.length;
    if (cols < 2) throw new Error('Line ' + rows[0].no + ': CSV rows need a label and at least one value.');
    if (cols - 1 > MAX_SERIES) throw new Error('At most ' + MAX_SERIES + ' series (columns after the label).');
    var header = rows[0].cells.slice(1).every(function (c) { return !isNumeric(c); });
    var names = [];
    for (var s = 1; s < cols; s++) names.push(header && rows[0].cells[s] ? rows[0].cells[s] : 'Series ' + s);
    if (header) { rows.shift(); named = true; }
    if (!rows.length) throw new Error('The header row needs data rows below it.');
    series = names.map(function (n) { return { name: n, values: [] }; });
    rows.forEach(function (row) {
      if (row.cells.length !== cols) {
        throw new Error('Line ' + row.no + ': expected ' + cols + ' columns, found ' + row.cells.length + '.');
      }
      labels.push(row.cells[0]);
      for (var k = 1; k < cols; k++) series[k - 1].values.push(parseNumber(row.cells[k], row.no));
    });
  }
  if (labels.length > MAX_POINTS) throw new Error('At most ' + MAX_POINTS + ' points.');
  if (type === 'pie') {
    series = [series[0]];
    series[0].values.forEach(function (v) {
      if (v < 0) throw new Error('A pie chart can\'t show negative values.');
    });
    if (!series[0].values.some(function (v) { return v > 0; })) {
      throw new Error('A pie chart needs at least one value above zero.');
    }
  }
  return { type: type, labels: labels, series: series, named: named };
}

function niceTicks(min, max) {
  var lo = Math.min(0, min);
  var hi = Math.max(0, max);
  if (lo === hi) hi = 1;
  var raw = (hi - lo) / 5;
  var mag = Math.pow(10, Math.floor(Math.log10(raw)));
  var norm = raw / mag;
  var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  var start = Math.floor(lo / step) * step;
  var end = Math.ceil(hi / step) * step;
  var ticks = [];
  for (var i = 0; i <= 12; i++) {
    var v = Number((start + i * step).toPrecision(12));
    ticks.push(v);
    if (v >= end) break;
  }
  return ticks;
}

function fmt(v) {
  var a = Math.abs(v);
  if (a >= 1e9) return Number((v / 1e9).toPrecision(3)) + 'B';
  if (a >= 1e6) return Number((v / 1e6).toPrecision(3)) + 'M';
  if (a >= 1e4) return Number((v / 1e3).toPrecision(3)) + 'k';
  return String(Number(v.toPrecision(4)));
}

function style(theme, i) {
  var table = [
    { fill: theme.accent, op: 1, dash: '' },
    { fill: theme.text, op: 0.7, dash: '6 3' },
    { fill: theme.accent, op: 0.5, dash: '2 3' },
    { fill: theme.muted, op: 1, dash: '8 3 2 3' },
    { fill: theme.text, op: 0.4, dash: '4 2' },
    { fill: theme.accent, op: 0.3, dash: '1 3' },
    { fill: theme.muted, op: 0.55, dash: '10 4' },
    { fill: theme.text, op: 0.2, dash: '3 3' },
  ];
  return table[i % table.length];
}

function legendBlock(theme, entries, width, top) {
  // entries: [{ text, style }] -> { svg, height }
  var x = 16;
  var y = top;
  var out = '';
  var rowH = 20;
  entries.forEach(function (e, i) {
    var label = trunc(e.text, 18);
    var w = 22 + Array.from(label).length * 6.6 + 14;
    if (x + w > width - 8 && x > 16) { x = 16; y += rowH; }
    var st = e.style;
    out += '<rect x="' + r2(x) + '" y="' + (y - 9) + '" width="12" height="12" rx="2" fill="' + st.fill + '" fill-opacity="' + st.op + '" stroke="' + theme.border + '"/>' +
      '<text x="' + r2(x + 18) + '" y="' + (y + 1) + '" font-size="12" fill="' + theme.text + '">' + esc(label) + '</text>';
    x += w;
  });
  return { svg: out, height: y - top + rowH };
}

function wrapSvg(width, height, theme, body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + r2(height) + '" viewBox="0 0 ' + width + ' ' + r2(height) + '" font-family="sans-serif">' + body + '</svg>';
}

function drawPie(chart, theme) {
  var W = 560;
  var labels = chart.labels;
  var vals = chart.series[0].values;
  var total = vals.reduce(function (a, b) { return a + b; }, 0);
  var cx = 140, cy = 140, R = 110;
  var body = '';
  var live = [];
  vals.forEach(function (v, i) { if (v > 0) live.push(i); });
  var a = -Math.PI / 2;
  if (live.length === 1) {
    var st = style(theme, live[0]);
    body += '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + st.fill + '" fill-opacity="' + st.op + '" stroke="' + theme.background + '" stroke-width="2"/>';
  } else {
    live.forEach(function (i) {
      var sweep = (vals[i] / total) * Math.PI * 2;
      var a1 = a + sweep;
      var x0 = cx + R * Math.cos(a), y0 = cy + R * Math.sin(a);
      var x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      var st2 = style(theme, i);
      body += '<path d="M' + cx + ' ' + cy + ' L' + r2(x0) + ' ' + r2(y0) + ' A' + R + ' ' + R + ' 0 ' + (sweep > Math.PI ? 1 : 0) + ' 1 ' + r2(x1) + ' ' + r2(y1) + ' Z" fill="' + st2.fill + '" fill-opacity="' + st2.op + '" stroke="' + theme.background + '" stroke-width="2"/>';
      a = a1;
    });
  }
  var lx = 290;
  vals.forEach(function (v, i) {
    var y = 28 + i * 20;
    var st3 = style(theme, i);
    var pct = Math.round((v / total) * 1000) / 10;
    body += '<rect x="' + lx + '" y="' + (y - 10) + '" width="12" height="12" rx="2" fill="' + st3.fill + '" fill-opacity="' + st3.op + '" stroke="' + theme.border + '"/>' +
      '<text x="' + (lx + 18) + '" y="' + y + '" font-size="12" fill="' + theme.text + '">' + esc(trunc(labels[i], 22)) + '</text>' +
      '<text x="' + (W - 12) + '" y="' + y + '" font-size="12" text-anchor="end" fill="' + theme.muted + '">' + esc(fmt(v)) + ' (' + pct + '%)</text>';
  });
  var H = Math.max(2 * cy + 20, 28 + vals.length * 20 + 12);
  return wrapSvg(W, H, theme, body);
}

function drawXY(chart, theme) {
  var W = 560;
  var n = chart.labels.length;
  var all = [];
  chart.series.forEach(function (s) { all = all.concat(s.values); });
  var ticks = niceTicks(Math.min.apply(null, all), Math.max.apply(null, all));
  var lo = ticks[0], hi = ticks[ticks.length - 1];
  var left = 56, right = 16, top = 16, plotH = 220;
  var plotW = W - left - right;
  var slot = plotW / n;
  var rotate = slot < 46;
  var maxChars = Math.max(4, Math.floor(slot / 6.5));
  var every = rotate ? Math.max(1, Math.ceil(14 / slot)) : 1;
  var longest = 0;
  chart.labels.forEach(function (l, i) { if (i % every === 0) longest = Math.max(longest, Math.min(Array.from(l).length, 14)); });
  var axisH = rotate ? 14 + longest * 5 : 24;
  var showLegend = chart.series.length > 1 || chart.named;
  var legend = showLegend
    ? legendBlock(theme, chart.series.map(function (s, i) { return { text: s.name, style: style(theme, i) }; }), W, top + plotH + axisH + 18)
    : { svg: '', height: 0 };
  var H = top + plotH + axisH + (showLegend ? legend.height + 14 : 8);
  function yOf(v) { return top + plotH * (1 - (v - lo) / (hi - lo)); }
  function xOf(i) { return left + slot * (i + 0.5); }
  var body = '';
  ticks.forEach(function (t) {
    var y = r2(yOf(t));
    body += '<line x1="' + left + '" y1="' + y + '" x2="' + (W - right) + '" y2="' + y + '" stroke="' + theme.border + '" stroke-width="1"/>' +
      '<text x="' + (left - 6) + '" y="' + r2(y + 4) + '" font-size="11" text-anchor="end" fill="' + theme.muted + '">' + esc(fmt(t)) + '</text>';
  });
  var base = r2(yOf(0));
  body += '<line x1="' + left + '" y1="' + top + '" x2="' + left + '" y2="' + (top + plotH) + '" stroke="' + theme.muted + '"/>' +
    '<line x1="' + left + '" y1="' + base + '" x2="' + (W - right) + '" y2="' + base + '" stroke="' + theme.muted + '"/>';
  chart.labels.forEach(function (l, i) {
    if (i % every !== 0) return;
    var x = r2(xOf(i));
    var y = top + plotH + 16;
    if (rotate) {
      body += '<text x="' + x + '" y="' + (top + plotH + 12) + '" font-size="11" text-anchor="end" fill="' + theme.text + '" transform="rotate(-45 ' + x + ' ' + (top + plotH + 12) + ')">' + esc(trunc(l, 14)) + '</text>';
    } else {
      body += '<text x="' + x + '" y="' + y + '" font-size="11" text-anchor="middle" fill="' + theme.text + '">' + esc(trunc(l, maxChars)) + '</text>';
    }
  });
  var ns = chart.series.length;
  chart.series.forEach(function (s, si) {
    var st = style(theme, si);
    if (chart.type === 'bar') {
      var group = slot * 0.8;
      var bw = group / ns;
      s.values.forEach(function (v, i) {
        var x = left + slot * i + (slot - group) / 2 + bw * si;
        var y1 = yOf(v), y0 = yOf(0);
        var y = Math.min(y1, y0);
        var h = Math.max(1, Math.abs(y0 - y1));
        body += '<rect x="' + r2(x) + '" y="' + r2(y) + '" width="' + r2(Math.max(1, bw - 1)) + '" height="' + r2(h) + '" fill="' + st.fill + '" fill-opacity="' + st.op + '"><title>' + esc(trunc(chart.labels[i], 40)) + ': ' + esc(fmt(v)) + '</title></rect>';
      });
    } else {
      var pts = s.values.map(function (v, i) { return r2(xOf(i)) + ',' + r2(yOf(v)); });
      if (chart.type === 'area') {
        body += '<polygon points="' + r2(xOf(0)) + ',' + base + ' ' + pts.join(' ') + ' ' + r2(xOf(n - 1)) + ',' + base + '" fill="' + st.fill + '" fill-opacity="' + r2(st.op * 0.25) + '" stroke="none"/>';
      }
      body += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + st.fill + '" stroke-opacity="' + st.op + '" stroke-width="2"' + (st.dash ? ' stroke-dasharray="' + st.dash + '"' : '') + ' stroke-linejoin="round"/>';
      if (n <= 40) {
        s.values.forEach(function (v, i) {
          body += '<circle cx="' + r2(xOf(i)) + '" cy="' + r2(yOf(v)) + '" r="3" fill="' + theme.background + '" stroke="' + st.fill + '" stroke-opacity="' + st.op + '" stroke-width="2"><title>' + esc(trunc(chart.labels[i], 40)) + ': ' + esc(fmt(v)) + '</title></circle>';
        });
      }
    }
  });
  return wrapSvg(W, H, theme, body + legend.svg);
}

function renderChart(source, theme) {
  var chart = parseChart(source);
  return chart.type === 'pie' ? drawPie(chart, theme) : drawXY(chart, theme);
}

kanso.fences.register('chart', function (args) {
  return renderChart(args.source, args.theme);
});
