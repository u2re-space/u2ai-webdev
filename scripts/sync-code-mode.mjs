#!/usr/bin/env node
/**
 * @file scripts/sync-code-mode.mjs
 * @module scripts/sync-code-mode
 * @purpose Copy the shared Code Mode modules of the house from the package that owns them.
 *
 *   The modules of Code Mode live in `@u2ai/subagent` and are vendored into the other
 *   packages, the way the house vendors `shared/worker.js` and `access/ramdisk.js`. The
 *   copies differ in three places, and each one is a line of this script:
 *
 *   - the import of the ramdisk — the server keeps it two levels up;
 *   - the name of the file of the sandbox in `bin/`;
 *   - the way from the module to the root of the package — the server is one level deeper.
 *
 *   The script copies the file and applies those three differences. It never invents a
 *   difference: a line that is not in the list below is an error, and the copy is not made.
 *
 * @depends node:fs/promises, node:path, node:url
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const house = path.resolve(root, '..', 'u2ai-subagent');

/**
 * The packages of the house that keep a copy of the modules of Code Mode.
 *
 * Each entry says where the copy lives and what has to be different in it.
 */
const COPIES = [
    {
        package: 'u2ai-webdev',
        target: 'src/shared',
        entryName: 'ai-webdev-code-mode-worker.js',
        ramdiskImport: '../access/ramdisk.js',
        agentImport: '../shared/code-mode.js',
        depth: ['..', '..'],
    },
    {
        package: 'u2ai-server',
        target: 'src/shared/house',
        entryName: 'ai-serve-code-mode-worker.js',
        ramdiskImport: '../../access/ramdisk.js',
        agentImport: '../shared/house/code-mode.js',
        depth: ['..', '..', '..'],
    },
    {
        package: 'u2ai-images',
        target: 'src/shared',
        entryName: 'ai-image-code-mode-worker.js',
        ramdiskImport: '../access/ramdisk.js',
        agentImport: '../shared/code-mode.js',
        depth: ['..', '..'],
    },
    {
        package: 'u2ai-measurer',
        target: 'src/shared',
        entryName: 'ai-measure-code-mode-worker.js',
        ramdiskImport: '../access/ramdisk.js',
        agentImport: '../shared/code-mode.js',
        depth: ['..', '..'],
    },
    {
        package: 'u2ai-decomposer',
        target: 'src/shared',
        entryName: 'ai-decompose-code-mode-worker.js',
        ramdiskImport: '../access/ramdisk.js',
        agentImport: '../shared/code-mode.js',
        depth: ['..', '..'],
    },
];

/** The modules that are copied. */
const MODULES = ['code-mode.js', 'code-libraries.js'];

/**
 * The agent module of Code Mode: the tool, the note and the runner.
 *
 * It is copied too, and the only difference is the path of the module of the sandbox.
 */
const AGENT_MODULE = 'code-mode.js';

/**
 * The differences of one copy, as the pairs of the text that is found and the text that
 * takes its place.
 *
 * A pair that is not found is an error: the owner of the module changed, and the copy must
 * not be made blindly.
 *
 * @param {object} copy the description of the copy
 * @param {string} name the name of the module
 * @returns {Array<[string, string]>}
 */
function differences(copy, name) {
    // The module of the libraries does not know the sandbox and the ramdisk: it only
    // holds the bridge to them, and it is the same in every package.
    if (name !== 'code-mode.js') return [];
    return [
        [
            "import { createRamdiskFileSystem, createSharedByteCache, allocateMemory, RAMDISK_LIMITS } from '../access/ramdisk.js';",
            `import { createRamdiskFileSystem, createSharedByteCache, allocateMemory, RAMDISK_LIMITS } from '${copy.ramdiskImport}';`,
        ],
        [
            "const CODE_MODE_ENTRY_NAME = 'ai-code-mode-worker.js';",
            `const CODE_MODE_ENTRY_NAME = '${copy.entryName}';`,
        ],
        [
            "const CODE_MODE_ENTRY_DEPTH = ['..', '..'];",
            `const CODE_MODE_ENTRY_DEPTH = [${copy.depth.map((part) => `'${part}'`).join(', ')}];`,
        ],
    ];
}

/**
 * The differences of the agent module: the path of the module of the sandbox.
 * @param {object} copy the description of the copy
 * @returns {Array<[string, string]>}
 */
function agentDifferences(copy) {
    return [
        [
            "import { CODE_MODE_LIMITS, runCodeModeWorker, createCodeModeSpec } from '../shared/code-mode.js';",
            `import { CODE_MODE_LIMITS, runCodeModeWorker, createCodeModeSpec } from '${copy.agentImport}';`,
        ],
    ];
}

let changed = 0;
for (const copy of COPIES) {
    for (const name of MODULES) {
        const source = path.join(house, 'src', 'shared', name);
        const target = path.join(root, '..', copy.package, copy.target, name);
        let text = await readFile(source, 'utf8');
        for (const [from, to] of differences(copy, name)) {
            if (!text.includes(from)) {
                console.error(`the copy of ${name} for ${copy.package} is out of date: the line is not there:`);
                console.error(`  ${from}`);
                process.exit(1);
            }
            text = text.replace(from, to);
        }
        const current = await readFile(target, 'utf8').catch(() => null);
        if (current === text) continue;
        await writeFile(target, text, 'utf8');
        console.log(`updated ${copy.package}/${copy.target}/${name}`);
        changed += 1;
    }
    // The agent module of Code Mode: the tool, the note and the runner.
    const agentSource = path.join(house, 'src', 'agent', AGENT_MODULE);
    const agentTarget = path.join(root, '..', copy.package, 'src', 'agent', AGENT_MODULE);
    let agentText = await readFile(agentSource, 'utf8');
    for (const [from, to] of agentDifferences(copy)) {
        if (!agentText.includes(from)) {
            console.error(`the copy of the agent module for ${copy.package} is out of date:`);
            console.error(`  ${from}`);
            process.exit(1);
        }
        agentText = agentText.replace(from, to);
    }
    const currentAgent = await readFile(agentTarget, 'utf8').catch(() => null);
    if (currentAgent !== agentText) {
        await writeFile(agentTarget, agentText, 'utf8');
        console.log(`updated ${copy.package}/src/agent/${AGENT_MODULE}`);
        changed += 1;
    }
}
console.log(changed ? `${changed} file(s) updated.` : 'the copies are up to date.');
