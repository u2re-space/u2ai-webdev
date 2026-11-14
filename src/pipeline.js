/**
 * @file src/pipeline.js
 * @module pipeline
 * @purpose The orchestrator of the stages: the order, the pause and the continuation.
 *
 *   The pipeline runs the stages of the registry one after another and writes the progress
 *   of the run to the disk after every stage. That is what makes a run resumable: when the
 *   process dies, the next run reads the progress and continues at the first stage that is
 *   not done.
 *
 *   The pause happens on the border of a stage: a stage is never cut in half. The user may
 *   stop after a stage (`stopAfter`) or press Ctrl+C (an aborted signal); in both cases the
 *   progress of the run stays on the disk and the run may be continued later.
 *
 * @depends stages/index, stages/workspace, stages/plan, stages/architect, stages/setup,
 *          stages/collect, stages/pictures, stages/review, agent/work-plan
 * @usedBy cli, jobs/manager
 * @exports runPipeline, resumePipeline, pipelineFiles, filesAllowed
 * @ai.tags pipeline, orchestration, resume
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: оркестратор стадий и продолжение прогона.
 * @changed 2026-11-14 The stage of the pictures; the name of the stage to stop at is not case sensitive.
 * @changed 2026-11-14 A resumed run reads the collected inputs and the prepared pictures back.
 */

import { runId as makeRunId } from './stages/workspace.js';
import { enabledStages } from './stages/index.js';
import { readPlan } from './stages/plan.js';
import { readArchitecture } from './stages/architect.js';
import { readSetup } from './stages/setup.js';
import { readReview } from './stages/review.js';
import { readInputs } from './stages/collect.js';
import { collectInputs, mergeInputs } from './inputs/index.js';
import { readPictures } from './stages/pictures.js';
import { createProgress, recordStep, readProgress, writeProgress } from './agent/work-plan.js';
import { openMemory, memoryContext, memoryFile } from './memory.js';
import { defaultHome } from './config/paths.js';

