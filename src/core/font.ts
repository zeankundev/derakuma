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
} from './types.js';
import { parseBene } from './parser.js';
import { computeBounds } from '../geometry/arc.js';
import { DerakumaNotReadyError } from '../errors/index.js';

// ---------------------------------------------------------------------------
// Fallback-glyph builder (drawn as a box with a cross)
// ---------------------------------------------------------------------------

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
 * Immutable parsed font model.  All methods are synchronous – loading and
 * decoding is handled by `Derakuma.*` factory methods before this object
 * is returned to the caller.
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
     * Return the raw pen-command sequence for `character`.
     *
     * Falls back to the `U+FFFD` replacement glyph or a synthesised
     * box-with-cross if the character is not in the font.
     *
     * @param character - A single character, a numeric codepoint, or an
     *                    explicit `"U+XXXX"` / `"0xXXXX"` string.
     */
    getGlyph(character: string | number): PenCommand[] {
        const glyph = this.getGlyphData(character);
        if (!glyph) return [];
        return glyphToPenCommands(glyph);
    }

    /**
     * Return the raw `Glyph` record (with polylines) for `character`.
     *
     * @param character  - Character, codepoint, or explicit hex string.
     * @param useFallback - When `true` (default), returns the synthesised
     *                      fallback glyph instead of `undefined` for missing glyphs.
     */
    getGlyphData(character: string | number, useFallback: boolean = true): Glyph | undefined {
        const key = convertToCodepointKey(character);
        let glyph = this.glyphs.get(key);
        if (!glyph && key !== 'FFFD') glyph = this.glyphs.get('FFFD');
        if (!glyph && useFallback) glyph = this._fallbackGlyph();
        return glyph;
    }

    /**
     * Look up a glyph by a **single character** (Unicode scalar value).
     * Equivalent to `getGlyphData(char)` but semantically explicit.
     */
    getGlyphByChar(char: string): Glyph | undefined {
        if (Array.from(char).length !== 1) return undefined;
        return this.getGlyphData(char);
    }

    /**
     * Look up a glyph by a numeric Unicode codepoint or `"U+XXXX"` string.
     */
    getGlyphByCode(code: number | string): Glyph | undefined {
        return this.getGlyphData(code);
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
     * Horizontal advance width for `character` (glyph width + whitespace + letter spacing).
     */
    getAdvance(character: string | number): number {
        const glyph = this.getGlyphData(character);
        const width = this.metadata.monospaceWidth ?? (glyph ? Math.max(glyph.maxX, 0) : 0);
        const trailing = glyph?.whitespace ?? 0;
        return width + trailing + this.metadata.letterSpacing;
    }

    /**
     * Measure the bounding box of a (possibly multi-line) text string.
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

    // -----------------------------------------------------------------------
    // Text layout
    // -----------------------------------------------------------------------

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
     * Render `text` to an SVG `<path d="...">` string.
     *
     * Each stroke is emitted as `M x y L x y L x y …` segments.
     * Multiple strokes are concatenated (SVG `<path>` supports multiple
     * sub-paths in a single `d` attribute).
     *
     * ```ts
     * const d = font.renderToSvg('Hello World');
     * // → 'M 0.86 2.57 L 5.14 2.57 M 0 0 L 3 9 L 6 0 ...'
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
     * Render `text` directly to an HTML5 Canvas 2D context.
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
     * Return `text` as an array of polylines, suitable for use with WebGL,
     * Three.js, Paper.js, G-code generators, or CNC toolpaths.
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
export function fontFromString(content: string): DerakumaFont {
    const { metadata, glyphs } = parseBene(content);
    return new DerakumaFont(metadata, glyphs);
}
