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
 * @depends node:path, node:fs/promises, inputs/crops, inputs/candidates, agent/bridges,
 *          agent/paths
 * @usedBy stages/index, pipeline
 * @exports picturesStage, pictureName, pictureCrops, pictureSubject, pictureKinds,
 *          PICTURES_FILE, picturesPath, writePictures, readPictures
 * @ai.tags stages, pictures, images
 * @ai.hint io
 * @changed 2026-11-14 The crops of the reference are prepared with `ai-image`.
 * @changed 2026-11-15 The crops are looked for next to the sheet that was found.
 */

import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { resolveCropFile, cropRelative } from '../inputs/crops.js';
import { inputCandidates } from '../inputs/candidates.js';
import { runBridge, bridgeEnabled } from '../agent/bridges.js';
import { runFile, writeJsonFile, readJsonFile } from './workspace.js';

/** The file of the run that holds the prepared pictures. */
export const PICTURES_FILE = 'pictures.json';

/**
 * The path of the file of the prepared pictures.
 * @param {string} root
 * @param {object} config
 * @param {string} [id]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function picturesPath(root, config = {}, id = null) {
    return runFile(root, config, id, PICTURES_FILE);
}

/**
 * Write the prepared pictures into the directory of the run.
 *
 * A resumed run skips the stage of the pictures, so the list of them is read back from
 * here: the roles of the later stages have to know where the pictures are.
 *
 * @param {string} root
 * @param {object} config
 * @param {string} [id]
 * @param {object[]} pictures
 * @returns {Promise<string>} the path of the file
 * @exports
 * @ai.hint io
 */
export async function writePictures(root, config = {}, id = null, pictures = []) {
    return await writeJsonFile(picturesPath(root, config, id), { pictures });
}

/**
 * Read the prepared pictures of a run. A missing file gives an empty list.
 * @param {string} root
 * @param {object} config
 * @param {string} [id]
 * @returns {Promise<object[]>}
 * @exports
 * @ai.hint io
 */
export async function readPictures(root, config = {}, id = null) {
    const stored = await readJsonFile(picturesPath(root, config, id));
    return Array.isArray(stored?.pictures) ? stored.pictures : [];
}

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
 * The subject of the cut-out: what the model has to keep.
 *
 * A crop of a screenshot holds more than the object: the piece of the neighbour that fell
 * into the cut. The subject names the object, so the model knows what has to stay and what
 * has to go.
 *
 * @param {{ name?: string, kind?: string, use?: string }} crop the crop of the sheet
 * @param {object} [settings] the section `pictures` of the config
 * @returns {string} the subject, or an empty string when there is nothing to say
 * @exports
 * @ai.hint pure
 */
export function pictureSubject(crop = {}, settings = {}) {
    const template = String(settings.subjects?.[crop?.kind] ?? settings.subject ?? '').trim();
    if (!template) return '';
    // The words that name the kind of the cut describe the crop, not the object.
    const name = String(crop?.name ?? '')
        .replace(/\b(artwork|picture|image|photo|region|element|crop|reference|screenshot)s?\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return template
        .replace(/\{name\}/g, name)
        .replace(/\{use\}/g, String(crop?.use ?? ''))
        .replace(/\{kind\}/g, String(crop?.kind ?? ''))
        .replace(/\s+/g, ' ')
        .trim();
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
 *   notify?: (event: object) => void, apply?: boolean, runId?: string|null }} request
 * @returns {Promise<{ stage: string, ok: boolean, skipped: boolean, pictures: object[],
 *   warnings: string[], text: string, file: string|null }>}
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
    runId: id = null,
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
    // Лист, который нашли: обрезки лежат рядом с ним, а не в корне проекта.
    const sheetFile = String(inputs?.files?.measurements
        ?? inputCandidates(config?.inputs?.measurements, 'measurements')[0]
        ?? 'measurements.json');
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
        // The subject tells the model what to keep: the fragments of the neighbours go away.
        const subject = pictureSubject(crop, settings);
        const args = [command, path.relative(root, source).split(path.sep).join('/')];
        if (command === 'edit') {
            let prompt = String(settings.prompts?.[crop.kind] ?? settings.prompts?.default ?? DEFAULT_PROMPT);
            if (subject) prompt += ` Keep only the ${subject}; every other object disappears.`;
            args.push(prompt);
        }
        args.push('--out', out.split(path.sep).join('/'));
        if (command === 'background' || command === 'alpha') {
            args.push('--alpha-mode', String(settings.alphaMode ?? 'auto'));
            if (subject) args.push('--subject', subject);
        }
        // The model of the pictures: null keeps the model of the configuration of `ai-image`.
        const model = String(settings.model ?? '').trim();
        if (model) args.push('--image-model', model);

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

    // The pictures go to the disk: a resumed run skips this stage and needs them.
    const file = await writePictures(root, config, id, pictures).catch((error) => {
        warnings.push(`Картинки не записаны: ${error?.message ?? error}`);
        return null;
    });

    return {
        stage: 'pictures',
        ok: true,
        skipped: pictures.length === 0,
        pictures,
        warnings: all,
        text,
        file,
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
