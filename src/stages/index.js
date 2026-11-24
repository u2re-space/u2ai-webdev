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
 *          stages/coding, stages/styling, stages/build, stages/vector, stages/iconify,
 *          stages/review, stages/audit, stages/learn
 * @usedBy pipeline, cli
 * @exports STAGES, STAGE_NAMES, stageByName, stageOrder, enabledStages, stageDependencies,
 *          resumeStageName, stageTitles
 * @ai.tags stages, registry, pipeline
 * @ai.hint pure
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: стадии описаны в одном реестре.
 * @changed 2026-11-15 Лист измерений обновляется из поля `sheetFile` ответа стадии.
 */

import { collectStage } from './collect.js';
import { scanStage } from './scan.js';
import { picturesStage } from './pictures.js';
import { planStage } from './plan.js';
import { architectStage } from './architect.js';
import { setupStage } from './setup.js';
import { markupStage } from './markup.js';
import { preStylingStage } from './pre-styling.js';
import { preCodingStage } from './pre-coding.js';
import { codingStage } from './coding.js';
import { stylingStage } from './styling.js';
import { animationStage } from './animation.js';
import { buildStage } from './build.js';
import { sightStage } from './sight.js';
import { vectorStage } from './vector.js';
import { assetsStage } from './assets.js';
import { iconifyStage } from './iconify.js';
import { reviewStage } from './review.js';
import { auditStage } from './audit.js';
import { learnStage } from './learn.js';
import { roleWorkOnDisk } from './step.js';

/**
 * The check of a stage that works on the steps of the plan.
 *
 * The stage is done only when the work of its role is still on the disk: the progress of
 * the run says that the stage ran, but the answer of the role may have been lost.
 *
 * `pass` says which pass of the role the stage owns: the check of `pre-styling` looks at
 * the draft of the contract, and the check of `styling` looks at the full styles.
 * @param {string} role
 * @param {string} [pass]
 * @returns {Function}
 * @ai.hint pure
 */
