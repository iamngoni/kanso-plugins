// Find and replace: plain text or a regular expression, across the notes
// this plugin may change. It shows the matches per note first; nothing is
// staged until Apply.
//
// Budget design: reading a note's text is one call, so a press reads or
// rewrites only a few dozen notes (Kanso allows 60 calls a minute and 2
// seconds of plugin time). Scan and apply both stop cleanly before a limit,
// keep their place in kanso.settings, and say how far they got.

const MAX_CALLS = 50;
const MAX_MS = 1500;
const PAGE = 10;
const MAX_KEPT = 100; // matches kept between presses (settings are 64 KB)
const MAX_SHOWN = 30; // notes with a checkbox in the panel
const CONTEXT = 30;
const MODES = ['Plain text', 'Regular expression'];

function newBudget() {
  return { calls: 0, startedAt: Date.now() };
}
function outOfBudget(budget, reserve) {
  return budget.calls + (reserve || 0) >= MAX_CALLS || Date.now() - budget.startedAt > MAX_MS;
}
function spend(budget, fn) {
  if (outOfBudget(budget, 0)) throw { code: 'budget' };
  budget.calls += 1;
  return fn();
}
function isStop(error) {
  return !!error && (error.code === 'budget' || error.code === 'limit' || error.code === 'timeout');
}
function loadState() {
  const saved = kanso.settings.get();
  return saved && typeof saved === 'object' ? saved : {};
}

// ---- pure logic ---------------------------------------------------------

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// { re } or { error }. An empty search never matches anything.
function buildMatcher(find, regex, caseSensitive) {
  if (typeof find !== 'string' || find === '') return { error: 'Type something to find.' };
  try {
    const source = regex ? find : escapeRegExp(find);
    return { re: new RegExp(source, caseSensitive ? 'g' : 'gi'), regex: !!regex };
  } catch (error) {
    return { error: 'That is not a valid pattern: ' + String(error && error.message ? error.message : error) };
  }
}

// $1..$9, $& and $$ in a regex replacement; plain text is taken literally.
function expand(template, match, groups, regex) {
  if (!regex) return template;
  return template.replace(/\$([$&1-9])/g, (_, c) => {
    if (c === '$') return '$';
    if (c === '&') return match;
    const group = groups[Number(c) - 1];
    return group === undefined ? '' : group;
  });
}

// { text, count }. Empty matches are left alone, so a pattern that can match
// nothing never inserts text.
function replaceAll(text, matcher, replacement) {
  if (!matcher.re) return { text: text, count: 0 };
  let count = 0;
  matcher.re.lastIndex = 0;
  const out = text.replace(matcher.re, (...args) => {
    const match = args[0];
    if (match === '') return match;
    count += 1;
    const groups = [];
    // args: match, groups..., offset, whole text, and an object of named groups if any
    const end = typeof args[args.length - 1] === 'object' ? args.length - 3 : args.length - 2;
    for (let i = 1; i < end; i++) groups.push(args[i]);
    return expand(replacement, match, groups, matcher.regex);
  });
  return { text: count === 0 ? text : out, count: count };
}

function countMatches(text, matcher) {
  return replaceAll(text, matcher, '').count;
}

// A line of context around the first non-empty match.
function firstSnippet(text, matcher) {
  if (!matcher.re) return '';
  matcher.re.lastIndex = 0;
  let m = matcher.re.exec(text);
  while (m !== null && m[0] === '') {
    matcher.re.lastIndex += 1;
    m = matcher.re.exec(text);
  }
  matcher.re.lastIndex = 0;
  if (m === null) return '';
  const from = Math.max(0, m.index - CONTEXT);
  const to = Math.min(text.length, m.index + m[0].length + CONTEXT);
  const clean = (s) => s.replace(/\s+/g, ' ');
  return (from > 0 ? '…' : '') + clean(text.slice(from, to)) + (to < text.length ? '…' : '');
}

