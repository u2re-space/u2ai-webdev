/**
 * @file test/process.test.js
 * @module test/process
 * @purpose The tests of the process management: the plan on the disk, the progress, the
 *          pause, the continuation and the background jobs.
 * @depends node:test, node:path, node:fs/promises, agent/work-plan, stages/index, pipeline,
 *          jobs/manager
 * @ai.tags test, process, progress, jobs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';

import {
    createProgress,
    syncProgress,
    recordStep,
    applyFromStep,
    applyPlanUpdate,
    parsePlanUpdate,
    resolveResumeStep,
    briefProgress,
    isOpenProgress,
    writeProgress,
    readProgress,
} from '../src/agent/work-plan.js';
import { STAGES, STAGE_NAMES, stageByName, stageOrder, enabledStages, stageDependencies, resumeStageName } from '../src/stages/index.js';
import { runPipeline, resumePipeline, pipelineFiles } from '../src/pipeline.js';
import { createJobManager, jobId } from '../src/jobs/manager.js';

const CONFIG = { output: { work: './.tmp' }, stages: {} };

test('the progress of a run holds the record of every stage', () => {
    const progress = createProgress({
        id: 'run-1',
        task: 'Make a landing.',
        stages: [{ name: 'plan' }, { name: 'code' }],
    });
    assert.equal(progress.stages.length, 2);
    assert.equal(progress.stages[0].status, 'pending');
    assert.equal(progress.stage, null);
    assert.ok(isOpenProgress(progress));
});

test('a finished stage moves the cursor, a failed one does not', () => {
    let progress = createProgress({ id: 'run-1', stages: [{ name: 'plan' }, { name: 'code' }] });
    progress = recordStep(progress, { stage: 'plan', status: 'completed', report: 'ok' });
    assert.equal(progress.cursor, 1);
    assert.equal(progress.stages[0].status, 'completed');
    assert.equal(progress.stage, 'plan');

    progress = recordStep(progress, { stage: 'code', status: 'failed', report: 'boom' });
    assert.equal(progress.cursor, 1);
    assert.equal(progress.status, 'failed');
    assert.equal(progress.stages[1].status, 'failed');
});

test('the progress keeps the done stages when the list changes', () => {
    let progress = createProgress({ id: 'run-1', stages: [{ name: 'plan' }] });
    progress = recordStep(progress, { stage: 'plan', status: 'completed' });
    const next = syncProgress(progress, [{ name: 'plan' }, { name: 'code' }]);
    assert.equal(next.stages[0].status, 'completed');
    assert.equal(next.stages[1].status, 'pending');
    assert.equal(next.stages[1].index, 2);
});

test('the stages may be opened again from a point', () => {
    let progress = createProgress({ id: 'run-1', stages: [{ name: 'a' }, { name: 'b' }] });
    progress = recordStep(progress, { stage: 'a', status: 'completed' });
    progress = recordStep(progress, { stage: 'b', status: 'completed' });
    const reopened = applyFromStep(progress, 1);
    assert.equal(reopened.stages[0].status, 'completed');
    assert.equal(reopened.stages[1].status, 'pending');
});

test('the update of the plan is read out of the report of a stage', () => {
    const update = parsePlanUpdate([
        'The work is done.',
        '```plan-update',
        JSON.stringify({
            note: 'One more file.',
            addSteps: [{ title: 'Add the favicon', role: 'editor' }],
            revise: [{ id: 'code-1', title: 'Write the code with the favicon' }],
        }),
        '```',
    ].join('\n'));
    assert.equal(update.note, 'One more file.');
    assert.equal(update.addSteps.length, 1);
    assert.equal(update.revise[0].id, 'code-1');
    assert.equal(parsePlanUpdate('nothing here'), null);
    assert.equal(parsePlanUpdate('```plan-update\nnot json\n```'), null);
});

test('the update of the plan revises the pending steps and adds the new ones', () => {
    const plan = {
        steps: [
            { id: 'a', title: 'One', role: 'coder', files: [] },
            { id: 'b', title: 'Two', role: 'coder', files: [] },
        ],
    };
    const { plan: next, note } = applyPlanUpdate(plan, {
        note: 'More.',
        revise: [{ id: 'b', title: 'Two, revised' }],
        addSteps: [{ title: 'Three', role: 'editor' }],
    }, { done: ['a'] });
    assert.equal(note, 'More.');
    assert.equal(next.steps[1].title, 'Two, revised');
    assert.equal(next.steps.length, 3);
    assert.equal(next.steps[2].title, 'Three');
    assert.ok(next.steps[2].id);
});

test('a done step is not revised by an update', () => {
    const plan = { steps: [{ id: 'a', title: 'One' }] };
    const { plan: next } = applyPlanUpdate(plan, { revise: [{ id: 'a', title: 'Changed' }] }, { done: ['a'] });
    assert.equal(next.steps[0].title, 'One');
});

test('the point of the continuation is found by the number or by the id', () => {
    const plan = { steps: [{ id: 'markup-1' }, { id: 'code-1' }] };
    assert.equal(resolveResumeStep(plan, '2'), 1);
    assert.equal(resolveResumeStep(plan, 'markup-1'), 0);
    assert.equal(resolveResumeStep(plan, 'code-1'), 1);
    assert.equal(resolveResumeStep(plan, 'nowhere'), -1);
    assert.equal(resolveResumeStep(plan, '9'), -1);
});

test('the progress of a run is written to the disk and read back', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-progress-'));
    const progress = createProgress({ id: 'run-1', task: 'Make a landing.', stages: [{ name: 'plan' }] });
    await writeProgress(root, CONFIG, 'run-1', progress);
    const back = await readProgress(root, CONFIG, 'run-1');
    assert.equal(back.task, 'Make a landing.');
    assert.ok(back.updatedAt);
    assert.equal(await readProgress(root, CONFIG, 'run-2'), null);
});

test('the short report of the progress names the stages', () => {
    let progress = createProgress({ id: 'run-1', stages: [{ name: 'plan' }] });
    progress = recordStep(progress, { stage: 'plan', status: 'completed' });
    const text = briefProgress(progress);
    assert.match(text, /plan/);
    assert.match(text, /completed/);
});

test('the registry of the stages knows the order and the dependencies', () => {
    assert.ok(STAGE_NAMES.includes('plan'));
    assert.ok(STAGE_NAMES.includes('learn'));
    assert.equal(stageByName('plan').name, 'plan');
    assert.equal(stageByName('nowhere'), null);
    assert.deepEqual(stageDependencies('coding'), ['markup']);
    assert.deepEqual(stageDependencies('nowhere'), []);

    const order = stageOrder([...STAGES]);
    assert.equal(order.warnings.length, 0);
    assert.ok(order.stages.findIndex((stage) => stage.name === 'markup')
        < order.stages.findIndex((stage) => stage.name === 'coding'));
});

test('a stage that is switched off is not in the list', () => {
    const { stages, warnings } = enabledStages({ stages: { review: { enabled: false } } });
    assert.equal(warnings.length, 0);
    assert.ok(!stages.some((stage) => stage.name === 'review'));

    const asked = enabledStages({}, ['plan', 'nowhere']);
    assert.equal(asked.stages.length, 1);
    assert.ok(asked.warnings.some((item) => /nowhere/.test(item)));
});

test('the stage of the continuation is the first one that is not done', () => {
    const progress = createProgress({ id: 'run-1', stages: [{ name: 'plan' }, { name: 'code' }] });
    let next = recordStep(progress, { stage: 'plan', status: 'completed' });
    assert.equal(resumeStageName(next, [{ name: 'plan' }, { name: 'code' }]), 'code');
    next = recordStep(next, { stage: 'code', status: 'completed' });
    assert.equal(resumeStageName(next, [{ name: 'plan' }, { name: 'code' }]), null);
});

/**
 * A stage that does nothing but says what it did.
 * @param {string} name
 * @param {object} [result]
 * @returns {object}
 */
