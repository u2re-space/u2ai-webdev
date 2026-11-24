/**
 * @file src/stages/coding.js
 * @module stages/coding
 * @purpose The code of the steps of the plan: the modules, the logic and the commands.
 *
 *   The stage gives the coder the step, the brief of the architect and the collected context,
 *   and then applies the files the coder wrote. The commands the coder names are reported and
 *   left to the user: a command of a model is not run behind the back of the user.
 *
 * @depends roles/index, stages/architect, stages/step
 * @usedBy stages/index, pipeline
 * @exports role, codingStage
 * @ai.tags stages, coding
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: код по шагу плана.
 */

import { architectureText } from './architect.js';
import { stylesOf } from './style-entry.js';
import { runStepStage } from './step.js';

/** Роль, чьи шаги исполняет эта стадия. */
export const role = 'coder';

/**
 * The stage of the code.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null, apply?: boolean,
 *   notify?: (event: object) => void, env?: object, input?: object|null, runContext?: object|null }} request
 * @returns {Promise<object>} the report of the stage
 * @exports
 * @ai.hint io
 */
export async function codingStage({
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
        role: 'coder',
        plan,
        brief,
        inputs,
        runId: id,
        apply,
        notify,
        env,
        input,
        runContext,
        // Имя стадии: по нему берутся лестница моделей, усилие и бюджет.
        stage: 'coding',
        // Полный код: скелет сделала стадия `pre-coding`.
        pass: 'full',
        context: {
            stack: config?.stack ?? {},
            styles,
            // Полные стили уже написаны — код пишется по ним.
            hasStyles: true,
            hasCode: true,
        },
    });
}
