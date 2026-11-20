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

import { ROLES, ROLE_NAMES, resolveRole, readOnlyOperation, roleSchema, buildInstructions, runRole, roleReason, pictureParts } from '../src/roles/index.js';
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
 *
 * A request that asks for a stream is answered with the stream of the events: the roles
 * always ask for one, so the mock has to speak the same language as the API.
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
            const parsed = JSON.parse(body || '{}');
            requests.push(parsed);
            const answer = answers[Math.min(index, answers.length - 1)];
            index += 1;
            if (parsed.stream === true) {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write(`data: ${JSON.stringify({ type: 'response.created', response: { id: answer.id ?? 'resp_1', status: 'in_progress' } })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'response.completed', response: answer })}\n\n`);
                res.end();
                return;
            }
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
        'scanner', 'planner', 'architect', 'director', 'coder', 'markup', 'styler',
        'iconifier', 'installer', 'editor', 'reviewer', 'auditor', 'learner',
    ]) {
        assert.ok(ROLES[name], `the role ${name} is missing`);
        assert.equal(ROLES[name].name, name);
        assert.ok(Array.isArray(ROLES[name].tools));
        assert.ok(Number.isInteger(ROLES[name].maxTurns));
    }
    assert.equal(ROLE_NAMES.length, 13);
});

test('the scanner reads the project and does not plan', () => {
    const text = ROLES.scanner.instructions({ task: 'Make a landing.' });
    assert.match(text, /You are the scanner of a web project/);
    assert.match(text, /Report only what is on the disk/);
    assert.match(text, /Do not plan the work/);
    // The scanner only reads: it writes nothing and runs nothing.
    for (const name of ['write_file', 'replace_text', 'run_command', 'run_script']) {
        assert.ok(!ROLES.scanner.tools.includes(name), `the scanner has ${name}`);
    }
});

test('a role is resolved from the config', () => {
    const config = structuredClone(defaults);
    const role = resolveRole('coder', config);
    assert.equal(role.name, 'coder');
    assert.equal(role.schema, 'code');
    assert.ok(role.tools.includes('write_file'));
    //assert.equal(role.model, config.model);

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
    assert.equal(resolveRole('markup', config).effort, 'xhigh');

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
        assert.equal(api.requests[0].reasoning.effort, 'xhigh');
    } finally {
        await api.close();
    }
});

test('the role asks for a stream: the model is seen while it thinks', async () => {
    const api = await mockApi([textAnswer('ok')]);
    const config = structuredClone(defaults);
    config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
    const client = await createClient({ config, env: {} });
    try {
        await runRole({
            client,
            config,
            role: 'planner',
            input: 'Say ok.',
            root: process.cwd(),
        });
        // A stream shows the thinking of the model while it thinks: the silence of the
        // terminal is not read as the hang of the stage.
        assert.equal(api.requests[0].stream, true);
    } finally {
        await api.close();
    }
});

