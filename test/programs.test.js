/**
 * @file test/programs.test.js
 * @module test/programs
 * @purpose The tests of the runner of the programs: the lookup in the PATH, the start of a
 *          program, the answer of it and the missing program.
 * @depends node:test, node:os, node:path, agent/programs
 * @ai.tags test, tools
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';

import { runProgram, findProgram, quoteWindowsArg, WINDOWS_EXTENSIONS } from '../src/agent/programs.js';

test('a program of the PATH is found', async () => {
    const found = await findProgram(process.platform === 'win32' ? 'node' : 'node', process.env);
    assert.ok(found, 'node is in the PATH');
    assert.match(found.file, /node/);
});

test('a program that is not in the PATH is not found', async () => {
    const found = await findProgram('ai-webdev-no-such-program', process.env);
    assert.equal(found, null);
});

test('the shims of Windows are looked for first', () => {
    assert.ok(WINDOWS_EXTENSIONS.includes('.cmd'));
    assert.ok(WINDOWS_EXTENSIONS.includes('.exe'));
});

test('an argument with a space is quoted for the shell of Windows', () => {
    assert.equal(quoteWindowsArg('plain'), 'plain');
    assert.equal(quoteWindowsArg('two words'), '"two words"');
    assert.equal(quoteWindowsArg(''), '""');
});

test('a program runs and its answer is collected', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-programs-'));
    const result = await runProgram({
        command: process.execPath,
        args: ['-e', 'process.stdout.write("hello")'],
        cwd: root,
        timeoutMs: 30_000,
    });
    assert.equal(result.ok, true);
    assert.match(result.text, /hello/);
});

test('a missing program is named in the answer', async () => {
    const result = await runProgram({
        command: 'ai-webdev-no-such-program',
        args: [],
        cwd: process.cwd(),
        timeoutMs: 30_000,
    });
    assert.equal(result.ok, false);
    assert.match(result.text, /не найдена в PATH/);
});

test('a program that fails does not throw', async () => {
    const result = await runProgram({
        command: process.execPath,
        args: ['-e', 'process.exit(3)'],
        cwd: process.cwd(),
        timeoutMs: 30_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 3);
});

test('a program that waits for the input does not hold the run', async () => {
    const started = Date.now();
    const result = await runProgram({
        command: process.execPath,
        // The program reads the input until the end of it: without the end of the input it
        // would wait for a key that never comes.
        args: ['-e', 'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("done"))'],
        cwd: process.cwd(),
        timeoutMs: 20_000,
    });
    assert.equal(result.ok, true);
    assert.match(result.text, /done/);
    assert.ok(Date.now() - started < 15_000, 'the program did not wait for the timeout');
});

test('a program of the PATH is started from a directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-programs-cwd-'));
    await writeFile(path.join(root, 'marker.txt'), 'x', 'utf8');
    const result = await runProgram({
        command: process.execPath,
        args: ['-e', 'process.stdout.write(process.cwd())'],
        cwd: root,
        timeoutMs: 30_000,
    });
    assert.equal(result.ok, true);
    assert.match(result.text, /ai-webdev-programs-cwd-/);
});
