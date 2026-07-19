/**
 * Codes for PenCommand
 * PD = pen down
 * PU = pen up
 * MP = move pen
 */
export type PenCommand =
    | { command: 'PD'; x: number; y: number }
    | { command: 'PU'; x: number; y: number }
    | { command: 'MP'; x: number; y: number }

export enum FontLoadMethod {
    FETCH = 'fetch',
    FILE = 'file',
}

// Font metadata
export interface FontMetadata {
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

export interface Glyph {
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

interface ParsedGlyph {
    codepoint: string;
    char?: string;
    polylines: RawVector2[][];
    whitespace?: number;
}

// Bene file specs
const separator = '---';
const glyphHeaderRegex = /^\[([0-9A-Fa-f]{4,6})\]\s*(.*)$/;
const sectionRegex = /^\[(.+)\]$/;

export class DerakumaParser {
    public metadata: FontMetadata = {
        authors: [],
        licenses: [],
        letterSpacing: 0,
        lineSpacing: 9,
    }
    private glyphs = new Map<string, Glyph>();
    private loadPromiseFunc: Promise<void>;

    private async fetchBeneFile(url: string, method: FontLoadMethod): Promise<string> {
        const hasFetch = typeof fetch === 'function';
        let fetchError: Error | null = null;

        if (hasFetch && method === FontLoadMethod.FETCH) {
            try {
                const response = await fetch(url);
                if (response.ok) return await response.text();
                fetchError = new Error(`Woopsies! Failed to fetch ${url}! ${response.status} ${response.statusText}`);
            } catch (error) {
                fetchError = error as Error;
            }
            
            // Throw the fetch error if the fetch attempt failed
            throw fetchError;
        } 
        
        if (method === FontLoadMethod.FILE) {
            try {
                const { readFile } = await import('fs/promises');
                return await readFile(url, 'utf-8');
            } catch (error) {
                throw new Error(`Woopsies! Failed to read file ${url}! ${(error as Error).message}`);
            }
        }

        // Fallback if environment setup is wrong or an unsupported method is passed
        throw new Error(`Unsupported method or missing environment capabilities for ${url}`);
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
        const r = chordLen / (2 * Math.sin(halfTheta));
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        // Unit vector perpendicular to the chord (chord rotated +90deg).
        const perpX = -dy / chordLen;
        const perpY = dx / chordLen;
        const H = r * Math.cos(halfTheta);
        const cx = midX + perpX * H;
        const cy = midY + perpY * H;
        const radius = Math.hypot(p0.x - cx, p0.y - cy);
        const angle0 = Math.atan2(p0.y - cy, p0.x - cx);

        const segmentCount = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 18))); // ~10deg per segment
        const pts: Array<{ x: number; y: number }> = [];
        for (let s = 1; s <= segmentCount; s++) {
            const t = s / segmentCount;
            if (s === segmentCount) {
            pts.push({ x: p1.x, y: p1.y }); // snap the last point exactly to avoid float drift
            break;
            }
            const angle = angle0 + theta * t;
            pts.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
        }
        return pts;
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

    private resolveGlyph(parsed: ParsedGlyph): Glyph {
        const polylines = parsed.polylines.map(this.flattenPolyline.bind(this));
        let minX = Infinity;
        let maxX = -Infinity;
        for (const pl of polylines) {
            for (const pt of pl) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
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
            whitespace: parsed.whitespace ?? 0,
            minX,
            maxX,
        };
    }

