<div align="center">
  <img width="2500" alt="image" src="https://github.com/user-attachments/assets/861f4ae3-154a-478d-91e4-d5d8d4d567b3" />
</div>

# Derakuma

A lightweight FontoBene stroke-font parser for TypeScript — works in browsers, Node.js, Bun, Deno, and edge runtimes. Named after **Derakkuma** from maimai.

## Installation

```sh
npm i derakuma
# or
bun add derakuma
```

## Usage

Derakuma is now easier to use! Just:

```js
const { loadFontFromFile } = require('derakuma/loaders/node');
const myFont = loadFontFromFile('./myfont.bene');
myFont.getGlyph('a');
```

## License

MIT
