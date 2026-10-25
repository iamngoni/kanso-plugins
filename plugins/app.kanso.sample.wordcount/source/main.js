// Word count: a command that counts the open note's words, one that adds
// the count after the selection, and a panel of the notes most recently
// changed in the notebooks it was given.

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function counted(text) {
  const n = words(text);
  return `${n} ${n === 1 ? 'word' : 'words'}`;
}

kanso.commands.register({
  id: 'count-words',
  title: 'Count words',
  keywords: ['words', 'length'],
  when: 'note-open',
  run: () => {
    const id = kanso.editor.noteId();
    if (id === null) return { text: 'No note is open.' };
    const note = kanso.notes.get(id);
    return { text: counted(note.body) };
  },
});

kanso.commands.register({
  id: 'append-count',
  title: 'Add the word count after the selection',
  when: 'selection',
  run: () => {
    const selection = kanso.editor.selection();
    if (selection === null) return { text: 'Nothing is selected.' };
    kanso.editor.replaceSelection({
      text: `${selection.text} (${counted(selection.text)})`,
      selection: { start: selection.start, end: selection.end },
    });
    return null;
  },
});

// One list call: a plugin makes at most 60 calls a minute, so it reads
// summaries (no bodies) rather than every note.
function show() {
  const page = kanso.notes.list({ limit: 20 });
  const rows = page.notes.map((note) => ({
    type: 'row',
    gap: 8,
    children: [
      { type: 'text', value: note.title || 'Untitled' },
      { type: 'badge', value: note.status },
    ],
  }));
  kanso.ui.panel({
    type: 'column',
    gap: 12,
    children: [
      { type: 'heading', value: 'Recently changed' },
      rows.length ? { type: 'list', items: rows } : { type: 'text', value: 'No notes it may read.', style: 'muted' },
      { type: 'button', id: 'refresh', label: 'Look again' },
    ],
  });
}

kanso.commands.register({
  id: 'recent-notes',
  title: 'Show recently changed notes',
  run: () => {
    show();
    return null;
  },
});
kanso.ui.onPress('refresh', () => {
  show();
  return null;
});
