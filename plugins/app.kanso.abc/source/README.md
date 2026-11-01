# ABC music notation

Draws an `abc` fenced block as a treble-clef staff.

````
```abc
X:1
T:Ode to Joy
C:Beethoven
M:4/4
L:1/4
Q:1/4=100
K:D
F F G A | A G F E | D D E F | F3/2 E/ E2 |]
```
````

## What is supported

- Header fields: `X:` (a number), `T:` title, `C:` composer, `M:` meter
  (`4/4`, `6/8`, `C`, `C|`, `none`), `L:` unit note length, `Q:` tempo (shown
  as text), `K:` key. `K:` ends the header and is required. Without `L:` the
  unit is 1/8, or 1/16 when the meter is under 3/4.
- Keys: a tonic with optional `#` or `b` and a mode (`m`, `min`, `maj`, `dor`,
  `phr`, `lyd`, `mix`, `loc`, `aeo`, `ion`), up to 7 sharps or flats. The key
  signature is drawn.
- Notes `C D E F G A B` (octave from middle C) and `c d e f g a b` (an octave
  up), with `'` up and `,` down. Accidentals `^ ^^ _ __ =` are drawn exactly as
  written; the key signature is not applied to the drawing of accidentals.
- Lengths: `C2`, `C/2`, `C/`, `C3/2`, plus broken rhythm `>` and `<`.
- Rests `z`, invisible rests `x`, whole-bar rests `Z`; ties with `-`.
- Chords `[CEG]2` (the length after the bracket).
- Bar lines `|`, `||`, `|]`, `|:`, `:|`, `::`. Ending numbers (`|1`, `:|2`)
  are accepted but not drawn.
- Accepted and ignored: comments (`%`), chord symbols (`"Am"`), decorations
  (`!f!`), slurs `( )`, tuplet markers such as `(3` (notes keep written
  lengths), `.` and `~`, and `w:` lyric lines.

Not supported: multiple voices, other clefs, beams (flags are drawn), grace
notes, repeats expansion, lyrics display. Anything unsupported shows an error
with the line number. At most 600 notes, rests and bars. Long tunes wrap onto
extra staves.

## Permissions

| Permission | Why |
|---|---|
| `fences: [{ "language": "abc" }]` | To draw `abc` blocks. Nothing else: no notes, no network, no commands. |

## Tests

`node --test` from this folder, including randomized input.
