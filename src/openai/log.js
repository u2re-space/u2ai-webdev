/**
 * @file src/openai/log.js
 * @module openai/log
 * @purpose The log of the API calls: one JSON record per request.
 *
 *   A chain that misbehaves is read, not guessed at. The record says which host was asked,
 *   what went out, what came back, how long the model thought and where it broke. Without
 *   it a run that fails says only "failed".
 *
 *   The pictures are not written into the record: the body of an image is megabytes of
 *   base64, and it is the same picture every time. The record says how big it was.
 *
 * @depends node:path, node:fs/promises
 * @usedBy openai/client
 * @exports createApiLogger, redactBody
 * @ai.tags openai, log, debug
 * @ai.hint io
 */

import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

/**
 * The depth of the walk over a body. A request body is shallow; a deep one is a cycle.
 */
const MAX_DEPTH = 12;

/**
 * Replace the pictures of a body with a note about their size.
 *
 * @param {unknown} value the value to walk
 * @param {number} [depth] how deep the walk is
 * @returns {unknown}
 * @exports
 * @ai.hint pure
 */
export function redactBody(value, depth = 0) {
    if (depth > MAX_DEPTH) return '…';
    if (typeof value === 'string') {
        if (!value.startsWith('data:')) return value;
        const comma = value.indexOf(',');
        const head = comma >= 0 ? value.slice(0, comma + 1) : value.slice(0, 32);
        return `${head}<${value.length} bytes of base64>`;
    }
    if (Array.isArray(value)) return value.map((item) => redactBody(item, depth + 1));
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, item] of Object.entries(value)) out[key] = redactBody(item, depth + 1);
        return out;
    }
    return value;
}

/**
 * The logger of the API calls.
 *
 * @param {{ dir?: string|null, cwd?: string, now?: () => Date }} [options]
 *   `dir` is the directory of the records; `null` turns the logging off.
 * @returns {{ dir: string, write: (record: object) => Promise<string> }|null}
 * @exports
 * @ai.hint io
 */
export function createApiLogger({ dir = null, cwd = process.cwd(), now = () => new Date() } = {}) {
    const clean = String(dir ?? '').trim();
    if (!clean) return null;
    const root = path.resolve(cwd, clean);
    let counter = 0;

    /**
     * Write one record.
     * @param {object} record the record of the call
     * @returns {Promise<string>} the file the record is in
     * @ai.hint io
     */
    async function write(record) {
        counter += 1;
        const at = now();
        const stamp = at.toISOString().replace(/[:.]/g, '-');
        const file = path.join(root, `${stamp}-${String(counter).padStart(3, '0')}.json`);
        const body = `${JSON.stringify({ at: at.toISOString(), ...record }, null, 2)}\n`;
        await mkdir(root, { recursive: true });
        await writeFile(file, body, 'utf-8');
        return file;
    }

    return { dir: root, write };
}
