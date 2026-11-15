/**
 * @file src/inputs/measuredCrops.js
 * @module inputs/measuredCrops
 * @purpose The crops of the measurer that are on the disk, even without the sheet.
 *
 *   The measurer writes two things about the fragments of the reference: the list of them
 *   (`<delivery>/stages/crops.json`) and the files themselves (`<delivery>/crops/*.png`).
 *   The sheet of the measurements joins the fragments with the numbers, and the sheet is the
 *   last thing the measurer writes: a run that died in the middle leaves the fragments cut
 *   on the disk and no sheet at all.
 *
 *   The stage of the pictures must not lose those fragments: a cut-out that is already cut is
 *   prepared even when the sheet that would name it does not exist.
 *
 *   The kinds of the measurer and the kinds of this package are not the same words: the
 *   measurer says `asset` for a fragment that is worth reusing and `detail` for a fragment
 *   that is worth reading closely, and this package calls a picture an `image`.
 *
 * @depends node:path, node:fs/promises, agent/paths
 * @usedBy stages/pictures
 * @exports measuredCrops, cropKind, cropNameOf, MEASURED_CROPS_FILE, MEASURED_CROPS_DIR
 * @ai.tags inputs, crops, measurements
 * @ai.hint io
 */

import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { toPosix } from '../agent/paths.js';

/** The file of the measurer that lists the crops, relative to the directory of the delivery. */
export const MEASURED_CROPS_FILE = 'stages/crops.json';

/** The directory of the crops of the measurer, relative to the directory of the delivery. */
export const MEASURED_CROPS_DIR = 'crops';

/** The kinds of the measurer that are not pictures: a detail is a piece of the screenshot. */
const NOT_A_PICTURE = new Set(['detail', 'none']);

/**
 * The kind of a crop of the measurer, in the words of this package.
 *
 * `asset` is the fragment that is worth reusing as an asset: it is a picture. `detail` is
 * the fragment that is worth reading closely: it stays a piece of the screenshot. An unknown
 * kind is treated as an asset — the fragment was cut for a reason.
 *
 * @param {string} kind the kind of the measurer
 * @returns {string} the kind of this package
 * @exports
 * @ai.hint pure
 */
export function cropKind(kind) {
    const value = String(kind ?? '').trim().toLowerCase();
    return NOT_A_PICTURE.has(value) ? 'detail' : 'image';
}

/**
 * The kind of a crop by the name of its file.
 *
 * The measurer writes `01-asset-brand-logo.png` and `05-detail-hero-title.png`: the word
 * after the number says what the fragment is.
 *
 * @param {string} file the name of the file of the crop
 * @returns {string} the kind of this package
 * @exports
 * @ai.hint pure
 */
export function cropKindOfFile(file) {
    const match = /^\d+[-_](asset|detail|none)[-_]/i.exec(path.basename(String(file ?? '').replace(/\\/g, '/')));
    return cropKind(match?.[1] ?? 'asset');
}

/**
 * The name of a crop of the measurer: the name of the fragment, without the number and
 * without the kind of the cut.
 *
 * `01-asset-brand-logo.png` becomes `brand-logo`.
 *
 * @param {string} file the path or the name of the file of the crop
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function cropNameOf(file) {
    const base = path.basename(String(file ?? '').replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
    return base
        .replace(/^\d+[-_]*/, '')
        .replace(/^(asset|detail|none)[-_]*/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * The list of the crops of the measurer, read from its file.
 *
 * @param {string} root the project directory
 * @param {string} dir the directory of the delivery
 * @returns {Promise<object[]>}
 * @ai.hint io
 */
async function readCropList(root, dir) {
    const file = path.resolve(root, dir, MEASURED_CROPS_FILE);
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return [];
    let data = null;
    try {
        data = JSON.parse(text);
    } catch {
        return [];
    }
    const crops = Array.isArray(data?.crops) ? data.crops : [];
    return crops
        .map((item) => ({
            name: String(item?.name ?? '').trim() || cropNameOf(item?.crop ?? ''),
            kind: cropKind(item?.kind),
            crop: toPosix(String(item?.crop ?? '').trim()),
            use: String(item?.use ?? '').trim(),
        }))
        .filter((item) => item.crop);
}

/**
 * The crops of the measurer, read from the files themselves.
 *
 * The list of the measurer is better — it knows the kind and the use of every fragment —
 * but the files may be there without it.
 *
 * @param {string} root the project directory
 * @param {string} dir the directory of the delivery
 * @returns {Promise<object[]>}
 * @ai.hint io
 */
async function readCropFiles(root, dir) {
    const folder = path.resolve(root, dir, MEASURED_CROPS_DIR);
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp|gif|avif)$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort()
        .map((name) => ({
            name: cropNameOf(name),
            kind: cropKindOfFile(name),
            crop: toPosix(path.join(MEASURED_CROPS_DIR, name)),
            use: '',
        }));
}

/**
 * The crops of the measurer that are on the disk.
 *
 * The directories are tried in the order they are given, and the first one that holds crops
 * wins. In every directory the list of the measurer comes first and the files come after it.
 *
 * @param {string} root the project directory
 * @param {{ dirs?: string[] }} [options] the directories of the delivery
 * @returns {Promise<{ dir: string, crops: object[] }|null>} the crops and the directory they
 *   lie in, or null when there are none
 * @exports
 * @ai.hint io
 */
export async function measuredCrops(root, { dirs = [] } = {}) {
    for (const item of Array.isArray(dirs) ? dirs : []) {
        const dir = String(item ?? '').trim() || '.';
        const list = await readCropList(root, dir);
        if (list.length) return { dir, crops: list };
        const files = await readCropFiles(root, dir);
        if (files.length) return { dir, crops: files };
    }
    return null;
}
