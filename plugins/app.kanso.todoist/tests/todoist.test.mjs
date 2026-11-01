import test from 'node:test';
import assert from 'node:assert/strict';
import { load, forAll } from '../../../scripts/testkit.mjs';

const ID = 'app.kanso.todoist';

// A fake Todoist: creates ids, and lists whatever the test marks completed.
function fake() {
  const s = { created: [], completed: new Set(), next: 1, fail: null };
  s.handler = (req) => {
    assert.equal(req.headers.Authorization, 'Bearer tok');
    const u = new URL(req.url);
    if (s.fail) return s.fail;
    if (req.method === 'POST' && u.pathname === '/api/v1/tasks') {
      const body = JSON.parse(req.body);
      assert.ok(body.content);
      const id = `T${s.next++}`;
      s.created.push({ id, content: body.content });
      return { body: { id, content: body.content } };
    }
    if (u.pathname === '/api/v1/tasks/completed/by_completion_date') {
      assert.ok(u.searchParams.get('since') && u.searchParams.get('until'));
      return { body: { items: [...s.completed].map((id) => ({ id })), next_cursor: null } };
    }
    assert.fail(`unexpected ${req.method} ${req.url}`);
  };
  return s;
}
const setup = (body, api = fake()) => ({
  api,
  h: load(ID, {
    secrets: { token: 'tok' },
    notes: [{ id: 'open', bookId: 'b1', title: 'Plan', body }],
    noteId: 'open',
    fetch: api.handler,
  }),
});

test('pushes open tasks once and remembers their ids', () => {
  const { h, api } = setup('# Plan\n- [ ] Buy milk\n- [x] Done already\n  * [ ] Nested task\n```\n- [ ] in code\n```\ntext');
  assert.match(h.run('push').text, /sent 2 tasks/);
  assert.deepEqual(api.created.map((c) => c.content), ['Buy milk', 'Nested task']);
  assert.equal(h.note('open').data.tasks['Buy milk'].id, 'T1');
  assert.match(h.run('push').text, /already in Todoist/);
  assert.equal(api.created.length, 2);
});

test('property: pushing repeatedly never duplicates a task', () => {
  forAll(30, (r) => Array.from({ length: 1 + r.int(8) }, () => (r.string(12, 'abc d-*[]') || 'x').replace(/[\n\t]/g, ' ')), (texts) => {
    const body = texts.map((t) => `- [ ] ${t}`).join('\n');
    const { h, api } = setup(body);
    for (let i = 0; i < 4; i++) h.run('push');
    const keys = new Set(h.pure.parseTasks(body).map((t) => t.key));
    assert.equal(api.created.length, keys.size);
    assert.equal(new Set(api.created.map((c) => c.content.replace(/\s+/g, ' '))).size, api.created.length);
  });
});

test('sync ticks the boxes of tasks completed in Todoist, once', () => {
  const { h, api } = setup('- [ ] One\n- [ ] Two\n- [ ] Three');
  h.run('push');
  api.completed.add('T2');
  assert.match(h.run('sync').text, /ticked 1/);
  assert.equal(h.note('open').body, '- [ ] One\n- [x] Two\n- [ ] Three');
  assert.match(h.run('sync').text, /none of the pushed tasks are completed|ticked 0/);
  api.completed.add('T1');
  h.run('sync');
  assert.equal(h.note('open').body, '- [x] One\n- [x] Two\n- [ ] Three');
  // a task unticked by hand stays unticked: it is no longer waiting on Todoist
  h.note('open').body = '- [ ] One\n- [x] Two\n- [ ] Three';
  assert.match(h.run('sync').text, /ticked 0|none of the pushed|waiting/);
  assert.ok(h.note('open').body.startsWith('- [ ] One'));
});

test('property: sync only ever ticks boxes, never changes other text', () => {
  forAll(40, (r) => ({ lines: Array.from({ length: 1 + r.int(8) }, () => (r.string(10, 'ab c-[]*`') || 'x').replace(/\n/g, ' ')), pick: r.int(1000) }), ({ lines, pick }) => {
    const body = lines.map((t) => `- [ ] ${t}`).join('\n');
    const { h, api } = setup(body);
    h.run('push');
    api.completed = new Set(api.created.filter((_, i) => (pick >> i) & 1).map((c) => c.id));
    h.run('sync');
    const after = h.note('open').body;
    assert.equal(after.replaceAll('[x]', '[ ]'), body);
  });
});

test('401 and 429 are reported and nothing is lost', () => {
  const a = fake();
  const { h } = setup('- [ ] A', a);
  a.fail = { status: 401, body: {} };
  assert.match(h.run('push').text, /rejected the token/);
  assert.equal(h.note('open').data, null);
  a.fail = { status: 429, headers: { 'retry-after': '9' }, body: {} };
  assert.match(h.run('push').text, /slow down.*9s/);
  a.fail = null;
  assert.match(h.run('push').text, /sent 1 task\./);
});

test('a long list is sent in batches within the limits', () => {
  const body = Array.from({ length: 40 }, (_, i) => `- [ ] task ${i}`).join('\n');
  const { h, api } = setup(body);
  let runs = 0;
  while (runs++ < 10) {
    const out = h.run('push');
    assert.ok(h.state.fetches.length <= 30);
    if (!/run it again/.test(out.text)) break;
  }
  assert.equal(api.created.length, 40);
  assert.equal(runs, 3);
});

test('parseTasks skips fenced code and reads indentation and numbering', () => {
  const { h } = setup('');
  const t = h.pure.parseTasks('1. [ ] a\n   - [X] b\n~~~\n- [ ] c\n~~~\n- [ ] d');
  assert.equal(JSON.stringify(t.map((x) => [x.key, x.done])), JSON.stringify([['a', false], ['b', true], ['d', false]]));
});
