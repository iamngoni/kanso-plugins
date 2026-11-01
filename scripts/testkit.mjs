// Test kit for plugin tests: loads a plugin's main.js under Node with a stub
// `kanso` that follows the host's rules (staged writes applied when a command
// ends, rev checks, manifest allow-lists, call budgets). No real network.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

export function rng(seed = 0xc0ffee) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (list) => list[Math.floor(next() * list.length)],
    string(len = 20, alphabet) {
      const abc =
        alphabet ||
        'abcXYZ 019\n\t\\`*_[]()<>#~|&!-+.:/"\'{}$%^=é漢😀-->';
      let s = '';
      const n = Math.floor(next() * (len + 1));
      for (let i = 0; i < n; i++) s += [...abc][Math.floor(next() * [...abc].length)];
      return s;
    },
  };
}

// Runs fn(sample, index) over n generated samples with a pinned seed.
export function forAll(n, gen, fn, seed = 20240601) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) fn(gen(r), i);
}

class Failure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function load(pluginId, opts = {}) {
  const dir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'plugins',
    pluginId,
    'source',
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const code = fs.readFileSync(path.join(dir, manifest.entry), 'utf8');
  const perms = manifest.permissions;
  const hosts = perms.network || [];
  const secretNames = perms.secrets || [];
  const FIXED = opts.now ?? Date.parse('2026-11-01T10:00:00Z');
  const state = {
    settings: structuredClone(opts.settings ?? {}),
    notes: (opts.notes ?? []).map((n, i) => ({
      id: n.id ?? `n${i}`,
      bookId: n.bookId ?? 'b1',
      title: n.title ?? '',
      body: n.body ?? '',
      rev: n.rev ?? 'r1',
      data: n.data ?? null,
      updatedAt: n.updatedAt ?? 1,
    })),
    noteId: opts.noteId ?? null,
    selection: null,
    panel: null,
    fetches: [],
    kansoCalls: 0,
    logs: [],
    serial: 100,
  };
  const commands = {};
  const presses = {};
  let staged = null;

  const need = (ok, what) => {
    if (!ok) throw new Failure('denied', `not allowed ${what}`);
  };
  const count = () => {
    state.kansoCalls += 1;
    if (state.kansoCalls > 60) throw new Failure('limit', 'more than 60 calls to Kanso');
  };
  const find = (id) => {
    const n = state.notes.find((x) => x.id === id);
    if (!n) throw new Failure('not_found', 'no such note');
    return n;
  };
  const summary = (n) => ({
    id: n.id, rev: n.rev, title: n.title, bookId: n.bookId, tags: [], tagNames: [],
    status: 'active', createdAt: 1, updatedAt: n.updatedAt,
  });
  const full = (n) => ({ ...summary(n), body: n.body });
  const readable = () => (perms.notes && perms.notes.read) || (perms.editor || []).includes('note.read');
  const stage = () => (staged ??= { creates: [], edits: [], selection: null });
  const stagedEdit = (id) => {
    const s = stage();
    let e = s.edits.find((x) => x.id === id);
    if (!e) s.edits.push((e = { id }));
    return e;
  };

