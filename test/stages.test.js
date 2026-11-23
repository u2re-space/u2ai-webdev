/**
 * @file test/stages.test.js
 * @module test/stages
 * @purpose The tests of the stages: the plan, the collection of the context, the architecture
 *          and the setup of the environment.
 * @depends node:test, node:path, node:fs/promises, stages/plan, stages/collect,
 *          stages/architect, stages/setup, stages/workspace, stages/roles, stages/markup,
 *          stages/coding, stages/styling, stages/vector, stages/iconify, registry
 * @ai.tags test, stages
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';

import { normalizePlan, orderSteps, planText, planStage, writePlan, readPlan } from '../src/stages/plan.js';
import { normalizeScan, scanText, scanStage, writeScan, readScan } from '../src/stages/scan.js';
import { collectStage, collectText, componentCards, readInputs } from '../src/stages/collect.js';
import { collectInputs } from '../src/inputs/index.js';
import { normalizeArchitecture, architectureText, architectStage } from '../src/stages/architect.js';
import { detectPackageManager, applySetup, setupReadiness, setupStage, installDependencies, ensureStyleCompiler } from '../src/stages/setup.js';
import { runId, runDirectory, sanitizeId } from '../src/stages/workspace.js';
import { LIVE_ROLES, stageForRole, foreignFiles } from '../src/stages/roles.js';
import { role as markupRole } from '../src/stages/markup.js';
import { role as codingRole } from '../src/stages/coding.js';
import { role as stylingRole } from '../src/stages/styling.js';
import { role as animationRole } from '../src/stages/animation.js';
import { role as vectorRole } from '../src/stages/vector.js';
import { role as assetsRole } from '../src/stages/assets.js';
import { role as iconifyRole } from '../src/stages/iconify.js';
import { openRegistry } from '../src/registry.js';
import { ROLES } from '../src/roles/index.js';

/** Стадии, которые берут шаги плана, и роль каждой из них. */
const modules = {
    markup: { role: markupRole },
    coding: { role: codingRole },
    styling: { role: stylingRole },
    animation: { role: animationRole },
    vector: { role: vectorRole },
    assets: { role: assetsRole },
    iconify: { role: iconifyRole },
};

/**
 * A client that answers with the ready answers, one per call.
 *
 * The requests are kept: a test may look at what the stage asked for.
 * @param {object[]} answers
 * @returns {object}
 * @ai.hint pure
 */
function fakeClient(answers = []) {
    let index = 0;
    const requests = [];
    return {
        requests,
        responses: {
            /**
             * @param {object} body
             * @returns {Promise<object>}
             */
            async create(body) {
                requests.push(body);
                const answer = answers[index++];
                if (typeof answer === 'function') return await answer(body);
                return answer ?? { output: [], output_text: '' };
            },
        },
    };
}

/**
 * A raw answer of the model: the call of the schema with its arguments.
 * @param {string} name the name of the schema
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
            call_id: 'c-1',
            name,
            arguments: JSON.stringify(args),
        }],
        usage: { input_tokens: 10, output_tokens: 20 },
    };
}

/**
 * A project directory with a design file and a manifest.
 * @returns {Promise<string>}
 */
async function makeProject() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-stages-'));
    await writeFile(path.join(root, 'DESIGN.md'), '# Design\n\n- color: #101828\n', 'utf8');
    await writeFile(path.join(root, 'package.json'), `${JSON.stringify({ name: 'app', version: '0.1.0' }, null, 2)}\n`, 'utf8');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.js'), 'export const x = 1;\n', 'utf8');
    return root;
}

test('the id of a run is a safe name of a directory', () => {
    const id = runId(new Date('2026-11-13T14:22:33'));
    assert.equal(id, '20261113-142233');
    assert.equal(sanitizeId('../escape'), 'escape');
    assert.match(sanitizeId(''), /^\d{8}-\d{6}$/);
});

test('the plan is normalized: the ids are unique, the steps are sorted', () => {
    const plan = normalizePlan({
        summary: 'A landing.',
        steps: [
            { id: 'b', title: 'Second', role: 'coder', dependsOn: ['a', 'nowhere'], files: ['index.html'] },
            { id: 'a', title: 'First', role: 'markup' },
            { id: 'a', title: 'Again', role: 'markup' },
        ],
        risks: ['the risk'],
    });
    assert.equal(plan.steps.length, 3);
    assert.deepEqual(plan.steps.map((step) => step.id), ['a', 'b', 'a-2']);
    assert.ok(plan.warnings.some((item) => /a-2/.test(item)));
    assert.ok(plan.warnings.some((item) => /nowhere/.test(item)));
    assert.deepEqual(plan.risks, ['the risk']);
});

