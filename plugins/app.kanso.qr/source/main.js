// QR code: draws a ```qr block as a QR code (byte mode, error correction M,
// versions 1 to 10). The encoder is self-contained; the renderer is pure.

var QR_MAX_VERSION = 10;
// Error correction level M: [ecc codewords per block, blocks of the short
// size, short block data codewords, blocks of the long size]. Long blocks
// hold one more data codeword than short ones.
var QR_M_BLOCKS = [
  null,
  [10, 1, 16, 0],
  [16, 1, 28, 0],
  [26, 1, 44, 0],
  [18, 2, 32, 0],
  [24, 2, 43, 0],
  [16, 4, 27, 0],
  [18, 4, 31, 0],
  [22, 2, 38, 2],
  [22, 3, 36, 2],
  [26, 4, 43, 1],
];
var QR_ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

function qrDataCodewords(version) {
  var b = QR_M_BLOCKS[version];
  return b[1] * b[2] + b[3] * (b[2] + 1);
}

function qrCapacity(version) {
  return qrDataCodewords(version) - (version < 10 ? 2 : 3);
}

function qrUtf8(text) {
  var out = [];
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      var d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

// GF(256) with the QR polynomial 0x11d.
var QR_EXP = [];
var QR_LOG = [];
(function () {
  var x = 1;
  for (var i = 0; i < 255; i++) {
    QR_EXP[i] = x;
    QR_LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  for (var j = 255; j < 512; j++) QR_EXP[j] = QR_EXP[j - 255];
})();

function qrGfMul(a, b) {
  return a === 0 || b === 0 ? 0 : QR_EXP[QR_LOG[a] + QR_LOG[b]];
}

function qrRsGenerator(degree) {
  var poly = [1];
  for (var i = 0; i < degree; i++) {
    var next = [];
    for (var k = 0; k <= poly.length; k++) next.push(0);
    for (var j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= qrGfMul(poly[j], QR_EXP[i]);
    }
    poly = next;
  }
  return poly; // highest degree first, leading 1
}

function qrRsRemainder(data, degree) {
  var gen = qrRsGenerator(degree);
  var rem = [];
  for (var i = 0; i < degree; i++) rem.push(0);
  for (var d = 0; d < data.length; d++) {
    var factor = data[d] ^ rem[0];
    rem.shift();
    rem.push(0);
    for (var k = 0; k < degree; k++) rem[k] ^= qrGfMul(gen[k + 1], factor);
  }
  return rem;
}

function qrPickVersion(length) {
  for (var v = 1; v <= QR_MAX_VERSION; v++) if (length <= qrCapacity(v)) return v;
  throw new Error('That text is too long for the QR block: at most ' + qrCapacity(QR_MAX_VERSION) + ' bytes (UTF-8), and it is ' + length + '.');
}

function qrDataBits(bytes, version) {
  var bits = [];
  function put(value, count) {
    for (var i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  }
  put(4, 4); // byte mode
  put(bytes.length, version < 10 ? 8 : 16);
  for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);
  var capacityBits = qrDataCodewords(version) * 8;
  put(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  var words = [];
  for (var j = 0; j < bits.length; j += 8) {
    var w = 0;
    for (var k = 0; k < 8; k++) w = (w << 1) | bits[j + k];
    words.push(w);
  }
  var pad = 0xec;
  while (words.length < qrDataCodewords(version)) {
    words.push(pad);
    pad = pad === 0xec ? 0x11 : 0xec;
  }
  return words;
}

// Splits the data codewords into blocks, adds Reed-Solomon codewords to each
// and interleaves them.
function qrInterleave(words, version) {
  var spec = QR_M_BLOCKS[version];
  var eccLen = spec[0];
  var blocks = [];
  var pos = 0;
  for (var b = 0; b < spec[1] + spec[3]; b++) {
    var size = b < spec[1] ? spec[2] : spec[2] + 1;
    var data = words.slice(pos, pos + size);
    pos += size;
    blocks.push({ data: data, ecc: qrRsRemainder(data, eccLen) });
  }
  var out = [];
  var longest = spec[3] > 0 ? spec[2] + 1 : spec[2];
  for (var i = 0; i < longest; i++) {
    for (var j = 0; j < blocks.length; j++) if (i < blocks[j].data.length) out.push(blocks[j].data[i]);
  }
  for (var e = 0; e < eccLen; e++) {
    for (var k = 0; k < blocks.length; k++) out.push(blocks[k].ecc[e]);
  }
  return out;
}

function qrFormatBits(mask) {
  var data = mask; // error correction level M is 00
  var rem = data;
  for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function qrVersionBits(version) {
  var rem = version;
  for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function qrMaskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function qrPenalty(m, size) {
  var score = 0;
  var x;
  var y;
  var i;
  // Runs of five or more, and finder-like patterns, along rows then columns.
  var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  var pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (var dir = 0; dir < 2; dir++) {
    for (y = 0; y < size; y++) {
      var run = 1;
      for (x = 1; x < size; x++) {
        var cur = dir === 0 ? m[y][x] : m[x][y];
        var prev = dir === 0 ? m[y][x - 1] : m[x - 1][y];
        if (cur === prev) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
      for (x = 0; x + 11 <= size; x++) {
        var a = true;
        var b = true;
        for (i = 0; i < 11; i++) {
          var v = dir === 0 ? m[y][x + i] : m[x + i][y];
          var bit = v ? 1 : 0;
          if (bit !== pat1[i]) a = false;
          if (bit !== pat2[i]) b = false;
        }
        if (a) score += 40;
        if (b) score += 40;
      }
    }
  }
  var dark = 0;
  for (y = 0; y < size; y++) {
    for (x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
  }
  var percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

// Builds the module matrix (true is dark) for the bytes. Returns
// { version, mask, size, modules }.
function qrEncode(bytes) {
  var version = qrPickVersion(bytes.length);
  var size = version * 4 + 17;
  var modules = [];
  var fn = [];
  var x;
  var y;
  for (y = 0; y < size; y++) {
    modules.push([]);
    fn.push([]);
    for (x = 0; x < size; x++) {
      modules[y].push(false);
      fn[y].push(false);
    }
  }
  function setFn(px, py, dark) {
    if (px < 0 || py < 0 || px >= size || py >= size) return;
    modules[py][px] = dark;
    fn[py][px] = true;
  }
  function bit(value, i) {
    return ((value >>> i) & 1) !== 0;
  }
  function drawFormat(mask) {
    var bits = qrFormatBits(mask);
    var i;
    for (i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
    setFn(8, 7, bit(bits, 6));
    setFn(8, 8, bit(bits, 7));
    setFn(7, 8, bit(bits, 8));
    for (i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));
    for (i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
    for (i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
    setFn(8, size - 8, true);
  }
  for (var t = 0; t < size; t++) {
    setFn(6, t, t % 2 === 0);
    setFn(t, 6, t % 2 === 0);
  }
  var centers = [[3, 3], [size - 4, 3], [3, size - 4]];
  centers.forEach(function (c) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(c[0] + dx, c[1] + dy, dist !== 2 && dist !== 4);
      }
    }
  });
  var al = QR_ALIGN[version];
  for (var i = 0; i < al.length; i++) {
    for (var j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (var ay = -2; ay <= 2; ay++) {
        for (var ax = -2; ax <= 2; ax++) setFn(al[i] + ax, al[j] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
      }
    }
  }
  drawFormat(0);
  if (version >= 7) {
    var vbits = qrVersionBits(version);
    for (var k = 0; k < 18; k++) {
      var a = size - 11 + (k % 3);
      var b = Math.floor(k / 3);
      setFn(a, b, bit(vbits, k));
      setFn(b, a, bit(vbits, k));
    }
  }
  var codewords = qrInterleave(qrDataBits(bytes, version), version);
  var n = 0;
  var total = codewords.length * 8;
  for (var right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (var vert = 0; vert < size; vert++) {
      for (var jj = 0; jj < 2; jj++) {
        var px = right - jj;
        var upward = ((right + 1) & 2) === 0;
        var py = upward ? size - 1 - vert : vert;
        if (!fn[py][px] && n < total) {
          modules[py][px] = ((codewords[n >>> 3] >>> (7 - (n & 7))) & 1) !== 0;
          n++;
        }
      }
    }
  }
  function applyMask(mask) {
    for (var yy = 0; yy < size; yy++) {
      for (var xx = 0; xx < size; xx++) if (!fn[yy][xx] && qrMaskBit(mask, xx, yy)) modules[yy][xx] = !modules[yy][xx];
    }
  }
  var best = 0;
  var bestScore = Infinity;
  for (var mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    var score = qrPenalty(modules, size);
    if (score < bestScore) {
      bestScore = score;
      best = mask;
    }
    applyMask(mask); // undo
  }
  applyMask(best);
  drawFormat(best);
  return { version: version, mask: best, size: size, modules: modules };
}

function qrSvg(qr, theme) {
  var quiet = 4;
  var cell = 6;
  var dim = (qr.size + quiet * 2) * cell;
  // Always dark modules on a light ground, in the theme's own colors, so the
  // code scans in dark mode too.
  var ink = theme.dark ? theme.background : theme.text;
  var paper = theme.dark ? theme.text : theme.background;
  var path = '';
  for (var y = 0; y < qr.size; y++) {
    var x = 0;
    while (x < qr.size) {
      if (!qr.modules[y][x]) {
        x++;
        continue;
      }
      var start = x;
      while (x < qr.size && qr.modules[y][x]) x++;
      path += 'M' + (start + quiet) * cell + ' ' + (y + quiet) * cell + 'h' + (x - start) * cell + 'v' + cell + 'h-' + (x - start) * cell + 'z';
    }
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + dim + '" height="' + dim + '" viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges">' +
    '<rect width="' + dim + '" height="' + dim + '" fill="' + paper + '"/>' +
    '<path d="' + path + '" fill="' + ink + '"/></svg>'
  );
}

function qrRender(source, theme) {
  var text = source.replace(/[\r\n]+$/, '');
  if (text.length === 0) throw new Error('Write the text to encode inside the qr block, for example a link.');
  return qrSvg(qrEncode(qrUtf8(text)), theme);
}

kanso.fences.register('qr', function (args) {
  return qrRender(args.source, args.theme);
});
