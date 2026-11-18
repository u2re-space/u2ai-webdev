/**
 * @file test/delegation.test.js
 * @module test/delegation
 * @purpose The tests of the hand-over of the work: the roles, the separate session and the
 *          files that come back.
 * @depends node:test, node:fs/promises, agent/delegation, roles/index
 * @ai.tags test, delegation, roles
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';

import {
    DELEGATE_NAMES,
    DELEGATES,
    delegateToolNames,
    delegationNote,
    createDelegator,
} from '../src/agent/delegation.js';
import { runRole } from '../src/roles/index.js';
import { defaults } from '../src/config.js';

/**
 * A raw answer of the model: the call of the schema with its arguments.
 * @param {string} name
 * @param {object} args
 * @returns {object}
 */
function schemaAnswer(name, args) {
    return {
        id: 'resp-1',
        status: 'completed',
        model: 'test-model',
        output: [{
            type: 'function_call',
            id: 'fc-1',
            call_id: 'c-1',
            name,
            arguments: JSON.stringify(args),
        }],
    };
}

test('the roles that may be handed work are known', () => {
    for (const name of ['markup', 'styler', 'coder', 'editor', 'iconifier']) {
        assert.ok(DELEGATES[name], name);
        assert.ok(DELEGATES[name].description.length > 20, name);
    }
    // The roles of the whole run are not there: they work once, not by a piece of work.
    for (const name of ['planner', 'architect', 'reviewer', 'auditor', 'learner']) {
        assert.equal(DELEGATES[name], undefined, name);
    }
    assert.deepEqual([...DELEGATE_NAMES], ['markup', 'styler', 'coder', 'editor', 'iconifier']);
});

test('a delegated role never gets the delegation tool itself', () => {
    const names = ['read_file', 'write_file', 'delegate_role'];
    const resolve = (name) => ({ tools: ['read_file', 'write_file', 'delegate_role'] });
    assert.deepEqual(delegateToolNames('styler', names, resolve), ['read_file', 'write_file']);
    assert.deepEqual(delegateToolNames('coder', names, () => ({ tools: ['read_file', 'delegate_role'] })), ['read_file']);
    // A role the registry does not know has no tools.
    assert.deepEqual(delegateToolNames('nope', names, resolve), []);
});

test('the rule of the hand-over names the roles and the way of it', () => {
    const note = delegationNote(DELEGATE_NAMES);
    assert.match(note, /separate session/);
    assert.match(note, /markup/);
    assert.match(note, /styler/);
    assert.match(note, /coder/);
    assert.match(note, /write_ready.*not delegation/);
    assert.match(note, /Do not delegate a file listed in your current step/);
    assert.equal(delegationNote([]), '');
});

test('the hand-over starts a separate session of the other role', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-delegate-'));
    try {
        const requests = [];
        const events = [];
        const queue = [
            // The styler hands the work to the markup.
            schemaAnswer('delegate_role', {
                role: 'markup',
                task: 'Write the header of the page: the brand pill and the menu button.',
                reason: 'The structure of the header is missing.',
                files: ['index.html'],
            }),
            // The markup answers in its own session.
            schemaAnswer('markup', {
                summary: 'The header is written.',
                files: [{ path: 'index.html', content: '<header>Hubfolio</header>\n', language: 'html' }],
                landmarks: ['banner'],
                accessibility: [],
                notes: '',
            }),
            // The styler answers after the hand-over.
            schemaAnswer('style', {
                summary: 'The styles are written.',
                tokens: [],
                files: [{ path: 'styles.scss', content: 'body { color: #fff; }\n', language: 'scss' }],
                notes: '',
            }),
        ];
        const client = {
            responses: {
                async create(body) {
                    requests.push(body);
                    return queue[Math.min(requests.length - 1, queue.length - 1)];
                },
            },
        };
        const config = structuredClone(defaults);
        config.model = 'test-model';

        const answer = await runRole({
            client,
            config,
            role: 'styler',
            input: 'Write the styles of the page.',
            root,
            notify: (event) => events.push(event),
        });

        // The session of the styler saw the hand-over, and the session of the markup saw only
        // its own task: the conversations do not mix.
        assert.ok(requests.length >= 2, `requests: ${requests.length}`);
        const first = JSON.stringify(requests[0]);
        const second = JSON.stringify(requests[1]);
        assert.match(first, /delegate_role/);
        assert.match(second, /hands you this work/);
        assert.match(second, /separate session/);
        assert.doesNotMatch(second, /Write the styles of the page/);
        assert.match(second, /index\.html/);
        assert.doesNotMatch(second, /styles\.scss/);

        // The files of the delegated role are on the disk.
        assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<header>Hubfolio</header>\n');
        const completion = events.find((event) => event.type === 'delegate.done');
        assert.equal(completion.ok, true);
        assert.deepEqual(completion.files, ['index.html']);
        // The answer of the caller carries the work of the delegated role.
        assert.equal(answer.data?.summary, 'The styles are written.');
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
    }
});

