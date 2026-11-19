/**
 * @file src/stages/styling.js
 * @module stages/styling
 * @purpose The styles of the steps of the plan: the tokens, the layers and the rules.
 *
 *   The stage gives the styler the step, the brief of the architect (with the tokens of the
 *   project) and the collected context — the design direction, the palette and the
 *   measurements. The tokens of `tokens.css` win over the other sources, and the styler is
 *   told about the conflicts.
 *
 *   The stylesheets the styler wrote are applied, and the tokens it declares are reported, so
 *   a reader sees which token came from where.
 *
 * @depends roles/index, stages/architect, stages/step, inputs/index, agent/markup-styles,
 *          stages/project-files
 * @usedBy stages/index, pipeline
 * @exports role, stylingStage, styleTokensText
 * @ai.tags stages, styling, tokens
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: стили по шагу плана, токены и DESIGN.md.
 */

import { architectureText } from './architect.js';
import { projectFiles } from './project-files.js';
import { checkMarkupStyles } from '../agent/markup-styles.js';
import { runStepStage } from './step.js';

/** Роль, чьи шаги исполняет эта стадия. */
export const role = 'styler';

/**
 * The tokens of a stylesheet as the block of the custom properties.
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
 * The stage of the styles.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null, apply?: boolean,
 *   notify?: (event: object) => void, env?: object, input?: object|null }} request
 * @returns {Promise<object>} the report of the stage
 * @exports
 * @ai.hint io
 */
export async function stylingStage({
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
} = {}) {
    const brief = architecture ? architectureText(architecture) : '';
    const tokens = architecture?.tokens ?? [];
    const conflicts = inputs?.conflicts ?? [];

    const result = await runStepStage({
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
        context: {
            style: architecture?.stack?.style ?? config?.stack?.styleLanguage ?? 'scss',
            tokens,
            conflicts,
        },
    });

    // The tokens the styler declared are reported with the block they would give.
    for (const report of result.steps) {
        const declared = Array.isArray(report.tokens) ? report.tokens : [];
        if (!declared.length) continue;
        report.tokensBlock = styleTokensText(declared);
    }

    // The markup and the styles have to speak the same language: a class of the markup
    // without a rule is an element without a shape. The stage says so right away, while the
    // styles are still the work of this stage.
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
