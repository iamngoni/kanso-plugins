// Format: pretty-print or minify JSON and format SQL in the selection.
// The formatters work on the text itself, not on parsed values, so number
// literals, key order and duplicate keys come through untouched.

// ---- JSON --------------------------------------------------------------

// Where an engine's error message says "position N", turn N into a line and
// column of `text`; null when it doesn't say.
function locate(text, message) {
  const m = /position (\d+)/.exec(message || '');
  if (!m) return null;
  const at = Math.min(Number(m[1]), text.length);
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  const column = at - (before.lastIndexOf('\n') + 1) + 1;
  return { line, column };
}

// Returns { ok: true } or { ok: false, error }.
function checkJson(text) {
  try {
    JSON.parse(text);
    return { ok: true };
  } catch (e) {
    const message = e && e.message ? String(e.message) : 'not valid JSON';
    const at = locate(text, message);
    const where = at ? ` at line ${at.line}, column ${at.column}` : '';
    return { ok: false, error: `Invalid JSON${where}: ${message}` };
  }
}

// Walks valid JSON text, calling visit(kind, char) for structure and
// copying strings and scalars whole.
function walkJson(text, emit) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      emit('value', text.slice(i, j + 1));
      i = j + 1;
    } else if (ch === '{' || ch === '[') {
      let j = i + 1;
      while (j < n && /\s/.test(text[j])) j += 1;
      if (text[j] === (ch === '{' ? '}' : ']')) {
        emit('value', ch + text[j]);
        i = j + 1;
      } else {
        emit('open', ch);
        i += 1;
      }
    } else if (ch === '}' || ch === ']') {
      emit('close', ch);
      i += 1;
    } else if (ch === ',') {
      emit('comma', ch);
      i += 1;
    } else if (ch === ':') {
      emit('colon', ch);
      i += 1;
    } else if (/\s/.test(ch)) {
      i += 1;
    } else {
      let j = i;
      while (j < n && !/[\s,:\]}]/.test(text[j])) j += 1;
      emit('value', text.slice(i, j));
      i = j;
    }
  }
}

// Returns { text } or { error }.
function prettyJson(text, indent) {
  const checked = checkJson(text);
  if (!checked.ok) return { error: checked.error };
  const unit = ' '.repeat(indent === undefined ? 2 : indent);
  let depth = 0;
  let out = '';
  walkJson(text, (kind, s) => {
    if (kind === 'open') {
      depth += 1;
      out += s + '\n' + unit.repeat(depth);
    } else if (kind === 'close') {
      depth -= 1;
      out += '\n' + unit.repeat(depth) + s;
    } else if (kind === 'comma') {
      out += ',\n' + unit.repeat(depth);
    } else if (kind === 'colon') {
      out += ': ';
    } else {
      out += s;
    }
  });
  return { text: out };
}

function minifyJson(text) {
  const checked = checkJson(text);
  if (!checked.ok) return { error: checked.error };
  let out = '';
  walkJson(text, (kind, s) => { out += s; });
  return { text: out };
}

// ---- SQL ---------------------------------------------------------------

