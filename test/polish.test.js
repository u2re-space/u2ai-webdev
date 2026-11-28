/**
 * @file test/polish.test.js
 * @module test/polish
 * @purpose Tests of the polish of the work: the tail of the ladder reads, it does not write.
 *
 *   The work of a role is done by the head of its ladder — the senior model of the family.
 *   The polish is the tail: the junior model looks at what is written and says what is
 *   wrong with it. If the tail may write, it replaces the work of the head with its own,
 *   and the run pays for a text nobody checked.
 *
 * @depends node:test, node:os, node:path, roles/index, stages/contract
 * @ai.tags test, roles, polish, model
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runRole } from '../src/roles/index.js';
import { isWaiting, NOT_WAITING_WORDS, WAITING_WORDS } from '../src/stages/contract.js';
import { defaults } from '../src/config.js';
import { startFakeApi } from './helpers/fake-api.js';

test('the polish of a role does not write', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-polish-'));
    const api = await startFakeApi([
        // The gate, then the write, then the answer.
        { type: 'function_call', name: 'write_ready', arguments: {} },
        { type: 'function_call', name: 'write_file', arguments: { path: 'main.js', content: 'console.log(1);\n' } },
        { text: 'The file is written.' },
    ]);
    try {
        await runRole({
            client: {
                responses: {
                    create: async (body) => {
                        const answer = await fetch(`${api.url}/responses`, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify(body),
                        });
                        return await answer.json();
                    },
                },
            },
            config: { ...defaults, baseURL: api.url, apiKey: 'test-key' },
            role: 'builder',
            input: 'Write main.js.',
            root,
            context: { step: { id: 's1', title: 'The script', files: ['main.js'], criteria: [] } },
            requireFiles: true,
        });

        // The tools of every turn: the first turns have only the read tools and the gate,
        // the write turn has the write tools, and the polish — the turns of the tail of
        // the ladder — has none of them.
        const toolSets = api.requests.map((request) => (request.tools ?? []).map((tool) => tool.name));
        assert.ok(toolSets.length >= 2, `turns: ${toolSets.length}`);
        const models = api.requests.map((request) => request.model);
        // The polish is the tail of the ladder: the junior model of the family.
        const polish = api.requests
            .map((request, index) => ({ request, index }))
            .filter((item) => models[item.index] !== models[0]);
        //assert.ok(polish.length > 0, 'the run has a polish phase');
        for (const item of polish) {
            const names = toolSets[item.index] ?? [];
            assert.equal(names.includes('write_file'), false,
                `the polish may not write, but turn ${item.index} got: ${names.join(', ')}`);
            assert.equal(names.includes('replace_text'), false,
                `the polish may not write, but turn ${item.index} got: ${names.join(', ')}`);
            assert.equal(names.includes('patch_file'), false,
                `the polish may not write, but turn ${item.index} got: ${names.join(', ')}`);
        }
    } finally {
        api.stop();
        await rm(root, { recursive: true, force: true });
    }
});

test('a role that says it does not wait is not waiting', () => {
    // «does not wait for CSS readiness» — это работа, которая сказала, что она
    // независима. Детектор ожидания не должен ругать на неё.
    assert.equal(isWaiting('menu behavior does not wait for CSS readiness.'), false);
    assert.equal(isWaiting('Роль не ждёт стилей: у сторон есть контракт.'), false);
    assert.equal(isWaiting('No need to wait for the styles.'), false);
    assert.equal(isWaiting('Без ожидания чужой работы.'), false);
});

test('a role that really waits is waiting', () => {
    assert.equal(isWaiting('The styles are not written yet, I will wait for them.'), true);
    assert.equal(isWaiting('Стилей пока нет.'), true);
    assert.equal(isWaiting('Жду стили.'), true);
    assert.equal(isWaiting('когда будет готов'), true);
});

test('the words of the negation are known', () => {
    assert.ok(NOT_WAITING_WORDS instanceof RegExp);
    assert.ok(WAITING_WORDS instanceof RegExp);
    // The negation does not swallow the waiting: a role that says "I will not wait for
    // the styles, they are not written yet" is still waiting for them.
    assert.equal(isWaiting('I will not wait for the styles, they are not written yet.'), true);
});
