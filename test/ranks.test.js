/**
 * @file test/ranks.test.js
 * @module test/ranks
 * @purpose Tests of the ladders of the ranks: the head of the ladder is the model of the work,
 *          the tail is the model of the polish, and the head is never lost for good.
 * @depends node:test, node:fs/promises, node:os, node:path, roles/index, model/trust
 * @ai.tags test, model, ranks
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveRole, runRole } from '../src/roles/index.js';
import { defaults } from '../src/config.js';

const configFor = (overrides = {}) => ({
    ...structuredClone(defaults),
    ...overrides,
});

/**
 * A response with one tool call.
 * @param {string} name
 * @param {object} args
 * @returns {object}
 */
function toolAnswer(name, args) {
    return {
        id: 'resp_1',
        status: 'completed',
        model: 'test-model',
        output: [{
            type: 'function_call',
            call_id: `call_${name}`,
            name,
            arguments: JSON.stringify(args ?? {}),
        }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
}

/**
 * A response with the schema of the role.
 * @param {string} name
 * @param {object} data
 * @returns {object}
 */
function schemaAnswer(name, data) {
    return {
        id: 'resp_3',
        status: 'completed',
        model: 'test-model',
        output: [{
            type: 'function_call',
            call_id: `call_${name}`,
            name,
            arguments: JSON.stringify(data ?? {}),
        }],
        usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
    };
}

test('the stage that fixes the styles starts at the head of the ladder', () => {
    const config = configFor();
    // The sight stage and the repair of the review fix the styles: they must answer with the
    // model of the house, not with the cheap tail of the ladder.
    assert.equal(resolveRole('styler', config, { stage: 'sight' }).model, 'openai/gpt-6.2-sol');
    assert.equal(resolveRole('styler', config, { stage: 'repair' }).model, 'openai/gpt-6.2-sol');
    assert.equal(resolveRole('styler', config, { stage: 'styling' }).model, 'openai/gpt-6.2-sol');
    assert.equal(resolveRole('styler', config, { stage: 'styler' }).model, 'openai/gpt-6.2-sol');
});

test('the phase of the work decides the rank of the family', () => {
    const config = configFor();
    assert.equal(resolveRole('styler', config, { phase: 'work' }).model, 'openai/gpt-6.2-sol');
    assert.equal(resolveRole('styler', config, { phase: 'polish' }).model, 'openai/gpt-6.1-terra');
});

test('a role that has to write again goes back to the head of the ladder', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-ranks-'));
    const requests = [];
    const client = { responses: { async create(body) {
        requests.push(body);
        if (requests.length === 1) {
            // The role answers with the schema, but nothing is written: it is told to work.
            return schemaAnswer('style', { summary: '', files: [], commands: [], notes: '' });
        }
        if (requests.length === 2) return toolAnswer('write_ready', {});
        if (requests.length === 3) return toolAnswer('write_file', { path: 'style.scss', content: '/* styles */' });
        return schemaAnswer('style', {
            summary: 'The styles are written.',
            files: [{ path: 'style.scss', content: '/* styles */', language: 'scss' }],
            commands: [],
            notes: '',
        });
    } } };

    await runRole({
        client,
        config: configFor(),
        role: 'styler',
        input: 'Write the styles.',
        context: {
            task: 'Write the styles.',
            step: { id: 'styles', title: 'Styles', files: ['style.scss'], criteria: [] },
        },
        root,
        requireFiles: true,
    });

    // The head of the ladder answers while the role writes...
    assert.equal(requests[0].model, 'openai/gpt-6.2-sol');
    // ...and the tail answers the polish of what is on the disk.
    assert.equal(requests.at(-1).model, 'openai/gpt-6.1-terra');
});

test('the panel of the operator follows the model that works', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-ranks-panel-'));
    const requests = [];
    const client = { responses: { async create(body) {
        requests.push(body);
        if (requests.length === 1) return toolAnswer('write_ready', {});
        if (requests.length === 2) return toolAnswer('write_file', { path: 'style.scss', content: '/* styles */' });
        return schemaAnswer('style', {
            summary: 'The styles are written.',
            files: [{ path: 'style.scss', content: '/* styles */', language: 'scss' }],
            commands: [],
            notes: '',
        });
    } } };

    // The panel of the shell: it shows the model of the work and the model of the polish.
    const seen = [];
    await runRole({
        client,
        config: configFor(),
        role: 'styler',
        input: 'Write the styles.',
        context: {
            task: 'Write the styles.',
            step: { id: 'styles', title: 'Styles', files: ['style.scss'], criteria: [] },
        },
        root,
        requireFiles: true,
        inputChannel: { setLocation: (location) => seen.push({ ...location }) },
    });

    const models = seen.map((item) => item.model).filter(Boolean);
    assert.equal(models[0], 'openai/gpt-6.2-sol', `the panel says ${models.join(', ')}`);
    // The files are on the disk: the polish is the tail of the ladder, and the panel says so.
    assert.ok(models.includes('openai/gpt-6.1-terra'), `the panel says ${models.join(', ')}`);
});

test('the model of the run is the head of its family, the roles keep their own ladder', () => {
    const config = configFor();
    // The run answers with the head of the family of the run...
    assert.equal(resolveRole('coder', config).model, 'openai/gpt-6.1-terra');
    // ...and the styler answers with the head of its own ladder.
    assert.equal(resolveRole('styler', config).model, 'openai/gpt-6.2-sol');
});

test('a delegated role answers with the model of the same stage', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-ranks-delegate-'));
    const requests = [];
    const queue = [
        // The markup hands the work of the styles to the styler.
        schemaAnswer('delegate_role', {
            role: 'styler',
            task: 'Write the styles of the page.',
            files: ['style.scss'],
        }),
        // The styler answers in its own session.
        schemaAnswer('style', {
            summary: 'The styles are written.',
            tokens: [],
            files: [{ path: 'style.scss', content: '/* styles */', language: 'scss' }],
            notes: '',
        }),
        // The markup answers after the hand-over.
        schemaAnswer('markup', {
            summary: 'The page is written.',
            files: [{ path: 'index.html', content: '<h1>Page</h1>', language: 'html' }],
            landmarks: [],
            accessibility: [],
            notes: '',
        }),
    ];
    const client = { responses: { async create(body) {
        requests.push(body);
        return queue[Math.min(requests.length - 1, queue.length - 1)];
    } } };

    await runRole({
        client,
        config: configFor(),
        role: 'markup',
        input: 'Write the page.',
        root,
    });

    assert.ok(requests.length >= 2, `requests: ${requests.length}`);
    // The delegated styler answers with the model of the house for the styles — not with the
    // model of the run and not with the cheap tail of the ladder.
    assert.equal(requests[1].model, 'openai/gpt-6.2-sol');
});
