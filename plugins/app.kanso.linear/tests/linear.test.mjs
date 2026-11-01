import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../source/main.js'), 'utf8');
const TOKEN = 'lin_api_SECRET1234567890';

function load({ route, selection, settings = { teamKey: 'ENG' }, body = '', secret = TOKEN } = {}) {
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
    fetch: (url, opts) => { calls.push({ url, opts, json: JSON.parse(opts.body) }); const r = route(url, opts, JSON.parse(opts.body)); if (r instanceof Error) throw r; return r; },
    log: (...a) => logs.push(a.join(' ')),
  };
  const ctx = { kanso, module: { exports: {} } };
  vm.runInNewContext(SRC, ctx);
  return { api: ctx.module.exports, commands, presses, state, logs, calls };
}
const ok = (data, status = 200) => ({ status, headers: {}, body: JSON.stringify({ data }) });
const flat = (x) => JSON.stringify(x);
const TEAMS = { teams: { nodes: [{ id: 'team-uuid', key: 'ENG', name: 'Engineering' }, { id: 't2', key: 'OPS', name: 'Ops' }] } };

test('splitSelection and parseTeamKey', () => {
  const { api } = load({ route: () => ok({}) });
  assert.deepEqual({ ...api.splitSelection('# Title\n\nbody') }, { title: 'Title', body: 'body' });
  assert.equal(api.splitSelection(' \n'), null);
  assert.equal(api.parseTeamKey(' eng '), 'ENG');
  for (const bad of ['', 'E NG', 'ENG"', 'a-b', null, 'x'.repeat(17)]) assert.equal(api.parseTeamKey(bad), null);
});

test('findLinks dedupes, normalises and caps', () => {
  const { api } = load({ route: () => ok({}) });
  const l = api.findLinks('https://linear.app/acme/issue/eng-12/some-slug and https://linear.app/acme/issue/ENG-12 https://linear.app/acme/issue/OPS-3 https://example.com/linear.app/x/issue/A-1');
  assert.deepEqual(l.map((x) => x.identifier), ['ENG-12', 'OPS-3']);
  const many = Array.from({ length: 40 }, (_, i) => `https://linear.app/a/issue/ENG-${i + 1}`).join(' ');
  assert.equal(api.findLinks(many).length, 20);
});

test('create issue: team lookup, GraphQL variables, pluginData', () => {
  const sel = { text: 'Fix "login" } { bug\nbody with ${x} and \\ and `ticks`', start: 0, end: 3 };
  const h = load({
    selection: sel,
    route: (url, o, j) => (j.query.includes('teams') ? ok(TEAMS) : ok({ issueCreate: { success: true, issue: { id: 'i', identifier: 'ENG-5', url: 'https://linear.app/acme/issue/ENG-5/x' } } })),
  });
  const out = h.commands['create-issue'].run();
  assert.match(out.text, /ENG-5/);
  assert.equal(h.calls[0].url, 'https://api.linear.app/graphql');
  assert.equal(h.calls[0].opts.headers.Authorization, TOKEN);
  const c = h.calls[1].json;
  assert.equal(c.variables.input.teamId, 'team-uuid');
  assert.equal(c.variables.input.title, 'Fix "login" } { bug');
  assert.equal(c.variables.input.description, 'body with ${x} and \\ and `ticks`');
  assert.ok(!c.query.includes('login'), 'user text never enters the query string');
  assert.deepEqual(h.state.data.issues, ['https://linear.app/acme/issue/ENG-5/x']);
});

test('statesRequest keeps identifiers out of the query text', () => {
  const { api } = load({ route: () => ok({}) });
  const r = api.statesRequest(TOKEN, ['ENG-1', 'OPS-2']);
  const j = JSON.parse(r.opts.body);
  assert.ok(!j.query.includes('ENG-1'));
  assert.deepEqual({ ...j.variables }, { i0: 'ENG-1', i1: 'OPS-2' });
  const m = api.mapStates(['ENG-1', 'OPS-2'], { a0: { title: 'T', url: 'https://linear.app/a/issue/ENG-1', state: { name: 'In Progress', type: 'started' } }, a1: null });
  assert.equal(m[0].state, 'In Progress');
  assert.equal(m[1].found, false);
});

test('unknown team is explained', () => {
  const h = load({ selection: { text: 'T', start: 0, end: 1 }, settings: { teamKey: 'ZZZ' }, route: () => ok(TEAMS) });
  assert.match(h.commands['create-issue'].run().text, /no team with the key ZZZ/);
});

test('errors are clear and never contain the token', () => {
  const cases = [
    [401, '{}', /rejected the API key/],
    [403, '{}', /isn't allowed/],
    [429, '{}', /rate limit/],
    [400, JSON.stringify({ errors: [{ message: 'slow', extensions: { code: 'RATELIMITED' } }] }), /rate limit/],
    [200, JSON.stringify({ errors: [{ message: 'nope', extensions: { code: 'AUTHENTICATION_ERROR' } }] }), /rejected the API key/],
    [500, 'oops', /500/],
  ];
  for (const [status, body, re] of cases) {
    const h = load({ selection: { text: 'T\nb', start: 0, end: 3 }, route: () => ({ status, headers: {}, body }) });
    const out = h.commands['create-issue'].run();
    assert.match(out.text, re);
    assert.ok(!out.text.includes(TOKEN));
    assert.ok(!flat(h.logs).includes(TOKEN));
  }
  const h = load({ selection: { text: 'T', start: 0, end: 1 }, route: () => new Error('offline') });
  assert.match(h.commands['create-issue'].run().text, /Couldn't reach Linear/);
});

test('missing token / team', () => {
  const sel = { text: 'T\nb', start: 0, end: 3 };
  assert.match(load({ selection: sel, secret: null, route: () => ok({}) }).commands['create-issue'].run().text, /No API key/);
  assert.match(load({ selection: sel, settings: {}, route: () => ok({}) }).commands['create-issue'].run().text, /team key/);
});

test('panel: one request for all linked issues', () => {
  const body = 'https://linear.app/a/issue/ENG-1 https://linear.app/a/issue/ENG-2';
  const h = load({ body, route: () => ok({ a0: { title: 'One', url: 'https://linear.app/a/issue/ENG-1', state: { name: 'Done' } }, a1: null }) });
  h.commands['show-links'].run();
  assert.equal(h.calls.length, 1);
  assert.match(flat(h.state.panel), /Done/);
  assert.match(flat(h.state.panel), /not found/);
});

test('panel: auth failure shows a message without the token', () => {
  const h = load({ body: 'https://linear.app/a/issue/ENG-1', route: () => ({ status: 401, headers: {}, body: '{}' }) });
  h.commands['show-links'].run();
  assert.match(flat(h.state.panel), /rejected the API key/);
  assert.ok(!flat(h.state.panel).includes(TOKEN));
});

test('saving the team validates it, accepting "KEY - Name" from the select', () => {
  const h = load({ route: () => ok({}) });
  h.presses.save({ team: 'bad key!' });
  assert.equal(h.state.settings.teamKey, 'ENG');
  h.presses.save({ team: 'OPS - Ops' });
  assert.equal(h.state.settings.teamKey, 'OPS');
});
