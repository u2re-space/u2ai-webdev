/**
 * @file test/steps.test.js
 * @module test/steps
 * @purpose The tests of the stages that work on the steps of the plan: разметка, код и стили.
 * @depends node:test, node:path, node:fs/promises, stages/step, stages/markup, stages/coding,
 *          stages/styling
 * @ai.tags test, stages, steps
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { stepsForRole, applyFiles, stepReportPath, readStepReport, runStepStage } from '../src/stages/step.js';
import { markupStage } from '../src/stages/markup.js';
import { codingStage } from '../src/stages/coding.js';
import { stylingStage, styleTokensText } from '../src/stages/styling.js';

/**
 * A client that answers with the ready answers, one per call.
 * @param {object[]} answers
 * @returns {object}
 * @ai.hint pure
 */
function fakeClient(answers = []) {
    let index = 0;
    return {
        responses: {
            /**
             * @param {object} body
             * @returns {Promise<object>}
             */
            async create(body) {
                const answer = answers[index++];
                if (typeof answer === 'function') return await answer(body);
                return answer ?? { output: [], output_text: '' };
            },
        },
    };
}

/**
 * A raw answer of the model: the call of the schema with its arguments.
 * @param {string} name
 * @param {object} args
 * @returns {object}
 * @ai.hint pure
 */
function schemaAnswer(name, args) {
    return {
        id: 'resp-1',
        status: 'completed',
        model: 'test-model',
        output: [{
            type: 'function_call',
            id: 'fc-1',
            call_id: `c-${Math.random().toString(36).slice(2)}`,
            name,
            arguments: JSON.stringify(args),
        }],
    };
}

const PLAN = {
    summary: 'A landing.',
    steps: [
        { id: 'markup-1', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'], criteria: ['opens'] },
        { id: 'code-1', title: 'Code', role: 'coder', dependsOn: ['markup-1'], files: ['src/main.js'], criteria: ['runs'] },
        { id: 'style-1', title: 'Styles', role: 'styler', dependsOn: ['code-1'], files: ['src/styles/main.css'], criteria: ['looks'] },
    ],
};

test('the steps of the plan are filtered by the role', () => {
    assert.equal(stepsForRole(PLAN, 'markup').length, 1);
    assert.equal(stepsForRole(PLAN, 'coder')[0].id, 'code-1');
    assert.deepEqual(stepsForRole(PLAN, 'planner'), []);
    assert.deepEqual(stepsForRole(null, 'coder'), []);
});

test('the files of an answer are written, the existing ones are kept', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-files-'));
    await writeFile(path.join(root, 'index.html'), '<!-- mine -->\n', 'utf8');

    const applied = await applyFiles({
        root,
        files: [
            { path: 'index.html', content: '<main></main>\n', language: 'html' },
            { path: 'src/app.js', content: 'export const x = 1;\n', language: 'js' },
            { path: 'package.json', content: '{}\n', language: 'json' },
        ],
    });

    assert.deepEqual(applied.written, ['src/app.js']);
    assert.deepEqual(applied.skipped.sort(), ['index.html', 'package.json']);
    assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<!-- mine -->\n');
    assert.match(await readFile(path.join(root, 'src', 'app.js'), 'utf8'), /export const x/);
});

test('a file outside the project is not written', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-files2-'));
    const applied = await applyFiles({
        root,
        files: [{ path: '../escape.js', content: 'x', language: 'js' }],
    });
    assert.deepEqual(applied.written, []);
    assert.ok(applied.warnings.some((item) => /вне рабочего каталога/.test(item)));
});

test('the words of a model never land in a picture', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-binary-'));
    const applied = await applyFiles({
        root,
        files: [
            { path: 'assets/picture.png', content: 'a picture in words', language: 'binary' },
            { path: 'assets/icon.svg', content: '<svg></svg>\n', language: 'svg' },
        ],
    });
    assert.deepEqual(applied.written, ['assets/icon.svg']);
    assert.deepEqual(applied.skipped, ['assets/picture.png']);
    assert.ok(applied.warnings.some((item) => /не текстовый файл/.test(item)));
});

