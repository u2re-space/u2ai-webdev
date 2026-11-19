/**
 * @file src/stages/sight.js
 * @module stages/sight
 * @purpose The stage that lets the styles be seen: a screenshot of the page and a repair.
 *
 *   The stage of the styles writes the CSS. Nobody looks at the result: a rule that compiles
 *   may still break the layout — the type is enormous, the columns run out of the screen, the
 *   picture is stretched. The stage `sight` closes that gap: it opens the page of the project
 *   in a real browser, takes a screenshot of it and asks the styler to compare the picture with
 *   the reference of the design and to fix the styles that do not match.
 *
 *   The stage runs after the build, because the page has to be assembled before it can be
 *   looked at: the SCSS is compiled and the markup is wired to the stylesheet there.
 *
 *   A page that cannot be opened is not a failure of the run: the stage says why and the run
 *   goes on. The styles are written either way — they are simply not checked by the eye.
 *
 * @depends node:path, agent/browser, stages/vision, roles/index, inputs/references,
 *          stages/step, stages/workspace
 * @usedBy stages/index, pipeline
 * @exports sightStage, applyStyles
 * @ai.tags stages, vision, screenshot
 * @ai.hint io
 * @changed 2026-11-16 Стадия зрения: снимок страницы и починка стилей по картинке.
 */

import path from 'node:path';

import { runRole } from '../roles/index.js';
import { readReferences } from '../inputs/references.js';
import { applyFiles, filesBlock, visibleFiles } from './step.js';
import { projectFiles } from './project-files.js';
import { picturePart, shootPage, visionEnabled, visionPrompt, comparePictures, designWidth } from './vision.js';
import { buildProject, ensurePage } from './dev-server.js';
import { runId } from './workspace.js';

/**
 * The files the answer of the role carries, applied to the project.
 *
 * The styles of the stage are written by the code, not only reported: a role that says what
 * it fixed but writes nothing leaves the broken styles on the disk.
 * @param {{ root: string, files: object[], scope?: object }} request
 * @returns {Promise<{ written: string[], replaced: string[], failed: string[], warnings: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function applyStyles({ root, files = [], scope = null }) {
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { written: [], replaced: [], failed: [], warnings: [] };
    const applied = await applyFiles({ root, files: list, scope });
    return {
        written: applied.written ?? [],
        replaced: applied.replaced ?? [],
        failed: applied.failed ?? [],
        warnings: applied.warnings ?? [],
    };
}

/**
 * The stylesheets of the project and nothing else.
 *
 * The stage of the sight fixes the styles. A file of another kind — the markup, the script —
 * belongs to another role, and the answer of the styler does not get to write over it.
 * @param {string[]} styles the stylesheets of the project
 * @param {object[]} files the files of the answer of the role
 * @returns {{ files: object[], skipped: string[] }}
 * @exports
 * @ai.hint pure
 */
export function stylesOnly(styles = [], files = []) {
    const allowed = new Set((Array.isArray(styles) ? styles : [])
        .map((item) => String(item ?? '').trim().replace(/\\/g, '/'))
        .filter(Boolean));
    const keep = [];
    const skipped = [];
    for (const file of Array.isArray(files) ? files : []) {
        const rel = String(file?.path ?? '').trim().replace(/\\/g, '/');
        if (rel && allowed.has(rel)) keep.push(file);
        else skipped.push(rel || '(без пути)');
    }
    return { files: keep, skipped };
}

/**
 * The stage of the sight: the page is shot, the styler compares it with the reference and
 * fixes the styles.
 *
 * The loop is bounded by `browser.stylingVisionRounds`: every round shoots the page again and
 * asks for a fix. The stage stops when the rounds are over, when the page cannot be opened, or
 * when the styler has nothing to change.
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null, apply?: boolean,
 *   notify?: (event: object) => void, env?: object, runContext?: object|null,
 *   input?: object|null }} request
 * @returns {Promise<object>} the report of the stage
 * @exports
 * @ai.hint io
 */
