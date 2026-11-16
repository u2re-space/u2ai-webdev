/**
 * @file src/agent/run-map.js
 * @module agent/run-map
 * @purpose Карта прогона: указатель на файлы рабочего каталога с их строками и их символами.
 *
 *   Карта лежит в каталоге прогона — `<work>/<id>/map.json` — и умирает вместе с ним.
 *   Новый прогон строит новую карту: от старой ничего не течёт в новую, и карта не устаревает,
 *   потому что принадлежит прогону, который её написал.
 *
 *   Карта отвечает на три вопроса, не трогая диск:
 *
 *     по файлу     какие файлы есть, какого они размера и что это;
 *     по строке    в какой строке какого файла лежит текст;
 *     по содержимому  текст файлов, уже прочитанный.
 *
 *   Инструменты прогона сначала ищут в карте и только для файлов, которые карта не прочитала
 *   целиком, спускаются к диску.
 *
 *   Это не то же самое, что постоянная карта проекта `.ai/map.json`: та живёт между прогонами,
 *   а эта — только внутри своего.
 *
 * @depends node:path, node:fs/promises, stages/workspace
 * @usedBy pipeline, agent/tools
 * @exports RUN_MAP_FILE, RUN_MAP_VERSION, runMapFile, runMapRel, mapKindOf, indexFile,
 *          buildRunMap, loadRunMap, saveRunMap, updateRunMap, searchRunMap, mapFiles,
 *          mapSummary, openRunMap
 * @ai.tags map, index, cache, search
 * @ai.hint io
 * @changed 2026-11-15 Карта прогона: файлы, их строки и их символы.
 */

import path from 'node:path';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { workRoot, sanitizeId } from '../stages/workspace.js';
import { workRel, writeFileAtomic } from '../shared/house.js';

/** Имя карты внутри каталога прогона. */
export const RUN_MAP_FILE = 'map.json';

/** Версия формата карты. */
export const RUN_MAP_VERSION = 1;

/** Каталоги, в которые карта не заходит: дом проекта (`.ai`) и старый рабочий каталог. */
const NOISY = /^(?:\.git|node_modules|\.ai|\.tmp|\.hg|\.svn|dist|build|coverage|\.next|\.nuxt|\.cache|\.venv|venv|__pycache__|target)$/i;

/** Файлы, которые карта не читает. */
const SECRET = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx|jks|keystore))$/i;

/** Виды файлов по расширению. */
const KINDS = new Map(Object.entries({
    '.js': 'code', '.mjs': 'code', '.cjs': 'code', '.ts': 'code', '.tsx': 'code', '.jsx': 'code',
    '.py': 'code', '.go': 'code', '.rs': 'code', '.rb': 'code', '.php': 'code', '.java': 'code',
    '.css': 'style', '.scss': 'style', '.less': 'style',
    '.json': 'json', '.jsonc': 'json', '.webmanifest': 'json',
    '.html': 'markup', '.htm': 'markup', '.svg': 'markup', '.xml': 'markup', '.vue': 'markup',
    '.md': 'text', '.txt': 'text', '.yml': 'text', '.yaml': 'text', '.toml': 'text', '.ini': 'text',
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image',
    '.avif': 'image', '.bmp': 'image', '.ico': 'image',
}));

/** Символы кода: имя и строка, на которой оно стоит. */
const CODE_SYMBOLS = [
    [/^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, 'export'],
    [/^\s*export\s+class\s+([A-Za-z_$][\w$]*)/, 'export'],
    [/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, 'export'],
    [/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, 'function'],
    [/^\s*class\s+([A-Za-z_$][\w$]*)/, 'class'],
    [/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/, 'const'],
    [/^\s*def\s+([A-Za-z_][\w]*)/, 'function'],
    [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/, 'function'],
];

/**
 * Путь карты прогона.
 * @param {string} root корень проекта
 * @param {object} config конфигурация прогона
 * @param {string} runId идентификатор прогона
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function runMapFile(root, config = {}, runId = '') {
    return path.join(workRoot(root, config), sanitizeId(runId), RUN_MAP_FILE);
}

/**
 * Путь карты прогона так, как его читает модель.
 * @param {string} root корень проекта
 * @param {object} config конфигурация прогона
 * @param {string} runId идентификатор прогона
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function runMapRel(root, config = {}, runId = '') {
    return `${workRel(config)}/${sanitizeId(runId)}/${RUN_MAP_FILE}`;
}

/**
 * Вид файла: что это, по имени.
 * @param {string} rel путь файла
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function mapKindOf(rel) {
    const ext = path.extname(String(rel ?? '')).toLowerCase();
    return KINDS.get(ext) ?? 'binary';
}

/**
 * Символы текста: имена, которые объявляет код.
 * @param {string[]} lines
 * @param {string} kind вид файла
 * @returns {Array<{ name: string, kind: string, line: number }>}
 * @ai.hint pure
 */
