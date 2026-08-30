/**
 * Pure FontoBene (.bene) parser.
 *
 * Accepts a raw UTF-8 (or already-decoded) string and returns a `FontData`
 * object containing header metadata and a fully resolved glyph map.
 *
 * This module has **zero platform dependencies** – it works identically in
 * Node.js, Bun, Deno, browser environments, and edge runtimes.
 */

import type { FontMetadata, Glyph, ParsedGlyph, ParsedGlyphInstruction, RawVector2 } from './types.js';
import { flattenPolyline, computeBounds } from '../geometry/arc.js';
import { DerakumaParseError } from '../errors/index.js';

const SEPARATOR = '---';
const GLYPH_HEADER_RE = /^\[([0-9A-Fa-f]{4,6})\]\s*(.*)$/;
const SECTION_RE = /^\[(.+)\]$/;

/** Output produced by `parseBene`. */
export interface FontData {
    metadata: FontMetadata;
    glyphs: Map<string, Glyph>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parsePolylineLine(line: string): RawVector2[] {
    const tokens = line.split(';').map((t) => t.trim()).filter((t) => t.length > 0);
    const points: RawVector2[] = [];
    for (const token of tokens) {
        const parts = token.split(',').map((p) => p.trim());
        const x = parseFloat(parts[0]);
        const y = parseFloat(parts[1]);
        if (Number.isNaN(x) || Number.isNaN(y)) continue;
        const point: RawVector2 = { x, y };
        if (parts.length >= 3) {
            const bulge = parseFloat(parts[2]);
            if (!Number.isNaN(bulge) && bulge !== 0) point.bulge = bulge;
        }
        points.push(point);
    }
    return points;
}

function applyHeader(header: Record<string, string[]>): FontMetadata {
    const get = (key: string) => header[key]?.[0];
    return {
        formatVersion: get('format.format_version'),
        id: get('font.id'),
        name: get('font.name'),
        description: get('font.description'),
        version: get('font.version'),
        authors: header['font.author'] ?? [],
        licenses: header['font.license'] ?? [],
        letterSpacing: parseFloat(get('font.letter_spacing') ?? '0') || 0,
        lineSpacing: get('font.line_spacing') !== undefined ? parseFloat(get('font.line_spacing')!) : 9,
        monospaceWidth:
            get('font.monospace_width') !== undefined
                ? parseFloat(get('font.monospace_width')!)
                : undefined,
    };
}

/**
 * Resolve a `ParsedGlyph` (which may contain `@REF` instructions) into a
 * fully-flattened `Glyph`.  Uses a call-stack to detect circular references.
 */
function resolveGlyph(
    parsed: ParsedGlyph,
    allParsed: Map<string, ParsedGlyph>,
    stack: string[] = []
): Glyph {
    if (stack.includes(parsed.codepoint)) {
        throw new DerakumaParseError(
            `Circular glyph reference detected: ${[...stack, parsed.codepoint].join(' -> ')}`
        );
    }

    const mergedPolylines: RawVector2[][] = [];
    let whitespace: number | undefined;
    const nextStack = [...stack, parsed.codepoint];

    for (const instruction of parsed.instructions) {
        if (instruction.kind === 'polyline') {
            mergedPolylines.push(
                instruction.points.map((p) => ({ x: p.x, y: p.y, bulge: p.bulge }))
            );
            continue;
        }

        if (instruction.kind === 'whitespace') {
            whitespace = instruction.value;
            continue;
        }

        // Reference resolution – forward references are safe because we pass
        // the full `allParsed` map (two-pass approach: parse all, then resolve).
        const reference = allParsed.get(instruction.codepoint);
        if (!reference) continue; // silently ignore unknown codepoints
        const resolved = resolveGlyph(reference, allParsed, nextStack);
        for (const polyline of resolved.polylines) {
            mergedPolylines.push(polyline.map((p) => ({ x: p.x, y: p.y })));
        }
        whitespace = resolved.whitespace;
    }

    const polylines = mergedPolylines.map((pl) => flattenPolyline(pl));
    const { minX, maxX } = computeBounds(polylines);

    return {
        codepoint: parsed.codepoint,
        char: parsed.char,
        polylines,
        whitespace: whitespace ?? 0,
        minX,
        maxX,
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw FontoBene string into a `FontData` object.
 *
 * This is a **pure synchronous** function with no I/O.  Load the file
 * content yourself (e.g. via `fs.readFileSync`, `fetch`, or a Vite `?raw`
 * import) and pass the decoded string here.
 *
 * ```ts
 * import { parseBene } from 'derakuma/core/parser';
 * const data = parseBene(myFileContent);
 * ```
 *
 * @throws {DerakumaParseError} on circular glyph references.
 */
export function parseBene(rawContent: string): FontData {
    const lines = rawContent.split(/\r\n|\r|\n/);
    let i = 0;
    const header: Record<string, string[]> = {};
    let currentSection: string | null = null;

    // --- Pass 1a: Parse header (up to the first `---` separator) ---
    for (; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === SEPARATOR) { i++; break; }
        if (line === '' || line.startsWith('#')) continue;

        const sectionMatch = line.match(SECTION_RE);
        if (sectionMatch) {
            currentSection = sectionMatch[1].trim();
            continue;
        }

        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = `${currentSection}.${line.slice(0, eq).trim()}`;
        const value = line.slice(eq + 1).trim();
        (header[key] ??= []).push(value);
    }

    const metadata = applyHeader(header);

    // --- Pass 1b: Parse all glyph blocks into `ParsedGlyph` structures ---
    const parsedGlyphs = new Map<string, ParsedGlyph>();
    let current: ParsedGlyph | null = null;

    const commit = () => {
        if (current) parsedGlyphs.set(current.codepoint, current);
    };

    for (; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '' || line.startsWith('#')) continue;

        const glyphHeader = line.match(GLYPH_HEADER_RE);
        if (glyphHeader) {
            commit();
            current = {
                codepoint: glyphHeader[1].toUpperCase(),
                char: glyphHeader[2] ? glyphHeader[2].trim() || undefined : undefined,
                instructions: [],
            };
            continue;
        }

        if (!current) continue;

        if (line.startsWith('@')) {
            const referenceKey = line.slice(1).trim().toUpperCase();
            current.instructions.push({ kind: 'reference', codepoint: referenceKey });
            continue;
        }

        if (line.startsWith('~')) {
            const value = parseFloat(line.slice(1).trim());
            current.instructions.push({ kind: 'whitespace', value: Number.isNaN(value) ? 0 : value });
            continue;
        }

        const points = parsePolylineLine(line);
        if (points.length) {
            current.instructions.push({ kind: 'polyline', points });
        }
    }
    commit();

    // --- Pass 2: Resolve all references (including forward references) ---
    const glyphs = new Map<string, Glyph>();
    for (const parsed of parsedGlyphs.values()) {
        glyphs.set(parsed.codepoint, resolveGlyph(parsed, parsedGlyphs));
    }

    return { metadata, glyphs };
}
