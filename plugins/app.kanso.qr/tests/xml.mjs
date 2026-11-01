// A small well-formedness check for the SVG a renderer returns: tags nest and
// close, attributes are quoted, and no stray "<" or "&" appears in text or
// attribute values.
export function assertWellFormed(svg) {
  if (typeof svg !== 'string') throw new Error('SVG is not a string');
  if (svg.length > 512 * 1024) throw new Error('SVG is over 512 KB');
  const stack = [];
  let i = 0;
  let rootClosed = false;
  const checkText = (text) => {
    if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(text)) throw new Error('Unescaped & in: ' + text.slice(0, 40));
    if (text.includes('<')) throw new Error('Stray < in text');
  };
  while (i < svg.length) {
    const lt = svg.indexOf('<', i);
    if (lt === -1) {
      checkText(svg.slice(i));
      break;
    }
    const text = svg.slice(i, lt);
    checkText(text);
    if (rootClosed && text.trim()) throw new Error('Text after root');
    const m = /^<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/.exec(svg.slice(lt));
    if (!m) throw new Error('Bad tag at ' + lt + ': ' + svg.slice(lt, lt + 60));
    const [whole, close, name, attrs, selfClose] = m;
    checkText(attrs);
    if (close) {
      if (stack.pop() !== name) throw new Error('Mismatched </' + name + '>');
      if (stack.length === 0) rootClosed = true;
    } else if (!selfClose) stack.push(name);
    else if (stack.length === 0) rootClosed = true;
    i = lt + whole.length;
  }
  if (stack.length) throw new Error('Unclosed <' + stack[stack.length - 1] + '>');
  if (!rootClosed || !svg.startsWith('<svg')) throw new Error('Not a single <svg> document');
}

export const THEMES = [
  { dark: false, background: '#ffffff', text: '#111111', muted: '#777777', accent: '#3366ff', border: '#cccccc', surface: '#f4f4f4' },
  { dark: true, background: '#101010', text: '#eeeeee', muted: '#888888', accent: '#6699ff', border: '#333333', surface: '#1c1c1c' },
];

// Every color in the SVG must be one of the theme's.
export function assertThemeColors(svg, theme) {
  const allowed = new Set(Object.values(theme).filter((v) => typeof v === 'string'));
  for (const m of svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,8})"/g)) {
    if (!allowed.has(m[1])) throw new Error('Color outside the theme: ' + m[1]);
  }
}

// Seeded random numbers, so a failure can be replayed.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
