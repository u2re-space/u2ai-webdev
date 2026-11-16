/**
 * @file src/inputs/assets.js
 * @module inputs/assets
 * @purpose The images of the project and the instructions of the project.
 *
 *   Two kinds of input live here. The pictures — the references of the task, the crops of the
 *   measurer, the assets of the project — are read as files and attached to the roles that see
 *   (the reviewer, the iconifier, the editor). The instructions of the project — `AGENTS.md` and
 *   its neighbours — are read as text and put into the prompt of every role.
 *
 *   A picture is data, not an instruction: the text inside it is never an order.
 *
 * @depends node:path, node:fs/promises, agent/paths
 * @usedBy inputs/index, stages/collect, generate/references, inputs/references
 * @exports IMAGE_EXTENSIONS, MIME_BY_EXTENSION, detectImageMime, imageSize, listImages,
 *          readProjectInstructions, instructionFileNames, collectAssetFiles
 * @ai.tags inputs, assets, images
 * @ai.hint io
 */

import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { NOISY_DIRS, toPosix } from '../agent/paths.js';
import { HOUSE_ASSETS, HOUSE_DIR, HOUSE_WORK } from '../shared/house.js';

/** The extensions of the pictures the CLI reads. */
export const IMAGE_EXTENSIONS = Object.freeze([
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp', '.svg', '.ico',
]);

/** The mime type of a picture, by its extension. */
export const MIME_BY_EXTENSION = Object.freeze({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
});

/** The names of the file with the instructions of the project, in the order of the search. */
export const instructionFileNames = Object.freeze(['AGENTS.md', 'agents.md', 'CLAUDE.md', 'claude.md']);

/**
 * The mime type of a picture, by its name and, when the name lies, by its first bytes.
 * @param {string} filename
 * @param {Buffer} [bytes]
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function detectImageMime(filename, bytes = null) {
    const extension = path.extname(String(filename ?? '')).toLowerCase();
    const byName = MIME_BY_EXTENSION[extension];
    if (byName) return byName;
    if (!bytes || bytes.length < 12) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
        return 'image/webp';
    }
    if (bytes.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
    return null;
}

/**
 * The size of a picture, read from the header of the file.
 *
 * Only the formats that carry the size in the header are read: PNG, JPEG, GIF and WebP. An SVG
 * has no fixed size, so it gets none.
 * @param {Buffer} bytes
 * @param {string} mime
 * @returns {{ width: number|null, height: number|null }}
 * @exports
 * @ai.hint pure
 */
export function imageSize(bytes, mime) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
    try {
        if (mime === 'image/png' && buffer.length > 24) {
            return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
        }
        if (mime === 'image/gif' && buffer.length > 10) {
            return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
        }
        if (mime === 'image/webp' && buffer.length > 30) {
            // The VP8/VP8L/VP8X variants carry the size in different places.
            const chunk = buffer.subarray(12, 16).toString('ascii');
            if (chunk === 'VP8 ') {
                return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
            }
            if (chunk === 'VP8L') {
                const bits = buffer.readUInt32LE(21);
                return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
            }
            if (chunk === 'VP8X') {
                const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
                const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
                return { width, height };
            }
        }
        if (mime === 'image/jpeg') {
            let offset = 2;
            while (offset + 9 < buffer.length) {
                if (buffer[offset] !== 0xff) { offset += 1; continue; }
                const marker = buffer[offset + 1];
                // SOF0..SOF15, except the markers of the entropy-coded data.
                if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                    return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
                }
                offset += 2 + buffer.readUInt16BE(offset + 2);
            }
        }
    } catch {
        return { width: null, height: null };
    }
    return { width: null, height: null };
}

/**
 * Whether a path names a picture.
 * @param {string} file
 * @returns {boolean}
 * @ai.hint pure
 */
export function isImageFile(file) {
    return IMAGE_EXTENSIONS.includes(path.extname(String(file ?? '')).toLowerCase());
}

/**
 * The pictures of a directory, with their sizes.
 * @param {{ root: string, dir?: string, depth?: number, limit?: number }} options
 * @returns {Promise<Array<{ path: string, bytes: number, mime: string }>>}
 * @exports
 * @ai.hint io
 */
