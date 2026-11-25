/**
 * @file test/subagent.test.js
 * @module test/subagent
 * @purpose The tests of the hand-over to a sub-agent: the inherited role, the rights, the
 *          separate thread and the files that come back.
 * @depends node:test, node:fs/promises, agent/subagent, roles/index
 * @ai.tags test, subagent, roles, threads
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';

import {
    SUBAGENT_NAMES,
    SUBAGENTS,
    createSubagentSpawner,
    subagentGate,
    subagentGateNote,
    subagentNote,
    subagentToolNames,
} from '../src/agent/subagent.js';
import { defaults } from '../src/config.js';
import { startFakeApi } from './helpers/fake-api.js';

test('the roles that a sub-agent may inherit are known', () => {
    for (const name of ['markup', 'styler', 'coder', 'artist', 'builder', 'iconifier']) {
        assert.ok(SUBAGENTS[name], name);
        assert.ok(SUBAGENTS[name].description.length > 20, name);
    }
    // The roles of the whole run are not there: they work once, not by a piece of work.
    for (const name of ['planner', 'architect', 'reviewer', 'auditor', 'learner']) {
        assert.equal(SUBAGENTS[name], undefined, name);
    }
    assert.deepEqual([...SUBAGENT_NAMES], ['markup', 'styler', 'coder', 'editor', 'artist', 'builder', 'iconifier']);
});

test('a sub-agent never gets the hand-over tool itself', () => {
    const names = ['read_file', 'write_file', 'subagent'];
    const resolve = (name) => ({ tools: ['read_file', 'write_file', 'subagent'] });
    assert.deepEqual(subagentToolNames('styler', names, resolve), ['read_file', 'write_file']);
    assert.deepEqual(subagentToolNames('coder', names, () => ({ tools: ['read_file', 'subagent'] })), ['read_file']);
    // A role the registry does not know has no tools.
    assert.deepEqual(subagentToolNames('nope', names, resolve), []);
});

test('the rule of the hand-over names the roles and the way of it', () => {
    const note = subagentNote(SUBAGENT_NAMES);
    assert.match(note, /sub-agent/);
    assert.match(note, /markup/);
    assert.match(note, /styler/);
    assert.match(note, /coder/);
    assert.match(note, /write_ready.*not delegation/);
    assert.match(note, /Do not hand over a file listed in your current step/);
    assert.equal(subagentNote([]), '');
});

test('a hand-over without a concrete output file is refused before the thread starts', async () => {
    let started = false;
    const spawn = createSubagentSpawner({
        root: process.cwd(),
        role: 'styler',
        tools: { execute: async () => { started = true; return ''; } },
        resolveRole: () => ({ tools: [], maxTurns: 10 }),
    });
    await assert.rejects(
        () => spawn({ role: 'coder', task: 'Make a feature.' }),
        /выходные файлы/,
    );
    assert.equal(started, false);
});

test('a role may not hand work over before writing the files of its own step', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-subagent-own-step-'));
    // The sub-agent asks for a file: the parent runs the tool, and the tool is what the
    // test watches.
    const api = await startFakeApi([
        { type: 'function_call', name: 'read_file', arguments: { path: 'note.txt' } },
        { text: 'The work is done.' },
    ]);
    let started = false;
    try {
        const spawn = createSubagentSpawner({
            root,
            role: 'styler',
            stage: 'styling',
            config: { baseURL: api.url, apiKey: 'test-key' },
            context: { step: { id: 'styles-1', files: ['index.html'], criteria: [] } },
            tools: { execute: async () => { started = true; return ''; } },
            resolveRole: () => ({ tools: [], maxTurns: 10 }),
        });
        await assert.rejects(
            () => spawn({ role: 'coder', task: 'Write main.js', files: ['main.js'] }),
            /сначала напишите файлы своего шага \(index\.html\)/,
        );
        assert.equal(started, false);

        // The own file is on the disk: the hand-over is allowed again.
        await writeFile(path.join(root, 'index.html'), '<main></main>\n');
        await writeFile(path.join(root, 'note.txt'), 'the note\n', 'utf8');
        const report = await spawn({ role: 'coder', task: 'Write main.js', files: ['main.js'] });
        assert.match(report, /NOT VERIFIED|VERIFIED/);
        assert.equal(started, true);
    } finally {
        api.stop();
        await rm(root, { recursive: true, force: true });
    }
});

test('a role may not hand the work to itself, nor to nobody', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-subagent-guard-'));
    try {
        const spawn = createSubagentSpawner({
            root,
            role: 'styler',
            tools: { execute: async () => '' },
            resolveRole: () => ({ tools: [], maxTurns: 4 }),
        });
        await assert.rejects(() => spawn({ role: 'styler', task: 'x' }), /самой себе/);
        await assert.rejects(() => spawn({ role: 'nope', task: 'x' }), /неизвестная роль/);
        await assert.rejects(() => spawn({ role: 'markup', task: '' }), /задача пуста/);
        await assert.rejects(() => spawn({ task: 'x' }), /назовите роль/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the hand-over is one level deep', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-subagent-depth-'));
    try {
        const spawn = createSubagentSpawner({
            root,
            role: 'styler',
            depth: 1,
            tools: { execute: async () => '' },
            resolveRole: () => ({ tools: [], maxTurns: 4 }),
        });
        await assert.rejects(() => spawn({ role: 'markup', task: 'x' }), /глубже одного уровня/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the roles of the project may hand the work over', async () => {
    const { ROLES } = await import('../src/roles/index.js');
    for (const name of ['markup', 'styler', 'coder']) {
        assert.ok(ROLES[name].tools.includes('subagent'), name);
    }
    // The roles of the whole run do not hand work over: they work once.
    for (const name of ['planner', 'architect', 'reviewer']) {
        assert.ok(!ROLES[name].tools.includes('subagent'), name);
    }
});

test('the door of the writing stays closed until the icons are picked', () => {
    // Иконки ложатся в разметку, а разметка переписывается под них: пока стадия иконок
    // не началась, отдать её работу другой роли нельзя.
    const closed = subagentGate({ from: 'builder', stage: 'write', to: 'iconifier', startedStages: [] });
    assert.ok(closed);
    assert.deepEqual(closed.missing, ['iconify']);
    // Дверь открывается, когда стадия иконок началась.
    assert.equal(subagentGate({
        from: 'builder',
        stage: 'write',
        to: 'iconifier',
        startedStages: ['iconify'],
    }), null);
    // Разметку отдавать нельзя: она уже написана.
    const markup = subagentGate({ from: 'builder', stage: 'write', to: 'markup', startedStages: [] });
    assert.ok(markup);
    assert.deepEqual(markup.missing, []);
    assert.match(markup.reason, /разметка уже написана/);
    // Другие роли не за дверью.
    assert.equal(subagentGate({ from: 'builder', stage: 'write', to: 'coder', startedStages: [] }), null);
    assert.equal(subagentGate({ from: 'artist', stage: 'graphics', to: 'builder', startedStages: [] }), null);
});

test('the door of the writing opens to the icons only when their stage started', () => {
    // Иконки ложатся в разметку, а разметка переписывается под них: пока стадия иконок
    // не началась, отдать её работу другой роли нельзя.
    const closed = subagentGate({ from: 'builder', stage: 'write', to: 'iconifier', startedStages: ['graphics'] });
    assert.ok(closed);
    assert.deepEqual(closed.missing, ['iconify']);
    assert.ok(subagentGate({ from: 'builder', stage: 'write', to: 'iconifier', startedStages: ['coding'] }));
    // Дверь открывается, когда стадия иконок началась.
    assert.equal(subagentGate({
        from: 'builder',
        stage: 'write',
        to: 'iconifier',
        startedStages: ['iconify'],
    }), null);
});

test('the writing never hands the work of the markup over', () => {
    // Разметка уже написана, когда пишется код: её правка после кода ломает то, на что
    // код опирается. Роль письма, что меняет разметку, меняет её сама.
    const closed = subagentGate({ from: 'builder', stage: 'write', to: 'markup', startedStages: ['coding', 'iconify'] });
    assert.ok(closed, 'роль передала разметку маркупу');
    assert.match(closed.reason, /разметка уже написана/);
    // Рука закрыта навсегда: никакая стадия её не открывает.
    assert.ok(subagentGate({ from: 'builder', stage: 'write', to: 'markup', startedStages: [] }));
    // Остальные роли доступны — по прежним правилам.
    assert.equal(subagentGate({ from: 'builder', stage: 'write', to: 'coder', startedStages: [] }), null);
});

test('the role of the writing is told that the hand-over is closed', () => {
    const note = subagentGateNote({ from: 'builder', stage: 'write', startedStages: [] });
    assert.match(note, /closed for now/);
    assert.match(note, /iconifier/);
    assert.match(note, /iconify/);
    // Запрет на разметку вечен: он не открывается ни одной стадией.
    const forbidden = subagentGateNote({
        from: 'builder',
        stage: 'write',
        startedStages: ['iconify'],
    });
    assert.match(forbidden, /hand-over is closed/);
    assert.match(forbidden, /markup/);
});

test('the role of the writing does not hand the icons over before their stage started', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-subagent-coder-'));
    try {
        let started = false;
        const spawn = createSubagentSpawner({
            root,
            role: 'builder',
            stage: 'write',
            tools: { execute: async () => { started = true; return ''; } },
            resolveRole: () => ({ tools: [], maxTurns: 8 }),
            startedStages: new Set(['graphics', 'write']),
        });
        // Иконки ложатся в разметку, а разметка переписывается под них: пока стадия
        // иконок не началась, отдать её работу нельзя.
        await assert.rejects(
            () => spawn({ role: 'iconifier', task: 'Pick the icons.', files: ['src/assets/icons/'] }),
            /не может передать работу роли iconifier/,
        );
        assert.equal(started, false);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the sub-agent works in a thread of the parent and the parent runs its tools', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-subagent-thread-'));
    const events = [];
    const calls = [];
    const api = await startFakeApi([
        { type: 'function_call', name: 'read_file', arguments: { path: 'note.txt' } },
        { type: 'function_call', name: 'write_ready', arguments: {} },
        { type: 'function_call', name: 'write_file', arguments: { path: 'styles.scss', content: 'body { color: #111; }\n' } },
        { text: 'The stylesheet is written.' },
    ]);
    try {
        const spawn = createSubagentSpawner({
            root,
            role: 'styler',
            stage: 'styling',
            config: { baseURL: api.url, apiKey: 'test-key' },
            notify: (event) => events.push(event),
            // The tools of the parent: the sub-agent asks, the parent runs.
            tools: {
                async execute(name, args) {
                    calls.push(name);
                    if (name === 'read_file') {
                        return await readFile(path.join(root, args.path), 'utf8');
                    }
                    if (name === 'write_file') {
                        await writeFile(path.join(root, args.path), args.content ?? '', 'utf8');
                        return `Written: ${args.path}`;
                    }
                    return 'The tool did nothing.';
                },
            },
            resolveRole: (name) => ({
                tools: ['read_file', 'write_file'],
                maxTurns: 4,
                schema: null,
            }),
            instructionsFor: async (name) => `You are the ${name} of a web project.`,
            model: 'test-model',
        });
        await writeFile(path.join(root, 'note.txt'), 'the note of the parent\n', 'utf8');
        const report = await spawn({
            role: 'coder',
            task: 'Read the note and write the stylesheet.',
            files: ['styles.scss'],
        });
        assert.match(report, /VERIFIED/);
        assert.deepEqual(calls, ['read_file', 'write_file']);
        // The file of the goal is on the disk.
        const written = await readFile(path.join(root, 'styles.scss'), 'utf8');
        assert.match(written, /color: #111/);
        // The run knows about the sub-agent: it starts and it ends.
        assert.ok(events.some((event) => event.type === 'subagent.start'));
        const done = events.find((event) => event.type === 'subagent.done');
        assert.equal(done.ok, true);
        assert.deepEqual(done.files, ['styles.scss']);
        // The gate of the write is in the log of the sub-agent: the estimate of the model
        // sizes the budget of the write turn.
        const ready = events.find((event) => event.type === 'subagent.status'
            && event.event?.status === 'write_ready');
        assert.ok(ready, 'the gate of the write opened');
    } finally {
        api.stop();
        await rm(root, { recursive: true, force: true });
    }
});