test('a step of a role that no stage executes is given to the role that owns its files', () => {
    const plan = normalizePlan({
        summary: 'A landing.',
        steps: [
            { id: 'a', title: 'The badge', role: 'planner', files: ['assets/badge.svg'] },
            { id: 'b', title: 'The page', role: 'planner', files: ['index.html'] },
            { id: 'c', title: 'The script', role: 'reviewer', files: ['src/main.js'] },
        ],
    });
    assert.deepEqual(plan.steps.map((step) => step.role), ['editor', 'markup', 'coder']);
    assert.ok(plan.warnings.some((item) => /Шаг a: роль "planner" не исполняется/.test(item)));
    assert.ok(plan.warnings.some((item) => /взята роль "editor"/.test(item)));
});

test('a step of a role that no stage executes leaves the plan when the role cannot be guessed', () => {
    const plan = normalizePlan({
        summary: 'A landing.',
        steps: [
            { id: 'a', title: 'The environment', role: 'installer', files: ['package.json', 'vite.config.js'] },
            { id: 'b', title: 'The figures', role: 'planner', files: ['assets/chess-piece.png'] },
            { id: 'c', title: 'Nothing', role: 'unknown-role' },
        ],
    });
    assert.deepEqual(plan.steps, []);
    assert.ok(plan.warnings.some((item) => /Шаг a:/.test(item) && /стадия setup/.test(item)));
    assert.ok(plan.warnings.some((item) => /Шаг b:/.test(item) && /chess-piece\.png/.test(item)));
    assert.ok(plan.warnings.some((item) => /Шаг c:/.test(item) && /unknown-role/.test(item)));
});

test('a file of another role leaves the step that named it', () => {
    // The step of the illustrator asked for the markup as well: the markup belongs to the
    // role of the markup, and the step of the illustrator keeps only its own files.
    const plan = normalizePlan({
        summary: 'A landing.',
        steps: [
            {
                id: 'imagery',
                title: 'The pictures of the carousel',
                role: 'illustrator',
                files: ['index.html', 'public/images/event-01.webp'],
            },
        ],
    });

    const step = plan.steps[0];
    assert.equal(step.role, 'illustrator');
    assert.deepEqual(step.files, ['public/images/event-01.webp']);
    assert.ok(plan.warnings.some((item) => /чужие файлы отданы их ролям/.test(item) && /index\.html/.test(item)),
        plan.warnings.join(' | '));
});

test('a step that named only foreign files is given to the role that owns them', () => {
    const plan = normalizePlan({
        summary: 'A landing.',
        steps: [
            { id: 'page', title: 'The page', role: 'illustrator', files: ['index.html'] },
        ],
    });

    assert.equal(plan.steps[0].role, 'markup');
    assert.deepEqual(plan.steps[0].files, ['index.html']);
    assert.ok(plan.warnings.some((item) => /принадлежат роли "markup"/.test(item)), plan.warnings.join(' | '));
});

test('a step that names the motion belongs to the animator', () => {
    // Шаг о движении лежит в той же таблице стилей, но это работа роли `animator`:
    // у движения своя стадия и свой бюджет.
    const plan = normalizePlan({
        summary: 'A landing.',
        steps: [
            { id: 'style-1', title: 'Styles', role: 'styler', files: ['src/styles.scss'] },
            { id: 'motion', title: 'Add limited transitions and the reduced motion', role: 'styler', files: ['src/_motion.scss'] },
        ],
    });

    const motion = plan.steps.find((step) => step.id === 'motion');
    assert.equal(motion.role, 'animator');
    assert.deepEqual(motion.files, ['src/_motion.scss']);
    assert.ok(plan.warnings.some((item) => /отдан роли "animator"/.test(item)), plan.warnings.join(' | '));
});

test('the styles of the project are not foreign files for the animator', () => {
    // Движение пишется в ту же таблицу стилей, что и раскладка: файл стилей не чужой.
    assert.deepEqual(foreignFiles('animator', ['src/styles.scss', 'src/_motion.scss']), []);
    // А разметка — чужая.
    assert.deepEqual(foreignFiles('animator', ['index.html']), ['index.html']);
});

