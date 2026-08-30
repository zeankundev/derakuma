/**
 * Derakuma – FontoBene stroke-font parser for TypeScript
 *
 * ## Quick Start
 *
 * ```ts
 * import { Derakuma } from 'derakuma';
 *
 * // 1. Synchronous in-memory parse (content already loaded / decoded)
 * const font = Derakuma.parse(rawBeneString);
 *
 * // 2. Load from URL (browser, Node 18+, Bun, Deno, edge runtimes)
 * const font = await Derakuma.loadFontFromUrl('https://example.com/font.bene');
 *
 * // 3. Load from the local file system (Node / Bun only)
 * const font = await Derakuma.loadFontFromFile('./fonts/newstroke.bene');
 * // Or with an explicit encoding (e.g. UTF-16 LE):
 * const font = await Derakuma.loadFontFromFile('./fonts/opengost.bene', 'utf-16le');
 *
 * // 4. Get pen commands for a glyph
 * const cmds = font.getGlyph('A');
 *
 * // 5. Multi-line layout
 * const layout = font.layoutText('Hello\nWorld!', { align: 'center' });
 *
 * // 6. SVG path string
 * const d = font.renderToSvg('Hello World');
 *
 * // 7. Canvas 2D
 * font.renderToCanvas(ctx, 'Hello', { x: 10, y: 50 });
 * ```
 *
 */

// ---- Core types & font model -----------------------------------------------
export type { FontMetadata, Glyph, PenCommand, LayoutTextOptions, TextMetrics, PositionedChar } from './core/types.js';
export { DerakumaFont } from './core/font.js';

// ---- Parser (low-level) ----------------------------------------------------
export { parseBene } from './core/parser.js';
export type { FontData } from './core/parser.js';

// ---- Geometry utilities (advanced / tree-shakeable) ------------------------
export { flattenArc, flattenPolyline, computeBounds } from './geometry/arc.js';

// ---- Error classes ---------------------------------------------------------
export { DerakumaError, DerakumaLoadError, DerakumaParseError, DerakumaNotReadyError } from './errors/index.js';

// ---- Loaders ---------------------------------------------------------------
export { loadFontFromUrl, loadFontFromBuffer } from './loaders/web.js';
export { loadFontFromFile, loadFontFromFileSync, normalizeEncoding } from './loaders/node.js';

// ---- Convenience façade ----------------------------------------------------

import { fontFromString } from './core/font.js';
import type { DerakumaFont } from './core/font.js';
import { loadFontFromUrl } from './loaders/web.js';
import { loadFontFromFile } from './loaders/node.js';

/**
 * Top-level namespace / factory for Derakuma.
 *
 * Use these static methods instead of `new DerakumaParser(...)` to avoid the
 * async-constructor race hazard described in the pain-point analysis.
 */
export const Derakuma = {
    /**
     * Synchronously parse an already-decoded `.bene` string into a font object.
     *
     * Use this when you already have the file content in memory — for example
     * from a Vite `?raw` import, a WebWorker message, a file input read, etc.
     *
     * ```ts
     * import rawFont from './fonts/newstroke.bene?raw'; // Vite
     * const font = Derakuma.parse(rawFont);
     * ```
     */
    parse(content: string): DerakumaFont {
        return fontFromString(content);
    },

    /**
     * Load a `.bene` font from a URL using the global `fetch` API.
     *
     * Works in browsers, Node 18+, Bun, Deno, and edge runtimes.
     *
     * ```ts
     * const font = await Derakuma.loadFontFromUrl('https://example.com/font.bene');
     * ```
     */
    loadFontFromUrl,

    /**
     * Load a `.bene` font from the local file system.
     *
     * Only available in Node.js, Bun, and Deno environments.
     *
     * ```ts
     * const font = await Derakuma.loadFontFromFile('./fonts/newstroke.bene');
     * const font = await Derakuma.loadFontFromFile('./fonts/opengost.bene', 'utf-16le');
     * ```
     */
    loadFontFromFile,
} as const;

export default Derakuma;
