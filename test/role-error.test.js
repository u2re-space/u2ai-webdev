/**
 * @file test/role-error.test.js
 * @module test/role-error
 * @purpose The tests of the reason of a fallen role: an error that is an object reaches
 *          the journal and the report of the stage as text, and it is never lost.
 * @depends node:test, node:os, node:fs/promises, roles/index, stages/architect, agent/context
 * @ai.tags test, roles, errors, context
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';

import { runRole, roleReason } from '../src/roles/index.js';
import { architectStage } from '../src/stages/architect.js';
import { openContext, contextDirectory } from '../src/agent/context.js';
import { normalizePlan } from '../src/stages/plan.js';

test('the reason of a fallen role reads like text, not like [object Object]', () => {
    // The error of the host is an object: { message, status, code }.
    const reason = roleReason({ error: { message: 'The host refused the request', status: 503, code: 'API_ERROR' } });
    assert.match(reason, /хост не ответил/);
    assert.match(reason, /503/);
    assert.match(reason, /The host refused the request/);
    assert.doesNotMatch(reason, /\[object Object\]/);
    // A refusal is named as a refusal.
    assert.match(roleReason({ refusal: 'I cannot do this.' }), /отказ модели: I cannot do this\./);
    // An empty answer is named as an empty answer.
    assert.equal(roleReason({}), 'ответ пуст');
});

test('the reason of a fallen role reaches the journal of the run', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-role-error-'));
    const config = { output: { work: '.ai/tmp' } };
    const context = await openContext({ root, config, runId: 'run-err-1' });

    try {
        // The host failed: the answer of the role carries the error as an object.
        const client = {
            responses: {
                async create() {
                    return { id: 'resp-1', status: 'failed', error: { message: 'The host refused the request', status: 503 } };
                },
            },
        };
        const answer = await runRole({
            client,
            config,
            role: 'architect',
            input: 'Design the structure.',
            root,
            runContext: context,
            maxTurns: 2,
        });

        // The role did not answer, and the answer keeps the error object.
        assert.equal(answer.data, null);
        assert.ok(answer.error, 'the answer carries the error of the host');

        // The journal keeps the reason as text: "[object Object]" never reaches the file.
        const journal = await readFile(path.join(contextDirectory(root, config, 'run-err-1'), 'journal.ndjson'), 'utf8');
        assert.doesNotMatch(journal, /\[object Object\]/);
        assert.match(journal, /хост не ответил/);
        assert.match(journal, /503/);
    } finally {
        context.close?.();
        await rm(root, { recursive: true, force: true });
    }
});

test('a stage that lost the structure of the project names the reason', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-stage-reason-'));
    try {
        // The host failed on the first request and the role stopped there.
        const client = {
            responses: {
                async create() {
                    return { id: 'resp-1', status: 'failed', error: { message: 'The host refused the request', status: 503 } };
                },
            },
        };
        const result = await architectStage({
            client,
            config: { output: { work: './.tmp' }, reasoning: { effort: 'low' } },
            root,
            task: 'Make a landing.',
            plan: normalizePlan({ steps: [{ id: 'a', title: 'One' }] }),
            runId: 'run-err-2',
        });
        assert.equal(result.ok, false);
        assert.match(result.warnings[0], /хост не ответил/);
        assert.match(result.warnings[0], /The host refused the request/);
        assert.doesNotMatch(result.warnings[0], /\[object Object\]/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