function readForm(values) {
  const v = values || {};
  return {
    find: typeof v.find === 'string' ? v.find : '',
    replace: typeof v.replace === 'string' ? v.replace : '',
    mode: MODES.indexOf(v.mode) >= 0 ? v.mode : MODES[0],
    caseSensitive: v.caseSensitive === true,
    narrow: v.narrow !== false,
  };
}
function signature(form) {
  return JSON.stringify([form.find, form.replace, form.mode, form.caseSensitive, form.narrow]);
}
function matcherFor(form) {
  return buildMatcher(form.find, form.mode === MODES[1], form.caseSensitive);
}

// ---- scanning and applying ---------------------------------------------

function freshState(form) {
  return {
    sig: signature(form),
    cursor: null,
    scanned: 0,
    scanDone: false,
    matches: [],
    truncated: false,
    applied: 0,
    changed: 0,
    skipped: 0,
    excluded: [],
    applying: false,
  };
}

function scan(form, state, matcher) {
  const budget = newBudget();
  const useQuery = form.narrow && form.mode === MODES[0];
  try {
    for (;;) {
      if (outOfBudget(budget, PAGE + 1)) throw { code: 'budget' };
      const page = spend(budget, () =>
        kanso.notes.list({ query: useQuery ? form.find : undefined, limit: PAGE, cursor: state.cursor || undefined }),
      );
      for (let i = 0; i < page.notes.length; i++) {
        const summary = page.notes[i];
        let note;
        try {
          note = spend(budget, () => kanso.notes.get(summary.id));
        } catch (error) {
          if (isStop(error)) throw error;
          continue;
        }
        state.scanned += 1;
        const n = countMatches(note.body || '', matcher);
        if (n === 0) continue;
        if (state.matches.length >= MAX_KEPT) {
          state.truncated = true;
          continue;
        }
        state.matches.push({
          id: note.id,
          title: note.title || 'Untitled',
          count: n,
          snippet: firstSnippet(note.body || '', matcher),
        });
      }
      state.cursor = page.cursor || null;
      if (!page.cursor || state.truncated) {
        state.scanDone = true;
        return;
      }
    }
  } catch (error) {
    if (!isStop(error)) throw error;
  }
}

function apply(form, state, matcher) {
  const budget = newBudget();
  try {
    while (state.applied < state.matches.length) {
      // a note costs a read and an update
      if (outOfBudget(budget, 2)) throw { code: 'budget' };
      const entry = state.matches[state.applied];
      if (state.excluded.indexOf(entry.id) >= 0) {
        state.applied += 1;
        continue;
      }
      try {
        const note = spend(budget, () => kanso.notes.get(entry.id));
        const result = replaceAll(note.body || '', matcher, form.replace);
        if (result.count === 0 || result.text === note.body) {
          state.skipped += 1;
        } else {
          spend(budget, () => kanso.notes.update(note.id, { body: result.text }, { baseRev: note.rev }));
          state.changed += 1;
        }
      } catch (error) {
        if (isStop(error)) throw error;
        state.skipped += 1; // gone, hidden, or edited since it was read
      }
      state.applied += 1;
    }
    state.applying = false;
  } catch (error) {
    if (!isStop(error)) throw error;
  }
}

// ---- panel ----------------------------------------------------------------

function formNodes(form) {
  return [
    { type: 'input', id: 'find', label: 'Find', value: form.find },
    { type: 'input', id: 'replace', label: 'Replace with', value: form.replace },
    { type: 'select', id: 'mode', label: 'Match as', options: MODES, value: form.mode },
    { type: 'toggle', id: 'caseSensitive', label: 'Match case', value: form.caseSensitive },
    { type: 'toggle', id: 'narrow', label: 'Plain text: let Kanso search narrow the notes first (faster; can miss part-word matches)', value: form.narrow },
  ];
}

