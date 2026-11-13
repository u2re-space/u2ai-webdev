/**
 * @file src/stages/vector.js
 * @module stages/vector
 * @purpose The vector graphics of the project: the generation, the edit and the export.
 *
 *   The graphics are code: the stage runs the editor over the steps of the plan that belong
 *   to it, checks every SVG that appeared, tidies it and puts it back into the project.
 *
 *   A broken SVG is reported, not fixed silently: a picture that does not open is a fact the
 *   user has to know.
 *
 * @depends roles/index, stages/architect, stages/step, vector/svg, agent/fs-tools
 * @usedBy stages/index, pipeline
 * @exports polishSvgFiles, vectorStage
 * @ai.tags stages, vector, svg
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: вектор правится текстом.
 */

import { readFile } from 'node:fs/promises';
import { writeTextFile } from '../agent/fs-tools.js';
import { resolveInside } from '../agent/paths.js';
import { architectureText } from './architect.js';
import { runStepStage } from './step.js';
import { optimizeSvg, validateSvg } from '../vector/svg.js';

/**
 * Check and tidy the SVG files of a step.
 *
 * @param {{ root: string, files?: string[], overwrite?: boolean }} request
 * @returns {Promise<{ polished: { path: string, bytes: number }[], broken: { path: string,
 *   errors: string[] }[], warnings: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function polishSvgFiles({ root, files = [], overwrite = true } = {}) {
    const polished = [];
    const broken = [];
    const warnings = [];

    for (const rel of Array.isArray(files) ? files : []) {
        const path = String(rel ?? '').trim();
        if (!path || !/\.svg$/i.test(path)) continue;
        const text = await resolveInside(root, path)
            .then(({ abs }) => readFile(abs, 'utf8'))
            .catch(() => null);
        if (text === null) {
            warnings.push(`Файл ${path} не найден.`);
            continue;
        }
        const check = validateSvg(text);
        if (!check.ok) {
            broken.push({ path, errors: check.errors });
            continue;
        }
        warnings.push(...check.warnings.map((item) => `${path}: ${item}`));
        const next = optimizeSvg(text);
        if (next !== text) {
            await writeTextFile({
                root,
                file: path,
                content: next,
                overwrite,
                backupSlot: 'vector',
            });
        }
        polished.push({ path, bytes: Buffer.byteLength(next, 'utf8') });
    }

    return { polished, broken, warnings };
}

/**
 * The stage of the vector graphics.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null,
 *   notify?: (event: object) => void, env?: object }} request
 * @returns {Promise<object>} the report of the stage
 * @exports
 * @ai.hint io
 */
export async function vectorStage({
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
    const result = await runStepStage({
        client,
        config,
        root,
        task,
        role: 'editor',
        plan,
        brief,
        inputs,
        runId: id,
        notify,
        env,
        context: {
            stack: config?.stack ?? {},
        },
    });

    // Every SVG that the step touched is checked and tidied.
    const written = [];
    for (const report of result.steps) {
        for (const file of report.files ?? []) {
            if (String(file?.path ?? '').toLowerCase().endsWith('.svg')) written.push(file.path);
        }
        for (const rel of report.applied?.written ?? []) {
            if (rel.toLowerCase().endsWith('.svg') && !written.includes(rel)) written.push(rel);
        }
    }

    const svg = await polishSvgFiles({ root, files: written });
    result.warnings.push(...svg.warnings);
    result.svg = svg;
    result.ok = result.ok && !svg.broken.length;
    return result;
}
