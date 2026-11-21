/**
 * @file test/writes.test.js
 * @module test/writes
 * @purpose The tests of the writing of several files: the gate of the write, the calls of one
 *          turn and the files that stay on the disk.
 * @depends node:test, node:path, node:fs/promises, roles/index, stages/step
 * @ai.tags test, roles, tools, writes
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';

import { runRole } from '../src/roles/index.js';
import { runStepStage } from '../src/stages/step.js';
import { defaults } from '../src/config.js';

/**
 * A response with the calls of one turn.
 * @param {{ name: string, args: object }[]} calls the calls of the turn
 * @returns {object}
 */
function callsAnswer(calls) {
    return {
        id: 'resp_1',
        status: 'completed',
        model: 'test-model',
        output: calls.map((call, index) => ({
            type: 'function_call',
            call_id: `call_${index}_${call.name}`,
            name: call.name,
            arguments: JSON.stringify(call.args ?? {}),
        })),
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
}

/**
 * A response with the call of the schema of a role: the answer of the role.
 * @param {string} name the name of the schema
 * @param {object} args the data of the answer
 * @returns {object}
 */
function schemaAnswer(name, args) {
    return callsAnswer([{ name, args }]);
}

/**
 * A client that answers the requests one by one.
 * @param {object[]} answers the answers, one per request
 * @returns {{ client: object, requests: object[] }}
 */
function mockClient(answers) {
    const requests = [];
    let index = 0;
    return {
        requests,
        client: {
            responses: {
                async create(body) {
                    requests.push({
                        ...body,
                        input: (Array.isArray(body.input) ? body.input : []).map((item) => ({
                            ...item,
                            content: Array.isArray(item?.content) ? [...item.content] : item?.content,
                        })),
                    });
                    const answer = answers[Math.min(index, answers.length - 1)];
                    index += 1;
                    return answer;
                },
            },
        },
    };
}

/**
 * The text of the conversation of a request: the messages and the answers of the tools.
 * @param {object} request the request of the model
 * @returns {string}
 */
function conversation(request) {
    return (Array.isArray(request?.input) ? request.input : [])
        .map((item) => {
            if (item?.type === 'function_call_output') return String(item.output ?? '');
            if (Array.isArray(item?.content)) return item.content.map((part) => part?.text ?? '').join('\n');
            return '';
        })
        .join('\n');
}

test('the write gate opens even when the model calls it together with other calls', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-gate-'));
    const { client, requests } = mockClient([
        callsAnswer([
            { name: 'write_ready', args: {} },
            { name: 'read_file', args: { path: 'index.html', startLine: 1, endLine: 5 } },
        ]),
        callsAnswer([{ name: 'write_file', args: { path: 'index.html', content: '<h1>Привет</h1>' } }]),
        schemaAnswer('markup', {
            summary: '',
            files: [],
            landmarks: [],
            accessibility: [],
            notes: '',
        }),
    ]);
    await runRole({
        client,
        config: structuredClone(defaults),
        role: 'markup',
        input: 'Make the page.',
        context: { step: { id: 'm1', title: 'Markup', files: ['index.html'], criteria: [] } },
        root,
        requireFiles: true,
    });

    // The gate is open: the read of the same turn went through, and the next turn wrote.
    assert.match(conversation(requests[1]), /Write-ready/);
    assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<h1>Привет</h1>');
});

test('the write of the gate turn waits for the next turn, and says why', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-gate-turn-'));
    const { client, requests } = mockClient([
        callsAnswer([
            { name: 'write_ready', args: {} },
            { name: 'write_file', args: { path: 'index.html', content: '<h1>Привет</h1>' } },
        ]),
        callsAnswer([{ name: 'write_file', args: { path: 'index.html', content: '<h1>Привет</h1>' } }]),
        schemaAnswer('markup', {
            summary: '',
            files: [],
            landmarks: [],
            accessibility: [],
            notes: '',
        }),
    ]);
    await runRole({
        client,
        config: structuredClone(defaults),
        role: 'markup',
        input: 'Make the page.',
        context: { step: { id: 'm1', title: 'Markup', files: ['index.html'], criteria: [] } },
        root,
        requireFiles: true,
    });

    // The file of the turn of the gate is not written — the budget of that turn is the
    // reduced one — and the answer says so instead of blaming the model.
    assert.match(conversation(requests[1]), /The write gate is open/);
    assert.match(conversation(requests[1]), /several calls in one turn/);
    // The next turn wrote it.
    assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<h1>Привет</h1>');
});

