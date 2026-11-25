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
 * @changed 2026-11-15 Результат стадии применяется внутри защиты: стадия, чей результат не
 *                       применился, — это упавшая стадия, а не мёртвый прогон.
 * @changed 2026-11-15 Порядок стадий, которые делают шаги плана, задаёт сам план.
 * @changed 2026-11-25 Бюджет хода делится на число шагов стадии: восемь шагов одной
 *                       роли не стоят каждый по бюджету всей стадии.
 * @changed 2026-11-25 Бюджет и таймаут хода считаются по шагам стадии, а не по всем
 *                       шагам роли.
 */

import { runId as makeRunId } from './stages/workspace.js';
import { enabledStages } from './stages/index.js';
import { planOrder } from './stages/plan-order.js';
import { LIVE_ROLES, ROLE_STAGES, WRITE_ROLES, withoutForeignFiles } from './stages/roles.js';
import { isStateful } from './stages/stateful.js';
import { readPlan } from './stages/plan.js';
import { readScan } from './stages/scan.js';
import { readArchitecture } from './stages/architect.js';
import { readSetup } from './stages/setup.js';
import { readReview } from './stages/review.js';
import { readStepReports, stepsOfStage as stageStepsOf } from './stages/step.js';
import { readInputs } from './stages/collect.js';
import { collectInputs, mergeInputs } from './inputs/index.js';
import { readPictures } from './stages/pictures.js';
import { readAssets } from './stages/assets.js';
import { publishRun } from './stages/publish.js';
import { createProgress, recordStep, readProgress, writeProgress } from './agent/work-plan.js';
import { openMemory, memoryContext, memoryFile } from './memory.js';
import { defaultHome } from './config/paths.js';
import { openContext } from './agent/context.js';
import { openRunMap } from './agent/run-map.js';
import { connectMcpServers } from './agent/mcp.js';
import { connectDevTools, devToolsEnabled } from './agent/devtools.js';
import { ensurePage } from './stages/dev-server.js';

/**
 * Connect the MCP servers of the run.
 *
 * The servers of the config come first, the browser of the DevTools after them. A server
 * that cannot be started is a warning, not a crash: the run goes on with the tools it has.
 * @param {{ config?: object, env?: object, root?: string, warnings?: string[] }} request
 * @returns {Promise<object[]>} the connections
 * @exports
 * @ai.hint io
 */
