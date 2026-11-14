/**
 * @file test/tools.test.js
 * @module test/tools
 * @purpose The tests of the agent tools: the file operations, the backups, the limits of the
 *          working directory and the bridges.
 * @depends node:test, node:http, agent/tools, agent/quality, agent/pace, config
 * @ai.tags test, tools
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';

import { createToolset, htmlToText } from '../src/agent/tools.js';
import { runBridge } from '../src/agent/bridges.js';
import { normalizeVerdict, verdictFromScores } from '../src/agent/quality.js';
import { resolvePace, effortFor } from '../src/agent/pace.js';
import { defaults } from '../src/config.js';

/**
 * A working directory with one file in it.
 * @returns {Promise<{ root: string, config: object, tools: object }>}
 */
async function workspace() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-tools-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    const config = structuredClone(defaults);
    return { root, config, tools: createToolset({ root, config }) };
}

test('the toolset writes, reads and replaces a file', async () => {
    const { root, tools } = await workspace();
    await tools.execute('write_file', { path: 'src/index.html', content: '<h1>hi</h1>' });
    const read = await tools.execute('read_file', { path: 'src/index.html' });
    assert.match(read, /<h1>hi<\/h1>/);
    const replaced = await tools.execute('replace_text', {
        path: 'src/index.html',
        search: 'hi',
        replacement: 'hello',
    });
    assert.match(replaced, /Заменено/);
    const body = await readFile(path.join(root, 'src/index.html'), 'utf8');
    assert.equal(body, '<h1>hello</h1>');
});

test('the toolset refuses to write outside the working directory', async () => {
    const { tools } = await workspace();
    await assert.rejects(
        () => tools.execute('write_file', { path: '../escape.txt', content: 'x' }),
        /вне рабочего каталога/,
    );
});

test('a snapshot restores the file of the step before', async () => {
    const { root, tools } = await workspace();
    await tools.execute('write_file', { path: 'src/index.html', content: 'first' });
    await tools.execute('write_file', { path: 'src/index.html', content: 'second' });
    const backups = await tools.execute('list_backups', { path: 'src/index.html' });
    const id = backups.split(/\s+/)[0];
    await tools.execute('restore_backup', { id });
    const body = await readFile(path.join(root, 'src/index.html'), 'utf8');
    assert.equal(body, 'first');
});

test('a bridge that is off is skipped, not failed', async () => {
    const { config } = await workspace();
    config.bridges.decompose.enabled = false;
    const result = await runBridge({ name: 'ai-decompose', args: [], config });
    assert.equal(result.skipped, true);
    assert.equal(result.ok, false);
});

test('a bridge that is missing does not throw', async () => {
    const { config } = await workspace();
    config.bridges.measure.enabled = true;
    config.bridges.measure.command = 'ai-measure-does-not-exist';
    const result = await runBridge({
        name: 'ai-measure',
        args: [],
        config,
        root: path.join(os.tmpdir(), 'ai-webdev-no-cli'),
        env: { PATH: '' },
    });
    assert.equal(result.skipped, false);
    assert.equal(result.ok, false);
    assert.ok(result.reason);
});

test('fetch_url reads the text of a page', async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><head><style>a{color:red}</style><script>alert(1)</script></head><body><h1>Doc</h1></body></html>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const port = server.address().port;
        const { tools } = await workspace();
        const answer = await tools.execute('fetch_url', { url: `http://127.0.0.1:${port}/doc` });
        assert.match(answer, /HTTP 200/);
        assert.match(answer, /Doc/);
        assert.doesNotMatch(answer, /alert\(1\)/);
    } finally {
        server.close();
    }
});

test('a command that does not finish on its own is refused', async () => {
    const { tools } = await workspace();
    const answer = await tools.execute('run_command', {
        command: 'python',
        args: JSON.stringify(['-m', 'http.server', '8000']),
    });
    assert.match(answer, /не запущена/);
    assert.match(answer, /не заканчивается сама/);
});

test('the html of a page becomes readable text', () => {
    const text = htmlToText('<style>a{}</style><p>Hello &amp; bye</p>');
    assert.equal(text, 'Hello & bye');
});

test('the verdicts are pass, partial and fail', () => {
    assert.equal(normalizeVerdict('accept'), 'pass');
    assert.equal(normalizeVerdict('revise'), 'partial');
    assert.equal(normalizeVerdict('nonsense'), null);
    assert.equal(verdictFromScores({ a: 0.9, b: 0.8 }).verdict, 'pass');
    assert.equal(verdictFromScores({ a: 0.5 }).verdict, 'partial');
    assert.equal(verdictFromScores({ a: 0.1 }).verdict, 'fail');
});

test('the pace leaves the effort alone until a dial moves', () => {
    const config = structuredClone(defaults);
    config.reasoning.effort = 'medium';
    assert.equal(effortFor({ config, role: 'coder' }), 'medium');
    config.pace.codeQuality = 100;
    // The dial is 50 points above the default: two bands of 25, two steps of the ladder.
    assert.equal(effortFor({ config, role: 'coder' }), 'xhigh');
    const pace = resolvePace({ config, role: 'coder' });
    assert.equal(pace.stageQuality, 100);
});
