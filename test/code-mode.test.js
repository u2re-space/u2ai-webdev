/**
 * @file test/code-mode.test.js
 * @module test/code-mode
 * @purpose Tests of Code Mode in the webdev system: the tool, the sandbox and the budget.
 * @depends node:test, node:assert, agent/code-mode, shared/code-mode, agent/tool-specs
 * @ai.tags test, code-mode, sandbox
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';

import { createCodeModeRunner, codeModeBudgetFor, codeModeInstruction, codeModeToolSpec } from '../src/agent/code-mode.js';
import { runCodeModeWorker, CODE_MODE_LIMITS } from '../src/shared/code-mode.js';
import { TOOL_SPECS, toolSpecs, configKeyFor } from '../src/agent/tool-specs.js';
import { defaults } from '../src/config/defaults.js';
import { createToolset } from '../src/agent/tools.js';
import { createClient } from '../src/openai/client.js';
import { runRole } from '../src/roles/index.js';
import { mockApi, toolAnswer, schemaAnswer, codeData } from './helpers/role-api.js';

test('the tool of Code Mode is in the catalogue and has a switch of its own', () => {
    assert.ok(TOOL_SPECS.code_mode, 'the tool of Code Mode is in the catalogue');
    assert.equal(configKeyFor('code_mode'), 'code_mode');
    assert.equal(defaults.tools.code_mode, true);
    const specs = toolSpecs(defaults.tools, { names: ['code_mode'] });
    assert.equal(specs.length, 1);
    assert.equal(specs[0].name, 'code_mode');
    // The model has to know what the tool does: the description is the behaviour.
    assert.match(specs[0].description, /sandbox/);
    assert.match(specs[0].description, /await/);
    assert.deepEqual(specs[0].parameters.required, ['code']);
    // The switch turns the tool off.
    assert.equal(toolSpecs({ code_mode: false }, { names: ['code_mode'] }).length, 0);
});

test('the spec of the tool of Code Mode names the program', () => {
    const spec = codeModeToolSpec();
    assert.equal(spec.name, 'code_mode');
    assert.equal(spec.type, 'function');
    assert.deepEqual(spec.parameters.required, ['code']);
});

test('the note of Code Mode tells the model what is inside the program', () => {
    const note = codeModeInstruction(['read_file', 'write_file']);
    assert.match(note, /await tools/);
    assert.match(note, /catalogue\.names/);
    assert.match(note, /fs/);
    assert.match(note, /shared/);
    assert.match(note, /allocate/);
    assert.match(note, /read_file, write_file/);
});

test('a program runs in the sandbox and calls the tools of the parent', async () => {
    const calls = [];
    const runner = createCodeModeRunner({
        execute: async (name, args) => {
            calls.push({ name, args });
            return `the answer of ${name}`;
        },
        specs: [
            { name: 'read_file', description: 'reads a file', parameters: {} },
            { name: 'write_file', description: 'writes a file', parameters: {} },
        ],
    });
    const answer = await runner({
        code: `
            const a = await tools.read_file({ path: 'a.txt' });
            await tools.write_file({ path: 'out.txt', content: a });
            return { a };
        `,
    });
    assert.match(answer, /The program ran/);
    assert.match(answer, /read_file, write_file/);
    assert.deepEqual(calls.map((call) => call.name), ['read_file', 'write_file']);
    assert.deepEqual(calls[0].args, { path: 'a.txt' });
});

test('a tool the parent did not name is not reachable from the program', async () => {
    const runner = createCodeModeRunner({
        execute: async () => 'ok',
        specs: [
            { name: 'read_file', description: 'reads a file', parameters: {} },
            { name: 'delete_file', description: 'deletes a file', parameters: {} },
        ],
        tools: ['read_file'],
    });
    const answer = await runner({
        code: 'return { hidden: typeof tools.delete_file, names: catalogue.names };',
    });
    assert.match(answer, /"hidden": "undefined"/);
    assert.match(answer, /"names": \[\s*"read_file"/);
});

test('the tool that hands work over is not in the catalogue of a program', async () => {
    const runner = createCodeModeRunner({
        execute: async () => 'ok',
        specs: [
            { name: 'read_file', description: 'reads a file', parameters: {} },
            { name: 'subagent', description: 'hands work over', parameters: {} },
            { name: 'code_mode', description: 'runs a program', parameters: {} },
            { name: 'ask_user', description: 'asks the operator', parameters: {} },
        ],
    });
    const answer = await runner({
        code: 'return catalogue.names;',
    });
    assert.doesNotMatch(answer, /subagent/);
    assert.doesNotMatch(answer, /code_mode/);
    assert.doesNotMatch(answer, /ask_user/);
});

test('a program that fails says so, and the model may try again', async () => {
    const runner = createCodeModeRunner({
        execute: async () => 'ok',
        specs: [{ name: 'read_file', description: 'reads a file', parameters: {} }],
    });
    const broken = await runner({ code: 'const = ;' });
    assert.match(broken, /did not run/);
    assert.match(broken, /Fix the program/);
    const empty = await runner({ code: '' });
    assert.match(empty, /empty/);
});

test('the budget of a turn with a program is bigger than the budget of a read', () => {
    // The turn of the inspection keeps the reduced budget.
    assert.equal(codeModeBudgetFor(1000, false), 125);
    // The turn of the write earns the budget of the write, and the program needs more.
    assert.equal(codeModeBudgetFor(1000, true, { factor: 2, ceiling: 65_536 }), 2000);
    // The ceiling of the config holds the budget back.
    assert.equal(codeModeBudgetFor(1000, true, { factor: 8, ceiling: 1500 }), 1500);
    // The cap of the model wins over the factor.
    assert.equal(codeModeBudgetFor(1000, true, { factor: 1, ceiling: 65_536 }), 1000);
    // A model without a cap has no budget to grow.
    assert.equal(codeModeBudgetFor(null, true), null);
});

test('the toolset of the run runs a program of the model', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-code-mode-'));
    try {
        await writeFile(path.join(root, 'a.txt'), 'alpha', 'utf8');
        const toolset = createToolset({ root, config: defaults, role: 'coder' });
        const answer = await toolset.execute('code_mode', {
            code: `
                const a = await tools.read_file({ path: 'a.txt' });
                await tools.write_file({ path: 'out.txt', content: 'written by the program' });
                return { a };
            `,
        });
        assert.match(answer, /The program ran/);
        // The program wrote the file with the tools of the parent.
        const written = await readFile(path.join(root, 'out.txt'), 'utf8');
        assert.equal(written, 'written by the program');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the sandbox of the webdev system stops a program that never ends', async () => {
    const report = await runCodeModeWorker({
        spec: { code: 'while (true) {}', timeoutMs: 1200 },
        onCall: async () => 'ok',
        entry: path.resolve(
            path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
            '..',
            'bin',
            'ai-webdev-code-mode-worker.js',
        ),
    });
    assert.equal(report.ok, false);
    assert.equal(report.reason, 'timeout');
    assert.ok(CODE_MODE_LIMITS.timeoutMs > 0);
});

test('a role may write a program instead of calling the tools one by one', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-code-role-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-code-home-'));
    const env = { HOME: home, USERPROFILE: home };
    const api = await mockApi([
        // The turn of the inspection.
        toolAnswer('write_ready', { outputTokens: 20_000 }),
        // The turn of the write: the model writes a program, not a file.
        toolAnswer('code_mode', {
            code: `
                const page = await tools.read_file({ path: 'index.html' });
                await tools.write_file({ path: 'built.html', content: page + '<!-- done -->' });
                return { ok: true };
            `,
        }),
        schemaAnswer('code', codeData()),
    ]);
    try {
        await writeFile(path.join(root, 'index.html'), '<h1>hi</h1>', 'utf8');
        const config = structuredClone(defaults);
        config.model = 'google/gemini-4-hydrogen';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        config.reasoning.effort = 'low';
        const client = await createClient({ config, env });

        const answer = await runRole({
            client,
            config,
            role: 'coder',
            input: 'Make the page.',
            context: { task: 'Make the page.' },
            root,
            env,
            requireFiles: true,
        });

        assert.equal(answer.stopped, 'completed');
        // The program wrote the file with the tools of the parent.
        const built = await readFile(path.join(root, 'built.html'), 'utf8');
        assert.match(built, /done/);
        // The turn of the write carried the program, and the program got the room it needs.
        assert.ok(api.requests[1].max_output_tokens > 51_200, 'the write turn of a program has room');
    } finally {
        api.close();
        await rm(root, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
    }
});
