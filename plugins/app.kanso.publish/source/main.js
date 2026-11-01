// Publish: send the open note to dev.to, WordPress.com or Hashnode. A draft
// by default; the post's ID is kept on the note so publishing again updates
// the same post.
//
// Hosts are fixed in the manifest, so only targets with fixed hosts are here.

const TARGETS = ['dev.to', 'WordPress.com', 'Hashnode'];
const SITE = /^(?:\d{1,12}|[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$/;
const PUB_ID = /^[A-Za-z0-9]{8,64}$/;

// ---- Markdown to HTML (WordPress.com wants HTML). Every piece of text is escaped first.

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(u) {
  const url = String(u).trim();
  return /^(https?:\/\/|mailto:)[^\s<>"']*$/i.test(url) ? url : null;
}

function inline(text) {
  // Code spans first, so their contents are not read as markdown.
  const stash = [];
  let s = String(text).replace(/`([^`\n]+)`/g, (_, c) => {
    stash.push(`<code>${esc(c)}</code>`);
    return `\u0000${stash.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const u = safeUrl(unesc(url));
    return u && /^https?:/i.test(u) ? `<img src="${esc(u)}" alt="${alt}">` : alt;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const u = safeUrl(unesc(url));
    return u ? `<a href="${esc(u)}">${label}</a>` : label;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}

function unesc(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function markdownToHtml(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if ((m = /^\s*(```|~~~)/.exec(line))) {
      const fence = m[1];
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (line.trim() === '') {
      i++;
    } else if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      i++;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
    } else if (/^\s*>/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${markdownToHtml(q.join('\n'))}</blockquote>`);
    } else if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''))}</li>`);
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
    } else {
      const p = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+\.)\s)/.test(lines[i])) p.push(lines[i++]);
      out.push(`<p>${p.map(inline).join('<br>\n')}</p>`);
    }
  }
  return out.join('\n');
}

// ---- Note to post

function postFromNote(note) {
  const body = String(note.body || '').replace(/\r\n?/g, '\n');
  let title = String(note.title || '').trim();
  let text = body;
  const h1 = /^\s*#\s+([^\n]+?)\s*(?:\n|$)/.exec(body);
  if (h1) {
    if (!title) title = h1[1].trim();
    if (h1[1].trim() === title) text = body.slice(h1[0].length);
  }
  if (!title) title = 'Untitled';
  return { title: title.slice(0, 200), markdown: text.trim() };
}

function parseTags(value, max) {
  const seen = {};
  const tags = [];
  String(value || '').split(',').forEach((t) => {
    const tag = t.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (tag && !seen[tag] && tags.length < max) {
      seen[tag] = true;
      tags.push(tag);
    }
  });
  return tags;
}

function form(fields) {
  return Object.keys(fields).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k])}`).join('&');
}

// ---- Requests: each returns { url, opts, read(json) -> { id, url } }

function devtoRequest(key, post, cfg, prior) {
  const article = { title: post.title, body_markdown: post.markdown, published: cfg.status === 'publish' };
  const tags = parseTags(cfg.tags, 4);
  if (tags.length) article.tags = tags.join(', ');
  return {
    url: prior ? `https://dev.to/api/articles/${encodeURIComponent(prior.id)}` : 'https://dev.to/api/articles',
    opts: {
      method: prior ? 'PUT' : 'POST',
      headers: { 'api-key': key, Accept: 'application/vnd.forem.api-v1+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ article }),
    },
    read: (j) => ({ id: String(j.id), url: j.url }),
  };
}

function wordpressRequest(token, post, cfg, prior) {
  const site = cfg.wpSite;
  if (!SITE.test(String(site || ''))) throw new Error('Set the WordPress.com site (for example myblog.wordpress.com) in the Publish panel.');
  const fields = { title: post.title, content: markdownToHtml(post.markdown), status: cfg.status === 'publish' ? 'publish' : 'draft' };
  const tags = parseTags(cfg.tags, 10);
  if (tags.length) fields.tags = tags.join(',');
  const base = `https://public-api.wordpress.com/rest/v1.1/sites/${encodeURIComponent(site)}/posts`;
  return {
    url: prior ? `${base}/${encodeURIComponent(prior.id)}` : `${base}/new`,
    opts: {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form(fields),
    },
    read: (j) => ({ id: String(j.ID), url: j.URL, site }),
  };
}

function hashnodeRequest(token, post, cfg, prior) {
  const wantPublish = cfg.status === 'publish';
  let query;
  let input;
  let read;
  if (prior && prior.postId) {
    query = 'mutation($input: UpdatePostInput!) { updatePost(input: $input) { post { id url } } }';
    input = { id: prior.postId, title: post.title, contentMarkdown: post.markdown };
    read = (d) => ({ postId: d.updatePost.post.id, id: d.updatePost.post.id, url: d.updatePost.post.url });
  } else if (prior && prior.draftId) {
    if (!wantPublish) throw new Error("Hashnode's API can't edit a draft that already exists. Edit it on Hashnode, or set the status to Publish to publish it, or use Forget to make a new draft.");
    query = 'mutation($input: PublishDraftInput!) { publishDraft(input: $input) { post { id url } } }';
    input = { draftId: prior.draftId };
    read = (d) => ({ postId: d.publishDraft.post.id, id: d.publishDraft.post.id, url: d.publishDraft.post.url });
  } else {
    if (!PUB_ID.test(String(cfg.hashnodePublication || ''))) throw new Error('Set the Hashnode publication ID in the Publish panel.');
    query = 'mutation($input: CreateDraftInput!) { createDraft(input: $input) { draft { id slug } } }';
    input = { title: post.title, contentMarkdown: post.markdown, publicationId: cfg.hashnodePublication };
    read = (d) => ({ draftId: d.createDraft.draft.id, id: d.createDraft.draft.id, url: undefined });
  }
  return {
    url: 'https://gql.hashnode.com/',
    opts: {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { input } }),
    },
    graphql: true,
    read,
  };
}

