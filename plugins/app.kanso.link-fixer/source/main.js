// Link fixer: finds [[wikilinks]] whose target is not the title of any note,
// suggests the closest titles, and rewrites the ones you choose.
//
// Budget design: Kanso allows 60 calls a minute and 2 seconds of plugin time
// per press. Scanning has two phases that each page with a cursor: first the
// titles (100 per call), then the text of each note (one call per note). A
// press stops cleanly before a limit and keeps its place in kanso.settings;
// "Keep scanning" and "Keep fixing" carry on.

const MAX_CALLS = 50;
const MAX_MS = 1500;
const TITLE_PAGE = 100;
const BODY_PAGE = 10;
const MAX_TITLE_CHARS = 36000; // titles kept between presses
const MAX_BROKEN = 40;
const MAX_NOTES_PER_BROKEN = 25;
const LEAVE = 'Leave as it is';

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

// ---- wikilinks (pure) -----------------------------------------------------

function norm(text) {
  return String(text).trim().replace(/\s+/g, ' ').toLowerCase();
}

// Code spans and fenced blocks, blanked to spaces so positions stay put.
function maskCode(text) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  return text
    .replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(\n\2[^\n]*(?=\n|$)|$)/g, (m) => blank(m))
    .replace(/`[^`\n]*`/g, (m) => blank(m));
}

// Every wikilink: [[target]], [[target#heading]], [[target|alias]] or both.
// `raw` is exactly the text matched, so serialize(parse(x)) === x.
function parseLinks(text) {
  const masked = maskCode(text);
  const re = /(!?)\[\[([^\[\]\n|#]*)(#[^\[\]\n|]*)?(\|[^\[\]\n]*)?\]\]/g;
  const links = [];
  let m = re.exec(masked);
  while (m !== null) {
    links.push({
      start: m.index,
      end: m.index + m[0].length,
      embed: m[1] === '!',
      rawTarget: m[2],
      target: m[2].trim(),
      heading: m[3] || '',
      alias: m[4] || '',
    });
    m = re.exec(masked);
  }
  return links;
}

function serializeLink(link) {
  return (link.embed ? '!' : '') + '[[' + link.rawTarget + link.heading + link.alias + ']]';
}

// A target that names a file (an image or PDF) is not a note.
function looksLikeFile(link) {
  return link.embed && /\.[A-Za-z0-9]{2,5}$/.test(link.target);
}

// The links that point at no note; `known` is a set of normalised titles.
function brokenLinks(text, known) {
  return parseLinks(text).filter(
    (l) => l.target !== '' && !looksLikeFile(l) && !Object.prototype.hasOwnProperty.call(known, norm(l.target)),
  );
}

// `fixes` maps a normalised broken target to its new title. Links that
// aren't in it, and everything else in the text, stay byte for byte.
function rewriteLinks(text, fixes) {
  const links = parseLinks(text);
  let out = '';
  let at = 0;
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    const to = Object.prototype.hasOwnProperty.call(fixes, norm(l.target)) ? fixes[norm(l.target)] : null;
    out += text.slice(at, l.start);
    out += to === null ? text.slice(l.start, l.end) : serializeLink({ embed: l.embed, rawTarget: to, heading: l.heading, alias: l.alias });
    at = l.end;
  }
  return out + text.slice(at);
}

// ---- suggestions (pure) ---------------------------------------------------

function bigrams(text) {
  const s = norm(text);
  const counts = {};
  let size = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    counts[g] = (counts[g] || 0) + 1;
    size += 1;
  }
  return { counts: counts, size: size, text: s };
}

function dice(a, b) {
  if (a.size === 0 || b.size === 0) return a.text === b.text ? 1 : 0;
  let shared = 0;
  const small = a.size <= b.size ? a : b;
  const big = small === a ? b : a;
  for (const g in small.counts) {
    if (big.counts[g]) shared += Math.min(small.counts[g], big.counts[g]);
  }
  return (2 * shared) / (a.size + b.size);
}

function editDistance(a, b) {
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev.push(j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Up to `max` titles, best first. Bigram overlap picks candidates and edit
// distance orders them. Pure.
function suggest(target, titles, max) {
  const t = bigrams(target);
  const scored = [];
  for (let i = 0; i < titles.length; i++) {
    const b = bigrams(titles[i]);
    const d = dice(t, b);
    const contained = b.text.length >= 3 && (b.text.indexOf(t.text) >= 0 || t.text.indexOf(b.text) >= 0);
    if (d >= 0.4 || contained) scored.push({ title: titles[i], d: d, b: b });
  }
  scored.sort((x, y) => y.d - x.d);
  const top = scored.slice(0, 12).map((s) => {
    const longest = Math.max(t.text.length, s.b.text.length, 1);
    return { title: s.title, score: 1 - editDistance(t.text, s.b.text) / longest + s.d };
  });
  top.sort((x, y) => y.score - x.score || (x.title < y.title ? -1 : 1));
  return top.slice(0, max || 3).map((s) => s.title);
}

// ---- scanning ----------------------------------------------------------------

function freshState() {
  return {
    phase: 'titles',
    cursor: null,
    titles: [],
    titleChars: 0,
    titlesTruncated: false,
    scanned: 0,
    broken: [],
    brokenTruncated: false,
    queue: [],
    fixed: 0,
    skipped: 0,
  };
}

function knownSet(state) {
  const known = {};
  for (let i = 0; i < state.titles.length; i++) known[norm(state.titles[i])] = true;
  return known;
}

function scan(state) {
  const budget = newBudget();
  try {
    if (state.phase === 'titles') {
      for (;;) {
        const page = spend(budget, () => kanso.notes.list({ limit: TITLE_PAGE, cursor: state.cursor || undefined }));
        for (let i = 0; i < page.notes.length; i++) {
          const title = (page.notes[i].title || '').trim();
          if (title === '') continue;
          if (state.titleChars + title.length > MAX_TITLE_CHARS) {
            state.titlesTruncated = true;
            continue;
          }
          state.titles.push(title);
          state.titleChars += title.length;
        }
        state.cursor = page.cursor || null;
        if (!page.cursor) break;
      }
      state.phase = 'bodies';
      state.cursor = null;
    }
    if (state.phase === 'bodies') {
      const known = knownSet(state);
      for (;;) {
        if (outOfBudget(budget, BODY_PAGE + 1)) throw { code: 'budget' };
        const page = spend(budget, () => kanso.notes.list({ limit: BODY_PAGE, cursor: state.cursor || undefined }));
        for (let i = 0; i < page.notes.length; i++) {
          let note;
          try {
            note = spend(budget, () => kanso.notes.get(page.notes[i].id));
          } catch (error) {
            if (isStop(error)) throw error;
            continue;
          }
          state.scanned += 1;
          noteBroken(state, note, known);
        }
        state.cursor = page.cursor || null;
        if (!page.cursor) {
          state.phase = 'done';
          return;
        }
      }
    }
  } catch (error) {
    if (!isStop(error)) throw error;
  }
}

function noteBroken(state, note, known) {
  const links = brokenLinks(note.body || '', known);
  for (let i = 0; i < links.length; i++) {
    const key = norm(links[i].target);
    let entry = null;
    for (let j = 0; j < state.broken.length; j++) if (state.broken[j].key === key) entry = state.broken[j];
    if (entry === null) {
      if (state.broken.length >= MAX_BROKEN) {
        state.brokenTruncated = true;
        continue;
      }
      entry = { key: key, label: links[i].target, notes: [], count: 0 };
      state.broken.push(entry);
    }
    entry.count += 1;
    if (entry.notes.indexOf(note.id) < 0) {
      if (entry.notes.length < MAX_NOTES_PER_BROKEN) entry.notes.push(note.id);
      else entry.more = true; // more notes than are kept: scan again after fixing
    }
  }
}

// ---- fixing ----------------------------------------------------------------

// Turns the chosen replacements into one job per note.
function planFixes(state, choices) {
  const jobs = {};
  const order = [];
  const fixedKeys = {};
  for (let i = 0; i < state.broken.length; i++) {
    const entry = state.broken[i];
    const to = choices[i];
    if (!to || to === LEAVE) continue;
    fixedKeys[entry.key] = true;
    for (let j = 0; j < entry.notes.length; j++) {
      const id = entry.notes[j];
      if (!jobs[id]) {
        jobs[id] = {};
        order.push(id);
      }
      jobs[id][entry.key] = to;
    }
  }
  state.broken = state.broken.filter((e) => !fixedKeys[e.key]);
  return order.map((id) => ({ id: id, fixes: jobs[id] }));
}

function fix(state) {
  const budget = newBudget();
  try {
    while (state.queue.length) {
      if (outOfBudget(budget, 2)) throw { code: 'budget' };
      const job = state.queue[0];
      try {
        const note = spend(budget, () => kanso.notes.get(job.id));
        const text = rewriteLinks(note.body || '', job.fixes);
        if (text === note.body) {
          state.skipped += 1;
        } else {
          spend(budget, () => kanso.notes.update(note.id, { body: text }, { baseRev: note.rev }));
          state.fixed += 1;
        }
      } catch (error) {
        if (isStop(error)) throw error;
        state.skipped += 1;
      }
      state.queue.shift();
    }
  } catch (error) {
    if (!isStop(error)) throw error;
  }
}

// ---- panel -----------------------------------------------------------------

function describe(state) {
  let text = `Read ${state.scanned} notes against ${state.titles.length} titles.`;
  if (state.phase !== 'done') text += ' Stopped to stay inside Kanso\'s limits. Press Keep scanning.';
  text += state.broken.length ? ` ${state.broken.length} missing targets so far.` : ' No missing targets so far.';
  if (state.titlesTruncated) text += ' Your library has more titles than I can hold, so some links may show as missing wrongly.';
  if (state.broken.some((e) => e.more)) text += ' Marked + means more notes use that link than I keep track of; scan again after fixing.';
  if (state.brokenTruncated) text += ` Showing the first ${MAX_BROKEN} missing targets; fix them and scan again for more.`;
  if (state.fixed || state.skipped) text += ` Fixed ${state.fixed} notes` + (state.skipped ? `, ${state.skipped} skipped` : '') + '.';
  if (state.queue.length) text += ` ${state.queue.length} notes left to fix. Press Keep fixing.`;
  return text;
}

function show(state, message, chosen) {
  const children = [{ type: 'heading', value: 'Link fixer' }];
  const buttons = [{ type: 'button', id: 'scan', label: state && state.scanned ? 'Scan again' : 'Scan' }];
  if (state && state.phase !== 'done' && state.scanned + state.titles.length > 0) {
    buttons.push({ type: 'button', id: 'more', label: 'Keep scanning' });
  }
  if (state && state.broken.length) buttons.push({ type: 'button', id: 'fix', label: 'Fix chosen', tone: 'primary' });
  if (state && state.queue.length) buttons.push({ type: 'button', id: 'resume', label: 'Keep fixing' });
  children.push({ type: 'row', gap: 8, children: buttons });
  if (message) children.push({ type: 'text', value: message });
  if (state && state.broken.length) {
    children.push({ type: 'divider' });
    const titles = state.titles;
    for (let i = 0; i < state.broken.length; i++) {
      const entry = state.broken[i];
      const options = [LEAVE].concat(suggest(entry.label, titles, 3).filter((t) => t !== LEAVE));
      const pick = chosen && options.indexOf(chosen[i]) >= 0 ? chosen[i] : LEAVE;
      children.push({
        type: 'select',
        id: 'fix-' + i,
        label: `[[${entry.label}]] in ${entry.notes.length}${entry.more ? '+' : ''} note${entry.notes.length === 1 && !entry.more ? '' : 's'}`,
        options: options,
        value: pick,
      });
    }
  }
  kanso.ui.panel({ type: 'column', gap: 10, children: children });
}

function chosenFrom(values, state) {
  const out = [];
  for (let i = 0; i < state.broken.length; i++) out.push(values ? values['fix-' + i] : undefined);
  return out;
}

function onScan() {
  const state = freshState();
  scan(state);
  kanso.settings.set(state);
  show(state, describe(state), null);
  return null;
}

function onMore(values) {
  let state = loadState();
  if (!state.phase) state = freshState();
  const chosen = chosenFrom(values, state);
  scan(state);
  kanso.settings.set(state);
  show(state, describe(state), chosen);
  return null;
}

function onFix(values) {
  const state = loadState();
  if (!state.phase) {
    show(null, 'Scan first.', null);
    return null;
  }
  const jobs = planFixes(state, chosenFrom(values, state));
  if (!jobs.length && !state.queue.length) {
    show(state, 'Nothing chosen. Pick a title for the links you want fixed.', null);
    return null;
  }
  state.queue = state.queue.concat(jobs);
  fix(state);
  kanso.settings.set(state);
  show(state, describe(state), null);
  return null;
}

function onResume() {
  const state = loadState();
  if (!state.phase) return null;
  fix(state);
  kanso.settings.set(state);
  show(state, describe(state), null);
  return null;
}

kanso.commands.register({
  id: 'link-fixer',
  title: 'Fix broken wikilinks',
  keywords: ['wikilink', 'links', 'broken', 'missing'],
  run: () => {
    show(null, 'Press Scan to look for [[links]] that point at no note.', null);
    return null;
  },
});
kanso.ui.onPress('scan', onScan);
kanso.ui.onPress('more', onMore);
kanso.ui.onPress('fix', onFix);
kanso.ui.onPress('resume', onResume);