test('a step of the environment leaves the plan, whoever the role is', () => {    const plan = normalizePlan({
        summary: 'A landing.',
        steps: [
            { id: 'env', title: 'Manifest', role: 'coder', files: ['package.json', 'package-lock.json'] },
            { id: 'code', title: 'Code', role: 'coder', files: ['src/main.js'] },
        ],
    });
    // The stage `setup` writes the manifest and installs the dependencies before the markup:
    // a step of the environment is the environment work of another stage.
    assert.deepEqual(plan.steps.map((step) => step.id), ['code']);
    assert.ok(plan.warnings.some((item) => /Шаг env:/.test(item) && /стадия setup/.test(item)));
});

test('a step that touches the environment and the code stays in the plan', () => {
    const plan = normalizePlan({
        summary: 'A landing.',
        steps: [
            { id: 'dep', title: 'A dependency', role: 'coder', files: ['package.json', 'src/main.js'] },
        ],
    });
    assert.deepEqual(plan.steps.map((step) => step.id), ['dep']);
});

test('the live roles are the roles of the stages that take the steps', () => {    assert.deepEqual(
        Object.keys(LIVE_ROLES).sort(),
        Object.values(modules).map((module) => module.role).sort(),
    );
    for (const [stage, module] of Object.entries(modules)) {
        assert.equal(LIVE_ROLES[module.role], stage, `the stage ${stage} runs the role ${module.role}`);
        assert.equal(stageForRole(module.role), stage);
    }
});

test('a cycle in the dependencies does not break the plan', () => {
    const ordered = orderSteps([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
    ]);
    assert.equal(ordered.steps.length, 2);
    assert.ok(ordered.warnings.some((item) => /Цикл/.test(item)));
});

test('the text of the plan names the steps and their criteria', () => {
    const text = planText(normalizePlan({
        summary: 'A landing.',
        steps: [{ id: 'a', title: 'Markup', role: 'markup', criteria: ['the page opens'] }],
    }));
    assert.match(text, /# The plan of the work/);
    assert.match(text, /a — Markup/);
    assert.match(text, /the page opens/);
});

test('the plan of a run is written to the file of the run and read back', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-plan-'));
    const config = { output: { work: './.tmp' } };
    const plan = normalizePlan({ summary: 'x', steps: [{ id: 'a', title: 'One', role: 'markup' }] });
    const file = await writePlan(root, config, 'run-1', plan);
    assert.match(file, /\.tmp[\\/]run-1[\\/]plan\.json$/);
    const back = await readPlan(root, config, 'run-1');
    assert.equal(back.steps[0].id, 'a');
    assert.equal(await readPlan(root, config, 'run-2'), null);
});

test('the survey is normalized: the files and the roles of the files', () => {
    const scan = normalizeScan({
        summary: 'A small landing.',
        project: 'A static landing with Vite.',
        stack: { framework: 'vite', markup: 'html', style: 'scss', script: 'javascript' },
        files: [
            { path: 'index.html', role: 'edit', reason: 'the page of the landing' },
            { path: 'src/main.js', role: 'read', reason: 'the script of the page' },
            { path: 'src/styles/main.scss', role: 'keep', reason: 'the styles are not touched' },
            { path: 'nowhere.js', role: 'write', reason: 'a wrong role' },
        ],
        conventions: ['The naming is kebab-case.'],
        risks: ['The manifest is missing.'],
        questions: [],
        notes: 'The project is small.',
    });
    assert.equal(scan.files.length, 4);
    assert.equal(scan.files[3].role, 'read');
    assert.ok(scan.warnings.some((item) => /nowhere\.js/.test(item)));
    const text = scanText(scan);
    assert.match(text, /# The survey of the project/);
    assert.match(text, /index\.html \(edit\)/);
    assert.match(text, /The naming is kebab-case/);
});

test('the stage of the scan asks the scanner and writes the survey', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-scan-'));
    const client = fakeClient([schemaAnswer('scan', {
        summary: 'A small landing.',
        project: 'A static landing with Vite.',
        stack: { framework: 'vite', markup: 'html', style: 'scss', script: 'javascript' },
        files: [{ path: 'index.html', role: 'edit', reason: 'the page of the landing' }],
        conventions: ['The naming is kebab-case.'],
        risks: [],
        questions: [],
        notes: '',
    })]);

    const result = await scanStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        runId: 'run-scan',
    });

    assert.equal(result.ok, true);
    assert.equal(result.scan.files[0].path, 'index.html');
    assert.match(result.file, /scan\.json$/);
    const saved = JSON.parse(await readFile(result.file, 'utf8'));
    assert.equal(saved.project, 'A static landing with Vite.');
    // The scanner reads and does not write.
    assert.ok(!ROLES.scanner.tools.some((name) => ['write_file', 'replace_text', 'run_command'].includes(name)));
});

