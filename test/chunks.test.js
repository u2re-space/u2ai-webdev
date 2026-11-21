/**
 * @file test/chunks.test.js
 * @module test/chunks
 * @purpose The tests of the parts of the instructions: what comes when, and what a role that
 *          refuses to do the work is told.
 * @depends node:test, node:os, node:path, node:fs/promises, roles/index, roles/chunks, config
 * @ai.tags test, roles, prompt, instructions
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';

import { runRole, ROLES } from '../src/roles/index.js';
import { PHASES, chunkText, chunksFor, kindOf, kindsOf } from '../src/roles/chunks.js';
import { defaults } from '../src/config.js';

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
 * A response with the call of the schema of a role: the answer of the role.
 * @param {string} name the name of the schema
 * @param {object} args the data of the answer
 * @returns {object}
 */
function schemaAnswer(name, args) {
    return toolAnswer(name, args);
}

/**
 * A response that refuses to answer.
 * @param {string} text
 * @returns {object}
 */
function refusalAnswer(text) {
    return {
        id: 'resp_0',
        status: 'completed',
        model: 'test-model',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: text }] }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
}

/**
 * The text of the conversation of a request.
 * @param {object} request the request of the model
 * @returns {string}
 */
function conversation(request) {
    return (Array.isArray(request?.input) ? request.input : [])
        .map((item) => (Array.isArray(item?.content)
            ? item.content.map((part) => part?.text ?? '').join('\n')
            : ''))
        .join('\n');
}

/**
 * A client that answers the requests one by one.
 *
 * The conversation is copied at the moment of the request: the loop of the role keeps one
 * array and fills it as it goes, so a request that is looked at later shows the whole run.
 * @param {object[]} answers the answers, one per request
 * @returns {{ client: object, requests: object[] }}
 */
function mockClient(answers) {
    const requests = [];
    let index = 0;
    return {
        requests,
        client: {
            responses: {
                async create(body) {
                    requests.push({
                        ...body,
                        input: (Array.isArray(body.input) ? body.input : []).map((item) => ({
                            ...item,
                            content: Array.isArray(item?.content) ? [...item.content] : item?.content,
                        })),
                    });
                    const answer = answers[Math.min(index, answers.length - 1)];
                    index += 1;
                    return answer;
                },
            },
        },
    };
}

test('the kind of a file is known by its name', () => {
    assert.equal(kindOf('src/styles.scss'), 'style');
    assert.equal(kindOf('src/styles.css'), 'style');
    assert.equal(kindOf('assets/logo.svg'), 'svg');
    assert.equal(kindOf('index.html'), 'markup');
    assert.equal(kindOf('src/main.js'), 'code');
    assert.equal(kindOf('src/app.tsx'), 'code');
    assert.equal(kindOf('assets/hero.png'), 'image');
    assert.equal(kindOf('README.md'), null);

    const kinds = kindsOf(['src/styles.scss', 'index.html', 'notes.md']);
    assert.deepEqual([...kinds].sort(), ['markup', 'style']);
});

test('the parts of the instructions come in their own moment', () => {
    const read = chunksFor({ role: 'styler', phase: PHASES.READ, files: ['src/styles.scss'] });
    assert.deepEqual(read.map((chunk) => chunk.id), ['read']);

    const write = chunksFor({ role: 'styler', phase: PHASES.WRITE, files: ['src/styles.scss'] });
    assert.deepEqual(write.map((chunk) => chunk.id), ['write', 'styles']);

    // A step of several kinds of files brings the craft of each of them.
    const both = chunksFor({ role: 'markup', phase: PHASES.WRITE, files: ['index.html', 'assets/logo.svg'] });
    assert.deepEqual(both.map((chunk) => chunk.id), ['write', 'markup', 'svg']);

    const done = chunksFor({ role: 'styler', phase: PHASES.DONE, files: ['src/styles.scss'] });
    assert.deepEqual(done.map((chunk) => chunk.id), ['done']);

    // The craft follows the file, not the role: the styles of a step of the markup are the
    // rules of the styles.
    const styles = chunksFor({ role: 'markup', phase: PHASES.WRITE, files: ['src/styles.scss'] });
    assert.deepEqual(styles.map((chunk) => chunk.id), ['write', 'styles']);
});

