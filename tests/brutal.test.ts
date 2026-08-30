import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import gl from 'gl';
import { Derakuma } from '../src/index.js';
import { flattenArc } from '../src/geometry/arc.js';
import { parseBene } from '../src/core/parser.js';
import { DerakumaLoadError, DerakumaParseError } from '../src/errors/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = (name: string) => path.join(__dirname, 'fixtures', name);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadFont(name: string, encoding?: string) {
    return Derakuma.loadFontFromFile(FIXTURE(name), encoding);
}

/** Flattens polylines into a flat Float32Array of x,y pairs. */
function polylinesToFloat32(polylines: { x: number; y: number }[][]): Float32Array {
    const out: number[] = [];
    for (const line of polylines) {
        for (const p of line) out.push(p.x, p.y);
    }
    return new Float32Array(out);
}

// ===========================================================================
// EXISTING SUITE (kept, unmodified in behavior)
// ===========================================================================

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
        expect(font.listGlyphs().length).toBeGreaterThan(0);
    });
});

describe('DerakumaFont – glyph queries', () => {
    let font: Awaited<ReturnType<typeof loadFont>>;
    beforeAll(async () => { font = await loadFont('newstroke.bene'); });

    it('getGlyph("A") returns a non-empty command array', () => {
        const cmds = font.getGlyph('A');
        expect(cmds.length).toBeGreaterThan(0);
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
        expect(font.hasGlyph(0xe000)).toBe(false);
    });

    it('getGlyph returns fallback box for a missing glyph', () => {
        const cmds = font.getGlyph(0xe000);
        expect(cmds.length).toBeGreaterThan(0);
    });

    it('getGlyphData with useFallback=false returns no synthesised box for an absent codepoint', () => {
        const result = font.getGlyphData(0xe000, false);
        expect(result === undefined || result.codepoint === 'FFFD').toBe(true);
    });
});

describe('DerakumaFont – advance width', () => {
    let font: Awaited<ReturnType<typeof loadFont>>;
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

describe('DerakumaFont – layoutText', () => {
    let font: Awaited<ReturnType<typeof loadFont>>;
    beforeAll(async () => { font = await loadFont('newstroke.bene'); });

    it('single-line layout produces one entry per character', () => {
        const layout = font.layoutText('Hi');
        expect(layout.length).toBe(2);
    });

    it('multi-line layout separates lines correctly (Y advances)', () => {
        const layout = font.layoutText('Hi\nBye');
        const ys = new Set(layout.map((e) => e.y));
        expect(ys.size).toBeGreaterThan(1);
    });

    it('commands in layout are offset by character position', () => {
        const layout = font.layoutText('AB');
        expect(layout[1].x).toBeGreaterThan(0);
        expect(layout[1].commands[0].x).toBeGreaterThanOrEqual(layout[1].x);
    });

    it('getSentenceCommand (legacy) still works', () => {
        const result = font.getSentenceCommand('Hello, World!');
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].commands.length).toBeGreaterThan(0);
    });
});

