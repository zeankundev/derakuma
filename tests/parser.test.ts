import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DerakumaParser } from '../src/index';

describe('Derakuma Parser', () => {
    const fontFilePath = path.join(__dirname, 'fixtures', 'newstroke.bene');
    const parsedFont = new DerakumaParser(fontFilePath, 'file');
    it('should parse a simple font file correctly', () => {
        expect(parsedFont).toBeDefined();
        console.log(parsedFont)
    });
    it('can fetch pen commands for a simple glyph', async () => {
        expect(await parsedFont.getGlyph('A')).toBeDefined();
        console.log(await parsedFont.getGlyph('A'));
    });
    it('can fetch actual glyph data', async () => {
        expect(await parsedFont.getGlyphData('A')).toBeDefined();
        console.log(await parsedFont.getGlyphData('A'));
    });
    it('can get the horizontal x advancement to the next glyph', async () => {
        expect(await parsedFont.getAdvance('A')).toBeDefined();
        console.log(await parsedFont.getAdvance('A'));
    });
    it('can form proper glyph/pen commands from a sentence', async () => {
        expect(await parsedFont.getSentenceCommand('Hello, World!')).toBeDefined();
        console.log(await parsedFont.getSentenceCommand('Hello, World!'));
    });
});