# Cite

Turns a DOI into a formatted citation using Crossref, and builds a
bibliography from every DOI in a note. No account or token is needed.

## Setup

1. Run **Cite settings (APA, MLA or BibTeX)**, pick a style and press Save.
   The default is APA.
2. When installing, allow the plugin to read and change the notebooks you
   write papers in (the bibliography command edits the open note).

## Use

- **Cite the DOI in the selection** replaces each DOI (or `doi.org` link) in
  the selection with its citation. In APA and MLA the citation replaces the
  DOI in place; in BibTeX the selection is kept and a fenced `bibtex` block is
  added after it.

  `10.1038/nature14539` becomes, in APA: `LeCun, Y., Bengio, Y., & Hinton, G.
  (2015). Deep learning. *Nature*, *521*(7553), 436-444.
  <https://doi.org/10.1038/nature14539>`.
- **Build a bibliography from the DOIs in this note** finds every DOI, looks
  each up once (answers are cached, so repeats cost nothing), and writes a
  `## Bibliography` section at the end, sorted by first author. Run it again
  and the same section is rewritten in place, never doubled, and DOIs inside
  the section are not read back. A run looks up at most 8 new DOIs; with more
  it says **run it again to continue** and leaves the note untouched until all
  are known. DOIs Crossref does not know are listed in the message.

Crossref 429 or other errors are reported with when to retry, and nothing is
changed. Changes to the note wait for your review unless you turned off
**Ask before changing notes**.

## Why each permission

| Permission | Why |
|---|---|
| `commands`, `ui: panel` | The commands and the style panel |
| `editor: selection.read`, `selection.replace` | To read the DOI and put the citation in its place |
| `editor: note.read`, `notes.read` | To read the open note for the bibliography |
| `notes.write` | To write the bibliography section |
| `network: api.crossref.org` | `https://api.crossref.org/works/<doi>`, the only host used |

DOIs you cite are sent to Crossref.
