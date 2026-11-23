/**
 * @file src/agent/fs-tools.js
 * @module agent/fs-tools
 * @purpose List, read, search, edit, and copy files inside the working directory.
 * @depends node:path, node:fs/promises, agent/paths, agent/project-backup, util/text
 * @usedBy agent/tools, agent/team
 * @exports listFiles, readTextFile, findLines, patchFile, searchFiles, globMatcher, writeTextFile,
 *          replaceInFile, deleteFile, makeDirectory, copyPath
 * @ai.tags filesystem, tools
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-10-21 A direct search can include noisy directories; a missing path lists its parent.
 * @changed 2026-11-17 Строки адресуемы: поиск номера строки и патч по номерам — файл не
 *                       переписывается целиком ради одной правки.
 */

import path from 'node:path';
import { readFile, mkdir, stat, lstat, readdir, unlink, copyFile, cp, open } from 'node:fs/promises';
import { resolveInside, isInside, isForbiddenDirName, isProtectedFileName, NOISY_DIRS } from './paths.js';
import { formatBytes } from '../util/text.js';
import { saveProjectBackup } from './project-backup.js';
import { writeFileAtomic } from '../shared/house.js';

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Return null only when a path disappeared; other filesystem failures are actionable errors. */
async function statOrNull(target, operation = stat) {
    try {
        return await operation(target);
    } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
        throw error;
    }
}

/**
 * True when the first 8 KiB contain a NUL byte.
 * `readTextFile` and `searchFiles` skip those files.
 * @param {string} abs
 * @param {number} size
 * @returns {Promise<boolean>}
 * @ai.hint io
 */
async function isBinary(abs, size) {
    const handle = await open(abs, 'r');
    try {
        const sample = Buffer.alloc(Math.min(8192, size));
        const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
        return sample.subarray(0, bytesRead).includes(0);
    } finally { await handle.close(); }
}

