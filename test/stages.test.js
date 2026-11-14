/**
 * @file test/stages.test.js
 * @module test/stages
 * @purpose The tests of the stages: the plan, the collection of the context, the architecture
 *          and the setup of the environment.
 * @depends node:test, node:path, node:fs/promises, stages/plan, stages/collect,
 *          stages/architect, stages/setup, stages/workspace, registry
 * @ai.tags test, stages
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';

import { normalizePlan, orderSteps, planText, planStage, writePlan, readPlan } from '../src/stages/plan.js';
import { collectStage, collectText, componentCards, readInputs } from '../src/stages/collect.js';
import { normalizeArchitecture, architectureText, architectStage } from '../src/stages/architect.js';
import { detectPackageManager, applySetup, setupReadiness, setupStage } from '../src/stages/setup.js';
import { runId, runDirectory, sanitizeId } from '../src/stages/workspace.js';
import { openRegistry } from '../src/registry.js';

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
            { id: 'a', title: 'First', role: 'planner' },
            { id: 'a', title: 'Again', role: 'unknown-role' },
        ],
        risks: ['the risk'],
    });
    assert.equal(plan.steps.length, 3);
    assert.deepEqual(plan.steps.map((step) => step.id), ['a', 'b', 'a-2']);
    assert.ok(plan.warnings.some((item) => /a-2/.test(item)));
    assert.ok(plan.warnings.some((item) => /unknown-role/.test(item)));
    assert.ok(plan.warnings.some((item) => /nowhere/.test(item)));
    assert.deepEqual(plan.risks, ['the risk']);
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
    const plan = normalizePlan({ summary: 'x', steps: [{ id: 'a', title: 'One' }] });
    const file = await writePlan(root, config, 'run-1', plan);
    assert.match(file, /\.tmp[\\/]run-1[\\/]plan\.json$/);
    const back = await readPlan(root, config, 'run-1');
    assert.equal(back.steps[0].id, 'a');
    assert.equal(await readPlan(root, config, 'run-2'), null);
});

test('the stage of the plan asks the planner and writes the plan', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-plan2-'));
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
    assert.deepEqual(result.applied.dependencies, ['vite@^5.0.0 (dev)']);
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.devDependencies.vite, '^5.0.0');
});

test('the directory of a run is under the working directory of the config', () => {
    const dir = runDirectory('/projects/app', { output: { work: './.tmp' } }, 'run-1');
    assert.match(dir, /projects[\\/]app[\\/]\.tmp[\\/]run-1$/);
});
