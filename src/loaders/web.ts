/**
 * Universal browser / edge-runtime fetch loader for Derakuma.
 *
 * Works in any environment that provides the global `fetch` function:
 * browsers, Node.js 18+, Bun, Deno, Cloudflare Workers, Vercel Edge, etc.
 *
 * No Node.js-specific APIs are used here.
 */

import { DerakumaLoadError } from '../errors/index.js';
import { fontFromString } from '../core/font.js';
import type { DerakumaFont } from '../core/font.js';

/**
 * Load a `.bene` font from a URL using the `fetch` API.
 *
 * ```ts
 * import { loadFontFromUrl } from 'derakuma/loaders/web';
 * const font = await loadFontFromUrl('https://example.com/fonts/newstroke.bene');
 * ```
 *
 * @param url     - Fully qualified URL (HTTP/HTTPS or data: URI).
 * @param encoding - Ignored – response text is decoded by the browser via
 *                   `Response.text()`.  Provided for API symmetry; custom
 *                   binary encodings require a Uint8Array fetch + TextDecoder.
 *
 * @throws {DerakumaLoadError} If the request fails or returns a non-OK status.
 */
export async function loadFontFromUrl(
    url: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _encoding?: string
): Promise<DerakumaFont> {
    if (typeof fetch !== 'function') {
        throw new DerakumaLoadError(url, '`fetch` is not available in this environment. Use the Node loader instead.');
    }

    let response: Response;
    try {
        response = await fetch(url);
    } catch (err) {
        throw new DerakumaLoadError(url, (err as Error).message);
    }

    if (!response.ok) {
        throw new DerakumaLoadError(url, `${response.statusText}`, response.status);
    }

    const text = await response.text();
    return fontFromString(text);
}

/**
 * Decode a raw `Uint8Array` / `ArrayBuffer` (e.g. from a binary fetch or an
 * `<input type="file">` upload) with the specified encoding, then parse it.
 *
 * ```ts
 * const buf = await file.arrayBuffer();
 * const font = await loadFontFromBuffer(buf, 'utf-16le');
 * ```
 *
 * @param buffer   - Raw binary data.
 * @param encoding - WHATWG encoding label (default `'utf-8'`).
 */
export function loadFontFromBuffer(
    buffer: Uint8Array | ArrayBuffer,
    encoding: string = 'utf-8'
): DerakumaFont {
    const text = new TextDecoder(encoding).decode(buffer);
    return fontFromString(text);
}
