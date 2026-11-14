/**
 * @file src/inputs/crops.js
 * @module inputs/crops
 * @purpose Find the file of a crop of the reference on the disk.
 *
 *   The sheet of the measurements names the crops the way the measurer saw them:
 *   `crops/08-region-bishop-artwork.png`, relative to the directory of the run of the
 *   measurer. The file may live there, next to the sheet, in the working directory of the
 *   project or anywhere below it.
 *
 *   The search is by name and by place: the path as it is, then the path relative to the
 *   sheet, then the file with that name under the working directory and under the project.
 *
 * @depends node:path, node:fs/promises, agent/paths
 * @usedBy stages/pictures
 * @exports cropCandidates, resolveCropFile, cropName
 * @ai.tags inputs, crops, images
 * @ai.hint io
 */

import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { NOISY_DIRS, toPosix } from '../agent/paths.js';

/**
 * The name of a crop: the file name without the extension.
 * @param {string} crop the path of the crop
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function cropName(crop) {
    const base = path.basename(String(crop ?? '').replace(/\\/g, '/'));
    return base.replace(/\.[^.]+$/, '');
}

/**
 * The places the crop may be found, in the order they are tried.
 *
 * @param {string} root the project directory
 * @param {string} crop the path of the crop, as the sheet names it
 * @param {{ sheetDir?: string, workDir?: string }} [options]
 * @returns {string[]} the absolute paths
 * @exports
 * @ai.hint pure
 */
export function cropCandidates(root, crop, { sheetDir = '', workDir = '' } = {}) {
    const wanted = String(crop ?? '').replace(/\\/g, '/').trim();
    if (!wanted) return [];
    const base = path.resolve(root);
    const out = [];
    const push = (value) => {
        const full = path.resolve(value);
        if (!out.includes(full)) out.push(full);
    };
    push(path.join(base, wanted));
    if (sheetDir) push(path.resolve(base, sheetDir, wanted));
    if (workDir) push(path.resolve(base, workDir, wanted));
    return out;
}

/**
 * Find the file of a crop.
 *
 * The search walks the working directory and the project, up to four levels deep, and looks
 * for the name of the file. The first hit wins; the noisy directories are skipped.
 *
 * @param {string} root the project directory
 * @param {string} crop the path of the crop, as the sheet names it
 * @param {{ sheetDir?: string, workDir?: string, depth?: number }} [options]
 * @returns {Promise<string|null>} the absolute path of the file
 * @exports
 * @ai.hint io
 */
export async function resolveCropFile(root, crop, { sheetDir = '', workDir = '', depth = 4 } = {}) {
    const wanted = String(crop ?? '').replace(/\\/g, '/').trim();
    if (!wanted) return null;

    for (const candidate of cropCandidates(root, wanted, { sheetDir, workDir })) {
        const info = await stat(candidate).catch(() => null);
        if (info?.isFile()) return candidate;
    }

    const name = path.basename(wanted);
    const bases = [path.join(path.resolve(root), workDir || '.tmp'), path.resolve(root)];
    for (const base of bases) {
        const found = await findByName(base, name, depth);
        if (found) return found;
    }
    return null;
}

/**
 * Look for a file by its name under a directory.
 * @param {string} dir
 * @param {string} name
 * @param {number} depth how deep to descend
 * @returns {Promise<string|null>}
 * @ai.hint io
 */
async function findByName(dir, name, depth) {
    let entries = [];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === name) return full;
    }
    if (depth <= 0) return null;
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') && entry.name !== '.ai') continue;
        if (NOISY_DIRS.test(entry.name)) continue;
        const found = await findByName(path.join(dir, entry.name), name, depth - 1);
        if (found) return found;
    }
    return null;
}

/**
 * The path of a file relative to the project, with slashes.
 * @param {string} root
 * @param {string} file
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function cropRelative(root, file) {
    return toPosix(path.relative(path.resolve(root), path.resolve(file)));
}
