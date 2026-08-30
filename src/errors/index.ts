/**
 * Custom error hierarchy for Derakuma.
 * Provides structured, typed errors instead of generic `Error` instances.
 */

/** Base class for all Derakuma errors. */
export class DerakumaError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DerakumaError';
        // Restore prototype chain (required for extending built-ins in ES5 targets)
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown when a network or file load operation fails.
 * @property uri  - The URL or file path that failed to load.
 * @property statusCode - HTTP status code, if applicable.
 */
export class DerakumaLoadError extends DerakumaError {
    public readonly uri: string;
    public readonly statusCode?: number;

    constructor(uri: string, detail: string, statusCode?: number) {
        super(`Failed to load font from "${uri}": ${detail}`);
        this.name = 'DerakumaLoadError';
        this.uri = uri;
        this.statusCode = statusCode;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown when a `.bene` file contains a syntax error or unsupported construct.
 * @property lineNumber - The 1-indexed line number in the source where the error was detected.
 * @property snippet    - The raw line content that caused the error.
 */
export class DerakumaParseError extends DerakumaError {
    public readonly lineNumber?: number;
    public readonly snippet?: string;

    constructor(message: string, lineNumber?: number, snippet?: string) {
        const location = lineNumber !== undefined ? ` (line ${lineNumber})` : '';
        const hint = snippet !== undefined ? `\n  → ${snippet}` : '';
        super(`FontoBene parse error${location}: ${message}${hint}`);
        this.name = 'DerakumaParseError';
        this.lineNumber = lineNumber;
        this.snippet = snippet;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown when a synchronous method is called before the font has been loaded.
 * This guards against the async race hazard of calling `getGlyph()` before
 * `await font.ready()` (or `Derakuma.load()`) resolves.
 */
export class DerakumaNotReadyError extends DerakumaError {
    constructor() {
        super(
            'Derakuma font is not initialized yet. ' +
            'Await `font.ready()` or use `Derakuma.load(url)` / `Derakuma.parse(text)` instead.'
        );
        this.name = 'DerakumaNotReadyError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
