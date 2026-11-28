/**
 * @file test/advisor.test.js
 * @module test/advisor
 * @purpose Tests of the adviser: the senior model, asked before the work of a step.
 *
 *   The adviser is the counterpart of the reviewer: the reviewer judges what is on the
 *   disk, the adviser says how the work is better done — before the file is written. The
 *   tests here are about three things: the adviser is asked at all, its advice reaches
 *   the role that does the work, and it does not break the work when it fails.
 *
 * @depends node:test, node:assert, stages/advisor, roles/index, stages/step, config
 * @ai.tags test, advisor, roles
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';

import { advisorWanted, adviceText, consultAdvisor, readAdvisorAdvice } from '../src/stages/advisor.js';
import { runStepStage } from '../src/stages/step.js';
import { resolveRole } from '../src/roles/index.js';
import { defaults } from '../src/config.js';
import { mockApi, toolAnswer, schemaAnswer, codeData } from './helpers/role-api.js';

/**
 * A client that answers the requests of the roles.
 *
 * The adviser is answered with its own answer, and the worker with the ones of the list:
 * the two do not share a queue.
 *
 * @param {object[]} answers the answers of the worker
 * @param {object[]} [advice] the answers of the adviser
 * @param {string} [schema] the schema of the role of the worker
 * @returns {Promise<{ url: string, requests: object[], close: Function }>}
 */
async function clientFor(answers, advice = [], schema = 'markup') {
    return await mockApi({
        [schema]: answers,
        advice: advice.length ? advice : undefined,
    });
}

test('the adviser is the senior of the house, and it reads without writing', () => {
    const config = structuredClone(defaults);
    config.model = 'google/gemini-4-hydrogen';
    // The ladder matters: without it the role takes the model of the run, and that is the
    // **first** model of the family — the junior one.
    assert.equal(resolveRole('advisor', config).model, 'openai/gpt-6.2-sol');
});

test('the adviser reads only: it has no tool of writing', async () => {
    const { ROLES } = await import('../src/roles/index.js');
    const tools = ROLES.advisor.tools;
    assert.ok(tools.includes('read_file'));
    assert.ok(tools.includes('list_files'));
    for (const tool of tools) {
        assert.ok(
            !['write_file', 'replace_text', 'patch_file', 'delete_file', 'make_dir',
                'copy_path', 'batch', 'run_command', 'run_script', 'code_mode']
                .includes(tool),
            `the adviser must not have ${tool}`,
        );
    }
});

test('the config decides which steps are advised', () => {
    const config = structuredClone(defaults);
    // The writing stage is advised by default.
    assert.equal(advisorWanted(config, { stage: 'write', step: { id: 'm1' } }), true);
    // The stage of the icons is not: the place of an icon is a cheap decision.
    assert.equal(advisorWanted(config, { stage: 'iconify', step: { id: 'i1' } }), false);
    // The switch turns it off.
    const off = { ...config, advisor: { ...config.advisor, enabled: false } };
    assert.equal(advisorWanted(off, { stage: 'write', step: { id: 'm1' } }), false);
    // The steps may be named: by the id, by the title or by a file.
    const only = { ...config, advisor: { ...config.advisor, steps: ['m1'] } };
    assert.equal(advisorWanted(only, { stage: 'write', step: { id: 'm1' } }), true);
    assert.equal(advisorWanted(only, { stage: 'write', step: { id: 'm2' } }), false);
    const byFile = { ...config, advisor: { ...config.advisor, steps: ['index.html'] } };
    assert.equal(advisorWanted(byFile, { stage: 'write', step: { id: 'm2', files: ['index.html'] } }), true);
});

test('the advice of the adviser is written for the role of the step', () => {
    const text = adviceText({
        summary: 'Write the markup against the tokens.',
        points: ['The tokens of the architect are the contract here.'],
        risks: ['The class of the state must match the one the scripts use.'],
        order: ['The markup first, the styles against it.'],
        notes: 'The reference is in the task.',
    });
    assert.match(text, /Write the markup against the tokens/);
    assert.match(text, /What is worth doing/);
    assert.match(text, /The tokens of the architect/);
    assert.match(text, /What is easy to get wrong here/);
    assert.match(text, /The order the work is better done in/);
    // An empty answer is still an answer: the role must know that the senior was asked.
    assert.equal(adviceText(null), '');
    assert.equal(adviceText({ summary: 'Nothing to add.' }), 'Nothing to add.');
});

