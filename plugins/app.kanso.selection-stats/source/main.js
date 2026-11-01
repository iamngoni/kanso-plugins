// Selection stats: words, characters, lines, sentences and reading time of
// the selected text, shown in a notification. It only reads the selection.

const WORDS_PER_MINUTE = 230;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORD = /[\p{L}\p{N}\p{M}]+(?:['’_.,-][\p{L}\p{N}\p{M}]+)*/gu;

// Each run of letters or digits (with inner apostrophes, hyphens and
// decimal points) is one word, and each Han or kana character is one.
function countWords(text) {
  let n = 0;
  for (const m of text.matchAll(WORD)) {
    const w = m[0];
    if (CJK.test(w)) {
      let run = false;
      for (const ch of w) {
        if (CJK.test(ch)) {
          n += 1;
          run = false;
        } else if (!run) {
          n += 1;
          run = true;
        }
      }
    } else {
      n += 1;
    }
  }
  return n;
}

// A sentence ends at . ! ? (or their full-width forms) followed by a space,
// a closing quote or bracket, or the end; text left over after the last
// ending that has a word in it counts as one more.
function countSentences(text) {
  const ends = /[.!?…。！？]+["'”’)\]]*(?=\s|$)|[。！？]/gu;
  let n = 0;
  let last = 0;
  for (const m of text.matchAll(ends)) {
    if (countWords(text.slice(last, m.index)) > 0) n += 1;
    last = m.index + m[0].length;
  }
  if (countWords(text.slice(last)) > 0) n += 1;
  return n;
}

function countLines(text) {
  if (text === '') return { lines: 0, nonEmpty: 0 };
  const lines = text.replace(/(\r\n|\n|\r)$/, '').split(/\r\n|\n|\r/);
  return { lines: lines.length, nonEmpty: lines.filter((l) => l.trim() !== '').length };
}

function readingMinutes(words) {
  return words / WORDS_PER_MINUTE;
}

function readingTime(words) {
  if (words === 0) return '0 min';
  const minutes = readingMinutes(words);
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} sec`;
  return `${Math.round(minutes)} min`;
}

function stats(text) {
  const chars = Array.from(text);
  const words = countWords(text);
  const l = countLines(text);
  return {
    words,
    characters: chars.length,
    charactersNoSpaces: chars.filter((c) => !/\s/.test(c)).length,
    lines: l.lines,
    nonEmptyLines: l.nonEmpty,
    sentences: countSentences(text),
    reading: readingTime(words),
  };
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function describe(s) {
  return [
    plural(s.words, 'word', 'words'),
    `${plural(s.characters, 'character', 'characters')} (${s.charactersNoSpaces} without spaces)`,
    plural(s.lines, 'line', 'lines'),
    plural(s.sentences, 'sentence', 'sentences'),
    `Reading time: ${s.reading}`,
  ].join('\n');
}

kanso.commands.register({
  id: 'stats',
  title: 'Selection statistics (words, characters, reading time)',
  keywords: ['count', 'words', 'characters', 'reading time', 'length', 'sentences', 'lines'],
  when: 'selection',
  run: () => {
    const sel = kanso.editor.selection();
    if (!sel || sel.text === '') return { text: 'Select some text first.' };
    return { text: describe(stats(sel.text)) };
  },
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { stats, describe, countWords, countSentences, countLines, readingTime };
}