/** Copy the current version of a file into the backup directory before it is modified. */
async function backup(abs, rel, backupDir) {
    if (!backupDir) return null;
    const target = path.join(backupDir, ...rel.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    let destination = target;
    let n = 1;
    while (await statOrNull(destination)) destination = `${target}.${n++}.bak`;
    await copyFile(abs, destination);
    return destination;
}

/**
 * Nearest existing directory at or above `rel`. `listFiles` uses this for a missing path.
 * @param {string} root
 * @param {string} rel Posix path relative to `root`.
 * @returns {Promise<string | null>}
 * @ai.hint io
 */
async function nearestDirectory(root, rel) {
    const parts = String(rel).split('/').filter((part) => part && part !== '.');
    while (parts.length) {
        parts.pop();
        const candidate = parts.join('/') || '.';
        const info = await statOrNull(path.join(root, ...parts));
        if (info?.isDirectory()) return candidate;
    }
    return null;
}

/**
 * List a directory tree, mark noisy folders, and stop at `maxEntries`.
 * A path that does not exist yet lists the nearest existing parent instead of failing,
 * so a probe of a directory that `write_file` will create still returns the tree.
 * The `list_files` tool calls this.
 * @param {{ root: string, dir?: string, depth?: number, includeHidden?: boolean, maxEntries?: number }} options
 * @returns {Promise<{ text: string, count: number, truncated: boolean, missing?: string }>}
 * @exports
 * @ai.hint io
 */
export async function listFiles({ root, dir = '.', depth = 2, includeHidden = false, maxEntries = 400 }) {
    const { abs, rel } = await resolveInside(root, dir);
    const info = await statOrNull(abs);
    if (!info) {
        const parent = await nearestDirectory(root, rel);
        if (!parent) throw new Error(`Каталог не найден: ${dir}`);
        const listing = await listFiles({ root, dir: parent, depth, includeHidden, maxEntries });
        const where = parent === '.' ? 'корня проекта' : `каталога ${parent}`;
        return {
            text: `Каталог не найден: ${rel}. Его создаст write_file при записи файла. Содержимое ${where}:\n${listing.text}`,
            count: listing.count, truncated: listing.truncated, missing: rel,
        };
    }
    if (!info.isDirectory()) throw new Error(`Не каталог: ${dir}`);
    const lines = [];
    let truncated = false;
    /** List one level and descend until `depth`, skipping noisy directory contents. */
    async function walk(current, prefix, level) {
        if (truncated) return;
        let entries;
        try {
            entries = await readdir(current, { withFileTypes: true });
        } catch (error) {
            if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return;
            throw error;
        }
        entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
        for (const entry of entries) {
            if (!includeHidden && entry.name.startsWith('.') && entry.name !== '.github') continue;
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (lines.length >= maxEntries) { truncated = true; return; }
            if (entry.isDirectory()) {
                const skip = NOISY_DIRS.test(entry.name);
                lines.push(`${relative}/${skip ? '  (пропущено)' : ''}`);
                if (!skip && level < depth) await walk(path.join(current, entry.name), relative, level + 1);
            } else if (entry.isFile()) {
                const size = await stat(path.join(current, entry.name)).then((s) => s.size).catch(() => 0);
                lines.push(`${relative}  (${formatBytes(size)})`);
            } else if (entry.isSymbolicLink()) {
                lines.push(`${relative}  (symlink)`);
            }
        }
    }
    await walk(abs, rel === '.' ? '' : rel, 1);
    return { text: `${lines.join('\n') || '(пусто)'}${truncated ? `\n…список усечён (${maxEntries} записей)` : ''}`, count: lines.length, truncated };
}

/**
 * Return numbered UTF-8 lines for one file, clipped to `maxBytes`.
 * The `read_file` tool calls this.
 * @param {{ root: string, file: string, startLine?: number | null, endLine?: number | null, maxBytes?: number }} options
 * @returns {Promise<object>}
 * @exports
 * @ai.hint io
 */
export async function readTextFile({ root, file, startLine = null, endLine = null, maxBytes = 256 * 1024 }) {
    const { abs, rel } = await resolveInside(root, file, { allowRoot: false });
        const info = await statOrNull(abs);
    if (!info) throw new Error(`Файл не найден: ${file}`);
    if (!info.isFile()) throw new Error(`Не файл: ${file}`);
    if (await isBinary(abs, info.size)) throw new Error(`Бинарный файл (${formatBytes(info.size)}); этот инструмент читает только текст.`);
    const buffer = await readFile(abs);
    let text;
    try { text = utf8.decode(buffer); } catch { throw new Error(`Файл ${rel} не в UTF-8.`); }
    const lines = text.split(/\r?\n/);
    const total = lines.length;
    const from = Math.max(1, startLine ?? 1);
    let to = Math.min(total, endLine ?? total);
    if (from > total) throw new Error(`start_line ${from} больше числа строк (${total}).`);
    let selected = lines.slice(from - 1, to);
    let bytes = Buffer.byteLength(selected.join('\n'));
    let truncated = false;
    while (bytes > maxBytes && selected.length > 1) {
        selected = selected.slice(0, Math.max(1, Math.floor(selected.length * (maxBytes / bytes) * 0.9)));
        bytes = Buffer.byteLength(selected.join('\n'));
        truncated = true;
        to = from + selected.length - 1;
    }
    const width = String(to).length;
    const numbered = selected.map((line, index) => `${String(from + index).padStart(width)}| ${line}`).join('\n');
    const header = `# ${rel} — строки ${from}-${to} из ${total}${truncated ? ' (усечено по размеру; запросите диапазон)' : ''}`;
    return { text: `${header}\n${numbered}`, totalLines: total, from, to, bytes: buffer.length, truncated };
}

/**
 * The matcher of a pattern of the names of the files.
 *
 * A pattern is a glob: `*` is any text except the slash, `**` is any text, `?` is one
 * character. A pattern without a slash matches the name of the file, a pattern with a
 * slash matches the path of the file from the root.
 * @param {string} pattern
 * @returns {RegExp|null}
 * @exports
 * @ai.hint pure
 */
export function globMatcher(pattern) {
    const text = String(pattern ?? '').trim();
    if (!text) return null;
    const body = text
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '(?:.*/)?')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
    return new RegExp(`^${body}$`, 'i');
}