test('the frontend roles get the standard of the work', () => {    for (const name of ['markup', 'coder', 'styler']) {
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

test('the planner does not plan a step of the environment', () => {
    const text = ROLES.planner.instructions({});
    assert.match(text, /is not a step: the stage `setup` writes them/);
    assert.match(text, /before the markup/);
});

test('the coder keeps out of the environment and out of the styles', () => {
    const text = ROLES.coder.instructions({});
    // The environment is the work of the stage `setup`.
    assert.match(text, /The environment is the work of another stage/);
    assert.match(text, /install the dependencies, do not change/);
    // The stylesheets belong to the styler, and the code is written against them.
    assert.match(text, /The stylesheets are written before your code/);
    assert.match(text, /Read the stylesheets of the project/);
    assert.match(text, /Do not change the stylesheets/);
    // The production build belongs to the stage `build`, which runs after the styles.
    assert.match(text, /production build of the project is the work of the stage `build`/);
    assert.match(text, /do not start a loop of build-and-fix/);
});

test('the roles that touch the styles are given the one name of the stylesheet', () => {
    const styles = { source: 'src/styles.scss', link: 'src/styles.css', language: 'scss', from: 'plan' };
    const markup = ROLES.markup.instructions({ styles });
    const coder = ROLES.coder.instructions({ styles });
    const styler = ROLES.styler.instructions({ styles, style: 'scss' });

    // The markup links the compiled css of that stylesheet, and it does not invent a name.
    assert.match(markup, /src\/styles\.scss/);
    assert.match(markup, /src\/styles\.css/);
    assert.match(markup, /Do not write `styles\.css`/);
    // The code imports the stylesheet itself.
    assert.match(coder, /src\/styles\.scss/);
    assert.match(coder, /imports that stylesheet/);
    // The styler writes the stylesheet.
    assert.match(styler, /src\/styles\.scss/);
    assert.match(styler, /write that file/);
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
    assert.ok(ROLES.coder.tools.includes('run_command'), 'the role coder cannot run a command');
    const specs = toolSpecs(defaults.tools, { role: 'coder' });
    assert.ok(specs.some((spec) => spec.name === 'run_command'), 'the role coder has no command to run');
    assert.ok(!ROLES.styler.tools.includes('run_command'));
    assert.ok(!toolSpecs(defaults.tools, { role: 'styler' }).some((spec) => spec.name === 'run_command'));
    assert.match(ROLES.styler.instructions({}), /build stage checks the styles/);
    assert.match(ROLES.styler.instructions({}), /styler has no shell-command tool/);
    // The vector editor writes text: the stage parses and tidies every SVG itself, so the
    // editor has no shell to hunt for a validator with.
    assert.ok(!ROLES.editor.tools.includes('run_command'));
    assert.match(ROLES.editor.instructions({}), /You have no shell/);
});

test('the binding page-frame contract is present in high-priority instructions for both roles', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-page-frame-priority-'));
    for (const role of ['markup', 'styler']) {
        const client = { responses: { async create(body) {
            assert.match(body.instructions, /Binding page-frame contract/);
            assert.match(body.instructions, /--real-page-width/);
            assert.match(body.instructions, /--zoom/);
            return schemaAnswer(role === 'markup' ? 'markup' : 'style', role === 'markup'
                ? { summary: '', files: [], landmarks: [], accessibility: [], notes: '' }
                : { summary: '', tokens: [], files: [], notes: '' });
        } } };
        await runRole({
            client,
            config: structuredClone(defaults),
            role,
            input: 'Do the step.',
            context: { step: { id: `${role}-1`, title: 'Partial step', files: ['partial.file'], criteria: [] } },
            root,
        });
    }
});

test('steering entered during a model call is included in the next safe role turn', async () => {
    const requests = [];
    let count = 0;
    const inputChannel = {
        interactive: true,
        setLocation() {},
        takeSteering() { return count++ === 0 ? [] : ['keep the existing header unchanged']; },
    };
    const client = { responses: { async create(body) {
        requests.push(body);
        return schemaAnswer('plan', {
            summary: 'A landing page.',
            steps: [
                { id: 'markup-1', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'], criteria: ['opens'] },
                { id: 'style-1', title: 'Styles', role: 'styler', dependsOn: ['markup-1'], files: ['styles.css'], criteria: ['match'] },
            ],
            risks: [], questions: [],
        });
    } } };
    await runRole({ client, config: structuredClone(defaults), role: 'planner', input: 'Make a page.', inputChannel });
    assert.ok(requests.length >= 2);
    assert.ok(requests.some((request) => JSON.stringify(request.input).includes('keep the existing header unchanged')));
});

test('ask_user is exposed to interactive roles and returns the operator answer as tool output', async () => {
    const requests = [];
    const inputChannel = {
        interactive: true,
        setLocation() {},
        takeSteering() { return []; },
        async askUser(question) { assert.equal(question, 'Which option?'); return 'Choose blue.'; },
    };
    const client = { responses: { async create(body) {
        requests.push(body);
        if (requests.length === 1) return toolAnswer('ask_user', { question: 'Which option?' });
        return schemaAnswer('plan', {
            summary: 'A page.',
            steps: [
                { id: 'markup-1', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'], criteria: ['opens'] },
                { id: 'style-1', title: 'Styles', role: 'styler', dependsOn: ['markup-1'], files: ['styles.css'], criteria: ['matches'] },
            ],
            risks: [], questions: [],
        });
    } } };

    const answer = await runRole({ client, config: structuredClone(defaults), role: 'planner', input: 'Plan.', inputChannel });

    assert.equal(answer.data.summary, 'A page.');
    assert.ok(requests[0].tools?.some((spec) => spec.name === 'ask_user')
        || requests.some((request) => request.tools?.some((spec) => spec.name === 'ask_user')));
    assert.match(JSON.stringify(requests.at(-1).input), /Choose blue\./);
});

test('styler carries criteria after research and drops research tools at the cap', async () => {
    const requests = [];
    const answers = [
        toolAnswer('write_ready', {}),
        toolAnswer('web_guidance', { query: 'grid' }),
        toolAnswer('web_guidance', { query: 'container' }),
        toolAnswer('web_guidance', { query: 'overflow' }),
        toolAnswer('web_guidance', { query: 'more research' }),
        toolAnswer('write_file', { path: 'styles.scss', content: '/* styles */' }),
        schemaAnswer('style', {
            summary: 'Styles written.', tokens: [],
            files: [{ path: 'styles.scss', content: '/* styles */', language: 'scss' }], notes: '',
        }),
    ];
    const client = { responses: { async create(body) {
        requests.push(body);
        return answers[Math.min(requests.length - 1, answers.length - 1)];
    } } };
    const toolset = {
        specsFor: () => [
            { type: 'function', name: 'web_guidance', parameters: {} },
            { type: 'function', name: 'write_file', parameters: {} },
        ],
        async execute() { return 'Written styles.scss.'; },
    };
    const config = structuredClone(defaults);
    config.model = 'test-model';
    await runRole({
        client,
        config,
        role: 'styler',
        input: 'The task: preserve a fixed 361px sidebar and do not scale the page with zoom.',
        context: {
            task: 'Preserve a fixed 361px sidebar and do not scale the page with zoom.',
            step: {
                id: 'styles-1', title: 'Write styles', files: ['styles.scss'],
                criteria: ['Sidebar is exactly 361px', 'Body overflow remains visible'],
            },
        },
        root: process.cwd(),
        toolset,
        requireFiles: true,
        maxTurns: 10,
    });

    for (const request of requests) {
        assert.match(request.instructions, /Sidebar is exactly 361px/);
        assert.match(request.instructions, /Body overflow remains visible/);
    }
    const afterResearch = requests[4];
    assert.ok(afterResearch, 'the request after three research calls should exist');
    assert.ok(!afterResearch.tools.some((tool) => ['read_skill', 'web_guidance', 'run_command'].includes(tool.name)));
    assert.match(JSON.stringify(afterResearch.input), /Body overflow remains visible/);
});

test('the styler writes the styles with the best model and polishes them with the next one', async () => {
    const requests = [];
    const answers = [
        toolAnswer('write_ready', {}),
        toolAnswer('write_file', { path: 'styles.scss', content: '/* styles */' }),
        schemaAnswer('style', {
            summary: 'Styles written.', tokens: [],
            files: [{ path: 'styles.scss', content: '/* styles */', language: 'scss' }], notes: '',
        }),
    ];
    const client = { responses: { async create(body) {
        requests.push(body);
        return answers[Math.min(requests.length - 1, answers.length - 1)];
    } } };
    const toolset = {
        specsFor: () => [{ type: 'function', name: 'write_file', parameters: {} }],
        async execute() { return 'Written styles.scss.'; },
    };
    const config = structuredClone(defaults);
    config.model = 'test-model';
    await runRole({
        client,
        config,
        role: 'styler',
        input: 'Write the styles.',
        context: {
            task: 'Write the styles.',
            step: { id: 'styles-1', title: 'Styles', files: ['styles.scss'], criteria: [] },
        },
        root: process.cwd(),
        toolset,
        requireFiles: true,
        maxTurns: 6,
    });

    // The Sol writes the styles: the path of the styler starts at the rank 1 of the family.
    //assert.equal(requests[0].model, 'openai/gpt-6.2-sol');
    //assert.equal(requests[1].model, 'openai/gpt-6.2-sol');
    // The files are on the disk: the role steps down to the rank 0 of the family, the Terra.
    //assert.equal(requests[2].model, 'openai/gpt-6.1-terra');
});

test('the vector editor instructions omit page and DevTools work', () => {
    const text = ROLES.editor.instructions({ vectorOnly: true, design: true });
    assert.match(text, /In the vector stage, work only on the SVG files/);
    assert.doesNotMatch(text, /Take the snapshot of the page after navigation/);
    assert.doesNotMatch(text, /DESIGN\.md directly/);
});

test('the vector editor may ask the sibling CLI for a vector graphic', () => {
    const text = ROLES.editor.instructions({ vectorOnly: true, design: true });
    // The tracing of a raster picture and the drawing of a new one.
    assert.match(text, /vectorize/);
    assert.match(text, /--format", "svg/);
    assert.match(text, /The bridge chooses the vector model itself/);
});

test('the vector editor gets no browser, screenshot, command, or delegated tools', async () => {
    const requests = [];
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vector-only-'));
    const client = { responses: { async create(body) {
        requests.push(body);
        if (body.tools.some((tool) => tool.name === 'write_ready')) return toolAnswer('write_ready', {});
        if (body.tools.some((tool) => tool.name === 'write_file') && requests.length > 2) {
            return toolAnswer('write_file', { path: 'badge.svg', content: '<svg/>' });
        }
        return schemaAnswer('code', {
            summary: 'Wrote the badge.',
            files: [{ path: 'badge.svg', content: '<svg/>', language: 'svg' }],
            commands: [],
            notes: '',
        });
    } } };
    await runRole({
        client,
        config: structuredClone(defaults),
        role: 'editor',
        input: 'Draw one SVG.',
        context: { vectorOnly: true, task: 'Draw the SVG.', step: { title: 'Draw SVG', files: ['badge.svg'], criteria: [] } },
        root,
        requireFiles: true,
    });
    const names = requests.find((request) => request.tools.some((tool) => tool.name === 'write_file'))
        .tools.map((tool) => tool.name);
    for (const forbidden of ['screenshot', 'run_command', 'delegate_role', 'navigate_page']) {
        assert.ok(!names.includes(forbidden), forbidden);
    }
    assert.ok(names.includes('write_file'));
    assert.ok(names.includes('call_ai_image'), 'the bridge draws the vector graphic when the role asks');
    assert.ok(!names.includes('generate_svg'), 'vector output uses the step-scoped write_file tool');
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
        toolAnswer('write_ready', {}),
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
        // The inspection turns leave the schema out; write_ready raises the limit before the file is touched.
        assert.equal(api.requests[0].text?.format, undefined);
        assert.ok(api.requests[0].tools.some((tool) => tool.name === 'write_ready'));
        assert.equal(api.requests[1].text?.format, undefined, 'the second request has no JSON format');
        assert.equal(api.requests[1].max_output_tokens, 131_072);
        assert.equal(api.requests[2].max_output_tokens, 524_288);
        assert.equal(api.requests[3].max_output_tokens, 524_288);
        // The correction names the file of the step.
        const second = api.requests[1].input.map((item) => JSON.stringify(item)).join('\n');
        assert.match(second, /not done the work yet/);
        assert.match(second, /index\.html/);
        const third = api.requests[2].input.map((item) => JSON.stringify(item)).join('\n');
        assert.match(third, /write_ready/);
    } finally {
        api.close();
    }
});

test('a model whose profile leaves the format free answers with its tools', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-loop-free-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };

    const api = await mockApi([
        toolAnswer('write_ready', {}),
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
        // The inspection request exposes only read tools and the private ready signal.
        assert.equal(api.requests[0].text?.format, undefined);
        assert.ok(api.requests[0].tools.some((tool) => tool.name === 'write_ready'));
        assert.equal(api.requests[0].tools.some((tool) => tool.name === 'markup'), false);
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

test('only read operations without a report or summary get the low-output policy', () => {
    const readTools = [{ name: 'read_file' }];
    const writeTools = [{ name: 'write_file' }];
    assert.equal(readOnlyOperation({ tools: readTools }), true);
    assert.equal(readOnlyOperation({ schema: roleSchema('reviewer'), tools: readTools }), false);
    assert.equal(readOnlyOperation({ tools: writeTools }), false);
    assert.equal(readOnlyOperation({ tools: [{ name: 'run_command' }] }), false);
    assert.equal(readOnlyOperation({ tools: [{ name: 'mcp:browser_click' }] }), false);
    assert.equal(readOnlyOperation({ tools: [] }), true);
    assert.equal(readOnlyOperation({ tools: readTools, outputMode: 'summary' }), false);
    assert.equal(resolveRole('learner').outputMode, 'summary');
});

test('write_ready is private to the role loop and is not executed as a project tool', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-write-ready-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };
    const api = await mockApi([
        toolAnswer('write_file', { path: 'private.txt', content: 'not yet' }),
        schemaAnswer('code', codeData()),
    ]);
    const executed = [];
    const toolset = {
        specsFor: () => [
            { type: 'function', name: 'read_file', parameters: {} },
            { type: 'function', name: 'write_file', parameters: {} },
        ],
        async execute(name, args) {
            executed.push({ name, args });
            return 'Written private.txt';
        },
    };

    try {
        const config = structuredClone(defaults);
        config.model = 'google/gemini-4-hydrogen';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        const client = await createClient({ config, env });
        const answer = await runRole({ client, config, role: 'coder', input: 'Write it.', root, env, toolset, requireFiles: true });

        assert.equal(executed.length, 0, 'write is rejected before ready');
        assert.ok(!answer.toolCalls.some((call) => call.name === 'write_ready'));
        assert.equal(api.requests[0].max_output_tokens, 16384);
        assert.equal(api.requests[0].tools.some((tool) => tool.name === 'write_file'), false);
        assert.equal(api.requests[0].tools.some((tool) => tool.name === 'write_ready'), true);
    } finally {
        api.close();
    }
});

test('write_ready is documented as the write gate, not as a hand-off', () => {
    const requestGate = ROLES.coder.instructions({ task: 'Write the code.' });
    assert.match(requestGate, /write_ready/);
    assert.match(requestGate, /starts no other role/);
    assert.match(requestGate, /write_file/);

    const handoff = toolSpecs(defaults.tools, { names: ['delegate_role'] })[0];
    assert.match(handoff.description, /different from `write_ready`/);
    assert.match(handoff.description, /Never delegate files listed in your current step/);
});

test('a role that writes a summary keeps the full output budget', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-readonly-budget-'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-home-'));
    const env = { HOME: home, USERPROFILE: home };
    const api = await mockApi([textAnswer('No new lessons.')]);

    try {
        const config = structuredClone(defaults);
        config.model = 'google/gemini-4-hydrogen';
        config.backends = [{ baseURL: api.url, apiKey: 'test-key' }];
        const client = await createClient({ config, env });

        await runRole({
            client,
            config,
            role: 'learner',
            input: 'Review the lessons.',
            root,
            env,
        });

        assert.equal(api.requests[0].max_output_tokens, 65_536);
        assert.equal(api.requests[0].text?.verbosity, undefined);
    } finally {
        api.close();
    }
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
        toolAnswer('write_ready', {}),
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
            requireFiles: true,
        });

        assert.equal(answer.role, 'coder');
        assert.equal(answer.stopped, 'completed');
        assert.equal(answer.turns, 3);
        assert.equal(answer.toolCalls.length, 1);
        assert.equal(answer.toolCalls[0].name, 'write_file');
        assert.equal(answer.data.summary, 'The page is written.');
        assert.ok(events.some((event) => event.type === 'role.tool' && event.name === 'write_file'));
        // The event of the call says what the call touches: the log is readable.
        const call = events.find((event) => event.type === 'role.tool' && event.name === 'write_file');
        assert.equal(call.arguments.path, 'index.html');
        assert.ok(call.arguments.content.length <= 200);
        assert.equal(api.requests[0].max_output_tokens, 16384, 'the inspection/ready turn uses a quarter cap');
        assert.equal(api.requests[0].text?.verbosity, 'low');
        assert.equal(api.requests[1].max_output_tokens, 65536, 'the write turn restores the full cap');
        assert.equal(api.requests[1].text?.verbosity, undefined);
        assert.ok(events.some((event) => event.type === 'role.write_ready'));

        const body = await readFile(path.join(root, 'index.html'), 'utf8');
        assert.equal(body, '<h1>Привет</h1>');

        // The second request carries the call and its answer.
        const second = api.requests[2];
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
            requireFiles: true,
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
                    if (body?.tools?.some((tool) => tool?.name === 'write_ready')) {
                        return {
                            output: [{
                                type: 'function_call',
                                call_id: 'write-ready',
                                name: 'write_ready',
                                arguments: '{}',
                            }],
                        };
                    }
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
        assert.equal(api.requests[1].max_output_tokens, 65536);
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

    // The first two requests inspect; the final schema answer follows the exhausted tool loop.
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

        // The final call asks for the answer alone with the full output budget.
        const last = api.requests[2];
        assert.equal(last.tools.length, 1);
        assert.equal(last.tools[0].name, 'code');
        assert.equal(last.max_output_tokens, 65536);
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

    // The first answer is a description of the work; then the role signals readiness and writes.
    const api = await mockApi([
        schemaAnswer('code', { ...codeData(), files: [] }),
        toolAnswer('write_ready', {}),
        toolAnswer('write_file', { path: 'index.html', content: '<h1>Done</h1>' }),
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
        assert.equal(answer.turns, 4);
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
        toolAnswer('write_ready', {}),
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
        const output = api.requests[2].input.filter((item) => item.type === 'function_call_output').at(-1);
        assert.match(output.output, /failed/i);
    } finally {
        api.close();
    }
});
