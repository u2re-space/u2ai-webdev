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
import { createTuiState, reduceTuiState, stageProgress, STREAM_LIMIT } from '../src/tui/state.js';
import { STAGES } from '../src/stages/index.js';
import { createTuiLayout, formatStatusRow, markdownSegments, renderTui, truncate, wrapThought } from '../src/tui/render.js';
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
    assert.match(formatStatusRow(state), /^Question: Which color\?/);

    state = reduceTuiState(state, { type: 'answer' });
    assert.equal(state.question, null);
});

test('the stream of the model is one live line of the shell, not a wall of lines', () => {
    let state = createTuiState({ command: 'run', task: 'make a landing' });
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, { event: { type: 'reasoning.delta', text: 'The header ' } }),
    });
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, { event: { type: 'reasoning.delta', text: 'must be blue.' } }),
    });
    assert.equal(state.stream.kind, 'thinking');
    assert.equal(state.stream.text, 'The header must be blue.');

    const layout = createTuiLayout(state, { width: 100, height: 30, input: '' });
    const text = layout.lines.map((line) => line.text).join('\n');
    assert.match(text, /thinking: The header must be blue\./);
    // The stream is one line: the log of the shell keeps no piece of it.
    assert.equal(text.split('\n').filter((line) => line.includes('thinking:')).length, 1);
});

test('the shell keeps the tail of a long stream, not the whole of it', () => {
    let state = createTuiState();
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, { event: { type: 'text.delta', text: 'x'.repeat(2000) } }),
    });
    assert.equal(state.stream.kind, 'answer');
    assert.ok(state.stream.text.length <= STREAM_LIMIT);
    assert.ok(state.stream.text.endsWith('x'));
});

test('the thought of the next role does not run into the thought of the last one', () => {
    let state = createTuiState();
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, { event: { type: 'reasoning.delta', text: 'The header ' } }),
    });
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, { event: { type: 'role.done', role: 'coder', stopped: 'completed' } }),
    });
    // The thought of the role stays on the screen: it is the last thing the model said.
    assert.equal(state.stream.text, 'The header ');
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, { event: { type: 'reasoning.delta', text: 'Now the footer.' } }),
    });
    assert.equal(state.stream.text, 'Now the footer.');
});
test('the status row above the input names the current model, stage, role, effort and mode', () => {
    let state = createTuiState({ command: 'run', task: 'make a landing' });
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.status, {
            location: {
                stage: 'coding',
                role: 'coder',
                step: 'build-api',
                model: 'test/model',
                effort: 'high',
                mode: 'interactive',
            },
            status: 'running',
        }),
    });

    const row = formatStatusRow(state);
    assert.match(row, /Model: test\/model/);
    assert.match(row, /Stage: coding/);
    assert.match(row, /Role: coder/);
    assert.match(row, /Effort: high/);
    assert.match(row, /Mode: interactive/);
    assert.match(row, /Step: build-api/);
    assert.match(row, /Status: running/);

    const layout = createTuiLayout(state, { width: 120, height: 30, input: 'continue' });
    assert.ok(layout.progressRow < layout.statusRow);
    assert.equal(layout.inputRow - layout.statusRow, 2);
    // The bar of the progress shares the row of the status and the state: its total is
    // every stage of the run, even the ones that have not started yet.
    assert.match(layout.lines[layout.statusRow].text, new RegExp(`0/${STAGES.length}`));
    assert.match(layout.lines[layout.statusRow].text, /Model: test\/model/);
    assert.match(layout.lines[layout.statusRow].text, /Effort: high/);
    assert.match(layout.lines[layout.statusRow].text, /Status: running/);
    //assert.match(layout.lines[layout.inputRow].text, /continue/);

    const header = layout.lines.slice(0, 4).map((line) => line.text).join('\n');
    assert.doesNotMatch(header, /Model:|Role:|Effort:|running/);
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

test('the sub-agents of the run take their own rows of the dashboard', () => {
    let state = createTuiState({ command: 'run', task: 'make a landing' });
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, {
            event: { type: 'subagent.start', from: 'markup', to: 'coder', task: 'Write the header script.' },
        }),
    });
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, {
            event: { type: 'subagent.status', from: 'markup', to: 'coder', event: { status: 'tools', turn: 2, tools: ['write_file'] } },
        }),
    });

    // The state knows about the thread: the role it inherited and what it is doing.
    assert.equal(state.subagents.length, 1);
    assert.equal(state.subagents[0].role, 'coder');
    assert.equal(state.subagents[0].status, 'tools');

    // The dashboard shows it: the status gets more rows for the sub-agents.
    const layout = createTuiLayout(state, { width: 100, height: 30, input: '' });
    const text = layout.lines.map((line) => line.text).join('\n');
    assert.match(text, /coder: tools/);
    assert.match(text, /turn 2/);
    assert.match(text, /write_file/);

    // The thread ends: the shell says that it is done.
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, {
            event: { type: 'subagent.done', from: 'markup', to: 'coder', turns: 3, ok: true, files: ['header.js'] },
        }),
    });
    assert.equal(state.subagents[0].status, 'done');
    assert.match(state.notice, /coder/);
});