    private applyHeader(header: Record<string, string[]>): void {
        const get = (k: string) => header[k]?.[0];
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

    private parseBene(rawContent: string): void {
        const lines = rawContent.split(/\r\n|\r|\n/);
        let i = 0;
        const header: Record<string, string[]> = {};
        let currentSection: string | null = null;

        for (; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line == separator) {
                i++;
                break;
            }
            if (line === '' || line.startsWith('#')) continue;

            const sectionMatch = line.match(sectionRegex);
            if (sectionMatch) {
                currentSection = sectionMatch[1].trim();
                continue;
            }

            const eq = line.indexOf('=');
            if (eq !== -1) continue;
            const key = `${currentSection}.${line.slice(0, eq).trim()}`;
            const value = line.slice(eq + 1).trim();
            (header[key] ??= []).push(value);
        }
        this.applyHeader(header);

        let current: ParsedGlyph | null = null;
        const commit = () => {
            if (!current) return;
            this.glyphs.set(current.codepoint, this.resolveGlyph(current));
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
                    char: glyphHeader[2] ? glyphHeader[2].trim() || undefined  : undefined,
                    polylines: [],  
                };
                continue;
            }
            if (!current) continue;
            if (line.startsWith('@')) {
                const referenceKey = line.slice(1).trim().toUpperCase();
                const reference = this.glyphs.get(referenceKey);
                if (reference) {
                    for (const polyline of reference.polylines) {
                        current.polylines.push(polyline.map((point) => ({x: point.x, y: point.y})));
                    }
                    current.whitespace = reference.whitespace;
                }
                continue;
            }
            if (line.startsWith('~')) {
                const value = parseFloat(line.slice(1).trim());
                current.whitespace = Number.isNaN(value) ? 0 : value;
                continue;
            }
            const points = this.parsePolylineLine(line);
            if (points.length) current.polylines.push(points);
        }
    }

    private async load(source: string, loadMethod: FontLoadMethod): Promise<void> {
        const rawContent = await this.fetchBeneFile(source, loadMethod);
        this.parseBene(rawContent);
    }

    private convertToCodepointKey(input: string | number): string {
        let cp: number;
        if (typeof input === 'number') {
            cp = input;
        } else if (Array.from(input).length === 1) {
            // Exactly one Unicode code point (handles surrogate pairs correctly).
            cp = input.codePointAt(0)!;
        } else if (/^[0-9A-Fa-f]{4,6}$/.test(input)) {
            // A literal hex codepoint string, e.g. "0041".
            return input.toUpperCase();
        } else {
            // Best effort: use the first code point.
            cp = input.codePointAt(0) ?? 0;
        }
        let hex = cp.toString(16).toUpperCase();
        if (hex.length < 4) hex = hex.padStart(4, '0');
        return hex;
    }

    private glyphToPenCommands(glyph: Glyph): PenCommand[] {
        const commands: PenCommand[] = [];
        for (const pl of glyph.polylines) {
            if (pl.length === 0) continue;
            commands.push({ command: 'PD', x: pl[0].x, y: pl[0].y });
            for (let i = 1; i < pl.length; i++) {
            commands.push({ command: 'MP', x: pl[i].x, y: pl[i].y });
            }
            const last = pl[pl.length - 1];
            commands.push({ command: 'PU', x: last.x, y: last.y });
        }
        return commands;
    }

    /**
     * @param source A path to a .bene file
     * @param loadMethod (optional) The method to load the .bene file. Defaults to 'fetch'. For local Node/Bun, use 'file'.
     */
    constructor(source: string, loadMethod: FontLoadMethod = FontLoadMethod.FETCH) {
        this.loadPromiseFunc = this.load(source, loadMethod);
    }
    
    ready(): Promise<void> {
        return this.loadPromiseFunc;
    }

    /**
     * @param character Either a single character (e.g. "A"), a Unicode codepoint (e.g. "0041"), or a hex codepoint (e.g. 0x41).
     * @returns Pen commands to be used. One PD/PU pair per glyph. Empty if not found or undefined.
     */
    async getGlyph(character: string | number): Promise<PenCommand[]> {
        const glyph = await this.getGlyphData(character);
        if (!glyph) return [];
        return this.glyphToPenCommands(glyph);
    }

    /**
     * Same as {@link getGlyph} but actually returns the resolved glyph data rather than pen commands.
     */
    async getGlyphData(character: string | number): Promise<Glyph | undefined> {
        await this.loadPromiseFunc;
        const key = this.convertToCodepointKey(character);
        return this.glyphs.get(key);
    }

    /**
     * Returns the horizontal advance to the next glyph's origin (the rightmost or `monospaceWidth` if defined, plus `letterSpacing`).
     */
    async getAdvance(character: string | number): Promise<number> {
        await this.loadPromiseFunc;
        const glyph = await this.getGlyphData(character);
        const width = this.metadata.monospaceWidth ?? (glyph ? Math.max(glyph.maxX, 0) : 0);
        const trailing = glyph?.whitespace ?? 0;
        return width + trailing + this.metadata.letterSpacing;
    }

    /**
     * @param text A whole sentence (can be separated with spaces)
     * @returns An array of `char`, `x` and their respective `commands`
     */
    async getSentenceCommand(text: string): Promise<Array<{ char: string; x: number; commands: PenCommand[] }>> {
        await this.loadPromiseFunc;
        const result: Array<{ char: string; x: number; commands: PenCommand[] }> = [];
        let cursor = 0;
        for (const char of text) {
            const commands = await this.getGlyph(char);
            const translated = commands.map((c) => ({ ...c, x: c.x + cursor }));
            result.push({ char, x: cursor, commands: translated });
            cursor += await this.getAdvance(char);
        }
        return result;
    }

    /**
     * List all available glyphs you can use
     */
    async listGlyphs(): Promise<string[]> {
        await this.loadPromiseFunc;
        return Array.from(this.glyphs.keys());
    }
}

export default DerakumaParser;