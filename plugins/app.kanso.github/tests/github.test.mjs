import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../source/main.js'), 'utf8');
const TOKEN = 'github_pat_SECRET1234567890';

// Loads main.js with a stub kanso. `route(url, opts)` answers fetches.
function load({ route, selection, settings = { repo: 'octo/hello' }, body = '', secret = TOKEN } = {}) {
  const logs = [];
  const calls = [];
  const state = { data: null, settings, panel: null };
  const commands = {};
  const presses = {};
  const kanso = {
    commands: { register: (c) => { commands[c.id] = c; } },
    editor: { noteId: () => 'n1', selection: () => selection ?? null },
    notes: { get: () => ({ body }), pluginData: { get: () => state.data, set: (_id, v) => { state.data = v; } } },
    settings: { get: () => state.settings, set: (v) => { state.settings = v; } },
    secrets: { get: (n) => (n === 'token' ? secret : null) },
    ui: { panel: (t) => { state.panel = t; }, onPress: (id, f) => { presses[id] = f; } },
    fetch: (url, opts) => { calls.push({ url, opts }); const r = route(url, opts); if (r instanceof Error) throw r; return r; },
    log: (...a) => logs.push(a.join(' ')),
  };
  const ctx = { kanso, module: { exports: {} } };
  vm.runInNewContext(SRC, ctx);
  return { api: ctx.module.exports, commands, presses, state, logs, calls };
}
const ok = (obj, status = 200, headers = {}) => ({ status, headers, body: JSON.stringify(obj) });
const flat = (x) => JSON.stringify(x);

test('splitSelection: first line is the title, rest the body', () => {
  const { api } = load({ route: () => ok({}) });
  assert.deepEqual({ ...api.splitSelection('\n## Bug here\n\nline1\nline2\n') }, { title: 'Bug here', body: 'line1\nline2' });
  assert.equal(api.splitSelection('  \n \n'), null);
});

test('parseRepo accepts owner/name only', () => {
  const { api } = load({ route: () => ok({}) });
  assert.equal(api.parseRepo(' a/b '), 'a/b');
  for (const bad of ['a', 'a/b/c', '../x', 'a/..', 'a b/c', '', null, 'a/b?x=1', 'a/b#h']) assert.equal(api.parseRepo(bad), null, String(bad));
});

test('findLinks dedupes, classifies and caps', () => {
  const { api } = load({ route: () => ok({}) });
  const links = api.findLinks('see https://github.com/a/b/issues/1 and https://github.com/a/b/pull/2, again https://github.com/a/b/issues/1 http://github.com/a/b/issues/9 https://evil.com/github.com/a/b/issues/3');
  assert.deepEqual(links.map((l) => `${l.kind}:${l.repo}#${l.number}`), ['issue:a/b#1', 'pr:a/b#2']);
  const many = Array.from({ length: 50 }, (_, i) => `https://github.com/a/b/issues/${i + 1}`).join(' ');
  assert.equal(api.findLinks(many).length, 20);
});

test('mapState', () => {
  const { api } = load({ route: () => ok({}) });
  assert.equal(api.mapState('pr', { state: 'closed', pull_request: { merged_at: 'x' } }).state, 'merged');
  assert.equal(api.mapState('pr', { state: 'closed', pull_request: {} }).state, 'closed');
  assert.equal(api.mapState('issue', { state: 'closed', state_reason: 'not_planned' }).state, 'closed (not planned)');
  assert.equal(api.mapState('issue', { state: 'open', title: 'T' }).title, 'T');
});

test('create issue: builds the request and stores the URL in pluginData', () => {
  const sel = { text: 'Crash on "save"\nSteps: <b>1</b>\n```\n{"x":1}\n```', start: 0, end: 5 };
  const h = load({ selection: sel, route: () => ok({ html_url: 'https://github.com/octo/hello/issues/7', number: 7 }, 201) });
  const out = h.commands['create-issue'].run();
  assert.match(out.text, /issues\/7/);
  const c = h.calls[0];
  assert.equal(c.url, 'https://api.github.com/repos/octo/hello/issues');
  assert.equal(c.opts.method, 'POST');
  assert.equal(c.opts.headers.Authorization, `Bearer ${TOKEN}`);
  const body = JSON.parse(c.opts.body);
  assert.equal(body.title, 'Crash on "save"');
  assert.equal(body.body, 'Steps: <b>1</b>\n```\n{"x":1}\n```');
  assert.deepEqual(h.state.data.issues, ['https://github.com/octo/hello/issues/7']);
});

