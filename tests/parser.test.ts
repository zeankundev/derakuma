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
    it('can fetch pen commands for a simple glyph', () => {
        expect(parsedFont.getGlyph('A')).toBeDefined();
        console.log(parsedFont.getGlyph('A'));
    });
    it('can fetch actual glyph data', () => {
        expect(parsedFont.getGlyphData('A')).toBeDefined();
        console.log(parsedFont.getGlyphData('A'));
    });
    it('can get the horizontal x advancement to the next glyph', () => {
        expect(parsedFont.getAdvance('A')).toBeDefined();
        console.log(parsedFont.getAdvance('A'));
    });
    it('can form proper glyph/pen commands from a sentence', () => {
        expect(parsedFont.getSentenceCommand('Hello, World!')).toBeDefined();
        console.log(parsedFont.getSentenceCommand('Hello, World!'));
    });
    it('can parse a proper Bene font under any encodings encountered', () => {
        const opengost = new DerakumaParser(path.join(__dirname, 'fixtures', 'opengost.bene'), 'file', 'utf-16le');
        expect(opengost).toBeDefined();
        expect(opengost.getGlyph('a')).toBeDefined();
        console.log(opengost);
        console.log(opengost.getGlyph('a'));
    });
});