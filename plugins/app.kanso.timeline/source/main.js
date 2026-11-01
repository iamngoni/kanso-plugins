// Timeline: draws a ```timeline block as a timeline (dated items) or a Gantt
// chart (when any item is a range), in the theme's colours.
//
//   2026-01-05: Kickoff
//   2026-01-05..2026-02-01: Build

var MAX_ITEMS = 100;
var DAY = 86400000;
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

// "2026-01-05" -> days since 1970-01-01, or null if not a real date.
function parseDate(text) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1000 || mo < 1 || mo > 12 || d < 1) return null;
  var t = Date.UTC(y, mo - 1, d);
  var back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / DAY);
}

function dateParts(day) {
  var d = new Date(day * DAY);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

function isoDate(day) {
  var p = dateParts(day);
  return pad(p.y, 4) + '-' + pad(p.m + 1, 2) + '-' + pad(p.d, 2);
}

function shortDate(day) {
  var p = dateParts(day);
  return MONTHS[p.m] + ' ' + p.d;
}

// -> [{ start, end (days), label, range: bool, no }] sorted by start
function parseTimeline(source) {
  var items = [];
  String(source).split(/\r?\n/).forEach(function (raw, i) {
    var t = raw.trim();
    if (!t) return;
    var no = i + 1;
    var m = /^(\d{4}-\d{2}-\d{2})\s*(?:\.\.\s*(\d{4}-\d{2}-\d{2}))?\s*:\s*(.*)$/.exec(t);
    if (!m) throw new Error('Line ' + no + ': expected "2026-01-05: Label" or "2026-01-05..2026-02-01: Label".');
    var start = parseDate(m[1]);
    if (start === null) throw new Error('Line ' + no + ': "' + m[1] + '" is not a real date.');
    var end = start;
    if (m[2] !== undefined) {
      end = parseDate(m[2]);
      if (end === null) throw new Error('Line ' + no + ': "' + m[2] + '" is not a real date.');
      if (end < start) throw new Error('Line ' + no + ': the range ends before it starts.');
    }
    var label = m[3].trim();
    if (!label) throw new Error('Line ' + no + ': add a label after the colon.');
    items.push({ start: start, end: end, label: label, range: m[2] !== undefined, no: no });
  });
  if (!items.length) throw new Error('Write dated items such as "2026-01-05: Kickoff" or "2026-01-05..2026-02-01: Build".');
  if (items.length > MAX_ITEMS) throw new Error('At most ' + MAX_ITEMS + ' items.');
  items.sort(function (a, b) { return a.start - b.start || a.end - b.end || a.no - b.no; });
  return items;
}

// Axis ticks across [min, max] days -> [{ day, label }], at most about 12.
function axisTicks(min, max) {
  var span = max - min;
  var ticks = [];
  var a = dateParts(min);
  if (span > 45) {
    var months = (dateParts(max).y - a.y) * 12 + dateParts(max).m - a.m + 1;
    var step = [1, 2, 3, 6, 12, 24, 60, 120, 240, 600].filter(function (s) { return months / s <= 12; })[0] || 1200;
    var idx = a.y * 12 + a.m;
    idx = Math.ceil(idx / step) * step;
    for (;;) {
      var y = Math.floor(idx / 12), mo = idx % 12;
      var day = Math.round(Date.UTC(y, mo, 1) / DAY);
      if (day > max) break;
      if (day >= min) ticks.push({ day: day, label: step >= 12 ? String(y) : MONTHS[mo] + (mo === 0 || step > 1 ? ' ' + y : '') });
      idx += step;
      if (ticks.length > 60) break;
    }
  } else {
    var steps = [1, 2, 5, 7, 14];
    var s2 = steps.filter(function (s) { return span / s <= 12; })[0] || 14;
    for (var d = min; d <= max; d += s2) ticks.push({ day: d, label: shortDate(d) });
  }
  if (!ticks.length) ticks.push({ day: min, label: shortDate(min) });
  return ticks;
}

function wrapSvg(width, height, theme, body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + r2(height) + '" viewBox="0 0 ' + width + ' ' + r2(height) + '" font-family="sans-serif">' + body + '</svg>';
}

function drawGantt(items, theme) {
  var W = 640, labelW = 170, right = 100, top = 34, rowH = 28;
  var min = Math.min.apply(null, items.map(function (i) { return i.start; }));
  var max = Math.max.apply(null, items.map(function (i) { return i.end; }));
  if (max === min) max = min + 1;
  var plotW = W - labelW - right;
  function xOf(day) { return labelW + ((day - min) / (max - min)) * plotW; }
  var H = top + items.length * rowH + 12;
  var body = '';
  axisTicks(min, max).forEach(function (t) {
    var x = r2(xOf(t.day));
    body += '<line x1="' + x + '" y1="' + (top - 6) + '" x2="' + x + '" y2="' + (H - 8) + '" stroke="' + theme.border + '"/>' +
      '<text x="' + x + '" y="' + (top - 12) + '" font-size="11" text-anchor="middle" fill="' + theme.muted + '">' + esc(t.label) + '</text>';
  });
  items.forEach(function (it, i) {
    var y = top + i * rowH;
    var mid = y + rowH / 2;
    body += '<text x="' + (labelW - 10) + '" y="' + r2(mid + 4) + '" font-size="12" text-anchor="end" fill="' + theme.text + '">' + esc(trunc(it.label, 24)) + '</text>';
    var x0 = xOf(it.start);
    var dateText;
    var endX;
    if (it.range) {
      var x1 = Math.max(xOf(it.end), x0 + 3);
      body += '<rect x="' + r2(x0) + '" y="' + r2(mid - 7) + '" width="' + r2(x1 - x0) + '" height="14" rx="3" fill="' + theme.accent + '"><title>' + esc(it.label) + '</title></rect>';
      dateText = shortDate(it.start) + ' – ' + shortDate(it.end);
      endX = x1;
    } else {
      body += '<polygon points="' + r2(x0) + ',' + r2(mid - 8) + ' ' + r2(x0 + 8) + ',' + r2(mid) + ' ' + r2(x0) + ',' + r2(mid + 8) + ' ' + r2(x0 - 8) + ',' + r2(mid) + '" fill="' + theme.accent + '"><title>' + esc(it.label) + '</title></polygon>';
      dateText = shortDate(it.start);
      endX = x0 + 8;
    }
    var tx = endX + 6;
    var anchor = 'start';
    if (tx + dateText.length * 6 > W - 4) { tx = (it.range ? xOf(it.start) : x0 - 8) - 6; anchor = 'end'; }
    body += '<text x="' + r2(tx) + '" y="' + r2(mid + 4) + '" font-size="11" text-anchor="' + anchor + '" fill="' + theme.muted + '">' + esc(dateText) + '</text>';
  });
  return wrapSvg(W, H, theme, body);
}

function drawTimeline(items, theme) {
  var W = 640, left = 60, right = 60;
  var min = items[0].start;
  var max = items[items.length - 1].start;
  var multi = max > min;
  var plotW = W - left - right;
  function xOf(day) { return multi ? left + ((day - min) / (max - min)) * plotW : W / 2; }
  var levels = [-1, 1, -2, 2];
  var unit = 38;
  var H = 4 * unit + 40;
  var axisY = H / 2;
  var body = '<line x1="24" y1="' + axisY + '" x2="' + (W - 24) + '" y2="' + axisY + '" stroke="' + theme.muted + '" stroke-width="2"/>';
  if (multi) {
    axisTicks(min, max).forEach(function (t) {
      var x = r2(xOf(t.day));
      body += '<line x1="' + x + '" y1="' + (axisY - 4) + '" x2="' + x + '" y2="' + (axisY + 4) + '" stroke="' + theme.muted + '"/>';
    });
  }
  items.forEach(function (it, i) {
    var x = r2(xOf(it.start));
    var lv = levels[i % 4];
    var y = axisY + lv * unit * 0.85 + (lv < 0 ? 0 : 0);
    var anchor = x < 90 ? 'start' : x > W - 90 ? 'end' : 'middle';
    var ly = lv < 0 ? y - 16 : y + 28;
    body += '<line x1="' + x + '" y1="' + axisY + '" x2="' + x + '" y2="' + r2(lv < 0 ? y - 10 : y + 4) + '" stroke="' + theme.border + '"/>' +
      '<circle cx="' + x + '" cy="' + axisY + '" r="5" fill="' + theme.accent + '" stroke="' + theme.background + '" stroke-width="2"/>' +
      '<text x="' + x + '" y="' + r2(lv < 0 ? y - 4 - 12 : y + 16) + '" font-size="12" text-anchor="' + anchor + '" fill="' + theme.text + '">' + esc(trunc(it.label, 28)) + '</text>' +
      '<text x="' + x + '" y="' + r2(lv < 0 ? y - 4 : y + 30) + '" font-size="11" text-anchor="' + anchor + '" fill="' + theme.muted + '">' + esc(isoDate(it.start)) + '</text>';
  });
  return wrapSvg(W, H, theme, body);
}

function renderTimeline(source, theme) {
  var items = parseTimeline(source);
  var hasRange = items.some(function (i) { return i.range; });
  return hasRange ? drawGantt(items, theme) : drawTimeline(items, theme);
}

kanso.fences.register('timeline', function (args) {
  return renderTimeline(args.source, args.theme);
});