/**
 * Find `query` in the text files or in the names of the files.
 *
 * `search_files` uses this when the project map is missing or does not cover the requested path.
 * With `inContent` the query is a grep over the text of the files and the hits are
 * `path:line: text`. Without it the query is matched against the path of the files and the
 * hits are the paths themselves. `glob` limits the files by their name, `exclude` drops the
 * files whose path matches one of its patterns, `context` adds the lines around a hit, and
 * `caseSensitive` makes the plain text match respect the case.
 * `includeNoisy` allows a direct search inside node_modules, dist, and similar directories.
 * @param {{ root: string, query: string, dir?: string, regex?: boolean, inContent?: boolean,
 *   glob?: string, exclude?: string[], context?: number, caseSensitive?: boolean,
 *   maxResults?: number, maxFileBytes?: number, includeNoisy?: boolean }} options
 * @returns {Promise<{ text: string, count: number, scanned: number, truncated: boolean }>}
 * @exports
 * @ai.hint io
 */
export async function searchFiles({
    root,
    query,
    dir = '.',
    regex = false,
    inContent = true,
    glob = '',
    exclude = [],
    context = 0,
    caseSensitive = false,
    maxResults = 60,
    maxFileBytes = 1024 * 1024,
    includeNoisy = false,
} = {}) {
    if (typeof query !== 'string' || !query) throw new Error('Пустой запрос поиска.');
    const { abs, rel } = await resolveInside(root, dir);
    const names = globMatcher(glob);
    // A pattern without a slash names the files, a pattern with a slash names the paths.
    const onName = !String(glob ?? '').trim().includes('/');
    // The patterns that drop a file: the same rule as the glob, one pattern per element.
    const dropped = (Array.isArray(exclude) ? exclude : [])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
        .map((item) => ({ pattern: globMatcher(item), onName: !item.includes('/') }));
    const skipFile = (relative, name) => dropped.some((item) => (
        item.pattern && item.pattern.test(item.onName ? name : relative)
    ));
    let matcher;
    if (regex) {
        try { matcher = new RegExp(query, caseSensitive ? '' : 'i'); } catch (error) { throw new Error(`Некорректное регулярное выражение: ${error.message}`); }
    }
    const needle = caseSensitive ? query : query.toLowerCase();
    const results = [];
    let scanned = 0, truncated = false;
    const byName = !inContent;
    // The lines around a hit: the hit itself is `path:line: text`, the lines around it are
    // `path:line- text` — the dash says that the line is the context, not the hit.
    const around = Number.isSafeInteger(context) && context > 0 ? context : 0;
    const limit = Number.isSafeInteger(maxResults) && maxResults > 0 ? maxResults : 60;
    /** Scan the files under this directory until `maxResults` hits. */
    async function walk(current, prefix) {
        if (truncated) return;
        let entries;
        try {
            entries = await readdir(current, { withFileTypes: true });
        } catch (error) {
            if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return;
            throw error;
        }
        entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
        for (const entry of entries) {
            if (truncated) return;
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (entry.name === '.git') continue;
                if (includeNoisy ? entry.name === 'node_modules' : NOISY_DIRS.test(entry.name)) continue;
                if (/^\.(ssh|gnupg|aws|azure)$/i.test(entry.name)) continue;
                await walk(path.join(current, entry.name), relative);
            } else if (entry.isFile()) {
                if (/^\.env|\.(pem|key|p12|pfx)$/i.test(entry.name)) continue;
                if (skipFile(relative, entry.name)) continue;
                const full = path.join(current, entry.name);
                // The glob cuts the files before they are read: a search of the names does
                // not open a file at all.
                if (names && !names.test(onName ? entry.name : relative)) continue;
                if (byName) {
                    const hit = matcher ? matcher.test(relative) : (caseSensitive
                        ? relative.includes(query)
                        : relative.toLowerCase().includes(needle));
                    if (!hit) continue;
                    scanned++;
                    results.push(relative);
                    if (results.length >= limit) { truncated = true; break; }
                    continue;
                }
                const info = await statOrNull(full);
                if (!info || info.size > maxFileBytes) continue;
                if (await isBinary(full, info.size)) continue;
                let text;
                let bytes;
                try {
                    bytes = await readFile(full);
                } catch (error) {
                    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
                    throw error;
                }
                try { text = utf8.decode(bytes); } catch { continue; }
                scanned++;
                const lines = text.split(/\r?\n/);
                const hits = [];
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const hit = matcher ? matcher.test(line) : (caseSensitive
                        ? line.includes(query)
                        : line.toLowerCase().includes(needle));
                    if (!hit) continue;
                    hits.push(i);
                }
                for (const index of hits) {
                    const from = around ? Math.max(0, index - around) : index;
                    const to = around ? Math.min(lines.length - 1, index + around) : index;
                    for (let i = from; i <= to; i++) {
                        const mark = i === index ? ':' : '-';
                        results.push(`${relative}:${i + 1}${mark} ${lines[i].trim().slice(0, 240)}`);
                    }
                    if (results.length >= limit) { truncated = true; break; }
                }
            }
        }
    }
    await walk(abs, rel === '.' ? '' : rel);
    const empty = byName
        ? `Файлов по запросу нет (просмотрено файлов: ${scanned}).`
        : `Совпадений не найдено (просмотрено файлов: ${scanned}).`;
    return { text: results.length ? `${results.join('\n')}${truncated ? `\n…результаты усечены (${limit})` : ''}` : empty,
        count: results.length, scanned, truncated };
}

