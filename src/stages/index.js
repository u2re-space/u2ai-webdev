/**
 * @file src/stages/index.js
 * @module stages/index
 * @purpose The registry of the stages: their order, their dependencies and their resume
 *          points.
 *
 *   The registry is the list of what a run does. Every stage says what it needs before it
 *   may start, and the pipeline reads that list to decide the order, to skip the stages
 *   that are switched off and to find the stage a resumed run has to continue at.
 *
 *   The registry holds no state: the state of a run lives in the directory of the run.
 *
 * @depends stages/collect, stages/plan, stages/architect, stages/setup, stages/markup,
 *          stages/coding, stages/styling, stages/vector, stages/iconify, stages/review,
 *          stages/audit, stages/learn
 * @usedBy pipeline, cli
 * @exports STAGES, STAGE_NAMES, stageByName, stageOrder, enabledStages, stageDependencies,
 *          resumeStageName, stageTitles
 * @ai.tags stages, registry, pipeline
 * @ai.hint pure
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: стадии описаны в одном реестре.
 */

import { collectStage } from './collect.js';
import { planStage } from './plan.js';
import { architectStage } from './architect.js';
import { setupStage } from './setup.js';
import { markupStage } from './markup.js';
import { codingStage } from './coding.js';
import { stylingStage } from './styling.js';
import { vectorStage } from './vector.js';
import { iconifyStage } from './iconify.js';
import { reviewStage } from './review.js';
import { auditStage } from './audit.js';
import { learnStage } from './learn.js';

/**
 * The stages of a run, in the order they are declared.
 *
 * `run` is the function of the stage; it takes the context of the run and returns its
 * report. `apply` puts the result of the stage into the context of the next stages.
 * @type {ReadonlyArray<{ name: string, title: string, dependsOn: string[], run: Function,
 *   apply?: Function }>}
 */
export const STAGES = Object.freeze([
    {
        name: 'collect',
        title: 'Collect the context',
        dependsOn: [],
        run: collectStage,
        args: (ctx) => ({ memory: ctx.memory ?? null }),
        apply: (ctx, result) => { ctx.inputs = result?.inputs ?? null; },
    },
    {
        name: 'plan',
        title: 'Plan the work',
        dependsOn: ['collect'],
        run: planStage,
        apply: (ctx, result) => { ctx.plan = result?.plan ?? null; },
    },
    {
        name: 'architect',
        title: 'Design the structure',
        dependsOn: ['plan'],
        run: architectStage,
        apply: (ctx, result) => { ctx.architecture = result?.architecture ?? null; },
    },
    {
        name: 'setup',
        title: 'Prepare the environment',
        dependsOn: ['architect'],
        run: setupStage,
        apply: (ctx, result) => { ctx.setup = result?.setup ?? null; },
    },
    {
        name: 'markup',
        title: 'Write the markup',
        dependsOn: ['setup'],
        run: markupStage,
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'coding',
        title: 'Write the code',
        dependsOn: ['markup'],
        run: codingStage,
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'styling',
        title: 'Write the styles',
        dependsOn: ['coding'],
        run: stylingStage,
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'vector',
        title: 'Draw the vector graphics',
        dependsOn: ['coding'],
        run: vectorStage,
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'iconify',
        title: 'Choose the icons',
        dependsOn: ['markup'],
        run: iconifyStage,
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'review',
        title: 'Review the result',
        dependsOn: ['coding', 'styling', 'vector', 'iconify'],
        run: reviewStage,
        apply: (ctx, result) => { ctx.review = result ?? null; },
    },
    {
        name: 'audit',
        title: 'Audit the project',
        dependsOn: ['review'],
        run: auditStage,
        apply: (ctx, result) => { ctx.audit = result ?? null; },
    },
    {
        name: 'learn',
        title: 'Learn the lessons',
        dependsOn: ['audit'],
        run: learnStage,
        args: (ctx) => ({ memory: ctx.memoryText ?? '', store: ctx.memory ?? null }),
        apply: (ctx, result) => { ctx.lessons = result?.lessons ?? []; },
    },
]);

/** The names of the stages, in the order of the registry. */
export const STAGE_NAMES = Object.freeze(STAGES.map((stage) => stage.name));

/**
 * The stage of a name.
 * @param {string} name
 * @returns {object|null}
 * @exports
 * @ai.hint pure
 */
export function stageByName(name) {
    const key = String(name ?? '').trim().toLowerCase();
    return STAGES.find((stage) => stage.name === key) ?? null;
}

/**
 * The titles of the stages, one per line.
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function stageTitles() {
    return STAGES.map((stage) => `- ${stage.name}: ${stage.title}`).join('\n');
}

/**
 * Sort the stages so that every stage comes after the ones it needs.
 *
 * The declared order is the tie-breaker: a run reads the same way every time.
 * @param {object[]} [stages]
 * @returns {{ stages: object[], warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function stageOrder(stages = STAGES) {
    const list = Array.isArray(stages) ? [...stages] : [];
    const byName = new Map(list.map((stage) => [stage.name, stage]));
    const done = new Set();
    const out = [];
    const warnings = [];

    while (out.length < list.length) {
        const ready = list.find((stage) => !done.has(stage.name)
            && (stage.dependsOn ?? []).every((name) => done.has(name) || !byName.has(name)));
        if (!ready) {
            const names = list.filter((stage) => !done.has(stage.name)).map((stage) => stage.name);
            warnings.push(`Цикл зависимостей стадий: ${names.join(', ')}. Стадии оставлены в исходном порядке.`);
            out.push(...list.filter((stage) => !done.has(stage.name)));
            break;
        }
        done.add(ready.name);
        out.push(ready);
    }

    return { stages: out, warnings };
}

/**
 * The stages of a run: the ones that are switched on and that were asked for.
 * @param {object} config
 * @param {string[]|null} [names] the stages the user asked for, or null for all of them
 * @returns {{ stages: object[], warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function enabledStages(config = {}, names = null) {
    const wanted = Array.isArray(names) && names.length
        ? new Set(names.map((name) => String(name).trim().toLowerCase()))
        : null;
    const warnings = [];
    const list = [];

    for (const stage of STAGES) {
        if (wanted && !wanted.has(stage.name)) continue;
        const enabled = config?.stages?.[stage.name]?.enabled;
        if (enabled === false) continue;
        list.push(stage);
    }

    if (wanted) {
        for (const name of wanted) {
            if (!STAGE_NAMES.includes(name)) warnings.push(`Стадия "${name}" неизвестна и пропущена.`);
        }
    }

    const ordered = stageOrder(list);
    return { stages: ordered.stages, warnings: [...warnings, ...ordered.warnings] };
}

/**
 * The stages a stage needs.
 * @param {string} name
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function stageDependencies(name) {
    const stage = stageByName(name);
    return stage ? [...(stage.dependsOn ?? [])] : [];
}

/**
 * The stage a resumed run continues at: the first one that is not done.
 * @param {object} progress
 * @param {object[]} [stages]
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function resumeStageName(progress, stages = STAGES) {
    const records = Array.isArray(progress?.stages) ? progress.stages : [];
    for (const stage of stages) {
        const record = records.find((item) => item.name === stage.name);
        if (!record || record.status !== 'completed') return stage.name;
    }
    return null;
}