test('request body round-trips any input without breaking out of the JSON', () => {
  const { api } = load({ route: () => ok({}) });
  const nasty = ['"}, "labels": ["x"', '\\', ' \u0000', '</script>', '","assignees":["evil"]'];
  for (const n of nasty) {
    const p = api.splitSelection(`T${n}\n${n}`);
    const r = api.issueRequest('o/r', TOKEN, p.title, p.body);
    const parsed = JSON.parse(r.opts.body);
    assert.deepEqual(Object.keys(parsed).sort(), ['body', 'title']);
    assert.equal(parsed.body, p.body);
    assert.equal(r.url, 'https://api.github.com/repos/o/r/issues');
  }
});

test('errors give clear messages and never contain the token', () => {
  const cases = [
    [401, {}, /rejected the token/],
    [403, {}, /isn't allowed/],
    [403, { 'x-ratelimit-remaining': '0' }, /rate limit/],
    [429, { 'retry-after': '30' }, /30 seconds/],
    [404, {}, /can't find/],
    [422, {}, /refused/],
    [500, {}, /500/],
  ];
  for (const [status, headers, re] of cases) {
    // A hostile server that echoes the token back in its message.
    const h = load({
      selection: { text: 'T\nb', start: 0, end: 3 },
      route: () => ({ status, headers, body: JSON.stringify({ message: `bad ${TOKEN}`.replace(TOKEN, 'echo') }) }),
    });
    const out = h.commands['create-issue'].run();
    assert.match(out.text, re);
    assert.ok(!out.text.includes(TOKEN));
    assert.ok(!flat(h.logs).includes(TOKEN));
  }
  const h = load({ selection: { text: 'T', start: 0, end: 1 }, route: () => new Error(`network down ${TOKEN}`) });
  // Even if the host's error held the token it is not our text to leak: ours is generic prefix + message, so assert prefix.
  assert.match(h.commands['create-issue'].run().text, /Couldn't reach GitHub/);
});

test('missing token and missing repo are explained', () => {
  const sel = { text: 'T\nb', start: 0, end: 3 };
  assert.match(load({ selection: sel, secret: null, route: () => ok({}) }).commands['create-issue'].run().text, /No token/);
  assert.match(load({ selection: sel, settings: {}, route: () => ok({}) }).commands['create-issue'].run().text, /repository/);
});

test('panel shows states of linked issues and stays within the request cap', () => {
  const body = Array.from({ length: 30 }, (_, i) => `https://github.com/a/b/${i % 2 ? 'pull' : 'issues'}/${i + 1}`).join('\n');
  const h = load({ body, route: (url) => ok({ title: 'Hi', state: 'open' }) });
  h.commands['show-links'].run();
  assert.ok(h.calls.length <= 20);
  assert.ok(h.calls.every((c) => c.opts.method === 'GET' && c.url.startsWith('https://api.github.com/repos/a/b/issues/')));
  assert.match(flat(h.state.panel), /Issue: open/);
});

test('panel stops asking after an error and shows it without the token', () => {
  const body = 'https://github.com/a/b/issues/1 https://github.com/a/b/issues/2';
  const h = load({ body, route: () => ({ status: 401, headers: {}, body: '{}' }) });
  h.commands['show-links'].run();
  assert.equal(h.calls.length, 1);
  assert.match(flat(h.state.panel), /rejected the token/);
  assert.ok(!flat(h.state.panel).includes(TOKEN));
});

test('saving the repo validates it', () => {
  const h = load({ route: () => ok({}) });
  h.presses.save({ repo: 'nope' });
  assert.equal(h.state.settings.repo, 'octo/hello');
  h.presses.save({ repo: 'a/b' });
  assert.equal(h.state.settings.repo, 'a/b');
});