test('the craft of the styles is the craft of the styles and not of the code', () => {
    const styles = chunkText(chunksFor({ role: 'styler', phase: PHASES.WRITE, files: ['src/styles.scss'] }));
    assert.match(styles, /The cascade is held by the layers/);
    assert.match(styles, /@layer reset, base, theme, layout, components, utilities;/);
    assert.match(styles, /The names say what the thing is/);
    assert.doesNotMatch(styles, /Semantic HTML5/);

    const code = chunkText(chunksFor({ role: 'coder', phase: PHASES.WRITE, files: ['src/main.js'] }));
    assert.match(code, /Semantic HTML5/);
    assert.doesNotMatch(code, /The cascade is held by the layers/);

    const svg = chunkText(chunksFor({ role: 'editor', phase: PHASES.WRITE, files: ['assets/logo.svg'] }));
    assert.match(svg, /The SVG is XML text/);
    assert.match(svg, /A change is a patch/);
});

test('the rules of reading come with the spine, and the craft comes at the write gate', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-chunks-'));
    const { client, requests } = mockClient([
        toolAnswer('write_ready', {}),
        toolAnswer('write_file', { path: 'src/styles.scss', content: '.a { color: red; }' }),
        schemaAnswer('style', { summary: '', tokens: [], files: [], notes: '' }),
    ]);
    await runRole({
        client,
        config: structuredClone(defaults),
        role: 'styler',
        input: 'Do the step.',
        context: { step: { id: 's1', title: 'Styles', files: ['src/styles.scss'], criteria: [] } },
        root,
        requireFiles: true,
    });

    // The first request: the role reads. The rules of reading are there, the craft is not.
    assert.match(requests[0].instructions, /How to read the project/);
    assert.doesNotMatch(requests[0].instructions, /The cascade is held by the layers/);

    // The second request: the craft of the styles comes right before the write.
    const before = conversation(requests[1]);
    assert.match(before, /How to write/);
    assert.match(before, /The cascade is held by the layers/);
    // The craft is the last thing the model has read before it writes.
    const last = requests[1].input.filter((item) => item.role === 'user').pop();
    assert.match(last.content.map((part) => part.text).join('\n'), /The cascade is held by the layers/);

    // The third request: the files are on the disk and the role is told to stop changing.
    assert.match(conversation(requests[2]), /The files are on the disk/);
});

test('the vector editor patches an SVG by the lines of the file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vector-'));
    const { client, requests } = mockClient([
        toolAnswer('write_ready', {}),
        toolAnswer('patch_file', {
            path: 'assets/logo.svg',
            edits: [{ startLine: 2, endLine: 2, text: '  <circle cx="8" cy="8" r="6" fill="none" />' }],
        }),
        schemaAnswer('code', { summary: '', files: [], commands: [], notes: '' }),
    ]);
    await runRole({
        client,
        config: structuredClone(defaults),
        role: 'editor',
        input: 'Draw the logo.',
        context: {
            vectorOnly: true,
            step: { id: 'v1', title: 'Logo', files: ['assets/logo.svg'], criteria: [] },
        },
        root,
        requireFiles: true,
    });

    // The editor has the tools of the patch.
    assert.ok(ROLES.editor.tools.includes('find_line'));
    assert.ok(ROLES.editor.tools.includes('patch_file'));

    // The craft of the vector comes right before the write, and it says how to patch.
    const before = conversation(requests[1]);
    assert.match(before, /The SVG is XML text/);
    assert.match(before, /A change is a patch/);
    assert.match(before, /patch_file/);
});

test('a role that refuses is told once that the files are the work, and it goes on', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-refusal-'));
    const { client, requests } = mockClient([
        refusalAnswer('I am not allowed to write files.'),
        toolAnswer('write_ready', {}),
        toolAnswer('write_file', { path: 'src/styles.scss', content: '.a { color: red; }' }),
        schemaAnswer('style', { summary: '', tokens: [], files: [], notes: '' }),
    ]);
    const result = await runRole({
        client,
        config: structuredClone(defaults),
        role: 'styler',
        input: 'Do the step.',
        context: { step: { id: 's1', title: 'Styles', files: ['src/styles.scss'], criteria: [] } },
        root,
        requireFiles: true,
    });

    // The role did not stop at the refusal: it was told once and it went on with the work.
    assert.equal(result.refusal, '');
    assert.match(conversation(requests[1]), /ordinary files of the project/);
    assert.ok(requests.length >= 3, 'the role gave up too early');
});
