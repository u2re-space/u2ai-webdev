/**
 * @file src/stages/assets.js
 * @module stages/assets
 * @purpose Ассеты проекта на своих местах: вторая половина стадии картинок.
 *
 *   Стадия `pictures` готовит вырезки референса, стадия `vector` рисует векторную
 *   графику. Обе они кладут файлы на диск, но не решают, какой файл страница подключит
 *   и в каком виде. Это решает стадия `assets`: роль `illustrator` раскладывает картинки
 *   по местам, приводит их к формату, который грузит страница, и говорит следующим
 *   стадиям, где что лежит.
 *
 *   Стадия стоит после `vector` и до `markup`: когда нарисован вектор, известно всё
 *   множество ассетов, и разметка подключает уже окончательные файлы.
 *
 * @depends roles/index, stages/architect, stages/step, stages/project-files, stages/workspace
 * @usedBy stages/index, pipeline
 * @exports role, assetsStage, assetFiles, placedAssets, ASSETS_FILE, assetsPath, writeAssets,
 *          readAssets
 * @ai.tags stages, pictures, assets
 * @ai.hint io
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';
import { architectureText } from './architect.js';
import { runStepStage, stepsForRole } from './step.js';
import { runFile, writeJsonFile, readJsonFile } from './workspace.js';

/** Роль, чьи шаги исполняет эта стадия. */
export const role = 'illustrator';

/** The file of the run that holds the placed assets. */
export const ASSETS_FILE = 'assets.json';

/**
 * The file of the run that holds the placed assets.
 * @param {string} root
 * @param {object} config
 * @param {string} [id]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function assetsPath(root, config = {}, id = null) {
    return runFile(root, config, id, ASSETS_FILE);
}

/**
 * Write the placed assets into the directory of the run.
 * @param {string} root
 * @param {object} config
 * @param {string} [id]
 * @param {object[]} assets
 * @returns {Promise<string>} the path of the file
 * @exports
 * @ai.hint io
 */
export async function writeAssets(root, config = {}, id = null, assets = []) {
    return await writeJsonFile(assetsPath(root, config, id), { assets });
}

/**
 * Read the placed assets of a run. A missing file gives an empty list.
 * @param {string} root
 * @param {object} config
 * @param {string} [id]
 * @returns {Promise<object[]>}
 * @exports
 * @ai.hint io
 */
export async function readAssets(root, config = {}, id = null) {
    const stored = await readJsonFile(assetsPath(root, config, id));
    return Array.isArray(stored?.assets) ? stored.assets : [];
}

/**
 * Имя файла без пути и без расширения.
 * @param {string} file
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
function baseName(file) {
    const rel = String(file ?? '').trim().replace(/\\/g, '/');
    if (!rel) return '';
    return path.posix.basename(rel, path.posix.extname(rel)).toLowerCase();
}

/**
 * Векторная графика проекта: файлы SVG, которые нарисовал редактор.
 *
 * @param {string} root
 * @param {object|null} plan
 * @returns {Promise<string[]>}
 * @exports
 * @ai.hint io
 */
export async function assetFiles(root, plan = null) {
    const files = new Set();
    for (const step of stepsForRole(plan, 'editor')) {
        for (const file of Array.isArray(step?.files) ? step.files : []) {
            const rel = String(file ?? '').trim().replace(/\\/g, '/');
            if (!rel.toLowerCase().endsWith('.svg')) continue;
            const there = await stat(path.join(root, rel)).then((info) => info.isFile()).catch(() => false);
            if (there) files.add(rel);
        }
    }
    return [...files].sort();
}

/**
 * Ассеты, которые роль поставила на места: путь и имя файла.
 *
 * @param {object} result отчёт стадии
 * @returns {Array<{ path: string, name: string, bytes: number|null }>}
 * @exports
 * @ai.hint pure
 */
export function placedAssets(result = {}) {
    const out = [];
    const seen = new Set();
    for (const report of Array.isArray(result?.steps) ? result.steps : []) {
        const files = [
            ...(Array.isArray(report?.files) ? report.files : []),
            ...(Array.isArray(report?.applied?.written) ? report.applied.written : []),
            ...(Array.isArray(report?.applied?.own) ? report.applied.own : []),
        ];
        for (const item of files) {
            const rel = typeof item === 'string' ? item : String(item?.path ?? '').trim();
            if (!rel || seen.has(rel)) continue;
            seen.add(rel);
            out.push({
                path: rel.replace(/\\/g, '/'),
                name: baseName(rel),
                bytes: typeof item?.bytes === 'number' ? item.bytes : null,
            });
        }
    }
    return out;
}

/**
 * Стадия ассетов.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null, apply?: boolean,
 *   notify?: (event: object) => void, env?: object, input?: object|null, runContext?: object|null }} request
 * @returns {Promise<object>} отчёт стадии
 * @exports
 * @ai.hint io
 */
export async function assetsStage({
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
    const pictures = Array.isArray(inputs?.pictures) ? inputs.pictures : [];
    const vectors = await assetFiles(root, plan);
    const settings = config?.pictures ?? {};
    const assetsDir = String(settings.assetsDir ?? 'assets').replace(/\/+$/, '');

    if (!pictures.length && !vectors.length) {
        const reason = 'Картинки не готовы и вектор не нарисован: раскладывать нечего.';
        return {
            stage: 'assets',
            ok: true,
            skipped: true,
            assets: [],
            warnings: [reason],
            text: reason,
        };
    }

    // Шаг роли: свой шаг плана, если план его назвал, иначе шаг самой стадии.
    const steps = stepsForRole(plan, 'illustrator');
    const own = steps.length
        ? steps
        : [{
            id: 'assets',
            title: 'Put the pictures of the project on their places',
            role: 'illustrator',
            files: [],
            criteria: [
                'Every prepared picture is on its place under the asset directory.',
                'No picture is on the disk twice: the cut-out and the drawn vector are one object.',
            ],
        }];
    const work = { ...(plan ?? {}), steps: [...(Array.isArray(plan?.steps) ? plan.steps : []), ...own] };

    const result = await runStepStage({
        client,
        config,
        root,
        task,
        role: 'illustrator',
        plan: work,
        brief,
        inputs,
        runId: id,
        apply,
        notify,
        env,
        input,
        runContext,
        context: {
            pictures,
            vectors,
            assetsDir,
        },
    });

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
        if (cut) {
            result.warnings.push(`${vector} повторяет подготовленную картинку ${cut.file}: одно и то же показано дважды.`);
        }
    }

    result.assets = final;
    // The assets go to the disk: a resumed run skips this stage, and the roles after it
    // need to know where the pictures lie.
    await writeAssets(root, config, id, final).catch(() => {});
    result.text = final.length
        ? final.map((item) => `- ${item.name} → ${item.file}`).join('\n')
        : 'Ассеты не перемещены.';
    return result;
}
