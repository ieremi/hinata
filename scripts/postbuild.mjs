// tsc unconditionally emits a top-of-file "use strict"; directive, which pushes
// the UserScript metadata block (required to be first) down a line. Strip it —
// the IIFE inside already declares its own 'use strict'.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../hinata.user.js', import.meta.url);
const content = readFileSync(path, 'utf8');
const stripped = content.replace(/^"use strict";\n/, '');

writeFileSync(path, stripped);
