// Bar chart: draws a ```barchart block of `label: value` lines as SVG, in
// the theme's colors. A renderer can call nothing; it gets the block's text
// and the theme, and returns SVG.

function escape(text) {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

kanso.fences.register('barchart', ({ source, theme }) => {
  const bars = source
    .split('\n')
    .map((line) => line.split(':'))
    .filter((parts) => parts.length === 2 && !isNaN(parseFloat(parts[1])))
    .map(([label, value]) => ({ label: label.trim(), value: parseFloat(value) }));
  if (bars.length === 0) throw new Error('Write one "label: number" per line.');
  const max = Math.max(...bars.map((b) => b.value), 1);
  const row = 28;
  const width = 480;
  const labels = 120;
  const height = bars.length * row + 8;
  const shapes = bars.map((bar, i) => {
    const y = i * row + 4;
    const w = Math.max(1, ((width - labels - 48) * bar.value) / max);
    return (
      `<text x="${labels - 8}" y="${y + 17}" text-anchor="end" font-size="13" fill="${theme.text}">${escape(bar.label)}</text>` +
      `<rect x="${labels}" y="${y + 4}" width="${w}" height="${row - 10}" rx="3" fill="${theme.accent}"/>` +
      `<text x="${labels + w + 6}" y="${y + 17}" font-size="12" fill="${theme.muted}">${bar.value}</text>`
    );
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes.join('')}</svg>`;
});
