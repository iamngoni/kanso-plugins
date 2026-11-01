// Calendar: draws a ```calendar block as a month grid with marked days.
//
//   month: 2026-11
//   week: mon            (optional: mon, the default, or sun)
//   2026-11-03: Dentist

var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var MAX_EVENTS = 200;
var CELL_W = 88;
var CELL_H = 84;

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

function daysIn(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

// -> { year, month (1-12), sunFirst, events: { day: [text] } }
function parseCalendar(source) {
  var year = null, month = null, sunFirst = false;
  var events = {};
  var count = 0;
  var pending = [];
  String(source).split(/\r?\n/).forEach(function (raw, i) {
    var t = raw.trim();
    if (!t) return;
    var no = i + 1;
    var m = /^month\s*:\s*(.*)$/i.exec(t);
    if (m) {
      var mm = /^(\d{4})-(\d{2})$/.exec(m[1].trim());
      if (!mm || +mm[1] < 1000 || +mm[2] < 1 || +mm[2] > 12) {
        throw new Error('Line ' + no + ': month must look like "month: 2026-11".');
      }
      if (year !== null) throw new Error('Line ' + no + ': only one month: line is allowed.');
      year = +mm[1];
      month = +mm[2];
      return;
    }
    var w = /^week\s*:\s*(.*)$/i.exec(t);
    if (w) {
      var v = w[1].trim().toLowerCase();
      if (v !== 'mon' && v !== 'sun') throw new Error('Line ' + no + ': week must be "mon" or "sun".');
      sunFirst = v === 'sun';
      return;
    }
    var e = /^(\d{4})-(\d{2})-(\d{2})\s*:\s*(.*)$/.exec(t);
    if (!e) throw new Error('Line ' + no + ': expected "month: 2026-11", "week: mon" or "2026-11-03: Label".');
    if (!e[4].trim()) throw new Error('Line ' + no + ': add a label after the colon.');
    if (++count > MAX_EVENTS) throw new Error('At most ' + MAX_EVENTS + ' marked days.');
    pending.push({ no: no, y: +e[1], m: +e[2], d: +e[3], text: e[4].trim(), raw: t.slice(0, 10) });
  });
  if (year === null) throw new Error('Start with "month: 2026-11", then add lines like "2026-11-03: Dentist".');
  pending.forEach(function (p) {
    if (p.m < 1 || p.m > 12 || p.d < 1 || p.d > daysIn(p.y, p.m)) {
      throw new Error('Line ' + p.no + ': ' + p.raw + ' is not a real date.');
    }
    if (p.y !== year || p.m !== month) {
      throw new Error('Line ' + p.no + ': ' + p.raw + ' is outside ' + year + '-' + pad(month, 2) + '.');
    }
    (events[p.d] = events[p.d] || []).push(p.text);
  });
  return { year: year, month: month, sunFirst: sunFirst, events: events };
}

function renderCalendar(source, theme) {
  var cal = parseCalendar(source);
  var total = daysIn(cal.year, cal.month);
  // Weekday of the 1st, 0 = Monday.
  var first = (new Date(Date.UTC(cal.year, cal.month - 1, 1)).getUTCDay() + 6) % 7;
  if (cal.sunFirst) first = (first + 1) % 7;
  var weeks = Math.ceil((first + total) / 7);
  var left = 12, top = 52;
  var W = left * 2 + 7 * CELL_W;
  var H = top + 22 + weeks * CELL_H + 12;
  var names = cal.sunFirst ? ['Sun'].concat(DAYS.slice(0, 6)) : DAYS;
  var body = '<text x="' + left + '" y="32" font-size="20" font-weight="bold" fill="' + theme.text + '">' + esc(MONTHS[cal.month - 1] + ' ' + cal.year) + '</text>';
  names.forEach(function (n, i) {
    body += '<text x="' + (left + i * CELL_W + CELL_W / 2) + '" y="' + (top + 14) + '" font-size="12" text-anchor="middle" fill="' + theme.muted + '">' + n + '</text>';
  });
  var gridTop = top + 22;
  body += '<rect x="' + left + '" y="' + gridTop + '" width="' + 7 * CELL_W + '" height="' + weeks * CELL_H + '" rx="6" fill="' + theme.background + '" stroke="' + theme.border + '"/>';
  for (var r = 1; r < weeks; r++) {
    body += '<line x1="' + left + '" y1="' + (gridTop + r * CELL_H) + '" x2="' + (left + 7 * CELL_W) + '" y2="' + (gridTop + r * CELL_H) + '" stroke="' + theme.border + '"/>';
  }
  for (var c = 1; c < 7; c++) {
    body += '<line x1="' + (left + c * CELL_W) + '" y1="' + gridTop + '" x2="' + (left + c * CELL_W) + '" y2="' + (gridTop + weeks * CELL_H) + '" stroke="' + theme.border + '"/>';
  }
  for (var d = 1; d <= total; d++) {
    var idx = first + d - 1;
    var x = left + (idx % 7) * CELL_W;
    var y = gridTop + Math.floor(idx / 7) * CELL_H;
    var marks = cal.events[d];
    if (marks) {
      body += '<rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="' + (CELL_W - 2) + '" height="' + (CELL_H - 2) + '" fill="' + theme.surface + '"/>' +
        '<circle cx="' + (x + 16) + '" cy="' + (y + 16) + '" r="11" fill="' + theme.accent + '"/>' +
        '<text x="' + (x + 16) + '" y="' + (y + 20.5) + '" font-size="12" text-anchor="middle" font-weight="bold" fill="' + theme.background + '">' + d + '</text>';
      marks.slice(0, 2).forEach(function (txt, k) {
        body += '<text x="' + (x + 6) + '" y="' + (y + 44 + k * 14) + '" font-size="11" fill="' + theme.text + '"><title>' + esc(txt) + '</title>' + esc(trunc(txt, 13)) + '</text>';
      });
      if (marks.length > 2) {
        body += '<text x="' + (x + 6) + '" y="' + (y + 44 + 2 * 14) + '" font-size="10" fill="' + theme.muted + '">+' + (marks.length - 2) + ' more</text>';
      }
    } else {
      body += '<text x="' + (x + 16) + '" y="' + (y + 20) + '" font-size="12" text-anchor="middle" fill="' + theme.muted + '">' + d + '</text>';
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="sans-serif">' + body + '</svg>';
}

kanso.fences.register('calendar', function (args) {
  return renderCalendar(args.source, args.theme);
});
