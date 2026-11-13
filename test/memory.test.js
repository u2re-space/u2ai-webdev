/**
 * @file test/memory.test.js
 * @module test/memory
 * @purpose The tests of the permanent memory: the records, the scopes, the summaries of the
 *          files, the finished tasks and the link with the stages.
 * @depends node:test, node:path, node:fs/promises, memory, stages/collect, stages/learn
 * @ai.tags test, memory
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';

import {
    MEMORY_KINDS,
    MEMORY_SCOPES,
    openMemory,
    memoryFile,
    memoryContext,
    rememberLessons,
} from '../src/memory.js';
import { collectStage } from '../src/stages/collect.js';
import { learnStage } from '../src/stages/learn.js';

test('the kinds and the scopes of the memory are fixed', () => {
    assert.ok(MEMORY_KINDS.includes('pitfall'));
    assert.ok(MEMORY_KINDS.includes('decision'));
    assert.deepEqual(MEMORY_SCOPES, ['global', 'project']);
    assert.match(memoryFile('C:/home/.ai-webdev'), /memory\.db$/);
});

test('a record is remembered and found by the full-text search', () => {
    const memory = openMemory({ file: ':memory:', project: 'app' });
    const record = memory.remember({
        kind: 'convention',
        scope: 'project',
        text: 'The styles of the project live in src/styles/main.css.',
        tags: ['css', 'styles'],
        files: ['src/styles/main.css'],
        source: 'run:1',
    });
    assert.equal(record.kind, 'convention');
    assert.deepEqual(record.tags, ['css', 'styles']);

    const found = memory.recall('styles');
    assert.equal(found.length, 1);
    assert.equal(found[0].id, record.id);

    const none = memory.recall('kubernetes');
    assert.equal(none.length, 0);

    memory.close();
});

test('the scopes keep the records of a project apart', () => {
    const memory = openMemory({ file: ':memory:', project: 'app' });
    memory.remember({ kind: 'fact', scope: 'global', text: 'The user prefers dark themes.' });
    memory.remember({ kind: 'fact', scope: 'project', text: 'The project uses Vite.' });

    assert.equal(memory.recall('prefers', { scope: 'global' }).length, 1);
    assert.equal(memory.recall('prefers', { scope: 'project' }).length, 1);
    assert.equal(memory.recall('Vite', { scope: 'global' }).length, 0);
    assert.equal(memory.recall('Vite', { scope: 'project' }).length, 1);
    assert.equal(memory.list({ scope: 'project' }).length, 2);
    assert.equal(memory.list({ scope: 'global' }).length, 1);

    memory.close();
});

test('the records of another project are not seen', () => {
    const one = openMemory({ file: ':memory:', project: 'one' });
    const two = openMemory({ file: ':memory:', project: 'two' });
    one.remember({ kind: 'fact', scope: 'project', text: 'The first project uses SCSS.' });
    two.remember({ kind: 'fact', scope: 'project', text: 'The second project uses Tailwind.' });

    assert.equal(one.recall('Tailwind', { scope: 'project' }).length, 0);
    assert.equal(two.recall('SCSS', { scope: 'project' }).length, 0);
    assert.equal(two.recall('Tailwind', { scope: 'project' }).length, 1);

    one.close();
    two.close();
});

test('an unknown kind becomes a note and an empty text is refused', () => {
    const memory = openMemory({ file: ':memory:', project: 'app' });
    const record = memory.remember({ kind: 'unknown', text: 'Something.' });
    assert.equal(record.kind, 'note');
    assert.throws(() => memory.remember({ text: '  ' }), /не может быть пустым/);
    memory.close();
});

test('a record may be forgotten', () => {
    const memory = openMemory({ file: ':memory:', project: 'app' });
    const record = memory.remember({ kind: 'note', text: 'A note to forget.' });
    assert.equal(memory.forget(record.id), true);
    assert.equal(memory.forget(record.id), false);
    assert.equal(memory.list().length, 0);
    memory.close();
});

test('the summaries of the files are kept', () => {
    const memory = openMemory({ file: ':memory:', project: 'app' });
    memory.summarizeFile({ path: 'src/main.js', summary: 'The entry point.', bytes: 120 });
    memory.summarizeFile({ path: 'src/main.js', summary: 'The entry point, rewritten.', bytes: 140 });

    const summary = memory.fileSummary('src/main.js');
    assert.equal(summary.summary, 'The entry point, rewritten.');
    assert.equal(summary.bytes, 140);
    assert.equal(memory.fileSummaries().length, 1);
    assert.equal(memory.fileSummary('src/nothing.js'), null);

    memory.close();
});

test('the finished tasks are kept', () => {
    const memory = openMemory({ file: ':memory:', project: 'app' });
    memory.completeTask({ task: 'Make a landing.', runId: 'run-1', summary: 'Done.', files: ['index.html'] });
    const tasks = memory.recentTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].task, 'Make a landing.');
    assert.deepEqual(tasks[0].files, ['index.html']);
    memory.close();
});

test('the memory becomes the text the roles read', () => {
    const memory = openMemory({ file: ':memory:', project: 'app' });
    memory.remember({ kind: 'pitfall', scope: 'project', text: 'The build fails without the fonts.', files: ['vite.config.js'] });
    const text = memory.context({ query: 'build' });
    assert.match(text, /# What is already known/);
    assert.match(text, /\[pitfall\]/);
    assert.match(text, /vite\.config\.js/);
    assert.equal(memory.context({ query: 'nothing at all' }), '');

    memory.close();
});

test('a memory that is not there gives an empty context', () => {
    assert.equal(memoryContext(null), '');
    assert.equal(memoryContext({ context: () => { throw new Error('broken'); } }), '');
});

test('the lessons are written into the memory', () => {
    const memory = openMemory({ file: ':memory:', project: 'app' });
    const result = rememberLessons(memory, [
        { kind: 'fact', text: 'The project uses Vite.' },
        { kind: 'decision', text: 'The tokens live in tokens.css.' },
        { kind: 'nonsense', text: 'A note.' },
    ], { scope: 'project', source: 'run:1' });

    assert.equal(result.written, 3);
    assert.equal(result.warnings.length, 0);
    const records = memory.list();
    assert.equal(records.length, 3);
    assert.equal(records.filter((item) => item.kind === 'note').length, 1);

    const without = rememberLessons(null, [{ kind: 'fact', text: 'x' }]);
    assert.equal(without.written, 0);
    assert.ok(without.warnings.length);

    memory.close();
});

test('the collection reads the memory into the context of the roles', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-memory-'));
    const memory = openMemory({ file: ':memory:', project: root });
    memory.remember({ kind: 'fact', scope: 'project', text: 'The landing page of this project is in index.html.' });

    const collected = await collectStage({
        root,
        config: { inputs: {}, components: { dir: null, dbFile: null }, output: { work: './.tmp' } },
        task: 'Make a landing.',
        env: {},
        memory,
    });

    assert.match(collected.memory, /landing page/);
    assert.match(collected.text, /# What is already known/);

    memory.close();
});

test('the stage of the lessons writes them into the memory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-memory2-'));
    const memory = openMemory({ file: ':memory:', project: root });

    const client = {
        responses: {
            /**
             * @returns {Promise<object>}
             */
            async create() {
                return {
                    id: 'resp-1',
                    status: 'completed',
                    model: 'test-model',
                    output: [{
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: '- [fact] The project uses Vite.' }],
                    }],
                    output_text: '- [fact] The project uses Vite.',
                };
            },
        },
    };

    const result = await learnStage({
        client,
        config: { output: { work: './.tmp' }, memory: { scope: 'project' } },
        root,
        task: 'Make a landing.',
        runId: 'run-1',
        store: memory,
    });

    assert.equal(result.stored.written, 1);
    assert.equal(memory.list().length, 1);
    assert.equal(memory.list()[0].text, 'The project uses Vite.');

    memory.close();
});
