# QR code

Draws the text of a `qr` fenced block as a QR code you can scan.

````
```qr
https://kanso.app
```
````

The whole block is encoded as written (trailing newlines are dropped).

## What it supports

- Byte mode, UTF-8 text, error correction level M (about 15% recovery).
- Versions 1 to 10, chosen automatically: up to 213 bytes of UTF-8.
- Reed-Solomon codes, block interleaving and all eight masks, picked by the
  standard penalty score. The encoder is written out in `main.js`; it uses no
  library.
- Dark modules on a light ground, in the theme's own colors. In dark mode the
  code stays dark-on-light so phones can still scan it.

Text that is empty or longer than 213 bytes shows an error with the limit.

## Permissions

| Permission | Why |
|---|---|
| `fences: [{ "language": "qr" }]` | To draw `qr` blocks. Nothing else: no notes, no network, no commands. |

## Tests

`node --test` from this folder. They check Reed-Solomon, format and version
words, and the full module matrix against vectors from an independent encoder
(versions 1 to 10), plus randomized inputs.
