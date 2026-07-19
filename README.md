<div align="center">
  <img width="2500" alt="image" src="https://github.com/user-attachments/assets/861f4ae3-154a-478d-91e4-d5d8d4d567b3" />
</div>

# Derakuma
<small>(*not to be confused with Derakkuma from maimai*)</small>

A small Fontobene parser for web apps requiring vector fonts, written in Typescript. The Fontobene engine behind CompassCAD NEXT. Named after **Derakkuma** :)

## How to use?
Using it is just as simple as one, two, three! Just:
```
npm i derakuma
```
and:
```js
const { DerakumaParser } = require('derakuma');
const font = new DerakumaParser('/path/to.bene');
font.getGlyph('a');
// Should return a series of PD, MV and PU. Those will be your drawing commands!
```
Or a more practical example, with Canvas2D!
```js
const { DerakumaParser } = require('derakuma');
const font = new DerakumaParser('/path/to.bene');
const glyph = font.getGlyph('a');

// Assuming you're in Electron
const ctx = document.getElementById('canvas').getContext('2d');
const startX = 100;
const startY = 100;
const scale = 2;

ctx.beginPath();
for (const cmd of glyph) {
  const drawX = startX + (cmd.x * scale);
  const drawY = startY - (cmd.y * scale);
  if (cmd.command === 'PD') {
    ctx.moveTo(drawX, drawY);
  } else if (cmd.command === 'MP') {
    ctx.lineTo(drawX, drawY);
  } else if (cmd.command === 'PU') {
    ctx.moveTo(drawX, drawY);
  }
}
```

# A (more) detailed documentation
`derakuma` has two exports, `DerakumaParser` and `FontLoadMethod`. `DerakumaParser` is the parser itself, whereas `FontLoadMethod` is the loading method you want Derakuma to use to load your .bene files.
- `FontLoadMethod.FETCH`: Loads your .bene files externally (via a server or HTTP)
- `FontLoadMethod.FILE`: Loads your .bene files internally, in your filesystem.

## Functions
- `new DerakumaParser(source: string, loadMethod: FontLoadMethod)`: Instantiates a new Derakuma parser instance. `source` is required, as it is the path on where your .bene files are provided. `loadMethod` is optional (defaults to `FontLoadMethod.FETCH`), but be sure to change that setting when you have a different approach of loading the file.
- `DerakumaParser.ready()`: Returns a Promise to tell you that the parser has finished parsing.
- `DerakumaParser.getGlyph(character: string | number)`: Returns a `PenCommand[]` in which all of the drawing instructions are plotted. You can use this with `for` loops, as they are the commands you can translate into a variety of drawing outputs (e.g. Canvas2D, WebGL, etc). **`character` doesn't always have to be a string, you can only put a single character, or its corresponding Unicode (e.g. `U+0041`, you would only put in `0041`).**
- `DerakumaParser.getGlyphData(character: string | number)`: Returns a `Glyph` object, which contains information about a specific glyph, as well as its drawing instructions.
- `DerakumaParser.getAdvance(character: string | number)`: Returns a `Number` to specify the end margin on the character (padding) on the very right of the character.
- `DerakumaParser.getSentenceCommand(text: string)`: Returns `Array<{ char: string; x: number; commands: PenCommand[] }>`, in which entire sentences can be properly plotted into the output. This is a combination of `getGlyph` and `getAdvance`, and this should be a shortcut if finding a combination of the two feels tedious.


# License
MIT
