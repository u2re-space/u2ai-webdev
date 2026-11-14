/**
 * @file test/log.test.js
 * @purpose Tests of the log of the API calls.
 * @depends node:test, node:path, node:fs/promises, openai/log
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';

import { createApiLogger, redactBody } from '../src/openai/log.js';

test('the log is off without a directory', () => {
    assert.equal(createApiLogger({ dir: null }), null);
    assert.equal(createApiLogger({ dir: '   ' }), null);
});

test('a record is written as a JSON file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-measure-log-'));
    try {
        const logger = createApiLogger({ dir: 'records', cwd: dir });
        const file = await logger.write({ path: 'responses', model: 'kimi', attempts: [{ backend: 'a', ok: true }] });
        const names = await readdir(logger.dir);
        assert.equal(names.length, 1);
        assert.equal(path.basename(file), names[0]);
        const record = JSON.parse(await readFile(file, 'utf-8'));
        assert.equal(record.path, 'responses');
        assert.equal(record.model, 'kimi');
        assert.equal(record.attempts[0].backend, 'a');
        assert.match(record.at, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('the pictures of a body are not written into the record', () => {
    const body = {
        input: [{ role: 'user', content: [{ type: 'input_image', image_url: `data:image/png;base64,${'A'.repeat(500)}` }] }],
        model: 'kimi',
    };
    const clean = redactBody(body);
    const image = clean.input[0].content[0].image_url;
    assert.match(image, /^data:image\/png;base64,/);
    assert.match(image, /bytes of base64/);
    assert.ok(image.length < 120, 'the picture does not fit into the record');
    assert.equal(clean.model, 'kimi');
});

test('the redaction walks the arrays and the objects', () => {
    const clean = redactBody({ a: [{ b: 'data:image/jpeg;base64,AAAA' }], c: 1 });
    assert.match(clean.a[0].b, /bytes of base64/);
    assert.equal(clean.c, 1);
});
