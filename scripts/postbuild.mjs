// esbuild (like tsc) emits a top-of-file "use strict"; directive, which would
// push the UserScript metadata block (required to be first) down a line, and
// esbuild also drops plain `//` comments from the bundle — so the header is
// kept out of the source entirely and stitched on here instead.
import { readFileSync, writeFileSync } from 'node:fs';

const outPath = new URL('../hinata.user.js', import.meta.url);
const headerPath = new URL('./header.txt', import.meta.url);

const header = readFileSync(headerPath, 'utf8');
const body = readFileSync(outPath, 'utf8').replace(/^"use strict";\n/, '');

writeFileSync(outPath, header + body);