export async function sightStage({
    client,
    config = {},
    root = process.cwd(),
    task = '',
    plan = null,
    architecture = null,
    inputs = null,
    runId: id = null,
    apply = true,
    notify = () => {},
    env = process.env,
    runContext = null,
    input = null,
} = {}) {
    const run = id ?? runId();
    const warnings = [];
    const shots = [];

    const reference = await readReferences(root, inputs?.references ?? []);
    warnings.push(...reference.warnings);
    const enabled = visionEnabled(config, { reference: reference.names.length > 0 });
    if (!enabled) {
        return {
            stage: 'sight',
            ok: true,
            skipped: true,
            shots: [],
            warnings: [],
            runId: run,
        };
    }

    const rounds = Number.isSafeInteger(config?.browser?.stylingVisionRounds)
        ? Math.max(0, config.browser.stylingVisionRounds)
        : 2;
    const viewport = config?.browser?.viewport ?? {};
    const width = Number.isSafeInteger(viewport.width) ? viewport.width : 1440;
    const height = Number.isSafeInteger(viewport.height) ? viewport.height : 900;
    const timeoutMs = Number.isSafeInteger(config?.browser?.timeoutMs) ? config.browser.timeoutMs : 45_000;

    // The comparison of the page with the reference: the pictures have to be of the same size
    // to be compared, and the size of the reference is a question of the PPI.
    const compareMode = String(config?.browser?.compare ?? 'auto');
    const compareOn = compareMode === 'always' || (compareMode === 'auto' && reference.names.length > 0);
    const dprs = Array.isArray(config?.browser?.compareDprs) ? config.browser.compareDprs : undefined;
    const design = compareOn
        ? designWidth({ reference: reference.sizes[0], targetWidth: width, dprs })
        : null;
    // The page is shot at the size of the design: then the picture of the page and the
    // picture of the reference are the same size, and the comparison is a comparison of the
    // page and not of the sizes. The height of the design comes with it: a reference of
    // 1024x768 is a page of 1024x768 CSS pixels.
    const atDesignSize = config?.browser?.compareAtDesignWidth !== false;
    const shotWidth = design?.width && atDesignSize ? design.width : width;
    const shotHeight = design?.height && atDesignSize ? design.height : height;

    const written = [];
    const replaced = [];
    const logs = [];
    const comparisons = [];
    let round = 0;
    // The stylesheets the role may change: the ones of the project that are on the disk now.
    // The role fixes them; it does not write files of other kinds.
    const { styles: styleFiles } = await projectFiles(root, plan);
    // The live page of the project: the dev server that already runs is used as it is, and a
    // server that is not running is started by the run and stopped by it afterwards.
    let live = { url: null, live: false, stop: async () => {}, reason: null };
    try {
        // The page has to be the one of the current sources: a project on Vite keeps its
        // styles inside the script, and only the build puts them into the page.
        const built = await buildProject({ root, env });
        if (built.ran && !built.ok) {
            warnings.push(`Сборка проекта не удалась: ${built.reason ?? 'неизвестная причина'}.`);
        }
        live = await ensurePage({
            root,
            config,
            env,
            timeoutMs: Number.isSafeInteger(config?.browser?.devTimeoutMs) ? config.browser.devTimeoutMs : 60_000,
        });
        if (live.reason) warnings.push(`Живая страница недоступна: ${live.reason}`);
    } catch (error) {
        warnings.push(`Живая страница недоступна: ${error?.message ?? error}`);
    }
    try {
        for (; round < rounds; round++) {
            let shot = null;
            try {
                shot = await shootPage({
                    root, config, env, width: shotWidth, height: shotHeight, timeoutMs, url: live.url,
                });
            } catch (error) {
                warnings.push(`Снимок страницы не сделан: ${error?.message ?? error}`);
                break;
            }
            shots.push(shot.rel);
            notify({
                type: 'stage.shot',
                stage: 'sight',
                path: shot.rel,
                bytes: shot.bytes,
                engine: shot.engine,
                width: shotWidth,
                height: shotHeight,
            });

            // The comparison: the page and the reference, brought to the same size and
            // measured. The numbers say how far the page is, the picture says where.
            let comparison = null;
            if (compareOn && reference.names.length) {
                try {
                    comparison = await comparePictures({
                        root,
                        reference: reference.names[0],
                        result: shot.rel,
                        config,
                        env,
                        targetWidth: shotWidth,
                    });
                    if (!comparison.ok) {
                        warnings.push(`Сверка с референсом не выполнена: ${comparison.reason ?? 'причина неизвестна'}`);
                    }
                } catch (error) {
                    warnings.push(`Сверка с референсом не выполнена: ${error?.message ?? error}`);
                }
            }
            if (comparison?.ok) {
                // The run shows the comparison: the reference it looked at, the PPI it read
                // out of it, the numbers and the picture of the difference.
                notify({
                    type: 'stage.compare',
                    stage: 'sight',
                    reference: comparison.reference?.path ?? reference.names[0],
                    dpr: comparison.design?.dpr ?? null,
                    designWidth: comparison.design?.width ?? null,
                    designHeight: comparison.design?.height ?? null,
                    similarity: comparison.similarity ?? null,
                    rmse: comparison.metrics?.rmse ?? null,
                    ssim: comparison.metrics?.ssim ?? null,
                    difference: comparison.difference?.rel ?? null,
                    shot: shot.rel,
                });
                // The numbers go into the context right away: the stage may be cut short
                // later, and the numbers of the comparison are true whatever happens to it.
                await runContext?.set?.('the comparison', [
                    `The page was compared with the reference ${comparison.reference?.path ?? ''} at `
                    + `${comparison.design?.dpr ?? 1}x (the design is ${comparison.design?.width ?? '?'} CSS pixels wide).`,
                    `The similarity is ${comparison.similarity ?? '?'}%, the difference (RMSE) is `
                    + `${comparison.metrics?.rmse?.toFixed?.(3) ?? '?'}.`,
                    comparison.difference?.rel ? `The picture of the difference: ${comparison.difference.rel}` : '',
                ].filter(Boolean).join('\n'));
            }

            // The words of the page: the console of the browser and the log of the bundler.
            // They name the cause of what the picture shows.
            const pageLog = [shot.log, live.log?.() ?? ''].filter(Boolean).join('\n\n');
            if (pageLog.trim()) {
                logs.push(pageLog.trim());
            }

            // The picture of the result and the picture of the reference travel together: the role
            // compares them and names the difference. The picture of the difference travels with
            // them: it shows the places that are wrong.
            const parts = [await picturePart(root, shot.rel), ...reference.parts].filter(Boolean);
            if (comparison?.difference?.rel) {
                const difference = await picturePart(root, comparison.difference.rel);
                if (difference) parts.push(difference);
            }
            // The styles as they are now: the role fixes the file that is on the disk, it does
            // not write a new one from scratch.
            const current = filesBlock(await visibleFiles(root, { files: styleFiles }, plan));
            const result = await runRole({
                client,
                config,
                role: 'styler',
                input: [
                    current,
                    visionPrompt({
                        reference: reference.names,
                        result: shot.rel,
                        round: round + 1,
                        rounds,
                        log: pageLog,
                        comparison,
                        task: String(task ?? ''),
                    }),
                ].filter(Boolean).join('\n\n'),
                context: {
                    task: String(task ?? ''),
                    brief: '',
                    reference: reference.names,
                    referenceSizes: reference.sizes,
                    design: Boolean(inputs),
                },
                root,
                env,
                maxTurns: config?.stages?.styler?.maxTurns ?? null,
                parts,
                notify,
                runContext,
                stage: 'sight',
                // The operator sees the model that works: the styler of the house answers on
                // the head of its ladder, and the panel of the shell has to say so.
                inputChannel: input,
                requireFiles: true,
            });

            const files = Array.isArray(result?.data?.files) ? result.data.files : [];
            // The words of the role about the page are the memory of the run: the styles that were
            // fixed, and what still differs from the reference. The later stages read them from
            // the context, so the page is not looked at from the code alone.
            const notes = String(result?.data?.notes ?? '').trim();
            if (notes) {
                await runContext?.set?.('the page', notes);
            }
            // The words of the page itself — the console and the bundler — go into the context
            // too: the stages after this one do not see the browser.
            if (pageLog.trim()) {
                await runContext?.set?.('the log of the page', pageLog.trim().slice(0, 4000));
            }
            // The numbers of the comparison go into the report as well: the later stages
            // know how far the page is from the reference without seeing the pictures.
            if (comparison?.ok) {
                comparisons.push({
                    shot: shot.rel,
                    reference: comparison.reference?.path ?? null,
                    dpr: comparison.design?.dpr ?? null,
                    designWidth: comparison.design?.width ?? null,
                    designHeight: comparison.design?.height ?? null,
                    similarity: comparison.similarity ?? null,
                    rmse: comparison.metrics?.rmse ?? null,
                    ssim: comparison.metrics?.ssim ?? null,
                    difference: comparison.difference?.rel ?? null,
                });
            }
            if (!files.length) {
                // The role has nothing to change: the page matches the reference as far as it sees.
                break;
            }
            // Only the stylesheets of the project are the work of this stage.
            const only = stylesOnly(styleFiles, files);
            if (only.skipped.length) {
                warnings.push(`Файлы не стилей не тронуты: ${only.skipped.join(', ')}.`);
            }
            if (!only.files.length) break;
            if (!apply) break;
            const applied = await applyStyles({ root, files: only.files });
            warnings.push(...applied.warnings);
            written.push(...applied.written);
            replaced.push(...applied.replaced);
            for (const rel of [...applied.written, ...applied.replaced]) {
                await runContext?.file?.(rel);
            }
            if (applied.failed.length) {
                warnings.push(`Стили не записаны: ${applied.failed.join(', ')}.`);
                break;
            }
            // The page of the next round has to show the fix: a live page compiles the styles
            // itself, a built one has to be built again.
            if (round + 1 < rounds && !live.live) {
                const built = await buildProject(root, { env });
                if (!built.ok) {
                    warnings.push(`Сборка проекта не удалась: ${built.reason ?? 'неизвестная причина'}.`);
                    break;
                }
            }
        }
    } finally {
        await live.stop?.();
    }

    return {
        stage: 'sight',
        ok: true,
        shots,
        written: [...new Set(written)],
        replaced: [...new Set(replaced)],
        rounds: round,
        // The words of the page: the console of the browser and the log of the bundler.
        logs,
        // The numbers of the comparison with the reference, round by round.
        comparisons,
        // The width of the design the page was shot at, and the PPI of the reference.
        design: design ? { dpr: design.dpr, width: design.width, height: design.height, reason: design.reason } : null,
        warnings,
        runId: run,
    };
}
