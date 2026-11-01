// Shared test helpers: load a plugin's main.js under Node with a stub `kanso`
// global, check SVG well-formedness, and a seeded random generator.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const THEME = {
  dark: false,
  background: '#ffffff',
  text: '#111111',
  muted: '#777777',
  accent: '#3366cc',
  border: '#dddddd',
  surface: '#f5f5f5',
};

export function loadPlugin(testUrl, language) {
  const dir = join(dirname(fileURLToPath(testUrl)), '..', 'source');
  const src = readFileSync(join(dir, 'main.js'), 'utf8');
  const registered = {};
  const kanso = { fences: { register: (lang, fn) => { registered[lang] = fn; } } };
  new Function('kanso', src)(kanso);
  if (typeof registered[language] !== 'function') throw new Error('renderer not registered');
  return { render: registered[language], registered, src };
}

// Minimal XML checker: balanced tags, quoted attributes, no raw `<` or
// stray `&` in text or attribute values, a single `svg` root.
export function checkXml(s) {
  if (typeof s !== 'string') throw new Error('not a string');
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/y;
  const text = /[^<>]+/y;
  const badAmp = /&(?!(?:amp|lt|gt|quot|#39|#\d+);)/;
  const stack = [];
  let i = 0;
  let roots = 0;
  while (i < s.length) {
    if (s[i] === '<') {
      tag.lastIndex = i;
      const m = tag.exec(s);
      if (!m) throw new Error('bad markup at ' + i + ': ' + s.slice(i, i + 60));
      if (badAmp.test(m[3])) throw new Error('bad entity in attribute at ' + i);
      if (m[1]) {
        if (stack.pop() !== m[2]) throw new Error('unbalanced </' + m[2] + '>');
      } else {
        if (stack.length === 0) roots++;
        if (!m[4]) stack.push(m[2]);
      }
      i = tag.lastIndex;
    } else {
      text.lastIndex = i;
      const m = text.exec(s);
      if (!m) throw new Error('raw ">" at ' + i);
      if (badAmp.test(m[0])) throw new Error('bad entity in text at ' + i);
      if (stack.length === 0 && m[0].trim()) throw new Error('text outside root');
      i = text.lastIndex;
    }
  }
  if (stack.length) throw new Error('unclosed ' + stack.join(','));
  if (roots !== 1) throw new Error('expected one root, got ' + roots);
  if (!s.startsWith('<svg ')) throw new Error('root is not svg');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s)) throw new Error('control character in output');
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)) throw new Error('lone surrogate');
}

export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }

// Renders `source`; it must either return well-formed SVG that uses only
// theme colours, or throw a plain Error with a message.
export function assertSafe(render, source) {
  let out;
  try {
    out = render({ source, theme: THEME });
  } catch (e) {
    if (!(e instanceof Error) || e.constructor !== Error || !e.message) {
      throw new Error('non-Error or unclear failure for ' + JSON.stringify(source) + ': ' + (e && e.stack || e));
    }
    return null;
  }
  checkXml(out);
  if (out.length > 512 * 1024) throw new Error('svg too large');
  const allowed = new Set(Object.values(THEME).filter((v) => typeof v === 'string'));
  for (const c of out.match(/#[0-9a-fA-F]{3,8}\b/g) || []) {
    if (!allowed.has(c.toLowerCase())) throw new Error('colour outside the theme: ' + c);
  }
  const w = /width="([\d.]+)" height="([\d.]+)"/.exec(out);
  if (!w || +w[1] > 8192 || +w[2] > 8192 || +w[1] < 1 || +w[2] < 1) throw new Error('bad size');
  return out;
}
