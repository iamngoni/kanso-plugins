// Daily header: puts a line with today's date and the weather in your city at
// the top of the open note. Running it again the same day (or any later day)
// replaces that line instead of adding another. The weather comes from
// Open-Meteo, which needs no key.

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const MARK = '<!-- daily-header -->';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// WMO weather codes, as Open-Meteo documents them.
const WEATHER = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'heavy freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail',
};

// ---- Pure helpers -------------------------------------------------------

const SPECIALS = /([\\`*_\[\]<>#~|&])/g;

function escapeLine(line) {
  return line
    .replace(SPECIALS, '\\$1')
    .replace(/^(\s*)([-+=])/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/, '$1\\$2');
}

function escapeText(text) {
  return String(text == null ? '' : text).split(/\r\n|\r|\n/).map(escapeLine).join('\n');
}

function unescapeText(text) {
  return text.replace(/\\([\\`*_\[\]<>#~|&\-+=.)])/g, '$1');
}

function oneLine(text, max) {
  return Array.from(String(text == null ? '' : text).replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}

// "2026-11-01" or "2026-11-01T11:45" -> "Sunday, 1 November 2026", or null.
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${DAYS[date.getUTCDay()]}, ${d} ${MONTHS[mo - 1]} ${y}`;
}

function localIso(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function degrees(value, unit) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}°${unit}` : null;
}

// Weather read from Open-Meteo's forecast answer, or null.
function readWeather(data, unit) {
  if (!data || typeof data !== 'object') return null;
  const cur = data.current || {};
  const day = data.daily || {};
  const pick = (arr) => (Array.isArray(arr) ? arr[0] : undefined);
  const now = degrees(cur.temperature_2m, unit);
  if (!now) return null;
  const rain = pick(day.precipitation_probability_max);
  return {
    date: cur.time || pick(day.time) || null,
    temp: now,
    sky: WEATHER[cur.weather_code] || null,
    high: degrees(pick(day.temperature_2m_max), unit),
    low: degrees(pick(day.temperature_2m_min), unit),
    rain: typeof rain === 'number' ? `${Math.round(rain)}% chance of rain` : null,
  };
}

function headerLines({ dateIso, place, weather }) {
  const date = longDate(dateIso) || longDate(localIso(new Date()));
  const parts = [`**${escapeText(date)}**`];
  if (place) parts.push(escapeText(oneLine(place, 120)));
  if (weather) {
    parts.push(escapeText(`${weather.temp}${weather.sky ? `, ${weather.sky}` : ''}`));
    if (weather.high && weather.low) parts.push(escapeText(`high ${weather.high}, low ${weather.low}`));
    if (weather.rain) parts.push(escapeText(weather.rain));
  }
  return `${MARK}\n${parts.join(' · ')}`;
}

// Puts the header at the top, replacing one we put there before.
function applyHeader(body, header) {
  const m = /^\s*<!-- daily-header -->[^\n]*\n[^\n]*(\n|$)(\n)?/.exec(body);
  const rest = m ? body.slice(m[0].length) : body.replace(/^\n+/, '');
  return `${header}\n\n${rest}`;
}

function header(res, name) {
  const h = (res && res.headers) || {};
  for (const k of Object.keys(h)) if (k.toLowerCase() === name) return h[k];
  return null;
}

// ---- Kanso side ----------------------------------------------------------

function state() {
  const s = kanso.settings.get();
  return s && typeof s === 'object' ? s : {};
}

function get(url) {
  const res = kanso.fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 200) {
    try {
      return { data: JSON.parse(res.body) };
    } catch (e) {
      return { error: 'Open-Meteo sent something unexpected.' };
    }
  }
  if (res.status === 429) {
    const wait = header(res, 'retry-after');
    return { error: `Open-Meteo asked us to slow down${wait ? ` (try again in ${wait}s)` : ''}.` };
  }
  return { error: `Open-Meteo answered ${res.status}.` };
}

// { lat, lon, name } for the city, from the saved answer when the name is
// unchanged, else from the geocoder.
function locate(st) {
  const city = oneLine(st.city, 100);
  if (st.geo && st.geo.query === city && typeof st.geo.lat === 'number') return { geo: st.geo };
  const got = get(`${GEO}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
  if (got.error) return { error: got.error };
  const hit = got.data && Array.isArray(got.data.results) ? got.data.results[0] : null;
  if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') {
    return { error: `Open-Meteo does not know a place called "${city}". Try the city's usual English name.` };
  }
  const name = [hit.name, hit.country].filter(Boolean).join(', ');
  return { geo: { query: city, lat: hit.latitude, lon: hit.longitude, name } };
}

function insertHeader() {
  const id = kanso.editor.noteId();
  if (id === null) return { text: 'Open a note first.' };
  const note = kanso.notes.get(id);
  const st = state();
  const unit = st.unit === 'F' ? 'F' : 'C';
  let place = null;
  let weather = null;
  let dateIso = localIso(new Date());
  if (oneLine(st.city, 100)) {
    const where = locate(st);
    if (where.error) return { text: `${where.error} The note is unchanged.` };
    const { geo } = where;
    const q = `latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto${unit === 'F' ? '&temperature_unit=fahrenheit' : ''}`;
    const got = get(`${FORECAST}?${q}`);
    if (got.error) return { text: `${got.error} The note is unchanged.` };
    weather = readWeather(got.data, unit);
    if (!weather) return { text: 'Open-Meteo sent no weather for that place. The note is unchanged.' };
    place = geo.name;
    dateIso = weather.date || dateIso;
    if (st.geo !== geo) {
      st.geo = geo;
      kanso.settings.set(st);
    }
  }
  const body = applyHeader(note.body, headerLines({ dateIso, place, weather }));
  if (body !== note.body) kanso.notes.update(note.id, { body }, { baseRev: note.rev });
  return { text: weather ? `Added the header: ${weather.temp} in ${place}.` : 'Added the date header. Set a city in "Daily header settings" for the weather.' };
}

function panel(message) {
  const st = state();
  const kids = [
    { type: 'heading', value: 'Daily header' },
    { type: 'input', id: 'city', label: 'City', value: st.city || '', placeholder: 'Harare' },
    { type: 'select', id: 'unit', label: 'Temperature', value: st.unit === 'F' ? 'Fahrenheit' : 'Celsius', options: ['Celsius', 'Fahrenheit'] },
    { type: 'button', id: 'save', label: 'Save', tone: 'primary' },
  ];
  if (message) kids.push({ type: 'text', value: message, style: 'muted' });
  kanso.ui.panel({ type: 'column', gap: 10, children: kids });
}

kanso.commands.register({
  id: 'insert',
  title: 'Insert the daily header (date and weather)',
  keywords: ['date', 'weather', 'header', 'daily'],
  when: 'note-open',
  run: () => insertHeader(),
});
kanso.commands.register({
  id: 'settings',
  title: 'Daily header settings (city)',
  keywords: ['weather', 'city'],
  run: () => {
    panel();
    return null;
  },
});
kanso.ui.onPress('save', (values) => {
  const st = state();
  if (values && typeof values.city === 'string') {
    st.city = oneLine(values.city, 100);
    st.geo = null;
  }
  if (values && typeof values.unit === 'string') st.unit = values.unit === 'Fahrenheit' ? 'F' : 'C';
  kanso.settings.set(st);
  panel(st.city ? `Saved. The header will use the weather in ${st.city}.` : 'Saved. With no city the header shows only the date.');
  return null;
});

if (typeof globalThis.__kansoTest === 'object') {
  globalThis.__kansoTest.exports = { escapeText, unescapeText, longDate, readWeather, headerLines, applyHeader };
}