test('a step stage runs the role over its steps and writes the reports', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-steps-'));
    const client = fakeClient([schemaAnswer('code', {
        summary: 'The entry.',
        files: [{ path: 'src/main.js', content: 'export const x = 1;\n', language: 'js' }],
        commands: [{ command: 'npm', args: ['run', 'build'], purpose: 'Build.' }],
        notes: 'Nothing else.',
    })]);

    const result = await runStepStage({
        client,
        config: { output: { work: './.tmp' }, stages: { coder: { maxTurns: 4 } } },
        root,
        task: 'Make a landing.',
        role: 'coder',
        plan: PLAN,
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].step.id, 'code-1');
    assert.deepEqual(result.steps[0].applied.written, ['src/main.js']);
    assert.match(await readFile(path.join(root, 'src', 'main.js'), 'utf8'), /export const x/);

    const report = await readStepReport(root, { output: { work: './.tmp' } }, 'run-1', 'code-1');
    assert.equal(report.summary, 'The entry.');
    assert.equal(report.commands.length, 1);
    assert.match(stepReportPath(root, { output: { work: './.tmp' } }, 'run-1', 'code-1'), /steps[\\/]code-1\.json$/);
});

test('a step that is already done is not done again', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-steps-resume-'));
    const config = { output: { work: './.tmp' }, stages: { coder: { maxTurns: 4 } } };
    const client = fakeClient([schemaAnswer('code', {
        summary: 'The entry.',
        files: [{ path: 'src/main.js', content: 'export const x = 1;\n', language: 'js' }],
        commands: [],
        notes: '',
    })]);

    const first = await runStepStage({
        client,
        config,
        root,
        task: 'Make a landing.',
        role: 'coder',
        plan: PLAN,
        runId: 'run-1',
    });
    assert.equal(first.ok, true);

    // The run continues: the step is on the disk, and the model is not asked again.
    let asked = 0;
    const second = await runStepStage({
        client: { responses: { async create() { asked += 1; return { output: [], output_text: '' }; } } },
        config,
        root,
        task: 'Make a landing.',
        role: 'coder',
        plan: PLAN,
        runId: 'run-1',
    });
    assert.equal(asked, 0);
    assert.equal(second.ok, true);
    assert.equal(second.steps.length, 1);
    assert.equal(second.steps[0].resumed, true);

    // A file that was deleted after the step means the work is not there any more.
    await rm(path.join(root, 'src', 'main.js'));
    const third = await runStepStage({
        client: { responses: { async create() { asked += 1; return { output: [], output_text: '' }; } } },
        config,
        root,
        task: 'Make a landing.',
        role: 'coder',
        plan: PLAN,
        runId: 'run-1',
    });
    assert.ok(asked > 0, 'the model has to be asked again for a step that is not on the disk');
    assert.equal(third.steps[0].resumed, undefined);
});

test('a plan without a step of the role skips the stage', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-steps2-'));
    const result = await runStepStage({
        client: fakeClient([]),
        config: {},
        root,
        task: 'Make a landing.',
        role: 'planner',
        plan: PLAN,
        runId: 'run-1',
    });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.ok(result.warnings[0].includes('planner'));
});

test('the stage of the markup keeps the landmarks of the answer', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-markup-'));
    const client = fakeClient([schemaAnswer('markup', {
        summary: 'The page.',
        files: [{ path: 'index.html', content: '<main></main>\n', language: 'html' }],
        landmarks: ['header', 'main', 'footer'],
        accessibility: ['one h1'],
        notes: '',
    })]);

    const result = await markupStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: PLAN,
        architecture: { summary: 'x', stack: { markup: 'html' }, modules: [], tokens: [], notes: '' },
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.steps[0].landmarks, ['header', 'main', 'footer']);
    assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), '<main></main>\n');
});

test('the stage of the markup reports the files that were not written', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-markup-missing-'));
    // The role describes its work and writes nothing.
    const client = fakeClient([schemaAnswer('markup', {
        summary: 'I will start with the guides.',
        files: [],
        landmarks: [],
        accessibility: [],
        notes: '',
    })]);

    const result = await markupStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: PLAN,
        architecture: { summary: 'x', stack: { markup: 'html' }, modules: [], tokens: [], notes: '' },
        runId: 'run-1',
    });

    // The step is not done: the file it names is not on the disk.
    assert.equal(result.ok, false);
    assert.match(result.warnings.join(' '), /index\.html/);
});

test('the stage of the code writes the files of the step', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-coding-'));
    const client = fakeClient([schemaAnswer('code', {
        summary: 'The entry.',
        files: [{ path: 'src/main.js', content: 'export const x = 1;\n', language: 'js' }],
        commands: [],
        notes: '',
    })]);

    const result = await codingStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: PLAN,
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.match(await readFile(path.join(root, 'src', 'main.js'), 'utf8'), /export const x/);
});

