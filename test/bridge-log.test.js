/**
 * @file test/bridge-log.test.js
 * @purpose Tests of the live log of a bridge: the lines of a sibling CLI while it works.
 * @depends node:test, node:assert/strict, node:path, node:os, node:fs, node:fs/promises,
 *           shared/child-log, agent/bridges, cli/renderer
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { runBridge } from '../src/agent/bridges.js';
import { createToolset } from '../src/agent/tools.js';
import { createRenderer } from '../src/cli/renderer.js';
import { createLineReader, formatBridgeLine, splitLines } from '../src/shared/child-log.js';

/**
 * A child that says it is alive and waits for the gate.
 *
 * The gate is the proof that the log is live: the child only finishes when the file
 * appears, and the file appears when the line of the child has been read.
 * @param {string} root the directory of the child
 * @returns {Promise<{ script: string, gate: string }>} the script and the gate
 */
async function liveChild(root) {
    const script = path.join(root, 'fake-ai-image.js');
    const gate = path.join(root, 'gate');
    await writeFile(script, [
        "import { existsSync } from 'node:fs';",
        'const gate = process.env.FAKE_BRIDGE_GATE;',
        "process.stdout.write('the child is alive\\n');",
        'const until = Date.now() + 5000;',
        'while (gate && !existsSync(gate) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));',
        "process.stdout.write('the child is done\\n');",
        "process.stderr.write('the child warns\\n');",
    ].join('\n'));
    return { script, gate };
}

/**
 * The config with the bridge of the images on.
 * @param {object} [bridge]
 * @returns {object}
 */
function config(bridge = {}) {
    return {
        bridges: {
            image: { enabled: true, command: 'ai-image', timeoutMs: 20_000, ...bridge },
        },
    };
}

test('the reader of the lines keeps the tail of a chunk that has no line break', () => {
    const seen = [];
    const reader = createLineReader((line) => seen.push(line));
    reader.push('the first line\nthe sec');
    assert.deepEqual(seen, ['the first line']);
    reader.push('ond line\n');
    assert.deepEqual(seen, ['the first line', 'the second line']);
});

test('the reader of the lines gives the last line of a child that ends without a break', () => {
    const seen = [];
    const reader = createLineReader((line) => seen.push(line));
    reader.push('the last line');
    assert.deepEqual(seen, []);
    reader.flush();
    assert.deepEqual(seen, ['the last line']);
});

test('the lines of a text are the lines without the empty ones', () => {
    assert.deepEqual(splitLines('one\r\ntwo\n\nthree'), ['one', 'two', 'three']);
});

test('the line of a child carries the name of the child', () => {
    assert.equal(formatBridgeLine('ai-image', 'the model is called'), '[ai-image] the model is called');
    assert.equal(formatBridgeLine('ai-image', '   '), '');
});

test('the log of a bridge comes live, before the bridge is over', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-bridge-log-'));
    try {
        const { script, gate } = await liveChild(root);
        const seen = [];
        let finished = false;
        const result = await runBridge({
            name: 'ai-image',
            args: [],
            config: config(),
            cwd: root,
            env: { ...process.env, AI_IMAGE_BIN: script, FAKE_BRIDGE_GATE: gate },
            root: path.join(root, 'nowhere'),
            onLine: (event) => {
                seen.push({ ...event, after: finished });
                if (event.line.includes('alive')) writeFileSync(gate, 'go');
            },
        });
        finished = true;

        assert.equal(result.ok, true);
        assert.deepEqual(seen.map((item) => item.line), [
            'the child is alive',
            'the child is done',
            'the child warns',
        ]);
        assert.deepEqual(seen.map((item) => item.stream), ['stdout', 'stdout', 'stderr']);
        // The line came while the child was working, and not with the answer of the child.
        assert.equal(seen.some((item) => item.after), false);
        // The whole output is still in the answer of the bridge.
        assert.match(result.stdout, /the child is alive/);
        assert.match(result.stdout, /the child is done/);
        assert.match(result.stderr, /the child warns/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('a bridge that is told to keep quiet does not log anything', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-bridge-quiet-'));
    try {
        const { script, gate } = await liveChild(root);
        // The gate is open from the start: the child has nothing to wait for.
        await writeFile(gate, 'go');
        const seen = [];
        const result = await runBridge({
            name: 'ai-image',
            args: [],
            config: config({ log: false }),
            cwd: root,
            env: { ...process.env, AI_IMAGE_BIN: script, FAKE_BRIDGE_GATE: gate },
            root: path.join(root, 'nowhere'),
            onLine: (event) => {
                seen.push(event);
                if (event.line.includes('alive')) writeFileSync(gate, 'go');
            },
        });

        assert.equal(result.ok, true);
        assert.deepEqual(seen, []);
        assert.match(result.stdout, /the child is alive/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the renderer shows the line of a child on stderr', () => {
    const written = [];
    const stdout = { write: (text) => written.push(text), isTTY: false };
    const stderr = { write: (text) => written.push(text), isTTY: false };
    const renderer = createRenderer({ mode: 'plain', stdout, stderr });

    renderer.event({ type: 'bridge.log', name: 'ai-image', stream: 'stdout', line: 'the model is called' });

    const text = written.join('');
    assert.match(text, /ai-image/);
    assert.match(text, /the model is called/);
});

test('the renderer of the json mode gives the line of a child as an event', () => {
    const written = [];
    const stdout = { write: (text) => written.push(text), isTTY: false };
    const stderr = { write: (text) => written.push(text), isTTY: false };
    const renderer = createRenderer({ mode: 'json', stdout, stderr });

    renderer.event({ type: 'bridge.log', name: 'ai-image', stream: 'stderr', line: 'the model is called' });

    const event = JSON.parse(written.join('').trim());
    assert.equal(event.type, 'bridge.log');
    assert.equal(event.name, 'ai-image');
    assert.equal(event.stream, 'stderr');
    assert.equal(event.line, 'the model is called');
});

test('the tool of a bridge tells the run what the child writes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-bridge-tool-'));
    try {
        const { script, gate } = await liveChild(root);
        const events = [];
        const tools = createToolset({
            root,
            config: {
                inputs: { measurements: 'measurements/measurements.json' },
                bridges: { measure: { enabled: true, command: 'ai-measure', timeoutMs: 20_000 } },
            },
            env: { ...process.env, AI_MEASURE_BIN: script, FAKE_BRIDGE_GATE: gate },
            notify: (event) => {
                events.push(event);
                if (event.line?.includes('alive')) writeFileSync(gate, 'go');
            },
        });

        const answer = await tools.execute('call_ai_measure', { args: JSON.stringify(['measure', 'landing.png']) });

        const logs = events.filter((event) => event.type === 'bridge.log');
        assert.ok(logs.length > 0);
        assert.equal(logs[0].name, 'ai-measure');
        assert.match(logs[0].line, /the child is alive/);
        // The answer of the tool still carries the whole output of the child.
        assert.match(answer, /the child is done/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