// ---- Failures (never include a secret)

function failure(res, who) {
  const s = res.status;
  let note = '';
  let code = '';
  try {
    const j = JSON.parse(res.body);
    const e = j.errors && j.errors[0];
    const m = (e && e.message) || j.error || j.message;
    if (typeof m === 'string') note = ` (${m.slice(0, 200)})`;
    code = (e && e.extensions && e.extensions.code) || '';
  } catch (x) {
    note = '';
  }
  if (s === 401 || code === 'UNAUTHENTICATED') return `${who} rejected the token (${s}). Paste a valid one in Settings › Plugins.`;
  if (s === 403 || code === 'FORBIDDEN') return `${who} says the token isn't allowed to do that (${s}).${note}`;
  if (s === 429) return `${who}'s rate limit is reached. Try again in ${res.headers && res.headers['retry-after'] ? `${res.headers['retry-after']} seconds` : 'a minute'}.`;
  if (s === 404) return `${who} can't find that post or site (404). If you deleted the post there, use Forget and publish again.`;
  if (s === 422 || s === 400) return `${who} refused the post (${s}).${note}`;
  return `${who} answered ${s}.${note}`;
}

function send(req, who) {
  let res;
  try {
    res = kanso.fetch(req.url, req.opts);
  } catch (e) {
    throw new Error(`Couldn't reach ${who}: ${e && e.message ? e.message : 'request failed'}`);
  }
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch (e) {
    json = null;
  }
  const gqlFail = req.graphql && json && json.errors && json.errors.length;
  if (res.status < 200 || res.status >= 300 || !json || gqlFail) throw new Error(failure(res, who));
  let out;
  try {
    out = req.read(req.graphql ? json.data : json);
  } catch (e) {
    throw new Error(`${who} answered, but not in the shape expected.`);
  }
  if (out.url !== undefined && !/^https:\/\//.test(String(out.url))) out.url = undefined;
  return out;
}

const KEYS = { 'dev.to': ['devto-key', devtoRequest], 'WordPress.com': ['wordpress-token', wordpressRequest], Hashnode: ['hashnode-token', hashnodeRequest] };

function storeKey(target, cfg) {
  if (target === 'WordPress.com') return `wordpress:${cfg.wpSite}`;
  if (target === 'Hashnode') return `hashnode:${cfg.hashnodePublication}`;
  return 'devto';
}

function publish(note, cfg, data) {
  const target = TARGETS.indexOf(cfg.target) >= 0 ? cfg.target : 'dev.to';
  const [secret, build] = KEYS[target];
  const token = kanso.secrets.get(secret);
  if (!token) throw new Error(`No token yet. Paste one under "${secret}" in Settings › Plugins.`);
  const posts = data && data.posts && typeof data.posts === 'object' ? data.posts : {};
  const key = storeKey(target, cfg);
  const prior = posts[key] || null;
  const req = build(token, postFromNote(note), cfg, prior);
  const result = send(req, target);
  const saved = Object.assign({}, prior || {}, result);
  if (result.url === undefined && prior) saved.url = prior.url;
  return { target, key, saved, updated: !!prior };
}

// ---- Host side

function settings() {
  const s = kanso.settings.get();
  return s && typeof s === 'object' ? s : {};
}

function run() {
  const id = kanso.editor.noteId();
  if (id === null) return 'No note is open.';
  const cfg = settings();
  const note = kanso.notes.get(id);
  let data = null;
  try {
    data = kanso.notes.pluginData.get(id);
  } catch (e) {
    data = null;
  }
  const r = publish(note, cfg, data);
  const posts = Object.assign({}, data && data.posts);
  posts[r.key] = r.saved;
  const status = cfg.status === 'publish' ? 'published' : 'saved as a draft';
  const where = r.saved.url ? ` ${r.saved.url}` : '';
  try {
    kanso.notes.pluginData.set(id, Object.assign({}, data, { posts }));
  } catch (e) {
    return `${r.updated ? 'Updated' : 'Sent'} on ${r.target} (${status}),${where} but couldn't save the post ID on the note: ${e.message}`;
  }
  return `${r.updated ? 'Updated' : 'Sent'} on ${r.target}, ${status}.${where}`;
}

function show(message) {
  const cfg = settings();
  const children = [
    { type: 'heading', value: 'Publish' },
    { type: 'select', id: 'target', label: 'Publish to', options: TARGETS, value: TARGETS.indexOf(cfg.target) >= 0 ? cfg.target : 'dev.to' },
    { type: 'select', id: 'status', label: 'Status', options: ['draft', 'publish'], value: cfg.status === 'publish' ? 'publish' : 'draft' },
    { type: 'input', id: 'tags', label: 'Tags (comma separated)', value: cfg.tags || '' },
    { type: 'input', id: 'wpSite', label: 'WordPress.com site', value: cfg.wpSite || '', placeholder: 'myblog.wordpress.com' },
    { type: 'input', id: 'hashnodePublication', label: 'Hashnode publication ID', value: cfg.hashnodePublication || '' },
    { type: 'button', id: 'save', label: 'Save settings' },
    { type: 'button', id: 'publish', label: 'Publish this note', tone: 'primary' },
  ];
  if (message) children.push({ type: 'text', value: message, style: 'muted' });
  const id = kanso.editor.noteId();
  if (id !== null) {
    try {
      const data = kanso.notes.pluginData.get(id);
      const posts = data && data.posts ? data.posts : {};
      Object.keys(posts).forEach((k) => {
        if (posts[k] && /^https:\/\//.test(posts[k].url || '')) children.push({ type: 'link', label: `${k}: ${posts[k].url}`.slice(0, 120), url: posts[k].url });
        else children.push({ type: 'text', value: `${k}: sent (no public link yet)`, style: 'caption' });
      });
    } catch (e) {
      // Nothing to list.
    }
  }
  kanso.ui.panel({ type: 'column', gap: 12, children });
}

function saveSettings(v) {
  const next = Object.assign({}, settings());
  if (v && TARGETS.indexOf(v.target) >= 0) next.target = v.target;
  if (v && (v.status === 'draft' || v.status === 'publish')) next.status = v.status;
  if (v && typeof v.tags === 'string') next.tags = v.tags.slice(0, 200);
  if (v && typeof v.wpSite === 'string') next.wpSite = SITE.test(v.wpSite.trim()) ? v.wpSite.trim() : '';
  if (v && typeof v.hashnodePublication === 'string') next.hashnodePublication = PUB_ID.test(v.hashnodePublication.trim()) ? v.hashnodePublication.trim() : '';
  kanso.settings.set(next);
}

function safely(f) {
  try {
    return f();
  } catch (e) {
    return e.message;
  }
}

kanso.commands.register({
  id: 'publish-note',
  title: 'Publish the open note',
  keywords: ['publish', 'blog', 'dev.to', 'wordpress', 'hashnode'],
  when: 'note-open',
  run: () => ({ text: safely(run) }),
});

kanso.commands.register({
  id: 'forget',
  title: 'Publish: forget the post made from this note',
  keywords: ['publish', 'reset'],
  when: 'note-open',
  run: () => ({
    text: safely(() => {
      const id = kanso.editor.noteId();
      if (id === null) return 'No note is open.';
      const cfg = settings();
      const data = kanso.notes.pluginData.get(id);
      const posts = Object.assign({}, data && data.posts);
      delete posts[storeKey(TARGETS.indexOf(cfg.target) >= 0 ? cfg.target : 'dev.to', cfg)];
      kanso.notes.pluginData.set(id, Object.assign({}, data, { posts }));
      return 'Forgot it. The next publish makes a new post. The old one is untouched.';
    }),
  }),
});

kanso.commands.register({
  id: 'show-panel',
  title: 'Publish: settings and links',
  run: () => { show(); return null; },
});

kanso.ui.onPress('save', (v) => { saveSettings(v); show('Saved.'); return null; });
kanso.ui.onPress('publish', (v) => {
  saveSettings(v);
  show(safely(run));
  return null;
});

if (typeof module !== 'undefined') {
  module.exports = { esc, markdownToHtml, postFromNote, parseTags, devtoRequest, wordpressRequest, hashnodeRequest, failure, publish };
}
