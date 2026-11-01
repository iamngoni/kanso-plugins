// Writing goals: a daily word target, set in the panel and kept in the
// plugin's settings. Progress is the open note's words or the words added
// today, with a streak of days the target was met. The panel is drawn when
// a command or button runs, so press Refresh to count again.

var DEFAULT_TARGET = 500;
var MAX_TARGET = 1000000;
var MAX_NOTES = 100;
var MODES = ['Today', 'Open note'];

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function dateKey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function yesterdayKey(d) {
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12));
}

function countWords(body) {
  var text = String(body).replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
  var lines = text.split(/\r?\n/);
  var fence = null;
  var n = 0;
  for (var i = 0; i < lines.length; i++) {
    var f = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) { fence = f[1]; continue; }
    var plain = lines[i]
      .replace(/`[^`]*`/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ');
    n += (plain.match(/[A-Za-z0-9À-￿]+(?:['’][A-Za-z]+)*/g) || []).length;
  }
  return n;
}

function freshState() {
  return { target: DEFAULT_TARGET, mode: 'Today', streak: 0, best: 0, lastMet: null, today: { date: null, notes: {} } };
}

// Reads whatever settings hold into a well-formed state.
function normalize(raw) {
  var s = freshState();
  if (!raw || typeof raw !== 'object') return s;
  if (Number.isInteger(raw.target) && raw.target >= 1 && raw.target <= MAX_TARGET) s.target = raw.target;
  if (MODES.indexOf(raw.mode) >= 0) s.mode = raw.mode;
  if (Number.isInteger(raw.streak) && raw.streak >= 0) s.streak = raw.streak;
  if (Number.isInteger(raw.best) && raw.best >= 0) s.best = raw.best;
  if (typeof raw.lastMet === 'string') s.lastMet = raw.lastMet;
  if (raw.today && typeof raw.today === 'object' && typeof raw.today.date === 'string' && raw.today.notes && typeof raw.today.notes === 'object') {
    s.today.date = raw.today.date;
    var ids = Object.keys(raw.today.notes).slice(0, MAX_NOTES);
    for (var i = 0; i < ids.length; i++) {
      var e = raw.today.notes[ids[i]];
      if (e && Number.isInteger(e.start) && Number.isInteger(e.last) && e.start >= 0 && e.last >= 0) {
        s.today.notes[ids[i]] = { start: e.start, last: e.last };
      }
    }
  }
  return s;
}

function addedToday(state) {
  var total = 0;
  var ids = Object.keys(state.today.notes);
  for (var i = 0; i < ids.length; i++) {
    var e = state.today.notes[ids[i]];
    total += Math.max(0, e.last - e.start);
  }
  return total;
}

// Notes one look at the open note: starts a new day when the date changed,
// records the note's words, and updates the streak. Returns the state.
function observe(state, now, noteId, words) {
  var key = dateKey(now);
  if (state.today.date !== key) state.today = { date: key, notes: {} };
  if (noteId !== null) {
    var e = state.today.notes[noteId];
    if (e) {
      e.last = words;
    } else {
      var ids = Object.keys(state.today.notes);
      if (ids.length >= MAX_NOTES) delete state.today.notes[ids[0]];
      state.today.notes[noteId] = { start: words, last: words };
    }
  }
  if (addedToday(state) >= state.target && state.lastMet !== key) {
    state.streak = state.lastMet === yesterdayKey(now) ? state.streak + 1 : 1;
    state.lastMet = key;
    if (state.streak > state.best) state.best = state.streak;
  }
  return state;
}

// The streak to show: it lapses once a whole day has passed without the target.
function shownStreak(state, now) {
  var key = dateKey(now);
  return state.lastMet === key || state.lastMet === yesterdayKey(now) ? state.streak : 0;
}

function parseTarget(text) {
  var t = String(text === undefined || text === null ? '' : text).trim().replace(/[,_ ]/g, '');
  if (!/^\d+$/.test(t)) return null;
  var n = Number(t);
  return n >= 1 && n <= MAX_TARGET ? n : null;
}

function fraction(done, target) {
  return target > 0 ? Math.max(0, Math.min(1, done / target)) : 0;
}

function buildPanel(state, now, openWords, note) {
  var today = addedToday(state);
  var measured = state.mode === 'Open note' ? openWords : today;
  var streak = shownStreak(state, now);
  var children = [
    { type: 'heading', value: 'Writing goal' },
    { type: 'text', value: measured === null ? 'No note is open.' : measured + ' of ' + state.target + ' words' },
    { type: 'progress', value: measured === null ? 0 : fraction(measured, state.target) },
    {
      type: 'row', gap: 8,
      children: [
        { type: 'badge', value: state.mode === 'Open note' ? 'Open note' : 'Today' },
        { type: 'badge', value: (streak === 1 ? '1 day streak' : streak + ' day streak') },
      ],
    },
    { type: 'text', value: 'Best streak: ' + state.best + (state.best === 1 ? ' day' : ' days') + '. Words added today: ' + today + '.', style: 'caption' },
  ];
  if (note) children.push({ type: 'text', value: note, style: 'muted' });
  children.push(
    { type: 'divider' },
    { type: 'input', id: 'target', label: 'Daily word target', value: String(state.target), placeholder: String(DEFAULT_TARGET) },
    { type: 'select', id: 'mode', label: 'Measure', value: state.mode, options: MODES },
    {
      type: 'row', gap: 8,
      children: [
        { type: 'button', id: 'save', label: 'Save', tone: 'primary' },
        { type: 'button', id: 'refresh', label: 'Refresh' },
      ],
    }
  );
  return { type: 'column', gap: 12, children: children };
}

function show(values, saving) {
  var now = new Date();
  var state = normalize(kanso.settings.get());
  var note = '';
  if (values) {
    if (MODES.indexOf(values.mode) >= 0) state.mode = values.mode;
    var t = parseTarget(values.target);
    if (t !== null) {
      state.target = t;
      if (saving) note = 'Saved.';
    } else if (values.target !== undefined && String(values.target).trim() !== '') {
      note = 'A target is a whole number from 1 to ' + MAX_TARGET + '. Kept ' + state.target + '.';
    }
  }
  var id = kanso.editor.noteId();
  var words = null;
  if (id !== null) words = countWords(kanso.notes.get(id).body);
  observe(state, now, id, words === null ? 0 : words);
  kanso.settings.set(state);
  kanso.ui.panel(buildPanel(state, now, words, note));
}

if (typeof module !== 'undefined') {
  module.exports = { countWords: countWords, normalize: normalize, observe: observe, addedToday: addedToday, shownStreak: shownStreak, parseTarget: parseTarget, buildPanel: buildPanel, dateKey: dateKey, yesterdayKey: yesterdayKey, freshState: freshState };
}

if (typeof kanso !== 'undefined') {
  kanso.commands.register({
    id: 'show-writing-goal',
    title: 'Show writing goal',
    keywords: ['daily', 'words', 'target', 'streak', 'progress'],
    run: function () {
      show(null, false);
      return null;
    },
  });
  kanso.ui.onPress('refresh', function (values) { show(values, false); return null; });
  kanso.ui.onPress('save', function (values) { show(values, true); return null; });
}