  const kanso = {
    commands: { register: (spec) => (commands[spec.id] = spec) },
    ui: {
      panel: (tree) => {
        state.panel = JSON.parse(JSON.stringify(tree));
      },
      onPress: (id, fn) => (presses[id] = fn),
    },
    settings: {
      get: () => structuredClone(state.settings),
      set: (v) => {
        const text = JSON.stringify(v);
        if (text.length > 65536) throw new Failure('limit', 'settings too large');
        state.settings = JSON.parse(text);
      },
    },
    secrets: {
      get(name) {
        need(secretNames.includes(name), `to read secret ${name}`);
        return opts.secrets && name in opts.secrets ? opts.secrets[name] : null;
      },
    },
    log: (level, text) => state.logs.push([level, String(text)]),
    fetch(url, o = {}) {
      count();
      const u = new URL(url);
      need(u.protocol === 'https:', 'for plain http');
      need(hosts.includes(u.hostname), `to reach ${u.hostname}`);
      const req = { url, method: o.method || 'GET', headers: o.headers || {}, body: o.body };
      state.fetches.push(req);
      if (state.fetches.length > 30) throw new Failure('limit', 'more than 30 requests');
      const answer = opts.fetch(req, state);
      const body = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body ?? null);
      return { status: answer.status ?? 200, headers: answer.headers ?? {}, body };
    },
    editor: {
      noteId() {
        need((perms.editor || []).includes('note.read'), 'to see the open note');
        return state.noteId;
      },
      selection() {
        need((perms.editor || []).includes('selection.read'), 'to read the selection');
        return state.selection ? { ...state.selection } : null;
      },
      replaceSelection(change) {
        need((perms.editor || []).includes('selection.replace'), 'to replace the selection');
        const sel = state.selection;
        if (!sel) throw new Failure('invalid', 'nothing selected');
        if (change.selection && (change.selection.start !== sel.start || change.selection.end !== sel.end)) {
          throw new Failure('conflict', 'the selection changed');
        }
        stage().selection = { text: change.text, start: sel.start, end: sel.end };
        return null;
      },
    },
    notes: {
      list(o = {}) {
        count();
        need(readable(), 'to read notes');
        let list = state.notes.filter((n) => !o.bookId || n.bookId === o.bookId);
        if (o.query) {
          const q = o.query.toLowerCase();
          list = list.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
        }
        list = list.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.min(o.limit ?? 50, 100));
        return { notes: list.map(summary), cursor: null };
      },
      get(id) {
        count();
        need(readable(), 'to read notes');
        return full(find(id));
      },
      create(note) {
        count();
        need(perms.notes && perms.notes.create, 'to make notes');
        if (!note.bookId) throw new Failure('invalid', 'bookId is required');
        stage().creates.push({ bookId: note.bookId, title: note.title ?? '', body: note.body ?? '' });
        return { staged: true };
      },
      update(id, fields, o = {}) {
        count();
        need(perms.notes && perms.notes.write, 'to change notes');
        const n = find(id);
        if (o.baseRev === undefined) throw new Failure('invalid', 'baseRev is required');
        if (o.baseRev !== n.rev) throw new Failure('conflict', 'the note changed since it was read');
        Object.assign(stagedEdit(id), fields);
        return { id, staged: true };
      },
      pluginData: {
        get(id) {
          count();
          return find(id).data ?? null;
        },
        set(id, value) {
          count();
          need(perms.notes && perms.notes.write, 'to change notes');
          find(id);
          if (JSON.stringify(value).length > 32768) throw new Failure('limit', '32 KB a note');
          stagedEdit(id).data = value;
          return { id, staged: true };
        },
      },
    },
  };

  const FakeDate = class extends Date {
    constructor(...a) {
      if (a.length === 0) super(FIXED + (opts.tick ? state.serial++ : 0));
      else super(...a);
    }
    static now() {
      return FIXED;
    }
  };
  const sandbox = { kanso, __kansoTest: {}, Date: FakeDate };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'main.js' });

  function apply() {
    const s = staged;
    staged = null;
    if (!s) return;
    for (const e of s.edits) {
      const n = find(e.id);
      if ('title' in e) n.title = e.title;
      if ('body' in e) n.body = e.body;
      if ('data' in e) n.data = e.data;
      n.rev = `r${++state.serial}`;
      n.updatedAt = state.serial;
    }
    for (const c of s.creates) {
      state.notes.push({
        id: `new${++state.serial}`, bookId: c.bookId, title: c.title, body: c.body,
        rev: 'r1', data: null, updatedAt: ++state.serial,
      });
    }
    if (s.selection && state.noteId) {
      const n = find(state.noteId);
      const buf = Buffer.from(n.body, 'utf8');
      n.body = Buffer.concat([
        buf.subarray(0, s.selection.start),
        Buffer.from(s.selection.text, 'utf8'),
        buf.subarray(s.selection.end),
      ]).toString('utf8');
      n.rev = `r${++state.serial}`;
      state.selection = null;
    }
  }

  const host = {
    state,
    manifest,
    commands,
    presses,
    pure: sandbox.__kansoTest.exports,
    note: (id) => find(id),
    notesIn: (bookId) => state.notes.filter((n) => n.bookId === bookId),
    select(text, from = 0) {
      const n = find(state.noteId);
      const at = n.body.indexOf(text, from);
      if (at < 0) throw new Error('text not in note');
      const start = Buffer.byteLength(n.body.slice(0, at));
      state.selection = { text, start, end: start + Buffer.byteLength(text) };
    },
    reset() {
      state.kansoCalls = 0;
      state.fetches = [];
    },
    run(id, args = {}) {
      host.reset();
      let out;
      try {
        out = commands[id].run(args);
      } catch (e) {
        staged = null;
        throw e;
      }
      apply();
      return out;
    },
    press(id, values = {}) {
      host.reset();
      let out;
      try {
        out = presses[id](values);
      } catch (e) {
        staged = null;
        throw e;
      }
      apply();
      return out;
    },
  };
  return host;
}

// Every `value` string in a panel tree, for assertions.
export function panelText(tree) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.value === 'string') out.push(n.value);
    if (typeof n.label === 'string') out.push(n.label);
    (n.children || []).forEach(walk);
    (n.items || []).forEach(walk);
  };
  walk(tree);
  return out.join('\n');
}
