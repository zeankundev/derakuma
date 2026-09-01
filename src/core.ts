/**
 * Codes for PenCommand
 * PD = pen down
 * PU = pen up
 * MP = move pen
 */

/**
 * Internal-only duplicate of the public `PenCommand` type (see `types.ts`).
 * Not exported, to avoid colliding with the public symbol of the same name.
 */
type PenCommand =
    | { command: 'PD'; x: number; y: number }
    | { command: 'PU'; x: number; y: number }
    | { command: 'MP'; x: number; y: number }

export enum FontLoadMethod {
    FETCH = 'fetch',
    FILE = 'file',
}

/**
 * Internal-only duplicate of the public `FontMetadata` interface (see `types.ts`).
 * Not exported, to avoid colliding with the public symbol of the same name.
 */
interface FontMetadata {
    formatVersion?: string;
    id?: string;
    name?: string;
    description?: string;
    version?: string;
    authors: string[];
    licenses: string[];
    letterSpacing: number;
    lineSpacing: number;
    monospaceWidth?: number;
}

/**
 * Internal-only duplicate of the public `Glyph` interface (see `types.ts`).
 * Not exported, to avoid colliding with the public symbol of the same name.
 */
interface Glyph {
    codepoint: string;
    char?: string;
    polylines: Array<Array<{ x: number; y: number }>>;
    whitespace: number;
    minX: number;
    maxX: number;
}

interface RawVector2 {
    x: number;
    y: number;
    bulge?: number;
}

type ParsedGlyphInstruction =
    | { kind: 'polyline'; points: RawVector2[] }
    | { kind: 'reference'; codepoint: string }
    | { kind: 'whitespace'; value: number };

interface ParsedGlyph {
    codepoint: string;
    char?: string;
    instructions: ParsedGlyphInstruction[];
}

const separator = '---';
const glyphHeaderRegex = /^\[([0-9A-Fa-f]{4,6})\]\s*(.*)$/;
const sectionRegex = /^\[(.+)\]$/;

/**
 * @deprecated Internal legacy base parser kept for backward compatibility.
 * Prefer the public `Derakuma` and `DerakumaFont` API exported from `src/index.ts`.
 * @internal
 */
export abstract class _DEPRECATED_DoNotUse_DerakumaLegacy {
    public metadata: FontMetadata = {
        authors: [],
        licenses: [],
        letterSpacing: 0,
        lineSpacing: 9,
    };

    protected glyphs = new Map<string, Glyph>();
    protected loadPromiseFunc: Promise<this>;
    protected isInitialized = false;
    private fallbackGlyphCache: Glyph | null = null;
    private parsedGlyphs = new Map<string, ParsedGlyph>();

    protected abstract fetchBeneFile(url: string, method: FontLoadMethod | string, encoding: string): Promise<string>;
    protected abstract fetchBeneFileSync(url: string, encoding: string): string;

    protected constructor(
        source: string,
        loadMethod: FontLoadMethod | string = FontLoadMethod.FETCH,
        encoding: string = 'utf-8'
    ) {
        if (loadMethod === FontLoadMethod.FILE) {
            this.parseBene(this.fetchBeneFileSync(source, encoding));
            this.loadPromiseFunc = Promise.resolve(this);
        } else {
            this.loadPromiseFunc = this.load(source, loadMethod, encoding);
        }
    }

    ready(): Promise<this> {
        return this.loadPromiseFunc;
    }

    protected async load(source: string, loadMethod: FontLoadMethod | string, encoding: string): Promise<this> {
        const rawContent = await this.fetchBeneFile(source, loadMethod, encoding);
        this.parseBene(rawContent);
        return this;
    }

