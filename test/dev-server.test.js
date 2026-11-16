/**
 * @file test/dev-server.test.js
 * @module test/dev-server
 * @purpose The tests of the live page: the scripts of the project, the address of the dev
 *          server and the guard that keeps the run from taking the page of another project.
 * @depends node:test, node:fs/promises, stages/dev-server
 * @ai.tags test, dev-server, vision
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';

import { buildScripts, devScripts, detectDevUrl, DEFAULT_DEV_URL } from '../src/stages/dev-server.js';

/**
 * A project with one manifest.
 * @param {object} manifest
 * @returns {Promise<string>}
 */
async function project(manifest) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-dev-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest), 'utf8');
    return root;
}

test('the scripts of the server and of the build are read from the manifest', async () => {
    const root = await project({
        scripts: { dev: 'vite', build: 'vite build', test: 'vitest', lint: 'eslint' },
    });
    try {
        assert.deepEqual(await devScripts(root), ['dev']);
        assert.deepEqual(await buildScripts(root), ['build']);
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
    }
});

test('a project without a manifest has no server and no build', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-dev-empty-'));
    try {
        assert.deepEqual(await devScripts(root), []);
        assert.deepEqual(await buildScripts(root), []);
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
    }
});

test('the address of the dev server is the one of the config or the one of Vite', () => {
    assert.equal(detectDevUrl({ browser: { url: 'http://127.0.0.1:4000/' } }), 'http://127.0.0.1:4000/');
    assert.equal(detectDevUrl({ browser: {} }), DEFAULT_DEV_URL);
    assert.equal(detectDevUrl({}), DEFAULT_DEV_URL);
});
