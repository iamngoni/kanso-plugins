// A stand-in for the `kanso` object a plugin sees, with notes, revisions,
// conflicts, staged writes and Kanso's limits (60 calls a minute, 500
// changed notes a command). Loads a plugin's main.js in a vm context the
// way the host would: no imports, no Node globals beyond the language.
import vm from 'node:vm';
import fs from 'node:fs';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function makeWorld({ notes = [], tags = {}, callsPerMinute = 60, maxChanged = 500 } = {}) {
  const world = {
    notes: notes.map((n, i) => ({
      id: n.id,
      rev: n.rev || `1-${n.id}`,
      title: n.title ?? '',
      body: n.body ?? '',
      bookId: n.bookId ?? 'book:a',
      tags: n.tags ?? [],
      status: n.status ?? 'active',
      createdAt: n.createdAt ?? 1000 + i,
      updatedAt: n.updatedAt ?? 1000 + i,
    })),
    tags,
    calls: 0,
    totalCalls: 0,
    staged: new Map(),
    created: [],
    settings: null,
    panelTree: null,
    commands: {},
    presses: {},
    clock: 10_000_000,
    revCounter: 1,
  };

  const spend = () => {
    world.totalCalls += 1;
    world.calls += 1;
    if (world.calls > callsPerMinute) throw fail('limit', 'too many calls this minute');
  };
  const find = (id) => world.notes.find((n) => n.id === id);
  const view = (n, withBody) => {
    const out = {
      id: n.id,
      rev: n.rev,
      title: n.title,
      bookId: n.bookId,
      tags: [...n.tags],
      tagNames: n.tags.map((t) => world.tags[t] ?? t),
      status: n.status,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    };
    if (withBody) out.body = n.body;
    return out;
  };

  const kanso = {
    commands: {
      register(spec) {
        world.commands[spec.id] = spec;
      },
    },
    notes: {
      list(opts = {}) {
        spend();
        const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
        const skip = opts.cursor ? Number(opts.cursor) : 0;
        let found = [...world.notes].sort((a, b) => b.updatedAt - a.updatedAt);
        if (opts.bookId) found = found.filter((n) => n.bookId === opts.bookId);
        if (opts.tag) {
          const want = String(opts.tag).toLowerCase();
          found = found.filter((n) =>
            n.tags.some((t) => t === opts.tag || String(world.tags[t] ?? '').toLowerCase() === want),
          );
        }
        if (opts.query) {
          const q = String(opts.query).toLowerCase();
          found = found.filter((n) => (n.title + '\n' + n.body).toLowerCase().includes(q));
        }
        const page = found.slice(skip, skip + limit);
        const more = skip + limit < found.length;
        return { notes: page.map((n) => view(n, false)), cursor: more ? String(skip + limit) : null };
      },
      get(id) {
        spend();
        const n = find(id);
        if (!n) throw fail('not_found', 'no such note');
        return view(n, true);
      },
      update(id, fields, opts = {}) {
        spend();
        const n = find(id);
        if (!n) throw fail('not_found', 'no such note');
        for (const key of Object.keys(fields)) {
          if (!['title', 'body', 'tags', 'status'].includes(key)) throw fail('invalid', `cannot change ${key}`);
        }
        if (fields.tags && !fields.tags.every((t) => typeof t === 'string' && t.startsWith('tag:'))) {
          throw fail('invalid', 'tags must be tag IDs');
        }
        if (opts.baseRev !== n.rev) throw fail('conflict', 'the note changed');
        if (!world.staged.has(id) && world.staged.size >= maxChanged) throw fail('limit', 'too many notes in one command');
        world.staged.set(id, { ...(world.staged.get(id) || {}), ...clone(fields) });
        return null;
      },
      create(note) {
        spend();
        if (typeof note.bookId !== 'string') throw fail('invalid', 'bookId');
        world.created.push(clone(note));
        return { id: `note:new${world.created.length}` };
      },
      pluginData: {
        get() {
          spend();
          return null;
        },
        set() {
          spend();
          return null;
        },
      },
    },
    ui: {
      panel(tree) {
        world.panelTree = clone(tree);
      },
      onPress(id, handler) {
        world.presses[id] = handler;
      },
    },
    settings: {
      get: () => clone(world.settings),
      set: (v) => {
        world.settings = clone(v);
      },
    },
    editor: { noteId: () => null },
    log() {},
  };

  // Applies what a command staged, as Kanso does when it ends.
  world.commit = () => {
    for (const [id, fields] of world.staged) {
      const n = find(id);
      Object.assign(n, fields);
      n.rev = `${++world.revCounter}-x`;
      n.updatedAt = ++world.clock;
    }
    world.staged.clear();
  };
  world.newMinute = () => {
    world.calls = 0;
  };
  // Someone else edits the note after the plugin read it.
  world.touch = (id, fields = {}) => {
    const n = find(id);
    Object.assign(n, fields);
    n.rev = `${++world.revCounter}-t`;
  };
  world.note = (id) => find(id);
  world.run = (id, args) => {
    world.staged.clear();
    try {
      return world.commands[id].run(args);
    } finally {
      world.commit();
    }
  };
  world.press = (id, values = {}) => {
    world.staged.clear();
    try {
      return world.presses[id](clone(values));
    } finally {
      world.commit();
    }
  };
  world.kanso = kanso;
  return world;
}

// Runs main.js with the world's kanso. Top-level function declarations come
// back on the returned context so tests can call the pure logic directly.
export function load(mainUrl, world) {
  const code = fs.readFileSync(mainUrl, 'utf8');
  const ctx = vm.createContext({ kanso: world.kanso, Date });
  vm.runInContext(code, ctx, { filename: 'main.js' });
  return ctx;
}

// Every node of a panel tree, flattened.
export function nodes(tree) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    out.push(n);
    (n.children || []).forEach(walk);
    (n.items || []).forEach(walk);
  };
  walk(tree);
  return out;
}

export const texts = (tree) => nodes(tree).filter((n) => typeof n.value === 'string').map((n) => n.value).join('\n');