function show(form, state, message) {
  const children = [{ type: 'heading', value: 'Find and replace' }].concat(formNodes(form));
  const buttons = [{ type: 'button', id: 'preview', label: 'Preview matches' }];
  if (state && !state.scanDone && !state.applying) buttons.push({ type: 'button', id: 'more', label: 'Keep looking' });
  if (state && state.matches.length && state.applied < state.matches.length) {
    buttons.push({ type: 'button', id: 'apply', label: state.applied ? 'Keep applying' : 'Apply', tone: 'primary' });
  }
  children.push({ type: 'row', gap: 8, children: buttons });
  if (message) children.push({ type: 'text', value: message });
  if (state && state.matches.length) {
    children.push({ type: 'divider' });
    children.push({ type: 'heading', value: 'Matches' });
    const rows = [];
    const shown = state.matches.slice(0, MAX_SHOWN);
    for (let i = 0; i < shown.length; i++) {
      const m = shown[i];
      rows.push({
        type: 'column',
        gap: 2,
        children: [
          {
            type: 'toggle',
            id: 'inc-' + i,
            label: `${m.title} (${m.count})`,
            value: state.excluded.indexOf(m.id) < 0,
          },
          { type: 'text', value: m.snippet, style: 'caption' },
        ],
      });
    }
    children.push({ type: 'list', items: rows });
    if (state.matches.length > shown.length) {
      children.push({
        type: 'text',
        value: `and ${state.matches.length - shown.length} more notes, which will be changed too`,
        style: 'muted',
      });
    }
  }
  kanso.ui.panel({ type: 'column', gap: 10, children });
}

function describe(state) {
  const total = state.matches.reduce((sum, m) => sum + m.count, 0);
  let text = `Read ${state.scanned} notes: ${total} matches in ${state.matches.length} notes.`;
  if (state.truncated) text += ` Showing the first ${MAX_KEPT} notes; apply them, then preview again for the rest.`;
  else if (!state.scanDone) text += ' Stopped to stay inside Kanso\'s limits. Press Keep looking.';
  else text += ' That is every note it may read.';
  if (state.applied) {
    text += ` Applied to ${state.changed} notes` + (state.skipped ? `, ${state.skipped} skipped (changed meanwhile or no longer matching)` : '') + `, ${state.matches.length - state.applied} to go.`;
  }
  return text;
}

function excludedFrom(values, state) {
  const out = [];
  for (let i = 0; i < Math.min(state.matches.length, MAX_SHOWN); i++) {
    if (values && values['inc-' + i] === false) out.push(state.matches[i].id);
  }
  return out;
}

function onPreview(values) {
  const form = readForm(values);
  const matcher = matcherFor(form);
  if (matcher.error) return show(form, null, matcher.error), null;
  const state = freshState(form);
  scan(form, state, matcher);
  kanso.settings.set(state);
  show(form, state, describe(state));
  return null;
}

function onMore(values) {
  const form = readForm(values);
  const matcher = matcherFor(form);
  if (matcher.error) return show(form, null, matcher.error), null;
  let state = loadState();
  if (state.sig !== signature(form) || !state.matches) return onPreview(values);
  state.excluded = excludedFrom(values, state);
  scan(form, state, matcher);
  kanso.settings.set(state);
  show(form, state, describe(state));
  return null;
}

function onApply(values) {
  const form = readForm(values);
  const matcher = matcherFor(form);
  if (matcher.error) return show(form, null, matcher.error), null;
  const state = loadState();
  if (state.sig !== signature(form) || !state.matches) {
    show(form, null, 'The search changed since the preview. Preview again first.');
    return null;
  }
  if (!state.applying) state.excluded = excludedFrom(values, state);
  state.applying = true;
  apply(form, state, matcher);
  kanso.settings.set(state);
  show(form, state, describe(state));
  return null;
}

kanso.commands.register({
  id: 'find-replace',
  title: 'Find and replace across notes',
  keywords: ['find', 'replace', 'regex', 'search'],
  run: () => {
    show(readForm({}), null, '');
    return null;
  },
});
kanso.ui.onPress('preview', onPreview);
kanso.ui.onPress('more', onMore);
kanso.ui.onPress('apply', onApply);