const KEYWORDS = new Set(('select from where and or not in is null as on join inner left right full outer cross natural group by order having limit offset union all distinct insert into values update set delete create table alter drop if exists between like ilike case when then else end asc desc with recursive over partition primary foreign references unique constraint returning using intersect except true false any some escape truncate begin commit rollback add column cascade').split(' '));
const FUNCTIONS = new Set(('count sum avg min max coalesce nullif row_number rank dense_rank lower upper length round abs now cast extract concat substring trim floor ceil ceiling date_trunc').split(' '));
const LIST_CLAUSES = new Set(['SELECT', 'GROUP BY', 'ORDER BY', 'SET', 'RETURNING', 'VALUES']);
const CLAUSES = new Set(['FROM', 'WHERE', 'HAVING', 'LIMIT', 'OFFSET', 'WITH', 'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT', 'UPDATE', 'INSERT INTO', 'DELETE FROM']);
const JOIN_WORDS = new Set(['NATURAL', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER']);

// Tokens: { t: 'word' | 'string' | 'comment' | 'line-comment' | 'number' |
// 'op' | 'punct', s }.
function tokenizeSql(sql) {
  const tokens = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const rest = sql.slice(i, i + 4);
    const ch = sql[i];
    let m;
    if (/\s/.test(ch)) {
      i += 1;
    } else if (rest.startsWith('--')) {
      let j = sql.indexOf('\n', i);
      if (j < 0) j = n;
      tokens.push({ t: 'line-comment', s: sql.slice(i, j).replace(/\s+$/, '') });
      i = j;
    } else if (rest.startsWith('/*')) {
      let j = sql.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      tokens.push({ t: 'comment', s: sql.slice(i, j) });
      i = j;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) j += 2;
          else break;
        } else {
          j += 1;
        }
      }
      j = Math.min(j + 1, n);
      tokens.push({ t: ch === "'" ? 'string' : 'quoted', s: sql.slice(i, j) });
      i = j;
    } else if (ch === '[' && (m = /^\[[^\]\n]*\]/.exec(sql.slice(i)))) {
      tokens.push({ t: 'quoted', s: m[0] });
      i += m[0].length;
    } else if ((m = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(sql.slice(i)))) {
      tokens.push({ t: 'number', s: m[0] });
      i += m[0].length;
    } else if ((m = /^[\p{L}_$#@][\p{L}\p{N}\p{M}_$#@]*/u.exec(sql.slice(i)))) {
      tokens.push({ t: 'word', s: m[0] });
      i += m[0].length;
    } else if ((m = /^:[\p{L}_][\p{L}\p{N}_]*/u.exec(sql.slice(i))) && sql[i + 1] !== ':') {
      tokens.push({ t: 'param', s: m[0] });
      i += m[0].length;
    } else if ((m = /^(?:<=>|<>|<=|>=|!=|\|\||::|->>|->|=>|:=|[-+*\/%<>=!&|^~])/.exec(sql.slice(i)))) {
      tokens.push({ t: 'op', s: m[0] });
      i += m[0].length;
    } else {
      const cp = String.fromCodePoint(sql.codePointAt(i));
      tokens.push({ t: 'punct', s: cp });
      i += cp.length;
    }
  }
  return tokens;
}