test('the stage of the styles reports the tokens it declares', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-styling-'));
    const client = fakeClient([schemaAnswer('style', {
        summary: 'The styles.',
        tokens: [{ name: 'color-text', value: '#101828' }],
        files: [{ path: 'src/styles/main.css', content: 'body { color: var(--color-text); }\n', language: 'css' }],
        notes: '',
    })]);

    const result = await stylingStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: PLAN,
        architecture: {
            summary: 'x',
            stack: { style: 'css' },
            modules: [],
            tokens: [{ name: 'color-text', value: '#101828', kind: 'color' }],
            notes: '',
        },
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.match(result.steps[0].tokensBlock, /--color-text: #101828;/);
    assert.match(await readFile(path.join(root, 'src', 'styles', 'main.css'), 'utf8'), /var\(--color-text\)/);
});

test('a broken file of a step is found and the role is asked to fix it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-steps-broken-'));
    const client = fakeClient([
        // The first answer writes a file with a lost quote.
        schemaAnswer('code', {
            summary: 'The entry.',
            files: [{ path: 'src/main.js', content: "const s = 'abc\n", language: 'js' }],
            commands: [],
            notes: '',
        }),
        // The second answer is the repair.
        schemaAnswer('code', {
            summary: 'The entry, fixed.',
            files: [{ path: 'src/main.js', content: "const s = 'abc';\n", language: 'js' }],
            commands: [],
            notes: '',
        }),
    ]);

    const result = await runStepStage({
        client,
        config: { output: { work: './.tmp' }, stages: { coder: { maxTurns: 4 } } },
        root,
        task: 'Make a landing.',
        role: 'coder',
        plan: PLAN,
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.match(await readFile(path.join(root, 'src', 'main.js'), 'utf8'), /const s = 'abc';/);
    assert.deepEqual(result.steps[0].syntax.errors, []);
});

test('a broken file that stays broken is an error of the step', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-steps-broken2-'));
    const broken = schemaAnswer('code', {
        summary: 'The entry.',
        files: [{ path: 'src/main.js', content: "const s = 'abc\n", language: 'js' }],
        commands: [],
        notes: '',
    });
    const client = fakeClient([broken, broken]);

    const result = await runStepStage({
        client,
        config: { output: { work: './.tmp' }, stages: { coder: { maxTurns: 4 } } },
        root,
        task: 'Make a landing.',
        role: 'coder',
        plan: PLAN,
        runId: 'run-1',
    });

    assert.equal(result.ok, false);
    assert.ok(result.warnings.some((item) => /ошибка синтаксиса/.test(item)));
    assert.equal(result.steps[0].syntax.errors.length, 1);
});

test('the file the role wrote beside the files of the step is checked too', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-steps-extra-'));
    // The compiler of the stylesheets refuses every file: the test does not need sass.
    const bin = path.join(root, 'node_modules', '.bin');
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, 'sass.cmd'), '@echo off\r\necho Error: expected "{". 1>&2\r\nexit /b 65\r\n', 'utf8');
    // The step names one file, but the role writes a stylesheet beside it, and that
    // stylesheet does not compile.
    const answer = schemaAnswer('code', {
        summary: 'The entry and the styles.',
        files: [
            { path: 'src/main.js', content: 'export const x = 1;\n', language: 'js' },
            { path: 'src/styles/main.css', content: '.a { color: red;\n', language: 'css' },
        ],
        commands: [],
        notes: '',
    });
    const client = fakeClient([answer, answer]);

    const result = await runStepStage({
        client,
        config: { output: { work: './.tmp' }, stages: { coder: { maxTurns: 4 } } },
        root,
        task: 'Make a landing.',
        role: 'coder',
        plan: PLAN,
        runId: 'run-1',
    });

    assert.equal(result.ok, false);
    assert.ok(result.steps[0].syntax.checked.includes('src/styles/main.css'));
    assert.equal(result.steps[0].syntax.errors.length, 1);
});

test('the reference of the design goes into the request of the role', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-steps-ref-'));
    await writeFile(path.join(root, 'landing.png'), 'png');
    let seen = null;
    const client = fakeClient([
        (body) => {
            seen = body;
            return schemaAnswer('code', {
                summary: 'The entry.',
                files: [{ path: 'src/main.js', content: 'export const x = 1;\n', language: 'js' }],
                commands: [],
                notes: '',
            });
        },
    ]);

    const result = await runStepStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        role: 'coder',
        plan: PLAN,
        inputs: { references: [{ path: 'landing.png', mime: 'image/png' }] },
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    const parts = seen.input[0].content;
    assert.ok(parts.some((part) => part.type === 'input_image'), 'the picture is attached');
    assert.match(parts[0].text, /The reference/);
});

test('the tokens are printed as a block of custom properties', () => {
    const block = styleTokensText([{ name: '--color-text', value: '#101828' }, { name: 'space-2', value: '8px' }]);
    assert.match(block, /:root \{/);
    assert.match(block, /--color-text: #101828;/);
    assert.match(block, /--space-2: 8px;/);
    assert.equal(styleTokensText([]), '');
});