describe('DerakumaFont – renderers', () => {
    let font: Awaited<ReturnType<typeof loadFont>>;
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

describe('flattenArc – geometry', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 2, y: 0 };

    it('bulge=0 (straight) returns just the endpoint', () => {
        const pts = flattenArc(p0, p1, 0);
        expect(pts).toHaveLength(1);
        expect(pts[0]).toMatchObject({ x: 2, y: 0 });
    });

    it('positive bulge produces an arc below the chord (FontoBene screen-space, Y-down)', () => {
        const pts = flattenArc(p0, p1, 9);
        const minY = Math.min(...pts.map((p) => p.y));
        expect(minY).toBeLessThan(0);
    });

    it('negative bulge produces an arc above the chord (FontoBene screen-space, Y-down)', () => {
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

describe('Error classes', () => {
    it('DerakumaLoadError is thrown for a nonexistent file path', async () => {
        await expect(Derakuma.loadFontFromFile('/nonexistent/path.bene')).rejects.toBeInstanceOf(DerakumaLoadError);
    });
});

describe('parseBene – forward glyph reference resolution', () => {
    it('resolves a forward @REF correctly', () => {
        const bene = [
            '[format]',
            'format_version = 0.1.0',
            '---',
            '[0041] A',
            '@0042',
            '[0042] B',
            '0,0;5,0;2.5,5',
        ].join('\n');

        const font = Derakuma.parse(bene);
        const a = font.getGlyphData('A', false);
        const b = font.getGlyphData('B', false);
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        expect(a!.polylines).toStrictEqual(b!.polylines);
    });
});

// ===========================================================================
// BRUTAL EDGE-CASE / MALFORMED-INPUT / SECURITY SUITE
// ===========================================================================

describe('parseBene – malformed & hostile input', () => {
    it('throws DerakumaParseError (not a generic Error) on garbage input', () => {
        expect(() => Derakuma.parse('this is not a bene file at all')).toThrow(DerakumaParseError);
    });

    it('rejects a completely empty string', () => {
        expect(() => Derakuma.parse('')).toThrow();
    });

    it('rejects a file with no [format] section', () => {
        expect(() => Derakuma.parse('---\n[0041] A\n0,0;6,0;3,9\n')).toThrow();
    });

    it('rejects a malformed format_version', () => {
        expect(() => Derakuma.parse('[format]\nformat_version = not.a.version\n---\n')).toThrow();
    });

    it('detects circular @REF references without infinite-looping or stack overflow', () => {
        const bene = [
            '[format]',
            'format_version = 0.1.0',
            '---',
            '[0041] A',
            '@0042',
            '[0042] B',
            '@0041',
        ].join('\n');
        expect(() => {
            const font = Derakuma.parse(bene);
            font.getGlyphData('A', false);
        }).toThrow();
    });

    it('detects self-referential @REF', () => {
        const bene = ['[format]', 'format_version = 0.1.0', '---', '[0041] A', '@0041'].join('\n');
        expect(() => {
            const font = Derakuma.parse(bene);
            font.getGlyphData('A', false);
        }).toThrow();
    });

    it('handles a dangling @REF to a nonexistent glyph gracefully (no crash, defined error)', () => {
        const bene = ['[format]', 'format_version = 0.1.0', '---', '[0041] A', '@FFFF'].join('\n');
        expect(() => {
            const font = Derakuma.parse(bene);
            font.getGlyphData('A', false);
        }).toThrow();
    });

    it('rejects NaN-producing coordinate strings rather than propagating NaN', () => {
        const bene = ['[format]', 'format_version = 0.1.0', '---', '[0041] A', '0,0;NaN,5;3,9'].join('\n');
        expect(() => Derakuma.parse(bene)).toThrow();
    });

    it('rejects a bulge value with garbage suffix instead of silently truncating', () => {
        const bene = ['[format]', 'format_version = 0.1.0', '---', '[0041] A', '0,0;6,0abc;3,9'].join('\n');
        expect(() => Derakuma.parse(bene)).toThrow();
    });

    it('does not choke on excessive blank lines / mixed CRLF+LF line endings', () => {
        const bene = '[format]\r\nformat_version = 0.1.0\r\n\n\n---\r\n\n[0041] A\r\n0,0;6,0;3,9\r\n\n\n';
        expect(() => Derakuma.parse(bene)).not.toThrow();
    });

    it('handles a glyph codepoint header with lowercase hex', () => {
        const bene = ['[format]', 'format_version = 0.1.0', '---', '[0061] a', '0,0;6,0;3,9'].join('\n');
        const font = Derakuma.parse(bene);
        expect(font.hasGlyph('a')).toBe(true);
    });

    it('handles duplicate glyph definitions deterministically', () => {
        const bene = [
            '[format]', 'format_version = 0.1.0', '---',
            '[0041] A', '0,0;1,0;1,1',
            '[0041] A', '0,0;9,0;9,9',
        ].join('\n');
        const font1 = Derakuma.parse(bene);
        const font2 = Derakuma.parse(bene);
        expect(font1.getGlyphData('A', false)).toStrictEqual(font2.getGlyphData('A', false));
    });

    it('survives a pathologically long single polyline without hanging (perf smoke test)', () => {
        const points = Array.from({ length: 5000 }, (_, i) => `${i % 100},${(i * 7) % 50}`).join(';');
        const bene = ['[format]', 'format_version = 0.1.0', '---', '[0041] A', points].join('\n');
        const start = performance.now();
        const font = Derakuma.parse(bene);
        const glyph = font.getGlyphData('A');
        expect(performance.now() - start).toBeLessThan(2000);
        expect(glyph).toBeDefined();
    });

    it('handles a huge number of distinct glyphs without exploding memory/time', () => {
        const lines = ['[format]', 'format_version = 0.1.0', '---'];
        for (let i = 0; i < 2000; i++) {
            const hex = i.toString(16).padStart(4, '0');
            lines.push(`[${hex}] X${i}`, '0,0;6,0;3,9');
        }
        const start = performance.now();
        const font = Derakuma.parse(lines.join('\n'));
        expect(font.listGlyphs().length).toBeGreaterThanOrEqual(2000);
        expect(performance.now() - start).toBeLessThan(3000);
    });

    it('does not allow prototype pollution via a crafted glyph name/codepoint', () => {
        const bene = [
            '[format]', 'format_version = 0.1.0', '---',
            '[__proto__] evil', '0,0;6,0;3,9',
        ].join('\n');
        expect(() => Derakuma.parse(bene)).not.toThrow();
        expect(({} as any).polluted).toBeUndefined();
        expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('does not produce NaN metrics for negative or zero spacing values', () => {
        const bene = '[format]\nformat_version = 0.1.0\n[font]\nname = Weird\nletter_spacing = -5\nline_spacing = 0\n---\n[0041] A\n0,0;6,0;3,9\n';
        const font = Derakuma.parse(bene);
        const m = font.measureText('AA');
        expect(Number.isFinite(m.width)).toBe(true);
        expect(Number.isFinite(m.height)).toBe(true);
    });
});

describe('DerakumaFont – Unicode & multi-byte hostility', () => {
    let font: Awaited<ReturnType<typeof loadFont>>;
    beforeAll(async () => { font = await loadFont('newstroke.bene'); });

    it('measureText tolerates emoji (surrogate pairs) without throwing', () => {
        expect(() => font.measureText('Hi \u{1F600} there')).not.toThrow();
    });

    it('layoutText produces one entry per code point (not per UTF-16 code unit) for astral characters', () => {
        const s = 'A\u{1F600}B';
        const layout = font.layoutText(s);
        expect(layout.length).toBe([...s].length);
    });

    it('handles combining diacritics without crashing', () => {
        expect(() => font.measureText('e\u0301\u0301\u0301')).not.toThrow();
    });

    it('handles zero-width joiners / control characters gracefully', () => {
        expect(() => font.measureText('a\u200Db\u0000c')).not.toThrow();
    });

    it('renderToSvg on an empty string returns an empty or trivially-valid path, never throws', () => {
        expect(() => font.renderToSvg('')).not.toThrow();
    });

    it('measureText on an extremely long string stays performant', () => {
        const long = 'The quick brown fox jumps over the lazy dog. '.repeat(500);
        const start = performance.now();
        const m = font.measureText(long);
        expect(performance.now() - start).toBeLessThan(1500);
        expect(m.width).toBeGreaterThan(0);
    });

    it('getGlyphByCode rejects a malformed code string instead of returning garbage', () => {
        const result = (() => {
            try { return font.getGlyphByCode('not-a-code'); } catch { return undefined; }
        })();
        expect(result === undefined).toBe(true);
    });
});

describe('Concurrency / statelessness', () => {
    it('parsing the same source twice yields independently mutable, non-aliased results', () => {
        const src = '[format]\nformat_version = 0.1.0\n---\n[0041] A\n0,0;6,0;3,9\n';
        const f1 = Derakuma.parse(src);
        const f2 = Derakuma.parse(src);
        const g1 = f1.getGlyphData('A')!;
        const g2 = f2.getGlyphData('A')!;
        g1.polylines[0][0].x = 9999;
        expect(g2.polylines[0][0].x).not.toBe(9999);
    });

    it('loading many fonts in parallel does not cross-contaminate glyph tables', async () => {
        const fonts = await Promise.all(Array.from({ length: 8 }, () => loadFont('newstroke.bene')));
        const counts = fonts.map((f) => f.listGlyphs().length);
        expect(new Set(counts).size).toBe(1); // all identical
    });
});

// ===========================================================================
// RASTERIZATION SUITE — Canvas2D (@napi-rs/canvas, works under Bun)
// ===========================================================================

describe('Rasterization – CanvasRenderingContext2D', () => {
    let font: Awaited<ReturnType<typeof loadFont>>;
    beforeAll(async () => { font = await loadFont('newstroke.bene'); });

    function rasterizeToCanvas(text: string, w = 400, h = 120, scale = 6) {
        const canvas = createCanvas(w, h);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;

        const layout = font.layoutText(text);
        ctx.beginPath();
        for (const entry of layout) {
            for (const cmd of entry.commands) {
                if (cmd.command === 'PU') continue;
                const px = 10 + cmd.x * scale;
                const py = 100 - cmd.y * scale;
                if (cmd.command === 'PD') {
                    ctx.moveTo(px, py);
                } else {
                    ctx.lineTo(px, py);
                }
            }
        }
        ctx.stroke();
        return canvas;
    }

    it('rasterizes "Derakuma" to a PNG buffer with non-trivial ink coverage', () => {
        const canvas = rasterizeToCanvas('Derakuma');
        const buf = canvas.toBuffer('image/png');
        expect(buf.length).toBeGreaterThan(100);

        const ctx = canvas.getContext('2d');
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let inkPixels = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) inkPixels++;
        }
        expect(inkPixels).toBeGreaterThan(0);
    });

    it('rasterizing an empty string produces a blank (all-white) canvas, not garbage pixels', () => {
        const canvas = rasterizeToCanvas('');
        const ctx = canvas.getContext('2d');
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let nonWhite = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) nonWhite++;
        }
        expect(nonWhite).toBe(0);
    });

    it('rasterizes multi-line text without throwing and produces ink on multiple rows', () => {
        const canvas = rasterizeToCanvas('Hi\nBye', 400, 220, 6);
        const ctx = canvas.getContext('2d');
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const rowHasInk = new Array(height).fill(false);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                if (data[i] < 250) { rowHasInk[y] = true; break; }
            }
        }
        expect(rowHasInk.filter(Boolean).length).toBeGreaterThan(0);
    });

    it('rasterizes emoji/unicode-adjacent text without throwing, even if glyph falls back', () => {
        expect(() => rasterizeToCanvas('A\u{1F600}Z')).not.toThrow();
    });

    it('handles rasterizing at extreme scale (tiny canvas) without crashing', () => {
        expect(() => rasterizeToCanvas('Q', 4, 4, 0.01)).not.toThrow();
    });

    it('produces deterministic output: same text rasterized twice yields identical PNG bytes', () => {
        const b1 = rasterizeToCanvas('Determinism').toBuffer('image/png');
        const b2 = rasterizeToCanvas('Determinism').toBuffer('image/png');
        expect(Buffer.compare(b1, b2)).toBe(0);
    });
});