    private parsePolylineLine(line: string): RawVector2[] {
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

    private flattenArc(p0: { x: number; y: number }, p1: { x: number; y: number }, bulge: number): Array<{ x: number; y: number }> {
        const theta = (bulge * Math.PI) / 9;
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const chordLen = Math.hypot(dx, dy);

        if (Math.abs(theta) < 1e-9 || chordLen < 1e-9) return [{ x: p1.x, y: p1.y }];

        const halfTheta = theta / 2;
        const radius = chordLen / (2 * Math.sin(halfTheta));
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        const perpX = -dy / chordLen;
        const perpY = dx / chordLen;
        const offset = radius * Math.cos(halfTheta);
        const cx = midX + perpX * offset;
        const cy = midY + perpY * offset;
        const realRadius = Math.hypot(p0.x - cx, p0.y - cy);
        const angle0 = Math.atan2(p0.y - cy, p0.x - cx);

        const segmentCount = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 18)));
        const points: Array<{ x: number; y: number }> = [];
        for (let s = 1; s <= segmentCount; s++) {
            const t = s / segmentCount;
            if (s === segmentCount) {
                points.push({ x: p1.x, y: p1.y });
                break;
            }
            const angle = angle0 + theta * t;
            points.push({ x: cx + realRadius * Math.cos(angle), y: cy + realRadius * Math.sin(angle) });
        }
        return points;
    }

    private flattenPolyline(polyline: RawVector2[]): Array<{ x: number; y: number }> {
        const result: Array<{ x: number; y: number }> = [];
        for (let idx = 0; idx < polyline.length; idx++) {
            const p = polyline[idx];
            if (idx === 0) {
                result.push({ x: p.x, y: p.y });
                continue;
            }
            const prev = polyline[idx - 1];
            if (prev.bulge) {
                result.push(...this.flattenArc({ x: prev.x, y: prev.y }, { x: p.x, y: p.y }, prev.bulge));
            } else {
                result.push({ x: p.x, y: p.y });
            }
        }
        return result;
    }

    private resolveGlyph(parsed: ParsedGlyph, stack: string[] = []): Glyph {
        if (stack.includes(parsed.codepoint)) {
            throw new Error(`Circular glyph reference detected: ${[...stack, parsed.codepoint].join(' -> ')}`);
        }

        const mergedPolylines: RawVector2[][] = [];
        let whitespace: number | undefined;
        const nextStack = [...stack, parsed.codepoint];

        for (const instruction of parsed.instructions) {
            if (instruction.kind === 'polyline') {
                mergedPolylines.push(instruction.points.map((point) => ({ x: point.x, y: point.y, bulge: point.bulge })));
                continue;
            }

            if (instruction.kind === 'whitespace') {
                whitespace = instruction.value;
                continue;
            }

            const reference = this.parsedGlyphs.get(instruction.codepoint);
            if (!reference) continue;
            const resolved = this.resolveGlyph(reference, nextStack);
            for (const polyline of resolved.polylines) {
                mergedPolylines.push(polyline.map((point) => ({ x: point.x, y: point.y })));
            }
            whitespace = resolved.whitespace;
        }

        const polylines = mergedPolylines.map((polyline) => this.flattenPolyline(polyline));
        let minX = Infinity;
        let maxX = -Infinity;
        for (const polyline of polylines) {
            for (const point of polyline) {
                if (point.x < minX) minX = point.x;
                if (point.x > maxX) maxX = point.x;
            }
        }
        if (!Number.isFinite(minX)) {
            minX = 0;
            maxX = 0;
        }

        return {
            codepoint: parsed.codepoint,
            char: parsed.char,
            polylines,
            whitespace: whitespace ?? 0,
            minX,
            maxX,
        };
    }

    private buildFallbackGlyph(): Glyph {
        if (this.fallbackGlyphCache) return this.fallbackGlyphCache;

        const height = this.metadata.lineSpacing > 0 ? this.metadata.lineSpacing : 9;
        const width = this.metadata.monospaceWidth ?? height * 0.6;

        const inset = Math.min(width, height) * 0.1;
        const x0 = inset;
        const x1 = Math.max(width - inset, x0 + 0.001);
        const y0 = inset;
        const y1 = Math.max(height - inset, y0 + 0.001);

        const box: RawVector2[] = [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
            { x: x0, y: y0 },
        ];
        const crossA: RawVector2[] = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
        const crossB: RawVector2[] = [{ x: x0, y: y1 }, { x: x1, y: y0 }];

        this.fallbackGlyphCache = this.resolveGlyph({
            codepoint: 'NOTDEF',
            char: undefined,
            instructions: [
                { kind: 'polyline', points: box },
                { kind: 'polyline', points: crossA },
                { kind: 'polyline', points: crossB },
            ],
        });
        return this.fallbackGlyphCache;
    }

    private applyHeader(header: Record<string, string[]>): void {
        const get = (key: string) => header[key]?.[0];
        this.metadata = {
            formatVersion: get('format.format_version'),
            id: get('font.id'),
            name: get('font.name'),
            description: get('font.description'),
            version: get('font.version'),
            authors: header['font.author'] ?? [],
            licenses: header['font.license'] ?? [],
            letterSpacing: parseFloat(get('font.letter_spacing') ?? '0') || 0,
            lineSpacing: get('font.line_spacing') !== undefined ? parseFloat(get('font.line_spacing')!) : 9,
            monospaceWidth: get('font.monospace_width') !== undefined ? parseFloat(get('font.monospace_width')!) : undefined,
        };
    }

    /**
     * Parses the raw `.bene` content and initializes the font data.
     * @param rawContent The raw `.bene` file content.
     * @deprecated Internal legacy parser for backward compatibility. Use `parse()`, `loadFontFromUrl()`, or `loadFontFromFile()` instead.
     * @internal
     */

    protected parseBene(rawContent: string): void {
        this.fallbackGlyphCache = null;
        this.glyphs.clear();
        this.parsedGlyphs.clear();
        const lines = rawContent.split(/\r\n|\r|\n/);
        let i = 0;
        const header: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
        let currentSection: string | null = null;
        let sawValidHeader = false;

        for (; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line == separator) {
                i++;
                break;
            }
            if (line === '' || line.startsWith('#')) continue;

            const sectionMatch = line.match(sectionRegex);
            if (sectionMatch) {
                const sectionName = sectionMatch[1].trim();
                if (sectionName === '__proto__' || sectionName === 'constructor' || sectionName === 'prototype') {
                    currentSection = null;
                    continue;
                }
                currentSection = sectionName;
                continue;
            }

            if (currentSection === null) continue;

            const eq = line.indexOf('=');
            if (eq === -1) continue;
            const rawKey = line.slice(0, eq).trim();
            if (rawKey === '__proto__' || rawKey === 'constructor' || rawKey === 'prototype') continue;
            const key = `${currentSection}.${rawKey}`;
            const value = line.slice(eq + 1).trim();
            sawValidHeader = true;
            (header[key] ??= []).push(value);
        }
        this.applyHeader(header);

        let current: ParsedGlyph | null = null;
        const commit = () => {
            if (!current) return;
            this.parsedGlyphs.set(current.codepoint, current);
        };

        for (; i < lines.length; i++) {
            const rawLine = lines[i];
            const line = rawLine.trim();
            if (line === '' || line.startsWith('#')) continue;
            const glyphHeader = line.match(glyphHeaderRegex);
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
            const points = this.parsePolylineLine(line);
            if (points.length) current.instructions.push({ kind: 'polyline', points });
        }
        commit();

        for (const parsed of this.parsedGlyphs.values()) {
            this.glyphs.set(parsed.codepoint, this.resolveGlyph(parsed));
        }
        this.isInitialized = true;
    }

    private convertToCodepointKey(input: string | number): string {
        let cp: number;
        if (typeof input === 'number') {
            cp = input;
        } else {
            const trimmed = input.trim();
            if (Array.from(trimmed).length === 1) {
                cp = trimmed.codePointAt(0)!;
            } else if (/^(?:U\+|0x)[0-9A-Fa-f]{1,6}$/.test(trimmed)) {
                cp = parseInt(trimmed.replace(/^(?:U\+|0x)/i, ''), 16);
            } else if (/^[0-9]{4,6}$/.test(trimmed)) {
                cp = parseInt(trimmed, 16);
            } else {
                cp = trimmed.codePointAt(0) ?? 0;
            }
        }

        let hex = cp.toString(16).toUpperCase();
        if (hex.length < 4) hex = hex.padStart(4, '0');
        return hex;
    }

    private glyphToPenCommands(glyph: Glyph): PenCommand[] {
        const commands: PenCommand[] = [];
        for (const polyline of glyph.polylines) {
            if (polyline.length === 0) continue;
            commands.push({ command: 'PD', x: polyline[0].x, y: polyline[0].y });
            for (let index = 1; index < polyline.length; index++) {
                commands.push({ command: 'MP', x: polyline[index].x, y: polyline[index].y });
            }
            const last = polyline[polyline.length - 1];
            commands.push({ command: 'PU', x: last.x, y: last.y });
        }
        return commands;
    }

    getGlyph(character: string | number): PenCommand[] {
        const glyph = this.getGlyphData(character);
        if (!glyph) return [];
        return this.glyphToPenCommands(glyph);
    }

    getGlyphData(character: string | number, useFallback: boolean = true): Glyph | undefined {
        if (!this.isInitialized) throw new Error('Derakuma is not initialized yet!');
        const key = this.convertToCodepointKey(character);
        let glyph = this.glyphs.get(key);
        if (!glyph && key !== 'FFFD') {
            glyph = this.glyphs.get('FFFD');
        }
        if (!glyph && useFallback) {
            glyph = this.buildFallbackGlyph();
        }
        return glyph;
    }

    hasGlyph(character: string | number): boolean {
        if (!this.isInitialized) throw new Error('Derakuma is not initialized yet!');
        const key = this.convertToCodepointKey(character);
        return this.glyphs.has(key) || this.glyphs.has('FFFD');
    }

    getAdvance(character: string | number): number {
        if (!this.isInitialized) throw new Error('Derakuma is not initialized yet!');
        const glyph = this.getGlyphData(character);
        const width = this.metadata.monospaceWidth ?? (glyph ? Math.max(glyph.maxX, 0) : 0);
        const trailing = glyph?.whitespace ?? 0;
        return width + trailing + this.metadata.letterSpacing;
    }

    getSentenceCommand(text: string): Array<{ char: string; x: number; commands: PenCommand[] }> {
        if (!this.isInitialized) throw new Error('Derakuma is not initialized yet!');
        const result: Array<{ char: string; x: number; commands: PenCommand[] }> = [];
        let cursor = 0;
        for (const char of text) {
            const commands = this.getGlyph(char);
            const translated = commands.map((command) => ({ ...command, x: command.x + cursor }));
            result.push({ char, x: cursor, commands: translated });
            cursor += this.getAdvance(char);
        }
        return result;
    }

    listGlyphs(): string[] {
        if (!this.isInitialized) throw new Error('Derakuma is not initialized yet!');
        return Array.from(this.glyphs.keys());
    }
}