test('the advice of the adviser reaches the role that does the step', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-advisor-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };
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

    const api = await clientFor(
        [
            toolAnswer('write_ready', {}),
            toolAnswer('write_file', { path: 'index.html', content: '<h1>Привет</h1>' }),
            schemaAnswer('markup', {
                summary: '',
                files: [{ path: 'index.html', content: '<h1>Привет</h1>', language: 'html' }],
                landmarks: [],
                accessibility: [],
                notes: '',
            }),
        ],
        [
            schemaAnswer('advice', {
                summary: 'Write the heading first.',
                points: ['The page has one heading and nothing else.'],
                risks: [],
                order: ['The heading, then the rest.'],
                notes: '',
            }),
        ],
    );

    try {
        const config = structuredClone(defaults);
        config.model = 'test-model';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        config.reasoning.effort = 'low';
        const { createClient } = await import('../src/openai/client.js');
        const client = await createClient({ config, env });

        const result = await runStepStage({
            client,
            config,
            root,
            task: 'A page.',
            role: 'markup',
            plan,
            apply: true,
            env,
        });

        assert.ok(result.ok, 'the step failed');
        // The advice is in the request of the role that does the work.
        const worker = api.requests.find((request) => {
            const tools = Array.isArray(request?.tools) ? request.tools : [];
            return tools.some((tool) => tool?.name === 'write_ready');
        });
        assert.ok(worker, 'the worker asked the model');
        const conversation = JSON.stringify(worker.input);
        assert.match(conversation, /The advice of the senior/);
        assert.match(conversation, /The page has one heading and nothing else/);
        // The advice is a counsel, not an order: the role may leave it.
        assert.match(conversation, /a counsel, not an order/);
        // The adviser was asked before the worker: its request comes first.
        const adviser = api.requests.findIndex((request) => {
            const tools = Array.isArray(request?.tools) ? request.tools : [];
            return tools.some((tool) => tool?.name === 'advice');
        });
        const workerAt = api.requests.indexOf(worker);
        assert.ok(adviser >= 0, 'the adviser was asked');
        assert.ok(adviser < workerAt, 'the adviser was asked before the work');
    } finally {
        api.close();
        await rm(root, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
    }
});

test('the advice is asked once: a continued run does not pay for it twice', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-advisor-cache-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };
    const step = {
        id: 'm1',
        title: 'Markup',
        role: 'markup',
        dependsOn: [],
        files: ['index.html'],
        criteria: [],
    };

    const api = await clientFor(
        [],
        [schemaAnswer('advice', {
            summary: 'The step is clear.',
            points: [],
            risks: [],
            order: [],
            notes: '',
        })],
    );

    try {
        const config = structuredClone(defaults);
        config.model = 'test-model';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        const { createClient } = await import('../src/openai/client.js');
        const client = await createClient({ config, env });

        const first = await consultAdvisor({
            client,
            config,
            root,
            task: 'A page.',
            step,
            env,
        });
        assert.ok(first.text, 'the adviser said nothing');
        assert.equal(first.cached, false);

        // The second question of the same step, with the same project, is answered from
        // the disk: the senior is not asked twice.
        const second = await consultAdvisor({
            client,
            config,
            root,
            task: 'A page.',
            step,
            env,
        });
        assert.equal(second.cached, true);
        assert.equal(second.text, first.text);
    } finally {
        api.close();
        await rm(root, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
    }
});

test('a failed adviser does not fail the step: the work goes on without the advice', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-advisor-fail-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };
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

    // The adviser gets nothing: the host answers with an empty body.
    const api = await mockApi({
        markup: [
            toolAnswer('write_ready', {}),
            toolAnswer('write_file', { path: 'index.html', content: '<h1>Привет</h1>' }),
            schemaAnswer('markup', {
                summary: '',
                files: [{ path: 'index.html', content: '<h1>Привет</h1>', language: 'html' }],
                landmarks: [],
                accessibility: [],
                notes: '',
            }),
        ],
        advice: [{ status: 500, body: { error: { message: 'refused' } } }],
    });

    try {
        const config = structuredClone(defaults);
        config.model = 'test-model';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        const { createClient } = await import('../src/openai/client.js');
        const client = await createClient({ config, env });

        const result = await runStepStage({
            client,
            config,
            root,
            task: 'A page.',
            role: 'markup',
            plan,
            apply: true,
            env,
        });

        // The step worked: a counsel that could not be given leaves the role to work as it
        // would have anyway.
        assert.ok(result.ok, 'the step failed because the adviser failed');
        assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<h1>Привет</h1>');
    } finally {
        api.close();
        await rm(root, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
    }
});

test('the advice is not asked when the config says the stage is not advised', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-advisor-off-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };
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

    const api = await clientFor([
        toolAnswer('write_ready', {}),
        toolAnswer('write_file', { path: 'index.html', content: '<h1>Привет</h1>' }),
        schemaAnswer('markup', {
            summary: '',
            files: [{ path: 'index.html', content: '<h1>Привет</h1>', language: 'html' }],
            landmarks: [],
            accessibility: [],
            notes: '',
        }),
    ]);

    try {
        const config = structuredClone(defaults);
        config.model = 'test-model';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        config.advisor = { ...config.advisor, stages: [] };
        const { createClient } = await import('../src/openai/client.js');
        const client = await createClient({ config, env });

        const result = await runStepStage({
            client,
            config,
            root,
            task: 'A page.',
            role: 'markup',
            plan,
            apply: true,
            env,
        });

        assert.ok(result.ok);
        // The senior was not asked at all.
        const asked = api.requests.some((request) => {
            const tools = Array.isArray(request?.tools) ? request.tools : [];
            return tools.some((tool) => tool?.name === 'advice');
        });
        assert.equal(asked, false, 'the adviser was asked although the config says not to');
    } finally {
        api.close();
        await rm(root, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
    }
});
