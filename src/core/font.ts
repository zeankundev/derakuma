/**
 * `DerakumaFont` – the immutable, query-oriented font model.
 *
 * Holds fully-resolved glyph data and provides all consumer-facing methods:
 * glyph queries, text layout, measurement, and rendering helpers.
 *
 * Obtain an instance via the top-level `Derakuma` namespace:
 *
 * ```ts
 * import { Derakuma } from 'derakuma';
 *
 * // Synchronous (when content is already decoded)
 * const font = Derakuma.parse(rawBeneString);
 *
 * // Async (loads + decodes automatically)
 * const font = await Derakuma.loadFontFromUrl('https://example.com/font.bene');
 * const font = await Derakuma.loadFontFromFile('./fonts/newstroke.bene');
 * ```
 */

import type {
    FontMetadata,
    Glyph,
    PenCommand,
    LayoutTextOptions,
    TextMetrics,
    PositionedChar,
    ParserSettings,
} from './types.js';
import { parseBene } from './parser.js';
import { computeBounds } from '../geometry/arc.js';
import { DerakumaNotReadyError, DerakumaParseError } from '../errors/index.js';

const CODE_RE = /^(?:U\+)?[0-9A-Fa-f]{4,6}$/;

// ---------------------------------------------------------------------------
// Fallback-glyph builder (drawn as a box with a cross)
// ---------------------------------------------------------------------------

/**
 * Synthesise a fallback glyph, drawn as a box with a diagonal cross
 * ("tofu" style), used when a character and the `U+FFFD` replacement
 * glyph are both missing from the font.
 *
 * Sizing is derived from the font's `lineSpacing` (height) and
 * `monospaceWidth` (width), each falling back to sane defaults when the
 * metadata doesn't specify them.
 *
 * @param metadata - Font metadata used to size the fallback glyph.
 * @returns A synthesised `Glyph` with codepoint `"NOTDEF"`.
 */
function buildFallbackGlyph(metadata: FontMetadata): Glyph {
    const height = metadata.lineSpacing > 0 ? metadata.lineSpacing : 9;
    const width = metadata.monospaceWidth ?? height * 0.6;

    const inset = Math.min(width, height) * 0.1;
    const x0 = inset;
    const x1 = Math.max(width - inset, x0 + 0.001);
    const y0 = inset;
    const y1 = Math.max(height - inset, y0 + 0.001);

    const box = [
        { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 },
        { x: x0, y: y1 }, { x: x0, y: y0 },
    ];
    const crossA = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
    const crossB = [{ x: x0, y: y1 }, { x: x1, y: y0 }];
    const polylines = [box, crossA, crossB];
    const { minX, maxX } = computeBounds(polylines);

    return { codepoint: 'NOTDEF', char: undefined, polylines, whitespace: 0, minX, maxX };
}

// ---------------------------------------------------------------------------
// Codepoint normalisation
// ---------------------------------------------------------------------------

/**
 * Convert a user-supplied character, codepoint number, or `"U+XXXX"` string
 * into the 4–6 character uppercase hex key used by the internal glyph map.
 *
 * **Disambiguation rules** (addresses pain-point 1.3):
 *  1. `number`           → direct codepoint.
 *  2. Single character   → codepoint of that character.
 *  3. `"U+XXXX"` / `"0xXXXX"` prefix → explicit hex codepoint.
 *  4. Otherwise          → codepoint of the first character (multi-char strings).
 *
 * Note: bare hex-word strings like `"BEEF"` are no longer silently treated
 * as codepoints; use `"U+BEEF"` or pass the numeric codepoint instead.
 */
function convertToCodepointKey(input: string | number): string {
    let cp: number;

    if (typeof input === 'number') {
        cp = input;
    } else {
        const trimmed = input.trim();

        if (Array.from(trimmed).length === 1) {
            // Single Unicode character
            cp = trimmed.codePointAt(0)!;
        } else if (/^(?:U\+|0x)[0-9A-Fa-f]{1,6}$/i.test(trimmed)) {
            // Explicit hex prefix: "U+0041" or "0x0041"
            cp = parseInt(trimmed.replace(/^(?:U\+|0x)/i, ''), 16);
        } else {
            // Fallback: treat the first Unicode code-point of the string
            cp = trimmed.codePointAt(0) ?? 0;
        }
    }

    const hex = cp.toString(16).toUpperCase();
    return hex.length < 4 ? hex.padStart(4, '0') : hex;
}

