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
 *          stages/collect, stages/pictures, stages/review, agent/work-plan, agent/context,
 *          agent/run-map
 * @usedBy cli, jobs/manager
 * @exports runPipeline, resumePipeline, pipelineFiles, filesAllowed
 * @ai.tags pipeline, orchestration, resume
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: оркестратор стадий и продолжение прогона.
 * @changed 2026-11-14 The stage of the pictures; the name of the stage to stop at is not case sensitive.
 * @changed 2026-11-14 A resumed run reads the collected inputs and the prepared pictures back.
 * @changed 2026-11-15 Прогон держит свой контекст и свою карту файлов.
 */

import { runId as makeRunId } from './stages/workspace.js';
import { enabledStages } from './stages/index.js';
import { readPlan } from './stages/plan.js';
import { readArchitecture } from './stages/architect.js';
import { readSetup } from './stages/setup.js';
import { readReview } from './stages/review.js';
import { readStepReports } from './stages/step.js';
import { readInputs } from './stages/collect.js';
import { collectInputs, mergeInputs } from './inputs/index.js';
import { readPictures } from './stages/pictures.js';
import { createProgress, recordStep, readProgress, writeProgress } from './agent/work-plan.js';
import { openMemory, memoryContext, memoryFile } from './memory.js';
import { defaultHome } from './config/paths.js';
import { openContext } from './agent/context.js';
import { openRunMap } from './agent/run-map.js';

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
 * Run a stage under the wall-clock budget of the run.
 *
 * A stage that never comes back is a silent death: the terminal waits and waits, and nothing
 * says that the run is over. The budget turns that silence into a failure with a name.
 *
 * @param {{ name: string, run: Function }} stage the stage to run
 * @param {object} args the arguments of the stage
 * @param {number} timeoutMs the budget of the stage, 0 for no budget
 * @returns {Promise<object>} the result of the stage
 * @exports
 * @ai.hint io
 */
export async function runStage(stage, args, timeoutMs = 0) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        return await stage.run(args);
    }
    let timer = null;
    const budget = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`Стадия ${stage.name} не закончилась за ${Math.round(timeoutMs / 1000)} с.`));
        }, timeoutMs);
    });
    try {
        return await Promise.race([stage.run(args), budget]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Run the stages of a run.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, runId?: string|null,
 *   stageNames?: string[]|null, requested?: string[]|null, stopAfter?: string|null,
 *   signal?: AbortSignal|null,
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
    requested = null,
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
    // The stages the user asked for by name: they run even when the progress of an
    // earlier run says that they are done. The stages that the route adds are only the
    // way to them.
    const asked = new Set((Array.isArray(requested) ? requested : [])
        .map((name) => String(name ?? '').trim().toLowerCase())
        .filter(Boolean));

    // The context of the run: what it did, what it decided and the answers it already has.
    //
    // The context is the primary knowledge of the run. The permanent memory of the project is
    // a different thing: a new run starts with a clean head, and an old run never gets in the
    // way of a new one.
    const runContext = await openContext({
        root,
        config,
        runId: run,
        enabled: config?.context?.enabled !== false,
        cache: config?.context?.cache !== false,
        maxBriefChars: config?.context?.maxBriefChars,
    });

    // The map of the run: the files of the working directory with their lines and their
    // symbols. The searches and the reads of the files the map knows do not touch the disk.
    const map = await openRunMap({
        root,
        config,
        runId: run,
        build: config?.map?.enabled !== false,
        depth: config?.map?.depth,
        maxFiles: config?.map?.maxFiles,
        maxFileBytes: config?.map?.maxFileBytes,
        maxLines: config?.map?.maxLines,
    });
    // The map hangs on the context: the tools of a role need both, and the role runner gets
    // the context alone.
    runContext.map = map;

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
        runContext,
        map,
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
        // The reports of the steps of the earlier run: the review judges the work of the
        // steps, and a continued run has to know what the steps did.
        ctx.reports.push(...await readStepReports(root, config, run));
    }

    const reports = [];
    let status = 'completed';
    let error = null;
    let paused = false;

    // The wall-clock budget of one stage. A stage that hangs fails loudly instead of waiting
    // for ever: the run says which stage it was and how long it waited.
    const stageTimeoutMs = Number.isSafeInteger(config?.limits?.stageTimeoutMs)
        ? config.limits.stageTimeoutMs
        : 0;

    /**
     * The budget of one stage. A stage may ask for a budget of its own: the review with a
     * repair reads every step, repairs what it finds and reads the repaired steps again,
     * and that takes longer than the stages that write the files.
     * @param {string} name
     * @returns {number}
     * @ai.hint pure
     */
    const budgetOf = (name) => {
        const own = config?.stages?.[name]?.timeoutMs;
        return Number.isSafeInteger(own) && own > 0 ? own : stageTimeoutMs;
    };

    for (const stage of list) {
        const record = done.get(stage.name);
        if (resume && record?.status === 'completed' && !asked.has(stage.name)) {
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
        } else if (resume && record?.status === 'completed' && asked.has(stage.name)) {
            // The stage was asked for by name: it runs again, even when the progress of
            // the earlier run says that it is done. The repair of the review needs it.
            warnings.push(`Стадия ${stage.name}: запрошена явно — стадия выполняется заново.`);
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
            result = await runStage(stage, args, budgetOf(stage.name));
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
            // The failed stage goes into the context of the run: the next run reads what
            // happened and does not look for the answer again.
            await runContext?.stage?.(stage.name, 'failed', error);
            break;
        }

        const stageWarnings = Array.isArray(result?.warnings) ? result.warnings : [];
        warnings.push(...stageWarnings.map((item) => `${stage.name}: ${item}`));
        const ok = result?.ok !== false;
        if (typeof stage.apply === 'function') stage.apply(ctx, result);

        // The files of the stage go into the map and into the context of the run: the next
        // stage finds them without looking for them.
        const written = pipelineFiles(result);
        await map?.updateMany?.(written).catch(() => {});
        for (const rel of written) {
            await runContext?.file?.(rel);
        }
        // The pictures of the run are named by their exact paths: a role that knows the path
        // does not go looking for the picture.
        const references = Array.isArray(ctx.inputs?.references) ? ctx.inputs.references : [];
        if (references.length) {
            await runContext?.references?.(references.map((item) => ({
                rel: String(item?.path ?? ''),
                kind: 'original',
            })));
        }

        progress = recordStep(progress, {
            stage: stage.name,
            status: ok ? 'completed' : 'failed',
            report: reportOf(result),
            files: pipelineFiles(result),
        });
        await writeProgress(root, config, run, progress);

        // The stage goes into the context of the run: the stages after it know what is done.
        await runContext?.stage?.(stage.name, ok ? 'done' : 'failed', reportOf(result));

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

    // The digest of the run: what a person reads after it. The context of the run is the
    // witness of what happened, and it dies with the run.
    await runContext?.digest?.().catch(() => {});
    await runContext?.close?.().catch(() => {});

    return {
        status,
        runId: run,
        stages: reports,
        progress,
        file,
        warnings,
        error,
        context: runContext?.rel ?? null,
        map: map?.rel ?? null,
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