/**
 * Create or overwrite a UTF-8 file, copying the old bytes into `backupDir` first.
 * The `write_file` tool calls this.
 * @param {{ root: string, file: string, content: string, overwrite?: boolean, maxBytes?: number, backupDir?: string | null, backupSlot?: string | null }} options
 * @returns {Promise<object>} rel, bytes, created, backupPath, projectBackup.
 * @exports
 * @ai.hint io
 */
export async function writeTextFile({ root, file, content, overwrite = true, maxBytes = 4 * 1024 * 1024, backupDir = null, backupSlot = null }) {
    if (typeof content !== 'string') throw new Error('content должен быть строкой.');
    if (Buffer.byteLength(content) > maxBytes) throw new Error(`Содержимое больше лимита ${formatBytes(maxBytes)}.`);
    const { abs, rel } = await resolveInside(root, file, { forWrite: true, allowRoot: false });
    if (rel === '.backup' || rel.startsWith('.backup/')) throw new Error(`Запись в .backup запрещена: ${rel}`);
    const existing = await statOrNull(abs);
    if (existing?.isDirectory()) throw new Error(`По этому пути находится каталог: ${rel}`);
    if (existing && !overwrite) throw new Error(`Файл уже существует: ${rel} (overwrite=false).`);
    let backupPath = null;
    let projectBackup = null;
    if (existing?.isFile()) {
        backupPath = await backup(abs, rel, backupDir);
        projectBackup = await saveProjectBackup({ root, rel, abs, slot: backupSlot || 'write' });
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFileAtomic(abs, content);
    return { rel, bytes: Buffer.byteLength(content), created: !existing, backupPath, projectBackup };
}

/**
 * Replace an exact fragment once, or every time when `all` is set.
 * The `replace_text` tool calls this.
 * @param {{ root: string, file: string, search: string, replacement: string, all?: boolean, maxBytes?: number, backupDir?: string | null, backupSlot?: string | null }} options
 * @returns {Promise<object>} rel, replacements, bytes, backupPath, projectBackup.
 * @exports
 * @ai.hint io
 */
export async function replaceInFile({ root, file, search, replacement, all = false, maxBytes = 4 * 1024 * 1024, backupDir = null, backupSlot = null }) {
    if (typeof search !== 'string' || !search) throw new Error('search должен быть непустой строкой.');
    if (typeof replacement !== 'string') throw new Error('replacement должен быть строкой.');
    const { abs, rel } = await resolveInside(root, file, { forWrite: true, allowRoot: false });
    if (rel === '.backup' || rel.startsWith('.backup/')) throw new Error(`Запись в .backup запрещена: ${rel}`);
    const info = await statOrNull(abs);
    if (!info?.isFile()) throw new Error(`Файл не найден: ${file}`);
    if (info.size > maxBytes) throw new Error(`Файл больше лимита ${formatBytes(maxBytes)}.`);
    let text;
    try { text = utf8.decode(await readFile(abs)); } catch { throw new Error(`Файл ${rel} не в UTF-8.`); }
    let count = 0;
    for (let index = text.indexOf(search); index !== -1; index = text.indexOf(search, index + search.length)) count++;
    if (count === 0) {
        // Help the model: CRLF files are common on Windows.
        const normalizedCount = text.replaceAll('\r\n', '\n').split(search.replaceAll('\r\n', '\n')).length - 1;
        throw new Error(normalizedCount > 0
            ? 'Фрагмент не найден из-за различий переводов строк (CRLF/LF); прочитайте файл заново и используйте точный текст.'
            : 'Фрагмент search не найден в файле; прочитайте файл и укажите точный уникальный текст.');
    }
    if (count > 1 && !all) throw new Error(`Фрагмент встречается ${count} раз(а); уточните контекст или укажите all=true.`);
    const updated = all ? text.split(search).join(replacement) : text.replace(search, () => replacement);
    const backupPath = await backup(abs, rel, backupDir);
    const projectBackup = await saveProjectBackup({ root, rel, abs, slot: backupSlot || 'write' });
    await writeFileAtomic(abs, updated);
    return { rel, replacements: all ? count : 1, bytes: Buffer.byteLength(updated), backupPath, projectBackup };
}

/**
 * Find the lines of a file that hold a piece of text.
 *
 * The line number is the address of a place in the file: with it a role can read that place
 * alone and change it alone. A model that has to rewrite the whole file to fix one rule pays
 * for the whole file in every turn.
 * @param {{ root: string, file: string, text?: string|null, regex?: boolean, from?: number|null,
 *   to?: number|null, limit?: number, maxBytes?: number }} options
 * @returns {Promise<{ rel: string, hits: object[], totalLines: number, bytes: number }>}
 * @exports
 * @ai.hint io
 */
export async function findLines({
    root,
    file,
    text = null,
    regex = false,
    from = null,
    to = null,
    limit = 40,
    maxBytes = 4 * 1024 * 1024,
} = {}) {
    const { abs, rel } = await resolveInside(root, file, { allowRoot: false });
    const info = await statOrNull(abs);
    if (!info) throw new Error(`Файл не найден: ${file}`);
    if (!info.isFile()) throw new Error(`Не файл: ${file}`);
    if (await isBinary(abs, info.size)) throw new Error(`Бинарный файл (${formatBytes(info.size)}); этот инструмент читает только текст.`);
    if (info.size > maxBytes) throw new Error(`Файл больше лимита ${formatBytes(maxBytes)}.`);
    let content;
    try { content = utf8.decode(await readFile(abs)); } catch { throw new Error(`Файл ${rel} не в UTF-8.`); }
    const lines = content.split(/\r?\n/);
    const first = Math.max(1, from ?? 1);
    const last = Math.min(lines.length, to ?? lines.length);
    const needle = String(text ?? '');
    if (!needle) throw new Error('Укажите текст, который нужно найти.');
    let matcher = null;
    if (regex) {
        try {
            matcher = new RegExp(needle, 'i');
        } catch (error) {
            throw new Error(`Некорректное регулярное выражение: ${error.message}`);
        }
    }
    const hits = [];
    let matched = 0;
    for (let number = first; number <= last; number++) {
        const line = lines[number - 1] ?? '';
        const found = matcher
            ? matcher.test(line)
            : line.toLowerCase().includes(needle.toLowerCase());
        if (!found) continue;
        matched += 1;
        if (hits.length < Math.max(1, limit)) {
            hits.push({ line: number, text: line.slice(0, 400) });
        }
    }
    return { rel, hits, totalLines: lines.length, matched, bytes: info.size };
}

/**
 * Change the lines of a file by their numbers.
 *
 * The patch carries only the lines that change: the role sends the new text of the lines it
 * fixes, not the whole file. The file is rewritten once, atomically, and the old version goes
 * to the backup.
 *
 * The edits are applied from the bottom of the file up, so the numbers of the lines that were
 * not touched stay the numbers they had.
 * @param {{ root: string, file: string, edits: object[], maxBytes?: number, backupDir?: string|null,
 *   backupSlot?: string|null }} options
 * @returns {Promise<{ rel: string, applied: number, lines: number, bytes: number, backupPath: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function patchFile({
    root,
    file,
    edits = [],
    maxBytes = 4 * 1024 * 1024,
    backupDir = null,
    backupSlot = null,
} = {}) {
    const { abs, rel } = await resolveInside(root, file, { forWrite: true, allowRoot: false });
    if (rel === '.backup' || rel.startsWith('.backup/')) throw new Error(`Запись в .backup запрещена: ${rel}`);
    const list = Array.isArray(edits) ? edits : [];
    if (!list.length) throw new Error('Патч пуст: перечислите строки, которые меняются.');
    const info = await statOrNull(abs);
    if (!info) throw new Error(`Файл не найден: ${file}`);
    if (!info.isFile()) throw new Error(`Не файл: ${file}`);
    if (info.size > maxBytes) throw new Error(`Файл больше лимита ${formatBytes(maxBytes)}.`);
    let content;
    try { content = utf8.decode(await readFile(abs)); } catch { throw new Error(`Файл ${rel} не в UTF-8.`); }
    const lines = content.split(/\r?\n/);

    // The edits are checked before anything is written: a patch that names a line that is not
    // there changes nothing.
    const prepared = [];
    for (const edit of list) {
        const start = Number(edit?.startLine ?? edit?.start ?? 0);
        const end = Number(edit?.endLine ?? edit?.end ?? start);
        const text = typeof edit?.text === 'string' ? edit.text : '';
        if (!Number.isSafeInteger(start) || start < 1) throw new Error('Патч: строка начала должна быть числом от 1.');
        if (!Number.isSafeInteger(end) || end < start) throw new Error(`Патч: диапазон строк ${start}-${end} неверен.`);
        if (end > lines.length) throw new Error(`Патч: строки ${start}-${end} нет в файле (в файле ${lines.length} строк).`);
        prepared.push({ start, end, text });
    }
    // The numbers of the lines that were not touched stay the numbers they had: the edits go
    // from the bottom of the file up.
    prepared.sort((left, right) => right.start - left.start);
    for (const edit of prepared) {
        const replacement = edit.text === '' ? [] : edit.text.split(/\r?\n/);
        lines.splice(edit.start - 1, edit.end - edit.start + 1, ...replacement);
    }
    const updated = lines.join('\n');
    const backupPath = await backup(abs, rel, backupDir);
    const projectBackup = await saveProjectBackup({ root, rel, abs, slot: backupSlot || 'write' });
    await writeFileAtomic(abs, updated);
    return {
        rel,
        applied: prepared.length,
        lines: prepared.reduce((sum, edit) => sum + (edit.end - edit.start + 1), 0),
        bytes: Buffer.byteLength(updated),
        backupPath,
        projectBackup,
    };
}

/**
 * Copy a file into `backupDir`, then delete it.
 * The `delete_file` tool calls this.
 * @param {{ root: string, file: string, backupDir?: string | null }} options
 * @returns {Promise<{ rel: string, backupPath: string | null }>}
 * @exports
 * @ai.hint io
 */
export async function deleteFile({ root, file, backupDir = null, backupSlot = null }) {
    const { abs, rel } = await resolveInside(root, file, { forWrite: true, allowRoot: false });
    if (rel === '.backup' || rel.startsWith('.backup/')) throw new Error(`Запись в .backup запрещена: ${rel}`);
    const info = await statOrNull(abs);
    if (!info) throw new Error(`Файл не найден: ${file}`);
    if (!info.isFile()) throw new Error('Удалять можно только файлы (не каталоги).');
    const backupPath = await backup(abs, rel, backupDir);
    const projectBackup = await saveProjectBackup({ root, rel, abs, slot: backupSlot || 'write' });
    await unlink(abs);
    return { rel, backupPath, projectBackup };
}

/**
 * Create a directory and any missing parents.
 * The `make_dir` tool calls this.
 * @param {{ root: string, dir: string }} options
 * @returns {Promise<{ rel: string }>}
 * @exports
 * @ai.hint io
 */
export async function makeDirectory({ root, dir }) {
    const { abs, rel } = await resolveInside(root, dir, { forWrite: true, allowRoot: false });
    await mkdir(abs, { recursive: true });
    return { rel };
}

/**
 * Copy a file or directory tree without decoding or transforming its contents.
 * Both paths stay in the workspace; destination must not already exist.
 * @param {{ root: string, source: string, destination: string }} options
 * @returns {Promise<object>}
 * @exports
 * @ai.hint io
 */
export async function copyPath({ root, source, destination }) {
    const from = await resolveInside(root, source, { allowRoot: false });
    const to = await resolveInside(root, destination, { forWrite: true, allowRoot: false });
    if (from.rel === '.backup' || from.rel.startsWith('.backup/')) throw new Error(`Чтение из .backup запрещено: ${from.rel}`);
    if (to.rel === '.backup' || to.rel.startsWith('.backup/')) throw new Error(`Запись в .backup запрещена: ${to.rel}`);

    const info = await statOrNull(from.abs, lstat);
    if (!info) throw new Error(`Источник не найден: ${source}`);
    if (info.isSymbolicLink()) throw new Error(`Копирование символических ссылок запрещено: ${from.rel}`);
    if (!info.isFile() && !info.isDirectory()) throw new Error(`Источник должен быть файлом или каталогом: ${from.rel}`);

    const destinationPath = path.resolve(to.abs);
    if (info.isDirectory() && isInside(from.abs, destinationPath)) throw new Error('Нельзя копировать каталог внутрь самого себя.');

    async function validateTree(abs, rel) {
        const current = await lstat(abs);
        const name = path.basename(abs);
        if (name === '.backup') throw new Error(`Доступ к .backup запрещён: ${rel}`);
        if (isForbiddenDirName(name)) throw new Error(`Доступ запрещён: ${rel}`);
        if (current.isSymbolicLink()) throw new Error(`Копирование символических ссылок запрещено: ${rel}`);
        if (current.isFile() && isProtectedFileName(name)) throw new Error(`Файл с секретами недоступен: ${rel}`);
        if (current.isDirectory()) {
            for (const entry of await readdir(abs, { withFileTypes: true })) {
                const child = path.join(abs, entry.name);
                const childRel = `${rel}/${entry.name}`;
                await validateTree(child, childRel);
            }
        } else if (!current.isFile()) {
            throw new Error(`Неподдерживаемый тип файла: ${rel}`);
        }
    }
    await validateTree(from.abs, from.rel);

    const targetInfo = await statOrNull(to.abs, lstat);
    if (targetInfo) throw new Error(`Путь назначения уже существует: ${to.rel}`);
    await mkdir(path.dirname(to.abs), { recursive: true });
    await cp(from.abs, to.abs, { recursive: true, errorOnExist: true, force: false, dereference: false });
    return { source: from.rel, destination: to.rel, type: info.isDirectory() ? 'directory' : 'file' };
}
