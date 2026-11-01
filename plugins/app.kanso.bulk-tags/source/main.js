// Bulk tags: add, remove or rename a tag across the notes this plugin may
// change. The scope is the notebooks chosen at install, optionally narrowed
// to notes that carry another tag.
//
// Budget design: a press makes at most MAX_CALLS calls (Kanso allows 60 a
// minute) and stops cleanly before 2 seconds of its own time. Notes are read
// a small page at a time, so a page is either handled completely or not
// started. Where it stopped is kept in kanso.settings, and "Continue"
// picks up from there.

const MAX_CALLS = 50;
const MAX_MS = 1500;
const PAGE = 20;
const ACTIONS = ['Add a tag', 'Remove a tag', 'Rename a tag'];

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

function cleanTag(text) {
  return String(text === undefined || text === null ? '' : text)
    .trim()
    .replace(/^#+/, '')
    .trim();
}

function actionKey(label) {
  if (label === ACTIONS[1]) return 'remove';
  if (label === ACTIONS[2]) return 'rename';
  return 'add';
}

// The new tag list for one note. `from` and `to` are tag IDs. Pure and
// idempotent: applying it twice gives what applying it once does.
function retag(tags, action, from, to) {
  const list = tags.slice();
  const has = (id) => list.indexOf(id) >= 0;
  if (action === 'add') return has(to) ? list : list.concat([to]);
  if (action === 'remove') return list.filter((id) => id !== from);
  if (action === 'rename') {
    if (!has(from) || from === to) return list;
    const rest = list.filter((id) => id !== from);
    return rest.indexOf(to) >= 0 ? rest : rest.concat([to]);
  }
  return list;
}

function sameList(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function hasTagNamed(note, name) {
  const want = name.toLowerCase();
  return (note.tagNames || []).some((n) => String(n).toLowerCase() === want);
}

function tagIdByName(note, name) {
  const want = name.toLowerCase();
  const names = note.tagNames || [];
  for (let i = 0; i < names.length; i++) {
    if (String(names[i]).toLowerCase() === want) return note.tags[i];
  }
  return null;
}

function readForm(values) {
  const v = values || {};
  return {
    action: ACTIONS.indexOf(v.action) >= 0 ? v.action : ACTIONS[0],
    tag: cleanTag(v.tag),
    to: cleanTag(v.to),
    scope: cleanTag(v.scope),
  };
}

function formProblem(form) {
  if (!form.tag) return 'Type the tag to work on.';
  if (actionKey(form.action) === 'rename') {
    if (!form.to) return 'Type the new name.';
    if (form.to.toLowerCase() === form.tag.toLowerCase()) return 'The new name is the same as the old one.';
  }
  return null;
}

// Kanso gives a plugin tag IDs and names but no tag list, so an ID is found
// from a note that carries the tag.
function resolveTag(budget, name, cache) {
  const key = name.toLowerCase();
  if (cache[key]) return cache[key];
  const page = spend(budget, () => kanso.notes.list({ tag: name, limit: 20 }));
  for (let i = 0; i < page.notes.length; i++) {
    const id = tagIdByName(page.notes[i], name);
    if (id) {
      cache[key] = id;
      return id;
    }
  }
  return null;
}

function signature(form) {
  return [form.action, form.tag.toLowerCase(), form.to.toLowerCase(), form.scope.toLowerCase()].join('|');
}

function freshState(form) {
  return { sig: signature(form), cursor: null, seen: 0, changed: 0, failed: 0, cache: {} };
}

// One press: handles whole pages until done or near a limit. Returns a
// report; `state` is what to keep for "Continue".
function runBatch(form, state) {
  const budget = newBudget();
  const action = actionKey(form.action);
  const report = { done: false, note: '' };
  try {
    const from = action === 'add' ? null : resolveTag(budget, form.tag, state.cache);
    if (action !== 'add' && !from) {
      report.done = true;
      report.note = `No note you've allowed has a tag called ${form.tag}.`;
      return report;
    }
    let to = null;
    if (action !== 'remove') {
      const name = action === 'add' ? form.tag : form.to;
      to = resolveTag(budget, name, state.cache);
      if (!to) {
        report.done = true;
        report.note =
          `Kanso has no tag called ${name} that this plugin can see. ` +
          'Tag one note with it by hand first, then run this again.';
        return report;
      }
    }
    const serverTag = action === 'add' ? form.scope || undefined : form.tag;
    const clientScope = action === 'add' ? null : form.scope;
    for (;;) {
      // A page is at most PAGE updates plus the list call; don't start one
      // that might not finish.
      if (outOfBudget(budget, PAGE + 1)) throw { code: 'budget' };
      const page = spend(budget, () =>
        kanso.notes.list({ tag: serverTag, limit: PAGE, cursor: state.cursor || undefined }),
      );
      for (let i = 0; i < page.notes.length; i++) {
        const note = page.notes[i];
        state.seen += 1;
        if (clientScope && !hasTagNamed(note, clientScope)) continue;
        const next = retag(note.tags, action, from, to);
        if (sameList(next, note.tags)) continue;
        try {
          spend(budget, () => kanso.notes.update(note.id, { tags: next }, { baseRev: note.rev }));
          state.changed += 1;
        } catch (error) {
          if (isStop(error)) throw error;
          state.failed += 1;
        }
      }
      // Remove and rename take notes out of the list they read, so a
      // stopped run starts from the top again; add keeps its place.
      state.cursor = page.cursor || null;
      if (!page.cursor) {
        report.done = true;
        return report;
      }
    }
  } catch (error) {
    if (!isStop(error)) throw error;
    if (action !== 'add') state.cursor = null;
    report.note = 'Stopped here to stay inside Kanso\'s limits.';
    return report;
  }
}

function summary(report, state, action) {
  const parts = [`Looked at ${state.seen} notes, changed ${state.changed}`];
  if (state.failed) parts.push(`${state.failed} could not be changed (edited meanwhile)`);
  let text = parts.join('; ') + '.';
  if (report.note) text += ' ' + report.note;
  if (!report.done) {
    text += action === 'add' ? ' Press Continue to go on.' : ' Check the changes, then press Continue.';
  } else if (!report.note) {
    text += ' Done.';
  }
  return text;
}

function show(form, message, canContinue) {
  const children = [
    { type: 'heading', value: 'Bulk tags' },
    { type: 'select', id: 'action', label: 'What to do', options: ACTIONS, value: form.action },
    { type: 'input', id: 'tag', label: 'Tag', value: form.tag, placeholder: 'project' },
    { type: 'input', id: 'to', label: 'New name (rename only)', value: form.to, placeholder: 'project-x' },
    {
      type: 'input',
      id: 'scope',
      label: 'Only notes that also have this tag (optional)',
      value: form.scope,
      placeholder: 'leave empty for all',
    },
    { type: 'text', value: 'Works on the notebooks you chose for this plugin. The tag must already exist on a note.', style: 'muted' },
    { type: 'button', id: 'run', label: 'Start' },
  ];
  if (canContinue) children.push({ type: 'button', id: 'continue', label: 'Continue', tone: 'primary' });
  if (message) {
    children.push({ type: 'divider' });
    children.push({ type: 'text', value: message });
  }
  kanso.ui.panel({ type: 'column', gap: 10, children });
}

function press(values, resume) {
  const form = readForm(values);
  const problem = formProblem(form);
  if (problem) {
    show(form, problem, false);
    return null;
  }
  let state = resume ? loadState() : null;
  if (!state || state.sig !== signature(form)) state = freshState(form);
  const report = runBatch(form, state);
  kanso.settings.set(report.done ? {} : state);
  show(form, summary(report, state, actionKey(form.action)), !report.done);
  return null;
}

kanso.commands.register({
  id: 'bulk-tags',
  title: 'Bulk tags: add, remove or rename a tag',
  keywords: ['tag', 'tags', 'rename', 'retag'],
  run: () => {
    show(readForm({}), '', false);
    return null;
  },
});
kanso.ui.onPress('run', (values) => press(values, false));
kanso.ui.onPress('continue', (values) => press(values, true));
