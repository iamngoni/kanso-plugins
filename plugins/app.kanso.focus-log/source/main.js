// Focus log: Start and Stop buttons. There is no running timer: a plugin
// can't run in the background, so Start records the time of the press and
// Stop works out the length from the time of its own press.

var DESTINATIONS = ['Note text', 'Note data', 'This panel only'];
var MAX_LABEL = 200;
var MAX_DAYS = 14;
var MAX_SESSIONS_PER_DAY = 100;
var MAX_SHOWN = 20;
var MAX_NOTE_DATA = 100;

function pad2(n) { return n < 10 ? '0' + n : String(n); }
function hhmm(ms) { var d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function dayKey(ms) {
  var d = new Date(ms);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function cleanLabel(text) {
  return String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}

function minutesBetween(start, end) {
  var ms = end - start;
  if (!(ms > 0)) return 0;
  return Math.max(1, Math.round(ms / 60000));
}

// `- 14:00–14:45 (45 min) label`, always one line.
function logLine(start, end, label) {
  var min = minutesBetween(start, end);
  var line = '- ' + hhmm(start) + '\u2013' + hhmm(end) + ' (' + min + ' min)';
  var text = cleanLabel(label);
  return text ? line + ' ' + text : line;
}

function freshState() {
  return { running: null, days: {}, dest: 'Note text' };
}

function normalize(raw) {
  var s = freshState();
  if (!raw || typeof raw !== 'object') return s;
  if (DESTINATIONS.indexOf(raw.dest) >= 0) s.dest = raw.dest;
  if (raw.running && typeof raw.running === 'object' && Number.isFinite(raw.running.start) && raw.running.start > 0) {
    s.running = { start: raw.running.start, label: cleanLabel(raw.running.label) };
  }
  if (raw.days && typeof raw.days === 'object') {
    var keys = Object.keys(raw.days).filter(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); }).sort().slice(-MAX_DAYS);
    keys.forEach(function (k) {
      var list = Array.isArray(raw.days[k]) ? raw.days[k] : [];
      s.days[k] = list.filter(function (e) {
        return e && typeof e.from === 'string' && typeof e.to === 'string' && Number.isInteger(e.min) && e.min >= 0;
      }).slice(-MAX_SESSIONS_PER_DAY).map(function (e) {
        return { from: e.from.slice(0, 5), to: e.to.slice(0, 5), min: e.min, label: cleanLabel(e.label) };
      });
    });
  }
  return s;
}

function start(state, now, label) {
  if (state.running) return false;
  state.running = { start: now, label: cleanLabel(label) };
  return true;
}

// Ends the running session and files it under the day it ended.
function stop(state, now, label) {
  if (!state.running) return null;
  var began = state.running.start;
  var text = cleanLabel(label) || state.running.label;
  var entry = { from: hhmm(began), to: hhmm(now), min: minutesBetween(began, now), label: text };
  var key = dayKey(now);
  var list = state.days[key] || [];
  list.push(entry);
  state.days[key] = list.slice(-MAX_SESSIONS_PER_DAY);
  var keys = Object.keys(state.days).sort();
  while (keys.length > MAX_DAYS) delete state.days[keys.shift()];
  state.running = null;
  return { entry: entry, line: logLine(began, now, text) };
}

function todayTotal(state, now) {
  var list = state.days[dayKey(now)] || [];
  var total = 0;
  for (var i = 0; i < list.length; i++) total += list[i].min;
  return total;
}

function duration(min) {
  if (min < 60) return min + ' min';
  var h = Math.floor(min / 60);
  var m = min % 60;
  return h + ' h' + (m ? ' ' + m + ' min' : '');
}

function appendLine(body, line) {
  var text = String(body);
  return text + (text === '' || text.endsWith('\n') ? '' : '\n') + line + '\n';
}

