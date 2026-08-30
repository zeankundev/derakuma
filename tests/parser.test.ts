import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Derakuma } from '../src/index.js';
import { flattenArc } from '../src/geometry/arc.js';
import { parseBene } from '../src/core/parser.js';
import { DerakumaLoadError, DerakumaParseError } from '../src/errors/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = (name: string) => path.join(__dirname, 'fixtures', name);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load a test font synchronously (file system). */
async function loadFont(name: string, encoding?: string) {
    return Derakuma.loadFontFromFile(FIXTURE(name), encoding);
}

// ---------------------------------------------------------------------------
// Basic parsing & font model
// ---------------------------------------------------------------------------

describe('Derakuma.parse() – synchronous in-memory', () => {
    it('parses a minimal bene string without throwing', () => {
        const minimal = `[format]\nformat_version = 0.1.0\n---\n[0041] A\n0,0;6,0;3,9\n`;
        const font = Derakuma.parse(minimal);
        expect(font).toBeDefined();
        expect(font.metadata).toBeDefined();
    });

    it('exposes parsed font metadata', () => {
        const content = `[format]\nformat_version = 1.0.0\n[font]\nname = TestFont\nletter_spacing = 1\nline_spacing = 10\n---\n`;
        const font = Derakuma.parse(content);
        expect(font.metadata.name).toBe('TestFont');
        expect(font.metadata.letterSpacing).toBe(1);
        expect(font.metadata.lineSpacing).toBe(10);
    });
});

// ---------------------------------------------------------------------------
// File loading (Node / Bun only)
// ---------------------------------------------------------------------------