test('the planner reads the survey of the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-scan-plan-'));
    const config = { output: { work: './.tmp' } };
    await writeScan(root, config, 'run-1', normalizeScan({
        summary: 'A small landing.',
        project: 'A static landing with Vite.',
        stack: {},
        files: [{ path: 'index.html', role: 'edit', reason: 'the page of the landing' }],
        conventions: [],
        risks: [],
        questions: [],
        notes: '',
    }));

    const client = fakeClient([schemaAnswer('plan', {
        summary: 'A landing page.',
        steps: [{ id: 'a', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'], criteria: ['opens'] }],
        risks: [],
        questions: [],
    })]);
    await planStage({
        client,
        config,
        root,
        task: 'Make a landing.',
        runId: 'run-1',
    });

    // The survey travels with the request of the planner.
    assert.match(JSON.stringify(client.requests[0].input), /The survey of the project/);
    assert.match(JSON.stringify(client.requests[0].input), /index\.html \(edit\)/);
    // The survey is read back from the disk when the run continues.
    assert.equal((await readScan(root, config, 'run-1')).project, 'A static landing with Vite.');
});

test('the stage of the plan asks the planner and writes the plan', async () => {    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-plan2-'));
    const client = fakeClient([schemaAnswer('plan', {
        summary: 'A landing page.',
        steps: [{ id: 'a', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'], criteria: ['opens'] }],
        risks: [],
        questions: [],
    })]);

    const result = await planStage({
        client,
        config: { output: { work: './.tmp' }, stack: { frontendFramework: 'vanilla' } },
        root,
        task: 'Make a landing.',
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.equal(result.plan.steps[0].id, 'a');
    assert.match(result.file, /plan\.json$/);
    const saved = JSON.parse(await readFile(result.file, 'utf8'));
    assert.equal(saved.summary, 'A landing page.');
});

test('the planner gets the reference image attached without a measurement sheet', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-plan-reference-'));
    await writeFile(path.join(root, 'landing.png'), Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYuoAAAAASUVORK5CYII=',
        'base64',
    ));
    const client = fakeClient([schemaAnswer('plan', {
        summary: 'A landing page.',
        steps: [{ id: 'a', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'], criteria: ['opens'] }],
        risks: [],
        questions: [],
    })]);
    const inputs = await collectInputs({
        root,
        config: { inputs: { designMd: [], measurements: [], palette: [], tokens: [] } },
        task: 'Make a landing from landing.png.',
    });
    const result = await planStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing from landing.png.',
        inputs,
        runId: 'run-ref',
    });
    assert.equal(result.ok, true);
    assert.match(JSON.stringify(client.requests[0].input), /input_image/);
    assert.match(JSON.stringify(client.requests[0].input), /landing\.png/);
    assert.equal(inputs.measurements.present, false);
});

test('the stage of the plan says that a step of a dead role leaves the plan', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-plan-role-'));
    const client = fakeClient([schemaAnswer('plan', {
        summary: 'A landing page.',
        steps: [
            { id: 'a', title: 'The figures', role: 'planner', dependsOn: [], files: ['assets/chess-piece.png'], criteria: ['opens'] },
            { id: 'b', title: 'The badge', role: 'planner', dependsOn: [], files: ['assets/badge.svg'], criteria: ['opens'] },
        ],
        risks: [],
        questions: [],
    })]);

    const result = await planStage({
        client,
        config: { output: { work: './.tmp' }, stack: { frontendFramework: 'vanilla' } },
        root,
        task: 'Make a landing.',
        runId: 'run-1',
    });

    // The step whose role cannot be guessed leaves the plan, and the report says why.
    assert.deepEqual(result.plan.steps.map((step) => step.id), ['b']);
    assert.match(result.warnings.join('\n'), /Шаг a:.*не исполняется ни одной стадией/s);
    // The step whose files belong to a role is given to that role.
    assert.equal(result.plan.steps[0].role, 'editor');
});

test('the correction of the planner does not offer the command that is gone', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-plan-correction-'));
    const client = fakeClient([
        schemaAnswer('plan', { summary: 'Сначала изучу проект.', steps: [], risks: [], questions: [] }),
        schemaAnswer('plan', {
            summary: 'A landing page.',
            steps: [{ id: 'a', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'], criteria: ['opens'] }],
            risks: [],
            questions: [],
        }),
    ]);

    await planStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        runId: 'run-1',
    });

    assert.equal(client.requests.length, 2);
    // The direction of the design is not measured: the command is gone from the bridge.
    assert.doesNotMatch(JSON.stringify(client.requests[1]), /\["design"/);
});

test('the stage of the plan reports an answer without a plan', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-plan3-'));
    const result = await planStage({
        client: fakeClient([{ output_text: 'no plan here' }]),
        config: {},
        root,
        task: 'Make a landing.',
        runId: 'run-1',
    });
    assert.equal(result.ok, false);
    assert.ok(result.warnings.length);
    // The warning names the reason: an answer without data is not a plan.
    assert.match(result.warnings.join(' '), /ответ без данных|no plan here/);
});