test('the text of the dashboard is cut to the width of the pane', () => {
    assert.equal(truncate('abcdef', 4), 'abc…');
    assert.equal(truncate('abc', 10), 'abc');
});

test('the cursor stays after the visible input text', () => {
    const moves = [];
    const cursor = [];
    const term = Object.assign(function () {}, {
        width: 40,
        height: 20,
        clear() {},
        moveTo(x, y) { moves.push([x, y]); },
        eraseLineAfter() {},
        hideCursor(value) { cursor.push(value); },
        bold(text) { return text; },
        dim(text) { return text; },
        green(text) { return text; },
        red(text) { return text; },
        yellow(text) { return text; },
    });
    const state = createTuiState({ command: 'run', task: 'make a landing' });
    const layout = createTuiLayout(state, { width: 40, height: 20, input: 'hello' });

    renderTui(term, state, { input: 'hello' });

    assert.deepEqual(moves.at(-1), [8, layout.inputRow + 2]);
    assert.equal(cursor.at(-1), false);
});

test('the thought of the model is wrapped, so no row outgrows the screen', () => {
    const long = 'The opening paragraph is separated by 32px from the divider, and the closing '
        + 'paragraph aligns with a slight offset for visual balance across the whole layout.';
    const rows = wrapThought(long, 'thinking', 100, 2);
    assert.equal(rows.length, 2);
    for (const row of rows) assert.ok(row.text.length <= 100, `the row does not fit: ${row.text.length}`);
    assert.match(rows[0].text, /^▸ thinking: /);
    assert.match(rows[1].text, /^ {2}/);
});

test('the thought of the model takes four rows on the dashboard', () => {
    const long = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');
    const rows = wrapThought(long, 'thinking', 100, 4);
    assert.equal(rows.length, 4);
    for (const row of rows) assert.ok(row.text.length <= 100, `the row does not fit: ${row.text.length}`);
});

test('the thought speaks markdown: the marks go away and the styles stay', () => {
    const rows = wrapThought('A **bold plan** with `code` and _emphasis_ inside.', 'thinking', 100, 2);
    assert.ok(!rows[0].text.includes('**'), `the marks stayed: ${rows[0].text}`);
    assert.ok(!rows[0].text.includes('`'), `the code marks stayed: ${rows[0].text}`);
    const styles = rows[0].segments.map((segment) => segment.style);
    assert.ok(styles.includes('strong'), `no strong piece: ${JSON.stringify(rows[0].segments)}`);
    assert.ok(styles.includes('code'), `no code piece: ${JSON.stringify(rows[0].segments)}`);
    assert.ok(styles.includes('em'), `no emphasis piece: ${JSON.stringify(rows[0].segments)}`);
    assert.equal(markdownSegments('plain words').every((segment) => segment.style === ''), true);
    // A snake_case name is not an emphasis: the underscore in a word stays a word.
    const plain = markdownSegments('read the src_file_name today');
    assert.equal(plain.some((segment) => segment.style === 'em'), false);
});

test('the thought scrolls back through its rows', () => {
    const long = Array.from({ length: 120 }, (_, index) => `word${index}`).join(' ');
    const rows = wrapThought(long, 'thinking', 100, 4, 0);
    const scrolled = wrapThought(long, 'thinking', 100, 4, 2);
    assert.notEqual(rows[3].text, scrolled[3].text, 'the window did not move');
    assert.match(scrolled[0].text, /^▸ thinking: /);
    assert.match(scrolled[0].text, /…/);
    assert.match(rows[0].text, /word\d+$/);

    let state = createTuiState({ command: 'run', task: 'make a landing' });
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, { event: { type: 'reasoning.delta', text: long } }),
    });
    const layout = createTuiLayout(state, { width: 100, height: 30 });
    assert.ok(layout.thoughtMaxOffset > 0, 'the long thought has nowhere to scroll');
    const top = createTuiLayout(state, { width: 100, height: 30, thoughtOffset: layout.thoughtMaxOffset });
    const first = top.lines.find((line) => Array.isArray(line.segments));
    assert.ok(first, 'the scrolled thought has no rows');
    // The window at its very top starts at the first word of the thought.
    assert.match(first.text, /word0/);
    assert.match(first.text, /^▸ thinking: word0/);
    // One row above the top: the window is marked as cut.
    const near = createTuiLayout(state, { width: 100, height: 30, thoughtOffset: layout.thoughtMaxOffset - 1 });
    const nearFirst = near.lines.find((line) => Array.isArray(line.segments));
    assert.match(nearFirst.text, /…/);
});

