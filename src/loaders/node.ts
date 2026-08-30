/**
 * Node.js / Bun / Deno file-system loader for Derakuma.
 *
 * Uses `fs/promises` and the standard `TextDecoder` API (available in Node 18+,
 * Bun, and Deno) so that any encoding string accepted by the WHATWG Encoding
 * Standard works — including `utf-16le`, `utf-8`, `latin1`, `iso-8859-1`, etc.
 *
 * **Do not import this module in browser bundles.** Use `loaders/web.ts` instead.
 */

import { readFile } from 'node:fs/promises';
import { DerakumaLoadError } from '../errors/index.js';
import { fontFromString } from '../core/font.js';
import type { DerakumaFont } from '../core/font.js';

/**
 * Normalise an encoding label to a WHATWG-compatible form accepted by
 * `TextDecoder`.  For example `"utf8"` → `"utf-8"`, `"UTF_16LE"` → `"utf-16le"`.
 *
 * Node `fs.readFileSync` uses its own `BufferEncoding` names (`'utf16le'`,
 * `'utf8'`, etc.); `TextDecoder` uses the WHATWG label (`'utf-16le'`, `'utf-8'`).
 * We standardise to the WHATWG form here so **any** plausible input works.
 */
export function normalizeEncoding(encoding: string): string {
    return encoding.trim().toLowerCase().replace(/_/g, '-');
}

/**
 * Load and decode a `.bene` file from the local file system.
 *
 * ```ts
 * import { loadFontFromFile } from 'derakuma/loaders/node';
 * const font = await loadFontFromFile('./fonts/newstroke.bene');
 * const font16 = await loadFontFromFile('./fonts/opengost.bene', 'utf-16le');
 * ```
 *
 * @param filePath - Absolute or CWD-relative path to the `.bene` file.
 * @param encoding - WHATWG or Node encoding label (default `'utf-8'`).
 *
 * @throws {DerakumaLoadError} If the file cannot be read.
 */
export async function loadFontFromFile(
    filePath: string,
    encoding: string = 'utf-8'
): Promise<DerakumaFont> {
    let buffer: Buffer;
    try {
        buffer = await readFile(filePath);
    } catch (err) {
        throw new DerakumaLoadError(filePath, (err as NodeJS.ErrnoException).message);
    }
    const text = new TextDecoder(normalizeEncoding(encoding)).decode(buffer);
    return fontFromString(text);
}

/**
 * Synchronously load a `.bene` font from the local file system.
 *
 * Prefer `loadFontFromFile` (async) in production; use this only where
 * async is impossible (e.g. module-level initialisation in older toolchains).
 *
 * @throws {DerakumaLoadError} If the file cannot be read.
 */
export function loadFontFromFileSync(
    filePath: string,
    encoding: string = 'utf-8'
): DerakumaFont {
    // Dynamic import at call-time: keeps the file tree-shakeable when
    // bundled for environments where this function is never called.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    let buffer: Buffer;
    try {
        buffer = readFileSync(filePath);
    } catch (err) {
        throw new DerakumaLoadError(filePath, (err as NodeJS.ErrnoException).message);
    }
    const text = new TextDecoder(normalizeEncoding(encoding)).decode(buffer);
    return fontFromString(text);
}
