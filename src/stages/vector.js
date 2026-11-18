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
 * @exports polishSvgFiles, preparedVectorPlan, role, vectorStage
 * @ai.tags stages, vector, svg
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: вектор правится текстом.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { writeTextFile } from '../agent/fs-tools.js';
import { resolveInside } from '../agent/paths.js';
import { architectureText } from './architect.js';
import { runStepStage } from './step.js';
import { optimizeSvg, validateSvg } from '../vector/svg.js';

/** Роль, чьи шаги исполняет эта стадия. */
export const role = 'editor';

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
 * Подготовленные картинки: имя — и путь файла, который уже готов.
 * @param {object[]} pictures
 * @returns {Map<string, string>}
 * @ai.hint pure
 */
function preparedPictures(pictures = []) {
    const map = new Map();
    for (const picture of Array.isArray(pictures) ? pictures : []) {
        const file = String(picture?.file ?? '').trim();
        const name = String(picture?.name ?? '').trim();
        if (file) map.set(path.basename(file, path.extname(file)).toLowerCase(), file);
        if (name) map.set(name.toLowerCase(), file || name);
    }
    return map;
}

/**
 * План без SVG, которые повторяют уже подготовленную картинку.
 *
 * Вырезанный из референса объект — это и есть ассет. Нарисованный по памяти SVG того же
 * имени — не ассет, а его приближение: кольцо вместо кольца, но без монограммы. Шаг, который
 * рисует такой файл, не выполняется: настоящая картинка уже лежит на диске.
 *
 * @param {object|null} plan
 * @param {object[]} pictures
 * @returns {{ plan: object|null, skipped: { id: string, file: string, picture: string }[],
 *   pictures: Map<string, string> }}
 * @exports
 * @ai.hint pure
 */
export function preparedVectorPlan(plan = null, pictures = []) {
    const map = preparedPictures(pictures);
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    if (!map.size || !steps.length) return { plan, skipped: [], pictures: map };
    const skipped = [];
    const kept = [];
    for (const step of steps) {
        if (String(step?.role ?? '').trim().toLowerCase() !== 'editor') {
            kept.push(step);
            continue;
        }
        const files = Array.isArray(step?.files) ? step.files : [];
        if (!files.length) {
            kept.push(step);
            continue;
        }
        const rest = [];
        for (const file of files) {
            const rel = String(file ?? '').trim();
            const ext = path.extname(rel).toLowerCase();
            const base = path.basename(rel, ext).toLowerCase();
            if (ext === '.svg' && map.has(base)) {
                skipped.push({ id: step.id, file: rel, picture: map.get(base) });
                continue;
            }
            rest.push(file);
        }
        // Шаг, у которого не осталось файлов, — это и есть перерисовка готовой картинки.
        if (!rest.length) continue;
        kept.push({ ...step, files: rest });
    }
    return { plan: { ...plan, steps: kept }, skipped, pictures: map };
}

/**
 * The stage of the vector graphics.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null, apply?: boolean,
 *   notify?: (event: object) => void, env?: object, signal?: AbortSignal|null }} request
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
    apply = true,
    notify = () => {},
    env = process.env,
    signal = null,
} = {}) {
    const brief = architecture ? architectureText(architecture) : '';
    // Картинка, вырезанная из референса, — это и есть ассет: нарисованный по памяти SVG
    // того же имени не выполняется.
    const prepared = preparedVectorPlan(plan, inputs?.pictures ?? []);
    const result = await runStepStage({
        client,
        config,
        root,
        task,
        role: 'editor',
        plan: prepared.plan,
        brief,
        inputs,
        runId: id,
        apply,
        notify,
        env,
        signal,
        context: {
            stack: config?.stack ?? {},
            vectorOnly: true,
        },
    });

    for (const item of prepared.skipped) {
        result.warnings.push(`Шаг ${item.id}: ${item.file} не рисуется — картинка уже подготовлена: ${item.picture}.`);
    }

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

    // The SVG, which repeats a prepared picture, is named: the cut-out of the reference is
    // closer to the reference than a new drawing.
    for (const rel of written) {
        const base = path.basename(rel, path.extname(rel)).toLowerCase();
        const picture = prepared.pictures.get(base);
        if (picture) result.warnings.push(`${rel} повторяет подготовленную картинку ${picture}.`);
    }

    const svg = await polishSvgFiles({ root, files: written });
    result.warnings.push(...svg.warnings);
    result.svg = svg;
    result.ok = result.ok && !svg.broken.length;
    return result;
}
