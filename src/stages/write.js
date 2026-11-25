/**
 * @file src/stages/write.js
 * @module stages/write
 * @purpose Стадия письма: шаги плана, что пишут файлы.
 *
 *   Было шесть стадий письма: `markup`, `pre-coding`, `pre-styling`, `styling`,
 *   `animation`, `coding`. Каждая со своим промптом, своим бюджетом и своим
 *   ожиданием: кодер ждал стилей, стилест ждал кода, и прогон стоял на месте.
 *
 *   Теперь стадия одна. Роль `builder` берёт шаг плана и пишет те файлы, что шаг
 *   называет, — разметку, стили, код и движение в одном шаге, если шаг это просит.
 *   Ремесло файла приходит по виду файла, гайды — по назначению, которое роль
 *   называет у ворот записи.
 *
 *   Шаги, что принадлежат другой роли (иконки, вектор, картинки), остаются у неё.
 *
 * @depends roles/index, stages/architect, stages/step, stages/style-entry
 * @usedBy stages/index, pipeline
 * @exports role, writeStage, stepsOfWrite, styleTokensText
 * @ai.tags stages, write, builder
 * @ai.hint io
 * @changed 2026-11-25 Стадия письма вместо шести стадий: одна роль пишет всё.
 */

import { architectureText } from './architect.js';
import { stylesOf } from './style-entry.js';
import { runStepStage } from './step.js';
import { projectFiles } from './project-files.js';
import { checkMarkupStyles } from '../agent/markup-styles.js';
import { WRITE_ROLES } from './roles.js';

/** Роль, чьи шаги исполняет эта стадия. */
export const role = 'builder';

/**
 * The tokens of a stylesheet as the block of the custom properties.
 *
 * The styler declares its tokens in the answer of the step, and the report shows what
 * each of them is: a reader sees which token came from where.
 * @param {object[]} tokens
 * @param {string} [selector]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function styleTokensText(tokens = [], selector = ':root') {
    const list = Array.isArray(tokens) ? tokens : [];
    if (!list.length) return '';
    const lines = list.map((token) => {
        const name = String(token?.name ?? '').trim().replace(/^--/, '');
        const value = String(token?.value ?? '').trim();
        if (!name || !value) return '';
        return `  --${name}: ${value};`;
    }).filter(Boolean);
    if (!lines.length) return '';
    return `${selector} {\n${lines.join('\n')}\n}\n`;
}

/**
 * Шаги письма: шаги плана, что не принадлежат другой роли.
 *
 * План раздаёт шаги по ролям: иконки — иконщику, вектор — редактору, картинки —
 * иллюстратору. Всё остальное — шаг письма: разметка, стили, код и движение.
 *
 * @param {object|null} plan план прогона
 * @returns {object[]}
 * @exports
 * @ai.hint pure
 */
export function stepsOfWrite(plan = null) {
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    return steps.filter((step) => WRITE_ROLES.has(String(step?.role ?? '').trim().toLowerCase()));
}

/**
 * Стадия письма.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null, apply?: boolean,
 *   notify?: (event: object) => void, env?: object, input?: object|null, runContext?: object|null,
 *   signal?: AbortSignal|null }} request
 * @returns {Promise<object>} отчёт стадии
 * @exports
 * @ai.hint io
 */
export async function writeStage({
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
    signal = null,
    input = null,
    runContext = null,
} = {}) {
    const brief = architecture ? architectureText(architecture) : '';
    const styles = await stylesOf({ plan, architecture, config, root });
    // План письма: шаги, что пишут файлы, с ролью `builder`.
    const work = { ...(plan ?? {}), steps: stepsOfWrite(plan).map((step) => ({ ...step, role: 'builder' })) };

    const result = await runStepStage({
        client,
        config,
        root,
        task,
        role: 'builder',
        plan: work,
        brief,
        inputs,
        runId: id,
        apply,
        notify,
        env,
        input,
        runContext,
        signal,
        context: {
            stack: config?.stack ?? {},
            styles,
            // Стили и код уже могут быть на диске — а могут и нет. Роль не ждёт
            // ни то, ни другое: она пишет по контракту, который сама и называет.
            hasStyles: true,
            hasCode: true,
        },
        stage: 'write',
    });

    // Токены, что роль объявила, показываются блоком: читатель видит, какой токен откуда.
    for (const report of result.steps ?? []) {
        const declared = Array.isArray(report.tokens) ? report.tokens : [];
        if (!declared.length) continue;
        report.tokensBlock = styleTokensText(declared);
    }

    // Разметка и стили должны говорить на одном языке: класс разметки без правила — это
    // элемент без формы. Стадия говорит об этом сразу, пока файлы ещё на диске.
    const files = await projectFiles(root, plan);
    if (files.markup.length && files.styles.length) {
        const check = await checkMarkupStyles({ root, markup: files.markup, styles: files.styles });
        if (check.orphans.length) {
            result.warnings.push(`Классы разметки без правил в стилях: ${check.orphans.join(', ')}.`);
        }
        if (check.unused.length) {
            result.warnings.push(`Правила стилей, для которых нет разметки: ${check.unused.join(', ')}.`);
        }
    }
    return result;
}
