import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';

import { runWebWorker, spawnWebWorker } from '../src/agent/worker-runner.js';
import { normalizeWebSpec, runWebCycle, WEB_TOOLS } from '../src/agent/worker.js';
import { createSharedBlock, readSharedBlock } from '../src/shared/shared.js';

/**
 * The API of the test: the worker of the webdev system talks to it over the network,
 * exactly as it talks to the API of the house.
 * @param {object[]} seen the answers the fake API gave
 * @returns {Promise<{ server: object, port: number }>}
 */
async function fakeApi(seen) {
    const server = createServer((request, response) => {
        let body = '';
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', () => {
            seen.push(JSON.parse(body));
            const answer = seen.length === 1
                ? {
                    status: 'completed',
                    output: [{
                        type: 'function_call',
                        id: 'fc-1',
                        call_id: 'c-1',
                        name: 'write_file',
                        arguments: JSON.stringify({ path: 'index.html', content: '<h1>hi</h1>' }),
                    }],
                }
                : { status: 'completed', output_text: 'The page is written.' };
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify(answer));
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, port: server.address().port };
}

test('the spec of the webdev worker has every field', () => {
    const spec = normalizeWebSpec({
        role: { name: 'builder', instructions: 'You are the builder.', tools: ['write_file'] },
        goal: 'Write the page.',
        files: ['index.html'],
        budget: { maxTurns: 4 },
    });
    assert.equal(spec.role.name, 'builder');
    assert.equal(spec.role.instructions, 'You are the builder.');
    assert.deepEqual(spec.role.tools, ['write_file']);
    assert.equal(spec.goal, 'Write the page.');
    assert.deepEqual(spec.files, ['index.html']);
    assert.equal(spec.budget.maxTurns, 4);
    // The tools of the parent are the tools of the worker: without a list, it has them all.
    const bare = normalizeWebSpec({ role: { name: 'builder' } });
    assert.deepEqual(bare.role.tools, [...WEB_TOOLS]);
});

test('the worker runs in a thread of the parent and calls its tools', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-worker-'));
    const seen = [];
    const { server, port } = await fakeApi(seen);
    const calls = [];
    const events = [];
    try {
        const report = await runWebWorker({
            spec: {
                name: 'builder-1',
                role: { name: 'builder', instructions: 'You are the builder.', tools: ['write_file'] },
                goal: 'Write the page.',
                files: ['index.html'],
                model: { model: 'test-model', baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'test-key' },
            },
            onCall: async (call) => {
                calls.push(call.name);
                return 'Written: index.html';
            },
            onEvent: (event) => events.push(event),
        });
        assert.equal(report.ok, true);
        assert.equal(report.turns, 2);
        assert.deepEqual(calls, ['write_file']);
        assert.ok(events.some((event) => event?.status === 'working'));
        // The thread asked the API of the house with its own model.
        assert.equal(seen[0].model, 'test-model');
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(root, { recursive: true, force: true });
    }
});

test('the instructions of the worker travel in the shared memory', async () => {
    const { buffer } = createSharedBlock({
        instructions: 'You are the builder of the shared buffer.',
        notes: 'The notes of the shared buffer.',
    });
    const bodies = [];
    const client = {
        responses: {
            async create(body) {
                bodies.push(body);
                return { status: 'completed', output_text: 'The page is written.' };
            },
        },
    };
    const report = await runWebCycle({
        spec: {
            role: { name: 'builder', instructions: 'The instructions of the spec.' },
            goal: 'Write the page.',
            context: { notes: 'The notes of the spec.' },
            shared: buffer,
        },
        client,
    });
    assert.equal(report.ok, true);
    // The instructions came from the shared buffer, not from the spec.
    assert.equal(bodies[0].instructions, 'You are the builder of the shared buffer.');
});

test('the worker stops when the parent sets the flag of the shared memory', async () => {
    const { buffer } = createSharedBlock({ instructions: 'You are the builder.', notes: '' });
    const client = {
        responses: {
            async create() {
                // The parent asks the worker to stop while the turn runs.
                readSharedBlock(buffer).cancel();
                return { status: 'completed', output_text: 'The page is written.' };
            },
        },
    };
    const report = await runWebCycle({
        spec: { role: { name: 'builder' }, goal: 'Write the page.', shared: buffer },
        client,
    });
    assert.equal(report.stopped, 'aborted');
    assert.equal(report.ok, false);
});

test('a worker without a goal or without a role says so', async () => {
    const noGoal = await runWebCycle({ spec: { role: { name: 'builder' } }, client: null });
    assert.equal(noGoal.error, 'no-goal');
    const noRole = await runWebCycle({ spec: { goal: 'Write the page.' }, client: null });
    assert.equal(noRole.error, 'no-role');
    const noClient = await runWebCycle({ spec: { role: { name: 'builder' }, goal: 'Write.' }, client: null });
    assert.equal(noClient.error, 'no-client');
});

test('the worker may be started without waiting for it', async () => {
    const { server, port } = await fakeApi([]);
    try {
        const { handle, done } = spawnWebWorker({
            spec: {
                role: { name: 'builder', instructions: 'You are the builder.' },
                goal: 'Write the page.',
                model: { model: 'test-model', baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'test-key' },
            },
            onCall: async () => 'ok',
        });
        assert.equal(handle.role, 'builder');
        assert.equal(handle.alive(), true);
        const report = await done;
        assert.equal(report.ok, true);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
