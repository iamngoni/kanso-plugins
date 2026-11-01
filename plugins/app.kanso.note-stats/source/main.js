// Note stats: a panel of facts about the open note. Press Refresh to read
// the note again; a panel is drawn only when a command or button runs.

var WORDS_PER_MINUTE = 200;
var MAX_OUTLINE = 60;

function blankStats() {
  return {
    words: 0, sentences: 0, syllables: 0,
    links: 0, wikilinks: 0, tasks: 0, tasksDone: 0,
    headings: [],
  };
}

function stripFrontmatter(body) {
  var m = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(body);
  return m ? body.slice(m[0].length) : body;
}

function syllables(word) {
  var w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 1;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  var groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

// Plain prose of one line: link syntax, code and markup removed.
function prose(line) {
  return line
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<https?:\/\/[^>\s]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>+\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '');
}

function wordsIn(text) {
  return text.match(/[A-Za-z0-9À-￿]+(?:['’][A-Za-z]+)*/g) || [];
}

// Everything is counted line by line, so the counts of two texts joined by
// a blank line add up to the count of the whole.
function analyze(body) {
  var s = blankStats();
  var lines = stripFrontmatter(String(body)).split(/\r?\n/);
  var fence = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) { fence = f[1]; continue; }

    var heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading && heading[2].length > 0) {
      s.headings.push({ level: heading[1].length, text: prose(heading[2]).trim() || heading[2] });
    }
    var task = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s/.exec(line);
    if (task) {
      s.tasks += 1;
      if (task[1] !== ' ') s.tasksDone += 1;
    }
    var bare = line.replace(/`[^`]*`/g, ' ');
    s.wikilinks += (bare.match(/(^|[^!])\[\[[^\]\n]+\]\]/g) || []).length;
    var plain = bare.replace(/\[\[[^\]\n]*\]\]/g, ' ');
    s.links += (plain.match(/(^|[^!])\[[^\]]*\]\([^)\s]+[^)]*\)/g) || []).length
      + (plain.match(/<https?:\/\/[^>\s]+>/g) || []).length;

    var text = prose(line);
    var segments = text.split(/[.!?]+/);
    for (var j = 0; j < segments.length; j++) {
      var ws = wordsIn(segments[j]);
      if (ws.length > 0) {
        s.sentences += 1;
        s.words += ws.length;
        for (var k = 0; k < ws.length; k++) s.syllables += syllables(ws[k]);
      }
    }
  }
  return s;
}

function readingMinutes(words) {
  return words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

// Flesch reading ease, 0 to 100 (higher is easier), or null with no words.
function flesch(s) {
  if (s.words === 0 || s.sentences === 0) return null;
  var score = 206.835 - 1.015 * (s.words / s.sentences) - 84.6 * (s.syllables / s.words);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function band(score) {
  if (score === null) return 'n/a';
  if (score >= 90) return 'very easy';
  if (score >= 80) return 'easy';
  if (score >= 70) return 'fairly easy';
  if (score >= 60) return 'plain';
  if (score >= 50) return 'fairly difficult';
  if (score >= 30) return 'difficult';
  return 'very difficult';
}

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

function stat(label, value) {
  return {
    type: 'row', gap: 8,
    children: [
      { type: 'text', value: label, style: 'muted' },
      { type: 'text', value: String(value) },
    ],
  };
}

function buildPanel(title, s) {
  var score = flesch(s);
  var shown = s.headings.slice(0, MAX_OUTLINE).map(function (h) {
    var pad = new Array(h.level).join('  ');
    return { type: 'text', value: pad + h.text };
  });
  var outline = shown.length
    ? [{ type: 'list', items: shown }]
    : [{ type: 'text', value: 'No headings.', style: 'muted' }];
  if (s.headings.length > MAX_OUTLINE) {
    outline.push({ type: 'text', value: '+' + (s.headings.length - MAX_OUTLINE) + ' more', style: 'caption' });
  }
  return {
    type: 'column', gap: 12,
    children: [
      { type: 'heading', value: title || 'Untitled' },
      stat('Reading time', s.words === 0 ? '0 min' : readingMinutes(s.words) + ' min'),
      stat('Words', s.words),
      stat('Readability', score === null ? 'n/a' : score + ' (' + band(score) + ')'),
      { type: 'divider' },
      stat('Links', s.links),
      stat('Wikilinks', s.wikilinks),
      stat('Tasks', s.tasks === 0 ? '0' : s.tasksDone + ' of ' + s.tasks + ' done'),
      { type: 'divider' },
      { type: 'heading', value: 'Outline' },
      { type: 'column', gap: 4, children: outline },
      { type: 'button', id: 'refresh', label: 'Refresh', tone: 'primary' },
    ],
  };
}

function emptyPanel() {
  return {
    type: 'column', gap: 12,
    children: [
      { type: 'heading', value: 'Note stats' },
      { type: 'text', value: 'No note is open.', style: 'muted' },
      { type: 'button', id: 'refresh', label: 'Refresh', tone: 'primary' },
    ],
  };
}

function show() {
  var id = kanso.editor.noteId();
  if (id === null) {
    kanso.ui.panel(emptyPanel());
    return;
  }
  var note = kanso.notes.get(id);
  kanso.ui.panel(buildPanel(note.title, analyze(note.body)));
}

if (typeof module !== 'undefined') {
  module.exports = { analyze: analyze, flesch: flesch, band: band, syllables: syllables, readingMinutes: readingMinutes, buildPanel: buildPanel, plural: plural };
}

if (typeof kanso !== 'undefined') {
  kanso.commands.register({
    id: 'show-note-stats',
    title: 'Show note stats',
    keywords: ['words', 'reading time', 'readability', 'outline', 'statistics'],
    when: 'note-open',
    run: function () {
      show();
      return null;
    },
  });
  kanso.ui.onPress('refresh', function () {
    show();
    return null;
  });
}
