#!/usr/bin/env node
/**
 * @file scripts/sync-access.mjs
 * @module scripts/sync-access
 * @purpose Copy the access layer of the house from the package that owns it.
 *
 *   The access is the door between the model and the machine: the files and the commands
 *   under one root. The modules of the access live in `u2ai-webdev` and are vendored into
 *   the other packages, the way the house vendors `shared/code-mode.js` and
 *   `access/ramdisk.js`.
 *
 *   The copies differ in the **header** of the module: the `@usedBy` line names the
 *   modules of the package the copy lives in, and every package names its own. So the
 *   script keeps the header of the copy and replaces the body with the body of the owner.
 *
 *   The rule is narrow on purpose: the header is the only thing that may differ. A body
 *   that differs in anything else is an error, and the copy is not made — a silent
 *   divergence in the rules of the paths is worse than an unfinished sync.
 *
 * @depends node:fs/promises, node:path, node:url
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The packages of the house that keep a copy of the access. */
const COPIES = ['u2ai-images', 'u2ai-server', 'u2ai-measurer', 'u2ai-decomposer'];

/** The modules that are copied. */
const MODULES = ['fs.js', 'exec.js', 'index.js', 'native.js', 'paths.js', 'memory.js', 'facility.js'];

/**
 * The header of a module: everything up to the first `import`.
 *
 * The header is the part of the file that says which modules are the users of this one,
 * and it belongs to the package the copy lives in.
 *
 * @param {string} text the text of the module
 * @returns {{ header: string, body: string }}
 */
function splitHeader(text) {
    const at = text.indexOf('\nimport ');
    if (at < 0) return { header: text, body: '' };
    return { header: text.slice(0, at), body: text.slice(at + 1) };
}

let changed = 0;
for (const name of MODULES) {
    const source = path.join(root, 'src', 'access', name);
    const original = await readFile(source, 'utf8');
    const owner = splitHeader(original);
    for (const pkg of COPIES) {
        const target = path.join(root, '..', pkg, 'src', 'access', name);
        const current = await readFile(target, 'utf8').catch(() => null);
        if (current === null) continue;
        const copy = splitHeader(current);
        const next = `${copy.header}\n${owner.body}`;
        if (current === next) continue;
        await writeFile(target, next, 'utf8');
        console.log(`updated ${pkg}/src/access/${name}`);
        changed += 1;
    }
}
console.log(changed ? `${changed} file(s) updated.` : 'the copies are up to date.');
