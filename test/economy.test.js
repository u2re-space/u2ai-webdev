/**
 * @file test/economy.test.js
 * @module test/economy
 * @purpose The tests of the tools that save the tokens: the line numbers, the patch by the
 *          line numbers, the batch of actions and the moment of the read in the context.
 * @depends node:test, node:fs/promises, agent/fs-tools, agent/tools
 * @ai.tags test, tools, tokens
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';

import { findLines, patchFile, readTextFile } from '../src/agent/fs-tools.js';
import { createToolset } from '../src/agent/tools.js';
import { defaults } from '../src/config.js';

const SOURCE = [
    ':root {',
    '  --color-bg: #101014;',
    '  --color-text: #f0f0f0;',
    '}',
    '',
    '.page {',
    '  display: grid;',
    '  grid-template-columns: 362px 1fr 158px;',
    '}',
].join('\n');

/**
 * A project with one stylesheet.
 * @returns {Promise<{ root: string, cleanup: () => Promise<void> }>}
 */
async function project() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-economy-'));
    await writeFile(path.join(root, 'styles.scss'), SOURCE, 'utf8');
    return {
        root,
        cleanup: async () => {
            const { rm } = await import('node:fs/promises');
            await rm(root, { recursive: true, force: true });
        },
    };
}

test('the lines of a file are found by their number', async () => {
    const { root, cleanup } = await project();
    try {
        const found = await findLines({ root, file: 'styles.scss', text: 'grid-template-columns' });
        assert.equal(found.rel, 'styles.scss');
        assert.equal(found.hits.length, 1);
        assert.equal(found.hits[0].line, 8);
        assert.match(found.hits[0].text, /362px/);
        assert.equal(found.totalLines, 9);

        // A regular expression finds the same place by a shape.
        const byRegex = await findLines({ root, file: 'styles.scss', text: '--color-\\w+', regex: true });
        assert.equal(byRegex.hits.length, 2);

        // Nothing found is not an error: the answer says so.
        const none = await findLines({ root, file: 'styles.scss', text: 'there is no such thing' });
        assert.deepEqual(none.hits, []);
    } finally {
        await cleanup();
    }
});

