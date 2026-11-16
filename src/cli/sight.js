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
    if (!references.length) {
        throw new UsageError('Референс дизайна не найден: положите картинку в проект или назовите её флагом --image.');
    }

    const notify = (event) => renderer?.event?.(event);
    const client = await createClient({ config, env, root: cwd, onEvent: notify });
    try {
        const run = makeRunId();
        // The architecture of the earlier run, when there is one: the styler knows the stack
        // of the project and does not guess it.
        const architecture = await readArchitecture(cwd, config, run).catch(() => null);
        const result = await sightStage({
            client,
            config,
            root: cwd,
            task: task || 'Make the page look like the reference.',
            architecture,
            inputs: { references },
            runId: run,
            notify,
            env,
        });
        for (const warning of result.warnings ?? []) renderer?.warning?.(warning);
        const shots = Array.isArray(result.shots) ? result.shots : [];
        for (const shot of shots) renderer?.note?.(`Снимок страницы: ${shot}`);
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
