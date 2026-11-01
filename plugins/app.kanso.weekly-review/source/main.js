// Weekly review: makes a note listing the notes created or changed in the
// last few days, grouped by notebook, each as a [[link]].
//
// Budget design: the list comes newest-changed first, 100 a call, so it
// stops at the first note older than the window. At most MAX_PAGES calls
// (plus one for the notebook choice and one to create) are made, well
// inside Kanso's 60 a minute; if the window holds more than that, the
// review says so rather than pretending to be complete.

const MAX_PAGES = 8;
const DAY_OPTIONS = ['7', '14', '30'];
const DAY_MS = 86400000;
const TITLE_PREFIX = 'Weekly review';

// Timestamps may be seconds or milliseconds; tell them apart.
function toMs(t) {
  if (typeof t !== 'number' || !isFinite(t)) return 0;
  return t < 100000000000 ? t * 1000 : t;
}

function day(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Titles go inside [[ ]], where these characters would break the link.
function linkText(title) {
  const clean = String(title || '').replace(/[\[\]|#^\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean === '' ? 'Untitled' : clean;
}

function inWindow(note, now, days) {
  const from = now - days * DAY_MS;
  return toMs(note.updatedAt) >= from || toMs(note.createdAt) >= from;
}

// { title, body, newCount, changedCount }. Pure: the same notes give the same
// review whatever order they arrive in.
function buildReview(notes, now, days, truncated) {
  const from = now - days * DAY_MS;
  const picked = notes.filter((n) => inWindow(n, now, days) && !String(n.title || '').startsWith(TITLE_PREFIX));
  const books = {};
  picked.forEach((n) => {
    (books[n.bookId] = books[n.bookId] || []).push(n);
  });
  const order = (a, b) => toMs(b.updatedAt) - toMs(a.updatedAt) || (a.id < b.id ? -1 : 1);
  const title = `${TITLE_PREFIX} ${day(from)} to ${day(now)}`;
  let newCount = 0;
  let changedCount = 0;
  const lines = [`# ${title}`, ''];
  const ids = Object.keys(books).sort();
  const sections = ids.map((bookId) => {
    const group = books[bookId].slice().sort(order);
    const fresh = group.filter((n) => toMs(n.createdAt) >= from);
    const changed = group.filter((n) => toMs(n.createdAt) < from);
    newCount += fresh.length;
    changedCount += changed.length;
    const out = [`## Notebook ${String(bookId).replace(/^book:/, '')}`, ''];
    const list = (heading, items) => {
      if (!items.length) return;
      out.push(`### ${heading}`, '');
      items.forEach((n) => out.push(`- [[${linkText(n.title)}]] (${day(toMs(n.updatedAt))})`));
      out.push('');
    };
    list('New', fresh);
    list('Changed', changed);
    return out;
  });
  lines.push(`${newCount} new and ${changedCount} changed notes in the last ${days} days.`, '');
  if (truncated) lines.push('This list stops early: there were more notes than one run can read.', '');
  sections.forEach((s) => s.forEach((l) => lines.push(l)));
  return { title: title, body: lines.join('\n').replace(/\n+$/, '\n'), newCount: newCount, changedCount: changedCount };
}

// Reads pages until a note falls outside the window.
function collect(now, days) {
  const notes = [];
  let cursor;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = kanso.notes.list({ limit: 100, cursor: cursor });
    let reachedOld = false;
    for (let i = 0; i < result.notes.length; i++) {
      const n = result.notes[i];
      if (inWindow(n, now, days)) notes.push(n);
      else if (toMs(n.updatedAt) < now - days * DAY_MS) reachedOld = true;
    }
    if (reachedOld || !result.cursor) return { notes: notes, truncated: false };
    cursor = result.cursor;
    truncated = true;
  }
  return { notes: notes, truncated: truncated };
}

function books() {
  const result = kanso.notes.list({ limit: 100 });
  const seen = [];
  result.notes.forEach((n) => {
    if (seen.indexOf(n.bookId) < 0) seen.push(n.bookId);
  });
  return seen;
}

function show(form, options, message) {
  const children = [
    { type: 'heading', value: 'Weekly review' },
    { type: 'select', id: 'days', label: 'Days to cover', options: DAY_OPTIONS, value: form.days },
  ];
  if (options.length) {
    children.push({
      type: 'select',
      id: 'book',
      label: 'Make the note in notebook',
      options: options,
      value: options.indexOf(form.book) >= 0 ? form.book : options[0],
    });
    children.push({ type: 'button', id: 'create', label: 'Make the review', tone: 'primary' });
  } else {
    children.push({ type: 'text', value: 'No notes to read yet.', style: 'muted' });
  }
  if (message) children.push({ type: 'text', value: message });
  kanso.ui.panel({ type: 'column', gap: 10, children });
}

function readForm(values) {
  const v = values || {};
  return { days: DAY_OPTIONS.indexOf(v.days) >= 0 ? v.days : '7', book: typeof v.book === 'string' ? v.book : '' };
}

function onCreate(values) {
  const form = readForm(values);
  const options = books();
  if (!form.book || options.indexOf(form.book) < 0) {
    show(form, options, 'Pick a notebook.');
    return null;
  }
  const now = Date.now();
  const days = Number(form.days);
  try {
    const found = collect(now, days);
    const review = buildReview(found.notes, now, days, found.truncated);
    kanso.notes.create({ bookId: form.book, title: review.title, body: review.body });
    show(form, options, `Staged "${review.title}": ${review.newCount} new, ${review.changedCount} changed.` + (found.truncated ? ' It stops early; the window holds more notes than one run can read.' : ''));
  } catch (error) {
    if (error && (error.code === 'limit' || error.code === 'timeout')) {
      show(form, options, 'Stopped to stay inside Kanso\'s limits. Wait a minute and try again.');
      return null;
    }
    if (error && error.code === 'denied') {
      show(form, options, 'This plugin may not make notes in that notebook. Choose another or change what it may do in Settings.');
      return null;
    }
    throw error;
  }
  return null;
}

kanso.commands.register({
  id: 'weekly-review',
  title: 'Make a weekly review note',
  keywords: ['review', 'week', 'summary', 'recent'],
  run: () => {
    show(readForm({}), books(), '');
    return null;
  },
});
kanso.ui.onPress('create', onCreate);
