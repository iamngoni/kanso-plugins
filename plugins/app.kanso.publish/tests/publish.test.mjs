import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../source/main.js'), 'utf8');
const SECRET = 'SECRETTOKEN_abc123';

function load({ route, settings = {}, note = { title: 'Hello', body: '# Hello\n\nWorld **bold**' }, data = null } = {}) {
  const logs = [];
  const calls = [];
  const state = { data, settings, panel: null };
  const commands = {};
  const presses = {};
  const kanso = {
    commands: { register: (c) => { commands[c.id] = c; } },
    editor: { noteId: () => 'n1' },
    notes: { get: () => note, pluginData: { get: () => state.data, set: (_i, v) => { state.data = v; } } },
    settings: { get: () => state.settings, set: (v) => { state.settings = v; } },
    secrets: { get: () => SECRET },
    ui: { panel: (t) => { state.panel = t; }, onPress: (id, f) => { presses[id] = f; } },
    fetch: (url, opts) => { calls.push({ url, opts }); const r = route(url, opts); if (r instanceof Error) throw r; return r; },
    log: (...a) => logs.push(a.join(' ')),
  };
  const ctx = { kanso, module: { exports: {} } };
  vm.runInNewContext(SRC, ctx);
  return { api: ctx.module.exports, commands, presses, state, logs, calls };
}
const res = (obj, status = 200, headers = {}) => ({ status, headers, body: JSON.stringify(obj) });
const flat = (x) => JSON.stringify(x);
const run = (h) => h.commands['publish-note'].run().text;

test('markdownToHtml: basic constructs', () => {
  const { api } = load({ route: () => res({}) });
  const html = api.markdownToHtml('# T\n\nA *b* **c** `d<e>` [x](https://a.b/?q=1&r=2)\n\n- one\n- two\n\n```\n<script>1</script>\n```\n\n> quote');
  assert.match(html, /<h1>T<\/h1>/);
  assert.match(html, /<strong>c<\/strong>/);
  assert.match(html, /<code>d&lt;e&gt;<\/code>/);
  assert.match(html, /href="https:\/\/a.b\/\?q=1&amp;r=2"/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<pre><code>&lt;script&gt;1&lt;\/script&gt;/);
  assert.match(html, /<blockquote><p>quote<\/p><\/blockquote>/);
});

test('markdownToHtml escapes hostile input: no raw tags, handlers or script URLs survive', () => {
  const { api } = load({ route: () => res({}) });
  const nasty = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    '[x](data:text/html;base64,AAAA)',
    '![a](javascript:alert(1))',
    '[a](https://x.y/"onmouseover="alert(1))',
    '**<b onclick=1>**',
    '`</code><script>`',
    '> <iframe src=//evil>',
    '# <svg onload=1>',
    '- <a href="javascript:1">',
    '```\n</code></pre><script>x</script>\n```',
    '\u0000<script>',
  ];
  for (const n of nasty) {
    const html = api.markdownToHtml(n);
    const stripped = html.replace(/<\/?(p|h[1-6]|code|pre|strong|em|ul|ol|li|blockquote|br|hr)>/g, '').replace(/<a href="https?:[^"<>]*">|<\/a>|<img src="https?:[^"<>]*" alt="[^"<>]*">/g, '');
    assert.ok(!/[<>]/.test(stripped), `raw markup survived for ${JSON.stringify(n)}: ${html}`);
    assert.ok(!/href="javascript|href="data/i.test(html), n);
  }
});

