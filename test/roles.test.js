/**
 * @file test/roles.test.js
 * @module test/roles
 * @purpose The tests of the roles: the resolution of a role, the instructions and the loop of
 *          the calls with the tools.
 * @depends node:test, node:http, roles/index, openai/client, config
 * @ai.tags test, roles
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';

import { ROLES, ROLE_NAMES, resolveRole, roleSchema, buildInstructions, runRole, roleReason } from '../src/roles/index.js';
import { toolSpecs } from '../src/agent/tool-specs.js';
import { createClient } from '../src/openai/client.js';
import { defaults } from '../src/config.js';

/**
 * A mock of the Responses API: it answers the first request with a tool call, the second one
 * with the final text.
 * @param {object[]} answers the answers, one per request
 * @returns {Promise<{ url: string, requests: object[], close: Function }>}
 */
async function mockApi(answers) {
    const requests = [];
    let index = 0;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            requests.push(JSON.parse(body || '{}'));
            const answer = answers[Math.min(index, answers.length - 1)];
            index += 1;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(answer));
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    return {
        url: `http://127.0.0.1:${port}/v1/`,
        requests,
        close: () => server.close(),
    };
}

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
            arguments: JSON.stringify(args),
        }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
}

/**
 * A response with a text answer.
 * @param {string} text
 * @returns {object}
 */
function textAnswer(text) {
    return {
        id: 'resp_2',
        status: 'completed',
        model: 'test-model',
        output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
        usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
    };
}

/**
 * A response with the call of the schema of a role: the answer of the role.
 * @param {string} name the name of the schema
 * @param {object} args the data of the answer
 * @returns {object}
 */
function schemaAnswer(name, args) {
    return {
        id: 'resp_3',
        status: 'completed',
        model: 'test-model',
        output: [{
            type: 'function_call',
            call_id: `call_${name}`,
            name,
            arguments: JSON.stringify(args),
        }],
        usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
    };
}

/**
 * The data of the answer of the coder.
 * @returns {object}
 */
function codeData() {
    return {
        summary: 'The page is written.',
        files: [{ path: 'index.html', content: '<h1>Привет</h1>', language: 'html' }],
        commands: [],
        notes: 'Nothing else.',
    };
}

test('every built-in role is in the registry', () => {
    for (const name of [
        'planner', 'architect', 'director', 'coder', 'markup', 'styler',
        'iconifier', 'installer', 'editor', 'reviewer', 'auditor', 'learner',
    ]) {
        assert.ok(ROLES[name], `the role ${name} is missing`);
        assert.equal(ROLES[name].name, name);
        assert.ok(Array.isArray(ROLES[name].tools));
        assert.ok(Number.isInteger(ROLES[name].maxTurns));
    }
    assert.equal(ROLE_NAMES.length, 12);
});

test('a role is resolved from the config', () => {
    const config = structuredClone(defaults);
    const role = resolveRole('coder', config);
    assert.equal(role.name, 'coder');
    assert.equal(role.schema, 'code');
    assert.ok(role.tools.includes('write_file'));
    assert.equal(role.model, config.model);

    config.roles.coder.model = 'other-model';
    config.roles.coder.tools = ['read_file'];
    config.roles.coder.maxTurns = 3;
    const changed = resolveRole('coder', config);
    assert.equal(changed.model, 'other-model');
    assert.deepEqual(changed.tools, ['read_file']);
    assert.equal(changed.maxTurns, 3);

    assert.equal(resolveRole('nothing', config), null);
});