test('the stage of the plan asks again when the plan has no steps', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-plan4-'));
    const asked = [];
    const client = fakeClient([
        // The first answer is a plan of intentions: the steps are empty.
        schemaAnswer('plan', { summary: 'Сначала изучу проект.', steps: [], risks: [], questions: [] }),
        // The second one is the work itself.
        schemaAnswer('plan', {
            summary: 'A landing page.',
            steps: [{ id: 'a', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'], criteria: ['opens'] }],
            risks: [],
            questions: [],
        }),
    ]);

    const result = await planStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.equal(result.plan.steps.length, 1);
    assert.match(result.plan.warnings.join(' '), /пустой план/);
    assert.equal(asked.length, 0);
});

test('the stage of the plan asks again in the tool channel when the plan has no steps', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-plan6-'));
    const client = fakeClient([
        // The first answer is the skeleton of the schema: a model that is pinned to a
        // JSON answer gives it without thinking.
        schemaAnswer('plan', { summary: '...', steps: [], risks: [], questions: [] }),
        // The second one is the work itself.
        schemaAnswer('plan', {
            summary: 'A landing page.',
            steps: [{ id: 'a', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'], criteria: ['opens'] }],
            risks: [],
            questions: [],
        }),
    ]);

    const result = await planStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.equal(result.plan.steps.length, 1);
    // The first answer keeps the channel of the model, the second one moves the schema
    // into the tool channel: the answer is the call of the schema.
    assert.equal(client.requests[0].schemaChannel, null);
    assert.equal(client.requests[1].schemaChannel, 'tool');
    // The correction forbids requiring a measurer while asking the planner to look first.
    const correction = JSON.stringify(client.requests[1].input);
    assert.match(correction, /do not call or require a measurer/);
    assert.doesNotMatch(correction, /call_ai_measure/);
    assert.match(correction, /`plan`/);
});

test('the stage of the plan fails when there are no steps at all', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-plan5-'));
    const empty = schemaAnswer('plan', { summary: 'Сначала изучу проект.', steps: [], risks: [], questions: [] });
    const result = await planStage({
        client: fakeClient([empty, empty]),
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        runId: 'run-1',
    });
    assert.equal(result.ok, false);
    assert.match(result.warnings.join(' '), /ни одного шага/);
    // The failure says what to do: a dead run without a way out is no help.
    assert.match(result.warnings.join(' '), /ai-webdev plan/);
});

test('the collected inputs are written to the run and read back', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-inputs-'));
    const config = {
        inputs: { designMd: 'DESIGN.md', measurements: null, palette: null, tokens: null },
        output: { dir: './.ai', work: './.tmp' },
    };
    await writeFile(path.join(root, 'DESIGN.md'), '# Design\n\n- color: #101828\n', 'utf8');

    const collected = await collectStage({
        root,
        config,
        task: 'Make a landing.',
        env: {},
        runId: 'run-1',
    });

    assert.ok(collected.file, 'the inputs are written');
    assert.match(collected.file, /\.tmp[\\/]run-1[\\/]inputs\.json$/);
    const back = await readInputs(root, config, 'run-1');
    assert.equal(back.task, 'Make a landing.');
    assert.equal(back.design.present, true);
    assert.equal(await readInputs(root, config, 'run-2'), null);
});