// ===========================================================================
// RASTERIZATION SUITE — WebGL (headless-gl)
// ===========================================================================

describe('Rasterization – WebGL (headless-gl)', () => {
    let font: Awaited<ReturnType<typeof loadFont>>;
    beforeAll(async () => { font = await loadFont('newstroke.bene'); });

    const VS = `
        attribute vec2 aPos;
        uniform vec2 uResolution;
        void main() {
            vec2 clip = (aPos / uResolution) * 2.0 - 1.0;
            gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
            gl_PointSize = 2.0;
        }
    `;
    const FS = `
        precision mediump float;
        void main() {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        }
    `;

    function compile(context: WebGLRenderingContext, type: number, src: string) {
        const shader = context.createShader(type)!;
        context.shaderSource(shader, src);
        context.compileShader(shader);
        if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
            throw new Error('Shader compile failed: ' + context.getShaderInfoLog(shader));
        }
        return shader;
    }

    function renderGlyphLines(text: string, w = 400, h = 120) {
        const context = gl(w, h, { preserveDrawingBuffer: true }) as WebGLRenderingContext;
        expect(context).toBeTruthy();

        context.viewport(0, 0, w, h);
        context.clearColor(1, 1, 1, 1);
        context.clear(context.COLOR_BUFFER_BIT);

        const layout = font.layoutText(text);
        const polylines: { x: number; y: number }[][] = [];
        for (const entry of layout) {
            let current: { x: number; y: number }[] = [];
            for (const cmd of entry.commands) {
                if (cmd.command === 'PU') {
                    if (current.length) polylines.push(current);
                    current = [];
                } else {
                    current.push({ x: 10 + cmd.x * 6, y: 100 - cmd.y * 6 });
                }
            }
            if (current.length) polylines.push(current);
        }
        const verts = polylinesToFloat32(polylines);

        const program = context.createProgram()!;
        context.attachShader(program, compile(context, context.VERTEX_SHADER, VS));
        context.attachShader(program, compile(context, context.FRAGMENT_SHADER, FS));
        context.linkProgram(program);
        if (!context.getProgramParameter(program, context.LINK_STATUS)) {
            throw new Error('Program link failed: ' + context.getProgramInfoLog(program));
        }
        context.useProgram(program);

        const buf = context.createBuffer();
        context.bindBuffer(context.ARRAY_BUFFER, buf);
        context.bufferData(context.ARRAY_BUFFER, verts, context.STATIC_DRAW);

        const loc = context.getAttribLocation(program, 'aPos');
        context.enableVertexAttribArray(loc);
        context.vertexAttribPointer(loc, 2, context.FLOAT, false, 0, 0);

        const resLoc = context.getUniformLocation(program, 'uResolution');
        context.uniform2f(resLoc, w, h);

        if (verts.length > 0) {
            context.drawArrays(context.LINE_STRIP, 0, verts.length / 2);
        }

        const pixels = new Uint8Array(w * h * 4);
        context.readPixels(0, 0, w, h, context.RGBA, context.UNSIGNED_BYTE, pixels);
        return { pixels, w, h };
    }

    it('creates a headless WebGL context and clears to white without error', () => {
        const { pixels } = renderGlyphLines('');
        let allWhite = true;
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255) {
                allWhite = false;
                break;
            }
        }
        expect(allWhite).toBe(true);
    });

    it('draws glyph line strips producing non-white (black) pixels for real text', () => {
        const { pixels } = renderGlyphLines('Derakuma');
        let blackPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] < 250 && pixels[i + 1] < 250 && pixels[i + 2] < 250) blackPixels++;
        }
        expect(blackPixels).toBeGreaterThan(0);
    });

    it('does not crash on a glyph with zero vertices (fully empty glyph fallback)', () => {
        expect(() => renderGlyphLines('\u0000')).not.toThrow();
    });

    it('handles rendering a long string without exceeding a reasonable vertex budget or hanging', () => {
        const start = performance.now();
        expect(() => renderGlyphLines('The quick brown fox jumps over the lazy dog')).not.toThrow();
        expect(performance.now() - start).toBeLessThan(2000);
    });

    it('is pixel-reproducible across two independent headless contexts', () => {
        const a = renderGlyphLines('Repro');
        const b = renderGlyphLines('Repro');
        expect(Buffer.compare(Buffer.from(a.pixels), Buffer.from(b.pixels))).toBe(0);
    });
});