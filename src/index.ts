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
 * The main Derakuma object constructor.
 * 
 * Replaces the old `new DerakumaParser(...)` that are prone to async bugs.
 */
export const Derakuma = {
    /**
     * Instantly loads and parses the provided `.bene` content string.
     * 
     * Use this when you have a font string already loaded in memory. These include, but not limited to:
     * - Vite `?raw` imports
     * - Direct file reads as a string (encoding varies)
     * - Hardcoded font strings (not recommended, **may bloat your code**)
     * 
     * ```ts
     * import BeneFont from './your/font.bene?raw'; // Vite is used here as a demo
     * const myFont = Derakuma.parse(BeneFont);
     * ```
     */
    parse(content: string): DerakumaFont {
        return fontFromString(content);
    },

    /**
     * Loads a `.bene` font from a specified URL (HTTP/HTTPS or data: URI) and parses it.
     * 
     * **Compatible in:**
     * - Modern browsers (with `fetch` support)
     * - Node.js 18+ (with global `fetch`)
     * - Bun
     * - Deno
     * - Edge and serverless runtimes (Vercel, Cloudflare Workers, etc.)
     * 
     * ```ts
     * const myFont = await Derakuma.loadFontFromUrl('https://example.com/fonts/myfont.bene');
     * ```
     */
    loadFontFromUrl,

    /**
     * Loads a `.bene` font file from the file system of where it's used/hosted.
     * 
     * **Compatible in:**
     * - Node.js (all versions)
     * - Bun
     * 
     * ```ts
     * const myFont = await Derakuma.loadFontFromFile('./fonts/myfont.bene');
     * ```
     */
    loadFontFromFile,
} as const;

export default Derakuma;