function workOnDisk(role, pass = null) {
    return (ctx) => roleWorkOnDisk({
        root: ctx.root,
        config: ctx.config,
        id: ctx.runId,
        plan: ctx.plan,
        role,
        pass,
    });
}

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
        name: 'scan',
        title: 'Scan the project',
        // The project is read before the plan: the planner starts from what is on the disk,
        // not from what it assumes about it.
        dependsOn: ['collect'],
        run: scanStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        apply: (ctx, result) => { ctx.scan = result?.scan ?? null; },
    },
    {
        name: 'plan',
        title: 'Plan the work',
        dependsOn: ['collect'],
        run: planStage,
        args: (ctx) => ({ input: ctx.input ?? null }),
        apply: (ctx, result) => { ctx.plan = result?.plan ?? null; },
    },
    {
        name: 'architect',
        title: 'Design the structure',
        dependsOn: ['plan'],
        run: architectStage,
        args: (ctx) => ({ input: ctx.input ?? null }),
        apply: (ctx, result) => { ctx.architecture = result?.architecture ?? null; },
    },
    {
        name: 'setup',
        title: 'Prepare the environment',
        dependsOn: ['architect'],
        run: setupStage,
        args: (ctx) => ({ input: ctx.input ?? null }),
        apply: (ctx, result) => { ctx.setup = result?.setup ?? null; },
    },
    {
        name: 'vector',
        title: 'Draw the vector graphics',
        // The graphics are drawn before the markup: the page links the files of the editor
        // by the names the context gives, and a picture that is drawn after the markup is
        // still linked by its name — but it has to be drawn before the build, or it never
        // reaches the bundle.
        dependsOn: ['setup'],
        run: vectorStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'pictures',
        title: 'Prepare the pictures',
        // The crops are prepared after the vector: the editor draws first, and the stage
        // cuts out of the reference what the editor did not draw. The stage of the assets
        // stands after both of them and knows the whole set of the pictures.
        dependsOn: ['vector'],
        run: picturesStage,
        args: (ctx) => ({ apply: ctx.apply !== false }),
        apply: (ctx, result) => {
            ctx.pictures = result?.pictures ?? [];
            if (!ctx.inputs) return;
            const next = { ...ctx.inputs, pictures: ctx.pictures };
            // If a sheet is already present, keep the refreshed input for the later stages.
            if (result?.measurements) next.measurements = result.measurements;
            if (result?.sheetFile) {
                next.files = { ...next.files, measurements: result.sheetFile };
            }
            ctx.inputs = next;
        },
    },
    {
        name: 'markup',
        title: 'Write the markup',
        dependsOn: ['setup'],
        run: markupStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        verify: workOnDisk('markup'),
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'assets',
        title: 'Place the assets',
        // The assets are placed after the markup: the markup links the prepared pictures
        // that the context names, and the illustrator puts their final copies on their
        // places afterwards. Neither waits for the other: a circle between them stopped
        // the styles from ever starting.
        dependsOn: ['vector', 'pictures', 'markup'],
        run: assetsStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        apply: (ctx, result) => {
            ctx.assets = result?.assets ?? [];
            if (!ctx.inputs || !ctx.assets.length) return;
            // The roles after this stage see the final paths of the pictures: the styles
            // and the code name them.
            ctx.inputs = { ...ctx.inputs, assets: ctx.assets };
        },
    },
    {
        name: 'pre-coding',
        title: 'Draft the contract of the code',
        // The skeleton of the code comes right after the markup: the skeleton is written
        // against the markup and the brief of the architect — the modules, the states and
        // the data flow. Without it the styler invents the states nobody wears, and the
        // coder invents the names the styles never dress.
        dependsOn: ['markup'],
        run: preCodingStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        verify: workOnDisk('coder', 'draft'),
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'pre-styling',
        title: 'Draft the contract of the styles',
        // The draft of the styles comes after the skeleton of the code: the styler dresses
        // exactly the states and the modules the skeleton names. Without this stage the
        // styles written later dress classes that nobody uses.
        dependsOn: ['pre-coding'],
        run: preStylingStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        verify: workOnDisk('styler', 'draft'),
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'styling',
        title: 'Write the styles',
        // The full styles come after the draft of the styles: the draft is the contract,
        // and the full work is the second look at the same file.
        dependsOn: ['pre-styling'],
        run: stylingStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        verify: workOnDisk('styler', 'full'),
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'animation',
        title: 'Animate the result',
        // The motion comes after the styles and before the code: the code is written against
        // the contract of the styles, and the states of the page are part of that contract.
        dependsOn: ['styling'],
        run: animationStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        verify: workOnDisk('animator'),
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'coding',
        title: 'Write the code',
        // The full code comes after the full styles: the scripts use the class names and
        // the tokens that the stylesheet has already written.
        dependsOn: ['styling'],
        run: codingStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        verify: workOnDisk('coder', 'full'),
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'iconify',
        title: 'Choose the icons',
        // The icons are put into the markup of the page, and the page is finished when the
        // styles and the code are written: the stage stands after both of them and before the
        // build, so the icons and the markup that uses them reach the bundle.
        dependsOn: ['styling', 'coding'],
        run: iconifyStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'build',
        title: 'Connect the styles',
        // The bundle carries the code and the styles: the build waits for both.
        dependsOn: ['coding', 'styling'],
        run: buildStage,
        args: (ctx) => ({ apply: ctx.apply !== false }),
        apply: (ctx, result) => { ctx.build = result?.build ?? null; },
    },
    {
        name: 'sight',
        title: 'Look at the page',
        // The page is shot after the build: the styles have to be compiled and wired before
        // there is something to look at.
        dependsOn: ['build'],
        run: sightStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        apply: (ctx, result) => {
            ctx.shots = [...(ctx.shots ?? []), ...(result?.shots ?? [])];
            // The words of the page — the console of the browser and the log of the bundler —
            // travel to the stages after this one.
            ctx.pageLogs = [...(ctx.pageLogs ?? []), ...(result?.logs ?? [])];
            ctx.reports.push(...(result?.steps ?? []));
        },
    },
    {
        name: 'review',
        title: 'Review the result',
        dependsOn: ['coding', 'styling', 'build', 'sight', 'vector', 'iconify'],
        run: reviewStage,
        // The reviewer sees the page: the screenshots of the stage of the sight are the
        // pictures of the result, and the reference is the picture of the target. The words of
        // the page come with them.
        args: (ctx) => ({
            input: ctx.input ?? null,
            screenshots: ctx.shots ?? [],
            logs: (ctx.pageLogs ?? []).join('\n\n'),
        }),
        apply: (ctx, result) => { ctx.review = result ?? null; },
    },
    {
        name: 'audit',
        title: 'Audit the project',
        dependsOn: ['review'],
        run: auditStage,
        args: (ctx) => ({ input: ctx.input ?? null }),
        apply: (ctx, result) => { ctx.audit = result ?? null; },
    },
    {
        name: 'learn',
        title: 'Learn the lessons',
        dependsOn: ['audit'],
        run: learnStage,
        args: (ctx) => ({ memory: ctx.memoryText ?? '', store: ctx.memory ?? null, input: ctx.input ?? null }),
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