function fakeStage(name, result = {}) {
    return {
        name,
        title: name,
        dependsOn: [],
        run: async () => ({ ok: true, warnings: [], ...result }),
    };
}

test('the pipeline runs the stages in order and writes the progress', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pipeline-'));
    const order = [];
    const stages = [
        { name: 'first', title: 'First', dependsOn: [], run: async () => { order.push('first'); return { ok: true }; } },
        { name: 'second', title: 'Second', dependsOn: ['first'], run: async () => { order.push('second'); return { ok: true, text: 'done' }; } },
    ];

    const result = await runPipeline({
        client: { responses: { create: async () => ({ output: [] }) } },
        config: CONFIG,
        root,
        task: 'Make a landing.',
        runId: 'run-1',
        stages,
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(order, ['first', 'second']);
    assert.equal(result.stages.length, 2);
    assert.match(result.file, /progress\.json$/);

    const progress = JSON.parse(await readFile(result.file, 'utf8'));
    assert.equal(progress.status, 'completed');
    assert.equal(progress.stages[0].status, 'completed');
});

test('the pipeline pauses on the border of a stage and may continue', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pause-'));
    const done = [];
    const stages = [
        { name: 'one', title: 'One', dependsOn: [], run: async () => { done.push('one'); return { ok: true }; } },
        { name: 'two', title: 'Two', dependsOn: ['one'], run: async () => { done.push('two'); return { ok: true }; } },
    ];

    const paused = await runPipeline({
        client: { responses: { create: async () => ({ output: [] }) } },
        config: CONFIG,
        root,
        task: 'Make a landing.',
        runId: 'run-1',
        stages,
        stopAfter: 'one',
    });

    assert.equal(paused.status, 'paused');
    assert.deepEqual(done, ['one']);
    assert.equal(paused.progress.stages[0].status, 'completed');
    assert.equal(paused.progress.stages[1].status, 'pending');

    const continued = await resumePipeline({
        client: { responses: { create: async () => ({ output: [] }) } },
        config: CONFIG,
        root,
        task: 'Make a landing.',
        runId: 'run-1',
        stages,
    });

    assert.equal(continued.status, 'completed');
    assert.deepEqual(done, ['one', 'two']);
    assert.equal(continued.stages[0].status, 'skipped');
});

