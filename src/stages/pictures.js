/**
 * @file src/stages/pictures.js
 * @module stages/pictures
 * @purpose Prepare the crops of the reference that are pictures.
 *
 *   The measurer cuts the reference into rectangles: the chess piece, the board, the badge.
 *   A crop is a piece of the screenshot — the page around it is still in the picture. The
 *   roles do not need that: they need the object.
 *
 *   The stage takes the crops the sheet names, keeps the ones whose kind says "this is a
 *   picture", and gives them to the sibling CLI `ai-image`: the background goes away, the
 *   object stays. The result lands in the project, and the roles get the path of it in the
 *   context of the run.
 *
 *   A picture that cannot be prepared is not a reason to stop the run: the stage says what
 *   happened and the crop stays as it was.
 *
 * @depends node:path, node:fs/promises, inputs/crops, agent/bridges, agent/paths
 * @usedBy stages/index, pipeline
 * @exports picturesStage, pictureName, pictureKinds
 * @ai.tags stages, pictures, images
 * @ai.hint io
 * @changed 2026-11-14 The crops of the reference are prepared with `ai-image`.
 */

import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { resolveCropFile, cropRelative } from '../inputs/crops.js';
import { runBridge, bridgeEnabled } from '../agent/bridges.js';

/** The kinds of the crops that are pictures, when the config says nothing else. */
export const pictureKinds = Object.freeze(['image', 'illustration', 'artwork', 'photo', 'ornament']);

/** The prompt of the command `edit`, when the config says nothing else. */
const DEFAULT_PROMPT = 'Cut the object out of the picture: keep the object as it is, remove the '
    + 'background, make the background transparent, keep the edges of the object clean.';

/**
 * The name of a prepared picture: the name of the crop, cleaned up.
 *
 * `08-region-bishop-artwork.png` becomes `bishop-artwork`: the number and the kind of the
 * cut are the business of the measurer, not of the project.
 *
 * @param {string} crop the path of the crop
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function pictureName(crop) {
    const base = path.basename(String(crop ?? '').replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
    return base
        .replace(/^\d+[-_]*/, '')
        .replace(/^(region|element|crop)[-_]*/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'picture';
}

/**
 * The crops of the sheet that are pictures.
 *
 * The sheet names the same crop twice sometimes — once as an element, once as a region —
 * so the crops are taken by their path, and the first name wins.
 *
 * @param {object} sheet the result of `parseMeasurements`
 * @param {string[]} kinds the kinds that are pictures
 * @returns {Array<{ name: string, kind: string, crop: string, use: string }>}
 * @exports
 * @ai.hint pure
 */
export function pictureCrops(sheet, kinds = pictureKinds) {
    const list = Array.isArray(kinds) ? kinds.map((item) => String(item).toLowerCase()) : [...pictureKinds];
    const wanted = list.length ? new Set(list) : null;
    const out = [];
    const seen = new Set();
    const items = [
        ...(Array.isArray(sheet?.elements) ? sheet.elements : []),
        ...(Array.isArray(sheet?.regions) ? sheet.regions : []),
    ];
    for (const item of items) {
        const crop = String(item?.crop ?? '').trim();
        if (!crop || seen.has(crop)) continue;
        const kind = String(item?.kind ?? '').trim().toLowerCase();
        if (wanted && !wanted.has(kind)) continue;
        seen.add(crop);
        out.push({
            name: String(item?.name ?? '').trim() || pictureName(crop),
            kind,
            crop,
            use: String(item?.use ?? '').trim(),
        });
    }
    return out;
}

/**
 * The stage of the pictures: the crops are prepared with `ai-image`.
 *
 * @param {{ root?: string, config?: object, inputs?: object|null, env?: object,
 *   notify?: (event: object) => void, apply?: boolean }} request
 * @returns {Promise<{ stage: string, ok: boolean, skipped: boolean, pictures: object[],
 *   warnings: string[], text: string }>}
 * @exports
 * @ai.hint io
 */
