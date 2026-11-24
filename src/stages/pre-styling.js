/**
 * @file src/stages/pre-styling.js
 * @module stages/pre-styling
 * @purpose Черновик контракта стилей: токены, имена и каркас до того, как пишется код.
 *
 *   Стилест, который пишет стили целиком, отвечает на вопросы, которые ещё никто не
 *   задал: каких состояний ждёт страница, какие классы появятся в коде, какие токены
 *   нужны. Он выдумывает их — и кодер потом пишет против выдуманного, а стилест
 *   переименовывает, и страница рассыпается.
 *
 *   Эта стадия отвечает на эти вопросы **заранее**: стилест пишет черновик контракта —
 *   токены, имена классов, каркас раскладки и правила состояний — по брифу архитектора,
 *   который и есть тот самый общий контракт. Кодер приходит после и пишет скелет своего
 *   кода по этому черновику, а не по своей догадке.
 *
 *   Стадия ничего не решает за стилиста: полные стили пишет стадия `styling`, которая
 *   идёт после кода и видит, что из черновика выросло.
 *
 * @depends roles/index, stages/architect, stages/step, stages/style-entry
 * @usedBy stages/index, pipeline
 * @exports role, preStylingStage
 * @ai.tags stages, styling, contract
 * @ai.hint io
 * @changed 2026-11-24 Черновик контракта стилей: стадия перед кодом.
 */

import { architectureText } from './architect.js';
import { stylesOf } from './style-entry.js';
import { runStepStage } from './step.js';

/** Роль, чьи шаги исполняет эта стадия. */
export const role = 'styler';

/**
 * Стадия черновика контракта стилей.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null, apply?: boolean,
 *   notify?: (event: object) => void, env?: object, input?: object|null, runContext?: object|null }} request
 * @returns {Promise<object>} отчёт стадии
 * @exports
 * @ai.hint io
 */
export async function preStylingStage({
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
        role: 'styler',
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
        stage: 'pre-styling',
        // Только черновик контракта: полные стили пишет стадия `styling`.
        pass: 'draft',
        context: {
            style: styles.language,
            styles,
            tokens: architecture?.tokens ?? [],
            conflicts: inputs?.conflicts ?? [],
            // Кода ещё нет: стилест работает по контракту состояний, а не ждёт кода.
            hasCode: false,
            // Стилей ещё нет — но их контракт есть, и по нему и пишутся стили.
            hasStyles: false,
        },
    });
}