function buildPanel(state, now, note) {
  var today = state.days[dayKey(now)] || [];
  var shown = today.slice(-MAX_SHOWN).map(function (e) {
    return { type: 'text', value: e.from + '\u2013' + e.to + ' (' + e.min + ' min)' + (e.label ? ' ' + e.label : '') };
  });
  var children = [
    { type: 'heading', value: 'Focus log' },
    state.running
      ? { type: 'text', value: 'Started at ' + hhmm(state.running.start) + (state.running.label ? ': ' + state.running.label : '') + '. Press Stop to log it.' }
      : { type: 'text', value: 'Not running.', style: 'muted' },
    { type: 'text', value: 'There is no running timer. The length is worked out when you press Stop.', style: 'caption' },
  ];
  if (note) children.push({ type: 'text', value: note });
  children.push(
    { type: 'input', id: 'label', label: 'Label', value: '', placeholder: 'What are you working on?' },
    { type: 'select', id: 'dest', label: 'Save to', value: state.dest, options: DESTINATIONS },
    {
      type: 'row', gap: 8,
      children: [
        { type: 'button', id: 'start', label: 'Start', tone: 'primary' },
        { type: 'button', id: 'stop', label: 'Stop' },
        { type: 'button', id: 'refresh', label: 'Refresh' },
      ],
    },
    { type: 'divider' },
    { type: 'heading', value: 'Today: ' + duration(todayTotal(state, now)) },
    shown.length ? { type: 'list', items: shown } : { type: 'text', value: 'No sessions yet today.', style: 'muted' }
  );
  if (today.length > MAX_SHOWN) children.push({ type: 'text', value: 'Showing the latest ' + MAX_SHOWN + ' of ' + today.length + '.', style: 'caption' });
  return { type: 'column', gap: 12, children: children };
}

function save(noteId, state, result) {
  if (state.dest === 'This panel only') return 'Logged in this panel only.';
  if (noteId === null) return 'No note is open, so it was logged in this panel only.';
  try {
    var note = kanso.notes.get(noteId);
    if (state.dest === 'Note text') {
      kanso.notes.update(noteId, { body: appendLine(note.body, result.line) }, { baseRev: note.rev });
      return 'Added to the note: ' + result.line;
    }
    var data = kanso.notes.pluginData.get(noteId);
    var sessions = data && Array.isArray(data.sessions) ? data.sessions : [];
    sessions.push({ date: dayKey(Date.now()), from: result.entry.from, to: result.entry.to, min: result.entry.min, label: result.entry.label });
    kanso.notes.pluginData.set(noteId, { sessions: sessions.slice(-MAX_NOTE_DATA) });
    return 'Saved in the note\u2019s plugin data.';
  } catch (e) {
    if (e && (e.code === 'denied' || e.code === 'conflict' || e.code === 'not_found')) {
      return 'Logged in this panel only: ' + (e.code === 'denied' ? 'this note can\u2019t be changed by the plugin' : 'the note changed or is unavailable') + '.';
    }
    throw e;
  }
}

function act(kind, values) {
  var now = Date.now();
  var state = normalize(kanso.settings.get());
  var label = values ? values.label : '';
  if (values && DESTINATIONS.indexOf(values.dest) >= 0) state.dest = values.dest;
  var note = '';
  if (kind === 'start') {
    note = start(state, now, label) ? 'Started at ' + hhmm(now) + '.' : 'Already running since ' + hhmm(state.running.start) + '. Stop it first.';
  } else if (kind === 'stop') {
    var result = stop(state, now, label);
    note = result ? save(kanso.editor.noteId(), state, result) : 'Nothing is running.';
  }
  kanso.settings.set(state);
  kanso.ui.panel(buildPanel(state, now, note));
}

if (typeof module !== 'undefined') {
  module.exports = { logLine: logLine, minutesBetween: minutesBetween, normalize: normalize, start: start, stop: stop, todayTotal: todayTotal, buildPanel: buildPanel, appendLine: appendLine, cleanLabel: cleanLabel, freshState: freshState, hhmm: hhmm, dayKey: dayKey };
}

if (typeof kanso !== 'undefined') {
  kanso.commands.register({
    id: 'show-focus-log',
    title: 'Show focus log',
    keywords: ['focus', 'timer', 'pomodoro', 'session', 'time tracking'],
    run: function () { act('show', null); return null; },
  });
  kanso.ui.onPress('start', function (v) { act('start', v); return null; });
  kanso.ui.onPress('stop', function (v) { act('stop', v); return null; });
  kanso.ui.onPress('refresh', function (v) { act('show', v); return null; });
}