test('an aborted signal pauses the run before the next stage', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-abort-'));
    const controller = new AbortController();
    const stages = [
        {
            name: 'one',
            title: 'One',
            dependsOn: [],
            run: async () => {
                controller.abort();
                return { ok: true };
            },
        },
        { name: 'two', title: 'Two', dependsOn: ['one'], run: async () => ({ ok: true }) },
    ];

    const result = await runPipeline({
        client: { responses: { create: async () => ({ output: [] }) } },
        config: CONFIG,
        root,
        task: 'Make a landing.',
        runId: 'run-1',
        stages,
        signal: controller.signal,
    });

    assert.equal(result.status, 'paused');
    assert.equal(result.stages.length, 1);
    assert.ok(result.warnings.some((item) => /two/.test(item)));
});

test('a stage that fails stops the run and is written to the progress', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-fail-'));
    const stages = [
        { name: 'one', title: 'One', dependsOn: [], run: async () => { throw new Error('the model is down'); } },
        { name: 'two', title: 'Two', dependsOn: ['one'], run: async () => ({ ok: true }) },
    ];

    const result = await runPipeline({
        client: { responses: { create: async () => ({ output: [] }) } },
        config: CONFIG,
        root,
        task: 'Make a landing.',
        runId: 'run-1',
        stages,
    });

    assert.equal(result.status, 'failed');
    assert.match(result.error, /the model is down/);
    const progress = JSON.parse(await readFile(result.file, 'utf8'));
    assert.equal(progress.stages[0].status, 'failed');
    assert.equal(progress.stages[1].status, 'pending');
});

test('a resumed run reads the inputs and the pictures back', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-resume-'));
    const dir = path.join(root, '.tmp', 'run-1');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'inputs.json'), JSON.stringify({
        task: 'Make a landing.',
        design: { present: true },
    }));
    await writeFile(path.join(dir, 'pictures.json'), JSON.stringify({
        pictures: [{ name: 'bishop artwork', file: 'assets/import/bishop-artwork.png' }],
    }));
    await writeFile(path.join(dir, 'progress.json'), JSON.stringify({
        id: 'run-1',
        task: 'Make a landing.',
        status: 'paused',
        cursor: 1,
        stages: [
            { name: 'collect', status: 'completed', index: 1 },
            { name: 'plan', status: 'pending', index: 2 },
        ],
    }));

    let seen = null;
    const stages = [
        { name: 'collect', title: 'Collect', dependsOn: [], run: async () => ({ ok: true }) },
        {
            name: 'plan',
            title: 'Plan',
            dependsOn: ['collect'],
            run: async (args) => { seen = args; return { ok: true }; },
        },
    ];

    const result = await resumePipeline({
        client: { responses: { create: async () => ({ output: [] }) } },
        config: { ...CONFIG, memory: { enabled: false } },
        root,
        runId: 'run-1',
        stages,
    });

    assert.equal(result.status, 'completed');
    // The task of the run belongs to the run: the continuation had none of its own.
    assert.equal(seen.task, 'Make a landing.');
    // The collected inputs and the prepared pictures are read back from the run.
    assert.equal(seen.inputs.design.present, true);
    assert.equal(seen.inputs.pictures.length, 1);
    assert.equal(seen.inputs.pictures[0].file, 'assets/import/bishop-artwork.png');
});

