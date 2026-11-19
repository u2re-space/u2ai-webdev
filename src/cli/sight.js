/**
 * @file src/cli/sight.js
 * @module cli/sight
 * @purpose The command `sight`: look at the page of the project and fix the styles.
 *
 *   The command works on the project as it is: it does not plan, does not write the markup
 *   and does not start the whole pipeline. It shoots the page of the project, gives the
 *   picture to the styler together with the reference of the design, and writes the styles
 *   that the styler fixed.
 *
 *   It is the way to finish a project whose styles are not right yet: the work that is
 *   already on the disk stays, and only the styles are touched.
 *
 * @depends cli/errors, cli/renderer, openai/client, stages/sight, stages/workspace,
 *          inputs/references, stages/architect
 * @usedBy cli
 * @exports sightCommand
 * @ai.tags cli, vision, styles
 * @ai.hint io
 * @changed 2026-11-16 Команда зрения: посмотреть на готовый проект и починить стили.
 */

import { createClient } from '../openai/client.js';
import { sightStage } from '../stages/sight.js';
import { findReferences } from '../inputs/references.js';
import { readArchitecture } from '../stages/architect.js';
import { runId as makeRunId } from '../stages/workspace.js';
import { UsageError } from './errors.js';

/**
 * Whether the command has something to work on.
 *
 * The reference of the design is the target when it is there: the page is compared with the
 * picture of the design. Without it the task of the operator is the target: the picture of the
 * page and the words of the task are enough to fix the styles.
 * @param {{ references?: object[], task?: string }} request
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function canRunSight({ references = [], task = '' } = {}) {
    if (Array.isArray(references) && references.length) return true;
    return Boolean(String(task ?? '').trim());
}

/**
 * Look at the page of the project and fix the styles.
 *
 * @param {{ config: object, cwd: string, args?: string[], flags?: object, renderer?: object,
 *   env?: object }} ctx
 * @returns {Promise<number>} the exit code
 * @exports
 * @ai.hint io
 */
export async function sightCommand(ctx) {
    const { config, cwd, args = [], flags = {}, renderer = null, env = process.env } = ctx;
    const task = String(args?.[0] ?? '').trim();

    // The reference of the design: the picture the result has to look like. It is found the
    // same way the run finds it — by the config, by the task and by the name of the file.
    const references = await findReferences({
        root: cwd,
        config,
        task: task || 'the design of the project',
    });
    // Without a reference there is nothing to compare with, but the operator may still say
    // what has to change: the picture of the page and the task are enough for that.
    if (!canRunSight({ references, task })) {
        throw new UsageError('Скажите, что исправить: `ai-webdev sight "сделай заголовок крупнее"`, '
            + 'или положите картинку референса в проект и назовите её флагом --image.');
    }

    const notify = (event) => renderer?.event?.(event);
    // The operator asked for the styles to be fixed: the page is shot even without a
    // reference of the design.
    const vision = references.length
        ? config
        : { ...config, browser: { ...(config?.browser ?? {}), stylingVision: 'always' } };
    const client = await createClient({ config, env, root: cwd, onEvent: notify });
    try {
        const run = makeRunId();
        // The architecture of the earlier run, when there is one: the styler knows the stack
        // of the project and does not guess it.
        const architecture = await readArchitecture(cwd, config, run).catch(() => null);
        const result = await sightStage({
            client,
            config: vision,
            root: cwd,
            task: task || 'Make the page look like the reference.',
            architecture,
            inputs: { references },
            runId: run,
            notify,
            env,
        });
        if (!references.length) {
            renderer?.warning?.('Референса дизайна нет: стили сверяются с задачей, а не с картинкой.');
        }
        for (const warning of result.warnings ?? []) renderer?.warning?.(warning);
        const shots = Array.isArray(result.shots) ? result.shots : [];
        for (const shot of shots) renderer?.note?.(`Снимок страницы: ${shot}`);
        // The comparison with the reference: the PPI of the reference, the numbers and the
        // picture of the difference.
        if (result.design) {
            renderer?.note?.(`Референс: ${result.design.dpr}x — ширина дизайна ${result.design.width} CSS px.`);
        }
        for (const comparison of Array.isArray(result.comparisons) ? result.comparisons : []) {
            renderer?.note?.(`Сверка ${comparison.shot}: сходство ${comparison.similarity ?? '?'}%, `
                + `RMSE ${comparison.rmse?.toFixed?.(4) ?? '?'}${comparison.difference ? `, картинка различий: ${comparison.difference}` : ''}`);
        }
        if (!shots.length) {
            renderer?.note?.('Снимок страницы не сделан: стили не тронуты.');
        } else if (Array.isArray(result.written) && result.written.length) {
            renderer?.note?.(`Стили исправлены: ${result.written.join(', ')}`);
        } else {
            renderer?.note?.('Стилизатор не нашёл, что править.');
        }
        return 0;
    } finally {
        client.close?.();
    }
}
