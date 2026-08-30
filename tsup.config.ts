import { defineConfig } from 'tsup';

// Note: dts generation is handled by a separate `tsc --emitDeclarationOnly` call
// in the build script, because tsup's built-in dts worker has compatibility issues
// with Bun's worker_threads implementation.

export default defineConfig([
    // -----------------------------------------------------------------------
    // 1. Main Node / bundler build  (ESM + CJS)
    //    All sub-path exports are included here.
    // -----------------------------------------------------------------------
    {
        entry: {
            'index':            'src/index.ts',
            'core/parser':      'src/core/parser.ts',
            'core/font':        'src/core/font.ts',
            'core/types':       'src/core/types.ts',
            'geometry/arc':     'src/geometry/arc.ts',
            'loaders/node':     'src/loaders/node.ts',
            'loaders/web':      'src/loaders/web.ts',
            'errors/index':     'src/errors/index.ts',
        },
        format: ['esm', 'cjs'],
        dts: false,
        sourcemap: true,
        splitting: false,
        clean: true,
        // Keep Node built-ins external so they don't pollute browser bundles
        external: ['node:fs', 'node:fs/promises', 'node:path', 'node:module'],
        // Don't try to bundle 'require' (used in the sync fallback)
        noExternal: [],
        esbuildOptions(opts) {
            opts.platform = 'neutral';
        },
    },

    // -----------------------------------------------------------------------
    // 2. Browser global bundle  (IIFE / UMD for <script> CDN usage)
    //    Targets window.Derakuma — no Node built-ins included.
    // -----------------------------------------------------------------------
    {
        entry: { 'web.global': 'src/web.ts' },
        format: ['iife'],
        globalName: 'DerakumaGlobal',
        dts: false,
        sourcemap: true,
        minify: true,
        // Exclude Node file-system loader from the browser bundle
        external: ['node:fs', 'node:fs/promises'],
        esbuildOptions(opts) {
            opts.platform = 'browser';
        },
        outDir: 'dist',
    },
]);