test('the collection gathers the inputs, the project and the registry', async () => {
    const root = await makeProject();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-reg-'));
    const dbFile = path.join(dir, 'components.db');
    const registry = openRegistry({ file: dbFile, dir });
    await registry.publish({
        sourceRoot: root,
        contract: { tag: 'ui-card', name: '@acme/ui-card', version: '1.0.0', summary: 'A card.', framework: 'vanilla' },
    });
    registry.close();

    const skills = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-skills-'));
    await writeFile(path.join(skills, 'shared.md'), '# Shared\n', 'utf8');

    const collected = await collectStage({
        root,
        config: {
            inputs: { designMd: 'DESIGN.md', measurements: null, palette: null, tokens: null },
            components: { dir, dbFile },
            skills: { dir: skills },
            output: { dir: './.ai', work: './.tmp' },
        },
        task: 'Make a landing.',
        env: {},
    });

    assert.equal(collected.ok, true);
    assert.equal(collected.summary.design, true);
    assert.ok(collected.project.count >= 2);
    assert.equal(collected.components.length, 1);
    assert.equal(collected.components[0].tag, 'ui-card');
    assert.ok(collected.skills.packs.some((pack) => pack.name === 'shared'));
    assert.match(collected.text, /# Design direction/);
    assert.match(collected.text, /ui-card/);
    assert.match(componentCards(collected.components)[0], /ui-card@1\.0\.0/);
    assert.match(collectText(collected), /# The project/);
});

test('the architecture is normalized against the enums of the config', () => {
    const architecture = normalizeArchitecture({
        summary: 'A simple page.',
        stack: { framework: 'angular', markup: 'html', style: 'scss', script: 'javascript', iconSet: 'auto' },
        modules: [{ name: 'main', path: 'src/main.js', purpose: 'The entry.', exports: ['x'], dependsOn: [] }],
        tokens: [{ name: '--color-text', value: '#101828', kind: 'color' }],
        notes: '',
    }, { stack: { frontendFramework: 'vanilla' } });

    assert.equal(architecture.stack.framework, 'vanilla');
    assert.ok(architecture.warnings.some((item) => /angular/.test(item)));
    assert.equal(architecture.modules.length, 1);
    assert.equal(architecture.tokens[0].name, 'color-text');
    assert.match(architectureText(architecture), /--color-text: #101828/);
});

test('the styles of the project have one name, and the plan decides it', () => {
    // The plan names the stylesheet: `src/styles.scss`. The architect calls the language
    // `css`. The file wins, and the house says so out loud.
    const architecture = normalizeArchitecture({
        summary: 'A simple page.',
        stack: { framework: 'vanilla', markup: 'html', style: 'css', script: 'javascript', iconSet: 'auto' },
        modules: [{ name: 'styles', path: 'src/styles.scss', purpose: 'The look.', exports: [], dependsOn: [] }],
        tokens: [],
        notes: '',
    }, { stack: { styleLanguage: 'scss' } }, {
        steps: [{ id: 'styles', title: 'Styles', role: 'styler', files: ['src/styles.scss'] }],
    });

    assert.equal(architecture.styles.source, 'src/styles.scss');
    assert.equal(architecture.styles.language, 'scss');
    assert.equal(architecture.styles.link, 'src/styles.css');
    assert.equal(architecture.styles.from, 'plan');
    assert.equal(architecture.stack.style, 'scss');
    assert.ok(architecture.warnings.some((item) => /css/.test(item) && /src\/styles\.scss/.test(item)));
});

test('the brief of the architecture names the stylesheet for every role', () => {
    const architecture = normalizeArchitecture({
        summary: 'A page.',
        stack: { framework: 'vanilla', markup: 'html', style: 'scss', script: 'javascript', iconSet: 'auto' },
        modules: [{ name: 'styles', path: 'src/styles.scss', purpose: 'The look.', exports: [], dependsOn: [] }],
        tokens: [],
        notes: '',
    }, { stack: { styleLanguage: 'scss' } }, {
        steps: [{ id: 'styles', title: 'Styles', role: 'styler', files: ['src/styles.scss'] }],
    });

    const brief = architectureText(architecture);
    assert.match(brief, /## The styles of the project/);
    assert.match(brief, /src\/styles\.scss/);
    assert.match(brief, /src\/styles\.css/);
});

test('the styles of a project without a plan keep the name of the house', () => {
    const architecture = normalizeArchitecture({
        summary: 'A page.',
        stack: { framework: 'vanilla', markup: 'html', style: 'scss', script: 'javascript', iconSet: 'auto' },
        modules: [],
        tokens: [],
        notes: '',
    }, { stack: { styleLanguage: 'scss' } }, null);

    assert.equal(architecture.styles.source, 'src/styles.scss');
    assert.equal(architecture.styles.from, 'house');
});

test('the stage of the architecture asks the architect and writes the file', async () => {
    const root = await makeProject();
    const client = fakeClient([schemaAnswer('architecture', {
        summary: 'One module.',
        stack: { framework: 'vanilla', markup: 'html', style: 'scss', script: 'javascript', iconSet: 'auto' },
        modules: [{ name: 'main', path: 'src/main.js', purpose: 'The entry.', exports: [], dependsOn: [] }],
        tokens: [],
        notes: '',
    })]);

    const result = await architectStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: normalizePlan({ steps: [{ id: 'a', title: 'One' }] }),
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.match(result.file, /architecture\.json$/);
    assert.match(result.brief, /# The architecture of the project/);
});

test('the package manager is read from the lock file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pm-'));
    assert.equal(await detectPackageManager(root), 'none');
    await writeFile(path.join(root, 'package.json'), '{}\n', 'utf8');
    assert.equal(await detectPackageManager(root), 'npm');
    await writeFile(path.join(root, 'pnpm-lock.yaml'), '', 'utf8');
    assert.equal(await detectPackageManager(root), 'pnpm');
});

test('the answer of the installer goes into the manifest and into the project', async () => {
    const root = await makeProject();
    const applied = await applySetup({
        root,
        data: {
            dependencies: [{ name: 'vite', version: '^5.0.0', dev: true }, { name: 'lit', version: '3.0.0' }],
            scripts: [{ name: 'dev', command: 'vite' }],
            files: [{ path: 'vite.config.js', content: 'export default {};\n', language: 'js' }],
        },
    });

    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies.lit, '3.0.0');
    assert.equal(manifest.devDependencies.vite, '^5.0.0');
    assert.equal(manifest.scripts.dev, 'vite');
    assert.equal(applied.manifestChanged, true);
    assert.match(await readFile(path.join(root, 'vite.config.js'), 'utf8'), /export default/);
});

test('a file that already exists is not overwritten without a permission', async () => {
    const root = await makeProject();
    await writeFile(path.join(root, 'src', 'main.js'), 'keep me\n', 'utf8');
    await applySetup({
        root,
        data: { files: [{ path: 'src/main.js', content: 'new text\n', language: 'js' }] },
    });
    assert.equal(await readFile(path.join(root, 'src', 'main.js'), 'utf8'), 'keep me\n');
});

test('the readiness of the project is checked honestly', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-ready-'));
    const before = await setupReadiness(root, {});
    assert.equal(before.ok, false);
    assert.ok(before.checks.some((item) => item.id === 'manifest' && !item.ok));

    await writeFile(path.join(root, 'package.json'), '{ "scripts": { "dev": "vite" } }\n', 'utf8');
    await writeFile(path.join(root, 'index.html'), '<!doctype html>\n', 'utf8');
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    const after = await setupReadiness(root, {});
    assert.equal(after.ok, true);
});

