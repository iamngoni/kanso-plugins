// Convert: unit and time zone conversion from selected text such as
// `5 km to mi` or `14:00 Harare in New York`. Everything is built in: no
// network, so no currency. The result replaces the selection, or is added
// after it as `<selection> = <result>`.

// ---- numbers -----------------------------------------------------------

function formatNumber(x) {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  const r = Number(x.toPrecision(10));
  const a = Math.abs(r);
  if (a >= 1e15 || a < 1e-6) return r.toExponential().replace(/\.?0+e/, 'e').replace('e+', 'e');
  let s = String(r);
  if (s.includes('e')) s = r.toFixed(Math.min(20, Math.max(0, 9 - Math.floor(Math.log10(a)))));
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

// ---- units -------------------------------------------------------------

// Linear units: factor to the category's base unit. Names are lower case,
// except where case matters (data sizes).
const LINEAR = {
  length: { base: 'm', units: [
    ['m', 1, ['m', 'meter', 'meters', 'metre', 'metres']],
    ['km', 1000, ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres']],
    ['cm', 0.01, ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres']],
    ['mm', 0.001, ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres']],
    ['µm', 1e-6, ['um', 'µm', 'μm', 'micron', 'microns', 'micrometer', 'micrometers']],
    ['nm', 1e-9, ['nm', 'nanometer', 'nanometers']],
    ['mi', 1609.344, ['mi', 'mile', 'miles']],
    ['yd', 0.9144, ['yd', 'yds', 'yard', 'yards']],
    ['ft', 0.3048, ['ft', 'foot', 'feet', "'"]],
    ['in', 0.0254, ['in', 'inch', 'inches', '"']],
    ['nmi', 1852, ['nmi', 'nautical mile', 'nautical miles']],
  ] },
  mass: { base: 'kg', units: [
    ['kg', 1, ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos']],
    ['g', 0.001, ['g', 'gram', 'grams']],
    ['mg', 1e-6, ['mg', 'milligram', 'milligrams']],
    ['µg', 1e-9, ['ug', 'µg', 'μg', 'microgram', 'micrograms']],
    ['t', 1000, ['t', 'tonne', 'tonnes', 'metric ton', 'metric tons']],
    ['lb', 0.45359237, ['lb', 'lbs', 'pound', 'pounds']],
    ['oz', 0.028349523125, ['oz', 'ounce', 'ounces']],
    ['st', 6.35029318, ['st', 'stone', 'stones']],
    ['US ton', 907.18474, ['ton', 'tons', 'us ton', 'short ton', 'short tons']],
  ] },
  volume: { base: 'L', units: [
    ['L', 1, ['l', 'liter', 'liters', 'litre', 'litres']],
    ['mL', 0.001, ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'cc']],
    ['cL', 0.01, ['cl', 'centiliter', 'centilitre', 'centilitres']],
    ['dL', 0.1, ['dl', 'deciliter', 'decilitre', 'decilitres']],
    ['m³', 1000, ['m3', 'm³', 'cubic meter', 'cubic meters', 'cubic metre', 'cubic metres']],
    ['US gal', 3.785411784, ['gal', 'gals', 'gallon', 'gallons', 'us gal', 'us gallon', 'us gallons']],
    ['UK gal', 4.54609, ['uk gal', 'uk gallon', 'uk gallons', 'imperial gallon', 'imperial gallons', 'imp gal']],
    ['qt', 0.946352946, ['qt', 'quart', 'quarts']],
    ['pt', 0.473176473, ['pt', 'pint', 'pints']],
    ['cup', 0.2365882365, ['cup', 'cups']],
    ['fl oz', 0.0295735295625, ['fl oz', 'floz', 'fluid ounce', 'fluid ounces']],
    ['tbsp', 0.01478676478125, ['tbsp', 'tablespoon', 'tablespoons']],
    ['tsp', 0.00492892159375, ['tsp', 'teaspoon', 'teaspoons']],
  ] },
  speed: { base: 'm/s', units: [
    ['m/s', 1, ['m/s', 'mps', 'meters per second', 'metres per second']],
    ['km/h', 1000 / 3600, ['km/h', 'kmh', 'kph', 'kmph', 'kilometers per hour', 'kilometres per hour']],
    ['mph', 1609.344 / 3600, ['mph', 'mi/h', 'miles per hour']],
    ['kn', 1852 / 3600, ['kn', 'kt', 'kts', 'knot', 'knots']],
    ['ft/s', 0.3048, ['ft/s', 'fps', 'feet per second']],
  ] },
  data: { base: 'B', units: [
    ['B', 1, ['B', 'byte', 'bytes']],
    ['KB', 1e3, ['KB', 'kB', 'kb', 'kilobyte', 'kilobytes']],
    ['MB', 1e6, ['MB', 'mb', 'megabyte', 'megabytes']],
    ['GB', 1e9, ['GB', 'gb', 'gigabyte', 'gigabytes']],
    ['TB', 1e12, ['TB', 'tb', 'terabyte', 'terabytes']],
    ['PB', 1e15, ['PB', 'pb', 'petabyte', 'petabytes']],
    ['KiB', 1024, ['KiB', 'kib', 'kibibyte', 'kibibytes']],
    ['MiB', 1024 ** 2, ['MiB', 'mib', 'mebibyte', 'mebibytes']],
    ['GiB', 1024 ** 3, ['GiB', 'gib', 'gibibyte', 'gibibytes']],
    ['TiB', 1024 ** 4, ['TiB', 'tib', 'tebibyte', 'tebibytes']],
    ['PiB', 1024 ** 5, ['PiB', 'pib', 'pebibyte', 'pebibytes']],
    ['bit', 0.125, ['b', 'bit', 'bits']],
    ['Kb', 125, ['Kb', 'kbit', 'kbits', 'kilobit', 'kilobits']],
    ['Mb', 125000, ['Mb', 'mbit', 'mbits', 'megabit', 'megabits']],
    ['Gb', 1.25e8, ['Gb', 'gbit', 'gbits', 'gigabit', 'gigabits']],
    ['Tb', 1.25e11, ['Tb', 'tbit', 'tbits', 'terabit', 'terabits']],
  ] },
};

// Temperature goes through kelvin.
const TEMPERATURE = [
  ['°C', (v) => v + 273.15, (k) => k - 273.15, ['c', 'celsius', 'centigrade']],
  ['°F', (v) => ((v - 32) * 5) / 9 + 273.15, (k) => ((k - 273.15) * 9) / 5 + 32, ['f', 'fahrenheit']],
  ['K', (v) => v, (k) => k, ['k', 'kelvin', 'kelvins']],
];

// alias -> unit; case-sensitive entries are checked before lower case ones.
const EXACT = new Map();
const LOWER = new Map();
function addAlias(alias, unit) {
  if (!EXACT.has(alias)) EXACT.set(alias, unit);
  const l = alias.toLowerCase();
  if (!LOWER.has(l) && l === alias) LOWER.set(l, unit);
}
for (const cat of Object.keys(LINEAR)) {
  for (const [symbol, factor, aliases] of LINEAR[cat].units) {
    const unit = { cat, symbol, to: (v) => v * factor, from: (b) => b / factor };
    aliases.forEach((a) => addAlias(a, unit));
  }
}
for (const [symbol, to, from, aliases] of TEMPERATURE) {
  const unit = { cat: 'temperature', symbol, to, from };
  aliases.forEach((a) => addAlias(a, unit));
  addAlias(symbol.toLowerCase(), unit);
}

function normalizeUnit(text) {
  return text
    .trim()
    .replace(/\.$/, '')
    .replace(/^(?:degrees?|deg)\s*/i, (m) => (m.trim().length ? '' : m))
    .replace(/^°\s*/, '')
    .replace(/\s+/g, ' ');
}

function findUnit(text) {
  const t = normalizeUnit(text);
  if (t === '') return null;
  const lower = t.toLowerCase();
  const tries = [t, lower];
  if (lower.endsWith('s')) tries.push(lower.slice(0, -1));
  for (const k of tries) {
    if (EXACT.has(k)) return EXACT.get(k);
  }
  for (const k of tries) {
    if (LOWER.has(k)) return LOWER.get(k);
  }
  return null;
}

function convertValue(value, from, to) {
  return to.from(from.to(value));
}

// "5 km", "1,000.5 ft", "-40 c", or just "km" (one of it).
function parseQuantity(text) {
  const m = /^\s*([+-]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d*\.?\d+)(?:[eE][+-]?\d+)?)?\s*(.*?)\s*$/s.exec(text);
  if (!m) return null;
  const value = m[1] === undefined ? 1 : Number(m[1].replace(/,/g, ''));
  const unit = findUnit(m[2]);
  if (!unit || !Number.isFinite(value)) return null;
  return { value, unit };
}

const CONNECTORS = [/\s+to\s+/gi, /\s+in\s+/gi, /\s+into\s+/gi, /\s+as\s+/gi, /\s+=\s+/g, /\s*(?:->|\u2192)\s*/g];

// Every way of cutting `text` into a left and right part at a connector
// (each connector word is tried on its own, so "5 in to cm" has two cuts).
function splits(text) {
  const out = [];
  for (const re of CONNECTORS) {
    for (const m of text.matchAll(re)) {
      out.push([text.slice(0, m.index), text.slice(m.index + m[0].length)]);
    }
  }
  return out;
}

function convertUnits(text) {
  let sawCategoryError = null;
  for (const [left, right] of splits(text)) {
    const q = parseQuantity(left);
    if (!q) continue;
    const targets = right.split(/\s*[,;]\s*/).map(findUnit);
    if (targets.length === 0 || targets.some((t) => !t)) continue;
    const wrong = targets.find((t) => t.cat !== q.unit.cat);
    if (wrong) {
      sawCategoryError = `Can't convert ${q.unit.cat} to ${wrong.cat}.`;
      continue;
    }
    const parts = targets.map((t) => `${formatNumber(convertValue(q.value, q.unit, t))} ${t.symbol}`);
    return { text: parts.join(', ') };
  }
  return sawCategoryError ? { error: sawCategoryError } : null;
}

// ---- time zones --------------------------------------------------------

// [IANA name, standard offset in minutes, DST rule, other names]
const ZONES = [
  ['UTC', 0, 'none', ['utc', 'gmt', 'z', 'zulu', 'universal', 'etc/utc']],
  ['America/New_York', -300, 'US', ['new york', 'nyc', 'eastern', 'et', 'new york city', 'miami', 'boston', 'atlanta', 'washington']],
  ['America/Chicago', -360, 'US', ['chicago', 'central time', 'ct', 'dallas', 'houston']],
  ['America/Denver', -420, 'US', ['denver', 'mountain', 'mt', 'salt lake city']],
  ['America/Phoenix', -420, 'none', ['phoenix', 'arizona']],
  ['America/Los_Angeles', -480, 'US', ['los angeles', 'la', 'pacific', 'pt', 'san francisco', 'seattle', 'san diego']],
  ['America/Anchorage', -540, 'US', ['anchorage', 'alaska']],
  ['Pacific/Honolulu', -600, 'none', ['honolulu', 'hawaii']],
  ['America/Toronto', -300, 'US', ['toronto', 'montreal', 'ottawa']],
  ['America/Vancouver', -480, 'US', ['vancouver']],
  ['America/Halifax', -240, 'US', ['halifax']],
  ['America/Mexico_City', -360, 'none', ['mexico city', 'mexico']],
  ['America/Bogota', -300, 'none', ['bogota']],
  ['America/Lima', -300, 'none', ['lima']],
  ['America/Sao_Paulo', -180, 'none', ['sao paulo', 'são paulo', 'brasilia', 'rio de janeiro']],
  ['America/Argentina/Buenos_Aires', -180, 'none', ['buenos aires']],
  ['Europe/London', 0, 'EU', ['london', 'uk', 'edinburgh', 'manchester']],
  ['Europe/Dublin', 0, 'EU', ['dublin']],
  ['Europe/Lisbon', 0, 'EU', ['lisbon']],
  ['Europe/Paris', 60, 'EU', ['paris']],
  ['Europe/Berlin', 60, 'EU', ['berlin', 'frankfurt', 'munich']],
  ['Europe/Madrid', 60, 'EU', ['madrid', 'barcelona']],
  ['Europe/Rome', 60, 'EU', ['rome', 'milan']],
  ['Europe/Amsterdam', 60, 'EU', ['amsterdam']],
  ['Europe/Brussels', 60, 'EU', ['brussels']],
  ['Europe/Vienna', 60, 'EU', ['vienna']],
  ['Europe/Zurich', 60, 'EU', ['zurich', 'zürich', 'geneva']],
  ['Europe/Stockholm', 60, 'EU', ['stockholm']],
  ['Europe/Oslo', 60, 'EU', ['oslo']],
  ['Europe/Copenhagen', 60, 'EU', ['copenhagen']],
  ['Europe/Warsaw', 60, 'EU', ['warsaw']],
  ['Europe/Prague', 60, 'EU', ['prague']],
  ['Europe/Budapest', 60, 'EU', ['budapest']],
  ['Europe/Athens', 120, 'EU', ['athens']],
  ['Europe/Helsinki', 120, 'EU', ['helsinki']],
  ['Europe/Kyiv', 120, 'EU', ['kyiv', 'kiev']],
  ['Europe/Bucharest', 120, 'EU', ['bucharest']],
  ['Europe/Istanbul', 180, 'none', ['istanbul', 'turkey']],
  ['Europe/Moscow', 180, 'none', ['moscow']],
  ['Africa/Harare', 120, 'none', ['harare', 'zimbabwe', 'bulawayo']],
  ['Africa/Johannesburg', 120, 'none', ['johannesburg', 'cape town', 'pretoria', 'south africa', 'durban']],
  ['Africa/Maputo', 120, 'none', ['maputo']],
  ['Africa/Lusaka', 120, 'none', ['lusaka']],
  ['Africa/Windhoek', 120, 'none', ['windhoek']],
  ['Africa/Cairo', 120, 'none', ['cairo']],
  ['Africa/Lagos', 60, 'none', ['lagos', 'abuja']],
  ['Africa/Kinshasa', 60, 'none', ['kinshasa']],
  ['Africa/Algiers', 60, 'none', ['algiers']],
  ['Africa/Tunis', 60, 'none', ['tunis']],
  ['Africa/Accra', 0, 'none', ['accra']],
  ['Africa/Nairobi', 180, 'none', ['nairobi']],
  ['Africa/Addis_Ababa', 180, 'none', ['addis ababa']],
  ['Africa/Dar_es_Salaam', 180, 'none', ['dar es salaam']],
  ['Africa/Kampala', 180, 'none', ['kampala']],
  ['Asia/Dubai', 240, 'none', ['dubai', 'abu dhabi']],
  ['Asia/Riyadh', 180, 'none', ['riyadh']],
  ['Asia/Tehran', 210, 'none', ['tehran']],
  ['Asia/Karachi', 300, 'none', ['karachi']],
  ['Asia/Tashkent', 300, 'none', ['tashkent']],
  ['Asia/Kolkata', 330, 'none', ['kolkata', 'calcutta', 'mumbai', 'delhi', 'new delhi', 'india', 'bangalore']],
  ['Asia/Colombo', 330, 'none', ['colombo']],
  ['Asia/Kathmandu', 345, 'none', ['kathmandu']],
  ['Asia/Dhaka', 360, 'none', ['dhaka']],
  ['Asia/Bangkok', 420, 'none', ['bangkok']],
  ['Asia/Jakarta', 420, 'none', ['jakarta']],
  ['Asia/Singapore', 480, 'none', ['singapore']],
  ['Asia/Kuala_Lumpur', 480, 'none', ['kuala lumpur']],
  ['Asia/Hong_Kong', 480, 'none', ['hong kong']],
  ['Asia/Shanghai', 480, 'none', ['shanghai', 'beijing', 'china']],
  ['Asia/Manila', 480, 'none', ['manila']],
  ['Asia/Taipei', 480, 'none', ['taipei']],
  ['Asia/Tokyo', 540, 'none', ['tokyo', 'japan', 'osaka']],
  ['Asia/Seoul', 540, 'none', ['seoul']],
  ['Australia/Perth', 480, 'none', ['perth']],
  ['Australia/Adelaide', 570, 'AU', ['adelaide']],
  ['Australia/Brisbane', 600, 'none', ['brisbane']],
  ['Australia/Sydney', 600, 'AU', ['sydney', 'canberra']],
  ['Australia/Melbourne', 600, 'AU', ['melbourne']],
  ['Pacific/Auckland', 720, 'NZ', ['auckland', 'new zealand', 'wellington']],
  ['Pacific/Fiji', 720, 'none', ['fiji']],
];

// Abbreviations are fixed offsets, as written.
const ABBREVIATIONS = {
  est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420,
  akst: -540, akdt: -480, hst: -600, ast: -240, adt: -180, cet: 60, cest: 120, eet: 120,
  eest: 180, wet: 0, west: 60, bst: 60, ist: 330, msk: 180, pkt: 300, hkt: 480, sgt: 480,
  pht: 480, jst: 540, kst: 540, cat: 120, eat: 180, wat: 60, sast: 120, aest: 600, aedt: 660,
  acst: 570, awst: 480, nzst: 720, nzdt: 780,
};

const ZONE_INDEX = new Map();
for (const z of ZONES) {
  const city = z[0].split('/').pop().replace(/_/g, ' ').toLowerCase();
  const zone = { id: z[0], name: z[0] === 'UTC' ? 'UTC' : z[0].split('/').pop().replace(/_/g, ' '), std: z[1], rule: z[2] };
  ZONE_INDEX.set(z[0].toLowerCase().replace(/_/g, ' '), zone);
  ZONE_INDEX.set(city, zone);
  for (const a of z[3]) ZONE_INDEX.set(a, zone);
}

function fixedOffsetLabel(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const a = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// Returns { name, std, rule, fixed } or null.
function findZone(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  const low = t.toLowerCase().replace(/_/g, ' ');
  if (low === '') return null;
  const m = /^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/.exec(low);
  if (m) {
    const h = Number(m[2]);
    const mi = m[3] === undefined ? 0 : Number(m[3]);
    if (h > 14 || mi > 59) return null;
    const minutes = (m[1] === '-' ? -1 : 1) * (h * 60 + mi);
    return { name: fixedOffsetLabel(minutes), std: minutes, rule: 'none', fixed: true };
  }
  if (Object.prototype.hasOwnProperty.call(ABBREVIATIONS, low)) {
    return { name: low.toUpperCase(), std: ABBREVIATIONS[low], rule: 'none', fixed: true };
  }
  const z = ZONE_INDEX.get(low);
  return z ? { name: z.name, std: z.std, rule: z.rule, fixed: false } : null;
}

// Day of month of the nth Sunday (1-based) of a month, or the last (n = 0).
function sunday(year, month, n) {
  const dow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const first = 1 + ((7 - dow) % 7);
  if (n > 0) return first + (n - 1) * 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return first + Math.floor((days - first) / 7) * 7;
}

const MIN = 60000;

// Whether daylight saving time is in force in `zone` at UTC instant `t`.
function isDst(zone, t) {
  const y = new Date(t).getUTCFullYear();
  const std = zone.std * MIN;
  if (zone.rule === 'US') {
    const start = Date.UTC(y, 2, sunday(y, 2, 2), 2) - std;
    const end = Date.UTC(y, 10, sunday(y, 10, 1), 2) - std - 60 * MIN;
    return t >= start && t < end;
  }
  if (zone.rule === 'EU') {
    return t >= Date.UTC(y, 2, sunday(y, 2, 0), 1) && t < Date.UTC(y, 9, sunday(y, 9, 0), 1);
  }
  if (zone.rule === 'AU') {
    return t >= Date.UTC(y, 9, sunday(y, 9, 1), 2) - std || t < Date.UTC(y, 3, sunday(y, 3, 1), 2) - std;
  }
  if (zone.rule === 'NZ') {
    return t >= Date.UTC(y, 8, sunday(y, 8, 0), 2) - std || t < Date.UTC(y, 3, sunday(y, 3, 1), 2) - std;
  }
  return false;
}

// The zone's offset from UTC, in minutes, at UTC instant `t`.
function offsetAt(zone, t) {
  return zone.std + (isDst(zone, t) ? 60 : 0);
}

// The UTC instant at which `zone`'s clock reads `local` (a UTC-based
// timestamp of the wall time). In an overlap the first (daylight) reading
// wins; a time skipped by the clocks moves forward by the gap.
function toUtc(zone, local) {
  const dst = local - (zone.std + 60) * MIN;
  const std = local - zone.std * MIN;
  if (zone.rule !== 'none' && offsetAt(zone, dst) === zone.std + 60) return dst;
  return std;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function parseClock(text) {
  const t = text.trim().toLowerCase();
  if (t === 'noon') return { h: 12, mi: 0, s: null };
  if (t === 'midnight') return { h: 0, mi: 0, s: null };
  const m = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/.exec(t);
  if (!m) return null;
  if (m[2] === undefined && m[4] === undefined) return null;
  let h = Number(m[1]);
  const mi = m[2] === undefined ? 0 : Number(m[2]);
  const s = m[3] === undefined ? null : Number(m[3]);
  if (mi > 59 || (s !== null && s > 59)) return null;
  if (m[4]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[4][0] === 'p' ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return { h, mi, s };
}

// "[date] time zone": splits the leading date and time from the zone name.
function parseWhen(text) {
  let rest = text.trim().replace(/^convert\s+/i, '');
  let date = null;
  const d = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]+|$)/.exec(rest);
  if (d) {
    date = { y: Number(d[1]), m: Number(d[2]) - 1, d: Number(d[3]) };
    const check = new Date(Date.UTC(date.y, date.m, date.d));
    if (check.getUTCMonth() !== date.m || check.getUTCDate() !== date.d) return null;
    rest = rest.slice(d[0].length);
  }
  const words = rest.split(/\s+/);
  for (const take of [2, 1]) {
    const clock = parseClock(words.slice(0, take).join(' '));
    if (clock) {
      const zone = findZone(words.slice(take).join(' '));
      if (zone) return { date, clock, zone };
    }
  }
  return null;
}

function convertZones(text, now) {
  let problem = null;
  for (const [left, right] of splits(text)) {
    const when = parseWhen(left);
    if (!when) continue;
    const names = right.split(/\s*[,;]\s*/);
    const zones = names.map(findZone);
    if (zones.some((z) => !z)) {
      problem = `Unknown time zone: ${names[zones.findIndex((z) => !z)]}.`;
      continue;
    }
    const { clock, zone: from } = when;
    let day;
    if (when.date) {
      day = Date.UTC(when.date.y, when.date.m, when.date.d);
    } else {
      const local = new Date(now + offsetAt(from, now) * MIN);
      day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    }
    const wall = day + ((clock.h * 60 + clock.mi) * 60 + (clock.s || 0)) * 1000;
    const instant = toUtc(from, wall);
    const parts = zones.map((to) => {
      const off = offsetAt(to, instant);
      const shown = new Date(instant + off * MIN);
      const shownDay = Date.UTC(shown.getUTCFullYear(), shown.getUTCMonth(), shown.getUTCDate());
      const shift = Math.round((shownDay - day) / 86400000);
      let out = `${pad2(shown.getUTCHours())}:${pad2(shown.getUTCMinutes())}`;
      if (clock.s !== null) out += `:${pad2(shown.getUTCSeconds())}`;
      if (when.date) out = `${shown.getUTCFullYear()}-${pad2(shown.getUTCMonth() + 1)}-${pad2(shown.getUTCDate())} ${out}`;
      out += ` ${to.name}`;
      if (!to.name.startsWith('UTC')) out += ` (${fixedOffsetLabel(off)})`;
      if (!when.date && shift !== 0) out += ` ${shift > 0 ? '+' : '-'}${Math.abs(shift)} day${Math.abs(shift) === 1 ? '' : 's'}`;
      return out;
    });
    return { text: parts.join('; ') };
  }
  return problem ? { error: problem } : null;
}

// ---- entry point -------------------------------------------------------

// Returns { text } or { error }.
function convertText(input, now) {
  const text = String(input).trim();
  if (text === '') return { error: 'Select something like "5 km to mi" or "14:00 Harare in New York".' };
  const at = now === undefined ? Date.now() : now;
  const units = convertUnits(text);
  if (units && units.text !== undefined) return units;
  const zones = convertZones(text, at);
  if (zones && zones.text !== undefined) return zones;
  return units || zones || { error: `Could not read "${text.length > 60 ? text.slice(0, 57) + '...' : text}". Try "5 km to mi", "72 F to C" or "14:00 Harare in New York".` };
}

function command(append) {
  return () => {
    const sel = kanso.editor.selection();
    if (!sel || sel.text.trim() === '') return { text: 'Select something like "5 km to mi" or "14:00 Harare in New York".' };
    let result;
    try {
      result = convertText(sel.text);
    } catch (e) {
      return { text: `Could not convert: ${e && e.message ? e.message : e}` };
    }
    if (result.error) return { text: result.error };
    const text = append ? `${sel.text.replace(/\s+$/, '')} = ${result.text}` : result.text;
    try {
      kanso.editor.replaceSelection({ text, selection: { start: sel.start, end: sel.end } });
    } catch (e) {
      if (e && e.code === 'conflict') return { text: 'The selection moved. Select the text again and rerun the command.' };
      return { text: `Could not change the text: ${e && e.message ? e.message : e}` };
    }
    return { text: result.text };
  };
}

kanso.commands.register({
  id: 'convert-replace',
  title: 'Convert units or time zones (replace selection)',
  keywords: ['convert', 'unit', 'timezone', 'time zone', 'temperature', 'length', 'mass', 'speed'],
  when: 'selection',
  run: command(false),
});
kanso.commands.register({
  id: 'convert-append',
  title: 'Convert units or time zones (add after selection)',
  keywords: ['convert', 'unit', 'timezone', 'time zone', 'equals'],
  when: 'selection',
  run: command(true),
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    convertText, convertUnits, convertZones, findUnit, findZone, parseQuantity, convertValue, formatNumber,
    offsetAt, isDst, toUtc, sunday, parseClock, ZONES, LINEAR,
  };
}
