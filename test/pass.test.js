/**
 * @file test/pass.test.js
 * @module test/pass
 * @purpose The tests of the passes of a role: the draft of the contract and the full work.
 * @depends node:test, stages/pass, stages/pass-tasks
 * @ai.tags test, stages, passes
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import {
    PASSES,
    defaultPass,
    passFor,
    passKey,
    passesOf,
    passReportName,
    isPassReportName,
} from '../src/stages/pass.js';
import { passTask, passNote, isDraftPass } from '../src/stages/pass-tasks.js';
import { runStepStage, readPassReport } from '../src/stages/step.js';
import { effortFor } from '../src/agent/pace.js';
import { defaults } from '../src/config/defaults.js';

test('the roles with passes have the draft before the full work', () => {
    assert.deepEqual(passesOf('styler'), ['draft', 'full']);
    assert.deepEqual(passesOf('coder'), ['draft', 'full']);
    // A role without passes works in one go.
    assert.deepEqual(passesOf('markup'), []);
    assert.deepEqual(passesOf('animator'), []);
});

test('the default pass of a role is the full work', () => {
    assert.equal(defaultPass('styler'), 'full');
    assert.equal(defaultPass('coder'), 'full');
    assert.equal(defaultPass('markup'), 'full');
});

test('a pass that the role does not have is not found', () => {
    assert.equal(passFor('styler', 'draft'), 'draft');
    assert.equal(passFor('styler', 'full'), 'full');
    assert.equal(passFor('styler', 'polish'), null);
    assert.equal(passFor('markup', 'draft'), null);
    assert.equal(passFor('markup', 'full'), null);
});

test('the key of a pass names the role and the pass', () => {
    assert.equal(passKey('styler', 'draft'), 'styler.draft');
    assert.equal(passKey('CODER', 'full'), 'coder.full');
    assert.equal(passKey('coder', ''), 'coder.full');
});

test('the report of a pass is named after the step and the pass', () => {
    assert.equal(passReportName('style-base', 'styler', 'draft'), 'style-base.styler.draft');
    assert.equal(passReportName('', 'coder', 'full'), 'step.coder.full');
});

test('a report of a pass is told from a report of a step', () => {
    assert.equal(isPassReportName('style-base.styler.draft.json'), true);
    assert.equal(isPassReportName('style-base.coder.full.json'), true);
    // A report of a step is not a report of a pass.
    assert.equal(isPassReportName('style-base.json'), false);
    assert.equal(isPassReportName('style-base.styler.json'), false);
    // A step whose name ends like a pass, but the role does not have passes.
    assert.equal(isPassReportName('markup-home.markup.full.json'), false);
});

test('the contract of the styles is asked for whole', () => {
    const task = passTask('styler', 'draft', { step: { id: 'style-base' } });
    assert.match(task, /contract/i);
    assert.match(task, /token/i);
    assert.match(task, /style-base/);
    // Контракт пишется целиком: токены, имена, каркас, правила компонентов, состояния.
    assert.match(task, /rules of the components/);
    assert.match(task, /rules of the states/);
    assert.match(task, /responsive behaviour/);
    // Черновик — это не «только скелет»: следующий проход идёт на младшей модели.
    assert.match(task, /cheaper model/);
    assert.match(task, /Write \*\*all of it\*\*/);

    // Полная работа — второй взгляд на тот же файл, а не написание с нуля.
    const full = passTask('styler', 'full', { step: { id: 'style-base' } });
    assert.match(full, /polish/i);
    assert.match(full, /already on the disk/);
    assert.doesNotMatch(full, /Write \*\*all of it\*\*/);
});

test('the contract of the code is asked for whole', () => {
    const task = passTask('coder', 'draft', { step: { id: 'state' }, hasStyles: true });
    assert.match(task, /contract/i);
    assert.match(task, /state/);
    assert.match(task, /Write \*\*all of it\*\*/);
    // С контрактом стилей на диске роль читает его.
    assert.match(task, /Read it first/);
    // Без него — имена берутся из разметки и брифа.
    const bare = passTask('coder', 'draft', { step: { id: 'state' }, hasStyles: false });
    assert.match(bare, /not written yet/);
});

test('the full code is the second look at the contract', () => {
    const task = passTask('coder', 'full', { step: { id: 'state' } });
    assert.match(task, /code of the page/i);
    assert.match(task, /already on the disk/);
    assert.match(task, /Do not start the code over/);
});

test('a role without passes has no task of a pass', () => {
    assert.equal(passTask('markup', 'full', { step: { id: 'markup-home' } }), '');
    assert.equal(passNote('markup', 'draft'), '');
});

test('the note of a pass names the contract', () => {
    assert.equal(passNote('styler', 'draft'), 'контракт стилей');
    assert.equal(passNote('coder', 'draft'), 'контракт кода');
    assert.equal(passNote('styler', 'full'), '');
    assert.equal(isDraftPass('draft'), true);
    assert.equal(isDraftPass('full'), false);
});