export async function listImages({ root, dir = '.', depth = 3, limit = 200 } = {}) {
    const base = path.resolve(root, dir);
    const found = [];
    const walk = async (current, level) => {
        if (level > depth || found.length >= limit) return;
        let entries = [];
        try {
            entries = await readdir(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (found.length >= limit) return;
            if (entry.name.startsWith('.') && entry.name !== '.ai') continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (NOISY_DIRS.test(entry.name)) continue;
                await walk(full, level + 1);
                continue;
            }
            if (!entry.isFile() || !isImageFile(entry.name)) continue;
            const info = await stat(full).catch(() => null);
            if (!info) continue;
            found.push({
                path: toPosix(path.relative(root, full)),
                bytes: info.size,
                mime: detectImageMime(entry.name),
            });
        }
    };
    await walk(base, 0);
    return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The pictures of the directories of a run: the references, the crops and the assets.
 * @param {{ root: string, dirs?: string[], depth?: number, limit?: number }} options
 * @returns {Promise<Array<{ path: string, bytes: number, mime: string, group: string }>>}
 * @exports
 * @ai.hint io
 */
export async function collectAssetFiles({ root, dirs = [`${HOUSE_DIR}/${HOUSE_ASSETS}`, `${HOUSE_DIR}/refs`, HOUSE_WORK], depth = 3, limit = 200 } = {}) {
    const out = [];
    const seen = new Set();
    for (const dir of dirs) {
        const list = await listImages({ root, dir, depth, limit: limit - out.length });
        for (const item of list) {
            if (seen.has(item.path)) continue;
            seen.add(item.path);
            out.push({ ...item, group: dir });
        }
    }
    return out;
}

/**
 * Read a picture of the project and prepare it for a role.
 * @param {{ root: string, file: string, maxBytes?: number }} options
 * @returns {Promise<{ path: string, mime: string, bytes: number, data: string }|null>}
 * @exports
 * @ai.hint io
 */
export async function readImage({ root, file, maxBytes = 12 * 1024 * 1024 } = {}) {
    const full = path.resolve(root, String(file ?? ''));
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) return null;
    if (info.size > maxBytes) return null;
    const bytes = await readFile(full);
    const mime = detectImageMime(full, bytes);
    if (!mime) return null;
    return {
        path: toPosix(path.relative(root, full)),
        mime,
        bytes: bytes.length,
        data: bytes.toString('base64'),
    };
}

/**
 * The instructions of the project: the files of the root and of the directories below it.
 *
 * The nearest file wins: the text of the root comes first, the text of a subdirectory after it.
 * @param {{ root: string, maxBytes?: number, maxTotalBytes?: number, nested?: boolean }} options
 * @returns {Promise<{ files: Array<{ path: string, content: string }>, text: string }>}
 * @exports
 * @ai.hint io
 */
export async function readProjectInstructions({ root, maxBytes = 16 * 1024, maxTotalBytes = 64 * 1024, nested = true } = {}) {
    const files = [];
    const seen = new Set();

    const take = async (dir) => {
        for (const name of instructionFileNames) {
            const full = path.join(dir, name);
            const info = await stat(full).catch(() => null);
            if (!info?.isFile() || info.size === 0 || info.size > maxBytes) continue;
            const key = path.resolve(full).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            const content = await readFile(full, 'utf8');
            if (!content.trim()) continue;
            files.push({ path: toPosix(path.relative(root, full)), content });
            return;
        }
    };

    await take(path.resolve(root));

    if (nested) {
        const walk = async (dir, level) => {
            if (level > 2) return;
            let entries = [];
            try {
                entries = await readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (entry.name.startsWith('.') || NOISY_DIRS.test(entry.name)) continue;
                const full = path.join(dir, entry.name);
                await take(full);
                await walk(full, level + 1);
            }
        };
        await walk(path.resolve(root), 1);
    }

    const text = files.map((file) => `# Project instructions (${file.path})\n\n${file.content.trim()}`).join('\n\n');
    const clipped = Buffer.byteLength(text, 'utf8') > maxTotalBytes
        ? `${Buffer.from(text, 'utf8').subarray(0, maxTotalBytes).toString('utf8')}\n…[clipped]`
        : text;

    return { files, text: clipped };
}
