/**
 * @file test/motion.test.js
 * @module test/motion
 * @purpose The tests of the stage of the animation and of the stage of the assets.
 * @depends node:test, node:path, node:fs/promises, stages/animation, stages/assets
 * @ai.tags test, stages, animation, assets
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { animationStage } from '../src/stages/animation.js';
import { assetsStage, assetFiles, placedAssets, writeAssets, readAssets } from '../src/stages/assets.js';
import { inputContext } from '../src/inputs/index.js';
import { ROLES } from '../src/roles/index.js';

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
            call_id: `c-${Math.random().toString(36).slice(2)}`,
            name,
            arguments: JSON.stringify(args),
        }],
    };
}

/** The plan of a landing with a motion of its own. */
const PLAN = {
    summary: 'A landing.',
    steps: [
        { id: 'style-1', title: 'Styles', role: 'styler', dependsOn: [], files: ['src/styles/main.css'], criteria: ['looks'] },
        { id: 'motion-1', title: 'Motion', role: 'animator', dependsOn: ['style-1'], files: ['src/styles/main.css'], criteria: ['moves'] },
    ],
};

test('the animator writes the motion into the styles of the step', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-motion-'));
    try {
        const client = fakeClient([schemaAnswer('style', {
            summary: 'The motion.',
            tokens: [],
            files: [{ path: 'src/styles/main.css', content: '.card { transition: opacity 200ms; }\n', language: 'css' }],
            notes: '',
        })]);

        const result = await animationStage({
            client,
            config: { output: { work: './.tmp' } },
            root,
            task: 'Make a landing.',
            plan: PLAN,
            architecture: { summary: 'x', stack: { style: 'css' }, modules: [], tokens: [], notes: '' },
            runId: 'run-1',
        });

        assert.equal(result.ok, true);
        assert.match(await readFile(path.join(root, 'src', 'styles', 'main.css'), 'utf8'), /transition/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the stage of the animation is skipped when the plan has no step of the role', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-motion-none-'));
    try {
        const result = await animationStage({
            client: fakeClient([]),
            config: { output: { work: './.tmp' } },
            root,
            task: 'Make a landing.',
            plan: { steps: [] },
            runId: 'run-1',
        });
        assert.equal(result.ok, true);
        assert.equal(result.skipped, true);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the animator is a role of the house with its own model', () => {
    assert.ok(ROLES.animator);
    assert.equal(ROLES.animator.name, 'animator');
    assert.ok(ROLES.animator.tools.includes('web_guidance'));
    assert.ok(ROLES.animator.tools.includes('patch_file'));
    // The craft of the motion comes to the role at the write gate.
    assert.match(ROLES.animator.instructions({ task: 'A landing.' }), /animator of a web project/);
});

test('the assets are placed after the vector graphics are drawn', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-assets-'));
    try {
        await mkdir(path.join(root, 'assets', 'import'), { recursive: true });
        await writeFile(path.join(root, 'assets', 'import', 'bishop.png'), 'PNG', 'utf8');
        await mkdir(path.join(root, 'assets', 'img'), { recursive: true });
        await writeFile(path.join(root, 'assets', 'img', 'wordmark.svg'), '<svg/>', 'utf8');

        const plan = {
            steps: [
                { id: 'art-1', title: 'Wordmark', role: 'editor', dependsOn: [], files: ['assets/img/wordmark.svg'], criteria: ['drawn'] },
            ],
        };

        // The vector graphics of the project are the files of the steps of the editor.
        assert.deepEqual(await assetFiles(root, plan), ['assets/img/wordmark.svg']);

        const client = fakeClient([schemaAnswer('code', {
            summary: 'The pictures are on their places.',
            files: [{ path: 'assets/img/bishop.png', content: 'PNG', language: 'png' }],
            commands: [],
            notes: '',
        })]);

        const result = await assetsStage({
            client,
            config: { output: { work: './.tmp' } },
            root,
            task: 'Make a landing.',
            plan,
            inputs: { pictures: [{ name: 'bishop', kind: 'image', file: 'assets/import/bishop.png', bytes: 3 }] },
            runId: 'run-1',
        });

        assert.equal(result.ok, true);
        // The prepared picture is on its place now, and the stage says where.
        assert.equal(result.assets.length, 1);
        assert.equal(result.assets[0].file, 'assets/img/bishop.png');
        assert.match(result.text, /assets\/img\/bishop\.png/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the stage of the assets says when a picture was not placed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-assets-missing-'));
    try {
        await mkdir(path.join(root, 'assets', 'import'), { recursive: true });
        await writeFile(path.join(root, 'assets', 'import', 'bishop.png'), 'PNG', 'utf8');

        const client = fakeClient([schemaAnswer('code', {
            summary: 'Nothing to do.',
            files: [],
            commands: [],
            notes: '',
        })]);

        const result = await assetsStage({
            client,
            config: { output: { work: './.tmp' } },
            root,
            task: 'Make a landing.',
            plan: { steps: [] },
            inputs: { pictures: [{ name: 'bishop', kind: 'image', file: 'assets/import/bishop.png', bytes: 3 }] },
            runId: 'run-1',
        });

        assert.ok(result.warnings.some((item) => /Картинка не поставлена на место/.test(item)), result.warnings.join(' | '));
        assert.equal(result.assets.length, 0);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the stage of the assets is skipped when there is nothing to place', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-assets-none-'));
    try {
        const result = await assetsStage({
            client: fakeClient([]),
            config: { output: { work: './.tmp' } },
            root,
            task: 'Make a landing.',
            plan: { steps: [] },
            inputs: { pictures: [] },
            runId: 'run-1',
        });
        assert.equal(result.ok, true);
        assert.equal(result.skipped, true);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the assets of the stage are the files the role put on their places', () => {
    const placed = placedAssets({
        steps: [{
            files: [{ path: 'assets/img/logo.png' }],
            applied: { written: ['assets/img/hero.webp'], own: ['assets/img/logo.png'] },
        }],
    });
    assert.deepEqual(placed.map((item) => item.path), ['assets/img/logo.png', 'assets/img/hero.webp']);
    assert.equal(placed[0].name, 'logo');
});

test('the placed assets are written to the run and read back', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-assets-file-'));
    try {
        const config = { output: { work: './.tmp' } };
        const file = await writeAssets(root, config, 'run-1', [{ name: 'bishop', file: 'assets/img/bishop.png' }]);
        assert.ok(file.endsWith('assets.json'));
        assert.deepEqual(await readAssets(root, config, 'run-1'), [{ name: 'bishop', file: 'assets/img/bishop.png' }]);
        // A run without the file has no assets.
        assert.deepEqual(await readAssets(root, config, 'run-2'), []);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('the roles see the final paths of the assets', () => {
    const text = inputContext({
        assets: [{ name: 'bishop', kind: 'image', file: 'assets/img/bishop.png', use: 'the hero' }],
    });
    assert.match(text, /# The assets of the project/);
    assert.match(text, /assets\/img\/bishop\.png/);
});