test('the effort of a role comes from the profile of the stages', () => {
    const config = structuredClone(defaults);
    config.reasoning.effort = 'xhigh';
    // The markup and the styles carry the look of the reference: they get the deepest
    // reasoning; the scripts and the mechanical work get the cheapest one.
    assert.equal(resolveRole('markup', config).effort, 'xhigh');
    assert.equal(resolveRole('styler', config).effort, 'xhigh');
    assert.equal(resolveRole('coder', config).effort, 'medium');
    assert.equal(resolveRole('planner', config).effort, 'medium');
    assert.equal(resolveRole('architect', config).effort, 'medium');
    assert.equal(resolveRole('installer', config).effort, 'low');

    // The effort of the run is the ceiling: a stage never works above it.
    config.reasoning.effort = 'medium';
    assert.equal(resolveRole('markup', config).effort, 'medium');
    assert.equal(resolveRole('coder', config).effort, 'medium');

    // The effort of the role itself wins over the profile.
    config.roles.markup.effort = 'high';
    assert.equal(resolveRole('markup', config).effort, 'high');

    // A profile that is turned off leaves every role with the effort of the run.
    config.roles.markup.effort = null;
    config.reasoning.stageEffort = null;
    assert.equal(resolveRole('markup', config).effort, 'medium');
    assert.equal(resolveRole('coder', config).effort, 'medium');
});

test('the effort of a stage is pulled down to what the model takes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-effort-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };
    const api = await mockApi([textAnswer('ok')]);

    try {
        const config = structuredClone(defaults);
        // The ceiling of this model is `high`: the stage may ask for `xhigh`, but the
        // model refuses the level above its ceiling.
        config.model = 'openai/gpt-6.1-terra';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        config.reasoning.effort = 'xhigh';
        const client = await createClient({ config, env });
        await client.responses.create({ model: config.model, instructions: 'x', input: 'y', effort: 'xhigh' });
        assert.equal(api.requests[0].reasoning.effort, 'high');
    } finally {
        await api.close();
    }
});

test('the roles that read the project are told that the inputs are already in the context', () => {
    for (const name of ['planner', 'architect', 'markup', 'coder', 'styler']) {
        const text = ROLES[name].instructions({});
        assert.match(text, /are already in your context/, `the role ${name} may read the inputs again`);
    }
});

test('the roles that may measure the reference have the tool of the measurer', () => {
    for (const name of ['planner', 'architect', 'styler']) {
        assert.ok(ROLES[name].tools.includes('call_ai_measure'), `the role ${name} cannot call the measurer`);
    }
    const specs = toolSpecs(defaults.tools, { role: 'planner' });
    assert.ok(specs.some((spec) => spec.name === 'call_ai_measure'));
});

test('the roles that write the assets take the prepared pictures as they are', () => {
    for (const name of ['markup', 'coder']) {
        const text = ROLES[name].instructions({});
        assert.match(text, /prepared from the crops are the assets of the result/, `the role ${name} may redraw a prepared picture`);
        assert.match(text, /do not draw a copy of it/i, `the role ${name} may redraw a prepared picture`);
    }
    assert.match(ROLES.editor.instructions({}), /is not redrawn/i);
});