export async function picturesStage({
    root = process.cwd(),
    config = {},
    inputs = null,
    env = process.env,
    notify = () => {},
    apply = true,
} = {}) {
    const settings = config?.pictures ?? {};
    const warnings = [];
    const sheet = inputs?.measurements ?? null;

    if (settings.enabled === false) {
        return skipped('Подготовка картинок выключена в конфиге.');
    }
    if (!sheet?.present) {
        return skipped('Лист измерений не найден: обрезки не готовятся.');
    }
    if (!bridgeEnabled(config, 'ai-image')) {
        return skipped('Мост ai-image выключен: обрезки остаются как есть.');
    }

    const kinds = Array.isArray(settings.kinds) && settings.kinds.length ? settings.kinds : pictureKinds;
    const crops = pictureCrops(sheet, kinds);
    if (!crops.length) {
        return skipped('В листе измерений нет обрезков-картинок.');
    }

    const limit = Number.isSafeInteger(settings.max) && settings.max > 0 ? settings.max : 6;
    const sheetFile = String(config?.inputs?.measurements ?? 'measurements.json');
    const sheetDir = path.dirname(sheetFile);
    const workDir = String(config?.output?.work ?? '.tmp');
    const target = apply ? String(settings.dir ?? 'assets/import') : path.join(workDir, 'pictures');

    const pictures = [];
    for (const crop of crops.slice(0, limit)) {
        const source = await resolveCropFile(root, crop.crop, { sheetDir, workDir });
        if (!source) {
            warnings.push(`Обрезок не найден на диске: ${crop.crop}`);
            continue;
        }
        const name = pictureName(crop.crop);
        const out = path.join(target, `${name}.png`);
        await mkdir(path.join(root, target), { recursive: true });

        // The picture that is already there is not prepared again: the model is not asked
        // for the same cut twice.
        const ready = await stat(path.join(root, out)).catch(() => null);
        if (ready?.isFile() && ready.size > 0) {
            pictures.push({
                name: crop.name,
                kind: crop.kind,
                source: cropRelative(root, source),
                file: cropRelative(root, path.join(root, out)),
                bytes: ready.size,
                use: crop.use,
            });
            continue;
        }

        const command = String(settings.commands?.[crop.kind] ?? settings.command ?? 'background');
        const args = [command, path.relative(root, source).split(path.sep).join('/')];
        if (command === 'edit') {
            args.push(String(settings.prompts?.[crop.kind] ?? settings.prompts?.default ?? DEFAULT_PROMPT));
        }
        args.push('--out', out.split(path.sep).join('/'));
        if (command === 'background' || command === 'alpha') {
            args.push('--alpha-mode', String(settings.alphaMode ?? 'auto'));
        }

        const result = await runBridge({ name: 'ai-image', args, config, cwd: root, env });
        if (result.skipped) {
            warnings.push('Мост ai-image выключен: обрезки остаются как есть.');
            break;
        }
        const written = await stat(path.join(root, out)).catch(() => null);
        if (!result.ok || !written?.isFile()) {
            const detail = (result.stderr || result.stdout || result.reason || '').trim().split('\n')[0];
            warnings.push(`Обрезок не подготовлен (${crop.name}): ${detail || 'неизвестная причина'}`);
            continue;
        }

        const file = cropRelative(root, path.join(root, out));
        pictures.push({
            name: crop.name,
            kind: crop.kind,
            source: cropRelative(root, source),
            file,
            bytes: written.size,
            use: crop.use,
        });
        notify({ type: 'picture.ready', name: crop.name, kind: crop.kind, file });
    }

    const skippedRest = crops.length > limit ? [`Обрезков больше, чем лимит (${limit}).`] : [];
    const all = [...warnings, ...skippedRest];
    const text = pictures.length
        ? pictures.map((item) => `- ${item.name} (${item.kind}) → ${item.file}`).join('\n')
        : 'Картинки не подготовлены.';

    return {
        stage: 'pictures',
        ok: true,
        skipped: pictures.length === 0,
        pictures,
        warnings: all,
        text,
    };
}

/**
 * The answer of a stage that has nothing to do.
 * @param {string} reason
 * @returns {{ stage: string, ok: boolean, skipped: boolean, pictures: object[], warnings: string[], text: string }}
 * @ai.hint pure
 */
function skipped(reason) {
    return {
        stage: 'pictures',
        ok: true,
        skipped: true,
        pictures: [],
        warnings: [reason],
        text: reason,
    };
}
