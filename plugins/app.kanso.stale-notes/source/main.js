// Stale notes: lists notes not changed in N months, and tags them #stale.
//
// Budget design: the list is newest first, 100 notes a call, so a press can
// read several thousand notes (at most MAX_CALLS calls, under 2 seconds).
// Where it stopped is kept in kanso.settings, and "Keep looking" goes on.
// Tagging costs one call per note, so it goes in steps too; the panel says
// how many are done.

const MAX_CALLS = 50;
const MAX_MS = 1500;
const MAX_KEPT = 250;
const MAX_SHOWN = 40;
const MONTHS = ['3', '6', '12', '24'];
const MONTH_MS = 30.4375 * 86400000;
const STALE = 'stale';

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

// Timestamps may be seconds or milliseconds.
function toMs(t) {
  if (typeof t !== 'number' || !isFinite(t)) return 0;
  return t < 100000000000 ? t * 1000 : t;
}

function cutoffFor(now, months) {
  return now - Number(months) * MONTH_MS;
}

function isStale(note, cutoff) {
  return toMs(note.updatedAt) < cutoff;
}

function hasStale(note) {
  return (note.tagNames || []).some((n) => String(n).toLowerCase() === STALE);
}

// Idempotent.
function withTag(tags, id) {
  return tags.indexOf(id) >= 0 ? tags.slice() : tags.concat([id]);
}

function day(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function freshState(months, now) {
  return { months: months, cutoff: cutoffFor(now, months), cursor: null, scanned: 0, done: false, notes: [], truncated: false, tagged: 0, skipped: 0, at: 0, tagId: null };
}

function scan(state) {
  const budget = newBudget();
  try {
    for (;;) {
      const page = spend(budget, () => kanso.notes.list({ limit: 100, cursor: state.cursor || undefined }));
      for (let i = 0; i < page.notes.length; i++) {
        const n = page.notes[i];
        state.scanned += 1;
        if (!isStale(n, state.cutoff) || hasStale(n)) continue;
        if (state.notes.length >= MAX_KEPT) {
          state.truncated = true;
          continue;
        }
        state.notes.push({ id: n.id, rev: n.rev, title: String(n.title || 'Untitled').slice(0, 60), tags: n.tags, updatedAt: toMs(n.updatedAt) });
      }
      state.cursor = page.cursor || null;
      if (!page.cursor) {
        state.done = true;
        return;
      }
    }
  } catch (error) {
    if (!isStop(error)) throw error;
  }
}

function findTagId(budget) {
  const page = spend(budget, () => kanso.notes.list({ tag: STALE, limit: 20 }));
  for (let i = 0; i < page.notes.length; i++) {
    const names = page.notes[i].tagNames || [];
    for (let j = 0; j < names.length; j++) if (String(names[j]).toLowerCase() === STALE) return page.notes[i].tags[j];
  }
  return null;
}

// Returns a message when it cannot go on.
function tagThem(state) {
  const budget = newBudget();
  try {
    if (!state.tagId) {
      state.tagId = findTagId(budget);
      if (!state.tagId) return 'Kanso has no tag called stale that this plugin can see. Tag one note #stale by hand first, then try again.';
    }
    while (state.at < state.notes.length) {
      if (outOfBudget(budget, 1)) throw { code: 'budget' };
      const n = state.notes[state.at];
      try {
        spend(budget, () => kanso.notes.update(n.id, { tags: withTag(n.tags, state.tagId) }, { baseRev: n.rev }));
        state.tagged += 1;
      } catch (error) {
        if (isStop(error)) throw error;
        state.skipped += 1;
      }
      state.at += 1;
    }
  } catch (error) {
    if (!isStop(error)) throw error;
  }
  return '';
}

function describe(state) {
  let text = `Read ${state.scanned} notes: ${state.notes.length} untouched for ${state.months} months or more.`;
  if (!state.done) text += ' Stopped to stay inside Kanso\'s limits. Press Keep looking.';
  if (state.truncated) text += ` Showing the first ${MAX_KEPT}; tag them and look again for the rest.`;
  if (state.at) text += ` Tagged ${state.tagged}` + (state.skipped ? `, ${state.skipped} skipped (edited meanwhile)` : '') + `, ${state.notes.length - state.at} to go.` + (state.at < state.notes.length ? " Press Keep tagging." : "");
  return text;
}

function show(state, months, message) {
  const children = [
    { type: 'heading', value: 'Stale notes' },
    { type: 'select', id: 'months', label: 'Not changed in at least (months)', options: MONTHS, value: months },
  ];
  const buttons = [{ type: 'button', id: 'list', label: state ? 'Look again' : 'List stale notes' }];
  if (state && !state.done) buttons.push({ type: 'button', id: 'more', label: 'Keep looking' });
  if (state && state.at < state.notes.length) {
    buttons.push({ type: 'button', id: 'tag', label: state.at ? 'Keep tagging' : 'Tag them #stale', tone: 'primary' });
  }
  children.push({ type: 'row', gap: 8, children: buttons });
  if (message) children.push({ type: 'text', value: message });
  if (state && state.notes.length) {
    children.push({ type: 'divider' });
    const rows = state.notes.slice(0, MAX_SHOWN).map((n) => ({
      type: 'row',
      gap: 8,
      children: [{ type: 'text', value: n.title }, { type: 'badge', value: day(n.updatedAt) }],
    }));
    children.push({ type: 'list', items: rows });
    if (state.notes.length > MAX_SHOWN) {
      children.push({ type: 'text', value: `and ${state.notes.length - MAX_SHOWN} more`, style: 'muted' });
    }
  }
  kanso.ui.panel({ type: 'column', gap: 10, children });
}

function monthsOf(values) {
  return values && MONTHS.indexOf(values.months) >= 0 ? values.months : '6';
}

function onList(values) {
  const months = monthsOf(values);
  const state = freshState(months, Date.now());
  scan(state);
  kanso.settings.set(state);
  show(state, months, describe(state));
  return null;
}

function onMore(values) {
  const months = monthsOf(values);
  const state = loadState();
  if (!state.cutoff || state.months !== months) return onList(values);
  scan(state);
  kanso.settings.set(state);
  show(state, months, describe(state));
  return null;
}

function onTag(values) {
  const months = monthsOf(values);
  const state = loadState();
  if (!state.cutoff || state.months !== months) {
    show(null, months, 'List the stale notes first.');
    return null;
  }
  const problem = tagThem(state);
  kanso.settings.set(state);
  show(state, months, problem || describe(state));
  return null;
}

kanso.commands.register({
  id: 'stale-notes',
  title: 'Find stale notes',
  keywords: ['stale', 'old', 'untouched', 'archive'],
  run: () => {
    show(null, '6', '');
    return null;
  },
});
kanso.ui.onPress('list', onList);
kanso.ui.onPress('more', onMore);
kanso.ui.onPress('tag', onTag);
