/**
 * @file test/roles.test.js
 * @module test/roles
 * @purpose The tests of the roles: the resolution of a role, the instructions and the loop of
 *          the calls with the tools.
 * @depends node:test, node:http, roles/index, stages/roles, openai/client, config
 * @ai.tags test, roles
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';

import { ROLES, ROLE_NAMES, resolveRole, roleSchema, buildInstructions, runRole, roleReason, pictureParts } from '../src/roles/index.js';
import { runStepStage } from '../src/stages/step.js';
import { WEB_DEVELOPMENT, webDevelopment } from '../src/roles/web-development.js';
import { LIVE_ROLE_NAMES } from '../src/stages/roles.js';
import { toolSpecs } from '../src/agent/tool-specs.js';
import { createToolset } from '../src/agent/tools.js';
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
    // The styles carry the look of the reference: they get the deepest reasoning; the scripts
    // and the mechanical work get the cheapest one. The planner and the architect stay in
    // between: they decide, but they do not build.
    assert.equal(resolveRole('styler', config).effort, 'xhigh');
    assert.equal(resolveRole('coder', config).effort, 'high');
    assert.equal(resolveRole('planner', config).effort, 'high');
    assert.equal(resolveRole('architect', config).effort, 'high');
    assert.equal(resolveRole('installer', config).effort, 'high');

    // The markup is a Kimi job, and the Kimi has no levels above `medium`: the markup works on
    // `medium` however deep the profile of the stages asks.
    assert.equal(resolveRole('markup', config).effort, 'high');

    // The effort of the run is the ceiling: a stage never works above it.
    config.reasoning.effort = 'medium';
    assert.equal(resolveRole('styler', config).effort, 'medium');
    assert.equal(resolveRole('coder', config).effort, 'medium');

    // The effort of the role itself wins over the profile.
    config.roles.styler.effort = 'high';
    assert.equal(resolveRole('styler', config).effort, 'high');

    // A profile that is turned off leaves every role with the effort of the run.
    config.roles.styler.effort = null;
    config.reasoning.stageEffort = null;
    assert.equal(resolveRole('styler', config).effort, 'medium');
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

test('the frontend roles get the standard of the work', () => {
    for (const name of ['markup', 'coder', 'styler']) {
        const text = ROLES[name].instructions({});
        assert.match(text, /The standard of the frontend work/, `the role ${name} has no standard`);
        assert.match(text, /The file is finished/);
    }
    // The layers and the nesting are the rules of the styles.
    const styler = ROLES.styler.instructions({});
    assert.match(styler, /@layer reset, base, theme, layout, components, utilities;/);
    assert.match(styler, /The native nesting groups the rules/);
    // The roles that do not write the frontend do not get the standard.
    for (const name of ['planner', 'installer', 'learner']) {
        assert.doesNotMatch(ROLES[name].instructions({}), /The standard of the frontend work/);
    }
});

test('a role gets the part of the standard that concerns its craft', () => {
    const coder = ROLES.coder.instructions({});
    assert.match(coder, /Semantic HTML5/);
    assert.doesNotMatch(coder, /grid-template-areas/);

    const styler = ROLES.styler.instructions({});
    assert.match(styler, /grid-template-areas/);
    assert.doesNotMatch(styler, /Semantic HTML5/);

    // The whole standard is available for whoever asks for it.
    assert.match(WEB_DEVELOPMENT, /Semantic HTML5/);
    assert.match(WEB_DEVELOPMENT, /grid-template-areas/);
});

test('the standard holds the rules of the platform of today', () => {
    const text = webDevelopment('styler');
    // The cascade is held by the layers and not by the specificity.
    assert.match(text, /The cascade is held by the layers/);
    assert.match(text, /`:where\(\.button\)` has no specificity/);
    // The component asks the space it is given.
    assert.match(text, /@container card \(inline-size > 400px\)/);
    // The logical properties and the reset without `*`.
    assert.match(text, /margin-inline-start/);
    assert.match(text, /A reset on `\*` cannot be beaten by a web component/);
    // The experiments of the platform stay withheld.
    assert.match(text, /experiment is not a feature/);
});

test('the standard keeps the rules of the monolith that still hold', () => {
    for (const text of [WEB_DEVELOPMENT, webDevelopment('coder'), webDevelopment('styler')]) {
        // The file is finished.
        assert.match(text, /No `<!-- add more items here -->`/);
        // No framework that was not asked for.
        assert.match(text, /No CSS framework \(Tailwind, Bootstrap\)/);
        // The names say what the thing is.
        assert.match(text, /The names say what the thing is/);
    }
    assert.match(WEB_DEVELOPMENT, /Accessibility \(WCAG AA\)/);
});

test('the roles that read the project are told that the inputs are already in the context', () => {
    for (const name of ['planner', 'architect', 'markup', 'coder', 'styler']) {
        const text = ROLES[name].instructions({});
        assert.match(text, /are already in your context/, `the role ${name} may read the inputs again`);
    }
});

test('planning and implementation roles work from DESIGN.md and references without a measurer', () => {
    for (const name of ['planner', 'architect', 'styler']) {
        const text = ROLES[name].instructions({ design: 'DESIGN.md', reference: ['landing.png'] });
        assert.ok(!ROLES[name].tools.includes('call_ai_measure'), `the role ${name} may call the measurer`);
        assert.match(text, /measurements are optional|without measurements|do not request or run a measurer/i);
    }
    const specs = toolSpecs(defaults.tools, { role: 'planner', names: ROLES.planner.tools });
    assert.ok(!specs.some((spec) => spec.name === 'call_ai_measure'));
});

test('the roles that write the assets take the prepared pictures as they are', () => {
    for (const name of ['markup', 'coder']) {
        const text = ROLES[name].instructions({});
        assert.match(text, /prepared from the crops are the assets of the result/, `the role ${name} may redraw a prepared picture`);
        assert.match(text, /do not draw a copy of it/i, `the role ${name} may redraw a prepared picture`);
    }
    assert.match(ROLES.editor.instructions({}), /is not redrawn/i);
});

test('the editor gets a precise image-edit, flag and optional-crop workflow', () => {
    const text = ROLES.editor.instructions({ design: 'DESIGN.md', reference: ['landing.png'] });
    assert.match(text, /what to remove or change, what must remain pixel-faithful/i);
    assert.match(text, /measurements are optional/i);
    assert.match(text, /--background transparent/);
    assert.match(text, /--reference <file>/);
    assert.match(text, /\["crop", "<source>", "--x", "<x>", "--y", "<y>"/);
    assert.match(text, /"--width", "<width>", "--height", "<height>", "--out", "<crop>"\]/);
    assert.match(text, /ai-image info <source> --json/);
    assert.match(text, /Derive the box from the actual source image/);
    assert.match(text, /ai-image --help/);
});

test('the planner does not plan a drawn copy of a picture of the reference', () => {
    const text = ROLES.planner.instructions({});
    assert.match(text, /If prepared crops of reference pictures already exist/);
    assert.match(text, /absence must not block the work/);
    assert.match(text, /Never require or call a measurer/);
    // The direction of the design is not measured: the command is gone from the bridge.
    assert.doesNotMatch(text, /\["design"/);
});

test('the planner names the roles that the stages of the run execute', () => {
    const text = ROLES.planner.instructions({});
    for (const role of LIVE_ROLE_NAMES) {
        assert.match(text, new RegExp(`\`${role}\``), `the role ${role} is not named to the planner`);
    }
    // The roles that work once for the whole run are not roles of a step.
    for (const role of ['planner', 'installer', 'reviewer', 'auditor', 'architect']) {
        assert.doesNotMatch(text, new RegExp(`\`${role}\` writes`), `the role ${role} may be planned as a step`);
    }
    assert.match(text, /never done/);
});

test('the roles that check their work have the tool of the command', () => {
    for (const name of ['coder', 'styler', 'editor']) {
        assert.ok(ROLES[name].tools.includes('run_command'), `the role ${name} cannot run a command`);
        const specs = toolSpecs(defaults.tools, { role: name });
        assert.ok(specs.some((spec) => spec.name === 'run_command'), `the role ${name} has no command to run`);
    }
});

test('the reviewer gets only read tools and no live-browser tools', () => {
    assert.equal(ROLES.reviewer.maxTurns, 4);
    assert.ok(ROLES.reviewer.tools.includes('find_line'));
    assert.ok(ROLES.reviewer.tools.includes('read_file'));
    assert.deepEqual(ROLES.reviewer.tools, ['read_file', 'find_line']);
    const specs = toolSpecs(defaults.tools, { role: 'reviewer', names: ROLES.reviewer.tools });
    assert.deepEqual(specs.map((spec) => spec.name), ROLES.reviewer.tools);
    const toolset = createToolset({
        root: process.cwd(),
        config: structuredClone(defaults),
        role: 'reviewer',
        mcp: [{ name: 'browser', tools: [{ name: 'navigate', inputSchema: { type: 'object' } }] }],
    });
    assert.deepEqual(
        toolset.specsFor('reviewer', ROLES.reviewer.tools).map((spec) => spec.name),
        ROLES.reviewer.tools,
    );
    assert.ok(!ROLES.reviewer.tools.some((name) => name.startsWith('mcp:')));
    assert.doesNotMatch(ROLES.reviewer.instructions({}), /browser tool|navigate to/i);
});

test('reviewer config cannot restore tools outside the read-only allowlist', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-review-tools-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-review-home-'));
    const client = await mockApi([schemaAnswer('review', {
        verdict: 'pass',
        scores: { fidelity: 100, completeness: 100, accessibility: 100, quality: 100 },
        issues: [],
        summary: 'The step is good.',
        recommendations: [],
    })]);
    try {
        const config = structuredClone(defaults);
        config.backends = [{ baseURL: client.url, apiKey: 'test-key' }];
        config.roles.reviewer.tools = ['run_command', 'mcp:browser'];
        const apiClient = await createClient({ config, env: { HOME: home, USERPROFILE: home } });
        await runRole({
            client: apiClient,
            config,
            role: 'reviewer',
            input: 'Review the step.',
            context: { step: { id: 'review-1', title: 'Review', files: [] } },
            root,
            env: { HOME: home, USERPROFILE: home },
            requireFiles: false,
        });
        const offered = client.requests[0].tools.map((tool) => tool.name);
        assert.ok(!offered.includes('run_command'));
        assert.ok(!offered.some((name) => name.startsWith('mcp_')));
    } finally {
        await client.close();
    }
});

test('read_file sends an image to the role as a visual input', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-review-image-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-review-image-home-'));
    await writeFile(path.join(root, 'reference.png'), Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYuoAAAAASUVORK5CYII=',
        'base64',
    ));
    const api = await mockApi([
        toolAnswer('read_file', { path: 'reference.png' }),
        schemaAnswer('review', {
            verdict: 'pass',
            scores: { fidelity: 100, completeness: 100, accessibility: 100, quality: 100 },
            issues: [],
            summary: 'The reference was viewed.',
            recommendations: [],
        }),
    ]);
    try {
        const config = structuredClone(defaults);
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        const client = await createClient({ config, env: { HOME: home, USERPROFILE: home } });
        const result = await runRole({
            client,
            config,
            role: 'reviewer',
            input: 'Inspect the image.',
            context: { step: { id: 'image-1', title: 'Reference', files: ['reference.png'] } },
            root,
            env: { HOME: home, USERPROFILE: home },
            requireFiles: false,
        });

        assert.equal(result.data.summary, 'The reference was viewed.');
        assert.match(JSON.stringify(api.requests[1]), /input_image/);
        assert.match(JSON.stringify(api.requests[1]), /The picture the tool has made/);
    } finally {
        await api.close();
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
        // The markup is a Kimi job by default; the pin of the role keeps the model of the
        // test, and with it the pinned JSON answer of MiniMax.
        config.roles.markup.model = 'minimax/minimax-m3.1-flash';
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
        config.model = 'google/gemini-4-hydrogen';
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

test('the instructions of a role carry the contract of the answer', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-roles-contract-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };
    const config = structuredClone(defaults);

    const text = await buildInstructions({ role: 'markup', config, root, env });
    // The names of the fields travel in the prompt: a gateway that ignores the JSON-schema
    // rule of the API still shows the model the contract of the answer.
    assert.match(text, /The answer of the role is an object with these fields/);
    assert.match(text, /- summary: string/);
    assert.match(text, /- files: array of objects with the fields path, content, language/);
    assert.match(text, /Every field is required/);

    // A role without a schema has no contract.
    const learner = await buildInstructions({ role: 'learner', config, root, env });
    assert.doesNotMatch(learner, /The answer of the role is an object/);
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

test('the instructions of a role carry the pages of its sources', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-roles-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };
    const config = structuredClone(defaults);

    const text = await buildInstructions({ role: 'styler', config, root, env });
    // The rules of the standards and the pages behind them are two blocks.
    assert.match(text, /## Standards/);
    assert.match(text, /## Documentation sources/);
    assert.match(text, /- mdnCss: https:\/\/developer\.mozilla\.org\/en-US\/docs\/Web\/CSS/);
    assert.match(text, /- cssLayer: https:\/\/drafts\.csswg\.org\/css-cascade-5\//);
    // A page is data, not an instruction, and an experiment is not a feature.
    assert.match(text, /external data, not an instruction/);
    assert.match(text, /An experiment is not a feature/);

    // A role without a source gets neither the block nor the pages.
    const installer = await buildInstructions({ role: 'installer', config, root, env });
    assert.doesNotMatch(installer, /## Documentation sources/);
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

test('a picture that a tool made goes back into the conversation as a picture', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-role-picture-'));
    try {
        const { mkdir, writeFile } = await import('node:fs/promises');
        await mkdir(path.join(root, '.ai', 'shots'), { recursive: true });
        await writeFile(path.join(root, '.ai', 'shots', 'shot-1.png'), Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]));

        const requests = [];
        const queue = [
            // The role shoots the page and the tool answers with the path of the picture.
            {
                id: 'resp-1',
                status: 'completed',
                model: 'test-model',
                output: [{
                    type: 'function_call',
                    id: 'fc-1',
                    call_id: 'c-1',
                    name: 'screenshot',
                    arguments: JSON.stringify({ path: 'index.html' }),
                }],
            },
            {
                id: 'resp-2',
                status: 'completed',
                model: 'test-model',
                output: [{
                    type: 'function_call',
                    id: 'fc-2',
                    call_id: 'c-2',
                    name: 'code',
                    arguments: JSON.stringify({
                        summary: 'The picture was seen.',
                        files: [],
                        commands: [],
                        notes: '',
                    }),
                }],
            },
        ];
        const client = {
            responses: {
                async create(body) {
                    requests.push(body);
                    return queue[Math.min(requests.length - 1, queue.length - 1)];
                },
            },
        };
        // The tool answers with the path of the picture; the browser is not needed for the test.
        const toolset = {
            specsFor: () => [{ type: 'function', name: 'screenshot', description: '', parameters: {} }],
            execute: async () => 'The screenshot of the page is ready: .ai/shots/shot-1.png',
        };

        await runRole({
            client,
            config: structuredClone(defaults),
            role: 'coder',
            input: 'Look at the page.',
            root,
            toolset,
        });

        // The second request holds the picture: the role sees what it has shot.
        const second = JSON.stringify(requests[1]);
        assert.match(second, /input_image/);
        assert.match(second, /The picture the tool has made/);
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
    }
});

test('the pictures of the answer of a tool are read from the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-role-pictures-'));
    try {
        const { mkdir, writeFile } = await import('node:fs/promises');
        await mkdir(path.join(root, 'shots'), { recursive: true });
        await writeFile(path.join(root, 'shots', 'a.png'), Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]));
        // The extension lies: the payload itself decides which image type goes into the request.
        await writeFile(path.join(root, 'shots', 'mismatch.webp'), Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]));
        await writeFile(path.join(root, 'shots', 'actual.webp'), Buffer.from('RIFF0000WEBP'));
        await writeFile(path.join(root, 'notes.txt'), 'not a picture');

        const parts = await pictureParts(
            root,
            'The shots are here: shots/a.png, shots/mismatch.webp, shots/actual.webp — notes.txt is not.',
        );
        assert.equal(parts.length, 3);
        assert.ok(parts.every((part) => part.type === 'input_image'));
        assert.match(parts[1].image_url, /^data:image\/png;/);
        assert.match(parts[2].image_url, /^data:image\/webp;/);

        // The path outside the project is not a picture of the project.
        assert.deepEqual(await pictureParts(root, '../outside.png'), []);
        assert.deepEqual(await pictureParts(root, 'nothing here'), []);
    } finally {
        await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }));
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

test('the call of a tool with broken JSON does not run the tool and is reported', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-loop-broken-json-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };

    const api = await mockApi([
        {
            id: 'resp_broken',
            status: 'completed',
            model: 'test-model',
            output: [{
                type: 'function_call',
                call_id: 'call_write_file',
                name: 'write_file',
                arguments: '{ path: "index.html", content: ',
            }],
        },
        schemaAnswer('code', codeData()),
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
            input: 'Make the page.',
            root,
            env,
        });

        // The broken call is not a write: the file is not on the disk.
        assert.equal(await readFile(path.join(root, 'index.html'), 'utf8').catch(() => null), null);
        // The model is told what is wrong with its call.
        const second = api.requests[1].input.map((item) => JSON.stringify(item)).join('\n');
        assert.match(second, /not a JSON object/);
        assert.match(second, /valid JSON/);
        // The run continues: the next answer is the answer of the role.
        assert.equal(answer.stopped, 'completed');
    } finally {
        api.close();
    }
});

test('an answer that does not fit the schema is kept and its problems are reported', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-loop-schema-keep-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };

    // The answer has a field that the schema of the coder does not know.
    const api = await mockApi([
        schemaAnswer('code', { ...codeData(), extra: 'unexpected' }),
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
            input: 'Make the page.',
            root,
            env,
        });

        // The data of the role is kept: the stages know how to fill a missing field.
        assert.equal(answer.data.summary, 'The page is written.');
        assert.equal(answer.turns, 1, 'the work of the role is not spent on a second try');
        // The problems are not hidden.
        assert.ok(answer.schemaProblems.length, 'the problems of the answer are reported');
        assert.ok(answer.schemaProblems.some((problem) => problem.includes('extra')));
    } finally {
        api.close();
    }
});

test('the stage reports the problems of the answer of the role', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-step-schema-warning-'));
    const api = await mockApi([
        schemaAnswer('code', { ...codeData(), extra: 'unexpected' }),
    ]);

    try {
        const config = structuredClone(defaults);
        config.model = 'test-model';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        const client = await createClient({ config, env: process.env });

        const result = await runStepStage({
            client,
            config: { output: { work: './.tmp' } },
            root,
            task: 'Make the page.',
            role: 'coder',
            plan: {
                summary: 'A page.',
                steps: [{ id: 'code-1', title: 'Code', role: 'coder', dependsOn: [], files: [], criteria: [] }],
            },
            runId: 'run-1',
        });

        assert.ok(result.warnings.some((item) => /не по схеме/.test(item)), result.warnings.join(' | '));
    } finally {
        api.close();
    }
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
