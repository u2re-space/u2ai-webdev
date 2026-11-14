/**
 * @file src/inputs/references.js
 * @module inputs/references
 * @purpose The reference of the design: the screenshots that the roles have to look at.
 *
 *   The measurements say how wide a block is, but they do not say how the page looks. The
 *   roles see the reference itself — the screenshot of the design — so the markup and the
 *   styles follow the picture, not only the numbers.
 *
 *   The reference is found by the name: a file the task names, a file whose name says that
 *   it is a reference (`landing`, `reference`, `screenshot`, `mockup`, `design`), or a file
 *   of `.ai/refs/`. A file the config names is the reference, whatever its name is.
 *
 * @depends node:path, node:fs/promises, inputs/assets, openai/responses
 * @usedBy inputs/index, stages/step, stages/review
 * @exports REFERENCE_HINTS, findReferences, readReferences
 * @ai.tags inputs, reference, pictures
 * @ai.hint io
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { listImages } from './assets.js';
import { imagePart } from '../openai/responses.js';

/** The names of a file that says that it is the reference of the design. */
export const REFERENCE_HINTS = /(?:^|[-_.\s])(?:landing|reference|ref|screenshot|mockup|design|макет|референс)(?:[-_.\s]|$)/i;

/** The extensions of a reference, from the best to the worst. */
const EXTENSION_PRIORITY = Object.freeze(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.bmp']);

/**
 * The name of a file without its extension.
 * @param {string} file
 * @returns {string}
 * @ai.hint pure
 */
function baseName(file) {
    return path.basename(String(file ?? '')).replace(/\.[^.]+$/, '').toLowerCase();
}

/**
 * The extension of a file, from the best to the worst.
 * @param {string} file
 * @returns {number}
 * @ai.hint pure
 */
function extensionRank(file) {
    const ext = path.extname(String(file ?? '')).toLowerCase();
    const index = EXTENSION_PRIORITY.indexOf(ext);
    return index === -1 ? EXTENSION_PRIORITY.length : index;
}

/**
 * Find the reference of the design.
 *
 * The config names it first: `inputs.reference` is a path or a list of paths. Then come the
 * pictures the task names and the pictures whose name says that they are a reference. A file
 * of `.ai/refs/` is always a reference.
 * @param {{ root: string, config?: object, task?: string, limit?: number }} options
 * @returns {Promise<Array<{ path: string, mime: string, bytes: number }>>}
 * @exports
 * @ai.hint io
 */
export async function findReferences({ root, config = {}, task = '', limit = 4 } = {}) {
    const wanted = String(task ?? '').toLowerCase();
    const found = new Map();

    const take = (item, score) => {
        const key = baseName(item.path);
        const previous = found.get(key);
        // The same picture in two formats is one picture: the better one wins.
        if (previous && extensionRank(previous.path) <= extensionRank(item.path)) return;
        found.set(key, { ...item, score });
    };

    // The config names the reference.
    const configured = config?.inputs?.reference ?? null;
    const list = Array.isArray(configured)
        ? configured
        : (typeof configured === 'string' && configured.trim() ? [configured.trim()] : []);
    for (const file of list) {
        const images = await listImages({ root, dir: path.dirname(file), depth: 0, limit: 1 });
        const match = images.find((item) => item.path === path.basename(file));
        if (match) take(match, 100);
    }

    // The pictures of the root and of the directory of the references.
    const rootImages = await listImages({ root, dir: '.', depth: 1, limit: 100 });
    const refs = await listImages({ root, dir: '.ai/refs', depth: 2, limit: 100 });
    for (const item of rootImages) {
        const name = path.basename(item.path).toLowerCase();
        const mentioned = wanted.includes(name);
        const hinted = REFERENCE_HINTS.test(name);
        if (!mentioned && !hinted) continue;
        take(item, mentioned ? 90 : 50);
    }
    for (const item of refs) take(item, 80);

    const out = [...found.values()]
        .sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path))
        .slice(0, Math.max(0, limit));
    return out.map(({ path: file, mime, bytes }) => ({ path: file, mime, bytes }));
}

/**
 * Read the reference of the design and prepare it for a role.
 *
 * The picture goes into the request as it is: the API takes the bytes of the image, not its
 * path. A picture that cannot be read is skipped and reported.
 * @param {string} root
 * @param {Array<{ path: string }>} files
 * @returns {Promise<{ parts: object[], names: string[], warnings: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function readReferences(root, files = []) {
    const parts = [];
    const names = [];
    const warnings = [];
    for (const item of Array.isArray(files) ? files : []) {
        const rel = String(item?.path ?? '').trim();
        if (!rel) continue;
        try {
            const bytes = await readFile(path.join(root, rel));
            const mime = String(item?.mime ?? '').trim()
                || (/\.jpe?g$/i.test(rel) ? 'image/jpeg' : 'image/png');
            parts.push(imagePart(bytes, mime));
            names.push(rel);
        } catch (error) {
            warnings.push(`Референс ${rel} не прочитан: ${error?.message ?? error}`);
        }
    }
    return { parts, names, warnings };
}