// ---------------------------------------------------------------------------
// Glyph → PenCommand conversion
// ---------------------------------------------------------------------------

/**
 * Convert a `Glyph`'s polylines into a flat sequence of pen commands.
 *
 * Each polyline becomes a `PD` (pen down) at its first point, an `MP`
 * (move-while-pressed) for every subsequent point, and a trailing `PU`
 * (pen up) at the last point. Empty polylines are skipped.
 *
 * @param glyph - The glyph whose polylines should be converted.
 * @returns The equivalent pen-command sequence, in glyph-local coordinates.
 */
function glyphToPenCommands(glyph: Glyph): PenCommand[] {
    const commands: PenCommand[] = [];
    for (const polyline of glyph.polylines) {
        if (polyline.length === 0) continue;
        commands.push({ command: 'PD', x: polyline[0].x, y: polyline[0].y });
        for (let i = 1; i < polyline.length; i++) {
            commands.push({ command: 'MP', x: polyline[i].x, y: polyline[i].y });
        }
        const last = polyline[polyline.length - 1];
        commands.push({ command: 'PU', x: last.x, y: last.y });
    }
    return commands;
}

// ---------------------------------------------------------------------------
// DerakumaFont
// ---------------------------------------------------------------------------

/**
 * The main Derakuma font class.
 */
export class DerakumaFont {
    /** Parsed header metadata from the `.bene` file. */
    public readonly metadata: FontMetadata;

    private readonly glyphs: Map<string, Glyph>;
    private fallbackGlyphCache: Glyph | null = null;

    /** @internal – use `Derakuma.parse()` or `Derakuma.load*()` instead. */
    constructor(metadata: FontMetadata, glyphs: Map<string, Glyph>) {
        this.metadata = metadata;
        this.glyphs = glyphs;
    }

    // -----------------------------------------------------------------------
    // Glyph queries
    // -----------------------------------------------------------------------

    /**
     * Returns the raw pen-command sequence for `character`.
     *
     * If the specified character is missing, the `U+FFFD` replacement glyph is used.
     * If that is also missing, a synthesised fallback glyph is returned instead.
     *
     * @param character - A single character, a numeric codepoint, or an
     *                    explicit `"U+XXXX"` / `"0xXXXX"` string.
     */
    getGlyph(character: string | number): PenCommand[] {
        const glyph = this.getGlyphData(character);
        if (!glyph) return [];
        return glyphToPenCommands(glyph);
    }

    private _lookupHexKey(hexKey: string, useFallback: boolean = true): Glyph | undefined {
        let glyph = this.glyphs.get(hexKey);
        if (!glyph && hexKey !== 'FFFD') glyph = this.glyphs.get('FFFD');
        if (!glyph && useFallback) glyph = this._fallbackGlyph();
        return glyph;
    }

    /**
     * Returns either the known `Glyph` record for `character`, the `U+FFFD` replacement glyph, or a synthesised fallback glyph.
     *
     * @param character  - Character, codepoint, or explicit hex string.
     * @param useFallback - When `true` (default), returns the synthesised
     *                      fallback glyph instead of `undefined` for missing glyphs.
     */
    getGlyphData(character: string | number, useFallback: boolean = true): Glyph | undefined {
        const key = convertToCodepointKey(character);
        return this._lookupHexKey(key, useFallback);
    }

    /**
     * Looks a glyph up by a single character. If that character does not exist in the font, the `U+FFFD` replacement glyph is used. If that is also missing, a synthesised fallback glyph is returned instead.
     */
    getGlyphByChar(char: string): Glyph | undefined {
        if (Array.from(char).length !== 1) return undefined;
        return this.getGlyphData(char);
    }

    /**
     * Looks a glyph up by a numeric codepoint or an explicit `"U+XXXX"` / `"0xXXXX"` string. 
     */
    getGlyphByCode(code: number | string): Glyph | undefined {
        const str = code.toString();
        if (!CODE_RE.test(str)) {
            throw new DerakumaParseError(`Invalid glyph code "${code}"`);
        }
        const hex = str.replace(/^U\+/i, '').toUpperCase();
        const padded = hex.length < 4 ? hex.padStart(4, '0') : hex;
        return this._lookupHexKey(padded);
    }