test('a hand-over without a concrete output file is refused before starting the child role', async () => {
    let started = false;
    const delegate = createDelegator({
        run: async () => { started = true; return {}; },
        root: process.cwd(),
        role: 'styler',
        resolveRole: () => ({ tools: [], maxTurns: 10 }),
    });
    await assert.rejects(
        () => delegate({ role: 'coder', task: 'Make a feature.' }),
        /выходные файлы/,
    );
    assert.equal(started, false);
});

test('a role may not hand work over before writing the files of its own step', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-delegate-own-step-'));
    let started = false;
    try {
        const delegate = createDelegator({
            run: async () => { started = true; return {}; },
            root,
            role: 'markup',
            context: { step: { id: 'markup-1', files: ['index.html'], criteria: [] } },
            resolveRole: () => ({ tools: [], maxTurns: 10 }),
        });
        await assert.rejects(
            () => delegate({ role: 'coder', task: 'Write main.js', files: ['main.js'] }),
            /сначала напишите файлы своего шага \(index\.html\)/,
        );
        assert.equal(started, false);

        // The own file is on the disk: the hand-over is allowed again.
        await writeFile(path.join(root, 'index.html'), '<main></main>\n');
        const report = await delegate({ role: 'coder', task: 'Write main.js', files: ['main.js'] });
        assert.match(report, /NOT VERIFIED|VERIFIED/);
        assert.equal(started, true);
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
    }
});

test('a child session without output files is reported as unverified', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-delegate-empty-'));
    const events = [];
    try {
        const delegate = createDelegator({
            run: async (request) => {
                assert.equal(request.requireFiles, true);
                assert.equal(request.maxTurns, 7);
                return { text: 'I inspected the project.', turns: 8, toolCalls: [], outputFiles: [], data: null };
            },
            root,
            role: 'styler',
            notify: (event) => events.push(event),
            resolveRole: () => ({ tools: [], maxTurns: 16 }),
        });
        const report = await delegate({ role: 'coder', task: 'Write main.js', files: ['main.js'] });
        assert.match(report, /NOT VERIFIED/);
        assert.match(report, /main\.js/);
        assert.equal(events.find((event) => event.type === 'delegate.done').ok, false);
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
    }
});

test('a role may not hand the work to itself, nor to nobody', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-delegate-guard-'));
    try {
        const delegate = createDelegator({
            run: async () => ({ text: '', turns: 0, toolCalls: [], data: null }),
            root,
            role: 'styler',
            resolveRole: () => ({ tools: [], maxTurns: 4 }),
        });
        await assert.rejects(() => delegate({ role: 'styler', task: 'x' }), /самой себе/);
        await assert.rejects(() => delegate({ role: 'nope', task: 'x' }), /неизвестная роль/);
        await assert.rejects(() => delegate({ role: 'markup', task: '' }), /задача пуста/);
        await assert.rejects(() => delegate({ task: 'x' }), /назовите роль/);
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
    }
});

test('the hand-over is one level deep', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-delegate-depth-'));
    try {
        const delegate = createDelegator({
            run: async () => ({ text: '', turns: 0, toolCalls: [], data: null }),
            root,
            role: 'styler',
            depth: 1,
            resolveRole: () => ({ tools: [], maxTurns: 4 }),
        });
        await assert.rejects(() => delegate({ role: 'markup', task: 'x' }), /глубже одного уровня/);
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
    }
});

test('the roles of the project may hand the work over', async () => {
    const { ROLES } = await import('../src/roles/index.js');
    for (const name of ['markup', 'styler', 'coder']) {
        assert.ok(ROLES[name].tools.includes('delegate_role'), name);
    }
    // The roles of the whole run do not hand work over: they work once.
    for (const name of ['planner', 'architect', 'reviewer']) {
        assert.ok(!ROLES[name].tools.includes('delegate_role'), name);
    }
});

void writeFile;