test('the stage of the setup writes the skeleton of the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-scaffold-'));
    const client = fakeClient([schemaAnswer('setup', {
        summary: 'The environment.',
        packageManager: 'npm',
        dependencies: [],
        scripts: [],
        files: [],
        commands: [],
        notes: '',
    })]);

    const result = await setupStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        architecture: {
            summary: 'x',
            stack: { framework: 'vanilla', markup: 'html', style: 'scss', script: 'javascript' },
            modules: [],
            tokens: [],
            notes: '',
        },
        runId: 'run-1',
    });

    // The manifest and the bundler are written by the code, not by the model.
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.scripts.dev, 'vite');
    assert.ok(manifest.devDependencies.vite);
    const vite = await readFile(path.join(root, 'vite.config.js'), 'utf8');
    assert.match(vite, /defineConfig/);
    assert.deepEqual(result.setup.scaffold.written.sort(), ['.rules/files.md', '.rules/stack.md', 'package.json', 'vite.config.js']);
});

test('the setup installs the dependencies of the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-install-'));
    // A project with a manifest and no packages: the manager of the project is `npm`, and
    // the installation is done by the code.
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
        name: 'demo',
        private: true,
        devDependencies: {},
    }, null, 2), 'utf8');

    const result = await installDependencies({ root, manager: 'npm', timeoutMs: 120_000 });

    // The project has no dependencies, so the manager has nothing to install: the answer is
    // still an answer, and the stage does not break.
    assert.equal(typeof result.ran, 'boolean');
    assert.equal(result.manager, 'npm');
});

test('the setup does not install twice', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-install-'));
    await mkdir(path.join(root, 'node_modules'), { recursive: true });

    const result = await installDependencies({ root, manager: 'npm' });

    assert.equal(result.ran, false);
    assert.equal(result.ok, true);
});

test('the setup installs the package that the manifest names and the disk does not have', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-install-'));
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
        name: 'demo',
        private: true,
        devDependencies: { sass: '^1.80.0' },
    }, null, 2), 'utf8');

    // The manager does not exist: the point of the test is that the installation is
    // attempted at all, because the package of the manifest is not on the disk.
    const result = await installDependencies({ root, manager: 'no-such-manager', timeoutMs: 10_000 });

    assert.equal(result.ran, true);
});