    /** Returns `true` if the font contains an exact glyph for `character`. */
    hasGlyph(character: string | number): boolean {
        const key = convertToCodepointKey(character);
        return this.glyphs.has(key);
    }

    /** List all codepoint keys (uppercase hex strings) present in the font. */
    listGlyphs(): string[] {
        return Array.from(this.glyphs.keys());
    }

    // -----------------------------------------------------------------------
    // Advance / metrics
    // -----------------------------------------------------------------------

    /**
     * Returns the horizontal advance width for `character` (glyph width + whitespace + letter spacing).
     */
    getAdvance(character: string | number): number {
        const glyph = this.getGlyphData(character);
        const width = this.metadata.monospaceWidth ?? (glyph ? Math.max(glyph.maxX, 0) : 0);
        const trailing = glyph?.whitespace ?? 0;
        return width + trailing + this.metadata.letterSpacing;
    }

    /**
     * Measures the bounding box of a text string, including multilines.
     *
     * @returns `{ width, height, minX, maxX, minY, maxY }` in font units.
     */
    measureText(text: string, options: LayoutTextOptions = {}): TextMetrics {
        const lineHeight = (options.lineHeight ?? 1) * this.metadata.lineSpacing;
        const extraSpacing = options.letterSpacing ?? 0;
        const lines = text.split(/\r\n|\r|\n/);
        let maxLineWidth = 0;

        for (const line of lines) {
            let lineWidth = 0;
            for (const char of line) {
                const advance = this.getAdvance(char) + extraSpacing;
                lineWidth += advance;
            }
            if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;
        }

        const totalHeight = lines.length * lineHeight;
        return {
            width: maxLineWidth,
            height: totalHeight,
            minX: 0,
            maxX: maxLineWidth,
            minY: 0,
            maxY: totalHeight,
        };
    }

    /**
     * Layout `text` (which may include `\n` / `\r\n` newlines) into a flat
     * array of positioned pen-command entries.
     *
     * The returned `commands` for each character are already offset to the
     * character's final `(x, y)` position in the layout.
     *
     * ```ts
     * const layout = font.layoutText('Hello\nWorld!', { align: 'center' });
     * ```
     */
    layoutText(text: string, options: LayoutTextOptions = {}): PositionedChar[] {
        const lineHeight = (options.lineHeight ?? 1) * this.metadata.lineSpacing;
        const extraSpacing = options.letterSpacing ?? 0;
        const align = options.align ?? 'left';
        const lines = text.split(/\r\n|\r|\n/);
        const result: PositionedChar[] = [];

        // Pre-compute line widths for alignment
        const lineWidths = lines.map((line) => {
            let w = 0;
            for (const char of line) w += this.getAdvance(char) + extraSpacing;
            return w;
        });

        // Find maximum width for center/right alignment
        const maxWidth = Math.max(...lineWidths);

        for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            const y = li * lineHeight;

            let startX = 0;
            if (align === 'center') startX = (maxWidth - lineWidths[li]) / 2;
            else if (align === 'right') startX = maxWidth - lineWidths[li];

            let cursor = startX;
            for (const char of line) {
                const raw = this.getGlyph(char);
                const translated: PenCommand[] = raw.map((cmd) => ({
                    ...cmd,
                    x: cmd.x + cursor,
                    y: cmd.y + y,
                }));
                result.push({ char, x: cursor, y, commands: translated });
                cursor += this.getAdvance(char) + extraSpacing;
            }
        }

