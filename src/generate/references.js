/**
 * @file src/generate/references.js
 * @module generate/references
 * @purpose Stage the references of a run into `.ai/refs/`, so that every tool of the project can
 *          reach them by a project-relative path.
 *
 *   A file that already lives inside the project is not copied: its own path is the path the
 *   roles will use. A file from outside and a downloaded URL are copied into `.ai/refs/` under a
 *   name made of the hash of the content, so the same picture is staged once and a resumed run
 *   finds it already there.
 *
 *   This package has no raster tools: the size of a picture is read from the header of the file,
 *   and nothing else is done to it.
 *
 * @depends node:crypto, node:path, node:fs/promises, agent/paths, inputs/assets
 * @usedBy generate/brief, stages/collect
 * @exports REFS_DIR, stageReferences, stageOneReference, resolveRefPath, imageSize
 * @ai.tags generate, references, staging
 * @ai.hint io
 * @changed 2026-11-16 The size of a picture moved to `inputs/assets.js`: the roles of the
 *                       frontend need it too, and the house has one helper for it.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isInside, toPosix } from '../agent/paths.js';
import { detectImageMime, imageSize } from '../inputs/assets.js';

/** The size of a picture is read by the house: `inputs/assets.js` keeps the helper. */
export { imageSize };

/** The directory under the project root where the staged references live. */
export const REFS_DIR = '.ai/refs';

/** The mime types the staging accepts. */
const SUPPORTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

/**
 * The extension of a mime type.
 * @param {string} mime
 * @returns {string}
 * @ai.hint pure
 */
function extFromMime(mime) {
    switch (mime) {
        case 'image/png': return 'png';
        case 'image/jpeg': return 'jpg';
        case 'image/gif': return 'gif';
        case 'image/webp': return 'webp';
        case 'image/svg+xml': return 'svg';
        default: return 'bin';
    }
}

/**
 * The path of a reference that is already inside the project, or null.
 * @param {string} ref
 * @param {string} root
 * @returns {{ rel: string, abs: string }|null}
 * @exports
 * @ai.hint pure
 */
export function resolveRefPath(ref, root) {
    const text = String(ref ?? '');
    if (!text || /^(?:https?:|data:)/i.test(text)) return null;
    const abs = path.resolve(root, text);
    if (!isInside(root, abs)) return null;
    return { rel: toPosix(path.relative(root, abs)), abs };
}

/**
 * Stage one reference into the project.
 *
 * A local file inside the project keeps its path. Everything else is copied into `.ai/refs/`
 * under the hash of its content.
 * @param {string} ref a path, an http(s) URL or a data URL
 * @param {{ root: string, maxBytes?: number, signal?: AbortSignal|null }} options
 * @returns {Promise<{ rel: string, abs: string, bytes: number, mime: string,
 *   width: number|null, height: number|null }>}
 * @exports
 * @ai.hint io
 */
export async function stageOneReference(ref, { root, maxBytes = 20 * 1024 * 1024, signal = null } = {}) {
    const text = String(ref ?? '').trim();
    if (!text) throw new Error('Пустая ссылка на референс.');

    let bytes = null;
    let mime = null;
    let source = null;

    if (/^data:/i.test(text)) {
        const comma = text.indexOf(',');
        if (comma === -1) throw new Error('Некорректная ссылка data:');
        const header = text.slice(0, comma);
        const payload = text.slice(comma + 1);
        mime = /image\/([a-z0-9.+-]+)/i.exec(header)?.[1]?.toLowerCase();
        mime = mime ? `image/${mime}` : null;
        bytes = header.includes(';base64')
            ? Buffer.from(payload, 'base64')
            : Buffer.from(decodeURIComponent(payload), 'utf8');
    } else if (/^https?:\/\//i.test(text)) {
        const res = await fetch(text, { signal, redirect: 'follow', headers: { 'User-Agent': 'ai-webdev/0.3' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} при загрузке ${text}`);
        const reader = res.body?.getReader();
        if (!reader) {
            bytes = Buffer.from(await res.arrayBuffer());
        } else {
            const chunks = [];
            let total = 0;
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                total += value.length;
                if (total > maxBytes) {
                    await reader.cancel().catch(() => {});
                    throw new Error(`Референс больше лимита ${maxBytes} байт.`);
                }
                chunks.push(Buffer.from(value));
            }
            bytes = Buffer.concat(chunks, total);
        }
        mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() || null;
        mime = detectImageMime('reference', bytes) ?? mime;
    } else {
        const abs = path.resolve(root, text);
        const info = await stat(abs).catch(() => null);
        if (!info?.isFile()) throw new Error(`Файл не найден: ${text}`);
        if (info.size > maxBytes) throw new Error(`Референс ${text} больше лимита ${maxBytes} байт.`);
        bytes = await readFile(abs);
        mime = detectImageMime(abs, bytes);
        source = abs;
    }

    if (!mime || !SUPPORTED_MIMES.has(mime)) {
        throw new Error(`Неподдерживаемый формат референса: ${mime ?? 'неизвестен'}.`);
    }

    const size = imageSize(bytes, mime);

    // A file of the project keeps its own path: nothing is copied for nothing.
    if (source && isInside(root, source)) {
        return {
            rel: toPosix(path.relative(root, source)),
            abs: source,
            bytes: bytes.length,
            mime,
            width: size.width,
            height: size.height,
        };
    }

    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const name = `${hash}.${extFromMime(mime)}`;
    const dir = path.join(root, REFS_DIR);
    const abs = path.join(dir, name);
    await mkdir(dir, { recursive: true });
    // The name is the hash of the content, so the file is the same one on every run.
    await writeFile(abs, bytes).catch(() => {});

    return {
        rel: toPosix(path.join(REFS_DIR, name)),
        abs,
        bytes: bytes.length,
        mime,
        width: size.width,
        height: size.height,
    };
}

/**
 * Stage every reference of a run.
 *
 * A reference that fails does not break the run: it becomes a warning.
 * @param {{ images?: string[], root: string, maxBytes?: number, signal?: AbortSignal|null }} request
 * @returns {Promise<{ refs: object[], warnings: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function stageReferences({ images = [], root, maxBytes = 20 * 1024 * 1024, signal = null } = {}) {
    if (!Array.isArray(images) || !images.length) return { refs: [], warnings: [] };
    const refs = [];
    const warnings = [];
    for (const ref of images) {
        try {
            refs.push(await stageOneReference(ref, { root, maxBytes, signal }));
        } catch (error) {
            warnings.push(`Референс пропущен: ${ref} (${error?.message ?? error})`);
        }
    }
    return { refs, warnings };
}