export async function connectServers({ config = {}, env = process.env, root = process.cwd(), warnings = [] } = {}) {
    const connections = [];
    const configured = Array.isArray(config?.mcp?.servers) ? config.mcp.servers : [];
    if (configured.length) {
        for (const connection of await connectMcpServers(configured)) {
            if (connection.error) {
                warnings.push(`MCP-сервер ${connection.name}: ${connection.error}`);
                continue;
            }
            connections.push(connection);
        }
    }
    if (devToolsEnabled(config)) {
        const viewport = config?.browser?.viewport ?? {};
        try {
            const connection = await connectDevTools({
                config,
                env,
                root,
                width: Number.isSafeInteger(viewport.width) ? viewport.width : 1440,
                height: Number.isSafeInteger(viewport.height) ? viewport.height : 900,
            });
            if (connection?.error) {
                warnings.push(`Chrome DevTools MCP: ${connection.error}`);
            } else if (connection) {
                connections.push(connection);
            }
        } catch (error) {
            warnings.push(`Chrome DevTools MCP: ${error?.message ?? error}`);
        }
    }
    return connections;
}

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
 *
 * The result of a stage names its files in three ways: the list of the written paths, the
 * list under `applied` and the steps of the stage. A field that is not a list is not a list:
 * the run does not die because a stage answered in an unexpected shape.
 *
 * @param {object} result
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function pipelineFiles(result = {}) {
    const written = new Set();
    for (const item of Array.isArray(result?.applied?.written) ? result.applied.written : []) {
        written.add(String(item));
    }
    for (const item of Array.isArray(result?.files) ? result.files : []) {
        const rel = String(item?.path ?? item ?? '').trim();
        if (rel) written.add(rel);
    }
    for (const item of Array.isArray(result?.steps) ? result.steps : []) {
        for (const rel of Array.isArray(item?.applied?.written) ? item.applied.written : []) {
            written.add(String(rel));
        }
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
    // The warnings of a stage that failed are its reason: a stage that says what went
    // wrong is read, and a stage that says nothing is guessed at.
    const warnings = Array.isArray(result?.warnings) ? result.warnings.filter(Boolean) : [];
    if (warnings.length) return warnings.join('\n');
    const steps = Array.isArray(result?.steps) ? result.steps : [];
    return steps.map((step) => `${step?.step?.id ?? 'step'}: ${step?.summary ?? ''}`).join('\n');
}

/**
 * Run a stage under the wall-clock budget of the run.
 *
 * A stage that never comes back is a silent death: the terminal waits and waits, and nothing
 * says that the run is over. The budget turns that silence into a failure with a name.
 *
 * The budget also stops the work: the calls that are in flight are cancelled, so nothing is
 * written after the failure and no tokens are spent on a stage that is already dead.
 *
 * @param {{ name: string, run: Function }} stage the stage to run
 * @param {object} args the arguments of the stage
 * @param {number} timeoutMs the budget of the stage, 0 for no budget
 * @param {AbortController|null} [controller] the controller of the stage
 * @returns {Promise<object>} the result of the stage
 * @exports
 * @ai.hint io
 */
export async function runStage(stage, args, timeoutMs = 0, controller = null) {
    const work = Promise.resolve().then(() => stage.run(args));
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return await work;
    let timer = null;
    let expired = false;
    const budget = new Promise((_, reject) => {
        timer = setTimeout(() => {
            expired = true;
            // The work of the stage stops with its budget.
            try { controller?.abort?.(); } catch { /* the controller is already gone */ }
            reject(new Error(`Стадия ${stage.name} не закончилась за ${Math.round(timeoutMs / 1000)} с.`));
        }, timeoutMs);
    });
    try {
        return await Promise.race([work, budget]);
    } catch (error) {
        if (expired) {
            // The stage is given a moment to unwind: the files it wrote while it was
            // cancelled do not land after the failure.
            const grace = new Promise((resolve) => {
                const t = setTimeout(resolve, 2000);
                t.unref?.();
            });
            await Promise.race([work.catch(() => {}), grace]);
        }
        throw error;
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
 *   stages?: object[]|null, input?: object|null, plan?: object|null }} request
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
    input = null,
    plan = null,
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
    // The stages the run has started: a gate of the delegation looks at them, and a hand-over
    // that belongs to a stage that has not started stays closed.
    const startedStages = new Set();
    runContext.startedStages = startedStages;

    // The context of the run: every stage reads it and puts its result into it.
    const ctx = {
        client,
        config,
        root,
        task,
        runId: run,
        notify,
        env,
        input,
        inputs,
        memory: null,
        memoryText: '',
        apply: filesAllowed(config),
        plan: plan ?? null,
        scan: null,
        architecture: null,
        setup: null,
        build: null,
        pictures: [],
        assets: [],
        shots: [],
        pageLogs: [],
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

    // The MCP servers of the run: the servers of the config and the browser of the DevTools.
    // The connections live as long as the run does, and the roles reach them through the
    // context of the run.
    const mcp = await connectServers({ config, env, root, warnings });
    if (mcp.length) {
        runContext.mcp = mcp;
        ctx.mcp = mcp;
    }

    let progress = createProgress({ id: run, task, stages: list });
    const done = new Map((progress.stages ?? []).map((stage) => [stage.name, stage]));
    let livePage = null;
    // Страница с состоянием: стили идут до кода, и браузер поднимается только когда
    // скрипты уже написаны (см. стадию `styling` ниже).
    const statefulPage = isStateful({ config });

    if (resume) {
        const stored = await readProgress(root, config, run);
        if (stored) {
            progress = stored;
            for (const stage of progress.stages ?? []) {
                done.set(stage.name, stage);
                // The stages of the earlier run that really ran: a stage that was skipped by
                // the operator never started.
                if (['completed', 'partial', 'failed'].includes(stage.status)) startedStages.add(stage.name);
            }
        }
        // The task of the run belongs to the run: a continuation without a task of its own
        // works on the task of the earlier run.
        ctx.task = String(task ?? '').trim() || String(progress.task ?? '').trim();
        // The artifacts of the finished stages are read back, so the run continues with
        // the same plan and the same structure.
        ctx.plan = await readPlan(root, config, run);
        // План, который лежит на диске, мог быть составлен старой версией харнесса: роль
        // могла назвать файл, который принадлежит другой роли. Такой файл отдаётся
        // владельцу, иначе роль перепишет чужую работу.
        const clean = withoutForeignFiles(ctx.plan);
        if (clean.warnings.length) {
            warnings.push(...clean.warnings);
            ctx.plan = clean.plan;
        }
        ctx.scan = await readScan(root, config, run);
        ctx.architecture = await readArchitecture(root, config, run);
        ctx.setup = await readSetup(root, config, run);
        // The collected inputs and the prepared pictures too: the stages that are skipped
        // would otherwise leave the later stages with nothing.
        ctx.inputs = await readInputs(root, config, run);
        ctx.pictures = await readPictures(root, config, run);
        if (ctx.pictures.length && ctx.inputs) {
            ctx.inputs = { ...ctx.inputs, pictures: ctx.pictures };
        }
        // The placed assets too: the stage of the assets is skipped in a continued run, and
        // the markup after it links the final paths of the pictures.
        ctx.assets = await readAssets(root, config, run);
        if (ctx.assets.length && ctx.inputs) {
            ctx.inputs = { ...ctx.inputs, assets: ctx.assets };
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

    // The stages that are not the page: the crops of the reference, the vector graphics, the
    // assets, the motion, the icons and the look at the page. Their failure does not stop the
    // run — the files that landed on the disk stay, and the review says what is missing. The
    // stages of the page itself (the markup, the styles, the code, the build) still stop it:
    // the rest of the chain would work against a page that does not exist. The tail of the
    // run (the review, the audit, the lessons) is non-fatal as well: the project is written,
    // and a run without a verdict is partial, not lost.
    const NON_FATAL_STAGES = new Set([
        'pictures', 'vector', 'assets', 'iconify', 'sight',
        'review', 'audit', 'learn',
    ]);

    /**
     * Сколько шагов плана делает одна стадия.
     *
     * Стадия берёт шаги своей роли: `markup` — шаги `markup`, `styling` — шаги `styler`.
     * Стадия без шагов своей роли (обрезки, ассеты, сборка) делает один шаг работы.
     *
     * Считать надо ровно те шаги, что берёт стадия, иначе бюджет и таймаут хода
     * считаются не по той работе.
     * @param {string} name имя стадии
     * @param {object|null} plan план прогона
     * @returns {number}
     * @ai.hint pure
     */
    const stepsOfStage = (name, plan = null) => {
        const role = roleByStage[name];
        if (!role) return 1;
        // Стадия письма берёт шаги всех ролей письма: разметки, стилей, кода и
        // движения. Роль у неё одна, а шагов — много, и бюджет считается по ним.
        if (name === 'write') {
            const steps = Array.isArray(plan?.steps) ? plan.steps : [];
            const mine = steps.filter((step) => WRITE_ROLES.has(String(step?.role ?? '').trim().toLowerCase()));
            return Math.max(1, mine.length);
        }
        return Math.max(1, stageStepsOf(plan, role, name).length);
    };

    /**
     * The budget of one stage. A stage may ask for a budget of its own: the review with a
     * repair reads every step, repairs what it finds and reads the repaired steps again,
     * and that takes longer than the stages that write the files.
     *
     * A stage with many steps of one role needs a budget for all of them: the styles of a
     * whole landing are three шага, и пятнадцати минут на все три не хватает. Бюджет
     * стадии умножается на число её шагов — иначе последний шаг стадии никогда не
     * начинается, а прогон стоит.
     * @param {string} name
     * @param {object|null} [plan] the plan of the run
     * @returns {number}
     * @ai.hint pure
     */
    const budgetOf = (name, plan = null) => {
        const own = config?.stages?.[name]?.timeoutMs;
        const base = Number.isSafeInteger(own) && own > 0 ? own : stageTimeoutMs;
        if (base <= 0) return base;
        const steps = stepsOfStage(name, plan);
        // Три шага — тройной бюджет, но не больше: стадия с двадцатью шагами не должна
        // съесть весь прогон.
        return base * Math.min(steps, 3);
    };

    /**
     * Где именно прогон встал: стадия, шаг, ход и инструмент.
     *
     * Прогон, который остановили, должен сказать, на чём он стоял. «Он завис» — это не
     * ответ: шаг и ход — ответ.
     * @param {string} stage имя стадии
     * @param {object} ctx контекст прогона
     * @returns {string} короткое описание места, или пустая строка
     */
    const lastPlace = (stage, context) => {
        const reports = Array.isArray(context?.reports) ? context.reports : [];
        const last = reports[reports.length - 1] ?? null;
        const step = String(last?.step?.id ?? '').trim();
        const turn = Number.isInteger(last?.turns) ? last.turns : null;
        const tool = String(last?.last?.tool ?? '').trim();
        const bits = [];
        if (step) bits.push(`шаг ${step}`);
        if (turn) bits.push(`ход ${turn}`);
        if (tool) bits.push(`инструмент ${tool}`);
        return bits.length ? bits.join(', ') : '';
    };

    // Очередь стадий. План может изменить порядок стадий, которые делают его шаги, а план
    // известен только после стадии `plan`: очередь пересобирается, когда план прочитан.
    const queue = [...list];
    let position = 0;
    let ordered = false;
    const pendingSkips = new Set();
    const roleStages = { ...LIVE_ROLES };
    // Стадия — и роль, чьи шаги она делает: по ней считается бюджет стадии. У роли
    // может быть несколько стадий (черновик контракта и полная работа), и бюджет у
    // них общий: это работа одной роли, разбитая на заходы.
    const roleByStage = {};
    for (const [role, stages] of Object.entries(ROLE_STAGES)) {
        for (const stage of stages) roleByStage[stage] = role;
    }
    for (const [role, stage] of Object.entries(roleStages)) roleByStage[stage] ??= role;
    const drainNamedSkips = () => {
        for (const item of input?.takePendingSkips?.({ namedOnly: true }) ?? []) {
            const name = String(item?.target ?? '').toLowerCase();
            if (!name) continue;
            if (list.some((candidate) => candidate.name === name)) pendingSkips.add(name);
            else if (ctx.plan?.steps?.some((step) => String(step.id).toLowerCase() === name)) input?.queueStepSkip?.(name);
            else if (roleStages[name] && list.some((candidate) => candidate.name === roleStages[name])) {
                // Пропуск роли пропускает все её стадии: черновик контракта и полная
                // работа — это работа одной роли, и половина её не имеет смысла.
                for (const step of ctx.plan?.steps?.filter((candidate) => candidate.role === name) ?? []) {
                    input?.queueStepSkip?.(step.id);
                }
                for (const stage of ROLE_STAGES[name] ?? []) {
                    if (list.some((candidate) => candidate.name === stage)) pendingSkips.add(stage);
                }
            }
        }
    };
    const forwardNotify = notify;
    notify = (event) => {
        if (event?.type === 'role.done') drainNamedSkips();
        forwardNotify?.(event);
    };
    ctx.notify = notify;

    while (position < queue.length) {
        if (!ordered && ctx.plan) {
            // План решает, какая стадия идёт раньше: шаг, который зависит от другого шага,
            // делается после него.
            ordered = true;
            const rest = queue.slice(position);
            const planned = planOrder(rest, ctx.plan, { config });
            queue.splice(position, rest.length, ...planned.stages);
            warnings.push(...planned.warnings);
        }
        const stage = queue[position];
        position += 1;

        input?.setLocation?.({ stage: stage.name });
        drainNamedSkips();
        const where = input?.location?.();
        const currentSkip = where?.stage === stage.name && !where?.step ? input?.takeCurrentSkip?.() : null;
        const exactStageSkip = input?.takeSkip?.({ stage: stage.name });
        const roleForStage = roleByStage[stage.name];
        const exactRoleSkip = roleForStage ? input?.takeSkip?.({ stage: roleForStage }) : null;
        if (currentSkip || exactStageSkip || exactRoleSkip || pendingSkips.has(stage.name)) {
            pendingSkips.delete(stage.name);
            const reason = 'Skipped by the operator.';
            progress = recordStep(progress, { stage: stage.name, status: 'skipped', report: reason });
            await writeProgress(root, config, run, progress);
            await runContext?.stage?.(stage.name, 'skipped', reason);
            reports.push({ name: stage.name, status: 'skipped', result: null, warnings: [] });
            notify({ type: 'stage.skip', stage: stage.name, status: 'skipped' });
            continue;
        }
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
        } else if (resume && record?.status === 'skipped') {
            reports.push({ name: stage.name, status: 'skipped', result: null, warnings: [] });
            notify({ type: 'stage.skip', stage: stage.name, status: 'skipped' });
            continue;
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

        // DevTools connects before the project is set up and therefore starts on about:blank.
        // Start the project's own dev script only when a stage is about to hand work to a
        // browser-aware role, then give that role the ready address to navigate to.
        //
        // На странице с состоянием (SPA, PWA, роутер) стили идут ДО кода: скриптов ещё
        // нет, и страница, на которую поведут стилиста, пустая. Он увидит пустоту и
        // начнёт чинить то, что не сломано, — поэтому браузер поднимается только когда
        // скрипты уже написаны.
        const hasDevTools = (ctx.mcp ?? []).some((connection) => connection.name === 'chrome-devtools');
        const browserStages = statefulPage
            ? ['write', 'sight']
            : ['write'];
        if (!livePage && hasDevTools && browserStages.includes(stage.name)) {
            try {
                livePage = await ensurePage({
                    root,
                    config,
                    env,
                    timeoutMs: Number.isSafeInteger(config?.browser?.devTimeoutMs)
                        ? config.browser.devTimeoutMs
                        : 60_000,
                });
                runContext.browserUrl = livePage.live ? livePage.url : null;
                for (const connection of ctx.mcp ?? []) {
                    if (connection.name === 'chrome-devtools') connection.projectUrl = runContext.browserUrl;
                }
                if (livePage.reason) warnings.push(`Страница для Chrome DevTools недоступна: ${livePage.reason}.`);
            } catch (error) {
                livePage = { url: null, live: false, stop: async () => {} };
                runContext.browserUrl = null;
                warnings.push(`Страница для Chrome DevTools недоступна: ${error?.message ?? error}.`);
            }
        }

        notify({ type: 'stage.start', stage: stage.name, title: stage.title });
        input?.setLocation?.({ stage: stage.name });
        // The stage starts now: the gates of the delegation look at this list.
        startedStages.add(stage.name);
        // The stage has its own controller: the budget of the stage stops its work, and the
        // work of the run stops with it.
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        if (signal?.aborted) controller.abort();
        else signal?.addEventListener('abort', onAbort, { once: true });
        const budget = budgetOf(stage.name, ctx.plan);
        ctx.signal = controller.signal;
        ctx.deadline = budget > 0 ? Date.now() + budget : null;
        // The limit of one turn: a part of the budget of the stage. A host that says nothing
        // longer than that loses the turn, and the stage says which turn it was — instead of
        // the whole stage standing still until the budget is over.
        // Бюджет делится на шаги стадии: восемь шагов кодера не могут стоять по
        // бюджету одного шага каждый. Иначе ход каждого шага получал бы весь бюджет
        // стадии, и восемь шагов по двенадцать ходов стоили бы девять часов — прогон
        // «тратил все бюджеты», не дойдя до конца.
        const stageSteps = stepsOfStage(stage.name, ctx.plan);
        ctx.turnTimeoutMs = budget > 0
            ? Math.max(60_000, Math.round(budget / Math.max(stageSteps, 1) / 8))
            : null;
        let result = null;
        try {
            const args = typeof stage.args === 'function' ? { ...ctx, ...stage.args(ctx) } : ctx;
            result = await runStage(stage, args, budget, controller);
            // The result of the stage goes into the context of the next stages. A stage whose
            // result cannot be applied is a failed stage: the run says so and stops, instead
            // of dying with a message that names nothing.
            if (typeof stage.apply === 'function') stage.apply(ctx, result);
        } catch (cause) {
            error = cause?.message ?? String(cause);
            warnings.push(`Стадия ${stage.name} упала: ${error}`);
            if (signal?.aborted) {
                paused = true;
                status = 'paused';
                // Где именно прогон встал: стадия, шаг, ход и инструмент. «Он завис» —
                // это не ответ, а шаг и ход — ответ.
                const where = lastPlace(stage.name, ctx);
                progress = recordStep(progress, { stage: stage.name, status: 'pending', report: error });
                await writeProgress(root, config, run, progress);
                reports.push({ name: stage.name, status: 'paused', result: null, warnings: [error] });
                notify({ type: 'stage.done', stage: stage.name, status: 'paused', result: null });
                warnings.push(where
                    ? `Прогон остановлен на стадии ${stage.name}: ${where}.`
                    : `Прогон остановлен на стадии ${stage.name}.`);
                break;
            }
            progress = recordStep(progress, {
                stage: stage.name,
                status: 'failed',
                report: error,
            });
            await writeProgress(root, config, run, progress);
            reports.push({ name: stage.name, status: 'failed', result: null, warnings: [error] });
            // The failed stage goes into the context of the run: the next run reads what
            // happened and does not look for the answer again.
            await runContext?.stage?.(stage.name, 'failed', error);
            if (!NON_FATAL_STAGES.has(stage.name)) {
                status = 'failed';
                break;
            }
            // The decorations are not the page: картинка, иконка или анимация, которая не
            // дорисовалась, не отменяет разметку, стили и код. Файлы, что успели лечь на
            // диск, остаются, прогон идёт дальше, а ревью говорит, чего не хватает.
            status = 'partial';
            warnings.push(`Стадия ${stage.name} не закончилась (${error}) — прогон идёт дальше: `
                + 'то, что успело лечь на диск, остаётся.');
            notify({ type: 'stage.done', stage: stage.name, status: 'failed', result: null });
            continue;
        } finally {
            signal?.removeEventListener('abort', onAbort);
        }

        const stageWarnings = Array.isArray(result?.warnings) ? result.warnings : [];
        warnings.push(...stageWarnings.map((item) => `${stage.name}: ${item}`));
        const operatorPartial = result?.partial === true
            || (Array.isArray(result?.steps) && result.steps.some((step) => step?.skipped === true));
        const ok = result?.ok !== false;
        // A step the operator skipped is not a failure of the stage: the stage is partial,
        // and the run goes on to the next stage. Only a stage that failed on its own stops
        // the run.
        const failed = !ok && !operatorPartial;

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
            status: operatorPartial ? 'partial' : (ok ? 'completed' : 'failed'),
            report: operatorPartial ? 'One or more steps were skipped by the operator.' : reportOf(result),
            files: pipelineFiles(result),
        });
        await writeProgress(root, config, run, progress);

        // The stage goes into the context of the run: the stages after it know what is done.
        await runContext?.stage?.(stage.name, operatorPartial ? 'partial' : (ok ? 'done' : 'failed'), reportOf(result));

        reports.push({ name: stage.name, status: operatorPartial ? 'partial' : (ok ? 'completed' : 'failed'), result, warnings: stageWarnings });
        notify({ type: 'stage.done', stage: stage.name, status: operatorPartial ? 'partial' : (ok ? 'completed' : 'failed'), result });

        if (failed) {
            // Провал оформления не отменяет страницу: картинка, иконка или анимация, что не
            // доделалась, не отменяет разметку, стили и код. Файлы, что успели лечь на
            // диск, остаются, прогон идёт дальше, а ревью говорит, чего не хватает.
            if (!NON_FATAL_STAGES.has(stage.name)) {
                status = 'failed';
                break;
            }
            status = 'partial';
            warnings.push(`Стадия ${stage.name} не закончилась — прогон идёт дальше: то, что `
                + 'успело лечь на диск, остаётся, а ревью скажет, чего не хватает.');
        }
        if (stopAfter && String(stopAfter).trim().toLowerCase() === stage.name) {
            paused = true;
            status = 'paused';
            warnings.push(`Прогон остановлен после стадии ${stage.name}.`);
            break;
        }
    }

    if (status === 'completed' && (progress.stages ?? []).some((item) => ['skipped', 'partial'].includes(item.status))) status = 'partial';
    if (status === 'completed') progress = { ...progress, status: 'completed' };
    else if (paused) progress = { ...progress, status: 'paused' };
    else if (status === 'partial') progress = { ...progress, status: 'partial' };
    else progress = { ...progress, status: 'failed' };

    const file = await writeProgress(root, config, run, progress);

    // The contract of the project: what this run made and where it lies. The other systems
    // of the house read it to find the work of this one.
    try {
        await publishRun(root, config, progress);
    } catch (cause) {
        warnings.push(`Контракт проекта не записан: ${cause?.message ?? cause}`);
    }

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

    // The MCP servers of the run are closed with it: a server of the browser holds a
    // browser, and the browser holds a profile.
    for (const connection of ctx.mcp ?? []) {
        await connection?.close?.().catch(() => {});
    }
    await livePage?.stop?.().catch(() => {});

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