test('the setup does not install when every package of the manifest is on the disk', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-install-'));
    await mkdir(path.join(root, 'node_modules', 'sass'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
        name: 'demo',
        private: true,
        devDependencies: { sass: '^1.80.0' },
    }, null, 2), 'utf8');

    const result = await installDependencies({ root, manager: 'no-such-manager', timeoutMs: 10_000 });

    assert.equal(result.ran, false);
    assert.equal(result.ok, true);
});

test('the compiler of the styles goes into the manifest of the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-install-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
        name: 'demo',
        private: true,
        devDependencies: { vite: '^7.0.0' },
    }, null, 2), 'utf8');

    const result = await ensureStyleCompiler({ root, styleLanguage: 'scss' });

    assert.equal(result.added, 'sass@^1.80.0 (dev)');
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.devDependencies.sass, '^1.80.0');
    assert.equal(manifest.devDependencies.vite, '^7.0.0');
});

test('the compiler of the styles is not added twice, and not for plain CSS', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-install-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
        name: 'demo',
        devDependencies: { sass: '^1.80.0' },
    }, null, 2), 'utf8');

    const again = await ensureStyleCompiler({ root, styleLanguage: 'scss' });
    assert.equal(again.added, null);

    const css = await ensureStyleCompiler({ root, styleLanguage: 'css' });
    assert.equal(css.added, null);
});

test('the setup installs the dependencies even when the installer is silent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-install-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
        name: 'demo',
        private: true,
    }, null, 2), 'utf8');
    // The installer says nothing: the answer of the model holds no data at all.
    const client = fakeClient([{
        id: 'resp-1',
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'I did nothing.' }] }],
    }]);

    const result = await setupStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        runId: 'run-silent',
    });

    // The manifest of the project is the contract of the install, not the answer of the model.
    assert.equal(result.setup.install.ran, true);
    assert.equal(result.setup.install.manager, 'npm');
    assert.ok(result.warnings.some((item) => /Установщик не вернул/.test(item)));
});

test('the stage of the setup applies the environment and writes the file', async () => {
    const root = await makeProject();
    const client = fakeClient([schemaAnswer('setup', {
        summary: 'The environment.',
        packageManager: 'npm',
        dependencies: [{ name: 'vite', version: '^5.0.0', dev: true }],
        scripts: [{ name: 'dev', command: 'vite' }],
        files: [],
        commands: [{ command: 'npm', args: ['install'], purpose: 'Install the packages.' }],
        notes: '',
    })]);

    const result = await setupStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        architecture: { summary: 'x', stack: {}, modules: [], tokens: [], notes: '' },
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.match(result.file, /setup\.json$/);
    // The compiler of the styles is a dependency of the project: the code adds it to the
    // manifest, and the package manager installs it.
    assert.deepEqual(result.applied.dependencies, ['vite@^5.0.0 (dev)', 'sass@^1.80.0 (dev)']);
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.devDependencies.vite, '^5.0.0');
    assert.equal(manifest.devDependencies.sass, '^1.80.0');
});

test('the installer is not given the step of the plan', async () => {
    const root = await makeProject();
    let seen = null;
    const client = fakeClient([(body) => {
        seen = body;
        return schemaAnswer('setup', {
            summary: 'The environment.',
            packageManager: 'npm',
            dependencies: [],
            scripts: [],
            files: [],
            commands: [],
            notes: '',
        });
    }]);

    const result = await setupStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: {
            summary: 'A landing.',
            steps: [{
                id: 'markup',
                title: 'Bring the HTML to the three rails',
                role: 'markup',
                dependsOn: [],
                files: ['index.html'],
                criteria: ['three rails'],
            }],
        },
        architecture: { summary: 'x', stack: {}, modules: [], tokens: [], notes: '' },
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    const text = seen.input[0].content.map((part) => part.text ?? '').join('\n');
    // The step of the plan belongs to the role of the step: the installer prepares the
    // environment and does not write the files of the plan.
    assert.doesNotMatch(text, /The step to do/);
    assert.match(text, /The files of the plan: index\.html/);
});

test('the directory of a run is under the working directory of the config', () => {
    const dir = runDirectory('/projects/app', { output: { work: './.tmp' } }, 'run-1');
    assert.match(dir, /projects[\\/]app[\\/]\.tmp[\\/]run-1$/);
});