test('the planner does not plan a drawn copy of a picture of the reference', () => {
    const text = ROLES.planner.instructions({});
    assert.match(text, /stage `pictures` cuts them out/);
    // The direction of the design is not measured: the command is gone from the bridge.
    assert.doesNotMatch(text, /\["design"/);
});

test('the roles that check their work have the tool of the command', () => {
    for (const name of ['coder', 'styler', 'editor']) {
        assert.ok(ROLES[name].tools.includes('run_command'), `the role ${name} cannot run a command`);
        const specs = toolSpecs(defaults.tools, { role: name });
        assert.ok(specs.some((spec) => spec.name === 'run_command'), `the role ${name} has no command to run`);
    }
});

test('a role that answers with the schema and writes nothing is told to work, and the JSON format is dropped', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-loop-work-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };

    const api = await mockApi([
        // The model answers with the schema of the role and does no work.
        textAnswer(JSON.stringify({
            summary: '', files: [], landmarks: [], accessibility: [], notes: '',
        })),
        toolAnswer('write_file', { path: 'index.html', content: '<h1>Привет</h1>' }),
        schemaAnswer('markup', {
            summary: 'The page is written.',
            files: [{ path: 'index.html', content: '<h1>Привет</h1>', language: 'html' }],
            landmarks: ['main'],
            accessibility: [],
            notes: '',
        }),
    ]);

    try {
        const config = structuredClone(defaults);
        config.model = 'minimax/minimax-m3.1-flash';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        config.reasoning.effort = 'low';
        const client = await createClient({ config, env });

        const answer = await runRole({
            client,
            config,
            role: 'markup',
            input: 'Make the page.',
            context: {
                task: 'Make the page.',
                step: { id: 's1', title: 'Markup', files: ['index.html'], criteria: [] },
            },
            root,
            env,
            requireFiles: true,
        });

        assert.equal(answer.stopped, 'completed');
        assert.ok(answer.toolCalls.some((call) => call.name === 'write_file'));
        assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<h1>Привет</h1>');
        // The first request pins the answer to the schema, the second one does not: a model
        // that is pinned to a JSON answer never calls a tool.
        assert.ok(api.requests[0].text?.format, 'the first request pins the JSON format');
        assert.equal(api.requests[1].text?.format, undefined, 'the second request has no JSON format');
        // The correction names the file of the step.
        const second = api.requests[1].input.map((item) => JSON.stringify(item)).join('\n');
        assert.match(second, /not done the work yet/);
        assert.match(second, /index\.html/);
    } finally {
        api.close();
    }
});

test('a model whose profile leaves the format free answers with its tools', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-loop-free-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };

    const api = await mockApi([
        toolAnswer('write_file', { path: 'index.html', content: '<h1>Привет</h1>' }),
        schemaAnswer('markup', {
            summary: 'The page is written.',
            files: [{ path: 'index.html', content: '<h1>Привет</h1>', language: 'html' }],
            landmarks: ['main'],
            accessibility: [],
            notes: '',
        }),
    ]);

    try {
        const config = structuredClone(defaults);
        config.model = 'moonshotai/kimi-k3.1-pro';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        config.reasoning.effort = 'low';
        const client = await createClient({ config, env });

        const answer = await runRole({
            client,
            config,
            role: 'markup',
            input: 'Make the page.',
            context: {
                task: 'Make the page.',
                step: { id: 's1', title: 'Markup', files: ['index.html'], criteria: [] },
            },
            root,
            env,
            requireFiles: true,
        });

        assert.equal(answer.stopped, 'completed');
        assert.equal(answer.toolCalls.length, 1);
        // The request with tools does not pin the answer to the schema: the tools stay
        // reachable for the model, and the schema travels as a tool of its own.
        assert.equal(api.requests[0].text?.format, undefined);
        assert.ok(api.requests[0].tools.some((tool) => tool.name === 'markup'));
    } finally {
        api.close();
    }
});

test('a stage may pin the channel of the schema of a role', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-loop-pin-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };

    const api = await mockApi([
        schemaAnswer('plan', {
            summary: 'A landing page.',
            steps: [{ id: 'a', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'], criteria: ['opens'] }],
            risks: [],
            questions: [],
        }),
    ]);

    try {
        const config = structuredClone(defaults);
        // The profile of the model pins the answer to a JSON text, and the stage asks for
        // the tool channel anyway.
        config.model = 'minimax/minimax-m3.1-flash';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        config.reasoning.effort = 'low';
        const client = await createClient({ config, env });

        const answer = await runRole({
            client,
            config,
            role: 'planner',
            input: 'Plan the work.',
            root,
            env,
            schemaChannel: 'tool',
        });

        assert.equal(answer.data.steps.length, 1);
        // The request does not pin the answer to the schema: the tools stay reachable for
        // the model, and the schema travels as a tool of its own.
        assert.equal(api.requests[0].text?.format, undefined);
        assert.ok(api.requests[0].tools.some((tool) => tool.name === 'plan'));
    } finally {
        api.close();
    }
});