describe('Derakuma.loadFontFromFile() – file system', () => {
    it('parses newstroke.bene successfully', async () => {
        const font = await loadFont('newstroke.bene');
        expect(font).toBeDefined();
        expect(font.metadata).toBeDefined();
    });

    it('loads and lists multiple glyphs', async () => {
        const font = await loadFont('newstroke.bene');
        expect(font.listGlyphs().length).toBeGreaterThan(10);
    });

    it('loads opengost.bene with utf-16le encoding', async () => {
        const font = await loadFont('opengost.bene', 'utf-16le');
        expect(font).toBeDefined();
        // Font should have glyphs
        expect(font.listGlyphs().length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Glyph queries
// ---------------------------------------------------------------------------

describe('DerakumaFont – glyph queries', () => {
    let font: Awaited<ReturnType<typeof Derakuma.loadFontFromFile>>;

    // Load font once for this describe block
    beforeAll(async () => {
        font = await loadFont('newstroke.bene');
    });

    it('getGlyph("A") returns a non-empty command array', () => {
        const cmds = font.getGlyph('A');
        expect(cmds.length).toBeGreaterThan(0);
        // First command must be PD (pen down)
        expect(cmds[0].command).toBe('PD');
    });

    it('getGlyph returns MP and PU commands as well', () => {
        const cmds = font.getGlyph('A');
        const types = new Set(cmds.map((c) => c.command));
        expect(types.has('PD')).toBe(true);
        expect(types.has('PU')).toBe(true);
    });

    it('getGlyphData("A") returns polylines with finite coordinates', () => {
        const glyph = font.getGlyphData('A');
        expect(glyph).toBeDefined();
        expect(glyph!.polylines.length).toBeGreaterThan(0);
        for (const polyline of glyph!.polylines) {
            for (const { x, y } of polyline) {
                expect(Number.isFinite(x)).toBe(true);
                expect(Number.isFinite(y)).toBe(true);
            }
        }
    });

    it('getGlyphByChar returns the same glyph as getGlyphData for single chars', () => {
        expect(font.getGlyphByChar('A')).toStrictEqual(font.getGlyphData('A'));
    });

    it('getGlyphByCode("U+0041") resolves the same as getGlyphByChar("A")', () => {
        expect(font.getGlyphByCode('U+0041')).toStrictEqual(font.getGlyphByChar('A'));
    });

    it('hasGlyph returns true for glyphs that exist', () => {
        expect(font.hasGlyph('A')).toBe(true);
    });

    it('hasGlyph returns false for a codepoint not in the font', () => {
        // U+E000 is Private Use – extremely unlikely to be in newstroke
        expect(font.hasGlyph(0xe000)).toBe(false);
    });

    it('getGlyph returns fallback box for a missing glyph', () => {
        // getGlyph always returns something (fallback)
        const cmds = font.getGlyph(0xe000);
        expect(cmds.length).toBeGreaterThan(0);
    });

    it('getGlyphData with useFallback=false returns no synthesised box for an absent codepoint', () => {
        // The font may contain a U+FFFD replacement glyph which is still returned as a
        // "font-defined" fallback even with useFallback=false.  What should NOT be returned
        // is the synthesised box-with-cross built inside DerakumaFont itself.
        const result = font.getGlyphData(0xe000, false);
        // Either truly undefined, or the font-provided U+FFFD glyph — never the synthesised box
        expect(result === undefined || result.codepoint === 'FFFD').toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Advance / metrics
// ---------------------------------------------------------------------------

describe('DerakumaFont – advance width', () => {
    let font: Awaited<ReturnType<typeof Derakuma.loadFontFromFile>>;

    beforeAll(async () => { font = await loadFont('newstroke.bene'); });

    it('getAdvance("A") is a positive finite number', () => {
        const adv = font.getAdvance('A');
        expect(adv).toBeGreaterThan(0);
        expect(Number.isFinite(adv)).toBe(true);
    });

    it('measureText returns a positive width and height for multi-line text', () => {
        const m = font.measureText('Hello\nWorld!');
        expect(m.width).toBeGreaterThan(0);
        expect(m.height).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------

describe('DerakumaFont – layoutText', () => {
    let font: Awaited<ReturnType<typeof Derakuma.loadFontFromFile>>;

    beforeAll(async () => { font = await loadFont('newstroke.bene'); });

    it('single-line layout produces one entry per character', () => {
        const layout = font.layoutText('Hi');
        expect(layout.length).toBe(2);
    });

    it('multi-line layout separates lines correctly (Y advances)', () => {
        const layout = font.layoutText('Hi\nBye');
        const ys = new Set(layout.map((e) => e.y));
        expect(ys.size).toBeGreaterThan(1); // at least two distinct Y values
    });

    it('commands in layout are offset by character position', () => {
        const layout = font.layoutText('AB');
        // 'B' should start at a positive X
        expect(layout[1].x).toBeGreaterThan(0);
        // commands should already include the X offset
        expect(layout[1].commands[0].x).toBeGreaterThanOrEqual(layout[1].x);
    });

    it('getSentenceCommand (legacy) still works', () => {
        const result = font.getSentenceCommand('Hello, World!');
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].commands.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// High-level renderers
// ---------------------------------------------------------------------------

describe('DerakumaFont – renderers', () => {
    let font: Awaited<ReturnType<typeof Derakuma.loadFontFromFile>>;

    beforeAll(async () => { font = await loadFont('newstroke.bene'); });

    it('renderToSvg produces a non-empty string starting with "M"', () => {
        const d = font.renderToSvg('A');
        expect(typeof d).toBe('string');
        expect(d.length).toBeGreaterThan(0);
        expect(d.startsWith('M')).toBe(true);
    });

    it('toPolylines returns a nested array of [x,y] pairs', () => {
        const polys = font.toPolylines('A');
        expect(polys.length).toBeGreaterThan(0);
        expect(polys[0].length).toBeGreaterThan(0);
        expect(polys[0][0]).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// Arc / geometry unit tests
// ---------------------------------------------------------------------------

describe('flattenArc – geometry', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 2, y: 0 };

    it('bulge=0 (straight) returns just the endpoint', () => {
        const pts = flattenArc(p0, p1, 0);
        expect(pts).toHaveLength(1);
        expect(pts[0]).toMatchObject({ x: 2, y: 0 });
    });

    it('positive bulge produces an arc below the chord (FontoBene screen-space, Y-down)', () => {
        // FontoBene uses a screen-space Y-down coordinate system.
        // With a horizontal chord from left to right, bulge=9 (180° arc) arcs below the chord → negative Y.
        const pts = flattenArc(p0, p1, 9);
        const minY = Math.min(...pts.map((p) => p.y));
        expect(minY).toBeLessThan(0);
    });

    it('negative bulge produces an arc above the chord (FontoBene screen-space, Y-down)', () => {
        // bulge=-9 arcs above the chord → positive Y maximum.
        const pts = flattenArc(p0, p1, -9);
        const maxY = Math.max(...pts.map((p) => p.y));
        expect(maxY).toBeGreaterThan(0);
    });

    it('always ends at p1 regardless of bulge', () => {
        for (const bulge of [-9, -4.5, 0, 4.5, 9]) {
            const pts = flattenArc(p0, p1, bulge);
            const last = pts[pts.length - 1];
            expect(last.x).toBeCloseTo(p1.x, 5);
            expect(last.y).toBeCloseTo(p1.y, 5);
        }
    });

    it('zero-length chord returns just the endpoint without NaN', () => {
        const pts = flattenArc({ x: 1, y: 1 }, { x: 1, y: 1 }, 5);
        expect(pts).toHaveLength(1);
        expect(Number.isFinite(pts[0].x)).toBe(true);
        expect(Number.isFinite(pts[0].y)).toBe(true);
    });

    it('generates more segments for larger arcs', () => {
        const small = flattenArc(p0, p1, 1);
        const large = flattenArc(p0, p1, 9);
        expect(large.length).toBeGreaterThanOrEqual(small.length);
    });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('Error classes', () => {
    it('DerakumaLoadError is thrown for a nonexistent file path', async () => {
        await expect(Derakuma.loadFontFromFile('/nonexistent/path.bene')).rejects.toBeInstanceOf(DerakumaLoadError);
    });
});

// ---------------------------------------------------------------------------
// Reference resolution (forward refs)
// ---------------------------------------------------------------------------

describe('parseBene – forward glyph reference resolution', () => {
    it('resolves a forward @REF correctly', () => {
        // Glyph A references glyph B which is defined AFTER A in the file
        const bene = [
            '[format]',
            'format_version = 0.1.0',
            '---',
            '[0041] A',    // A references B
            '@0042',
            '[0042] B',    // B defined after A
            '0,0;5,0;2.5,5',
        ].join('\n');

        const font = Derakuma.parse(bene);
        // A should have been resolved with B's polylines
        const a = font.getGlyphData('A', false);
        const b = font.getGlyphData('B', false);
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        // A's polylines should equal B's (forward ref resolved)
        expect(a!.polylines).toStrictEqual(b!.polylines);
    });
});

// vitest needs a separate import for beforeAll
import { beforeAll } from 'vitest';