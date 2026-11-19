/**
 * @file test/tui.test.js
 * @module test/tui
 * @purpose Tests of the graphical shell: its state reducer and its dashboard layout.
 * @depends node:test, node:assert, tui/state, tui/render
 * @ai.tags test, tui, state
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrame, FRAME } from '../src/cli/protocol.js';
import { createTuiState, reduceTuiState, stageProgress } from '../src/tui/state.js';
import { createTuiLayout, truncate } from '../src/tui/render.js';
import { createTuiApp } from '../src/tui/app.js';

test('the state of the shell follows the stages, the progress and the result', () => {
    let state = createTuiState({ command: 'run', task: 'make a landing' });
    state = reduceTuiState(state, { type: 'frame', frame: createFrame(FRAME.ready, { pid: 10 }) });
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, { event: { type: 'stage.start', stage: 'collect', title: 'Collect' } }),
    });
    assert.equal(state.stages.collect.status, 'running');
    assert.deepEqual(stageProgress(state), { done: 0, total: 1 });

    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, { event: { type: 'stage.done', stage: 'collect', status: 'completed' } }),
    });
    assert.equal(state.stages.collect.status, 'completed');
    assert.deepEqual(stageProgress(state), { done: 1, total: 1 });

    state = reduceTuiState(state, { type: 'frame', frame: createFrame(FRAME.result, { code: 0 }) });
    assert.equal(state.status, 'completed');
    assert.equal(state.exitCode, 0);
});

test('a question of the worker waits for the answer of the operator', () => {
    let state = createTuiState();
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.question, { id: 'q-1', kind: 'ask_user', question: 'Which color?' }),
    });
    assert.equal(state.question.id, 'q-1');
    assert.equal(state.question.question, 'Which color?');

    state = reduceTuiState(state, { type: 'answer' });
    assert.equal(state.question, null);
});

test('the dashboard shows the stages, the live log and the operator line', () => {
    let state = createTuiState({ command: 'run', task: 'make a landing' });
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, { event: { type: 'stage.start', stage: 'collect', title: 'Collect context' } }),
    });
    state = reduceTuiState(state, { type: 'log', stream: 'stderr', line: 'the worker is alive' });
    const layout = createTuiLayout(state, { width: 100, height: 30, input: 'make it blue' });
    const text = layout.lines.map((line) => line.text).join('\n');

    assert.match(text, /ai-webdev/);
    assert.match(text, /collect/);
    assert.match(text, /the worker is alive/);
    assert.match(text, /make it blue/);
    assert.match(text, /\/skip/);
});

test('the text of the dashboard is cut to the width of the pane', () => {
    assert.equal(truncate('abcdef', 4), 'abc…');
    assert.equal(truncate('abc', 10), 'abc');
});

test('the application runs the worker and leaves the terminal clean', async () => {
    const handlers = new Map();
    const term = Object.assign(function () {}, {
        width: 100,
        height: 30,
        fullscreen() {},
        grabInput() {},
        clear() {},
        moveTo() {},
        eraseLineAfter() {},
        on(name, handler) { handlers.set(name, handler); },
        off(name) { handlers.delete(name); },
        bold(text) { return text; },
        dim(text) { return text; },
        good(text) { return text; },
        bad(text) { return text; },
        warn(text) { return text; },
    });
    const app = createTuiApp({ term, args: ['stages'], command: 'stages' });
    const result = await app.run();

    assert.equal(result.code, 0);
    assert.ok(result.outputs.some((item) => item.line.includes('collect')));
    assert.equal(handlers.size, 0);
});
