/**
 * @file src/cli/run.js
 * @module cli/run
 * @purpose The commands of the run: `run`, `plan` and `stages`.
 *
 *   `run` takes the task through the whole pipeline of the stages, `plan` stops after
 *   the plan and shows it, `stages` shows the stages themselves. The flags of the
 *   command are the knobs of the config: they win over the config file for this run
 *   only.
 *
 * @depends cli/errors, cli/renderer, openai/client, pipeline, stages/index
 * @usedBy cli
 * @exports runCommand, planCommand, stagesCommand, configOverrides, parseRoleSpecs,
 *          routeStages, requestedStages, expandRoute, stageFiles, stageReportText
 * @ai.tags cli, run, pipeline
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the flags of the run and the dispatch.
 * @changed 2026-11-15 The files of a stage are read as lists: a field of another shape is not
 *                       a list, and the run does not die about it.
 */

import { createClient } from '../openai/client.js';
import { runPipeline, resumePipeline } from '../pipeline.js';
import { STAGES, STAGE_NAMES, stageByName, stageDependencies, enabledStages } from '../stages/index.js';
import { runId as makeRunId } from '../stages/workspace.js';
import { ENUMS } from '../config/constants.js';
import { stageReferences } from '../generate/references.js';
import { UsageError } from './errors.js';

/**
 * The kind of the task and the task itself.
 *
 * A leading token that names a kind is the kind of the run: `ai-webdev run landing "сделать"`
 * is the same as `ai-webdev run --kind landing "сделать"`. The flag wins over the token.
 * @param {string[]} [args] the positional arguments of the command
 * @param {Record<string, string|boolean|string[]>} [flags] the flags of the command
 * @returns {{ kind: string|null, task: string }}
 * @exports
 * @ai.hint pure
 */
export function splitKind(args = [], flags = {}) {
    const list = Array.isArray(args) ? args.map((item) => String(item)) : [];
    const flag = typeof flags?.kind === 'string' ? flags.kind.trim() : '';
    const first = (list[0] ?? '').trim().toLowerCase();
    if (ENUMS.generationKinds.includes(first)) {
        return { kind: flag || first, task: list.slice(1).join(' ').trim() };
    }
    return { kind: flag || null, task: list.join(' ').trim() };
}

/**
 * A flag as a string. A flag without a value is a mistake: the name says what it wants.
 *
 * @param {Record<string, string|boolean|string[]>} flags
 * @param {string} name
 * @param {string[]|null} [allowed]
 * @returns {string|null}
 * @ai.hint pure
 */
function stringFlag(flags, name, allowed = null) {
    const raw = flags?.[name];
    if (raw === undefined || raw === null) return null;
    if (raw === true) throw new UsageError(`--${name}: нужно значение.`);
    const value = String(raw).trim();
    if (!value) throw new UsageError(`--${name}: нужно значение.`);
    if (allowed && !allowed.includes(value)) {
        throw new UsageError(`--${name}: ${allowed.join(' | ')}.`);
    }
    return value;
}

/**
 * A flag as an integer of a range.
 *
 * @param {Record<string, string|boolean|string[]>} flags
 * @param {string} name
 * @param {{ min?: number, max?: number }} [range]
 * @returns {number|null}
 * @ai.hint pure
 */
