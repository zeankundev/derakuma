<div align="center">
  <img width="2500" alt="image" src="https://github.com/user-attachments/assets/861f4ae3-154a-478d-91e4-d5d8d4d567b3" />
</div>

# Derakuma
<small>(*not to be confused with Derakkuma from maimai*)</small>

A small Fontobene parser for web apps requiring vector fonts, written in Typescript. The Fontobene engine behind CompassCAD NEXT. Named after **Derakkuma** from maimai. Try it out, online, [here.](https://codesandbox.io/p/sandbox/bold-rhodes-kpwhzc)

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

If you want a more in-depth coverage on how to implement, refer to the [Getting Started](https://github.com/zeankundev/derakuma/wiki/Getting-started) page on the wiki. For an even more in-depth coverage, including documentation of all the interfaces, types and functions, refer to the [List of Functions](https://github.com/zeankundev/derakuma/wiki/Lists-of-available-functions) (for advanced users)

# License
MIT
