// ABC music notation: draws an ```abc block (a common subset of ABC 2.1) as
// a treble-clef staff. The renderer is pure: source and theme in, SVG out.

var ABC_MAX_EVENTS = 600;
var ABC_STEP = 4; // half a line gap, in pixels
var ABC_WIDTH = 600;

function abcEscape(text) {
  return String(text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

var ABC_LETTER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
var ABC_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, F: -1 };
var ABC_MODES = { maj: 0, ion: 0, min: -3, m: -3, aeo: -3, mix: -1, dor: -2, phr: -4, lyd: 1, loc: -5 };
var ABC_SHARP_ORDER = [['F', 5], ['C', 5], ['G', 5], ['D', 5], ['A', 4], ['E', 5], ['B', 4]];
var ABC_FLAT_ORDER = [['B', 4], ['E', 5], ['A', 4], ['D', 5], ['G', 4], ['C', 5], ['F', 4]];

function abcGcd(a, b) {
  return b === 0 ? a : abcGcd(b, a % b);
}

// Returns the number of sharps (positive) or flats (negative).
function abcKey(value) {
  var v = value.trim();
  if (v === '' || /^none$/i.test(v) || /^hp$/i.test(v) || /^hp$/i.test(v)) return 0;
  var m = /^([A-Ga-g])([#b]?)\s*([A-Za-z]*)/.exec(v);
  if (!m) throw new Error('K: "' + v.slice(0, 20) + '" is not a key. Try K:G, K:Dm or K:Bb.');
  var fifths = ABC_FIFTHS[m[1].toUpperCase()] + (m[2] === '#' ? 7 : m[2] === 'b' ? -7 : 0);
  var mode = m[3].toLowerCase();
  if (mode !== '') {
    var key = mode.slice(0, 3);
    if (mode === 'm') key = 'm';
    if (ABC_MODES[key] === undefined) throw new Error('K: "' + v.slice(0, 20) + '" has an unknown mode "' + m[3].slice(0, 12) + '".');
    fifths += ABC_MODES[key];
  }
  if (fifths < -7 || fifths > 7) throw new Error('K: "' + v.slice(0, 20) + '" needs more than 7 sharps or flats.');
  return fifths;
}

function abcFraction(text, what) {
  var m = /^(\d+)\s*\/\s*(\d+)$/.exec(text.trim());
  if (!m || parseInt(m[2], 10) === 0 || parseInt(m[1], 10) === 0) throw new Error(what + ' needs a fraction such as 1/8, not "' + text.slice(0, 20) + '".');
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

// Parses the text into { info, key, meter, unit, tempo, events }. Events:
// { type:'note', pitches:[{step, acc}], len, tie } | { type:'rest', len }
// | { type:'bar', kind }
function abcParse(source) {
  var info = {};
  var meter = null;
  var unit = null;
  var tempo = null;
  var keyLine = null;
  var events = [];
  var lines = source.split(/\r?\n/);
  var inBody = false;
  var brokenNext = 1;
  var lineNo = 0;

  function noteAt(text, i, lineNumber) {
    // Parses accidental, letter, octave marks. Returns { pitch, next }.
    var acc = '';
    while ('^_='.indexOf(text.charAt(i)) !== -1 && i < text.length) acc += text.charAt(i++);
    if (acc !== '' && !/^(\^\^?|__?|=)$/.test(acc)) throw new Error('Line ' + lineNumber + ': odd accidental "' + acc + '".');
    var letter = text.charAt(i);
    if (!/[A-Ga-g]/.test(letter)) throw new Error('Line ' + lineNumber + ': expected a note letter A-G after "' + (acc || letter) + '".');
    i++;
    var oct = letter === letter.toLowerCase() ? 5 : 4;
    while (text.charAt(i) === "'" || text.charAt(i) === ',') {
      oct += text.charAt(i) === "'" ? 1 : -1;
      i++;
    }
    if (oct < 1 || oct > 8) throw new Error('Line ' + lineNumber + ': that octave is off the staff.');
    return { pitch: { letter: letter.toUpperCase(), oct: oct, step: oct * 7 + ABC_LETTER[letter.toUpperCase()], acc: acc }, next: i };
  }

  function lengthAt(text, i) {
    var num = '';
    while (/[0-9]/.test(text.charAt(i))) num += text.charAt(i++);
    var n = num === '' ? 1 : parseInt(num, 10);
    var d = 1;
    var slashes = 0;
    while (text.charAt(i) === '/') {
      slashes++;
      i++;
      var den = '';
      while (/[0-9]/.test(text.charAt(i))) den += text.charAt(i++);
      if (den !== '') d = parseInt(den, 10);
      else d = d * 2;
      if (den !== '') break;
    }
    if (slashes > 0 && d === 1 && num === '') d = 2;
    if (n === 0 || d === 0 || n > 64 || d > 64) throw new Error('Line ' + (lineNo + 1) + ': that note length is out of range.');
    return { len: [n, d], next: i };
  }

  for (lineNo = 0; lineNo < lines.length; lineNo++) {
    var raw = lines[lineNo];
    var pct = raw.indexOf('%');
    var line = (pct === -1 ? raw : raw.slice(0, pct)).trim();
    if (line === '') continue;
    var field = /^([A-Za-z]):\s*(.*)$/.exec(line);
    if (field && !(inBody && /^[A-Ga-gz]/.test(line) && field[1] !== 'K' && field[1] !== 'M' && field[1] !== 'L')) {
      var name = field[1];
      var val = field[2];
      if (name === 'K') {
        keyLine = val;
        inBody = true;
      } else if (name === 'M') {
        if (/^C\|?$/.test(val.trim())) meter = { text: val.trim(), value: val.trim() === 'C' ? [4, 4] : [2, 2], symbol: val.trim() };
        else if (/^none$/i.test(val.trim())) meter = null;
        else {
          var mf = abcFraction(val, 'M:');
          meter = { text: val.trim(), value: mf };
        }
      } else if (name === 'L') unit = abcFraction(val, 'L:');
      else if (name === 'Q') tempo = val.replace(/"[^"]*"/g, '').trim().slice(0, 30);
      else if (name === 'T' && !info.T) info.T = val.slice(0, 100);
      else if (name === 'C') info.C = val.slice(0, 100);
      else if (name === 'X') {
        if (!/^\d+$/.test(val.trim())) throw new Error('X: needs a tune number, for example X:1.');
      }
      continue;
    }
    if (!inBody) {
      if (/^[A-Za-z]:/.test(line)) continue;
      throw new Error('Line ' + (lineNo + 1) + ': header fields come first (X:, T:, M:, L:, K:). Put "K:" before the notes.');
    }
    if (/^[wW]:/.test(line)) continue;
    // Music line.
    var i = 0;
    var text = line;
    var effUnit = unit || (meter && meter.value[0] / meter.value[1] < 0.75 ? [1, 16] : [1, 8]);
    var prevNote = null;
    while (i < text.length) {
      var ch = text.charAt(i);
      if (ch === '(' && /[0-9]/.test(text.charAt(i + 1))) {
        i += 2; // a tuplet marker such as (3 is skipped; the notes keep their written lengths
      } else if (/\s/.test(ch) || ch === '(' || ch === ')' || ch === '.' || ch === '~' || ch === '\\') {
        i++;
      } else if (ch === '"') {
        var endq = text.indexOf('"', i + 1);
        if (endq === -1) throw new Error('Line ' + (lineNo + 1) + ': a quote is not closed.');
        i = endq + 1;
      } else if (ch === '!') {
        var endb = text.indexOf('!', i + 1);
        if (endb === -1) throw new Error('Line ' + (lineNo + 1) + ': a decoration "!" is not closed.');
        i = endb + 1;
      } else if (ch === '|' || ch === ':' || (ch === '[' && /[|\]:]/.test(text.charAt(i + 1)))) {
        var m = /^(:\|:|::|\|\]|\|\||\[\||\|:|:\||\|)/.exec(text.slice(i));
        if (!m) throw new Error('Line ' + (lineNo + 1) + ': unexpected "' + ch + '".');
        var tok = m[0];
        var kind = 'single';
        if (tok === '::' || tok === ':|:') kind = 'both';
        else if (tok === '|:') kind = 'start';
        else if (tok === ':|') kind = 'end';
        else if (tok === '|]') kind = 'final';
        else if (tok === '||' || tok === '[|') kind = 'double';
        events.push({ type: 'bar', kind: kind });
        i += tok.length;
        if (/[0-9]/.test(text.charAt(i))) i++; // |1 and :|2 ending markers are skipped
      } else if (ch === '>' || ch === '<') {
        var count = 0;
        while (text.charAt(i) === ch) {
          count++;
          i++;
        }
        if (!prevNote) throw new Error('Line ' + (lineNo + 1) + ': "' + ch + '" needs a note before it.');
        var f = Math.pow(2, 1 - 1) * (1 - Math.pow(0.5, count));
        // dotted: first gets 1+f, next gets 1-f
        if (ch === '>') {
          prevNote.scale = 1 + f;
          brokenNext = 1 - f;
        } else {
          prevNote.scale = 1 - f;
          brokenNext = 1 + f;
        }
      } else if (ch === '-') {
        if (!prevNote || prevNote.type !== 'note') throw new Error('Line ' + (lineNo + 1) + ': "-" (a tie) needs a note before it.');
        prevNote.tie = true;
        i++;
      } else if (ch === 'z' || ch === 'Z' || ch === 'x' || ch === 'X') {
        var rl = lengthAt(text, i + 1);
        var ev = { type: 'rest', len: rl.len, scale: brokenNext, invisible: ch === 'x' || ch === 'X', bars: ch === 'Z' || ch === 'X' };
        brokenNext = 1;
        events.push(ev);
        prevNote = ev;
        i = rl.next;
      } else if (ch === '[') {
        var close = text.indexOf(']', i);
        if (close === -1) throw new Error('Line ' + (lineNo + 1) + ': a chord "[" is not closed.');
        var inner = text.slice(i + 1, close);
        var pitches = [];
        var j = 0;
        while (j < inner.length) {
          if (/\s/.test(inner.charAt(j))) {
            j++;
            continue;
          }
          var np = noteAt(inner, j, lineNo + 1);
          pitches.push(np.pitch);
          j = np.next;
          while (/[0-9\/]/.test(inner.charAt(j))) j++; // lengths inside a chord: the outer one wins
        }
        if (pitches.length === 0) throw new Error('Line ' + (lineNo + 1) + ': an empty chord.');
        var cl = lengthAt(text, close + 1);
        var cev = { type: 'note', pitches: pitches, len: cl.len, scale: brokenNext, tie: false };
        brokenNext = 1;
        events.push(cev);
        prevNote = cev;
        i = cl.next;
      } else if (/[A-Ga-g^_=]/.test(ch)) {
        var n = noteAt(text, i, lineNo + 1);
        var nl = lengthAt(text, n.next);
        var nev = { type: 'note', pitches: [n.pitch], len: nl.len, scale: brokenNext, tie: false };
        brokenNext = 1;
        events.push(nev);
        prevNote = nev;
        i = nl.next;
      } else {
        throw new Error('Line ' + (lineNo + 1) + ': "' + ch + '" is not supported. Supported: notes A-G a-g, ^ _ = ,\' lengths, z rests, | bars, - ties, [chords], > <.');
      }
      if (events.length > ABC_MAX_EVENTS) throw new Error('Too many notes: at most ' + ABC_MAX_EVENTS + ' notes, rests and bars.');
    }
  }
  if (keyLine === null) throw new Error('Add a key line, for example "K:C", before the notes.');
  var fifths = abcKey(keyLine);
  var hasMusic = events.some(function (e) {
    return e.type !== 'bar';
  });
  if (!hasMusic) throw new Error('There are no notes after the K: line.');
  var u = unit || (meter && meter.value[0] / meter.value[1] < 0.75 ? [1, 16] : [1, 8]);
  events.forEach(function (e) {
    if (e.type === 'bar') return;
    // length in whole notes, as a number
    e.whole = ((e.len[0] * u[0]) / (e.len[1] * u[1])) * (e.scale || 1);
  });
  return { info: info, fifths: fifths, meter: meter, tempo: tempo, events: events };
}

// ---- Drawing ----------------------------------------------------------------

function abcShape(whole) {
  // returns { hollow, stem, flags, dots }
  var table = [
    [1.5, true, false, 0, 1],
    [1, true, false, 0, 0],
    [0.75, true, true, 0, 1],
    [0.5, true, true, 0, 0],
    [0.375, false, true, 0, 1],
    [0.25, false, true, 0, 0],
    [0.1875, false, true, 1, 1],
    [0.125, false, true, 1, 0],
    [0.09375, false, true, 2, 1],
  ];
  for (var i = 0; i < table.length; i++) {
    if (whole >= table[i][0] - 1e-9) return { hollow: table[i][1], stem: table[i][2], flags: table[i][3], dots: table[i][4] };
  }
  return { hollow: false, stem: true, flags: 2, dots: 0 };
}

function abcRender(source, theme) {
  var tune = abcParse(source);
  var S = ABC_STEP;
  var stroke = theme.text;
  var BOTTOM = 4 * 7 + 2; // E4 is the bottom line
  var systemH = 110;
  var left = 16;
  var right = ABC_WIDTH - 16;
  var systems = [];
  var cur = null;
  var out = '';
  var x;

  function stepY(top, step) {
    return top + 8 * S * 1 - (step - BOTTOM) * S + 4 * 2 * S - 8 * S; // bottom line y minus steps
  }

  // Header (title, composer, tempo).
  var headerH = 12;
  if (tune.info.T) {
    out += '<text x="' + ABC_WIDTH / 2 + '" y="' + (headerH + 12) + '" text-anchor="middle" font-size="18" font-weight="600" fill="' + theme.text + '">' + abcEscape(tune.info.T) + '</text>';
    headerH += 22;
  }
  if (tune.info.C) {
    out += '<text x="' + (ABC_WIDTH - 16) + '" y="' + (headerH + 6) + '" text-anchor="end" font-size="12" font-style="italic" fill="' + theme.muted + '">' + abcEscape(tune.info.C) + '</text>';
    headerH += 14;
  }
  if (tune.tempo) {
    out += '<text x="16" y="' + (headerH + 6) + '" font-size="12" fill="' + theme.muted + '">' + abcEscape(tune.tempo) + '</text>';
    headerH += 14;
  }
  headerH += 8;

  // Pass 1: lay events out into systems.
  var keyN = Math.abs(tune.fifths);
  var prefix = 38 + keyN * 9 + (tune.meter ? 24 : 0);
  var items = [];
  tune.events.forEach(function (e) {
    items.push(e);
  });
  var xs = left + prefix;
  cur = { items: [], xEnd: 0 };
  systems.push(cur);
  var placed = [];
  items.forEach(function (e, idx) {
    var w;
    if (e.type === 'bar') w = e.kind === 'single' ? 12 : 18;
    else w = 20 + 58 * Math.min(e.whole, 1.5) + (e.type === 'note' && e.pitches.some(function (p) { return p.acc; }) ? 11 : 0);
    if (xs + w > right && cur.items.length > 0 && e.type !== 'bar') {
      cur = { items: [], xEnd: 0 };
      systems.push(cur);
      xs = left + prefix - (tune.meter ? 24 : 0);
    }
    cur.items.push({ e: e, x: xs, w: w, idx: idx });
    xs += w;
    cur.xEnd = xs;
  });

  var height = headerH + systems.length * systemH + 6;
  var firstOfTie = {};
  systems.forEach(function (sys, si) {
    var top = headerH + si * systemH + 30; // y of the top staff line
    var bottomLine = top + 8 * S;
    var yOf = function (step) {
      return bottomLine - (step - BOTTOM) * S;
    };
    var xr = Math.min(right, Math.max(sys.xEnd, left + prefix + 20));
    for (var l = 0; l < 5; l++) out += '<line x1="' + left + '" y1="' + (top + l * 2 * S) + '" x2="' + xr + '" y2="' + (top + l * 2 * S) + '" stroke="' + stroke + '"/>';
    out += '<line x1="' + left + '" y1="' + top + '" x2="' + left + '" y2="' + bottomLine + '" stroke="' + stroke + '"/>';
    // Treble clef (a simplified drawing).
    var cx = left + 14;
    out += '<path d="M' + cx + ' ' + (bottomLine + 8) + ' C' + (cx - 7) + ' ' + (bottomLine + 6) + ' ' + (cx - 5) + ' ' + (bottomLine + 1) + ' ' + (cx - 1) + ' ' + (bottomLine - 1) +
      ' C' + (cx + 8) + ' ' + (bottomLine - 5) + ' ' + (cx + 6) + ' ' + (top - 5) + ' ' + cx + ' ' + (top - 6) +
      ' C' + (cx - 5) + ' ' + (top - 2) + ' ' + (cx - 2) + ' ' + (bottomLine - 4) + ' ' + (cx + 5) + ' ' + (bottomLine - 7) +
      ' C' + (cx + 12) + ' ' + (bottomLine - 8) + ' ' + (cx + 12) + ' ' + (bottomLine + 3) + ' ' + (cx + 3) + ' ' + (bottomLine + 3) +
      '" fill="none" stroke="' + stroke + '" stroke-width="1.6" stroke-linecap="round"/>';
    // Key signature.
    var order = tune.fifths >= 0 ? ABC_SHARP_ORDER : ABC_FLAT_ORDER;
    for (var k = 0; k < keyN; k++) {
      var st = order[k][1] * 7 + ABC_LETTER[order[k][0]];
      out += abcAccidental(tune.fifths >= 0 ? '^' : '_', left + 34 + k * 9, yOf(st), S, stroke);
    }
    if (si === 0 && tune.meter) {
      var mx = left + 36 + keyN * 9 + 8;
      if (tune.meter.symbol) {
        out += '<text x="' + mx + '" y="' + (top + 6 * S - 1) + '" text-anchor="middle" font-size="22" font-weight="700" fill="' + stroke + '">' + abcEscape(tune.meter.symbol === 'C|' ? 'C|' : 'C') + '</text>';
      } else {
        out += '<text x="' + mx + '" y="' + (top + 4 * S) + '" text-anchor="middle" font-size="17" font-weight="700" fill="' + stroke + '">' + tune.meter.value[0] + '</text>';
        out += '<text x="' + mx + '" y="' + (top + 8 * S) + '" text-anchor="middle" font-size="17" font-weight="700" fill="' + stroke + '">' + tune.meter.value[1] + '</text>';
      }
    }
    sys.items.forEach(function (it) {
      var e = it.e;
      var px = it.x + it.w / 2;
      if (e.type === 'bar') {
        out += abcBar(e.kind, it.x + 4, top, bottomLine, S, stroke);
        return;
      }
      if (e.type === 'rest') {
        if (!e.invisible) out += abcRest(e, px, top, S, stroke);
        return;
      }
      var shape = abcShape(e.whole);
      var steps = e.pitches.map(function (p) {
        return p.step;
      });
      var lo = Math.min.apply(null, steps);
      var hi = Math.max.apply(null, steps);
      var avg = (lo + hi) / 2;
      var stemUp = avg < BOTTOM + 4;
      var hasAcc = e.pitches.some(function (p) { return p.acc; });
      var nx = px + (hasAcc ? 5 : 0);
      var lastX = nx;
      // ledger lines
      for (var s = BOTTOM - 2; s >= lo; s -= 2) out += '<line x1="' + (nx - 8) + '" y1="' + yOf(s) + '" x2="' + (nx + 8) + '" y2="' + yOf(s) + '" stroke="' + stroke + '"/>';
      for (var t = BOTTOM + 10; t <= hi; t += 2) out += '<line x1="' + (nx - 8) + '" y1="' + yOf(t) + '" x2="' + (nx + 8) + '" y2="' + yOf(t) + '" stroke="' + stroke + '"/>';
      var sorted = e.pitches.slice().sort(function (a, b) {
        return a.step - b.step;
      });
      var prevStep = null;
      var flip = false;
      sorted.forEach(function (p) {
        flip = prevStep !== null && p.step - prevStep === 1 ? !flip : false;
        prevStep = p.step;
        var hx = nx + (flip ? (stemUp ? 8 : -8) : 0);
        out += '<ellipse cx="' + hx + '" cy="' + yOf(p.step) + '" rx="5" ry="3.6" transform="rotate(-20 ' + hx + ' ' + yOf(p.step) + ')" fill="' + (shape.hollow ? theme.background : stroke) + '" stroke="' + stroke + '" stroke-width="1.3"/>';
        if (p.acc) out += abcAccidental(p.acc.charAt(0), hx - 12, yOf(p.step), S, stroke, p.acc.length);
      });
      for (var d = 0; d < shape.dots; d++) out += '<circle cx="' + (nx + 10 + d * 4) + '" cy="' + (yOf(hi) - (hi % 2 === 0 ? S : 0) + (stemUp ? 0 : 0)) + '" r="1.5" fill="' + stroke + '"/>';
      if (shape.stem) {
        var sx = stemUp ? nx + 4.6 : nx - 4.6;
        var y1 = stemUp ? yOf(lo) : yOf(hi);
        var y2 = stemUp ? yOf(hi) - 7 * S : yOf(lo) + 7 * S;
        out += '<line x1="' + sx + '" y1="' + y1 + '" x2="' + sx + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="1.3"/>';
        for (var f = 0; f < shape.flags; f++) {
          var fy = y2 + (stemUp ? 1 : -1) * f * 5;
          out += '<path d="M' + sx + ' ' + fy + ' q8 ' + (stemUp ? 6 : -6) + ' 4 ' + (stemUp ? 14 : -14) + '" fill="none" stroke="' + stroke + '" stroke-width="1.5"/>';
        }
      }
      if (e.tie) {
        // find the next note event in this system
        var nxt = null;
        for (var q = it.idx + 1; q < tune.events.length; q++) {
          if (tune.events[q].type === 'note') {
            nxt = tune.events[q];
            break;
          }
          if (tune.events[q].type === 'rest') break;
        }
        var target = null;
        sys.items.forEach(function (o) {
          if (o.e === nxt) target = o;
        });
        if (target) {
          var tx = target.x + target.w / 2 + (target.e.pitches.some(function (p) { return p.acc; }) ? 5 : 0);
          var ty = yOf(e.pitches[0].step);
          var below = stemUp;
          var off = below ? 8 : -8;
          out += '<path d="M' + (lastX + 3) + ' ' + (ty + (below ? 5 : -5)) + ' Q' + (lastX + tx) / 2 + ' ' + (ty + off * 1.8) + ' ' + (tx - 3) + ' ' + (ty + (below ? 5 : -5)) + '" fill="none" stroke="' + stroke + '" stroke-width="1.2"/>';
        }
      }
    });
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + ABC_WIDTH + '" height="' + height + '" viewBox="0 0 ' + ABC_WIDTH + ' ' + height + '">' + out + '</svg>';
}

function abcAccidental(kind, x, y, S, stroke, count) {
  if (kind === '^') {
    var one = function (ox) {
      return '<line x1="' + (ox - 1.5) + '" y1="' + (y - 7) + '" x2="' + (ox - 1.5) + '" y2="' + (y + 8) + '" stroke="' + stroke + '"/>' +
        '<line x1="' + (ox + 1.5) + '" y1="' + (y - 8) + '" x2="' + (ox + 1.5) + '" y2="' + (y + 7) + '" stroke="' + stroke + '"/>' +
        '<line x1="' + (ox - 4) + '" y1="' + (y - 1.5) + '" x2="' + (ox + 4) + '" y2="' + (y - 3.5) + '" stroke="' + stroke + '" stroke-width="2"/>' +
        '<line x1="' + (ox - 4) + '" y1="' + (y + 3.5) + '" x2="' + (ox + 4) + '" y2="' + (y + 1.5) + '" stroke="' + stroke + '" stroke-width="2"/>';
    };
    return count === 2 ? one(x - 3) + one(x + 4) : one(x);
  }
  if (kind === '_') {
    var fl = function (ox) {
      return '<path d="M' + ox + ' ' + (y - 9) + ' L' + ox + ' ' + (y + 4) + ' C' + (ox + 7) + ' ' + (y + 1) + ' ' + (ox + 7) + ' ' + (y - 6) + ' ' + ox + ' ' + (y - 1) + '" fill="none" stroke="' + stroke + '" stroke-width="1.3"/>';
    };
    return count === 2 ? fl(x - 3) + fl(x + 3) : fl(x);
  }
  return '<path d="M' + (x - 2) + ' ' + (y - 8) + ' L' + (x - 2) + ' ' + (y + 3) + ' L' + (x + 3) + ' ' + (y + 2) + ' M' + (x + 3) + ' ' + (y + 8) + ' L' + (x + 3) + ' ' + (y - 3) + ' L' + (x - 2) + ' ' + (y - 2) + '" fill="none" stroke="' + stroke + '" stroke-width="1.2"/>';
}

function abcBar(kind, x, top, bottom, S, stroke) {
  var line = function (bx, w) {
    return '<line x1="' + bx + '" y1="' + top + '" x2="' + bx + '" y2="' + bottom + '" stroke="' + stroke + '" stroke-width="' + w + '"/>';
  };
  var dots = function (dx) {
    return '<circle cx="' + dx + '" cy="' + (top + 3 * S) + '" r="1.6" fill="' + stroke + '"/><circle cx="' + dx + '" cy="' + (top + 5 * S) + '" r="1.6" fill="' + stroke + '"/>';
  };
  switch (kind) {
    case 'double': return line(x, 1) + line(x + 4, 1);
    case 'final': return line(x, 1) + line(x + 5, 3.5);
    case 'start': return line(x, 3.5) + line(x + 5, 1) + dots(x + 10);
    case 'end': return dots(x - 5) + line(x, 1) + line(x + 5, 3.5);
    case 'both': return dots(x - 5) + line(x, 1.5) + line(x + 5, 1.5) + dots(x + 10);
    default: return line(x, 1);
  }
}

function abcRest(e, x, top, S, stroke) {
  var w = e.whole;
  var mid = top + 4 * S;
  if (e.bars || w >= 1) return '<rect x="' + (x - 5) + '" y="' + (top + 2 * S) + '" width="10" height="' + S + '" fill="' + stroke + '"/>';
  if (w >= 0.5) return '<rect x="' + (x - 5) + '" y="' + (mid - S) + '" width="10" height="' + S + '" fill="' + stroke + '"/>';
  if (w >= 0.25) return '<path d="M' + (x - 2) + ' ' + (mid - 8) + ' L' + (x + 3) + ' ' + (mid - 2) + ' L' + (x - 3) + ' ' + (mid + 3) + ' L' + (x + 2) + ' ' + (mid + 9) + '" fill="none" stroke="' + stroke + '" stroke-width="1.8"/>';
  var n = w >= 0.125 ? 1 : 2;
  var s = '<line x1="' + (x + 2) + '" y1="' + (mid - 6) + '" x2="' + (x - 2) + '" y2="' + (mid + 8) + '" stroke="' + stroke + '" stroke-width="1.3"/>';
  for (var i = 0; i < n; i++) s += '<circle cx="' + (x - 1 + i * -2) + '" cy="' + (mid - 4 + i * 5) + '" r="2" fill="' + stroke + '"/>';
  return s;
}

kanso.fences.register('abc', function (args) {
  return abcRender(args.source, args.theme);
});
