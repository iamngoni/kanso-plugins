# Board diagrams

Two fences: `chess` draws a position, `go` draws a Go board.

## Chess

A FEN position, one line. Only the piece placement is needed; the side to
move (`w` or `b`) is shown under the board when given.

````
```chess
rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w
highlight: e2 e4
```
````

Optional lines: `flip: true` (Black at the bottom), `coords: false`,
`highlight: e2 e4` (up to 16 squares), `caption: some text`. Pieces are
Unicode chess glyphs, so they depend on a system font that has them.

## Go

Either a list of moves or a simple SGF. Stones are captured as they would be
in play; a suicide is removed. The last move is marked.

````
```go
size: 9
B D4  W F6  B pass  W E5
```
````

- Moves: `D4` (columns A to T without I, row 1 at the bottom). Colors
  alternate from Black, or write `B D4`, `W F6`, `bD4`, `B[dd]`. `pass` skips.
- SGF: `(;SZ[9]AB[cc][dd]AW[ee];B[ff];W[gg])`. Reads `SZ`, `AB`, `AW`
  (including `aa:cc` rectangles), `B` and `W`. Everything else, such as
  variations and comments, is ignored.
- Options: `size: 5` to `19` (default 19), `coords: false`, `caption: text`.
- Up to 400 moves.

Bad input shows a message saying what is wrong, for example a rank that does
not add up to 8 squares or a point off the board.

## Permissions

| Permission | Why |
|---|---|
| `fences: [{ "language": "chess" }, { "language": "go" }]` | To draw `chess` and `go` blocks. Nothing else: no notes, no network, no commands. |

## Tests

`node --test` from this folder, including randomized input for both fences.
