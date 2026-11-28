/**
 * @file src/stages/graphics.js
 * @module stages/graphics
 * @purpose Графика проекта: вырезки референса, векторные рисунки и их места.
 *
 *   Было три стадии: `pictures` (вырезки референса мостом `ai-image`), `vector` (векторные
 *   рисунки) и `assets` (раскладка картинок по местам). Три сущности для одной работы —
 *   зоопарк без нужды.
 *
 *   Теперь стадия одна, а роль в ней одна — `artist`. Она делает всё: готовит вырезку,
 *   рисует вектор и кладёт картинку на место, что подключает разметка.
 *
 *   Порядок внутри стадии задаёт план: шаг, что рисует, идёт раньше шага, что кладёт.
 *   Ни одна сторона не ждёт другую: картинка ложится на путь, который подключает
 *   разметка, а разметка не ждёт картинок — она знает их имена из контекста.
 *
 * @depends roles/index, stages/architect, stages/step, stages/pictures, stages/vector
 * @usedBy stages/index, pipeline
 * @exports role, graphicsStage, stepsOfGraphics
 * @ai.tags stages, graphics, pictures, vector
 * @ai.hint io
 * @changed 2026-11-25 Стадия графики вместо трёх: вырезки, вектор и раскладка.
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';
import { architectureText } from './architect.js';
import { runStepStage } from './step.js';
import { picturesStage } from './pictures.js';
import { vectorStage, preparedVectorPlan, splitVectorSteps, polishSvgFiles } from './vector.js';
import { placedAssets } from './assets.js';
import { readAssets, writeAssets } from './assets.js';
import { assetFiles } from './assets.js';

/** Роль, чьи шаги исполняет эта стадия. */
export const role = 'artist';

/**
 * Шаги графики: шаги плана, что делают графику.
 *
 * Рисунок — один шаг: ход модели не держит три SVG сразу. А шаг, что кладёт картинки на
 * места, идёт после тех, что их готовят.
 *
 * @param {object|null} plan
 * @returns {object|null}
 * @exports
 * @ai.hint pure
 */
export function stepsOfGraphics(plan = null) {
    return splitVectorSteps(plan)?.steps ?? plan?.steps ?? null;
}

/**
 * Стадия графики.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null, apply?: boolean,
 *   notify?: (event: object) => void, env?: object, input?: object|null, runContext?: object|null,
 *   signal?: AbortSignal|null }} request
 * @returns {Promise<object>} отчёт стадии
 * @exports
 * @ai.hint io
 */
export async function graphicsStage({
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
    const settings = config?.pictures ?? {};
    const assetsDir = String(settings.assetsDir ?? 'assets').replace(/\/+$/, '');
    const warnings = [];

    // Первая половина: вырезки референса. Мост `ai-image` режет их сам и выбирает лучшую
    // из двух моделей — эта логика дорогая и не должна жить в промпте.
    const cuts = await picturesStage({
        root,
        config,
        inputs,
        env,
        notify,
        apply,
        runId: id,
    });
    const pictures = Array.isArray(cuts?.pictures) ? cuts.pictures : [];
    warnings.push(...(cuts?.warnings ?? []).map((item) => `Вырезки: ${item}`));

    // Вторая половина: рисунки и раскладка. Роль `artist` делает и то, и другое.
    const vectors = await assetFiles(root, plan);
    const prepared = preparedVectorPlan(plan, pictures);
    const work = { ...(prepared.plan ?? {}), steps: splitVectorSteps(prepared.plan)?.steps ?? [] };

    const result = await runStepStage({
        client,
        config,
        root,
        task,
        role: 'artist',
        plan: work,
        brief,
        inputs: { ...(inputs ?? {}), pictures },
        runId: id,
        apply,
        notify,
        env,
        input,
        runContext,
        signal,
        context: {
            stack: config?.stack ?? {},
            pictures,
            vectors,
            assetsDir,
        },
        stage: 'graphics',
    });

    for (const item of prepared.skipped) {
        result.warnings.push(`Шаг ${item.id}: ${item.file} не рисуется — картинка уже подготовлена: ${item.picture}.`);
    }
    result.warnings.push(...warnings);

    // Каждый SVG, что появился, проверяется и приводится в порядок.
    const written = [];
    for (const report of result.steps ?? []) {
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

    // Проверка стадии: каждая готовая картинка должна лежать на своём месте, и одна
    // картинка не должна лежать дважды — вырезка референса и нарисованный вектор.
    const placed = placedAssets(result);
    const byName = new Map(placed.map((item) => [item.name, item]));
    const final = [];
    for (const picture of pictures) {
        const name = baseName(picture?.file ?? picture?.name ?? '');
        const asset = byName.get(name) ?? null;
        if (!asset) {
            result.warnings.push(`Картинка не поставлена на место: ${picture?.file ?? picture?.name ?? name}.`);
            continue;
        }
        final.push({
            name: picture?.name ?? name,
            kind: picture?.kind ?? 'picture',
            file: asset.path,
            source: picture?.source ?? null,
            bytes: asset.bytes,
            use: picture?.use ?? '',
        });
    }
    for (const vector of vectors) {
        const name = baseName(vector);
        const cut = pictures.find((picture) => baseName(picture?.file ?? '') === name);
        if (!cut) continue;
        // Вектор и вырезка с тем же именем — это **не** дубль: это один и тот же объект,
        // который художник перевёл в вектор. Страница показывает его один раз — по
        // ссылке разметки. Дубль был бы, если б и вырезка, и вектор стояли на месте
        // одновременно.
        const vectorOnDisk = await stat(path.join(root, vector)).then((info) => info.isFile()).catch(() => false);
        const cutOnDisk = await stat(path.join(root, cut.file ?? '')).then((info) => info.isFile()).catch(() => false);
        if (vectorOnDisk && cutOnDisk) {
            result.warnings.push(`${vector} и ${cut.file} — два файла одного объекта: `
                + 'оставьте на месте только тот, на который ссылается разметка.');
        }
    }

    result.assets = final;
    result.pictures = pictures;
    // Ассеты ложатся на диск: продолжённый прогон пропускает стадию и должен знать,
    // где что лежит.
    await writeAssets(root, config, id, final).catch(() => {});
    result.text = final.length
        ? final.map((item) => `- ${item.name} → ${item.file}`).join('\n')
        : 'Ассеты не перемещены.';
    result.ok = result.ok && !svg.broken.length;
    return result;
}

/**
 * Имя файла без пути и без расширения.
 * @param {string} file
 * @returns {string}
 */
function baseName(file) {
    const rel = String(file ?? '').trim().replace(/\\/g, '/');
    if (!rel) return '';
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
}

export { readAssets, vectorStage };
