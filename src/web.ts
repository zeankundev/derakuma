/**
 * Browser-only global entrypoint for Derakuma.
 *
 * Intended for use via `<script>` tags or CDN links.  After loading this
 * bundle, `window.Derakuma` and `window.DerakumaFont` are available globally.
 *
 * For bundlers (Vite, Webpack, Next.js) use the main `derakuma` package
 * entrypoint instead — it provides proper ESM / CJS exports.
 */

import { Derakuma, DerakumaFont } from './index.js';
import { loadFontFromBuffer } from './loaders/web.js';
import { parseBene } from './core/parser.js';

// Attach to globalThis so it works in both browser windows and service workers
(function (global: Record<string, unknown>) {
    global['Derakuma'] = Derakuma;
    global['DerakumaFont'] = DerakumaFont;
    global['DerakumaLoadFontFromBuffer'] = loadFontFromBuffer;
    global['DerakumaParseBene'] = parseBene;
})(typeof globalThis !== 'undefined' ? (globalThis as unknown as Record<string, unknown>) : (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : (self as unknown as Record<string, unknown>)));

export { Derakuma, DerakumaFont, loadFontFromBuffer, parseBene };
