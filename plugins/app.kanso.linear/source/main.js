// Linear: create an issue from the selection in a chosen team, and show the
// state of the Linear issues linked in the open note (GraphQL, one request
// for all of them).

const ENDPOINT = 'https://api.linear.app/graphql';
const MAX_LINKS = 20;
const TEAM_KEY = /^[A-Za-z0-9]{1,16}$/;
const LINK = /https:\/\/linear\.app\/[A-Za-z0-9_-]+\/issue\/([A-Za-z0-9]{1,16})-(\d{1,9})(?![\d])/g;

const CREATE = 'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }';
const TEAMS = 'query { teams(first: 100) { nodes { id key name } } }';

function splitSelection(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i === lines.length) return null;
  const title = lines[i].replace(/^\s*#{1,6}\s+/, '').trim().slice(0, 255);
  const body = lines.slice(i + 1).join('\n').trim();
  return title === '' ? null : { title, body };
}

function parseTeamKey(value) {
  const key = String(value === undefined || value === null ? '' : value).trim();
  return TEAM_KEY.test(key) ? key.toUpperCase() : null;
}

// A personal API key goes in Authorization as is; an OAuth token would need
// "Bearer ", which is why a token that already starts with it is left alone.
function authHeader(token) {
  return token.startsWith('Bearer ') ? token : token.startsWith('lin_oauth_') ? `Bearer ${token}` : token;
}