function extractSymbols(lines, kind) {
    if (kind !== 'code') return [];
    const out = [];
    for (const [index, line] of lines.entries()) {
        for (const [pattern, name] of CODE_SYMBOLS) {
            const match = pattern.exec(line);
            if (!match) continue;
            out.push({ name: match[1], kind: name, line: index + 1 });
            break;
        }
        if (out.length >= 400) break;
    }
    return out;
}

/**
 * Запись одного файла: что карта о нём знает.
 *
 * Слишком большой файл карта читает по началу: она помечает его `partial`, и поиск для него
 * спускается к диску.
 * @param {string} root корень проекта
 * @param {string} rel путь файла относительно корня
 * @param {{ maxFileBytes?: number, maxLines?: number }} [options]
 * @returns {Promise<object|null>} null, когда файл не стоит индексировать
 * @exports
 * @ai.hint io
 */
export async function indexFile(root, rel, { maxFileBytes = 32 * 1024, maxLines = 400 } = {}) {
    const posix = String(rel ?? '').replaceAll('\\', '/');
    if (!posix || posix.includes('..')) return null;
    const segments = posix.split('/');
    if (segments.some((segment) => NOISY.test(segment))) return null;
    if (SECRET.test(segments.at(-1) ?? '')) return null;
    const abs = path.join(path.resolve(root), ...segments);
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) return null;

    const kind = mapKindOf(posix);
    const record = {
        bytes: info.size,
        kind,
        mtimeMs: info.mtimeMs,
        lineCount: 0,
        eol: '\n',
        partial: false,
    };
    if (kind === 'image' || kind === 'binary') {
        record.symbols = [];
        return record;
    }
    let text;
    try {
        text = await readFile(abs, 'utf8');
    } catch {
        record.symbols = [];
        return record;
    }
    const all = text.split(/\r?\n/);
    record.lineCount = all.length;
    record.eol = text.includes('\r\n') ? '\r\n' : '\n';
    // Строки хранятся целиком: карта должна отвечать и на чтение, а не только на поиск.
    const kept = all.slice(0, maxLines);
    record.partial = all.length > maxLines || info.size > maxFileBytes;
    record.lines = kept;
    record.symbols = extractSymbols(kept, kind);
    return record;
}

/**
 * Файлы каталога так, как их хочет карта.
 * @param {string} root
 * @param {string} dirRel каталог относительно корня
 * @param {string[]} out
 * @param {number} depth
 * @param {number} maxFiles
 * @param {string} skip абсолютный путь каталога, в который не заходим
 * @returns {Promise<string[]>}
 * @ai.hint io
 */
async function walk(root, dirRel, out, depth, maxFiles, skip) {
    if (depth < 0 || out.length >= maxFiles) return out;
    const dirAbs = dirRel ? path.join(root, ...dirRel.split('/')) : root;
    if (skip && path.resolve(dirAbs) === path.resolve(skip)) return out;
    const entries = await readdir(dirAbs, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        if (out.length >= maxFiles) break;
        if (entry.name.startsWith('.') && entry.name !== '.env.example') {
            if (NOISY.test(entry.name)) continue;
        }
        const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            if (NOISY.test(entry.name)) continue;
            await walk(root, rel, out, depth - 1, maxFiles, skip);
            continue;
        }
        if (!entry.isFile()) continue;
        out.push(rel);
    }
    return out;
}

/**
 * Построить карту прогона и записать её на диск.
 * @param {{ root: string, config?: object, runId?: string, paths?: string[]|null, depth?: number,
 *   maxFiles?: number, maxFileBytes?: number, maxLines?: number }} options
 * @returns {Promise<object>} карта
 * @exports
 * @ai.hint io
 */
export async function buildRunMap({
    root,
    config = {},
    runId = '',
    paths = null,
    depth = 8,
    maxFiles = 2000,
    maxFileBytes = 32 * 1024,
    maxLines = 400,
} = {}) {
    const base = path.resolve(String(root ?? '.'));
    const wanted = Array.isArray(paths) && paths.length ? paths.map(String) : null;
    const skip = path.join(workRoot(base, config), sanitizeId(runId));
    const list = wanted ?? await walk(base, '', [], depth, maxFiles, skip);
    const files = {};
    for (const rel of list) {
        if (Object.keys(files).length >= maxFiles) break;
        const record = await indexFile(base, rel, { maxFileBytes, maxLines });
        if (record) files[rel] = record;
    }
    const map = {
        version: RUN_MAP_VERSION,
        id: sanitizeId(runId),
        builtAt: new Date().toISOString(),
        root: '.',
        files,
    };
    await saveRunMap({ root, config, runId, map });
    return map;
}