test('the passes of the house are known', () => {
    assert.ok(PASSES.styler.includes('draft'));
    assert.ok(PASSES.coder.includes('full'));
});

test('the dial of the contract lifts the plan of the drafts', () => {
    // Планка черновиков контракта выше: она поднимает усилие выше потолка прогона.
    const config = structuredClone(defaults);
    const draft = effortFor({ config, role: 'styler', stage: 'pre-styling' });
    const work = effortFor({ config, role: 'styler', stage: 'styling' });
    assert.equal(draft, 'xhigh');
    assert.equal(work, 'high');
    assert.ok(draft !== work, 'черновик и работа отвечают с разной планкой');

    // Диал контракта поднимает усилие и над потолком прогона: он и есть то самое
    // «поднять планку на pre-стадиях».
    const low = structuredClone(defaults);
    low.pace.contractQuality = 50;
    assert.equal(effortFor({ config: low, role: 'styler', stage: 'pre-styling' }), 'high');

    // Пользователь может опустить планку контракта до общей.
    const flat = structuredClone(defaults);
    flat.pace.contractQuality = 0;
    assert.equal(effortFor({ config: flat, role: 'styler', stage: 'pre-styling' }), 'low');
});

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
 * An answer of the role with its schema.
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
        { id: 'style-1', title: 'Styles', role: 'styler', dependsOn: [], files: ['src/styles/main.css'] },
    ],
};

test('the draft and the full work are two passes of one step', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pass-'));
    const config = { output: { work: './.tmp' }, stages: { styler: { maxTurns: 4 } } };
    const client = fakeClient([
        // Первый заход: черновик контракта.
        schemaAnswer('style', {
            summary: 'The tokens.',
            files: [{ path: 'src/styles/main.css', content: ':root { --color-surface: #fff; }\n', language: 'css' }],
            tokens: [{ name: 'color-surface', value: '#fff' }],
            notes: '',
        }),
        // Второй заход: полные стили.
        schemaAnswer('style', {
            summary: 'The styles.',
            files: [{ path: 'src/styles/main.css', content: ':root { --color-surface: #fff; }\n.page { color: var(--color-surface); }\n', language: 'css' }],
            tokens: [],
            notes: '',
        }),
    ]);

    // Стадия `pre-styling` делает черновик.
    const draft = await runStepStage({
        client,
        config,
        root,
        task: 'Make a landing.',
        role: 'styler',
        plan: PLAN,
        runId: 'run-1',
        pass: 'draft',
    });
    assert.equal(draft.ok, true);
    assert.equal(draft.steps[0].pass, 'draft');

    // Стадия `styling` делает полную работу — и не повторяет черновик.
    const full = await runStepStage({
        client,
        config,
        root,
        task: 'Make a landing.',
        role: 'styler',
        plan: PLAN,
        runId: 'run-1',
        pass: 'full',
    });
    assert.equal(full.ok, true);
    assert.equal(full.steps[0].pass, 'full');

    // На диске — полные стили: черновик не затирает их.
    const text = await readFile(path.join(root, 'src', 'styles', 'main.css'), 'utf8');
    assert.match(text, /\.page/);

    // Оба отчёта лежат рядом: отчёт шага — последний, отчёты проходов — свои.
    const draftReport = await readPassReport(root, config, 'run-1', 'style-1', 'styler', 'draft');
    const fullReport = await readPassReport(root, config, 'run-1', 'style-1', 'styler', 'full');
    assert.equal(draftReport.pass, 'draft');
    assert.equal(draftReport.summary, 'The tokens.');
    assert.equal(fullReport.pass, 'full');
    assert.equal(fullReport.summary, 'The styles.');

    await rm(root, { recursive: true, force: true });
});

test('a pass that is already done is not done again', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pass-again-'));
    const config = { output: { work: './.tmp' }, stages: { styler: { maxTurns: 4 } } };
    const client = fakeClient([
        schemaAnswer('style', {
            summary: 'The tokens.',
            files: [{ path: 'src/styles/main.css', content: ':root { --a: 1; }\n', language: 'css' }],
            tokens: [],
            notes: '',
        }),
    ]);

    await runStepStage({
        client, config, root, task: 'Make a landing.', role: 'styler', plan: PLAN, runId: 'run-1', pass: 'draft',
    });

    // Второй вызов того же прохода: модель не зовётся, работа уже на диске.
    const again = await runStepStage({
        client, config, root, task: 'Make a landing.', role: 'styler', plan: PLAN, runId: 'run-1', pass: 'draft',
    });
    assert.equal(again.ok, true);
    assert.equal(again.steps[0].resumed, true);

    await rm(root, { recursive: true, force: true });
});
