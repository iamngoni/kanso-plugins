// Duplicate finder: notes whose titles normalise to the same text, or whose
// bodies share most of their word shingles. Read only; it lists, you decide.
//
// Budget design: titles come 100 per call; a body costs one call, so a press
// reads about forty. Each body is boiled down to a small MinHash sketch of
// its three-word shingles, so only the sketches (not the text) are kept in
// kanso.settings between presses. At most MAX_BODIES notes get a sketch;
// the panel says so when there are more. Comparing is local and cheap.

const MAX_CALLS = 50;
const MAX_MS = 1500;
const TITLE_PAGE = 100;
const BODY_PAGE = 10;
const MAX_ITEMS = 700;
const MAX_BODIES = 350;
const SKETCH = 24;
const SHINGLE = 3;
const MAX_SHOWN = 30;
const LEVELS = ['Very close (90%)', 'Close (70%)', 'Loosely (50%)'];
const THRESHOLD = { 'Very close (90%)': 0.9, 'Close (70%)': 0.7, 'Loosely (50%)': 0.5 };

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

// ---- pure similarity ---------------------------------------------------------

// Case, accents' punctuation, spacing and a trailing "copy" or "(2)" don't
// make a different title.
function normTitle(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(copy|duplicate)\b/g, ' ')
    .replace(/\s+\d{1,2}$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text) {
  return String(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// The set of word shingles, as strings.
function shingles(text) {
  const w = words(text);
  const set = {};
  if (w.length === 0) return set;
  const k = Math.min(SHINGLE, w.length);
  for (let i = 0; i + k <= w.length; i++) set[w.slice(i, i + k).join(' ')] = true;
  return set;
}

function jaccard(a, b) {
  let inter = 0;
  let sizeA = 0;
  for (const key in a) {
    sizeA += 1;
    if (b[key]) inter += 1;
  }
  let sizeB = 0;
  for (const key in b) sizeB += 1;
  const union = sizeA + sizeB - inter;
  return union === 0 ? 0 : inter / union;
}

function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// SKETCH smallest-after-mixing hashes, one per seed; null for no text.
function sketch(text) {
  const set = shingles(text);
  const hashes = [];
  for (const key in set) hashes.push(hash32(key));
  if (hashes.length === 0) return null;
  const out = [];
  for (let s = 0; s < SKETCH; s++) {
    const a = (Math.imul(s + 1, 0x9e3779b1) | 1) >>> 0;
    const b = Math.imul(s + 7, 0x85ebca6b) >>> 0;
    let min = 0xffffffff;
    for (let i = 0; i < hashes.length; i++) {
      const v = (Math.imul(hashes[i], a) + b) >>> 0;
      if (v < min) min = v;
    }
    out.push(min.toString(36));
  }
  return out;
}

// Estimated Jaccard: the share of seeds where the two minima agree.
function sketchSimilarity(a, b) {
  if (!a || !b) return 0;
  let same = 0;
  for (let i = 0; i < SKETCH; i++) if (a[i] === b[i]) same += 1;
  return same / SKETCH;
}

// Pairs of items that look alike. Each item is { id, title, sig }.
// Symmetric: the pair {a, b} is reported once whichever order they came in.
function findPairs(items, threshold) {
  const pairs = [];
  const byTitle = {};
  for (let i = 0; i < items.length; i++) {
    const t = normTitle(items[i].title);
    if (t === '') continue;
    (byTitle[t] = byTitle[t] || []).push(i);
  }
  const seen = {};
  const add = (i, j, sameTitle, similarity) => {
    const x = items[i].id < items[j].id ? i : j;
    const y = x === i ? j : i;
    const key = items[x].id + '|' + items[y].id;
    if (seen[key] === undefined) {
      seen[key] = pairs.length;
      pairs.push({ a: items[x].id, b: items[y].id, sameTitle: false, similarity: 0 });
    }
    const p = pairs[seen[key]];
    if (sameTitle) p.sameTitle = true;
    if (similarity > p.similarity) p.similarity = similarity;
  };
  for (const t in byTitle) {
    const group = byTitle[t];
    for (let x = 0; x < group.length; x++) {
      for (let y = x + 1; y < group.length; y++) {
        add(group[x], group[y], true, sketchSimilarity(items[group[x]].sig, items[group[y]].sig));
      }
    }
  }
  for (let i = 0; i < items.length; i++) {
    if (!items[i].sig) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (!items[j].sig) continue;
      const s = sketchSimilarity(items[i].sig, items[j].sig);
      if (s >= threshold) add(i, j, false, s);
    }
  }
  pairs.sort((p, q) => Number(q.sameTitle) - Number(p.sameTitle) || q.similarity - p.similarity || (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : 1));
  return pairs;
}

// ---- scanning ----------------------------------------------------------------

function freshState() {
  return { phase: 'titles', cursor: null, items: [], bodyAt: 0, sketched: 0, truncated: false };
}

function scan(state) {
  const budget = newBudget();
  try {
    if (state.phase === 'titles') {
      for (;;) {
        const page = spend(budget, () => kanso.notes.list({ limit: TITLE_PAGE, cursor: state.cursor || undefined }));
        for (let i = 0; i < page.notes.length; i++) {
          if (state.items.length >= MAX_ITEMS) {
            state.truncated = true;
            break;
          }
          state.items.push({ id: page.notes[i].id, title: page.notes[i].title || '', sig: null });
        }
        state.cursor = page.cursor || null;
        if (!page.cursor || state.truncated) break;
      }
      state.phase = 'bodies';
    }
    if (state.phase === 'bodies') {
      while (state.bodyAt < state.items.length && state.sketched < MAX_BODIES) {
        if (outOfBudget(budget, 1)) throw { code: 'budget' };
        const item = state.items[state.bodyAt];
        try {
          const note = spend(budget, () => kanso.notes.get(item.id));
          item.sig = sketch(note.body || '');
        } catch (error) {
          if (isStop(error)) throw error;
        }
        state.bodyAt += 1;
        state.sketched += 1;
      }
      state.phase = 'done';
    }
  } catch (error) {
    if (!isStop(error)) throw error;
  }
}

// ---- panel -----------------------------------------------------------------

function readForm(values) {
  const v = values || {};
  return { level: THRESHOLD[v.level] !== undefined ? v.level : LEVELS[1] };
}

function show(state, form, message) {
  const children = [
    { type: 'heading', value: 'Duplicate finder' },
    { type: 'select', id: 'level', label: 'How alike the text must be', options: LEVELS, value: form.level },
  ];
  const buttons = [{ type: 'button', id: 'scan', label: state ? 'Scan again' : 'Scan' }];
  if (state && state.phase !== 'done') buttons.push({ type: 'button', id: 'more', label: 'Keep scanning' });
  if (state) buttons.push({ type: 'button', id: 'compare', label: 'Compare again' });
  children.push({ type: 'row', gap: 8, children: buttons });
  if (message) children.push({ type: 'text', value: message });
  if (state) {
    const titles = {};
    state.items.forEach((it) => {
      titles[it.id] = it.title || 'Untitled';
    });
    const pairs = findPairs(state.items, THRESHOLD[form.level]);
    children.push({ type: 'divider' });
    if (pairs.length === 0) children.push({ type: 'text', value: 'No look-alikes yet.', style: 'muted' });
    const rows = pairs.slice(0, MAX_SHOWN).map((p) => ({
      type: 'row',
      gap: 8,
      children: [
        { type: 'text', value: `${titles[p.a]}  and  ${titles[p.b]}` },
        { type: 'badge', value: (p.sameTitle ? 'same title' : '') + (p.sameTitle && p.similarity ? ', ' : '') + (p.similarity ? Math.round(p.similarity * 100) + '% alike' : '') },
      ],
    }));
    if (rows.length) children.push({ type: 'list', items: rows });
    if (pairs.length > MAX_SHOWN) {
      children.push({ type: 'text', value: `and ${pairs.length - MAX_SHOWN} more pairs`, style: 'muted' });
    }
  }
  kanso.ui.panel({ type: 'column', gap: 10, children });
}

function describe(state) {
  let text = `Listed ${state.items.length} notes, read the text of ${state.sketched}.`;
  if (state.phase !== 'done') text += ' Stopped to stay inside Kanso\'s limits. Press Keep scanning.';
  if (state.truncated) text += ` Only the ${MAX_ITEMS} most recently changed notes are checked.`;
  else if (state.phase === 'done' && state.sketched >= MAX_BODIES && state.bodyAt < state.items.length) {
    text += ` Text was compared for the ${MAX_BODIES} most recent notes only; the rest are checked by title.`;
  }
  return text;
}

function onScan(values) {
  const state = freshState();
  scan(state);
  kanso.settings.set(state);
  show(state, readForm(values), describe(state));
  return null;
}

function onMore(values) {
  let state = loadState();
  if (!state.phase) state = freshState();
  scan(state);
  kanso.settings.set(state);
  show(state, readForm(values), describe(state));
  return null;
}

function onCompare(values) {
  const state = loadState();
  show(state.phase ? state : null, readForm(values), state.phase ? describe(state) : 'Scan first.');
  return null;
}

kanso.commands.register({
  id: 'find-duplicates',
  title: 'Find duplicate notes',
  keywords: ['duplicate', 'similar', 'copies'],
  run: () => {
    show(null, readForm({}), 'Press Scan to look for notes that repeat each other.');
    return null;
  },
});
kanso.ui.onPress('scan', onScan);
kanso.ui.onPress('more', onMore);
kanso.ui.onPress('compare', onCompare);
