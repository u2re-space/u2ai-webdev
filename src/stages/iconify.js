/**
 * @file src/stages/iconify.js
 * @module stages/iconify
 * @purpose The icons of the project: which ones, of which set, and whether they are there.
 *
 *   The iconifier picks the icons of the steps of the plan, downloads the set into the
 *   project and puts the icons into the markup. The stage checks that every icon the answer
 *   names is really on the disk: a name without a file is a broken interface.
 *
 * @depends node:fs/promises, roles/index, stages/architect, stages/step, agent/paths
 * @usedBy stages/index, pipeline
 * @exports iconFiles, iconifyStage
 * @ai.tags stages, icons
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: подбор иконок и интеграция в разметку.
 */

import { stat } from 'node:fs/promises';
import { resolveInside } from '../agent/paths.js';
import { architectureText } from './architect.js';
import { runStepStage } from './step.js';

/**
 * The files of the icons of an answer.
 * @param {object[]} icons
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function iconFiles(icons = []) {
    return (Array.isArray(icons) ? icons : [])
        .map((icon) => String(icon?.file ?? '').trim())
        .filter(Boolean);
}

/**
 * The stage of the icons.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null,
 *   notify?: (event: object) => void, env?: object }} request
 * @returns {Promise<object>} the report of the stage
 * @exports
 * @ai.hint io
 */
export async function iconifyStage({
    client,
    config = {},
    root = process.cwd(),
    task = '',
    plan = null,
    architecture = null,
    inputs = null,
    runId: id = null,
    notify = () => {},
    env = process.env,
} = {}) {
    const brief = architecture ? architectureText(architecture) : '';
    const iconSet = config?.stack?.iconSet ?? 'auto';

    const result = await runStepStage({
        client,
        config,
        root,
        task,
        role: 'iconifier',
        plan,
        brief,
        inputs,
        runId: id,
        notify,
        env,
        context: {
            iconSet,
            markup: architecture?.stack?.markup ?? config?.stack?.markupLanguage ?? 'html',
        },
    });

    // Every icon the answer names must be on the disk.
    const missing = [];
    const present = [];
    const sets = new Set();
    for (const report of result.steps) {
        const icons = Array.isArray(report.icons) ? report.icons : [];
        for (const icon of icons) {
            const name = String(icon?.name ?? '').trim();
            if (name) sets.add(name);
            const file = String(icon?.file ?? '').trim();
            if (!file) {
                missing.push({ name, file: '', reason: 'the answer did not name the file' });
                continue;
            }
            const found = await resolveInside(root, file)
                .then(({ abs }) => stat(abs).then((info) => info.isFile()))
                .catch(() => false);
            if (found) present.push(file);
            else missing.push({ name, file, reason: 'the file is not in the project' });
        }
        if (report.set) sets.add(report.set);
    }

    result.icons = { present: [...new Set(present)], missing };
    result.iconSet = config?.stack?.iconSet && config.stack.iconSet !== 'auto'
        ? config.stack.iconSet
        : (result.steps.find((report) => report.set)?.set ?? 'auto');
    result.warnings.push(...missing.map((item) => `Иконка ${item.name || item.file}: ${item.reason}.`));
    result.ok = result.ok && !missing.length;
    return result;
}
