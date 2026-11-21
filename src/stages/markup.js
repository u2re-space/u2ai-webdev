/**
 * @file src/stages/markup.js
 * @module stages/markup
 * @purpose The markup of the steps of the plan: the structure of the page, its landmarks and
 *          its accessibility.
 *
 *   The stage gives the markup specialist the step, the brief of the architect and the
 *   collected context (the design direction, the measurements and the assets), and then
 *   applies the files the specialist wrote.
 *
 * @depends roles/index, stages/architect, stages/step
 * @usedBy stages/index, pipeline
 * @exports role, markupStage
 * @ai.tags stages, markup, accessibility
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: разметка по шагу плана и брифу.
 */

import { architectureText } from './architect.js';
import { stylesOf } from './style-entry.js';
import { runStepStage } from './step.js';

/** Роль, чьи шаги исполняет эта стадия. */
export const role = 'markup';

/**
 * The stage of the markup.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null, apply?: boolean,
 *   notify?: (event: object) => void, env?: object, input?: object|null, runContext?: object|null }} request
 * @returns {Promise<object>} the report of the stage
 * @exports
 * @ai.hint io
 */
export async function markupStage({
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
    input = null,
    runContext = null,
} = {}) {
    const brief = architecture ? architectureText(architecture) : '';
    const styles = await stylesOf({ plan, architecture, config, root });
    return await runStepStage({
        client,
        config,
        root,
        task,
        role: 'markup',
        plan,
        brief,
        inputs,
        runId: id,
        apply,
        notify,
        env,
        input,
        runContext,
        context: {
            markup: architecture?.stack?.markup ?? config?.stack?.markupLanguage ?? 'html',
            styles,
        },
    });
}
