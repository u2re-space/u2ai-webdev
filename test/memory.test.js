/**
 * @file test/memory.test.js
 * @module test/memory
 * @purpose Tests of the memory of the run: the files it keeps and the answers it reuses.
 * @depends node:test, node:assert, agent/memory, agent/context, agent/tools
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';

import { openMemory, memoryDirectory, memoryFilePath, memoryAnswerName } from '../src/agent/memory.js';
import { openContext } from '../src/agent/context.js';
import { createToolset } from '../src/agent/tools.js';
import { missingReferences } from '../src/stages/step.js';
import { defaults } from '../src/config/defaults.js';

async function tempDir() {
    return await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-memory-'));
}

test('the memory of the run keeps the text of a file', async () => {
    const root = await tempDir();
    try {
        const memory = openMemory({ root, config: defaults, id: 'run-1' });
        await memory.put('styles.scss', '$c: red;\n');
        // The memory of the процесса has it...
        assert.equal(await memory.get('styles.scss'), '$c: red;\n');
        assert.equal(await memory.has('styles.scss'), true);
        // ...and it is on the disk of the run too, so a continued run finds it.
        const dir = memoryDirectory(root, defaults, 'run-1');
        const stored = JSON.parse(await readFile(memoryFilePath(dir, 'styles.scss'), 'utf8'));
        assert.equal(stored.rel, 'styles.scss');
        assert.equal(stored.content, '$c: red;\n');
        // The files of the memory are known by their path in the проект.
        assert.ok((await memory.files()).includes('styles.scss'));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the memory of the run keeps the answer of a role', async () => {
    const root = await tempDir();
    try {
        const memory = openMemory({ root, config: defaults, id: 'run-2' });
        await memory.answer('styling', 'full', { files: [{ path: 'styles.scss', content: 'x' }] });
        const found = await memory.answers('styling', 'full');
        assert.equal(found.files[0].path, 'styles.scss');
        // The answer of another pass is another answer.
        assert.equal(await memory.answers('styling', 'draft'), null);
        assert.ok(memoryAnswerName('styling', 'full').includes('styling'));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('a file of the memory survives the close of the run and is found again', async () => {
    const root = await tempDir();
    try {
        const first = openMemory({ root, config: defaults, id: 'run-3' });
        await first.put('main.js', 'console.log(1);\n');
        // A new run of the same id — the memory of the disk is what it finds.
        const second = openMemory({ root, config: defaults, id: 'run-3' });
        assert.equal(await second.get('main.js'), 'console.log(1);\n');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('a file that the disk lost is read from the memory', async () => {
    const root = await tempDir();
    try {
        const memory = openMemory({ root, config: defaults, id: 'run-4' });
        await memory.put('styles.scss', '$c: blue;\n');
        const toolset = createToolset({ root, config: defaults, role: 'builder', context: { memory } });
        // The file is not on the disk...
        assert.equal(await readFile(path.join(root, 'styles.scss'), 'utf8').catch(() => null), null);
        // ...and the tool gives it from the memory.
        const answer = await toolset.execute('read_file', { path: 'styles.scss' });
        assert.match(answer, /из памяти прогона/);
        assert.match(answer, /\$c: blue/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the memory of the context holds the file the run wrote', async () => {
    const root = await tempDir();
    try {
        const context = await openContext({ root, config: defaults, id: 'run-5' });
        await context.file('styles.scss', '$c: green;\n');
        // The file is in the list of the files прогона...
        assert.ok(context.state.files.includes('styles.scss'));
        // ...and its text is in the memory.
        assert.equal(await context.memory.get('styles.scss'), '$c: green;\n');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the tool of the write puts the text of the file into the memory', async () => {
    const root = await tempDir();
    try {
        const context = await openContext({ root, config: defaults, id: 'run-6' });
        const toolset = createToolset({ root, config: defaults, role: 'builder', context });
        await toolset.execute('write_file', { path: 'main.js', content: 'console.log(2);\n' });
        // The file is on the disk...
        assert.equal(await readFile(path.join(root, 'main.js'), 'utf8'), 'console.log(2);\n');
        // ...and its text is in the memory of the run.
        assert.equal(await context.memory.get('main.js'), 'console.log(2);\n');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the memory does not keep a file that is too big', async () => {
    const root = await tempDir();
    try {
        const memory = openMemory({ root, config: defaults, id: 'run-7' });
        const huge = 'x'.repeat(5 * 1024 * 1024);
        assert.equal(await memory.put('big.txt', huge), null);
        assert.equal(await memory.has('big.txt'), false);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('a file that names a file that is not there is named', async () => {
    const root = await tempDir();
    try {
        // The case of the project: the skeleton of the code imports the styles, and the
        // styles are written by a later step.
        const missing = await missingReferences(
            root,
            "import './styles.scss';\n\nconst menu = document.querySelector('#menu');\n",
            { own: ['main.js'] },
        );
        assert.deepEqual(missing, ['styles.scss']);

        // The file is there — the name is not a problem.
        await writeFile(path.join(root, 'styles.scss'), '$c: red;\n', 'utf8');
        const after = await missingReferences(root, "import './styles.scss';", { own: ['main.js'] });
        assert.deepEqual(after, []);

        // The file itself does not reference itself.
        const self = await missingReferences(root, "import './main.js';", { own: ['main.js'] });
        assert.deepEqual(self, []);

        // The links to the outside are not files of the проект.
        const outside = await missingReferences(root, 'const a = "https://example.com/x.css";', {});
        assert.deepEqual(outside, []);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('a file that the disk lost comes back from the memory', async () => {
    const root = await tempDir();
    try {
        const context = await openContext({ root, config: defaults, id: 'run-8' });
        const toolset = createToolset({ root, config: defaults, role: 'builder', context });
        await toolset.execute('write_file', { path: 'styles.scss', content: '$c: red;\n' });
        // The disk loses the file — the run was interrupted, or somebody removed it.
        await rm(path.join(root, 'styles.scss'));
        // The memory still has it, and the tool gives it from there.
        assert.equal(await context.memory.has('styles.scss'), true);
        const answer = await toolset.execute('read_file', { path: 'styles.scss' });
        assert.match(answer, /из памяти прогона/);
        assert.match(answer, /\$c: red/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
