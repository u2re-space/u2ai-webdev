/**
 * @file test/sight.test.js
 * @module test/sight
 * @purpose The tests of the stage of the sight: the page is shot, the styler sees the picture
 *          and the fix lands on the disk.
 * @depends node:test, node:path, node:fs/promises, stages/sight, stages/vision
 * @ai.tags test, sight, screenshot
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';

import { sightStage } from '../src/stages/sight.js';
import { defaults } from '../src/config/defaults.js';

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

/**
 * A client that answers with the ready answers and keeps the requests.
 * @param {object[]} answers
 * @returns {object}
 */
function fakeClient(answers = []) {
    let index = 0;
    const requests = [];
    return {
        requests,
        responses: {
            async create(body) {
                requests.push(body);
                const answer = answers[index++];
                return typeof answer === 'function' ? await answer(body) : (answer ?? { output: [], output_text: '' });
            },
        },
    };
}

test('the stage of the sight is off when the eye is off', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-sight-off-'));
    try {
        const config = structuredClone(defaults);
        config.browser.stylingVision = 'off';
        const result = await sightStage({ client: fakeClient([]), config, root });
        assert.equal(result.skipped, true);
        assert.deepEqual(result.shots, []);
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
    }
});

test('the stage of the sight shoots the page and asks the styler to fix the styles', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-sight-'));
    try {
        await writeFile(path.join(root, 'index.html'), '<!doctype html><html><body><p>x</p></body></html>', 'utf8');
        await writeFile(path.join(root, 'styles.scss'), 'body { color: red; }\n', 'utf8');

        const config = structuredClone(defaults);
        config.browser.stylingVision = 'always';
        config.browser.stylingVisionRounds = 1;
        // The dev server of the machine must not answer for this test.
        config.browser.devServer = 'off';

        const client = fakeClient([
            schemaAnswer('style', {
                summary: 'The type is smaller now.',
                tokens: [],
                files: [{ path: 'styles.scss', content: 'body { color: red; font-size: 16px; }\n', language: 'scss' }],
                notes: '',
            }),
        ]);

        const result = await sightStage({ client, config, root, task: 'A page.' });

        // The page was shot and the picture is on the disk.
        assert.equal(result.shots.length, 1);
        assert.match(result.shots[0], /^\.ai\/shots\/page-/);
        assert.ok((await readFile(path.join(root, result.shots[0]))).length > 0);

        // The role saw the picture of the result and the request named it.
        const request = client.requests[0];
        assert.ok(request.input, 'the role got a request');
        const text = JSON.stringify(request.input);
        assert.match(text, /Compare them/);
        assert.match(text, new RegExp(result.shots[0].replace(/[/.]/g, '\\$&')));
        // The role saw the styles as they are: it fixes the file, it does not write a new one.
        assert.match(text, /styles\.scss/);

        // The fix of the role landed on the disk.
        assert.equal(await readFile(path.join(root, 'styles.scss'), 'utf8'), 'body { color: red; font-size: 16px; }\n');
        assert.deepEqual(result.written, ['styles.scss']);
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
    }
});

test('the stage of the sight reports a page that cannot be opened and does not stop the run', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-sight-broken-'));
    try {
        const config = structuredClone(defaults);
        config.browser.stylingVision = 'always';
        // The dev server of the machine must not answer for this test.
        config.browser.devServer = 'off';
        // No index.html in the project: the page cannot be opened.
        const result = await sightStage({ client: fakeClient([]), config, root });
        assert.equal(result.ok, true);
        assert.deepEqual(result.shots, []);
        assert.ok(result.warnings.some((item) => /index\.html/.test(item)), result.warnings.join(' | '));
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
    }
});

test('the stage of the sight does not touch the files that are not styles', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-sight-scope-'));
    try {
        await writeFile(path.join(root, 'index.html'), '<!doctype html><html><body><p>x</p></body></html>', 'utf8');
        await writeFile(path.join(root, 'styles.scss'), 'body { color: red; }\n', 'utf8');

        const config = structuredClone(defaults);
        config.browser.stylingVision = 'always';
        config.browser.stylingVisionRounds = 1;
        config.browser.devServer = 'off';

        const client = fakeClient([
            schemaAnswer('style', {
                summary: 'The styles are fixed.',
                tokens: [],
                files: [
                    { path: 'styles.scss', content: 'body { color: blue; }\n', language: 'scss' },
                    { path: 'index.html', content: '<!doctype html><html><body>changed</body></html>\n', language: 'html' },
                ],
                notes: '',
            }),
        ]);

        const result = await sightStage({ client, config, root, task: 'A page.' });

        // The stylesheet is fixed, the markup is not touched.
        assert.equal(await readFile(path.join(root, 'styles.scss'), 'utf8'), 'body { color: blue; }\n');
        assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<!doctype html><html><body><p>x</p></body></html>');
        assert.ok(result.warnings.some((item) => /index\.html/.test(item)), result.warnings.join(' | '));
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
    }
});