test('the schema of a role comes from the catalogue', () => {
    assert.ok(roleSchema('planner'));
    assert.equal(roleSchema('planner').additionalProperties, false);
    assert.ok(roleSchema('reviewer'));
    assert.equal(roleSchema('reviewer').additionalProperties, false);
    assert.equal(roleSchema('learner'), null);
    assert.equal(roleSchema('nothing'), null);
});

test('the instructions of a role carry the standards and the packs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-roles-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };
    const config = structuredClone(defaults);
    config.roles.coder.instructions = 'Always answer in Russian.';
    config.skills.dir = path.join(home, 'skills');
    await mkdir(config.skills.dir, { recursive: true });
    await writeFile(path.join(config.skills.dir, 'coder.md'), 'Use the design tokens of the project.');

    const text = await buildInstructions({ role: 'coder', config, root, env });
    assert.match(text, /You are the coder/);
    assert.match(text, /Always answer in Russian/);
    assert.match(text, /CSS grid/);
    assert.match(text, /Use the design tokens/);
    assert.match(text, /Untrusted data/);
});

test('the loop of a role runs the tools and returns the answer', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-loop-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };

    const api = await mockApi([
        toolAnswer('write_file', { path: 'index.html', content: '<h1>Привет</h1>' }),
        textAnswer(JSON.stringify({
            summary: 'The page is written.',
            files: [{ path: 'index.html', content: '<h1>Привет</h1>', language: 'html' }],
            commands: [],
            notes: 'Nothing else.',
        })),
    ]);

    try {
        const config = structuredClone(defaults);
        config.model = 'test-model';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        config.reasoning.effort = 'low';
        const client = await createClient({ config, env });

        const events = [];
        const answer = await runRole({
            client,
            config,
            role: 'coder',
            input: 'Make the page.',
            context: { task: 'Make the page.' },
            root,
            env,
            notify: (event) => events.push(event),
        });

        assert.equal(answer.role, 'coder');
        assert.equal(answer.stopped, 'completed');
        assert.equal(answer.turns, 2);
        assert.equal(answer.toolCalls.length, 1);
        assert.equal(answer.toolCalls[0].name, 'write_file');
        assert.equal(answer.data.summary, 'The page is written.');
        assert.ok(events.some((event) => event.type === 'role.tool' && event.name === 'write_file'));
        // The event of the call says what the call touches: the log is readable.
        const call = events.find((event) => event.type === 'role.tool' && event.name === 'write_file');
        assert.equal(call.arguments.path, 'index.html');
        assert.ok(call.arguments.content.length <= 200);

        const body = await readFile(path.join(root, 'index.html'), 'utf8');
        assert.equal(body, '<h1>Привет</h1>');

        // The second request carries the call and its answer.
        const second = api.requests[1];
        const kinds = second.input.map((item) => item.type ?? item.role);
        assert.ok(kinds.includes('function_call'));
        assert.ok(kinds.includes('function_call_output'));
    } finally {
        api.close();
    }
});

test('the loop stops when the turns run out', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-loop2-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };

    const api = await mockApi([toolAnswer('list_files', { path: '.' })]);

    try {
        const config = structuredClone(defaults);
        config.model = 'test-model';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        const client = await createClient({ config, env });

        const answer = await runRole({
            client,
            config,
            role: 'coder',
            input: 'Look around.',
            root,
            env,
            maxTurns: 2,
        });

        assert.equal(answer.stopped, 'maxTurns');
        assert.equal(answer.turns, 2);
        assert.equal(answer.toolCalls.length, 2);
    } finally {
        api.close();
    }
});