test('esc covers all five characters', () => {
  const { api } = load({ route: () => res({}) });
  assert.equal(api.esc(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
});

test('postFromNote drops a duplicate title heading', () => {
  const { api } = load({ route: () => res({}) });
  assert.deepEqual({ ...api.postFromNote({ title: 'A', body: '# A\n\ntext' }) }, { title: 'A', markdown: 'text' });
  assert.equal(api.postFromNote({ title: '', body: '# Heading\nx' }).title, 'Heading');
  assert.equal(api.postFromNote({ title: '', body: '' }).title, 'Untitled');
});

test('dev.to: creates a draft first, saves the ID, then updates the same article', () => {
  const h = load({
    settings: { target: 'dev.to', tags: 'Rust, Notes!, rust, a, b, c' },
    route: (u, o) => res({ id: 42, url: 'https://dev.to/me/hello-1' }, o.method === 'POST' ? 201 : 200),
  });
  assert.match(run(h), /Sent on dev\.to, saved as a draft/);
  const c = h.calls[0];
  assert.equal(c.url, 'https://dev.to/api/articles');
  assert.equal(c.opts.headers['api-key'], SECRET);
  const b = JSON.parse(c.opts.body);
  assert.equal(b.article.published, false);
  assert.equal(b.article.tags, 'rust, notes, a, b');
  assert.equal(b.article.body_markdown, 'World **bold**');
  assert.equal(h.state.data.posts.devto.id, '42');
  assert.match(run(h), /Updated on dev\.to/);
  assert.equal(h.calls[1].url, 'https://dev.to/api/articles/42');
  assert.equal(h.calls[1].opts.method, 'PUT');
});

test('dev.to: publish status sets published', () => {
  const h = load({ settings: { status: 'publish' }, route: () => res({ id: 1, url: 'https://dev.to/x' }) });
  run(h);
  assert.equal(JSON.parse(h.calls[0].opts.body).article.published, true);
});

test('WordPress.com: form-encoded HTML, draft by default, update by ID', () => {
  const h = load({
    settings: { target: 'WordPress.com', wpSite: 'myblog.wordpress.com' },
    note: { title: 'T & <b>', body: '<script>x</script> para' },
    route: () => res({ ID: 99, URL: 'https://myblog.wordpress.com/t' }),
  });
  run(h);
  const c = h.calls[0];
  assert.equal(c.url, 'https://public-api.wordpress.com/rest/v1.1/sites/myblog.wordpress.com/posts/new');
  assert.equal(c.opts.headers.Authorization, `Bearer ${SECRET}`);
  const params = new URLSearchParams(c.opts.body);
  assert.equal(params.get('status'), 'draft');
  assert.equal(params.get('title'), 'T & <b>'); // title is plain text; WordPress escapes it on output
  assert.ok(!params.get('content').includes('<script>'));
  assert.match(params.get('content'), /&lt;script&gt;/);
  run(h);
  assert.equal(h.calls[1].url, 'https://public-api.wordpress.com/rest/v1.1/sites/myblog.wordpress.com/posts/99');
});

test('WordPress.com: a bad site value never reaches the URL', () => {
  const { api } = load({ route: () => res({}) });
  for (const site of ['', 'a/b', 'evil.com/../x', 'x y.com', 'a.com?x=1', '../..', 'a b']) {
    assert.throws(() => api.wordpressRequest(SECRET, { title: 't', markdown: 'm' }, { wpSite: site }, null), /site/);
  }
});

test('Hashnode: draft, then publish the draft, then update the post', () => {
  let n = 0;
  const h = load({
    settings: { target: 'Hashnode', hashnodePublication: 'abcdef123456' },
    route: (u, o) => {
      n++;
      const q = JSON.parse(o.body).query;
      if (q.includes('createDraft')) return res({ data: { createDraft: { draft: { id: 'd1', slug: 's' } } } });
      if (q.includes('publishDraft')) return res({ data: { publishDraft: { post: { id: 'p1', url: 'https://me.hashnode.dev/hello' } } } });
      return res({ data: { updatePost: { post: { id: 'p1', url: 'https://me.hashnode.dev/hello' } } } });
    },
  });
  run(h);
  const first = JSON.parse(h.calls[0].opts.body);
  assert.equal(first.variables.input.publicationId, 'abcdef123456');
  assert.equal(h.calls[0].opts.headers.Authorization, SECRET);
  assert.ok(!first.query.includes('World'), 'note text only in variables');
  assert.equal(h.state.data.posts['hashnode:abcdef123456'].draftId, 'd1');
  // Draft exists and status is still draft: explained, no duplicate.
  assert.match(run(h), /can't edit a draft/);
  assert.equal(n, 1);
  h.state.settings.status = 'publish';
  assert.match(run(h), /published/);
  assert.equal(h.state.data.posts['hashnode:abcdef123456'].postId, 'p1');
  h.state.settings.status = 'draft';
  assert.match(run(h), /Updated on Hashnode/);
  assert.ok(JSON.parse(h.calls[2].opts.body).query.includes('updatePost'));
});

test('Hashnode: GraphQL errors and missing publication', () => {
  const h = load({ settings: { target: 'Hashnode' }, route: () => res({}) });
  assert.match(run(h), /publication ID/);
  const h2 = load({ settings: { target: 'Hashnode', hashnodePublication: 'abcdef123456' }, route: () => res({ errors: [{ message: 'nope', extensions: { code: 'UNAUTHENTICATED' } }] }) });
  assert.match(run(h2), /rejected the token/);
});

test('failures are clear and never include a secret, even if the server echoes it', () => {
  for (const target of ['dev.to', 'WordPress.com', 'Hashnode']) {
    for (const [status, re] of [[401, /rejected/], [403, /isn't allowed/], [429, /rate limit/], [404, /can't find/], [422, /refused/], [500, /500/]]) {
      const h = load({
        settings: { target, wpSite: 'a.wordpress.com', hashnodePublication: 'abcdef123456' },
        route: () => ({ status, headers: { 'retry-after': '9' }, body: JSON.stringify({ error: `echo ${SECRET}`.replace(SECRET, 'x'), message: 'm' }) }),
      });
      const text = run(h);
      assert.match(text, re, `${target} ${status}`);
      assert.ok(!text.includes(SECRET));
      assert.ok(!flat(h.logs).includes(SECRET));
    }
    const h = load({ settings: { target, wpSite: 'a.wordpress.com', hashnodePublication: 'abcdef123456' }, route: () => new Error('offline') });
    assert.match(run(h), /Couldn't reach/);
  }
});

test('forget clears the stored post so the next publish creates a new one', () => {
  const h = load({ route: () => res({ id: 5, url: 'https://dev.to/a' }) });
  run(h);
  h.commands.forget.run();
  assert.equal(h.state.data.posts.devto, undefined);
  run(h);
  assert.equal(h.calls[1].opts.method, 'POST');
});

test('settings are validated before they are stored', () => {
  const h = load({ route: () => res({}) });
  h.presses.save({ target: 'Evil', status: 'x', wpSite: 'a/b', hashnodePublication: '<>', tags: 'ok' });
  assert.equal(h.state.settings.target, undefined);
  assert.equal(h.state.settings.status, undefined);
  assert.equal(h.state.settings.wpSite, '');
  assert.equal(h.state.settings.hashnodePublication, '');
  assert.equal(h.state.settings.tags, 'ok');
});
