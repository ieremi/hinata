import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/hinata.user.ts'],
    bundle: true,
    format: 'iife',
    target: 'es2021',
    outfile: 'hinata.user.js',
});