        return result;
    }

    /**
     * Legacy single-line layout.  Prefer `layoutText` for new code.
     * @deprecated Use `layoutText` instead.
     */
    getSentenceCommand(text: string): Array<{ char: string; x: number; commands: PenCommand[] }> {
        return this.layoutText(text).map(({ char, x, commands }) => ({ char, x, commands }));
    }

    // -----------------------------------------------------------------------
    // High-level renderers
    // -----------------------------------------------------------------------

    /**
     * Renders the specified `text` to an SVG `<path d="...">` string.
     *
     * Each stroke is emitted as `M x y L x y L x y …` segments.
     * Multiple strokes are concatenated (SVG `<path>` supports multiple
     * sub-paths in a single `d` attribute).
     *
     * ```ts
     * const d = font.renderToSvg('Hello World');
     * // -> 'M 0.86 2.57 L 5.14 2.57 M 0 0 L 3 9 L 6 0 ...'
     * ```
     */
    renderToSvg(text: string, options: LayoutTextOptions = {}): string {
        const layout = this.layoutText(text, options);
        const parts: string[] = [];

        let inStroke = false;
        for (const { commands } of layout) {
            for (const cmd of commands) {
                const rx = +cmd.x.toFixed(4);
                const ry = +cmd.y.toFixed(4);
                if (cmd.command === 'PD') {
                    parts.push(`M ${rx} ${ry}`);
                    inStroke = true;
                } else if (cmd.command === 'MP' && inStroke) {
                    parts.push(`L ${rx} ${ry}`);
                } else if (cmd.command === 'PU') {
                    inStroke = false;
                }
            }
        }

        return parts.join(' ');
    }

    /**
     * Renders `text` directly to an existing HTML5 Canvas 2D context.
     *
     * ```ts
     * font.renderToCanvas(ctx, 'Hello', { x: 10, y: 50, strokeStyle: '#000' });
     * ```
     */
    renderToCanvas(
        ctx: CanvasRenderingContext2D,
        text: string,
        options: LayoutTextOptions & { x?: number; y?: number; strokeStyle?: string; lineWidth?: number } = {}
    ): void {
        const offsetX = options.x ?? 0;
        const offsetY = options.y ?? 0;
        const layout = this.layoutText(text, options);

        ctx.save();
        if (options.strokeStyle) ctx.strokeStyle = options.strokeStyle;
        if (options.lineWidth !== undefined) ctx.lineWidth = options.lineWidth;
        ctx.beginPath();

        for (const { commands } of layout) {
            for (const cmd of commands) {
                if (cmd.command === 'PD') {
                    ctx.moveTo(offsetX + cmd.x, offsetY + cmd.y);
                } else if (cmd.command === 'MP') {
                    ctx.lineTo(offsetX + cmd.x, offsetY + cmd.y);
                }
                // PU: nothing to do in canvas (just stop drawing)
            }
        }

        ctx.stroke();
        ctx.restore();
    }

    /**
     * Return `text` as an array of polylines to be used elsewhere, such as WebGL, CNC machinery, etc.
     *
     * ```ts
     * const polylines = font.toPolylines('Hi');
     * // → [ [ [0, 0], [3, 9], [6, 0] ], ... ]
     * ```
     */
    toPolylines(text: string, options: LayoutTextOptions = {}): Array<Array<[number, number]>> {
        const layout = this.layoutText(text, options);
        const result: Array<Array<[number, number]>> = [];
        let current: Array<[number, number]> | null = null;

        for (const { commands } of layout) {
            for (const cmd of commands) {
                if (cmd.command === 'PD') {
                    current = [[cmd.x, cmd.y]];
                } else if (cmd.command === 'MP' && current) {
                    current.push([cmd.x, cmd.y]);
                } else if (cmd.command === 'PU') {
                    if (current) { result.push(current); current = null; }
                }
            }
        }
        if (current) result.push(current);

        return result;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Return this font's synthesised fallback glyph, building and caching
     * it on first use.
     *
     * @returns The lazily-built, memoised fallback `Glyph`.
     */
    private _fallbackGlyph(): Glyph {
        if (!this.fallbackGlyphCache) {
            this.fallbackGlyphCache = buildFallbackGlyph(this.metadata);
        }
        return this.fallbackGlyphCache;
    }
}

// ---------------------------------------------------------------------------
// Static font-data builder (used by Derakuma factory)
// ---------------------------------------------------------------------------

/**
 * Build a `DerakumaFont` directly from a raw `.bene` string.
 * @internal – prefer the `Derakuma` namespace in user code.
 */
export function fontFromString(content: string, settings: ParserSettings = { violent: false }): DerakumaFont {
    const { metadata, glyphs } = parseBene(content, settings);
    return new DerakumaFont(metadata, glyphs);
}