test('the thought that is cut is marked with an ellipsis', () => {
    const rows = wrapThought('one two three four five six seven eight nine ten', 'thinking', 30, 1);
    assert.equal(rows.length, 1);
    assert.match(rows[0].text, /…/);
});

test('no row of the thought outgrows the screen, whatever the screen is', () => {
    const long = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');
    for (const cols of [56, 80, 100, 200]) {
        for (const rows of wrapThought(long, 'thinking', cols, 2)) {
            assert.ok(rows.text.length <= cols, `the row does not fit at ${cols}: ${rows.text.length}`);
        }
        for (const rows of wrapThought('x'.repeat(300), 'thinking', cols, 2)) {
            assert.ok(rows.text.length <= cols, `the long word does not fit at ${cols}: ${rows.text.length}`);
        }
    }
});

test('the bar of the progress counts the whole plan of the run', () => {
    let state = createTuiState({ command: 'run', task: 'make a landing' });
    // Two stages done, one running, the rest pending: the total is every stage of the
    // run, not only the ones that started.
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, { event: { type: 'stage.done', stage: 'collect', status: 'completed' } }),
    });
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, { event: { type: 'stage.start', stage: 'scan', title: 'Scan' } }),
    });
    const layout = createTuiLayout(state, { width: 120, height: 30 });
    const total = Object.keys(state.stages).length;
    assert.match(layout.lines[layout.statusRow].text, new RegExp(`1/${total}`));

    // The progress of the disk folds into the stages: a resume shows what ran before.
    state = reduceTuiState(state, {
        type: 'frame',
        frame: createFrame(FRAME.event, {
            event: {
                type: 'progress',
                payload: { stages: [{ name: 'setup', status: 'completed' }, { name: 'markup', status: 'completed' }] },
            },
        }),
    });
    const after = createTuiLayout(state, { width: 120, height: 30 });
    assert.match(after.lines[after.statusRow].text, new RegExp(`3/${total}`));
});

test('the frame is drawn by the difference: a row that did not change is not written', () => {
    const moves = [];
    const term = Object.assign(function () {}, {
        width: 100,
        height: 30,
        clear() {},
        moveTo(x, y) { moves.push([x, y]); },
        eraseLineAfter() {},
        hideCursor() {},
        bold(text) { return text; },
        dim(text) { return text; },
        green(text) { return text; },
        red(text) { return text; },
        yellow(text) { return text; },
    });
    // The rows of the dashboard are written in the first column; the cursor of the
    // operator line moves in another one.
    const writes = () => moves.filter(([x]) => x === 1).length;
    const state = createTuiState({ command: 'run', task: 'make a landing' });
    const first = renderTui(term, state, { input: '' });
    const before = writes();
    // The same state, the same frame: nothing is written at all.
    renderTui(term, state, { input: '', previous: first });
    assert.equal(writes(), before, 'the frame was written again without a change');
    // A changed state writes only the rows that changed.
    const changed = { ...state, notice: 'the notice' };
    renderTui(term, changed, { input: '', previous: first });
    assert.ok(writes() > before, 'the changed frame was not written');
    assert.ok(writes() < before + first.length, 'the whole frame was written again');
});

test('the application runs the worker and shows typed text in the input row', async () => {
    const handlers = new Map();
    const writes = [];
    const term = Object.assign(function (text) { writes.push(text); }, {
        width: 100,
        height: 30,
        fullscreen() {},
        grabInput() {},
        clear() {},
        moveTo() {},
        eraseLineAfter() {},
        hideCursor() {},
        on(name, handler) { handlers.set(name, handler); },
        off(name) { handlers.delete(name); },
        bold(text) { writes.push(text); return text; },
        dim(text) { writes.push(text); return text; },
        good(text) { writes.push(text); return text; },
        bad(text) { writes.push(text); return text; },
        warn(text) { writes.push(text); return text; },
    });
    const app = createTuiApp({ term, args: ['stages'], command: 'stages' });
    const running = app.run();
    const key = handlers.get('key');

    key('x', [], { isCharacter: true, codepoint: 120 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(writes.some((line) => line.includes('› x')));

    key('ENTER', [], {});
    const result = await running;

    assert.equal(result.code, 0);
    assert.ok(result.outputs.some((item) => item.line.includes('collect')));
    assert.equal(handlers.size, 0);
});