/**
 * Записать карту прогона.
 * @param {{ root: string, config?: object, runId?: string, map: object }} options
 * @returns {Promise<string>} путь файла
 * @exports
 * @ai.hint io
 */
export async function saveRunMap({ root, config = {}, runId = '', map }) {
    const file = runMapFile(root, config, runId);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, `${JSON.stringify(map, null, 2)}\n`);
    return file;
}

/**
 * Прочитать карту прогона. Сломанная или отсутствующая карта даёт null.
 * @param {{ root: string, config?: object, runId?: string }} options
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function loadRunMap({ root, config = {}, runId = '' }) {
    const text = await readFile(runMapFile(root, config, runId), 'utf8').catch(() => null);
    if (text === null) return null;
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== RUN_MAP_VERSION) return null;
        if (!parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) parsed.files = {};
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Переиндексировать один файл и записать карту обратно.
 * @param {{ root: string, config?: object, runId?: string, rel: string, map?: object|null,
 *   maxFileBytes?: number, maxLines?: number }} options
 * @returns {Promise<object|null>} карта
 * @exports
 * @ai.hint io
 */
export async function updateRunMap({ root, config = {}, runId = '', rel, map = null, maxFileBytes, maxLines }) {
    const current = map ?? await loadRunMap({ root, config, runId });
    if (!current) return null;
    const posix = String(rel ?? '').replaceAll('\\', '/');
    const record = await indexFile(root, posix, { maxFileBytes, maxLines });
    if (record) current.files[posix] = record;
    else delete current.files[posix];
    current.builtAt = new Date().toISOString();
    await saveRunMap({ root, config, runId, map: current });
    return current;
}

/**
 * Лежит ли путь внутри каталога.
 * @param {string} rel
 * @param {string} dir
 * @returns {boolean}
 * @ai.hint pure
 */
function inDir(rel, dir) {
    let normalized = String(dir ?? '.').replaceAll('\\', '/');
    if (normalized.startsWith('./')) normalized = normalized.slice(2);
    normalized = path.posix.normalize(normalized);
    if (normalized === '.' || normalized === '') return true;
    return rel === normalized || rel.startsWith(`${normalized}/`);
}

/**
 * Сопоставитель имён файлов: маска вроде `*.png`.
 * @param {string} pattern
 * @returns {RegExp|null}
 * @ai.hint pure
 */