/**
 * May the run write the files of the answers into the project?
 *
 * Two knobs decide it: the extraction (`off` keeps the files in the report) and the
 * policy of the confirmations (`read` writes nothing).
 *
 * @param {object} [config]
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function filesAllowed(config = {}) {
    if (String(config?.agent?.extract ?? 'auto') === 'off') return false;
    const approve = String(config?.agent?.approve ?? 'write');
    return approve === 'write' || approve === 'all';
}

/**
 * The files of the stages are collected.
 * @param {object} result
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function pipelineFiles(result = {}) {
    const written = new Set();
    for (const item of result?.applied?.written ?? []) written.add(String(item));
    for (const item of result?.files ?? []) {
        const rel = String(item?.path ?? item ?? '').trim();
        if (rel) written.add(rel);
    }
    for (const item of result?.steps ?? []) {
        for (const rel of item?.applied?.written ?? []) written.add(String(rel));
    }
    return [...written];
}

/**
 * The short report of a stage.
 * @param {object} result
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
function reportOf(result = {}) {
    const text = String(result?.text ?? result?.summary ?? '').trim();
    if (text) return text;
    const steps = Array.isArray(result?.steps) ? result.steps : [];
    return steps.map((step) => `${step?.step?.id ?? 'step'}: ${step?.summary ?? ''}`).join('\n');
}

/**
 * Run the stages of a run.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, runId?: string|null,
 *   stageNames?: string[]|null, stopAfter?: string|null, signal?: AbortSignal|null,
 *   notify?: (event: object) => void, env?: object, inputs?: object|null, resume?: boolean,
 *   stages?: object[]|null }} request
 * @returns {Promise<{ status: string, runId: string, stages: object[], progress: object,
 *   file: string|null, warnings: string[], error: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function runPipeline({
    client,
    config = {},
    root = process.cwd(),
    task = '',
    runId: id = null,
    stageNames = null,
    stopAfter = null,
    signal = null,
    notify = () => {},
    env = process.env,
    inputs = null,
    resume = false,
    stages: override = null,
} = {}) {
    const run = id || makeRunId();
    const selected = override
        ? { stages: override, warnings: [] }
        : enabledStages(config, stageNames);
    const list = selected.stages;
    const warnings = [...selected.warnings];

    // The context of the run: every stage reads it and puts its result into it.
    const ctx = {
        client,
        config,
        root,
        task,
        runId: run,
        notify,
        env,
        inputs,
        memory: null,
        memoryText: '',
        apply: filesAllowed(config),
        plan: null,
        architecture: null,
        setup: null,
        build: null,
        pictures: [],
        reports: [],
        review: null,
        audit: null,
        lessons: [],
    };

    // The permanent memory of the project: the run reads it and writes the lessons into it.
    let memory = null;
    if (config?.memory?.enabled !== false) {
        try {
            const file = config?.memory?.dbFile ?? memoryFile(defaultHome(env));
            memory = openMemory({ file, project: root });
            ctx.memory = memory;
            ctx.memoryText = memoryContext(memory, {
                query: task,
                scope: config?.memory?.scope ?? 'project',
                limit: config?.memory?.limit ?? 40,
            });
        } catch (error) {
            warnings.push(`Память недоступна: ${error?.message ?? error}`);
        }
    }

    let progress = createProgress({ id: run, task, stages: list });
    const done = new Map((progress.stages ?? []).map((stage) => [stage.name, stage]));

    if (resume) {
        const stored = await readProgress(root, config, run);
        if (stored) {
            progress = stored;
            for (const stage of progress.stages ?? []) done.set(stage.name, stage);
        }
        // The task of the run belongs to the run: a continuation without a task of its own
        // works on the task of the earlier run.
        ctx.task = String(task ?? '').trim() || String(progress.task ?? '').trim();
        // The artifacts of the finished stages are read back, so the run continues with
        // the same plan and the same structure.
        ctx.plan = await readPlan(root, config, run);
        ctx.architecture = await readArchitecture(root, config, run);
        ctx.setup = await readSetup(root, config, run);
        // The collected inputs and the prepared pictures too: the stages that are skipped
        // would otherwise leave the later stages with nothing.
        ctx.inputs = await readInputs(root, config, run);
        ctx.pictures = await readPictures(root, config, run);
        if (ctx.pictures.length && ctx.inputs) {
            ctx.inputs = { ...ctx.inputs, pictures: ctx.pictures };
        }
        // The flags of this run may name what the earlier run did not know: the essence of
        // the task (`--input`) and the picture of the task (`--image`). The inputs are
        // collected again — the collection is deterministic — and the new parts are merged
        // into the ones that are read back.
        if (ctx.inputs) {
            const fresh = await collectInputs({ root, config, task: ctx.task });
            ctx.inputs = mergeInputs(ctx.inputs, fresh);
        }
        // A run that was started before the inputs were written collects them again: the
        // collection is deterministic, and the later stages need what it finds.
        if (!ctx.inputs) {
            const record = done.get('collect');
            if (record) done.set('collect', { ...record, status: 'pending' });
        }
        const review = await readReview(root, config, run);
        if (review) ctx.review = review;
    }

    const reports = [];
    let status = 'completed';
    let error = null;
    let paused = false;

    for (const stage of list) {
        const record = done.get(stage.name);
        if (resume && record?.status === 'completed') {
            // The progress says that the stage ran. The disk says whether its work is
            // still there: a stage whose files are gone is done again.
            const lost = stage.verify ? !(await stage.verify(ctx)) : false;
            if (!lost) {
                reports.push({ name: stage.name, status: 'skipped', result: null, warnings: [] });
                notify({ type: 'stage.skip', stage: stage.name });
                continue;
            }
            warnings.push(`Стадия ${stage.name}: работа потеряна — стадия выполняется заново.`);
            progress = recordStep(progress, { stage: stage.name, status: 'pending' });
        }

        if (signal?.aborted) {
            paused = true;
            status = 'paused';
            warnings.push(`Прогон остановлен до стадии ${stage.name}.`);
            break;
        }

        notify({ type: 'stage.start', stage: stage.name, title: stage.title });
        let result = null;
        try {
            const args = typeof stage.args === 'function' ? { ...ctx, ...stage.args(ctx) } : ctx;
            result = await stage.run(args);
        } catch (cause) {
            error = cause?.message ?? String(cause);
            warnings.push(`Стадия ${stage.name} упала: ${error}`);
            progress = recordStep(progress, {
                stage: stage.name,
                status: 'failed',
                report: error,
            });
            await writeProgress(root, config, run, progress);
            reports.push({ name: stage.name, status: 'failed', result: null, warnings: [error] });
            status = 'failed';
            break;
        }

        const stageWarnings = Array.isArray(result?.warnings) ? result.warnings : [];
        warnings.push(...stageWarnings.map((item) => `${stage.name}: ${item}`));
        const ok = result?.ok !== false;
        if (typeof stage.apply === 'function') stage.apply(ctx, result);

        progress = recordStep(progress, {
            stage: stage.name,
            status: ok ? 'completed' : 'failed',
            report: reportOf(result),
            files: pipelineFiles(result),
        });
        await writeProgress(root, config, run, progress);

        reports.push({ name: stage.name, status: ok ? 'completed' : 'failed', result, warnings: stageWarnings });
        notify({ type: 'stage.done', stage: stage.name, status: ok ? 'completed' : 'failed', result });

        if (!ok) {
            status = 'failed';
            break;
        }
        if (stopAfter && String(stopAfter).trim().toLowerCase() === stage.name) {
            paused = true;
            status = 'paused';
            warnings.push(`Прогон остановлен после стадии ${stage.name}.`);
            break;
        }
    }

    if (status === 'completed') progress = { ...progress, status: 'completed' };
    else if (paused) progress = { ...progress, status: 'paused' };
    else progress = { ...progress, status: 'failed' };

    const file = await writeProgress(root, config, run, progress);

    // The finished task goes into the memory of the project.
    const taskText = String(task ?? '').trim() || String(progress?.task ?? '').trim();
    if (memory && status === 'completed' && taskText) {
        try {
            memory.completeTask({
                task: taskText,
                runId: run,
                summary: String(ctx.plan?.summary ?? ''),
                files: (progress.files ?? []).map((file) => file.path),
            });
        } catch (cause) {
            warnings.push(`Задача не записана в память: ${cause?.message ?? cause}`);
        }
    }
    memory?.close?.();

    return {
        status,
        runId: run,
        stages: reports,
        progress,
        file,
        warnings,
        error,
    };
}

/**
 * Continue a run that was interrupted.
 *
 * @param {{ runId: string, client: object } & object} request the same request as `runPipeline`
 * @returns {Promise<object>} the report of the run
 * @exports
 * @ai.hint io
 */
export async function resumePipeline(request = {}) {
    return await runPipeline({ ...request, resume: true });
}

/**
 * The name of the stage a run continues at.
 * @param {object} progress
 * @param {object[]} [stages]
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export { resumeStageName } from './stages/index.js';
