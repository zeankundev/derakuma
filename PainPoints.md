# Derakuma: Developer Experience (DX) Analysis & Action Plan

## Executive Summary

**Derakuma** is a lightweight, specialized TypeScript library designed to parse and extract vector glyph geometries from **FontoBene** (`.bene`) stroke fonts for CAD, CAM, CNC, and web applications.

While the core vector font parsing and arc linearization concepts are solid, the library currently faces several critical **Developer Experience (DX)** bottlenecks. These range from **broken getting-started code and hazardous asynchronous constructor patterns** to **95% code duplication across separate builds**, **broken CommonJS module imports**, **an active test failure on encoding**, and **missing high-level rendering helpers (Canvas/SVG)**.

This document provides a comprehensive, deep-dive analysis of all DX pain points across the entire codebase, followed by prioritized, actionable checklists to transform Derakuma into a modern, robust, and delightful library for developers.

---

## Table of Contents

1. [Detailed Pain Point Analysis](#detailed-pain-point-analysis)
   - [1. API Design, Ergonomics & Async Lifecycle](#1-api-design-ergonomics--async-lifecycle)
   - [2. Codebase Architecture & 95% Code Duplication](#2-codebase-architecture--95-code-duplication)
   - [3. Packaging, Distribution & Dual-Module (ESM/CJS) Hazards](#3-packaging-distribution--dual-module-esmcjs-hazards)
   - [4. Platform Compatibility, Encodings & Active Test Failure](#4-platform-compatibility-encodings--active-test-failure)
   - [5. FontoBene Spec Compliance & Geometry Edge Cases](#5-fontobene-spec-compliance--geometry-edge-cases)
   - [6. Error Handling, Diagnostics & Type Safety](#6-error-handling-diagnostics--type-safety)
   - [7. Documentation, Onboarding & README Inaccuracies](#7-documentation-onboarding--readme-inaccuracies)
   - [8. Test Suite Quality & Developer Tooling](#8-test-suite-quality--developer-tooling)
2. [Proposed Architecture & Modern API Blueprint](#proposed-architecture--modern-api-blueprint)
3. [Actionable Fix Checklists](#actionable-fix-checklists)
   - [Phase 1: Critical Bug Fixes & Quick Wins (Immediate)](#phase-1-critical-bug-fixes--quick-wins-immediate)
   - [Phase 2: Build System & Architecture Unification](#phase-2-build-system--architecture-unification)
   - [Phase 3: Modern API Design & High-Level Helpers](#phase-3-modern-api-design--high-level-helpers)
   - [Phase 4: Robust FontoBene Spec Handling & Encodings](#phase-4-robust-fontobene-spec-handling--encodings)
   - [Phase 5: Testing, Tooling & CI/CD Pipeline](#phase-5-testing-tooling--cicd-pipeline)

---

## Detailed Pain Point Analysis

### 1. API Design, Ergonomics & Async Lifecycle

#### 1.1 Constructor Side-Effects & Async Race Hazard
* **Current Implementation:** The `DerakumaParser` constructor initiates an unawaited asynchronous network `fetch()` by default when in browser/default mode.
* **The Problem:** 
  ```ts
  // User creates an instance:
  const font = new DerakumaParser('https://example.com/font.bene');
  // User immediately tries to query a glyph:
  font.getGlyph('A'); // THROWS: Error: "Derakuma is not initialized yet!"
  ```
  Constructors in JavaScript cannot be `async`. Initiating background I/O inside a constructor creates temporal coupling where instance methods throw runtime errors until an un-enforced promise (`font.ready()`) resolves.
* **Developer Impact:** High friction and frequent unhandled promise rejections / runtime crashes for developers expecting standard object instantiation or synchronous access.

#### 1.2 Lack of Synchronous / In-Memory Parsing (`fromString` / `fromBuffer`)
* **The Problem:** There is no public API to directly pass a `.bene` string or buffer that is already loaded in memory (e.g. from an `<input type="file">` upload, a Vite `?raw` string import, a WebWorker payload, or a custom Axios/network client).
* **Developer Impact:** Developers with in-memory data must either create mock Blob URLs or write awkward workarounds.

#### 1.3 Ambiguous Codepoint vs Character Resolution
* **The Problem in `convertToCodepointKey`:**
  ```ts
  } else if (/^[0-9A-Fa-f]{4,6}$/.test(input)) {
      // A literal hex codepoint string, e.g. "0041".
      return input.toUpperCase();
  }
  ```
  If a developer passes a 4-letter word or label like `"ABCD"`, `"BEEF"`, `"1234"`, or `"CAFE"`, the regex matches and treats the word as a single hexadecimal Unicode codepoint (e.g. U+ABCD, U+BEEF) rather than parsing the character `'A'`.
* **Developer Impact:** Non-deterministic, hard-to-debug behavior when processing multi-character identifiers.

#### 1.4 Primitive Sentence Layout & Missing Text Metrics
* **Current Implementation:** `getSentenceCommand(text)` only performs basic 1D horizontal accumulation for single-line text:
  - No newline (`\n` / `\r\n`) support: newlines trigger fallback glyph boxes and continue advancing horizontally rather than resetting X and advancing Y by `lineSpacing`.
  - No text alignment (left, center, right, justify).
  - No baseline or vertical alignment (top, middle, baseline, bottom).
  - No bounding box / text measurement API (`measureText(text)` returning `{ width, height, minX, maxX, minY, maxY }`).
* **Developer Impact:** Every developer building CAD labels, PCB text, or UI components has to rewrite multi-line layout, line breaking, and bounding box math from scratch.

#### 1.5 Missing High-Level Rendering Helpers (SVG, Canvas, Polyline)
* **The Problem:** The library only emits raw `PenCommand` items (`PD`, `PU`, `MP`). Most developers need:
  - SVG Path Data strings (`M ... L ... A ...` or `toSVGPath(text)`).
  - HTML5 Canvas 2D direct draw helpers (`font.draw(ctx, text, x, y, options)`).
  - Flat polyline coordinate arrays `[ [ [x, y], ... ] ]` for WebGL / Three.js / Paper.js / Maker.js / G-code / CNC toolpaths.
* **Developer Impact:** Unnecessary boilerplate code required in every consuming application just to render a line of text.

---

### 2. Codebase Architecture & 95% Code Duplication

#### 2.1 Complete Duplication Between `src/index.ts` and `src/web.ts`
* **Current State:**
  - `src/index.ts` is 471 lines.
  - `src/web.ts` is 444 lines.
  - Approximately 95% of the codebase (the parser, polyline parser, arc flattening, glyph resolution, missing glyph synthesis, header parsing, and layout methods) is copy-pasted verbatim between both files.
* **The Only Differences:**
  - `src/index.ts` dynamically creates a Node `createRequire` to read local files via `fs.readFileSync`.
  - `src/web.ts` excludes Node `fs` and appends an IIFE at the bottom to attach to `globalThis.Derakuma`.
* **Developer/Maintainer Impact:**
  - Any bug fix, optimization, or feature added to one file must be manually replicated in the other.
  - The two files will inevitably drift apart, introducing regressions and maintenance overhead.

#### 2.2 Monolithic Class Architecture
* All responsibilities (file I/O, network transport, string parsing, arc geometry calculation, glyph caching, text layout, and formatting) are bundled inside one large class.
* **Solution:** Separate into clean, modular components:
  - `core/parser.ts` (pure string/data parser, zero platform dependencies)
  - `core/font.ts` (the immutable parsed font model & query methods)
  - `geometry/arc.ts` (pure mathematical arc flattening & bezier utilities)
  - `layout/text.ts` (multi-line layout, alignment, and metrics)
  - `renderers/` (optional SVG path and Canvas 2D helpers)
  - `loaders/` (Node filesystem loader, browser fetch loader)

---

### 3. Packaging, Distribution & Dual-Module (ESM/CJS) Hazards

#### 3.1 Broken CommonJS Support (README vs `package.json`)
* **The Problem:** 
  The README explicitly instructs users to consume the package via CommonJS:
  ```js
  const { DerakumaParser } = require('derakuma');
  ```
  However, `package.json` specifies `"type": "module"` and `"main": "dist/index.js"`. Attempting to `require('derakuma')` in Node.js fails with:
  `ERR_REQUIRE_ESM: require() of ES Module ... not supported.`
* **Developer Impact:** Immediate blocker for Node.js developers using CommonJS or tools like Jest/ts-node without ESM loaders.

#### 3.2 Missing Modern `"exports"` Map
* Modern Node.js (16+) and bundlers (Vite, Webpack 5, Next.js, Rollup) rely on the `"exports"` map for subpath resolution, conditional exports (`import` vs `require`), and type declarations.
* Currently, `package.json` only specifies legacy fields (`"main"`, `"types"`, `"browser"`), leading to resolution issues in modern monorepos and TypeScript `moduleResolution: "NodeNext"`.

#### 3.3 Broken Browser Field Configuration
* **The Problem:** In `package.json`, `"browser": "dist/web.min.js"` points to a minified IIFE script that attaches to `window.Derakuma`.
* **The Issue:** When modern bundlers (like Vite or Webpack) target web browsers and resolve the `"browser"` field of dependencies, they encounter an IIFE without ESM `export` statements instead of standard ES modules.
* **Developer Impact:** Importing `import { DerakumaParser } from 'derakuma'` in frontend bundlers can fail or yield `undefined` exports.

#### 3.4 Multi-Step, Fragile Build Pipeline
* The build relies on running two separate TypeScript configs followed by manual `esbuild`:
  `"build": "npm run build:node && npm run build:web"`
  `"build:web": "tsc -p tsconfig.web.json && esbuild dist/web.js --minify --outfile=dist/web.min.js"`
* Modern tools like **`tsup`**, **`esbuild`**, or **`unbuild`** can generate ESM (`.js`), CommonJS (`.cjs`), browser IIFE/UMD (`.global.js`), and TypeScript definitions (`.d.ts`) in a single pass from a single source entrypoint in milliseconds.

---

### 4. Platform Compatibility, Encodings & Active Test Failure

#### 4.1 Active Test Failure: Incompatible Encoding String (`utf-16le`)
* **Test Failure in `tests/parser.test.ts`:**
  ```
  FAIL tests/parser.test.ts > can parse a proper Bene font under any encodings encountered
  Error: Woopsies! Failed to read file .../opengost.bene! encoding 'utf-16le' is an invalid encoding
  ```
* **Root Cause:** Node's `fs.readFileSync(path, encoding)` accepts `BufferEncoding` values such as `'utf16le'`, `'utf8'`, `'latin1'`. Standard web encodings (and `TextDecoder`) use `'utf-16le'` (with hyphen).
* **Fix:** Use standard `TextDecoder` (available natively in Node 18+, Bun, Deno, and all modern browsers) to decode raw binary buffers:
  ```ts
  const text = new TextDecoder(encoding).decode(buffer);
  ```

#### 4.2 Node-Specific Imports in Core Code
* `src/index.ts` contains `import { createRequire } from 'node:module'` and `process.cwd()`.
* When bundled for edge runtimes (Cloudflare Workers, Vercel Edge, Deno) or browser environments, these cause packaging errors or force bulky polyfills.
* Core parsing logic should be 100% agnostic of platform-specific globals.

---

### 5. FontoBene Spec Compliance & Geometry Edge Cases

#### 5.1 Single-Pass Parsing & Forward Glyph References (`@REF`)
* **The Problem:** In `parseBene`:
  ```ts
  if (line.startsWith('@')) {
      const referenceKey = line.slice(1).trim().toUpperCase();
      const reference = this.glyphs.get(referenceKey);
      if (reference) {
          // copies polylines
      }
  }
  ```
  If glyph `A` references glyph `B` via `@0042`, but glyph `B` appears *later* in the `.bene` file, `this.glyphs.get(referenceKey)` returns `undefined`. The reference is silently dropped, resulting in missing strokes.
* **Fix:** Use a two-pass parser (Pass 1: parse all raw glyphs and store references; Pass 2: resolve references and flatten arcs) or resolve references lazily.

#### 5.2 Arc Flattening Accuracy & Bulge Direction Testing
* In the FontoBene specification, `bulge` ranges from `-9` to `+9`, representing central angles from `-180°` to `+180°` (positive = counter-clockwise, negative = clockwise).
* While `flattenArc` handles the basic math, there are currently **zero unit tests** verifying positive vs negative bulge arc directions, segment counts, or edge cases (e.g. collinear points with bulge, chords with near-zero length).

#### 5.3 Missing Support for Negative Glyph Offsets / Overhangs
* In `getAdvance(char)`:
  ```ts
  const width = this.metadata.monospaceWidth ?? (glyph ? Math.max(glyph.maxX, 0) : 0);
  ```
  If a font defines italic or script glyphs with left overhangs (`minX < 0`) or custom kerning boundaries, `getAdvance` assumes glyph origin starts at `0`.

---

### 6. Error Handling, Diagnostics & Type Safety

#### 6.1 Silent Skipping of Malformed Data
* When parsing malformed lines or corrupted `.bene` files, the parser silently ignores errors:
  - `if (Number.isNaN(x) || Number.isNaN(y)) continue;`
  - `if (eq === -1) continue;`
  - `if (!current) continue;`
* If a font file contains syntax errors or invalid coordinates, the developer receives no warnings, diagnostics, or line number references.

#### 6.2 Informal Error Messages and Generic Errors
* The library throws generic `Error` instances with informal messages:
  `throw new Error("Woopsies! Failed to fetch ${url}! ...")`
* **Best Practice:** Provide structured custom error classes:
  - `DerakumaLoadError` (network / file load failures with status code and URI)
  - `DerakumaParseError` (syntax error with line number and snippet)
  - `DerakumaNotReadyError` (attempting synchronous query on un-awaited font)

#### 6.3 Fluent Promise Return Types
* Currently, `ready()` returns `Promise<void>`.
* Returning `Promise<DerakumaFont>` or `Promise<this>` enables clean, readable instantiation:
  ```ts
  const font = await Derakuma.fromUrl('https://...').ready();
  // or simply:
  const font = await Derakuma.load('https://...');
  ```

---

### 7. Documentation, Onboarding & README Inaccuracies

#### 7.1 README Code Examples Do Not Work
* The README quickstart provides:
  ```js
  const { DerakumaParser } = require('derakuma');
  const font = new DerakumaParser('/path/to.bene');
  font.getGlyph('a');
  ```
  This example fails in three distinct ways:
  1. `require()` fails due to ESM `"type": "module"`.
  2. `new DerakumaParser('/path/to.bene')` defaults to `fetch()`, which cannot load local filesystem paths in Node without `'file'` mode.
  3. Calling `font.getGlyph('a')` immediately crashes because `fetch()` is asynchronous and not awaited.

#### 7.2 Typo in Pen Command Documentation
* README line 20: *"Should return a series of PD, MV and PU."*
* The actual emitted command code for Move Pen is **`MP`**, not **`MV`**.

#### 7.3 Missing Practical Integration Guides
* No code examples for:
  - Rendering to an HTML5 `<canvas>` element.
  - Generating an `<svg>` path or `<path d="..." />`.
  - Using with modern bundlers (Vite, Webpack, Next.js).
  - Parsing font files in React / Vue / Svelte components.

---

### 8. Test Suite Quality & Developer Tooling

#### 8.1 Shallow Assertions & `console.log` Pollution
* In `tests/parser.test.ts`, all tests use `console.log()` to dump thousands of lines to the terminal and only assert `.toBeDefined()`.
* Example:
  ```ts
  it('can fetch pen commands for a simple glyph', () => {
      expect(parsedFont.getGlyph('A')).toBeDefined();
      console.log(parsedFont.getGlyph('A'));
  });
  ```
  If `getGlyph('A')` returns an empty array `[]` or corrupted NaN coordinates, the test still passes!

#### 8.2 Missing Critical Test Scenarios
* No tests for:
  - Arc flattening / bulge calculation (positive & negative bulges).
  - Forward `@REF` reference resolution.
  - Multi-line sentence commands.
  - In-memory string parsing.
  - Fallback / missing glyph synthesis (`NOTDEF` / `U+FFFD`).
  - Error handling (malformed files, 404 URLs, invalid codepoints).
  - Dual-package module loading (ESM vs CJS).

#### 8.3 Missing Linter, Formatter & CI Automation
* No ESLint or Prettier / Biome configuration.
* No GitHub Actions workflow to automatically test and lint PRs and commits.
* No `npm run typecheck` script (`tsc --noEmit`).

---

## Proposed Architecture & Modern API Blueprint

### Unified Architecture Overview

```
derakuma/
├── src/
│   ├── index.ts               # Main unified entrypoint (ESM/CJS)
│   ├── core/
│   │   ├── parser.ts          # Pure FontoBene parser (strings -> AST/FontData)
│   │   ├── font.ts            # Immutable DerakumaFont class (queries, glyphs)
│   │   └── types.ts           # Shared TypeScript interfaces & types
│   ├── geometry/
│   │   ├── arc.ts             # FontoBene arc flattening & bulge math
│   │   └── bounds.ts          # Bounding box calculation utilities
│   ├── layout/
│   │   ├── text.ts            # Multi-line text layout engine & alignment
│   │   └── metrics.ts         # Font & text metrics measurement
│   ├── renderers/
│   │   ├── svg.ts             # SVG Path string generator
│   │   └── canvas.ts          # Direct Canvas 2D context renderer
│   ├── loaders/
│   │   ├── node.ts            # Node.js file & buffer loaders (fs/promises)
│   │   └── web.ts             # Universal fetch / TextDecoder loader
│   └── errors/
│       └── index.ts           # Typed custom error classes
```

### Modern, Developer-Friendly API Example

```ts
import { Derakuma } from 'derakuma';
import * as fs from 'fs';

// 1. Synchronous In-Memory Parsing (Instant, No Async Race Conditions)
// This should be done when the file content is already known (e.g. already UTF-8 decoded, or whatever it is)
const font = Derakuma.parse(fontFileTextContent);

const fontBuffer: Uint8Array = fs.readFileSync('./fonts/newstroke.bene');

// 2. Static Async Loaders (Node filesystem or Browser fetch)
const fontFromUrl  = await Derakuma.loadFontFromUrl('https://example.com/font.bene');
const fontFromFile = await Derakuma.loadFontFromFile('./fonts/newstroke.bene');

// 3. Simple & Safe Glyph Queries
const glyph = font.getGlyph('A');
const bounds = font.measureText('Hello World', { fontSize: 16 });

// 4. Multi-Line Text Layout with Options
const layout = font.layoutText('Hello\nWorld!', {
    fontSize: 14,
    lineHeight: 1.5,
    letterSpacing: 2.0,
    align: 'center', // 'left' | 'center' | 'right'
});

console.log(layout); // <- Should still output raw pen commands (aka PenCommand[])

// 5. Ready-to-Use High-Level Exporters
const svgPathData = font.renderToSvg('Hello World'); 
// Output: "M 0.86 2.57 L 5.14 2.57 M 0 0 L 3 9 L 6 0 ..."

font.renderToCanvas(ctx, 'Hello World', { x: 10, y: 50, strokeStyle: '#000' });
```

---

## Actionable Fix Checklists

### Phase 1: Critical Bug Fixes & Quick Wins (Immediate)

- [ ] **Fix Encoding Test Failure (`parser.test.ts`)**
  - [ ] Standardize encoding support using `new TextDecoder(encoding)` instead of passing raw string directly to `fs.readFileSync`.
  - [ ] Normalize encoding aliases (e.g. map `utf-16le` to `utf16le` for Node `fs` or decode via Uint8Array buffer).
  - [ ] Ensure `bun x vitest run` passes 100% cleanly without errors.
- [ ] **Fix README Quickstart & Command Typo**
  - [ ] Fix CommonJS vs ESM example in `README.md`.
  - [ ] Fix typo: correct `MV` to `MP` in pen command descriptions.
  - [ ] Add explicit `await font.ready()` or synchronous load instructions in the README example.
- [ ] **Clean Up Test Suite Terminal Output**
  - [ ] Remove excessive `console.log()` calls dumping entire font objects in `tests/parser.test.ts`.
  - [ ] Add real assertions (`expect(commands.length).toBeGreaterThan(0)`, coordinate range checks).

---

### Phase 2: Build System & Architecture Unification

- [ ] **Eliminate Code Duplication (`src/index.ts` vs `src/web.ts`)**
  - [ ] Refactor common parsing, math, and layout logic into a shared `src/core/` module.
  - [ ] Make the core parser 100% platform-agnostic (zero Node `fs` / `createRequire` in core).
- [ ] **Modernize Build Tooling with `tsup` / `esbuild`**
  - [ ] Configure `tsup` (or dual `esbuild`) to build:
    - `dist/index.js` (ESM)
    - `dist/index.cjs` (CommonJS)
    - `dist/web.global.js` (Browser IIFE/UMD for `<script>` tags)
    - `dist/index.d.ts` (TypeScript types)
  - [ ] Add clean build script (`npm run clean` / `rimraf dist`).
- [ ] **Modernize `package.json` Exports Map**
  - [ ] Add standard `"exports"` configuration supporting both `import` and `require`:
    ```json
    "exports": {
      ".": {
        "types": "./dist/index.d.ts",
        "import": "./dist/index.js",
        "require": "./dist/index.cjs"
      }
    }
    ```
  - [ ] Ensure browser bundlers (Vite/Webpack) resolve clean ESM instead of IIFE script.

---

### Phase 3: Modern API Design & High-Level Helpers

- [ ] **Implement Static Factory Methods & In-Memory Parsing**
  - [ ] Add `Derakuma.parse(text: string, options?): DerakumaFont` (pure synchronous parser).
  - [ ] Add `Derakuma.fromUrl(url: string, options?): Promise<DerakumaFont>`.
  - [ ] Add `Derakuma.fromFile(path: string, options?): Promise<DerakumaFont>` (Node/Bun environment).
  - [ ] Make `.ready()` return `Promise<this>` to allow fluent chaining.
- [ ] **Fix Ambiguous Codepoint vs Character Resolution**
  - [ ] Disambiguate single characters, hex codepoint strings (e.g. prefix `U+` or length checks), and numbers.
  - [ ] Provide explicit methods: `font.getGlyphByChar(char)` and `font.getGlyphByCode(code)`.
- [ ] **Implement Multi-Line Text Layout Engine**
  - [ ] Support `\n` linebreaks with proper X-reset and Y-advance (`lineSpacing`).
  - [ ] Add text alignment options: `'left' | 'center' | 'right'`.
  - [ ] Add `measureText(text, options)` returning width, height, and exact bounding box.
- [ ] **Add High-Level Renderers (SVG & Canvas)**
  - [ ] Add `font.toSVGPath(text, options): string` to output ready-to-use SVG `<path d="...">` strings.
  - [ ] Add `font.renderToCanvas(ctx: CanvasRenderingContext2D, text: string, options): void`.
  - [ ] Add `font.toPolylines(text, options): Array<Array<[number, number]>>`.

---

### Phase 4: Robust FontoBene Spec Handling & Encodings

- [ ] **Implement Two-Pass / Lazy Glyph Reference Resolution (`@REF`)**
  - [ ] Handle forward references where glyph `@REF` is defined later in the file.
  - [ ] Handle nested / chained glyph references safely without circular reference crashes.
- [ ] **Comprehensive Arc / Bulge Handling & Verification**
  - [ ] Verify clockwise (`bulge < 0`) and counter-clockwise (`bulge > 0`) arc linearization.
  - [ ] Handle zero-length chords and collinear points gracefully.
  - [ ] Allow configurable arc curve tolerance / segment count for performance vs smoothness tuning.
- [ ] **Standardize Error Handling & Validation Mode**
  - [ ] Create custom error hierarchy: `DerakumaError`, `DerakumaParseError`, `DerakumaLoadError`.
  - [ ] Provide optional `validate(content: string)` method or strict mode that reports line numbers and syntax warnings for invalid `.bene` files.

---

### Phase 5: Testing, Tooling & CI/CD Pipeline

- [ ] **Comprehensive Unit Test Suite**
  - [ ] Arc geometry unit tests (positive, negative, multi-segment, circle arcs).
  - [ ] Reference resolution unit tests (forward references, chained references).
  - [ ] Text layout & multi-line wrapping unit tests.
  - [ ] SVG path output verification tests.
  - [ ] Dual-module loading tests (ensure both `import` and `require` work seamlessly).
- [ ] **Code Quality, Linting & Formatting**
  - [ ] Add ESLint / Biome for linting.
  - [ ] Add Prettier / Biome for consistent code style.
  - [ ] Add `npm run typecheck` (`tsc --noEmit`) to `package.json`.
- [ ] **Continuous Integration (CI)**
  - [ ] Add GitHub Actions workflow (`.github/workflows/ci.yml`) to run tests, typechecking, and build on Node 18, 20, and 22 across Linux, macOS, and Windows.
- [ ] **Comprehensive Documentation & Recipes**
  - [ ] Create an interactive documentation page / playground with live Canvas & SVG previews.
  - [ ] Add comprehensive JSDoc comments to all public types, methods, and options.
  - [ ] Add framework recipes (React, Vue, Node backend SVG generator, CNC/G-code export).