function intFlag(flags, name, { min = 0, max = 100 } = {}) {
    const raw = flags?.[name];
    if (raw === undefined || raw === null) return null;
    if (raw === true) throw new UsageError(`--${name}: нужно число.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new UsageError(`--${name}: целое ${min}..${max}.`);
    }
    return value;
}

/**
 * The value of a flag as a list: a flag may be given many times.
 *
 * @param {unknown} value
 * @returns {string[]}
 * @ai.hint pure
 */
function asList(value) {
    if (value === undefined || value === null) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => String(item));
}

/**
 * A flag as a list of paths: the flag may be given many times.
 *
 * A flag without a value is a mistake: the name says what it wants.
 * @param {Record<string, string|boolean|string[]>} flags
 * @param {string} name
 * @returns {string[]}
 * @ai.hint pure
 */
function pathListFlag(flags, name) {
    const raw = flags?.[name];
    if (raw === undefined || raw === null) return [];
    if (raw === true) throw new UsageError(`--${name}: нужно значение.`);
    return asList(raw).map((item) => item.trim()).filter(Boolean);
}

/**
 * The specs of the roles: `name=model[:effort[:max-effort]]`.
 *
 * A model that names a family or a group of models (`family:gpt`, `group:small`) keeps its
 * prefix: the colon of the name is not the separator of the effort.
 * @param {unknown} value the value of the flag `--role`
 * @returns {{ name: string, model: string, effort: string, maxEffort: string }[]}
 * @exports
 * @ai.hint pure
 */
export function parseRoleSpecs(value) {
    const out = [];
    for (const item of asList(value)) {
        for (const part of item.split(',')) {
            const text = part.trim();
            if (!text) continue;
            const at = text.indexOf('=');
            if (at <= 0) {
                throw new UsageError(`--role: ожидается роль=модель[:effort[:max-effort]], получено "${text}".`);
            }
            const name = text.slice(0, at).trim();
            const rest = text.slice(at + 1).trim();
            const lower = rest.toLowerCase();
            const prefix = lower.startsWith('family:') ? 'family:' : (lower.startsWith('group:') ? 'group:' : '');
            const parts = (prefix ? rest.slice(prefix.length) : rest).split(':').map((part) => part.trim());
            const model = prefix ? `${prefix}${parts[0] ?? ''}` : (parts[0] ?? '');
            const effort = parts[1] ?? '';
            const maxEffort = parts[2] ?? '';
            if (!name) throw new UsageError('--role: имя роли не может быть пустым.');
            out.push({ name, model, effort, maxEffort });
        }
    }
    return out;
}

/**
 * The config the flags of the command ask for.
 *
 * The result is merged over the config file: the flags win, but only for this run.
 *
 * @param {Record<string, string|boolean|string[]>} [flags]
 * @returns {object} the overrides of the config
 * @exports
 * @ai.hint pure
 */
export function configOverrides(flags = {}) {
    const overrides = {};

    /**
     * Put one value into a section of the overrides.
     * @param {string} section
     * @param {string} key
     * @param {unknown} value
     * @returns {void}
     */
    const put = (section, key, value) => {
        if (value === null || value === undefined) return;
        overrides[section] = { ...(overrides[section] ?? {}), [key]: value };
    };

    put('pace', 'speed', intFlag(flags, 'pace'));
    put('pace', 'quality', intFlag(flags, 'quality'));
    put('agent', 'fidelity', intFlag(flags, 'fidelity'));
    put('agent', 'creativity', intFlag(flags, 'creativity'));
    put('agent', 'platform', stringFlag(flags, 'platform'));
    put('agent', 'kind', stringFlag(flags, 'kind'));
    put('agent', 'approve', stringFlag(flags, 'approve', ['ask', 'read', 'write', 'all']));
    put('agent', 'extract', stringFlag(flags, 'extract', ['off', 'auto', 'always']));
    put('stack', 'frontendFramework', stringFlag(flags, 'frontend-framework'));
    put('stack', 'markupLanguage', stringFlag(flags, 'frontend-markup-language'));
    put('stack', 'styleLanguage', stringFlag(flags, 'frontend-style-language'));
    put('stack', 'scriptLanguage', stringFlag(flags, 'frontend-script-language'));
    put('stack', 'iconSet', stringFlag(flags, 'icon-set'));
    put('reasoning', 'effort', stringFlag(flags, 'effort'));
    put('reasoning', 'summary', stringFlag(flags, 'summary', ['auto', 'concise', 'detailed', 'none']));

    // The essence of the task: the files the run reads before it starts.
    const essence = pathListFlag(flags, 'input');
    if (essence.length) put('inputs', 'extra', essence);
    // The pictures of the task are staged by the run itself: the flag is only checked here.
    pathListFlag(flags, 'image');

    const model = stringFlag(flags, 'model');
    if (model) overrides.model = model;

    const roles = { ...(overrides.roles ?? {}) };
    for (const spec of parseRoleSpecs(flags.role)) {
        const entry = { ...(roles[spec.name] ?? {}) };
        if (spec.model) entry.model = spec.model;
        if (spec.effort) entry.effort = spec.effort;
        if (spec.maxEffort) entry.maxEffort = spec.maxEffort;
        roles[spec.name] = entry;
    }
    const context = stringFlag(flags, 'context');
    if (context) {
        roles.default = { ...(roles.default ?? {}), context };
    }
    if (Object.keys(roles).length) overrides.roles = roles;

    return overrides;
}

/**
 * The stages of the route, with the stages they need.
 *
 * @param {string[]} names the names of the stages of the route
 * @returns {string[]} the names in the order of the registry
 * @ai.hint pure
 */
export function expandRoute(names = []) {
    const wanted = new Set();
    const visit = (name) => {
        const key = String(name ?? '').trim().toLowerCase();
        if (!key || wanted.has(key)) return;
        wanted.add(key);
        for (const dependency of stageDependencies(key)) visit(dependency);
    };
    for (const name of names) visit(name);
    const known = STAGES.map((stage) => stage.name).filter((name) => wanted.has(name));
    const unknown = [...wanted].filter((name) => !known.includes(name));
    if (unknown.length) {
        throw new UsageError(`--route: неизвестные стадии: ${unknown.join(', ')}.`);
    }
    return known;
}

/**
 * The names of the stages of the route of the flags.
 *
 * @param {Record<string, string|boolean|string[]>} flags
 * @returns {string[]|null} null when the run takes the whole pipeline
 * @ai.hint pure
 */
export function routeStages(flags = {}) {
    const raw = flags?.route;
    if (raw === undefined || raw === null || raw === true) return null;
    const names = asList(raw).flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
    if (!names.length) throw new UsageError('--route: нужно имя стадии.');
    return expandRoute(names);
}

/**
 * The stages the user asked for, without the stages they need.
 *
 * A stage that is named in the route is asked for: it runs even when the progress of an
 * earlier run says that it is done. The stages that the route adds are only the way to
 * it, and they are skipped when their work is still on the disk.
 * @param {Record<string, string|boolean|string[]>} flags
 * @returns {string[]} the names of the stages, empty when the route is not given
 * @ai.hint pure
 */
export function requestedStages(flags = {}) {
    const raw = flags?.route;
    if (raw === undefined || raw === null || raw === true) return [];
    const names = asList(raw)
        .flatMap((item) => item.split(','))
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    const known = names.filter((name) => STAGE_NAMES.includes(name));
    const unknown = names.filter((name) => !STAGE_NAMES.includes(name));
    if (unknown.length) {
        throw new UsageError(`--route: неизвестные стадии: ${unknown.join(', ')}.`);
    }
    return known;
}

/**
 * The stage the run stops at.
 *
 * The name of the stage is checked against the stages the run really goes through: a stage
 * that is not in the route, or that is switched off in the config, would never be reached,
 * and the run would go on as if the flag were not there.
 *
 * @param {Record<string, string|boolean|string[]>} flags the flags of the command
 * @param {string[]|null} [stages] the stages of the route, or null for all of them
 * @param {object} [config] the config of the run
 * @returns {string|null} the name of the stage
 * @exports
 * @ai.hint pure
 */
export function stopAfterStage(flags, stages = null, config = {}) {
    const raw = stringFlag(flags, 'stop-after');
    if (!raw) return null;
    const name = raw.trim().toLowerCase();
    if (!stageByName(name)) {
        throw new UsageError(`--stop-after: неизвестная стадия "${raw}" (доступны: ${STAGE_NAMES.join(', ')}).`);
    }
    const planned = enabledStages(config, stages).stages.map((stage) => stage.name);
    if (!planned.includes(name)) {
        throw new UsageError(`--stop-after: стадия "${name}" не входит в этот прогон (в маршруте: ${planned.join(', ')}).`);
    }
    return name;
}

/**
 * The files a stage has written.
 *
 * A field that is not a list is not a list: the run does not die because a stage answered in
 * an unexpected shape.
 *
 * @param {object} result
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function stageFiles(result = {}) {
    const out = new Set();
    for (const item of Array.isArray(result?.applied?.written) ? result.applied.written : []) {
        out.add(String(item));
    }
    for (const item of Array.isArray(result?.steps) ? result.steps : []) {
        for (const rel of Array.isArray(item?.applied?.written) ? item.applied.written : []) {
            out.add(String(rel));
        }
    }
    return [...out];
}

/**
 * The text of the report of a stage: the report itself or the summaries of its steps.
 *
 * @param {object} result
 * @returns {string}
 * @ai.hint pure
 */
export function stageReportText(result = {}) {
    const text = String(result?.text ?? '').trim();
    if (text) return text;
    const steps = Array.isArray(result?.steps) ? result.steps : [];
    return steps
        .map((step) => `${step?.step?.id ?? ''}: ${step?.summary ?? ''}`.trim())
        .filter(Boolean)
        .join('\n');
}

/**
 * The command that continues a run.
 *
 * A run that fell has to be continued, and the command of the continuation repeats everything
 * the run needs: the config, the essence of the task, the picture of the task, the kind and
 * the model. The id is the name of the run: the stages that are done are skipped, and the
 * stage that fell is done again.
 * @param {{ runId?: string, flags?: Record<string, any>, configPath?: string|null }} options
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function resumeCommand({ runId = '', flags = {}, configPath = null } = {}) {
    const id = String(runId ?? '').trim();
    if (!id) return '';
    const parts = ['ai-webdev', 'run', '--resume', id];
    const config = configPath ?? stringFlag(flags, 'config');
    if (config) parts.push('--config', String(config));
    for (const name of ['input', 'image']) {
        for (const item of pathListFlag(flags, name)) parts.push(`--${name}`, item);
    }
    const kind = stringFlag(flags, 'kind');
    if (kind) parts.push('--kind', kind);
    const model = stringFlag(flags, 'model');
    if (model) parts.push('--model', model);
    const effort = stringFlag(flags, 'effort');
    if (effort) parts.push('--effort', effort);
    return parts.join(' ');
}

/**
 * Run the pipeline of the stages.
 *
 * @param {{ config: object, cwd: string, args?: string[], flags?: object, renderer?: object,
 *   env?: object }} ctx
 * @returns {Promise<number>} the exit code
 * @exports
 * @ai.hint io
 */
export async function runCommand(ctx) {
    const { config, cwd, args = [], flags = {}, renderer = null, env = process.env } = ctx;
    const { kind, task: argTask } = splitKind(args, flags);
    const stdinText = String(ctx.stdinText ?? '').trim();
    const input = renderer?.input ?? null;
    let inputWait = null;
    const taskWithContext = argTask && stdinText ? `${argTask}\n\n--- stdin context ---\n${stdinText}` : (argTask || stdinText);
    if (kind && config?.agent) config.agent.kind = kind;
    if (flags.resume === true) {
        throw new UsageError('--resume: нужен идентификатор прогона.');
    }
    const resumeId = flags.resume === undefined || flags.resume === null
        ? null
        : String(flags.resume).trim();
    if (!taskWithContext && !resumeId && !input) {
        throw new UsageError('Укажите задачу: ai-webdev run "сделать лендинг".');
    }
    const resolvedTask = taskWithContext || (input && !resumeId ? await input.prompt('Task') : '');
    if (!resolvedTask && !resumeId) throw new UsageError('Укажите задачу: ai-webdev run "сделать лендинг".');
    input?.setLocation?.({ stage: 'run', mode: 'interactive', model: config?.model ?? '' });
    if (input?.interactive && resolvedTask) {
        inputWait = input.waitForQuit();
    }

    const stages = routeStages(flags);
    const requested = requestedStages(flags);
    const stopAfter = stopAfterStage(flags, stages, config);
    // The id of the run is made here, not in the pipeline: the run has to name itself before
    // the first stage, so that a run that falls can be continued by its id.
    const runId = stringFlag(flags, 'id') ?? resumeId ?? makeRunId();

    const controller = new AbortController();
    const onInterrupt = () => controller.abort();
    process.on('SIGINT', onInterrupt);


    // The pictures of the task are staged in the project and become the references of the
    // run: the roles that look at the design see them.
    const images = pathListFlag(flags, 'image');
    const cleanupInput = () => { input?.close?.(); };
    process.once('exit', cleanupInput);
    if (images.length) {
        const staged = await stageReferences({
            images,
            root: cwd,
            maxBytes: 20 * 1024 * 1024,
            signal: controller.signal,
        });
        for (const warning of staged.warnings ?? []) renderer?.warning?.(warning);
        const rels = (staged.refs ?? []).map((item) => String(item?.rel ?? '')).filter(Boolean);
        if (rels.length) {
            const current = config?.inputs?.reference ?? null;
            const list = Array.isArray(current)
                ? current.map((item) => String(item))
                : (typeof current === 'string' && current.trim() ? [current.trim()] : []);
            config.inputs = { ...(config.inputs ?? {}), reference: [...list, ...rels] };
        }
    }

    const notify = (event) => {
        if (event?.type === 'stage.start') input?.setLocation({ stage: event.stage });
        renderer?.event?.(event);
        if (event?.type === 'stage.done' && event.stage === 'plan' && event.result?.plan) {
            renderer?.plan?.(event.result.plan);
        }
        if (event?.type === 'stage.done') {
            const files = stageFiles(event.result);
            if (files.length) renderer?.files?.(files);
            if (renderer?.verbose) {
                const report = stageReportText(event.result);
                if (report) renderer?.note?.(report);
            }
        }
    };
    // The run names itself before the first stage: a run that falls or is closed can be
    // continued by its id, and the id has to be known before it falls.
    renderer?.note?.(`Run ${runId}`);
    // The events of the transport reach the renderer: the wait of a thinking model, the
    // retries of a failed host.
    const client = await createClient({ config, env, root: cwd, signal: controller.signal, onEvent: notify });

    try {
        const request = {
            client,
            config,
            root: cwd,
            task: resolvedTask,
            input,
            runId,
            stageNames: stages,
            requested,
            stopAfter,
            signal: controller.signal,
            notify,
            env,
        };
        const report = resumeId
        ? await resumePipeline(request)
        : await runPipeline(request);

        if (input?.interactive && report.status === 'completed') {
            input.setStatus('completed · /quit to close');
        }
        if (input?.interactive && report.status === 'completed') {
            inputWait = input.waitForQuit();
            await inputWait;
        }

        for (const warning of report.warnings ?? []) renderer?.warning?.(warning);
        renderer?.progress?.(report.progress);
        renderer?.summary?.(report);
        if (report.status === 'failed' || report.status === 'partial') {
            // A fallen run is continued, not started again: the command of the continuation
            // is named with everything the run needs.
            const command = resumeCommand({
                runId: report.runId ?? runId,
                flags,
                configPath: stringFlag(flags, 'config'),
            });
            if (command) renderer?.note?.(`Продолжить: ${command}`);
            return 1;
        }
        if (report.status === 'paused') {
            const interrupted = controller.signal.aborted;
            renderer?.note?.(interrupted
                ? `Прогон прерван во время стадии «${report.progress?.stage ?? 'unknown'}». Продолжить: ai-webdev run --resume ${report.runId}`
                : `Прогон приостановлен. Продолжить: ai-webdev run --resume ${report.runId}`);
            if (!interrupted && input?.interactive) {
                inputWait = input.waitForQuit();
                await inputWait;
            }
            return interrupted ? EXIT.aborted : EXIT.ok;
        }
        if (controller.signal.aborted) return 130;
        return 0;
    } finally {
        process.off('SIGINT', onInterrupt);
        process.removeListener('exit', cleanupInput);
        input?.close?.();
        if (inputWait) await inputWait.catch(() => {});
        client.close?.();
    }
}

/**
 * Plan the work and show the plan: the run stops after the stage of the plan.
 *
 * @param {{ config: object, cwd: string, args?: string[], flags?: object, renderer?: object,
 *   env?: object }} ctx
 * @returns {Promise<number>} the exit code
 * @exports
 * @ai.hint io
 */
export async function planCommand(ctx) {
    const { config, cwd, args = [], flags = {}, renderer = null, env = process.env } = ctx;
    const { kind, task } = splitKind(args, flags);
    if (kind && config?.agent) config.agent.kind = kind;
    if (!task) throw new UsageError('Укажите задачу: ai-webdev plan "сделать лендинг".');

    const notify = (event) => renderer?.event?.(event);
    const client = await createClient({ config, env, root: cwd, onEvent: notify });
    try {
        const report = await runPipeline({
            client,
            config,
            root: cwd,
            task,
            stageNames: ['collect', 'plan'],
            notify,
            env,
        });
        for (const warning of report.warnings ?? []) renderer?.warning?.(warning);
        renderer?.summary?.(report);
        return report.status === 'failed' ? 1 : 0;
    } finally {
        client.close?.();
    }
}

/**
 * Show the stages of the pipeline.
 *
 * @param {{ config: object, flags?: object, renderer?: object }} ctx
 * @returns {Promise<number>} the exit code
 * @exports
 * @ai.hint io
 */
export async function stagesCommand(ctx) {
    const { config, renderer = null } = ctx;
    const list = STAGES.map((stage) => ({
        name: stage.name,
        title: stage.title,
        dependsOn: stage.dependsOn,
        enabled: config?.stages?.[stage.name]?.enabled !== false,
    }));
    if (renderer?.mode === 'json') {
        renderer?.stages?.(list);
        return 0;
    }
    renderer?.heading?.('Stages');
    renderer?.stages?.(list);
    return 0;
}