test('a patch changes the lines it names and leaves the others alone', async () => {
    const { root, cleanup } = await project();
    try {
        const result = await patchFile({
            root,
            file: 'styles.scss',
            edits: [{ startLine: 8, endLine: 8, text: '  grid-template-columns: 362px 1fr 158px;' }],
        });
        assert.equal(result.applied, 1);
        assert.equal(result.lines, 1);
        const text = await readFile(path.join(root, 'styles.scss'), 'utf8');
        // The file kept every other line: the patch carries only what it changes.
        assert.match(text, /--color-bg: #101014;/);
        assert.match(text, /grid-template-columns: 362px 1fr 158px;/);
        assert.equal(text.split('\n').length, SOURCE.split('\n').length);
    } finally {
        await cleanup();
    }
});

test('a patch with many edits keeps the numbers of the other lines', async () => {
    const { root, cleanup } = await project();
    try {
        await patchFile({
            root,
            file: 'styles.scss',
            edits: [
                { startLine: 2, endLine: 2, text: '  --color-bg: #111115;' },
                { startLine: 8, endLine: 8, text: '  grid-template-columns: 1fr;' },
            ],
        });
        const lines = (await readFile(path.join(root, 'styles.scss'), 'utf8')).split('\n');
        assert.match(lines[1], /#111115/);
        assert.match(lines[7], /1fr/);
        assert.match(lines[2], /--color-text/);
    } finally {
        await cleanup();
    }
});

test('a patch that names a line that is not there changes nothing', async () => {
    const { root, cleanup } = await project();
    try {
        await assert.rejects(
            () => patchFile({ root, file: 'styles.scss', edits: [{ startLine: 99, endLine: 99, text: 'x' }] }),
            /нет в файле/,
        );
        await assert.rejects(
            () => patchFile({ root, file: 'styles.scss', edits: [] }),
            /Патч пуст/,
        );
        assert.equal(await readFile(path.join(root, 'styles.scss'), 'utf8'), SOURCE);
    } finally {
        await cleanup();
    }
});

test('the read of a part of a file says which lines it has read', async () => {
    const { root, cleanup } = await project();
    try {
        const read = await readTextFile({ root, file: 'styles.scss', startLine: 2, endLine: 4 });
        assert.equal(read.from, 2);
        assert.equal(read.to, 4);
        assert.equal(read.totalLines, 9);
        assert.match(read.text, /строки 2-4 из 9/);
        assert.match(read.text, /^2\|/m);
        assert.doesNotMatch(read.text, /^5\|/m);
    } finally {
        await cleanup();
    }
});

test('the toolset finds the line, patches it and remembers the read', async () => {
    const { root, cleanup } = await project();
    try {
        const facts = new Map();
        const context = {
            set: async (key, value) => { facts.set(key, value); },
            action: async () => {},
        };
        const tools = createToolset({ root, config: structuredClone(defaults), context, role: 'styler' });

        const found = await tools.execute('find_line', { path: 'styles.scss', text: 'grid-template-columns' });
        assert.match(found, /8\|/);
        assert.match(found, /найдено строк: 1/);

        const patched = await tools.execute('patch_file', {
            path: 'styles.scss',
            edits: [{ startLine: 8, endLine: 8, text: '  grid-template-columns: 1fr;' }],
        });
        assert.match(patched, /изменён/);
        assert.match(await readFile(path.join(root, 'styles.scss'), 'utf8'), /grid-template-columns: 1fr;/);

        // The moment of the read goes into the context of the run.
        await tools.execute('read_file', { path: 'styles.scss', startLine: 1, endLine: 3 });
        assert.ok(facts.has('read:styles.scss'), [...facts.keys()].join(','));
        assert.equal(facts.get('read:styles.scss').from, 1);
        assert.equal(facts.get('read:styles.scss').to, 3);
        assert.equal(facts.get('read:styles.scss').linesRead, 3);
        assert.ok(facts.get('read:styles.scss').firstAt);
        assert.ok(facts.get('read:styles.scss').at);
    } finally {
        await cleanup();
    }
});

test('the moment of the read keeps every range of a file', async () => {
    const { root, cleanup } = await project();
    try {
        const facts = new Map();
        const context = {
            set: async (key, value) => { facts.set(key, value); },
            get: async (key) => facts.get(key),
            action: async () => {},
        };
        const tools = createToolset({ root, config: structuredClone(defaults), context, role: 'styler' });

        await tools.execute('read_file', { path: 'styles.scss', startLine: 1, endLine: 2 });
        await tools.execute('read_file', { path: 'styles.scss', startLine: 6, endLine: 7 });
        const fact = facts.get('read:styles.scss');
        // The second read does not wipe the first one.
        assert.equal(fact.ranges.length, 2);
        assert.equal(fact.from, 1);
        assert.equal(fact.to, 7);
        assert.equal(fact.linesRead, 4);

        // A write says that what was read is not what is on the disk any more.
        await tools.execute('patch_file', {
            path: 'styles.scss',
            edits: [{ startLine: 1, endLine: 1, text: ':root {' }],
        });
        assert.equal(facts.get('read:styles.scss').changed, true);
        assert.equal(facts.get('read:styles.scss').ranges.length, 0);
    } finally {
        await cleanup();
    }
});

test('a batch runs several actions in one call', async () => {
    const { root, cleanup } = await project();
    try {
        const tools = createToolset({ root, config: structuredClone(defaults), role: 'styler' });
        const answer = await tools.execute('batch', {
            actions: [
                { tool: 'find_line', args: { path: 'styles.scss', text: '--color-bg' } },
                { tool: 'read_file', args: { path: 'styles.scss', startLine: 1, endLine: 3 } },
                { tool: 'patch_file', args: { path: 'styles.scss', edits: [{ startLine: 2, endLine: 2, text: '  --color-bg: #000;' }] } },
            ],
        });
        assert.match(answer, /# 1 find_line/);
        assert.match(answer, /# 2 read_file/);
        assert.match(answer, /# 3 patch_file/);
        assert.match(await readFile(path.join(root, 'styles.scss'), 'utf8'), /--color-bg: #000;/);
    } finally {
        await cleanup();
    }
});

test('a batch does not run the batch itself, nor a command', async () => {
    const { root, cleanup } = await project();
    try {
        const tools = createToolset({ root, config: structuredClone(defaults), role: 'styler' });
        const answer = await tools.execute('batch', {
            actions: [
                { tool: 'batch', args: { actions: [] } },
                { tool: 'run_command', args: { command: 'node' } },
                { tool: 'list_files', args: { path: '.' } },
            ],
        });
        assert.match(answer, /в пакете не выполняется/);
        assert.match(answer, /# 3 list_files/);
        await assert.rejects(() => tools.execute('batch', { actions: [] }), /Пакет пуст/);
    } finally {
        await cleanup();
    }
});

test('the roles that read and write know the cheap way', async () => {
    const styler = await import('../src/roles/styler.js');
    const coder = await import('../src/roles/coder.js');
    const markup = await import('../src/roles/markup.js');
    const { chunkText, chunksFor, PHASES } = await import('../src/roles/chunks.js');

    for (const role of [styler, coder, markup]) {
        // The tools are there, so the role may use them.
        assert.ok(role.tools.includes('find_line'), role.name);
        assert.ok(role.tools.includes('patch_file'), role.name);
        assert.ok(role.tools.includes('batch'), role.name);

        // And the instructions tell the role that the line is the address of a place: the
        // rules of the reading come with the beginning of the work, the rules of the
        // patching — with the write gate.
        const read = chunkText(chunksFor({ role: role.name, phase: PHASES.READ, files: ['index.html'] }));
        assert.match(read, /find_line/, role.name);
        assert.match(read, /startLine/, role.name);
        const write = chunkText(chunksFor({ role: role.name, phase: PHASES.WRITE, files: ['index.html'] }));
        assert.match(write, /patch_file/, role.name);
        assert.match(write, /batch/, role.name);
    }
});
