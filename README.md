<div align="center">
  <img width="2500" alt="image" src="https://github.com/user-attachments/assets/861f4ae3-154a-478d-91e4-d5d8d4d567b3" />
</div>

# Derakuma
<small>(*not to be confused with Derakkuma from maimai*)</small>

A lightweight FontoBene stroke-font parser for TypeScript — works in browsers, Node.js, Bun, Deno, and edge runtimes. The FontoBene engine behind CompassCAD NEXT. Named after **Derakkuma** from maimai.

## Installation

```sh
npm i derakuma
# or
bun add derakuma
```

## Quick Start

### In-memory / synchronous parse (fastest, no async)

If you already have the `.bene` file content as a string (e.g. from a Vite `?raw` import, a WebWorker payload, or any custom loader):

```ts
import { Derakuma } from 'derakuma';

const font = Derakuma.parse(rawBeneString);
const cmds = font.getGlyph('A');
// Returns an array of PD (pen down), MP (move pen), and PU (pen up) commands.
```

### Load from a URL (browser / Node 18+ / Bun / Deno)

```ts
import { Derakuma } from 'derakuma';

const font = await Derakuma.loadFontFromUrl('https://example.com/fonts/newstroke.bene');
const cmds = font.getGlyph('A');
```

### Load from the file system (Node / Bun only)

```ts
import { Derakuma } from 'derakuma';

const font = await Derakuma.loadFontFromFile('./fonts/newstroke.bene');

// Fonts encoded in UTF-16 LE (e.g. OpenGOST):
const font16 = await Derakuma.loadFontFromFile('./fonts/opengost.bene', 'utf-16le');
```

### CommonJS (Node.js legacy)

```js
const { Derakuma } = require('derakuma');

async function main() {
    const font = await Derakuma.loadFontFromFile('./fonts/newstroke.bene');
    console.log(font.getGlyph('A'));
}
main();
```

## API Overview

### `font.getGlyph(char)` → `PenCommand[]`

Returns a sequence of drawing commands for one character. Command types:
- `PD` – Pen Down: begin a stroke at `(x, y)`.
- `MP` – Move Pen: continue the stroke to `(x, y)`.
- `PU` – Pen Up: lift the pen after finishing a stroke.

```ts
const cmds = font.getGlyph('A');
// → [{ command: 'PD', x: 0, y: 0 }, { command: 'MP', x: 3, y: 9 }, ...]
```

### Multi-line text layout

```ts
const layout = font.layoutText('Hello\nWorld!', {
    lineHeight: 1.5,
    align: 'center',  // 'left' | 'center' | 'right'
    letterSpacing: 1,
});
// → Array<{ char, x, y, commands: PenCommand[] }>
```

### SVG path output

```ts
const d = font.renderToSvg('Hello World');
// → 'M 0.86 2.57 L 5.14 2.57 M 0 0 L 3 9 ...'
// Use as <path d={d} fill="none" stroke="black" />
```

### HTML5 Canvas rendering

```ts
font.renderToCanvas(ctx, 'Hello', { x: 10, y: 50, strokeStyle: '#000' });
```

### Flat polylines (WebGL / Three.js / G-code / CNC)

```ts
const polylines = font.toPolylines('Hi');
// → [ [ [0, 0], [3, 9], [6, 0] ], ... ]
```

### Text metrics

```ts
const { width, height } = font.measureText('Hello\nWorld!');
```

### Glyph lookup variants

```ts
font.getGlyphByChar('A');          // by single character
font.getGlyphByCode('U+0041');     // by explicit codepoint prefix
font.getGlyphByCode(0x0041);       // by numeric codepoint
font.hasGlyph('A');                // boolean presence check
font.listGlyphs();                 // all codepoint keys in the font
```

## Sub-path Imports (tree-shakeable)

```ts
import { parseBene }          from 'derakuma/core/parser';
import { DerakumaFont }       from 'derakuma/core/font';
import { flattenArc }         from 'derakuma/geometry/arc';
import { loadFontFromUrl }    from 'derakuma/loaders/web';
import { loadFontFromFile }   from 'derakuma/loaders/node';
import { DerakumaLoadError }  from 'derakuma/errors';
```

## Browser `<script>` / CDN

```html
<script src="https://unpkg.com/derakuma/dist/web.global.js"></script>
<script>
  Derakuma.loadFontFromUrl('https://example.com/font.bene').then(font => {
    console.log(font.getGlyph('A'));
  });
</script>
```

## Building

```sh
bun run build      # compile JS bundles (ESM + CJS) + TypeScript declarations
bun run typecheck  # run tsc --noEmit
bun run test       # run vitest
```

# License
MIT
