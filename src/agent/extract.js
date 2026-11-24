/**
 * @file src/agent/extract.js
 * @module agent/extract
 * @purpose Cut a fragment of a file out of the working directory: a line range, a symbol or a
 *          pattern. The reviewer and the auditor use it to look at one part of a big file without
 *          loading the whole file into the context.
 * @depends node:fs/promises, agent/paths
 * @usedBy agent/tools, stages/review, stages/audit
 * @exports EXTRACT_MAX_BYTES, sliceLines, findPattern, extractFragment, extractFragments
 * @ai.tags extract, context
 * @ai.hint io
 */

import { readFile, stat } from 'node:fs/promises';
import { resolveInside } from './paths.js';

/** The cap of one fragment. */
export const EXTRACT_MAX_BYTES = 48 * 1024;

/**
 * Cut a range of lines out of a text.
 * @param {string} text
 * @param {number|null} startLine 1-based, inclusive
 * @param {number|null} endLine 1-based, inclusive
 * @returns {{ text: string, from: number, to: number, total: number }}
 * @exports
 * @ai.hint pure
 */
export function sliceLines(text, startLine, endLine) {
    const lines = String(text ?? '').split(/\r?\n/);
    const total = lines.length;
    const from = Math.max(1, Number.isSafeInteger(startLine) ? startLine : 1);
    const to = Math.min(total, Number.isSafeInteger(endLine) ? endLine : total);
    if (from > total) throw new Error(`start_line ${from} больше числа строк (${total}).`);
    return { text: lines.slice(from - 1, to).join('\n'), from, to, total };
}

/**
 * The lines around every hit of a pattern.
 * @param {string} text
 * @param {string} pattern a plain text or a regular expression source
 * @param {{ regex?: boolean, context?: number }} [options]
 * @returns {{ text: string, hits: number }}
 * @exports
 * @ai.hint pure
 */
export function findPattern(text, pattern, { regex = false, context = 3 } = {}) {
    const source = String(text ?? '');
    const needle = String(pattern ?? '');
    if (!needle) throw new Error('Пустой шаблон поиска.');
    let matcher;
    if (regex) {
        try { matcher = new RegExp(needle, 'i'); } catch (error) { throw new Error(`Некорректное регулярное выражение: ${error.message}`); }
    }
    const lines = source.split(/\r?\n/);
    const keep = new Set();
    let hits = 0;
    lines.forEach((line, index) => {
        const found = regex ? matcher.test(line) : line.toLowerCase().includes(needle.toLowerCase());
        if (!found) return;
        hits += 1;
        for (let offset = -context; offset <= context; offset += 1) {
            const at = index + offset;
            if (at >= 0 && at < lines.length) keep.add(at);
        }
    });
    if (!hits) return { text: 'Совпадений не найдено.', hits: 0 };
    const sorted = [...keep].sort((a, b) => a - b);
    const parts = [];
    let previous = -1;
    for (const index of sorted) {
        if (previous >= 0 && index > previous + 1) parts.push('…');
        parts.push(`${index + 1}| ${lines[index]}`);
        previous = index;
    }
    return { text: parts.join('\n'), hits };
}

/**
 * One fragment of one file.
 * @param {{ root: string, file: string, startLine?: number|null, endLine?: number|null,
 *   pattern?: string|null, regex?: boolean, maxBytes?: number }} request
 * @returns {Promise<{ rel: string, text: string, bytes: number }>}
 * @exports
 * @ai.hint io
 */
export async function extractFragment({ root, file, startLine = null, endLine = null, pattern = null, regex = false, maxBytes = EXTRACT_MAX_BYTES }) {
    const { abs, rel } = await resolveInside(root, String(file ?? ''), { allowRoot: false });
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) throw new Error(`Файл не найден: ${file}`);
    const body = await readFile(abs, 'utf8');
    let text;
    if (pattern) {
        text = findPattern(body, pattern, { regex }).text;
    } else {
        const slice = sliceLines(body, startLine, endLine);
        text = `# ${rel} — строки ${slice.from}-${slice.to} из ${slice.total}\n${slice.text}`;
    }
    const clipped = Buffer.byteLength(text) > maxBytes ? `${text.slice(0, Math.floor(maxBytes / 8))}\n…фрагмент усечён` : text;
    return { rel, text: clipped, bytes: Buffer.byteLength(clipped) };
}

/**
 * Fragments of several files, in order, until the byte budget is spent.
 * @param {{ root: string, files?: Array<object>, maxBytes?: number }} request
 * @returns {Promise<{ fragments: object[], bytes: number, truncated: boolean }>}
 * @exports
 * @ai.hint io
 */
export async function extractFragments({ root, files = [], maxBytes = EXTRACT_MAX_BYTES }) {
    const fragments = [];
    let bytes = 0;
    let truncated = false;
    for (const request of files ?? []) {
        if (bytes >= maxBytes) { truncated = true; break; }
        const fragment = await extractFragment({ root, ...request, maxBytes: maxBytes - bytes });
        fragments.push(fragment);
        bytes += fragment.bytes;
    }
    return { fragments, bytes, truncated };
}