test('a role that answers with a text instead of the schema is asked once more', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-loop-schema-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };

    const api = await mockApi([
        textAnswer('Сначала изучу проект.'),
        schemaAnswer('code', codeData()),
    ]);

    try {
        const config = structuredClone(defaults);
        config.model = 'test-model';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        config.reasoning.effort = 'low';
        const client = await createClient({ config, env });

        const answer = await runRole({
            client,
            config,
            role: 'coder',
            input: 'Make the page.',
            root,
            env,
        });

        assert.equal(answer.stopped, 'completed');
        assert.equal(answer.turns, 2);
        assert.equal(answer.data.summary, 'The page is written.');
        // The second request carries the correction of the role.
        const second = api.requests[1].input.map((item) => JSON.stringify(item)).join('\n');
        assert.match(second, /carried no data of the schema/);
    } finally {
        api.close();
    }
});

test('a role whose turns ran out still gives the schema of the answer', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-loop-final-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };

    // The first two requests ask for a tool, the third one is the final answer of the role.
    const api = await mockApi([
        toolAnswer('list_files', { path: '.' }),
        toolAnswer('list_files', { path: '.' }),
        schemaAnswer('code', codeData()),
    ]);

    try {
        const config = structuredClone(defaults);
        config.model = 'test-model';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        config.reasoning.effort = 'low';
        const client = await createClient({ config, env });

        const answer = await runRole({
            client,
            config,
            role: 'coder',
            input: 'Make the page.',
            root,
            env,
            maxTurns: 2,
        });

        assert.equal(answer.stopped, 'completed');
        assert.equal(answer.turns, 2);
        assert.equal(answer.data.summary, 'The page is written.');
        assert.equal(answer.toolCalls.length, 2);

        // The final call asks for the answer alone: the only tool left is the schema.
        const last = api.requests[2];
        assert.equal(last.tools.length, 1);
        assert.equal(last.tools[0].name, 'code');
        const conversation = last.input.map((item) => JSON.stringify(item)).join('\n');
        assert.match(conversation, /The turns of the role are over/);
    } finally {
        api.close();
    }
});

test('a role that only describes its work is told to do it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-loop-work-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };

    // The first answer is a description of the work, the second one is the work.
    const api = await mockApi([
        schemaAnswer('code', { ...codeData(), files: [] }),
        schemaAnswer('code', codeData()),
    ]);

    try {
        const config = structuredClone(defaults);
        config.model = 'test-model';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        config.reasoning.effort = 'low';
        const client = await createClient({ config, env });

        const answer = await runRole({
            client,
            config,
            role: 'coder',
            input: 'Make the page.',
            context: { task: 'Make the page.', step: { id: 'markup', files: ['index.html'] } },
            root,
            env,
            requireFiles: true,
        });

        assert.equal(answer.stopped, 'completed');
        assert.equal(answer.turns, 2);
        assert.equal(answer.data.files.length, 1);
        // The second request carries the correction of the work.
        const second = api.requests[1].input.map((item) => JSON.stringify(item)).join('\n');
        assert.match(second, /have not done the work yet/);
        assert.match(second, /index\.html/);
    } finally {
        api.close();
    }
});

test('the reason of an answer without data is named', () => {    assert.match(roleReason({ refusal: 'I cannot do that.' }), /отказ модели/);
    assert.match(roleReason({ error: { message: 'the model is down' } }), /ошибка ответа/);
    assert.match(roleReason({ text: 'Сначала изучу проект.' }), /ответ без данных/);
    assert.match(roleReason({}), /ответ пуст/);
    assert.match(roleReason(), /ответ пуст/);
});

test('a tool that fails does not break the loop', async () => {    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-loop3-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };

    const api = await mockApi([
        toolAnswer('write_file', { path: '../escape.txt', content: 'x' }),
        textAnswer('Done.'),
    ]);

    try {
        const config = structuredClone(defaults);
        config.model = 'test-model';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        const client = await createClient({ config, env });

        const answer = await runRole({
            client,
            config,
            role: 'coder',
            input: 'Try to escape.',
            root,
            env,
        });

        assert.equal(answer.stopped, 'completed');
        assert.match(answer.text, /Done/);
        const output = api.requests[1].input.find((item) => item.type === 'function_call_output');
        assert.match(output.output, /failed/i);
    } finally {
        api.close();
    }
});