test('a resumed run without the inputs collects them again', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-resume-collect-'));
    const dir = path.join(root, '.tmp', 'run-1');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'progress.json'), JSON.stringify({
        id: 'run-1',
        task: 'Make a landing.',
        status: 'paused',
        cursor: 1,
        stages: [
            { name: 'collect', status: 'completed', index: 1 },
            { name: 'plan', status: 'pending', index: 2 },
        ],
    }));

    const done = [];
    const stages = [
        { name: 'collect', title: 'Collect', dependsOn: [], run: async () => { done.push('collect'); return { ok: true }; } },
        { name: 'plan', title: 'Plan', dependsOn: ['collect'], run: async () => { done.push('plan'); return { ok: true }; } },
    ];

    const result = await resumePipeline({
        client: { responses: { create: async () => ({ output: [] }) } },
        config: { ...CONFIG, memory: { enabled: false } },
        root,
        runId: 'run-1',
        stages,
    });

    assert.equal(result.status, 'completed');
    // The collection is deterministic, and the later stages need what it finds.
    assert.deepEqual(done, ['collect', 'plan']);
});

test('the files of the stages are collected', () => {
    const files = pipelineFiles({
        applied: { written: ['index.html'] },
        steps: [{ applied: { written: ['src/main.js'] } }],
    });
    assert.deepEqual(files.sort(), ['index.html', 'src/main.js']);
});

test('the id of a job is a safe name of a directory', () => {
    const id = jobId(new Date('2026-11-13T14:22:33'));
    assert.match(id, /^20261113-142233-[0-9a-f]{6}$/);
});

test('a background job runs apart and the manager waits for it', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-jobs-'));
    const manager = createJobManager({ dir });

    const job = await manager.start({
        name: 'the quick one',
        command: process.execPath,
        args: ['-e', 'process.stdout.write("hello")'],
        cwd: dir,
    });

    assert.equal(job.status, 'running');
    assert.ok(job.pid);

    const done = await manager.wait(job.id, { timeoutMs: 20000, pollMs: 50 });
    assert.equal(done.status, 'done');
    assert.equal(done.exitCode, 0);

    const log = await readFile(done.log, 'utf8');
    assert.match(log, /hello/);

    const list = await manager.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, job.id);

    assert.equal(await manager.remove(job.id), true);
    assert.equal(await manager.get(job.id), null);
});

test('a job that fails is reported as failed', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-jobs2-'));
    const manager = createJobManager({ dir });

    const job = await manager.start({
        command: process.execPath,
        args: ['-e', 'process.exit(3)'],
        cwd: dir,
    });

    const done = await manager.wait(job.id, { timeoutMs: 20000, pollMs: 50 });
    assert.equal(done.status, 'failed');
    assert.equal(done.exitCode, 3);
});

test('a running job may be cancelled and removed', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-jobs3-'));
    const manager = createJobManager({ dir });

    const job = await manager.start({
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 60000)'],
        cwd: dir,
    });

    const cancelled = await manager.cancel(job.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(await manager.get(job.id));
    assert.equal(await manager.remove(job.id), true);
});

test('the finished jobs may be cleaned away', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-jobs4-'));
    const manager = createJobManager({ dir });
    const job = await manager.start({
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: dir,
    });
    await manager.wait(job.id, { timeoutMs: 20000, pollMs: 50 });
    const removed = await manager.prune();
    assert.deepEqual(removed, [job.id]);
    assert.equal((await manager.list()).length, 0);
});