const STOP = new Set(['FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT', 'RETURNING', 'SET', 'VALUES', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL']);

// Whether the list that starts after tokens[from] has a comma of its own.
function hasTopComma(tokens, from) {
  let depth = 0;
  for (let k = from + 1; k < tokens.length; k += 1) {
    const t = tokens[k];
    if (t.t === 'punct') {
      if (t.s === '(') depth += 1;
      else if (t.s === ')') { depth -= 1; if (depth < 0) return false; }
      else if (t.s === ';') return false;
      else if (t.s === ',' && depth === 0) return true;
    } else if (t.t === 'word' && depth === 0 && STOP.has(t.s.toUpperCase())) {
      return false;
    }
  }
  return false;
}

function formatSql(sql) {
  const tokens = tokenizeSql(sql);
  const lines = [];
  let cur = '';
  let atLineStart = true;
  let pendingBreak = null; // a level: the next token starts a line there
  let forceBreak = false; // after a line comment
  let lineLevel = 0;
  let prev = null;
  let stmtStart = true;
  let betweenPending = false;
  // scope: { base, clause, inline, caseDepth }
  let scope = { base: 0, clause: null, inline: false, caseDepth: 0 };
  const stack = [];

  const newline = (level) => {
    if (!atLineStart || cur.trim() !== '') lines.push(cur.replace(/\s+$/, ''));
    cur = '  '.repeat(level);
    lineLevel = level;
    atLineStart = true;
  };
  const wordAt = (k) => (tokens[k] && tokens[k].t === 'word' ? tokens[k].s.toUpperCase() : null);
  const needsSpace = (tok) => {
    if (atLineStart || prev === null) return false;
    const p = prev;
    if (tok.t === 'punct' && (tok.s === ',' || tok.s === ';' || tok.s === ')' || tok.s === '.')) return false;
    if (tok.s === '::' && !p.s.endsWith(':')) return false;
    if (p.s === '::' && !tok.s.startsWith(':')) return false;
    if (p.t === 'punct' && (p.s === '(' || p.s === '.')) return false;
    if (tok.t === 'punct' && tok.s === '(') {
      return !(p.t === 'word' && (p.fn || !p.kw)) && p.t !== 'quoted' && p.s !== ']' ? !(p.t === 'punct' && p.s === ')') : false;
    }
    return true;
  };
  const put = (tok, text) => {
    if (forceBreak) {
      forceBreak = false;
      newline(pendingBreak !== null ? pendingBreak : lineLevel);
      pendingBreak = null;
    } else if (pendingBreak !== null) {
      newline(pendingBreak);
      pendingBreak = null;
    }
    const space = needsSpace(tok);
    cur += (space ? ' ' : '') + text;
    atLineStart = false;
    prev = tok;
    tok.printed = true;
  };
  const breakLine = (level) => {
    forceBreak = false;
    pendingBreak = null;
    newline(level);
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.t === 'line-comment') {
      put(tok, tok.s);
      forceBreak = true;
      continue;
    }
    if (tok.t === 'comment') {
      put(tok, tok.s);
      continue;
    }
    if (tok.t === 'punct' && tok.s === '(') {
      const next = wordAt(i + 1);
      if (!scope.inline && (next === 'SELECT' || next === 'WITH')) {
        put(tok, '(');
        stack.push(scope);
        scope = { base: lineLevel + 1, closeAt: lineLevel, clause: null, inline: false, caseDepth: 0, sub: true };
        pendingBreak = scope.base;
      } else {
        put(tok, '(');
        stack.push(scope);
        scope = { base: scope.base, clause: null, inline: true, caseDepth: 0 };
      }
      stmtStart = false;
      continue;
    }
    if (tok.t === 'punct' && tok.s === ')') {
      if (stack.length > 0) {
        const closeAt = scope.sub ? scope.closeAt : null;
        scope = stack.pop();
        if (closeAt !== null) breakLine(closeAt);
      }
      put(tok, ')');
      continue;
    }
    if (tok.t === 'punct' && tok.s === ';') {
      put(tok, ';');
      lines.push(cur.replace(/\s+$/, ''));
      lines.push('');
      cur = '';
      atLineStart = true;
      prev = null;
      stmtStart = true;
      scope = { base: 0, clause: null, inline: false, caseDepth: 0 };
      stack.length = 0;
      pendingBreak = null;
      forceBreak = false;
      betweenPending = false;
      continue;
    }
    if (tok.t === 'punct' && tok.s === ',') {
      put(tok, ',');
      if (!scope.inline) {
        if (scope.clause === 'list') pendingBreak = scope.base + 1;
        else if (scope.clause === 'with') pendingBreak = scope.base;
      }
      continue;
    }
    if (tok.t !== 'word') {
      put(tok, tok.s);
      stmtStart = false;
      continue;
    }

    // A word.
    const afterDot = prev && prev.t === 'punct' && prev.s === '.';
    const beforeDot = tokens[i + 1] && tokens[i + 1].t === 'punct' && tokens[i + 1].s === '.';
    const up = tok.s.toUpperCase();
    const low = tok.s.toLowerCase();
    const nextIsParen = tokens[i + 1] && tokens[i + 1].t === 'punct' && tokens[i + 1].s === '(';
    const plain = !afterDot && !beforeDot;
    tok.kw = plain && KEYWORDS.has(low);
    tok.fn = plain && nextIsParen && FUNCTIONS.has(low);
    const shown = tok.kw || tok.fn ? up : tok.s;

    if (plain && !scope.inline) {
      // Multi-word clause starters.
      let phrase = null;
      let take = 1;
      const w1 = wordAt(i + 1);
      const w2 = wordAt(i + 2);
      if ((up === 'GROUP' || up === 'ORDER') && w1 === 'BY') { phrase = `${up} BY`; take = 2; }
      else if (up === 'INSERT' && w1 === 'INTO' && stmtStart) { phrase = 'INSERT INTO'; take = 2; }
      else if (up === 'DELETE' && w1 === 'FROM' && stmtStart) { phrase = 'DELETE FROM'; take = 2; }
      else if (up === 'UNION' && w1 === 'ALL') { phrase = 'UNION ALL'; take = 2; }
      else if (up === 'JOIN') { phrase = 'JOIN'; }
      else if (JOIN_WORDS.has(up)) {
        let k = i;
        const parts = [];
        while (wordAt(k) && JOIN_WORDS.has(wordAt(k)) && k < i + 3) { parts.push(wordAt(k)); k += 1; }
        if (wordAt(k) === 'JOIN') { phrase = parts.concat('JOIN').join(' '); take = parts.length + 1; }
      } else if (up === 'UPDATE' && !stmtStart) phrase = null;
      else if (LIST_CLAUSES.has(up) || CLAUSES.has(up)) phrase = up;
      if (phrase === 'UPDATE' && !stmtStart) phrase = null;

      if (phrase !== null && !(phrase === 'SET' && false)) {
        const isList = LIST_CLAUSES.has(phrase);
        const isJoin = /JOIN$/.test(phrase);
        breakLine(scope.base);
        const pieces = [];
        for (let k = 0; k < take; k += 1) pieces.push(k === 0 ? phrase.split(' ')[0] : '');
        put(tok, phrase);
        i += take - 1;
        scope.clause = isList ? 'list' : phrase === 'WITH' ? 'with' : 'other';
        if (isJoin) scope.clause = 'other';
        if (isList) {
          const nx = wordAt(i + 1);
          if (phrase === 'SELECT' && (nx === 'DISTINCT' || nx === 'ALL')) {
            // DISTINCT stays on the SELECT line; the break follows it.
            const dt = tokens[i + 1];
            dt.kw = true;
            put(dt, nx);
            i += 1;
          }
          if (hasTopComma(tokens, i)) pendingBreak = scope.base + 1;
          else scope.clause = 'other';
        }
        stmtStart = false;
        betweenPending = false;
        continue;
      }
      if ((up === 'AND' || up === 'OR') && scope.caseDepth === 0) {
        if (up === 'AND' && betweenPending) {
          betweenPending = false;
        } else if (scope.clause === 'other') {
          breakLine(scope.base + 1);
        }
      } else if (up === 'ON' && scope.clause === 'other') {
        breakLine(scope.base + 1);
      }
    }
    if (plain) {
      if (up === 'BETWEEN') betweenPending = true;
      else if (up === 'CASE') scope.caseDepth += 1;
      else if (up === 'END' && scope.caseDepth > 0) scope.caseDepth -= 1;
    }
    put(tok, shown);
    stmtStart = false;
  }
  if (cur.trim() !== '' || lines.length === 0) lines.push(cur.replace(/\s+$/, ''));
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

// ---- commands ----------------------------------------------------------

function run(transform, done) {
  return () => {
    const sel = kanso.editor.selection();
    if (!sel || sel.text.trim() === '') return { text: 'Select some text first.' };
    let result;
    try {
      result = transform(sel.text);
    } catch (e) {
      return { text: `Could not format the text: ${e && e.message ? e.message : e}` };
    }
    if (typeof result === 'string') result = { text: result };
    if (result.error) return { text: result.error };
    if (result.text === sel.text) return { text: 'Already formatted.' };
    try {
      kanso.editor.replaceSelection({ text: result.text, selection: { start: sel.start, end: sel.end } });
    } catch (e) {
      if (e && e.code === 'conflict') return { text: 'The selection moved. Select the text again and rerun the command.' };
      return { text: `Could not change the text: ${e && e.message ? e.message : e}` };
    }
    return { text: done };
  };
}

kanso.commands.register({
  id: 'json-pretty',
  title: 'Pretty-print JSON',
  keywords: ['json', 'format', 'indent', 'beautify'],
  when: 'selection',
  run: run((t) => prettyJson(t, 2), 'JSON pretty-printed.'),
});
kanso.commands.register({
  id: 'json-minify',
  title: 'Minify JSON',
  keywords: ['json', 'compact', 'compress'],
  when: 'selection',
  run: run(minifyJson, 'JSON minified.'),
});
kanso.commands.register({
  id: 'sql-format',
  title: 'Format SQL',
  keywords: ['sql', 'query', 'beautify', 'format'],
  when: 'selection',
  run: run(formatSql, 'SQL formatted.'),
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { prettyJson, minifyJson, checkJson, formatSql, tokenizeSql, locate };
}
