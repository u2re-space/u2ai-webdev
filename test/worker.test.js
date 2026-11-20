/**
 * @file test/worker.test.js
 * @module test/worker
 * @purpose Tests of the internal worker: its operator channel, its protocol and its child process.
 * @depends node:test, node:assert, cli/protocol, cli/worker, tui/worker-client
 * @ai.tags test, worker, ipc
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrame, FRAME, isFrame, PROTOCOL_VERSION } from '../src/cli/protocol.js';
import { createWorkerInput, createWorkerRenderer } from '../src/cli/worker.js';
import { createWorkerClient } from '../src/tui/worker-client.js';

test('a protocol frame carries its version and only a known kind', () => {
    const frame = createFrame(FRAME.ready, { pid: 42 });
    assert.equal(frame.v, PROTOCOL_VERSION);
    assert.equal(frame.type, 'ready');
    assert.equal(frame.pid, 42);
    assert.equal(isFrame(frame), true);
    assert.equal(isFrame({ v: 99, type: 'ready' }), false);
    assert.throws(() => createFrame('unknown'), /Unknown protocol frame/);
});

test('the worker operator channel keeps steering, questions, skips and quit apart', async () => {
    const frames = [];
    const input = createWorkerInput({ send: (frame) => frames.push(frame) });

    input.receive(createFrame(FRAME.input, { text: 'make the header blue' }));
    assert.deepEqual(input.takeSteering(), ['make the header blue']);

    input.setLocation({
        stage: 'styling',
        role: 'styler',
        step: 'colors',
        model: 'test/model',
        effort: 'high',
        mode: 'interactive',
    });
    assert.equal(frames.at(-1).type, 'status');
    assert.equal(frames.at(-1).location.role, 'styler');
    assert.equal(frames.at(-1).location.model, 'test/model');

    input.setLocation({ stage: 'coding' });
    assert.equal(frames.at(-1).location.stage, 'coding');
    assert.equal(frames.at(-1).location.role, undefined);
    assert.equal(frames.at(-1).location.step, undefined);
    assert.equal(frames.at(-1).location.model, 'test/model');

    const answer = input.askUser('Which color?');
    const question = frames.at(-1);
    assert.equal(question.type, 'question');
    assert.equal(question.kind, 'ask_user');
    assert.equal(input.receive(createFrame(FRAME.answer, { id: question.id, text: 'blue' })), true);
    assert.equal(await answer, 'blue');

    input.receive(createFrame(FRAME.command, { name: 'skip', target: 'markup-1' }));
    assert.equal(input.takePendingSkips({ namedOnly: true })[0].target, 'markup-1');

    input.receive(createFrame(FRAME.command, { name: 'quit' }));
    assert.equal(input.shouldQuit(), true);
    input.close();
});

test('the worker gathers the stream of the model before it reaches the shell', async () => {
    const frames = [];
    const seen = [];
    const classic = {
        event(event) { seen.push(event); },
    };
    const renderer = createWorkerRenderer(classic, (frame) => frames.push(frame));

    renderer.event({ type: 'reasoning.delta', text: 'The header ' });
    renderer.event({ type: 'reasoning.delta', text: 'must be blue.' });
    // The pieces are not sent one by one: the shell would draw a thousand lines.
    assert.equal(frames.length, 0);
    renderer.event({ type: 'role.tool', name: 'read_file', arguments: { path: 'index.html' } });

    const stream = frames.find((frame) => frame.event?.type === 'reasoning.delta');
    assert.ok(stream, 'the gathered stream did not reach the shell');
    assert.equal(stream.event.text, 'The header must be blue.');
    // The classic renderer still sees every piece: the log of the worker keeps them.
    assert.equal(seen.filter((event) => event.type === 'reasoning.delta').length, 2);
});

test('the worker is a child process with a ready frame, live output and a result', async () => {
    const frames = [];
    const logs = [];
    const client = createWorkerClient({
        args: ['stages'],
        onFrame: (frame) => frames.push(frame),
        onLog: (line) => logs.push(line),
    });
    const exit = await client.finished;

    assert.equal(exit.code, 0);
    assert.equal(frames[0].type, 'ready');
    assert.equal(frames.at(-1).type, 'result');
    assert.equal(frames.at(-1).code, 0);
    assert.ok(logs.some((item) => item.stream === 'stdout' && item.line.includes('collect')));
});
