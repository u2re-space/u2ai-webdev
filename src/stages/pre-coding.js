/**
 * @file src/stages/pre-coding.js
 * @module stages/pre-coding
 * @purpose Черновик контракта кода: скелет модулей и состояния по черновику стилей.
 *
 *   Кодер, который пишет код целиком, не знает, каких имён ждут стили: он выдумывает
 *   свои, а стилест потом пишет правила для других имён, и страница остаётся без
 *   одежды. И наоборот: стилест не знает, каких состояний будет ждать код, и не пишет
 *   правил для них.
 *
 *   Эта стадия решает это: кодер приходит **после** черновика стилей и пишет по нему
 *   скелет своего кода — модули, экспорты, состояния, поток данных. Скелет — это
 *   контракт, по которому потом пишутся и стили, и код.
 *
 *   Полный код пишет стадия `coding`, которая идёт после полных стилей и видит, что
 *   из скелета выросло.
 *
 * @depends roles/index, stages/architect, stages/step, stages/style-entry
 * @usedBy stages/index, pipeline
 * @exports role, preCodingStage
 * @ai.tags stages, coding, contract
 * @ai.hint io
 * @changed 2026-11-24 Черновик контракта кода: стадия после черновика стилей.
 */

import { architectureText } from './architect.js';
import { stylesOf } from './style-entry.js';
import { runStepStage } from './step.js';

/** Роль, чьи шаги исполняет эта стадия. */
export const role = 'coder';

/**
 * Стадия черновика контракта кода.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null, apply?: boolean,
 *   notify?: (event: object) => void, env?: object, input?: object|null, runContext?: object|null }} request
 * @returns {Promise<object>} отчёт стадии
 * @exports
 * @ai.hint io
 */
export async function preCodingStage({
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
        stage: 'pre-coding',
        // Только скелет кода: полный код пишет стадия `coding`.
        pass: 'draft',
        context: {
            stack: config?.stack ?? {},
            styles,
            // Черновик стилей уже на диске — кодер пишет по нему.
            hasStyles: true,
            // Кода ещё нет: кодер работает по контракту состояний, а не ждёт его.
            hasCode: false,
        },
    });
}
