// GitHub: create an issue from the selection, and show the state of the
// GitHub issue and pull request links found in the open note.
//
// The logic below is plain functions so tests can run it under Node; the
// host-facing code (commands, panel) is at the end.

const API = 'https://api.github.com';
const MAX_LINKS = 20; // the host allows 30 requests a minute
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const LINK = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/(\d{1,9})(?![\d])/g;

// First line is the title (leading # marks and spaces dropped), the rest the body.
function splitSelection(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i === lines.length) return null;
  const title = lines[i].replace(/^\s*#{1,6}\s+/, '').trim().slice(0, 256);
  const body = lines.slice(i + 1).join('\n').trim();
  if (title === '') return null;
  return { title, body };
}

function parseRepo(value) {
  const repo = String(value === undefined || value === null ? '' : value).trim();
  return REPO.test(repo) && repo.split('/').every((p) => p !== '.' && p !== '..') ? repo : null;
}

function issueRequest(repo, token, title, body) {
  return {
    url: `${API}/repos/${repo}/issues`,
    opts: {
      method: 'POST',
      headers: headers(token, true),
      body: JSON.stringify({ title, body }),
    },
  };
}

function headers(token, json) {
  const h = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

// Distinct issue and PR links, in order of appearance, at most MAX_LINKS.
function findLinks(text) {
  const seen = {};
  const out = [];
  let m;
  LINK.lastIndex = 0;
  while ((m = LINK.exec(String(text))) !== null && out.length < MAX_LINKS) {
    const url = `https://github.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
    const key = url.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push({ url, repo: `${m[1]}/${m[2]}`, kind: m[3] === 'pull' ? 'pr' : 'issue', number: Number(m[4]) });
  }
  return out;
}

// Maps an issue API response to what the panel shows.
function mapState(kind, data) {
  const title = typeof data.title === 'string' ? data.title : '';
  let state;
  if (kind === 'pr') {
    const merged = data.pull_request && data.pull_request.merged_at;
    state = merged ? 'merged' : data.state === 'closed' ? 'closed' : 'open';
  } else if (data.state === 'closed') {
    state = data.state_reason === 'not_planned' ? 'closed (not planned)' : 'closed';
  } else {
    state = 'open';
  }
  return { title, state };
}

// A clear message for a failed response; it never includes the token.
function failure(res, what) {
  const s = res.status;
  let note = '';
  try {
    const j = JSON.parse(res.body);
    if (j && typeof j.message === 'string') note = ` (${j.message.slice(0, 200)})`;
  } catch (e) {
    note = '';
  }
  const h = res.headers || {};
  if (s === 401) return `GitHub rejected the token (401). Paste a valid token under "token" in Settings › Plugins.`;
  if (s === 429 || (s === 403 && h['x-ratelimit-remaining'] === '0')) {
    const wait = h['retry-after'] ? ` Try again in ${h['retry-after']} seconds.` : ' Try again later.';
    return `GitHub's rate limit is reached.${wait}`;
  }
  if (s === 403) return `The token isn't allowed to ${what} (403). Check its repository access and permissions.${note}`;
  if (s === 404) return `GitHub can't find that, or the token has no access to it (404).`;
  if (s === 410) return `Issues are turned off for that repository (410).`;
  if (s === 422) return `GitHub refused the issue (422).${note}`;
  return `GitHub answered ${s} while trying to ${what}.${note}`;
}

function call(url, opts, what) {
  let res;
  try {
    res = kanso.fetch(url, opts);
  } catch (e) {
    throw new Error(`Couldn't reach GitHub to ${what}: ${e && e.message ? e.message : 'request failed'}`);
  }
  if (res.status < 200 || res.status >= 300) throw new Error(failure(res, what));
  try {
    return JSON.parse(res.body);
  } catch (e) {
    throw new Error(`GitHub sent something unreadable while trying to ${what}.`);
  }
}

function needToken() {
  const token = kanso.secrets.get('token');
  if (!token) throw new Error('No token yet. Paste a GitHub token under "token" in Settings › Plugins.');
  return token;
}

function settings() {
  const s = kanso.settings.get();
  return s && typeof s === 'object' ? s : {};
}

function createIssue(token, repo, parts) {
  const r = issueRequest(repo, token, parts.title, parts.body);
  const data = call(r.url, r.opts, 'create the issue');
  if (typeof data.html_url !== 'string' || !data.html_url.startsWith('https://github.com/')) {
    throw new Error('GitHub created the issue but sent no link.');
  }
  return { url: data.html_url, number: data.number };
}

function linkState(token, link) {
  const data = call(`${API}/repos/${link.repo}/issues/${link.number}`, { method: 'GET', headers: headers(token, false) }, 'read it');
  return mapState(link.kind, data);
}

kanso.commands.register({
  id: 'create-issue',
  title: 'GitHub: create an issue from the selection',
  keywords: ['github', 'issue', 'bug'],
  when: 'selection',
  run: () => {
    const repo = parseRepo(settings().repo);
    if (!repo) return { text: 'Set the repository (owner/name) in the GitHub panel first.' };
    const sel = kanso.editor.selection();
    const parts = sel && splitSelection(sel.text);
    if (!parts) return { text: 'Select some text first: its first line becomes the title.' };
    try {
      const issue = createIssue(needToken(), repo, parts);
      const id = kanso.editor.noteId();
      if (id !== null) {
        try {
          const old = kanso.notes.pluginData.get(id);
          const issues = old && Array.isArray(old.issues) ? old.issues : [];
          issues.push(issue.url);
          kanso.notes.pluginData.set(id, { issues: issues.slice(-50) });
        } catch (e) {
          return { text: `Created ${issue.url}, but couldn't save it on the note: ${e.message}` };
        }
      }
      return { text: `Created ${issue.url}` };
    } catch (e) {
      return { text: e.message };
    }
  },
});

function show(message) {
  const s = settings();
  const children = [
    { type: 'heading', value: 'GitHub' },
    { type: 'input', id: 'repo', label: 'Repository (owner/name)', value: typeof s.repo === 'string' ? s.repo : '', placeholder: 'octocat/hello-world' },
    { type: 'button', id: 'save', label: 'Save repository' },
  ];
  if (message) children.push({ type: 'text', value: message, style: 'muted' });
  const id = kanso.editor.noteId();
  if (id === null) {
    children.push({ type: 'text', value: 'Open a note to see its GitHub links.', style: 'muted' });
  } else {
    let links = findLinks(kanso.notes.get(id).body);
    try {
      const data = kanso.notes.pluginData.get(id);
      const saved = data && Array.isArray(data.issues) ? data.issues.filter((u) => typeof u === 'string').join('\n') : '';
      links = findLinks(`${links.map((l) => l.url).join('\n')}\n${saved}`);
    } catch (e) {
      // The links in the text are enough.
    }
    children.push({ type: 'divider' });
    if (links.length === 0) {
      children.push({ type: 'text', value: 'No GitHub issue or pull request links in this note.', style: 'muted' });
    } else {
      let token = null;
      let problem = null;
      try {
        token = needToken();
      } catch (e) {
        problem = e.message;
      }
      const rows = [];
      for (const link of links) {
        let badge = '?';
        let title = `${link.repo}#${link.number}`;
        if (token && !problem) {
          try {
            const st = linkState(token, link);
            badge = st.state;
            if (st.title) title = `${title} ${st.title}`;
          } catch (e) {
            problem = e.message;
          }
        }
        rows.push({
          type: 'row',
          gap: 8,
          children: [
            { type: 'badge', value: `${link.kind === 'pr' ? 'PR' : 'Issue'}: ${badge}` },
            { type: 'link', label: title.slice(0, 120), url: link.url },
          ],
        });
      }
      children.push({ type: 'list', items: rows });
      if (problem) children.push({ type: 'text', value: problem, style: 'caption' });
    }
  }
  children.push({ type: 'button', id: 'refresh', label: 'Refresh' });
  kanso.ui.panel({ type: 'column', gap: 12, children });
}

kanso.commands.register({
  id: 'show-links',
  title: 'GitHub: show the status of linked issues and pull requests',
  keywords: ['github', 'pull request', 'status'],
  run: () => {
    show();
    return null;
  },
});

kanso.ui.onPress('refresh', () => {
  show();
  return null;
});

kanso.ui.onPress('save', (values) => {
  const repo = parseRepo(values && values.repo);
  if (!repo) {
    show('That isn\'t a repository. Use owner/name.');
    return null;
  }
  kanso.settings.set(Object.assign({}, settings(), { repo }));
  show(`Saved ${repo}.`);
  return null;
});

if (typeof module !== 'undefined') {
  module.exports = { splitSelection, parseRepo, issueRequest, findLinks, mapState, failure, createIssue, linkState };
}
