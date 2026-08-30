/**
 * Shared TypeScript interfaces and types for the Derakuma library.
 * This module has zero runtime dependencies and is safe for all environments.
 */

/**
 * Pen commands emitted for each glyph stroke.
 *
 * - `PD` (Pen Down)  – begin a new stroke at (x, y).
 * - `MP` (Move Pen)  – continue the current stroke to (x, y).
 * - `PU` (Pen Up)    – lift the pen after finishing a stroke at (x, y).
 */
export type PenCommand =
    | { command: 'PD'; x: number; y: number }
    | { command: 'PU'; x: number; y: number }
    | { command: 'MP'; x: number; y: number };


/**
 * Derakuma global settings that affect only on the specified font scope.
 * 
 * Use this to enable/disable features that Derakuma can be finetuned for the specified application
 */
export interface ParserSettings {
    /** If set to true, the parser will be extremely strict about parsing `.bene` files */
    violent?: boolean;   
}

/** Metadata parsed from the FontoBene file header. */
export interface FontMetadata {
    /** FontoBene format version */
    formatVersion?: string;
    /** ID of the font. Should not contain spaces or abnormal characters. */
    id?: string;
    /** Human readable name of the font. */
    name?: string;
    /** Optional description of the font. */
    description?: string;
    /** Font version */
    version?: string;
    /** Authors of the font. */
    authors: string[];
    /** Font license */
    licenses: string[];
    /** Extra spacing added between adjacent glyphs. */
    letterSpacing: number;
    /** Default vertical spacing between text lines. */
    lineSpacing: number;
    /** Fixed glyph width for monospace fonts (optional). */
    monospaceWidth?: number;
}

/** A fully resolved glyph with flattened polylines ready for rendering. */
export interface Glyph {
    /** Uppercase hex codepoint string, e.g. `"0041"` for 'A'. */
    codepoint: string;
    /** The human-readable character, if provided in the font file. */
    char?: string;
    /** Flattened 2-D polylines. Each inner array is one continuous stroke. */
    polylines: Array<Array<{ x: number; y: number }>>;
    /** Extra trailing whitespace to add after this glyph's advance width. */
    whitespace: number;
    /** Leftmost x coordinate of all stroke points. */
    minX: number;
    /** Rightmost x coordinate of all stroke points. */
    maxX: number;
}

/** A 2-D point, optionally carrying a FontoBene bulge value for arc segments. */
export interface RawVector2 {
    x: number;
    y: number;
    /** FontoBene bulge in the range [-9, +9]. Positive = CCW, negative = CW. */
    bulge?: number;
}

/** Internal instruction kinds stored while parsing a glyph block. */
export type ParsedGlyphInstruction =
    | { kind: 'polyline'; points: RawVector2[] }
    | { kind: 'reference'; codepoint: string }
    | { kind: 'whitespace'; value: number };

/** Internal representation of a glyph before reference resolution. */
export interface ParsedGlyph {
    codepoint: string;
    char?: string;
    instructions: ParsedGlyphInstruction[];
}

/** Options for `layoutText`. */
export interface LayoutTextOptions {
    /** Line spacing multiplier. Defaults to `1` (use `metadata.lineSpacing`). */
    lineHeight?: number;
    /** Extra horizontal spacing between glyphs (added to `metadata.letterSpacing`). */
    letterSpacing?: number;
    /** Horizontal text alignment. Defaults to `'left'`. */
    align?: 'left' | 'center' | 'right';
}

/** Metrics returned by `measureText`. */
export interface TextMetrics {
    /** Width of the text. Done by calculating the delta between `maxX` and `minX`. */
    width: number;
    /** Height of the text. Done by calculating the delta between `maxY` and `minY`. */
    height: number;
    /** Leftmost x coordinate of all stroke points. */
    minX: number;
    /** Rightmost x coordinate of all stroke points. */
    maxX: number;
    /** Topmost y coordinate of all stroke points. */
    minY: number;
    /** Bottommost y coordinate of all stroke points. */
    maxY: number;
}

/** One positioned character entry produced by `layoutText`. */
export interface PositionedChar {
    char: string;
    x: number;
    y: number;
    commands: PenCommand[];
}