test('several files are written in one turn', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-parallel-'));
    const { client } = mockClient([
        callsAnswer([{ name: 'write_ready', args: {} }]),
        callsAnswer([
            { name: 'write_file', args: { path: 'index.html', content: '<h1>Привет</h1>' } },
            { name: 'write_file', args: { path: 'src/app.js', content: 'const a = 1;' } },
            { name: 'write_file', args: { path: 'src/styles.css', content: 'body { margin: 0; }' } },
        ]),
        schemaAnswer('code', { summary: '', files: [], commands: [], notes: '' }),
    ]);
    const answer = await runRole({
        client,
        config: structuredClone(defaults),
        role: 'coder',
        input: 'Write the code.',
        context: {
            step: { id: 'c1', title: 'Code', files: ['index.html', 'src/app.js', 'src/styles.css'], criteria: [] },
        },
        root,
        requireFiles: true,
    });

    assert.equal(answer.stopped, 'completed');
    assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<h1>Привет</h1>');
    assert.equal(await readFile(path.join(root, 'src', 'app.js'), 'utf8'), 'const a = 1;');
    assert.equal(await readFile(path.join(root, 'src', 'styles.css'), 'utf8'), 'body { margin: 0; }');
});

test('the files written in one batch are not put over by the answer of the role', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-batch-'));
    const plan = {
        summary: 'A page.',
        steps: [{
            id: 'm1',
            title: 'Markup',
            role: 'markup',
            dependsOn: [],
            files: ['index.html', 'src/app.js'],
            criteria: [],
        }],
    };
    const { client } = mockClient([
        callsAnswer([{ name: 'write_ready', args: {} }]),
        callsAnswer([{
            name: 'batch',
            args: {
                actions: [
                    { tool: 'write_file', args: { path: 'index.html', content: '<h1>С диска</h1>' } },
                    { tool: 'write_file', args: { path: 'src/app.js', content: 'const a = 1;' } },
                ],
            },
        }]),
        // The answer carries an older text of the same files.
        schemaAnswer('markup', {
            summary: '',
            files: [
                { path: 'index.html', content: '<h1>Старый текст</h1>' },
                { path: 'src/app.js', content: 'const a = 0;' },
            ],
            landmarks: [],
            accessibility: [],
            notes: '',
        }),
    ]);
    const result = await runStepStage({
        client,
        config: structuredClone(defaults),
        root,
        task: 'A page.',
        role: 'markup',
        plan,
        apply: true,
    });

    assert.ok(result.ok, 'the step failed');
    // The disk is the truth: the answer did not undo the batch.
    assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<h1>С диска</h1>');
    assert.equal(await readFile(path.join(root, 'src', 'app.js'), 'utf8'), 'const a = 1;');
});

test('the file the role patched is not put over by the answer of the role', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-patch-own-'));
    await (await import('node:fs/promises')).writeFile(path.join(root, 'index.html'), '<h1>Старый</h1>\n', 'utf8');
    const plan = {
        summary: 'A page.',
        steps: [{
            id: 'm1',
            title: 'Markup',
            role: 'markup',
            dependsOn: [],
            files: ['index.html'],
            criteria: [],
        }],
    };
    const { client } = mockClient([
        callsAnswer([{ name: 'write_ready', args: {} }]),
        callsAnswer([{
            name: 'patch_file',
            args: { path: 'index.html', edits: [{ startLine: 1, endLine: 1, text: '<h1>Новый</h1>' }] },
        }]),
        // The answer carries the text the role had before the patch.
        schemaAnswer('markup', {
            summary: '',
            files: [{ path: 'index.html', content: '<h1>Старый</h1>\n' }],
            landmarks: [],
            accessibility: [],
            notes: '',
        }),
    ]);
    const result = await runStepStage({
        client,
        config: structuredClone(defaults),
        root,
        task: 'A page.',
        role: 'markup',
        plan,
        apply: true,
    });

    assert.ok(result.ok, 'the step failed');
    assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<h1>Новый</h1>\n');
});
