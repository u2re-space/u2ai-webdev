/**
 * @file src/stages/animation.js
 * @module stages/animation
 * @purpose Движение результата: переходы состояний, появления, скролл-эффекты.
 *
 *   Стадия отдаёт шаг плана роли `animator`: та же таблица стилей, что и у стадии
 *   `styling`, но работа другая. Стилист написал раскладку и состояния, аниматор
 *   дописал в них движение — и не переписал ни одного имени класса и ни одного токена.
 *
 *   Стадия стоит между стилями и кодом: код пишется по контракту стилей, и движение
 *   — часть этого контракта. Код, который появится после, знает, какие состояния есть.
 *
 * @depends roles/index, stages/architect, stages/step, stages/style-entry
 * @usedBy stages/index, pipeline
 * @exports role, animationStage
 * @ai.tags stages, animation, motion
 * @ai.hint io
 */

import { architectureText } from './architect.js';
import { stylesOf } from './style-entry.js';
import { runStepStage } from './step.js';

/** Роль, чьи шаги исполняет эта стадия. */
export const role = 'animator';

/**
 * Стадия движения.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null, apply?: boolean,
 *   notify?: (event: object) => void, env?: object, input?: object|null, runContext?: object|null }} request
 * @returns {Promise<object>} отчёт стадии
 * @exports
 * @ai.hint io
 */
export async function animationStage({
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
        role: 'animator',
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
            style: styles.language,
            styles,
        },
    });
}