function gql(token, query, variables) {
  return {
    url: ENDPOINT,
    opts: {
      method: 'POST',
      headers: { Authorization: authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    },
  };
}

function createRequest(token, teamId, parts) {
  const input = { teamId, title: parts.title };
  if (parts.body) input.description = parts.body;
  return gql(token, CREATE, { input });
}

function findLinks(text) {
  const seen = {};
  const out = [];
  let m;
  LINK.lastIndex = 0;
  while ((m = LINK.exec(String(text))) !== null && out.length < MAX_LINKS) {
    const identifier = `${m[1].toUpperCase()}-${m[2]}`;
    if (seen[identifier]) continue;
    seen[identifier] = true;
    out.push({ identifier, url: m[0] });
  }
  return out;
}

// One query for all identifiers, using variables so none is spliced into the query text.
function statesRequest(token, identifiers) {
  const decl = identifiers.map((_, i) => `$i${i}: String!`).join(', ');
  const body = identifiers
    .map((_, i) => `a${i}: issue(id: $i${i}) { identifier title url state { name type } }`)
    .join(' ');
  const variables = {};
  identifiers.forEach((id, i) => { variables[`i${i}`] = id; });
  return gql(token, `query(${decl}) { ${body} }`, variables);
}

function mapStates(identifiers, data) {
  return identifiers.map((identifier, i) => {
    const issue = data && data[`a${i}`];
    if (!issue) return { identifier, found: false, state: 'not found', title: '' };
    return {
      identifier,
      found: true,
      state: issue.state && typeof issue.state.name === 'string' ? issue.state.name : '?',
      type: issue.state ? issue.state.type : undefined,
      title: typeof issue.title === 'string' ? issue.title : '',
      url: typeof issue.url === 'string' && issue.url.startsWith('https://linear.app/') ? issue.url : undefined,
    };
  });
}

// Clear messages; they never include the token or the server's own text verbatim.
function failure(res, what) {
  const s = res.status;
  let code = '';
  let note = '';
  try {
    const j = JSON.parse(res.body);
    const e = j && j.errors && j.errors[0];
    if (e) {
      code = (e.extensions && e.extensions.code) || '';
      note = typeof e.message === 'string' ? ` (${e.message.slice(0, 200)})` : '';
    }
  } catch (x) {
    note = '';
  }
  if (s === 429 || code === 'RATELIMITED') return `Linear's rate limit is reached. Try again in a minute.`;
  if (s === 401 || code === 'AUTHENTICATION_ERROR') return `Linear rejected the API key (401). Paste a valid key under "token" in Settings › Plugins.`;
  if (s === 403 || code === 'FORBIDDEN') return `The API key isn't allowed to ${what} (403).${note}`;
  return `Linear answered ${s} while trying to ${what}.${note}`;
}

function request(r, what) {
  let res;
  try {
    res = kanso.fetch(r.url, r.opts);
  } catch (e) {
    throw new Error(`Couldn't reach Linear to ${what}: ${e && e.message ? e.message : 'request failed'}`);
  }
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch (e) {
    json = null;
  }
  // Linear answers 200 with an "errors" array for GraphQL errors.
  const bad = res.status < 200 || res.status >= 300 || !json || (json.errors && json.errors.length && !json.data);
  if (bad) throw new Error(failure(res, what));
  return json;
}

function needToken() {
  const token = kanso.secrets.get('token');
  if (!token) throw new Error('No API key yet. Paste a Linear API key under "token" in Settings › Plugins.');
  return token;
}

function settings() {
  const s = kanso.settings.get();
  return s && typeof s === 'object' ? s : {};
}

function listTeams(token) {
  const json = request(gql(token, TEAMS, {}), 'list your teams');
  const nodes = json.data && json.data.teams && json.data.teams.nodes;
  return Array.isArray(nodes) ? nodes.filter((t) => t && typeof t.id === 'string' && typeof t.key === 'string') : [];
}

function teamIdFor(teams, key) {
  const team = teams.find((t) => t.key.toUpperCase() === key);
  return team ? team.id : null;
}

function createIssue(token, key, parts) {
  const id = teamIdFor(listTeams(token), key);
  if (!id) throw new Error(`There is no team with the key ${key} for this API key.`);
  const json = request(createRequest(token, id, parts), 'create the issue');
  const r = json.data && json.data.issueCreate;
  if (!r || !r.success || !r.issue || typeof r.issue.url !== 'string' || !r.issue.url.startsWith('https://linear.app/')) {
    throw new Error('Linear did not create the issue.');
  }
  return { url: r.issue.url, identifier: r.issue.identifier };
}

kanso.commands.register({
  id: 'create-issue',
  title: 'Linear: create an issue from the selection',
  keywords: ['linear', 'issue', 'ticket'],
  when: 'selection',
  run: () => {
    const key = parseTeamKey(settings().teamKey);
    if (!key) return { text: 'Set the team key (for example ENG) in the Linear panel first.' };
    const sel = kanso.editor.selection();
    const parts = sel && splitSelection(sel.text);
    if (!parts) return { text: 'Select some text first: its first line becomes the title.' };
    try {
      const issue = createIssue(needToken(), key, parts);
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
      return { text: `Created ${issue.identifier}: ${issue.url}` };
    } catch (e) {
      return { text: e.message };
    }
  },
});

function show(message, teams) {
  const s = settings();
  const key = typeof s.teamKey === 'string' ? s.teamKey : '';
  const children = [{ type: 'heading', value: 'Linear' }];
  if (teams && teams.length) {
    const options = teams.map((t) => `${t.key} - ${t.name}`);
    const current = options.find((o) => o.startsWith(`${key} - `));
    children.push({ type: 'select', id: 'team', label: 'Team', options, value: current });
  } else {
    children.push({ type: 'input', id: 'team', label: 'Team key', value: key, placeholder: 'ENG' });
    children.push({ type: 'button', id: 'teams', label: 'Load my teams' });
  }
  children.push({ type: 'button', id: 'save', label: 'Save team' });
  if (message) children.push({ type: 'text', value: message, style: 'muted' });
  const noteId = kanso.editor.noteId();
  if (noteId === null) {
    children.push({ type: 'text', value: 'Open a note to see its Linear issues.', style: 'muted' });
  } else {
    let links = findLinks(kanso.notes.get(noteId).body);
    try {
      const data = kanso.notes.pluginData.get(noteId);
      const saved = data && Array.isArray(data.issues) ? data.issues.filter((u) => typeof u === 'string').join('\n') : '';
      links = findLinks(`${links.map((l) => l.url).join('\n')}\n${saved}`);
    } catch (e) {
      // The links in the text are enough.
    }
    children.push({ type: 'divider' });
    if (links.length === 0) {
      children.push({ type: 'text', value: 'No Linear issue links in this note.', style: 'muted' });
    } else {
      let rows = [];
      let problem = null;
      try {
        const ids = links.map((l) => l.identifier);
        const json = request(statesRequest(needToken(), ids), 'read the issues');
        rows = mapStates(ids, json.data).map((r, i) => ({
          type: 'row',
          gap: 8,
          children: [
            { type: 'badge', value: r.state },
            { type: 'link', label: `${r.identifier} ${r.title}`.trim().slice(0, 120), url: r.url || links[i].url },
          ],
        }));
      } catch (e) {
        problem = e.message;
      }
      if (rows.length) children.push({ type: 'list', items: rows });
      if (problem) children.push({ type: 'text', value: problem, style: 'caption' });
    }
  }
  children.push({ type: 'button', id: 'refresh', label: 'Refresh' });
  kanso.ui.panel({ type: 'column', gap: 12, children });
}

kanso.commands.register({
  id: 'show-links',
  title: 'Linear: show the state of linked issues',
  keywords: ['linear', 'status', 'issues'],
  run: () => {
    show();
    return null;
  },
});

kanso.ui.onPress('refresh', () => { show(); return null; });

kanso.ui.onPress('teams', () => {
  try {
    show('Pick your team.', listTeams(needToken()));
  } catch (e) {
    show(e.message);
  }
  return null;
});

kanso.ui.onPress('save', (values) => {
  const raw = values && typeof values.team === 'string' ? values.team.split(' - ')[0] : '';
  const key = parseTeamKey(raw);
  if (!key) {
    show('That isn\'t a team key. Use letters and digits, like ENG.');
    return null;
  }
  kanso.settings.set(Object.assign({}, settings(), { teamKey: key }));
  show(`Saved team ${key}.`);
  return null;
});

if (typeof module !== 'undefined') {
  module.exports = { splitSelection, parseTeamKey, authHeader, createRequest, findLinks, statesRequest, mapStates, failure, createIssue, listTeams };
}
