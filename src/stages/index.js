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
 * @changed 2026-11-25 Проверка «сделано ли» знает свою стадию: `workOnDisk(role, pass,
 *                       stage)`.
 */

import { collectStage } from './collect.js';
import { scanStage } from './scan.js';
import { planStage } from './plan.js';
import { architectStage } from './architect.js';
import { setupStage } from './setup.js';
import { buildStage } from './build.js';
import { sightStage } from './sight.js';
import { writeStage } from './write.js';
import { iconifyStage } from './iconify.js';
import { graphicsStage } from './graphics.js';
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
function workOnDisk(role, pass = null, stage = '') {
    return (ctx) => roleWorkOnDisk({
        root: ctx.root,
        config: ctx.config,
        id: ctx.runId,
        plan: ctx.plan,
        role,
        pass,
        stage,
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
        apply: (ctx, result) => { ctx.scan = result?.scan ?? ctx.scan ?? null; },
    },
    {
        name: 'plan',
        title: 'Plan the work',
        dependsOn: ['collect'],
        run: planStage,
        args: (ctx) => ({ input: ctx.input ?? null }),
        // The plan that is there stays: a continued run reads it back, and a stage that
        // ran once is not asked to plan again.
        apply: (ctx, result) => { ctx.plan = result?.plan ?? ctx.plan ?? null; },
    },
    {
        name: 'architect',
        title: 'Design the structure',
        dependsOn: ['plan'],
        run: architectStage,
        args: (ctx) => ({ input: ctx.input ?? null }),
        // The structure that is there stays: a stage that failed once but wrote its work
        // is not asked to write it again when the run continues.
        apply: (ctx, result) => { ctx.architecture = result?.architecture ?? ctx.architecture ?? null; },
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
        name: 'graphics',
        title: 'Make the graphics',
        // The graphics are made before the writing: the page links the files by the names
        // the context gives, and a picture that is made after the writing is still linked
        // by its name — but it has to be made before the build, or it never reaches the
        // bundle.
        //
        // One stage and one role: the artist cuts the crops of the reference, draws the
        // vector graphics and puts the pictures on their places. None of that waits for
        // another stage — the markup links the pictures by name, and the pictures land on
        // the names the markup links.
        dependsOn: ['setup'],
        run: graphicsStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        apply: (ctx, result) => {
            ctx.reports.push(...(result?.steps ?? []));
            ctx.pictures = result?.pictures ?? [];
            ctx.assets = result?.assets ?? [];
            if (!ctx.inputs) return;
            const next = { ...ctx.inputs, pictures: ctx.pictures, assets: ctx.assets };
            // If a sheet is already present, keep the refreshed input for the later stages.
            if (result?.measurements) next.measurements = result.measurements;
            if (result?.sheetFile) {
                next.files = { ...next.files, measurements: result.sheetFile };
            }
            ctx.inputs = next;
        },
    },
    {
        name: 'write',
        title: 'Write the project',
        // One stage for all the writing: the markup, the styles, the scripts and the
        // motion. The role is one, the craft of the file comes by its kind, and the
        // guides come by the purpose of the write.
        //
        // The stage waits for the graphics: the markup links the pictures by the names
        // the graphics give, and a picture that appears after the writing is a link to
        // nothing.
        dependsOn: ['graphics'],
        run: writeStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        verify: workOnDisk('builder'),
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'iconify',
        title: 'Choose the icons',
        // The icons are put into the markup of the page, and the page is finished when the
        // styles and the code are written: the stage stands after both of them and before the
        // build, so the icons and the markup that uses them reach the bundle.
        dependsOn: ['write'],
        run: iconifyStage,
        args: (ctx) => ({ apply: ctx.apply !== false, input: ctx.input ?? null }),
        apply: (ctx, result) => { ctx.reports.push(...(result?.steps ?? [])); },
    },
    {
        name: 'build',
        title: 'Connect the styles',
        // The bundle carries the code and the styles: the build waits for the writing.
        dependsOn: ['write'],
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
        // The review sees the whole result: the writing, the build, the look at the page
        // and the icons. Every one of them is a part of what it judges.
        dependsOn: ['write', 'iconify', 'build', 'sight'],
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
 *
 * A dependency on a stage that is not in the run is **not** a satisfied dependency: it is
 * a mistake in the registry, and the run says so. Раньше такое имя считался выполненным,
 * и стадия вставала раньше той, что её ждёт: сборка и взгляд на страницу проходили
 * раньше письма, и прогон смотрел на пустую страницу.
 *
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

    // Стадия, что ждёт несуществующей стадии, ждёт её честно: она не готова, пока той
    // стадии нет. Имя, которого нет в реестре, — это опечатка, а не «стадия выключена».
    //
    // Стадия, что **выключена** пользователем, — другое дело: она не в списке, и ждать
    // её нечего. Отличать одно от другого можно только по полному реестру: имя, которого
    // нет и в нём, никогда не существовало.
    const known = new Set(STAGES.map((stage) => stage.name));
    const missing = [];
    for (const stage of list) {
        for (const name of stage.dependsOn ?? []) {
            if (byName.has(name)) continue;
            if (known.has(name)) continue; // Стадия выключена: ждать её нечего.
            missing.push(`${stage.name} ждёт «${name}» — такой стадии нет`);
        }
    }
    if (missing.length) {
        warnings.push(`Стадия зависит от несуществующей стадии: ${missing.join('; ')}. `
            + 'Стадия ждёт её, и прогон не идёт дальше, пока та не появится.');
    }
    // Стадия, что ждёт несуществующей стадии, не может быть готова: она встаёт после
    // всех, кто готов, и её имя уходит в конец — с предупреждением.
    const blocked = new Set(missing.map((item) => item.split(' ')[0]));

    while (out.length < list.length) {
        const ready = list.find((stage) => !done.has(stage.name)
            && !blocked.has(stage.name)
            && (stage.dependsOn ?? []).every((name) => done.has(name) || !byName.has(name)));
        if (!ready) {
            // Ни одна стадия не готова: круг или стадия, что ждёт несуществующей.
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