function globMatcher(pattern) {
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
 * Поиск по карте прогона.
 *
 * Области те же, что у инструмента: `path` смотрит на имена файлов, `symbol` — на имена,
 * которые объявляет код, `content` — на сами строки.
 * @param {object} map карта прогона
 * @param {{ query: string, dir?: string, scope?: string, regex?: boolean, glob?: string,
 *   maxResults?: number }} options
 * @returns {{ text: string, count: number, partial: string[] }} совпадения и файлы, которые
 *   карта не прочитала целиком
 * @exports
 * @ai.hint pure
 */
export function searchRunMap(map, {
    query,
    dir = '.',
    scope = 'all',
    regex = false,
    glob = '',
    maxResults = 80,
} = {}) {
    const text = String(query ?? '');
    if (!text.trim()) throw new Error('The search needs a query.');
    const needle = text.toLowerCase();
    const files = map?.files ?? {};
    const names = globMatcher(glob);
    const onName = !String(glob ?? '').trim().includes('/');
    const under = Object.keys(files)
        .filter((rel) => inDir(rel, dir))
        .filter((rel) => !names || names.test(onName ? path.posix.basename(rel) : rel))
        .sort();

    const lines = [];
    const partial = [];
    let matcher = null;
    if (regex) {
        try {
            matcher = new RegExp(text, 'i');
        } catch (error) {
            throw new Error(`The regular expression is wrong: ${error.message}`);
        }
    }
    const hit = (line) => (matcher ? matcher.test(line) : line.toLowerCase().includes(needle));

    const push = (line) => {
        if (lines.length >= maxResults) return false;
        lines.push(line);
        return true;
    };

    if (scope === 'path' || scope === 'all') {
        for (const rel of under) {
            if (!hit(rel)) continue;
            if (!push(rel)) break;
        }
    }

    if (scope === 'symbol' || scope === 'all') {
        for (const rel of under) {
            for (const symbol of files[rel]?.symbols ?? []) {
                if (!hit(symbol.name)) continue;
                if (!push(`${rel}:${symbol.line}: ${symbol.kind} ${symbol.name}`)) break;
            }
        }
    }

    if (scope === 'content' || scope === 'all') {
        for (const rel of under) {
            const record = files[rel];
            if (!record) continue;
            if (record.partial) {
                partial.push(rel);
                continue;
            }
            for (const [index, line] of (record.lines ?? []).entries()) {
                if (!hit(line)) continue;
                if (!push(`${rel}:${index + 1}: ${line.trim().slice(0, 240)}`)) break;
            }
        }
    }

    return {
        text: lines.join('\n'),
        count: lines.length,
        partial,
    };
}

/**
 * Файлы каталога карты, по глубине.
 *
 * `depth` считает каталоги ниже названного: `depth = 1` — файлы самого каталога,
 * `depth = 2` — ещё и его прямых подкаталогов.
 * @param {object} map
 * @param {{ dir?: string, depth?: number }} [options]
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function mapFiles(map, { dir = '.', depth = 8 } = {}) {
    const base = String(dir ?? '.').replaceAll('\\', '/').replace(/^\.\//, '');
    const prefix = base && base !== '.' ? `${base}/` : '';
    const max = Math.max(1, Number(depth) || 1);
    const out = [];
    for (const rel of Object.keys(map?.files ?? {})) {
        if (prefix && !rel.startsWith(prefix)) continue;
        const rest = prefix ? rel.slice(prefix.length) : rel;
        const levels = rest.split('/').length;
        if (levels > max) continue;
        out.push(rel);
    }
    return out.sort();
}

/**
 * Сводка карты: оглавление прогона.
 * @param {object} map
 * @param {{ maxChars?: number, maxFiles?: number }} [options]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function mapSummary(map, { maxChars = 2000, maxFiles = 60 } = {}) {
    const files = Object.entries(map?.files ?? {});
    if (!files.length) return '';
    const lines = ['# The map of the run', ''];
    for (const [rel, record] of files.slice(0, maxFiles)) {
        const marks = [];
        if (record?.lineCount) marks.push(`${record.lineCount} lines`);
        if (record?.symbols?.length) marks.push(`${record.symbols.length} symbols`);
        lines.push(`- ${rel} — ${record?.kind ?? 'file'}${marks.length ? `, ${marks.join(', ')}` : ''}`);
    }
    if (files.length > maxFiles) lines.push(`… and ${files.length - maxFiles} more files`);
    const text = lines.join('\n');
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

/**
 * Открыть карту прогона: файл, данные и поиск по ним.
 *
 * Ручка держит карту в памяти и записывает её обратно, когда файл прогона меняется, чтобы
 * поиск инструментов не обходил диск дважды.
 * @param {{ root: string, config?: object, runId?: string, build?: boolean, depth?: number,
 *   maxFiles?: number, maxFileBytes?: number, maxLines?: number }} options
 * @returns {Promise<object>} ручка карты
 * @exports
 * @ai.hint io
 */
export async function openRunMap({
    root,
    config = {},
    runId = '',
    build = true,
    depth = 8,
    maxFiles = 2000,
    maxFileBytes = 32 * 1024,
    maxLines = 400,
} = {}) {
    let data = await loadRunMap({ root, config, runId });
    if (!data && build) {
        data = await buildRunMap({ root, config, runId, depth, maxFiles, maxFileBytes, maxLines });
    }
    const handle = {
        enabled: Boolean(data),
        path: runMapFile(root, config, runId),
        rel: runMapRel(root, config, runId),
        data: data ?? { version: RUN_MAP_VERSION, id: sanitizeId(runId), files: {} },
        /**
         * Файлы, которые знает карта.
         * @returns {string[]}
         */
        files() {
            return Object.keys(handle.data.files ?? {});
        },
        /**
         * Поиск по карте.
         * @param {object} options параметры поиска
         * @returns {{ text: string, count: number, partial: string[] }}
         */
        search(options) {
            return searchRunMap(handle.data, options);
        },
        /**
         * Оглавление прогона.
         * @param {object} [options]
         * @returns {string}
         */
        summary(options = {}) {
            return mapSummary(handle.data, options);
        },
        /**
         * Переиндексировать один файл и записать карту обратно.
         * @param {string} rel
         * @returns {Promise<void>}
         */
        async update(rel) {
            const next = await updateRunMap({
                root,
                config,
                runId,
                rel,
                map: handle.data,
                maxFileBytes,
                maxLines,
            });
            if (next) handle.data = next;
        },
        /**
         * Переиндексировать несколько файлов и записать карту один раз.
         * @param {string[]} rels
         * @returns {Promise<void>}
         */
        async updateMany(rels) {
            const list = Array.isArray(rels) ? rels.filter(Boolean) : [];
            if (!list.length) return;
            for (const rel of list) {
                await updateRunMap({
                    root,
                    config,
                    runId,
                    rel,
                    map: handle.data,
                    maxFileBytes,
                    maxLines,
                });
            }
            await saveRunMap({ root, config, runId, map: handle.data });
        },
        /**
         * Записать карту на диск.
         * @returns {Promise<void>}
         */
        async save() {
            await saveRunMap({ root, config, runId, map: handle.data });
        },
    };
    return handle;
}
