/**
 * @file src/agent/tools.js
 * @module agent/tools
 * @purpose The executor of the tools: it runs the calls the model asks for inside the working
 *          directory and answers with a short text the model can read.
 *
 * This CLI has no picture generator and no raster editor: the vector graphics are edited as code
 * (SVG), and the pictures are delegated to the sibling CLIs (`ai-image`, `ai-decompose`,
 * `ai-measure`), which run as subprocesses.
 *
 * @depends node:path, node:child_process, agent/fs-tools, agent/project-backup, agent/assets,
 *          agent/bridges, agent/tool-specs, agent/paths, agent/run-map, agent/cli-family,
 *          inputs/measured
 * @exports createToolset, toolSpecs, enabledToolNames, mcpToolEntries, htmlToText,
 *          BLOCKING_COMMANDS, WINDOWS_EXTENSIONS, quoteWindowsArg, findProgram, killTree
 * @ai.tags tools, agent
 * @ai.hint keep
 * @changed 2026-11-15 Карта прогона и кэш контекста отвечают на чтения и поиск.
 * @changed 2026-11-15 `call_ai_measure` не запускает измеритель, если лист уже есть.
 * @changed 2026-11-15 `call_ai_measure` не зовёт команду `design`: направление дизайна пишут роли.
 * @changed 2026-11-16 Свободная дверь к CLI семейства: `ai_cli` зовёт любой CLI дома с любым
 *                       флагом, `ai_cli_help` даёт руководство по нему.
 */

import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { toolSpecs as buildSpecs } from './tool-specs.js';
import { listFiles, readTextFile, findLines, patchFile, searchFiles, writeTextFile, replaceInFile, deleteFile, makeDirectory, copyPath } from './fs-tools.js';
import { listProjectBackups, restoreProjectBackup } from './project-backup.js';
import { generateSvg, downloadFont, downloadIcons } from './assets.js';
import { searchIcons } from './icon-sets.js';
import { runBridge } from './bridges.js';
import { readSkill } from './skills.js';
import { guidanceSearchText, guidanceRetrieveText, GUIDANCE_SOURCE } from './guidance.js';
import { runProgram as runProgramIn } from './programs.js';
import { compareWithReference } from './image-compare.js';
import { firstPageId } from './devtools.js';
import { isInside, resolveInside } from './paths.js';
import { findChromium, findEgo, resolveEngine, screenshotPage, startStaticServer } from './browser.js';
import { ensurePage } from '../stages/dev-server.js';
import { shootPage } from '../stages/vision.js';
import { findMeasurement } from '../inputs/measured.js';
import { sniffType } from '../shared/data-urls.js';
import {
    FAMILY_CLIS,
    FAMILY_ROOT,
    FAMILY_TIMEOUT_MS,
    familyDoc,
    familyNames,
    familyOutputArg,
    familyPathArgs,
    resolveFamilyCli,
    runFamilyCli,
} from './cli-family.js';
import { runMagick } from './image-magick.js';

export { toolSpecs, enabledToolNames } from './tool-specs.js';
export { WINDOWS_EXTENSIONS, quoteWindowsArg, findProgram, killTree } from './programs.js';

/** Инструменты, ответы которых стоит помнить: они читают одно и то же. */
const CACHEABLE = new Set(['read_file']);

/**
 * Инструменты, которые могут выполняться пачкой.
 *
 * Пакет — это один ход вместо многих: чтения, поиски и правки идут вместе. В пакете нет
 * самого пакета (иначе пакет вызывал бы пакет), нет команд и нет мостов: там только
 * работа с файлами, которая идёт по порядку.
 */
const BATCH_TOOLS = new Set([
    'list_files',
    'read_file',
    'find_line',
    'search_files',
    'write_file',
    'replace_text',
    'patch_file',
    'delete_file',
    'make_dir',
    'copy_path',
]);

/**
 * The commands that do not finish on their own: a server, a watcher, a tail.
 *
 * Such a command would hold the run until the timeout, and the work of the run would wait for
 * nothing. The tool refuses them and says what to do instead.
 *
 * The dev server of vite is refused in every form: `vite`, `npx vite`, `vite dev`. The build
 * of vite (`vite build`) does finish, and it is not refused.
 * @type {RegExp}
 * @ai.hint pure
 */
export const BLOCKING_COMMANDS = /(?:python[0-9.]*\s+-m\s+http\.server|\bhttp-server\b|\blive-server\b|\bserve\b|(?:^|\s)(?:npx\s+)?vite\b(?!\s+build)|\bnpm\s+run\s+(?:dev|preview|serve|start)\b|\btail\s+-f\b)/i;

/**
 * Turn a name into a token the API accepts.
 * @param {string} value
 * @returns {string}
 * @ai.hint pure
 */
function token(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * The names of a tool argument that carries a list.
 *
 * The list may come as an array or as a JSON string: a model writes both, and a name that is
 * lost is a call that has to be repeated.
 * @param {unknown} value
 * @returns {string[]}
 * @ai.hint pure
 */
function parseNames(value) {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value.map((item) => String(item));
    const text = String(value).trim();
    if (!text) return [];
    if (text.startsWith('[')) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed.map((item) => String(item));
        } catch {
            // Not a JSON list: the text is split by the commas.
        }
    }
    return text.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * The picture of the arguments of a bridge: the first argument that names an image.
 *
 * The command itself ("measure", "design") is not a picture, and the flags are not either.
 * @param {string[]} args the arguments of the bridge
 * @returns {string} the path of the picture, or an empty string
 * @ai.hint pure
 */
function pictureOf(args = []) {
    for (const item of args) {
        const value = String(item ?? '').trim();
        if (!value || value.startsWith('-')) continue;
        if (/\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(value)) return value;
    }
    return '';
}

/**
 * The command of the arguments of a bridge: the first argument that is not a flag and not
 * a picture.
 * @param {string[]} args the arguments of the bridge
 * @returns {string} the name of the command, or an empty string
 * @ai.hint pure
 */
function commandOf(args = []) {
    for (const item of args) {
        const value = String(item ?? '').trim();
        if (!value || value.startsWith('-')) continue;
        if (/\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(value)) continue;
        return value;
    }
    return '';
}

/**
 * The number of things with the right form of the word: 1 элемент, 2 элемента, 5 элементов.
 * @param {number} count
 * @param {string} one the form of one
 * @param {string} few the form of two, three, four
 * @param {string} many the form of five and more
 * @returns {string}
 * @ai.hint pure
 */
function counted(count, one, few, many) {
    const n = Math.abs(Number(count) || 0);
    const tail = n % 100;
    if (tail >= 11 && tail <= 14) return `${n} ${many}`;
    const last = n % 10;
    if (last === 1) return `${n} ${one}`;
    if (last >= 2 && last <= 4) return `${n} ${few}`;
    return `${n} ${many}`;
}

/**
 * Call a tool of an MCP server.
 *
 * The tools of the browser of the DevTools name the page they work on. The house knows the
 * page — it asked the server for the list of the pages when it connected — and puts the
 * number into the call: a role that has to ask for the page first spends a turn on it.
 * @param {{ connection: object, tool: string, parameters: object }} entry the tool of the server
 * @param {object} args the arguments of the call
 * @param {{ signal?: AbortSignal|null }} [options]
 * @returns {Promise<unknown>} the answer of the server
 */
async function callMcp(entry, args = {}, { signal = null } = {}) {
    const connection = entry.connection ?? {};
    const required = Array.isArray(entry.parameters?.required) ? entry.parameters.required : [];
    const wants = required.includes('pageId');
    const known = Number.isFinite(connection.pageId) ? connection.pageId : null;
    const callArgs = entry.tool === 'navigate_page'
        && String(args?.type ?? '').toLowerCase() === 'url'
        && !String(args?.url ?? '').trim()
        && typeof connection.projectUrl === 'string'
        && connection.projectUrl.trim()
        ? { ...args, url: connection.projectUrl }
        : args;
    const payload = (pageId) => (wants && pageId !== null ? { ...callArgs, pageId } : callArgs);
    // The number of the page is the one the house knows, when the role did not name a page.
    const first = await callWithAbort(
        () => wants && known !== null && args?.pageId === undefined
            ? connection.call(entry.tool, payload(known))
            : connection.call(entry.tool, callArgs),
        signal,
    );
    const text = (first?.content ?? [])
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n');
    if (!/no page found|page not found|invalid input.*pageId/i.test(text)) return first;
    // The page is gone or the number was wrong: the house asks for the list of the pages once
    // more and repeats the call with the page that is there.
    const refreshed = await callWithAbort(() => firstPageId(connection), signal);
    if (refreshed === null) return first;
    connection.pageId = refreshed;
    return await callWithAbort(() => connection.call(entry.tool, payload(refreshed)), signal);
}

/** Abort a slow browser tool without waiting for its MCP timeout. */
async function callWithAbort(call, signal) {
    if (!signal) return await call();
    if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    let onAbort;
    const aborted = new Promise((_, reject) => {
        onAbort = () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return await Promise.race([call(), aborted]);
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}

/**
 * The answer of a tool of an MCP server.
 *
 * The server answers with parts: text and pictures. A picture is written into the working
 * directory and named in the answer — the role loop looks for the paths of the answer and
 * puts the pictures back into the conversation, so the role sees what the browser saw.
 * @param {string} root the working directory
 * @param {{ name: string, tool: string }} entry the tool of the server
 * @param {unknown} result the answer of the server
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function mcpAnswer(root, entry, result) {
    const content = Array.isArray(result?.content) ? result.content : null;
    if (!content) {
        return typeof result === 'string' ? result : JSON.stringify(result ?? null);
    }
    const lines = [];
    for (const part of content) {
        if (part?.type === 'image' && typeof part?.data === 'string') {
            const mime = String(part.mimeType ?? 'image/png');
            const extension = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
            const name = `mcp-${entry?.tool ?? 'tool'}-${Date.now().toString(36)}.${extension}`;
            const folder = '.ai/shots';
            const target = path.join(root, ...folder.split('/'), name);
            try {
                await mkdir(path.dirname(target), { recursive: true });
                await writeFile(target, Buffer.from(part.data, 'base64'));
                // The path is the one of the project: the role loop looks for the paths of the
                // answer and puts the picture back into the conversation.
                lines.push(`The picture is written: ${folder}/${name}`);
            } catch (error) {
                lines.push(`The picture could not be written: ${error?.message ?? error}`);
            }
            continue;
        }
        lines.push(typeof part?.text === 'string' ? part.text : JSON.stringify(part));
    }
    return lines.join('\n');
}

/**
 * The tools of the connected MCP servers, named so that two servers cannot collide.
 * @param {Array<{ name: string, tools: object[], call: Function }>} connections
 * @returns {Array<{ name: string, description: string, parameters: object, connection: object, tool: string }>}
 * @exports
 * @ai.hint pure
 */
export function mcpToolEntries(connections = []) {
    const out = [];
    for (const [index, connection] of (connections ?? []).entries()) {
        const prefix = `mcp_${token(connection?.name ?? index)}`;
        for (const tool of connection?.tools ?? []) {
            if (!tool || typeof tool.name !== 'string') continue;
            out.push({
                name: `${prefix}_${token(tool.name)}`,
                description: String(tool.description ?? ''),
                parameters: tool.inputSchema && typeof tool.inputSchema === 'object'
                    ? tool.inputSchema
                    : { type: 'object', properties: {} },
                connection,
                tool: tool.name,
            });
        }
    }
    return out;
}

/**
 * The argument list of a tool: a JSON array of strings.
 * @param {unknown} raw
 * @returns {string[]}
 * @ai.hint pure
 */
function parseArgsList(raw) {
    if (Array.isArray(raw)) return raw.map((item) => String(item));
    if (typeof raw !== 'string' || !raw.trim()) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map((item) => String(item));
    } catch { /* not JSON: treat it as one argument */ }
    return [raw];
}

/**
 * Read a fetch body with a hard byte cap.
 * @param {Response} res
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
async function readCapped(res, maxBytes) {
    const reader = res.body?.getReader();
    if (!reader) {
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > maxBytes) throw new Error(`Ответ длиннее ${maxBytes} байт.`);
        return buffer;
    }
    const chunks = [];
    let bytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new Error(`Ответ длиннее ${maxBytes} байт.`);
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
}

/**
 * The readable text of an HTML page: the scripts and the styles are dropped, the tags become
 * spaces, the spaces are folded.
 * @param {string} html
 * @returns {string}
 * @ai.hint pure
 */
export function htmlToText(html) {
    return String(html ?? '')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Fetch a page and read its text.
 * @param {{ url: string, maxBytes?: number, timeoutMs?: number }} request
 * @returns {Promise<{ text: string, bytes: number, status: number, url: string }>}
 */
async function fetchPage({ url, maxBytes = 64 * 1024, timeoutMs = 30_000 }) {
    let address;
    try { address = new URL(String(url ?? '')); } catch { throw new Error(`Некорректный адрес: ${url}`); }
    if (!['http:', 'https:'].includes(address.protocol)) throw new Error(`Адрес должен быть http или https: ${url}`);
    const response = await fetch(address, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
        headers: { 'User-Agent': 'ai-webdev/0.3 (+https://github.com/u2re-space/u2ai-webdev)' },
    });
    if (!response.ok) throw new Error(`Запрос ${url} вернул ${response.status}.`);
    const type = response.headers.get('content-type') ?? '';
    const raw = await readCapped(response, maxBytes * 4);
    const body = raw.toString('utf8');
    const text = type.includes('html') ? htmlToText(body) : body;
    const clipped = text.length > maxBytes ? `${text.slice(0, maxBytes)}\n…страница обрезана` : text;
    return { text: clipped, bytes: Buffer.byteLength(clipped), status: response.status, url: response.url };
}

/**
 * The entry point of the project: the page the browser opens.
 *
 * The model may name a page; otherwise the entry point of the project is found the way the
 * build stage finds it: `index.html` of the root, of `src/` or of `public/`.
 * @param {string} root
 * @param {string} [page]
 * @returns {Promise<string>} the path of the page, relative to the root
 * @ai.hint io
 */
/**
 * The page of the project the browser opens.
 *
 * The project on Vite keeps its styles inside the script, so the page of the root has no styles
 * at all: the build (`dist/`) is what shows something when there is no live server.
 * @param {string} root
 * @param {string} [page]
 * @returns {Promise<string>}
 * @ai.hint io
 */
async function entryPage(root, page = '') {
    const named = String(page ?? '').trim();
    if (named) {
        const { rel } = await resolveInside(root, named, { allowRoot: false });
        return rel;
    }
    for (const name of ['dist/index.html', 'index.html', 'src/index.html', 'public/index.html']) {
        const found = await stat(path.join(root, name)).then((info) => info.isFile()).catch(() => false);
        if (found) return name;
    }
    throw new Error('Страница не найдена: в проекте нет index.html. Соберите проект или назовите страницу.');
}

/**
 * Create a toolset executor bound to a working directory.
 *
 * Every path the model names is resolved inside the working directory, and every file the model
 * writes has to land in one of the directories the current stage opened for writing.
 *
 * The map of the run is the fast path: the search and the read of a file the map knows do not
 * touch the disk. The context of the run is the memory: the answer of a question that was
 * already asked comes from the cache, and every call is written into the journal.
 * @param {{ root: string, config: object, role?: string|null, mcp?: object[],
 *   writeDirs?: string[], env?: object, context?: object|null, map?: object|null,
 *   notify?: ((event: object) => void)|null, askUser?: Function|null }} opts
 * @returns {{ execute: (name: string, args: object) => Promise<string>, specs: object[],
 *   specsFor: Function, setWriteDirs: Function, writeDirs: Function }}
 */
export function createToolset({ root, config, role = null, mcp = [], writeDirs = null, writeFiles = null, env = process.env, context = null, map = null, notify = null, signal = null, askUser = null }) {
    const mcpTools = mcpToolEntries(mcp);
    const mcpSpecs = mcpTools.map((entry) => ({
        type: 'function',
        name: entry.name,
        description: entry.description,
        parameters: entry.parameters,
    }));
    const specs = [...buildSpecs(config?.tools, { role }), ...mcpSpecs];
    let allowed = (writeDirs ?? [root]).map((dir) => path.resolve(dir));
    const scopedFiles = Array.isArray(writeFiles)
        ? new Set(writeFiles.map((file) => String(file ?? '').replace(/\\/g, '/').toLowerCase()))
        : null;
    // Every file the role has written with a tool — one by one, in a batch, or with a
    // patch. The disk is the truth for them, and the stage must not put the older text of
    // the answer over them.
    const writtenFiles = new Set();

    // The files the role has already read: the content of a file stays in the conversation,
    // and the second read of it costs the context of the run for nothing.
    const reads = new Map();

    /**
     * The mark of a file: its size and the time of the last change.
     *
     * A file that changed since the last read is a new file for the role, even when the
     * path is the same.
     * @param {string} target
     * @returns {Promise<string|null>}
     */
    async function stampOf(target) {
        try {
            const located = await resolveInside(root, String(target ?? ''), { allowRoot: false });
            const info = await stat(located.abs);
            return `${info.size}:${info.mtimeMs}`;
        } catch {
            return null;
        }
    }

    /**
     * Forget the reads of a path: the file changed, and its old content is not the content
     * of the disk any more.
     * @param {string} target
     * @returns {void}
     */
    function forgetReads(target) {
        const prefix = `${String(target ?? '')}|`;
        for (const key of reads.keys()) {
            if (key === prefix.slice(0, -1) || key.startsWith(prefix)) reads.delete(key);
        }
    }

    /**
     * Remember the moment of a read in the context of the run.
     *
     * The fact is the address of what has been read: the lines, the moment of every read and
     * the moment of the first one. A role that comes after sees which lines it may not read
     * again, and a file that is read in several pieces keeps the pieces it was read in — the
     * last read does not wipe the earlier ones.
     * @param {string} rel the path of the file, relative to the working directory
     * @param {{ from?: number|null, to?: number|null, totalLines?: number|null }} range
     * @returns {Promise<void>}
     */
    async function noteRead(rel, range = {}) {
        if (!context?.set) return;
        const key = `read:${rel}`;
        const previous = await context.get?.(key);
        const now = new Date().toISOString();
        const ranges = Array.isArray(previous?.ranges) ? previous.ranges.slice() : [];
        const from = Number.isFinite(range.from) ? range.from : null;
        const to = Number.isFinite(range.to) ? range.to : null;
        if (from !== null) {
            const last = ranges[ranges.length - 1];
            // The ranges that touch each other are one range.
            if (last && from <= last.to + 1 && last.from <= (to ?? from)) {
                last.to = Math.max(last.to, to ?? from);
                last.at = now;
            } else {
                ranges.push({ from, to: to ?? from, at: now });
            }
        }
        const lines = ranges.reduce((sum, item) => sum + (item.to - item.from + 1), 0);
        await context.set(key, {
            path: rel,
            from: ranges.length ? Math.min(...ranges.map((item) => item.from)) : from,
            to: ranges.length ? Math.max(...ranges.map((item) => item.to)) : to,
            totalLines: range.totalLines ?? previous?.totalLines ?? null,
            ranges,
            linesRead: lines,
            firstAt: previous?.firstAt ?? now,
            at: now,
        });
    }

    /**
     * Forget the moment of the read of a file: the file changed, and what was read of it is
     * not what is on the disk any more.
     * @param {string} rel
     * @returns {Promise<void>}
     */
    async function forgetReadFact(rel) {
        if (!context?.set) return;
        await context.set(`read:${rel}`, {
            path: rel,
            changed: true,
            ranges: [],
            linesRead: 0,
            at: new Date().toISOString(),
        });
    }

    /**
     * The directories the skill packs may live in, beyond the standard ones.
     * @returns {string[]}
     */
    function skillDirs() {
        const dir = config?.skills?.dir;
        return dir ? [path.resolve(dir)] : [];
    }

    /**
     * The text of a file, from the map of the run.
     *
     * The map is used only when the file has not changed since the map was built: the moment
     * of the last change decides, so a stale map never lies.
     * @param {string} rel путь файла относительно корня
     * @param {number|null} startLine
     * @param {number|null} endLine
     * @returns {Promise<string|null>}
     */
    async function readFromMap(rel, startLine = null, endLine = null) {
        if (!map?.enabled) return null;
        const record = map.data?.files?.[rel];
        if (!record || record.partial || !Array.isArray(record.lines)) return null;
        const info = await stat(path.join(root, ...rel.split('/'))).catch(() => null);
        if (!info?.isFile() || info.mtimeMs !== record.mtimeMs) return null;
        const lines = record.lines;
        const total = lines.length;
        const from = Math.max(1, startLine ?? 1);
        const to = Math.min(total, endLine ?? total);
        if (from > total) return null;
        const selected = lines.slice(from - 1, to);
        const width = String(to).length;
        const numbered = selected.map((line, index) => `${String(from + index).padStart(width)}| ${line}`).join('\n');
        const header = `# ${rel} — строки ${from}-${to} из ${total}`;
        return `${header}\n${numbered}`;
    }

    /**
     * The path of a file relative to the root, as the map knows it.
     * @param {string} value путь, который назвал модель
     * @returns {Promise<string|null>}
     */
    async function relativeOf(value) {
        const located = await resolveInside(root, String(value ?? ''), { allowRoot: false }).catch(() => null);
        return located?.rel ?? null;
    }

    /**
     * The key of the cache of a call: the name of the tool, its arguments and the moment of
     * the file it reads.
     * @param {string} name
     * @param {object} args
     * @returns {Promise<string>}
     */
    async function cacheKeyOf(name, args) {
        const parts = [name, JSON.stringify(args ?? {})];
        const rel = String(args?.path ?? '');
        if (rel) {
            const info = await stat(path.resolve(root, rel)).catch(() => null);
            parts.push(info?.mtimeMs ?? 'no-file');
        }
        return parts.join('|');
    }

    /**
     * Index a file of the run in the map, so the next search finds it.
     * @param {string} rel
     * @returns {Promise<void>}
     */
    async function rememberInMap(rel) {
        if (!map?.enabled || !rel) return;
        await map.update(rel).catch(() => {});
    }

    /**
     * Resolve a path the model wants to write, and refuse the ones outside the allowed dirs.
     * @param {string} value
     * @returns {Promise<{ abs: string, rel: string }>}
     */
    async function writePath(value) {
        const located = await resolveInside(root, String(value ?? ''), { forWrite: true, allowRoot: false });
        if (scopedFiles && !scopedFiles.has(located.rel.toLowerCase())) {
            throw new Error(`Запись вне списка файлов делегированной задачи запрещена: ${located.rel}`);
        }
        if (!allowed.some((dir) => isInside(dir, located.abs))) {
            throw new Error(`Запись вне разрешённого каталога запрещена: ${located.rel}`);
        }
        return located;
    }

    /** Remember a file the role has written: the file on the disk is the truth for it. */
    function rememberWrite(rel) {
        if (rel) writtenFiles.add(String(rel).replace(/\\/g, '/'));
    }

    /**
     * Resolve a directory the files of a command land in, and refuse the ones outside the
     * allowed dirs.
     *
     * The root itself is allowed here: a command that writes into the working directory is
     * the normal case, and the stage that opened the directories knows what it opened.
     * @param {string} value
     * @returns {Promise<{ abs: string, rel: string }>}
     */
    async function writeDirPath(value) {
        const located = await resolveInside(root, String(value ?? ''), { forWrite: true, allowRoot: true });
        if (scopedFiles) {
            throw new Error('Делегированная задача может писать только в явно названные файлы.');
        }
        if (!allowed.some((dir) => isInside(dir, located.abs))) {
            throw new Error(`The write outside the allowed directory is refused: ${located.rel}`);
        }
        return located;
    }

    /**
     * Run a program in the working directory and collect its answer.
     * @param {string} command
     * @param {string[]} args
     * @param {number} timeoutMs
     * @returns {Promise<string>}
     */
    async function runProgram(command, args, timeoutMs) {
        const result = await runProgramIn({
            command,
            args,
            cwd: root,
            env,
            timeoutMs,
        });
        return result.text;
    }

    /**
     * Run one of the bridge tools and answer with the answer of the external CLI.
     *
     * The log of the sibling CLI comes live: every line it writes is told to the run while
     * the CLI works, and the answer of the tool keeps the whole output.
     * @param {string} name
     * @param {object} args
     * @returns {Promise<string>}
     */
    async function callBridge(name, args) {
        const list = parseArgsList(args.args);
        // Every path of the command stays inside the root of the run.
        for (const arg of familyPathArgs(list)) {
            try {
                await resolveInside(root, arg, { allowRoot: false });
            } catch (error) {
                return `Мост ${name}: ${error.message}`;
            }
        }
        // The files of the result land in a directory the stage opened for writing.
        let output = null;
        const asked = familyOutputArg(list);
        if (asked) {
            try {
                output = await writeDirPath(asked);
            } catch (error) {
                return `Мост ${name}: ${error.message}`;
            }
        }
        const result = await runBridge({
            name,
            args: list,
            config,
            cwd: root,
            env,
            onLine: (event) => notify?.({ type: 'bridge.log', name, stream: event.stream, line: event.line }),
        });
        if (result.skipped) return `Мост ${name} выключен.`;
        if (!result.ok) {
            const detail = (result.stderr || result.stdout || '').trim();
            return `Мост ${name} не отработал: ${result.reason ?? 'неизвестная причина'}${detail ? `\n${detail}` : ''}`;
        }
        // The file of the bridge is a file of the run: the stage may pick it up.
        if (output?.rel) rememberWrite(output.rel);
        return (result.stdout.trim() || result.stderr.trim() || `${name} отработал.`);
    }

    /**
     * Померить картинку — но только если листа измерений на диске ещё нет.
     *
     * Измеритель медленный и дорогой: ответ на вопрос «что в картинке» уже лежит на диске,
     * и повторный запуск не добавляет ничего. Факт попадает в контекст прогона, чтобы
     * следующие роли знали, что картинка измерена.
     *
     * Направление дизайна измеритель не пишет: команда `design` кладёт его в рабочий каталог
     * измерителя, откуда его никто не читает. Токены референса лежат в `measurements/DESIGN.md`,
     * а решение по стилям принимает роль. Поэтому мост такую команду не зовёт.
     * @param {object} args the arguments of the tool
     * @returns {Promise<string>}
     */
    async function callMeasure(args) {
        const list = parseArgsList(args.args);
        const command = commandOf(list);
        if (command === 'design') {
            return 'Направление дизайна измеритель не пишет: токены референса лежат в '
                + 'measurements/DESIGN.md, а решение по стилям принимает роль. Измеритель не запускается. '
                + 'Если нужны размеры и цвета — вызови ["measure", "<картинка>"].';
        }
        const picture = pictureOf(list);
        const known = command === 'measure'
            ? await findMeasurement({ root, config, picture })
            : null;
        if (known) {
            await rememberMeasurement(known);
            const elements = counted(known.elements, 'элемент', 'элемента', 'элементов');
            const regions = counted(known.regions, 'регион', 'региона', 'регионов');
            return `Картинка уже измерена: ${known.path} (${elements}, ${regions}). Измеритель повторно не запускается.`;
        }
        const answer = await callBridge('ai-measure', args);
        const fresh = await findMeasurement({ root, config, picture });
        if (fresh) await rememberMeasurement(fresh);
        return answer;
    }

    /**
     * Запомнить в контексте прогона, что картинка измерена.
     * @param {{ path: string, source: string, elements: number, regions: number, rules: number }} found
     * @returns {Promise<void>}
     */
    async function rememberMeasurement(found) {
        await context?.set?.('measurements', {
            file: found.path,
            source: found.source,
            elements: found.elements,
            regions: found.regions,
            rules: found.rules,
        });
    }

    /**
     * Run one tool by name.
     * @param {string} name
     * @param {object} args
     * @returns {Promise<string>}
     */
    async function execute(name, args = {}) {
        if (role === 'styler' && (name === 'run_command' || name === 'run_script')) {
            return 'The styler cannot run shell commands or scripts. Write the stylesheet files; the build stage checks them.';
        }
        if (role === 'styler' && name === 'run_skill') {
            return 'The styler cannot run shell commands through skills. Write the stylesheet files; the build stage checks them.';
        }
        const mcpTool = mcpTools.find((entry) => entry.name === name);
        if (mcpTool) {
            const answer = await callMcp(mcpTool, args ?? {}, { signal });
            return await mcpAnswer(root, mcpTool, answer);
        }
        // The answer of a question that was already asked comes from the cache of the run.
        const key = CACHEABLE.has(name) ? await cacheKeyOf(name, args) : null;
        if (key) {
            const hit = await context?.cached?.(key);
            if (hit?.answer) {
                await context?.action?.(`${name} ${JSON.stringify(args ?? {})}`, { role });
                return String(hit.answer);
            }
        }
        const answer = await runTool(name, args);
        if (key) await context?.put?.(key, { answer, at: new Date().toISOString() });
        await context?.action?.(`${name} ${JSON.stringify(args ?? {})}`, { role });
        return answer;
    }

    /**
     * Run one tool of the catalogue.
     * @param {string} name
     * @param {object} args
     * @returns {Promise<string>}
     */
    async function runTool(name, args = {}) {
        switch (name) {
            case 'list_files': {
                const listing = await listFiles({
                    root,
                    dir: String(args.path ?? '.'),
                    depth: Math.max(1, Number(args.depth) || 2),
                    includeHidden: Boolean(args.includeHidden),
                });
                return listing.text;
            }
            case 'read_file': {
                const target = String(args.path ?? '');
                const startLine = Number.isSafeInteger(Number(args.startLine)) ? Number(args.startLine) : null;
                const endLine = Number.isSafeInteger(Number(args.endLine)) ? Number(args.endLine) : null;
                const key = `${target}|${startLine ?? ''}|${endLine ?? ''}`;
                const stamp = await stampOf(target);
                const seen = reads.get(key);
                if (seen && stamp && seen === stamp) {
                    return `Файл ${target} уже прочитан в этом разговоре и с тех пор не менялся. Его содержимое — выше в истории; читать его второй раз не нужно.`;
                }
                const rel = await relativeOf(target);
                const relKey = rel ?? target;
                if (rel) {
                    const { abs } = await resolveInside(root, target, { allowRoot: false });
                    const bytes = await readFile(abs);
                    const image = sniffType(bytes);
                    if (image.kind === 'image'
                        && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mime)) {
                        if (stamp) reads.set(key, stamp);
                        await noteRead(relKey);
                        return `Изображение ${rel} приложено к запросу.`;
                    }
                }
                const known = rel ? await readFromMap(rel, startLine, endLine) : null;
                if (known !== null) {
                    if (stamp) reads.set(key, stamp);
                    await noteRead(relKey, { from: startLine ?? 1, to: endLine ?? null });
                    return known;
                }
                const file = await readTextFile({
                    root,
                    file: target,
                    startLine,
                    endLine,
                });
                if (stamp) reads.set(key, stamp);
                // The moment of the read goes into the context of the run: the roles after
                // this one know which lines of the file have been read, and they do not
                // read them again.
                await noteRead(relKey, {
                    from: file.from,
                    to: file.to,
                    totalLines: file.totalLines,
                });
                return file.text;
            }
            case 'find_line': {
                const found = await findLines({
                    root,
                    file: String(args.path ?? ''),
                    text: String(args.text ?? ''),
                    regex: Boolean(args.regex),
                    from: Number.isSafeInteger(Number(args.startLine)) ? Number(args.startLine) : null,
                    to: Number.isSafeInteger(Number(args.endLine)) ? Number(args.endLine) : null,
                    limit: Number.isSafeInteger(Number(args.limit)) ? Number(args.limit) : 40,
                });
                if (!found.hits.length) {
                    return `В файле ${found.rel} нет строк с этим текстом (в файле ${found.totalLines} строк).`;
                }
                const lines = found.hits.map((hit) => `${hit.line}| ${hit.text}`).join('\n');
                const more = found.matched > found.hits.length
                    ? `\n… ещё ${found.matched - found.hits.length} совпадений (показаны первые ${found.hits.length})`
                    : '';
                return `# ${found.rel} — найдено строк: ${found.matched} (в файле ${found.totalLines} строк)\n${lines}${more}`;
            }
            case 'patch_file': {
                const target = await writePath(args.path);
                forgetReads(target.rel);
                const result = await patchFile({
                    root,
                    file: target.rel,
                    edits: Array.isArray(args.edits) ? args.edits : [],
                });
                rememberWrite(target.rel);
                await rememberInMap(target.rel);
                await forgetReadFact(target.rel);
                return `Файл ${result.rel} изменён: правок ${result.applied}, строк затронуто ${result.lines}, `
                    + `размер ${result.bytes} байт.`;
            }
            case 'batch': {
                const actions = Array.isArray(args.actions) ? args.actions : [];
                if (!actions.length) throw new Error('Пакет пуст: перечислите действия.');
                if (actions.length > 50) throw new Error('В пакете слишком много действий (максимум 50).');
                const lines = [];
                for (const [index, action] of actions.entries()) {
                    const tool = String(action?.tool ?? '').trim();
                    const toolArgs = action?.args && typeof action.args === 'object' ? action.args : {};
                    if (!tool) {
                        lines.push(`# ${index + 1} — действие без инструмента.`);
                        continue;
                    }
                    if (!BATCH_TOOLS.has(tool)) {
                        lines.push(`# ${index + 1} — инструмент «${tool}» в пакете не выполняется `
                            + `(доступны: ${[...BATCH_TOOLS].join(', ')}).`);
                        continue;
                    }
                    try {
                        const answer = await runTool(tool, toolArgs);
                        const body = String(answer ?? '').trim();
                        lines.push(`# ${index + 1} ${tool}${body ? `\n${body}` : ''}`);
                    } catch (error) {
                        lines.push(`# ${index + 1} ${tool} — не удалось: ${error?.message ?? error}`);
                    }
                }
                return lines.join('\n\n');
            }
            case 'write_file': {
                const target = await writePath(args.path);
                forgetReads(target.rel);
                const result = await writeTextFile({ root, file: target.rel, content: String(args.content ?? '') });
                rememberWrite(target.rel);
                await rememberInMap(target.rel);
                await forgetReadFact(target.rel);
                await context?.file?.(target.rel);
                return `Записан ${result.rel} (${result.bytes} байт${result.created ? ', новый файл' : ''}).`;
            }
            case 'replace_text': {
                const target = await writePath(args.path);
                forgetReads(target.rel);
                const result = await replaceInFile({
                    root,
                    file: target.rel,
                    search: String(args.search ?? ''),
                    replacement: String(args.replacement ?? ''),
                    all: Boolean(args.all),
                });
                rememberWrite(target.rel);
                await rememberInMap(target.rel);
                await forgetReadFact(target.rel);
                return `Заменено в ${result.rel}: ${result.replacements} (${result.bytes} байт).`;
            }
            case 'delete_file': {
                const target = await writePath(args.path);
                forgetReads(target.rel);
                const result = await deleteFile({ root, file: target.rel });
                await rememberInMap(target.rel);
                await forgetReadFact(target.rel);
                return `Удалён ${result.rel}. Снимок: ${result.projectBackup?.id ?? 'нет'}.`;
            }
            case 'make_dir': {
                const target = await writePath(args.path);
                const result = await makeDirectory({ root, dir: target.rel });
                return `Создан каталог ${result.rel}.`;
            }
            case 'copy_path': {
                const source = await resolveInside(root, String(args.source ?? ''), { allowRoot: false });
                const destination = await writePath(args.destination);
                const result = await copyPath({ root, source: source.rel, destination: destination.rel });
                rememberWrite(result.destination);
                await rememberInMap(result.rel ?? destination.rel);
                return `Скопировано ${result.rel ?? source.rel} → ${destination.rel}.`;
            }
            case 'search_files': {
                const query = String(args.query ?? '');
                const scope = String(args.scope ?? (args.inContent === 0 || args.inContent === false || args.inContent === '0' ? 'path' : 'content'));
                // The map answers the search without touching the disk; only the files it did
                // not read in full are looked at again.
                if (map?.enabled && query.trim()) {
                    const located = await resolveInside(root, String(args.path ?? '.'), { allowRoot: true });
                    const found = map.search({
                        query,
                        dir: located.rel,
                        scope,
                        regex: Boolean(args.regex),
                        glob: String(args.glob ?? ''),
                        maxResults: 60,
                    });
                    const hits = found.text ? found.text.split('\n') : [];
                    const matcher = Boolean(args.regex) ? new RegExp(query, 'i') : null;
                    for (const rel of found.partial) {
                        const body = await readTextFile({ root, file: rel }).catch(() => null);
                        if (!body) continue;
                        const hit = matcher ? matcher.test(body.text) : body.text.toLowerCase().includes(query.toLowerCase());
                        if (hit) hits.push(rel);
                    }
                    return hits.length ? hits.join('\n') : 'Совпадений не найдено.';
                }
                const found = await searchFiles({
                    root,
                    query,
                    dir: String(args.path ?? '.'),
                    regex: Boolean(args.regex),
                    inContent: scope !== 'path' && scope !== 'symbol',
                    glob: String(args.glob ?? ''),
                });
                return found.text;
            }
            case 'list_backups': {
                const records = await listProjectBackups({
                    root,
                    file: args.path ? String(args.path) : null,
                    limit: Number(args.limit) || 20,
                });
                if (!records.length) return 'Снимков нет.';
                return records.map((record) => `${record.id}  ${record.slot}  ${record.path}  ${record.bytes} байт`).join('\n');
            }
            case 'restore_backup': {
                const result = await restoreProjectBackup({
                    root,
                    id: String(args.id ?? ''),
                    file: args.path ? String(args.path) : null,
                });
                return `Восстановлено ${result.path} из снимка ${result.id}.`;
            }
            case 'run_command': {
                const argsList = parseArgsList(args.args);
                const command = String(args.command ?? '').trim();
                const line = [command, ...argsList].join(' ');
                // A server or a watcher does not finish on its own: it would hold the run
                // until the timeout, and the work of the run would wait for nothing.
                if (BLOCKING_COMMANDS.test(line)) {
                    return 'Команда не запущена: она не заканчивается сама. Проверьте файлы проекта или запустите такую команду в фоне оболочки.';
                }
                return await runProgram(
                    command,
                    argsList,
                    Number.isSafeInteger(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 60_000,
                );
            }
            case 'run_script': {
                const script = await resolveInside(root, String(args.path ?? ''), { allowRoot: false });
                return await runProgram(
                    process.execPath,
                    [script.abs, ...parseArgsList(args.args)],
                    Number.isSafeInteger(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 120_000,
                );
            }
            case 'read_skill': {
                const skill = await readSkill(String(args.name ?? ''), root, { extraDirs: skillDirs(), env });
                if (!skill) return `Скилл не найден: ${args.name}`;
                const head = skill.description ? `${skill.description}\n\n` : '';
                return `# ${skill.name}\n\n${head}${skill.body}`;
            }
            case 'run_skill': {
                const skill = await readSkill(String(args.name ?? ''), root, { extraDirs: skillDirs(), env });
                if (!skill) return `Скилл не найден: ${args.name}`;
                const command = skill.metadata?.command;
                if (!command) return `Скилл "${skill.name}" не объявляет команду.`;
                const parts = String(command).trim().split(/\s+/);
                const timeout = Number.isSafeInteger(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 120_000;
                return await runProgram(parts[0], [...parts.slice(1), ...parseArgsList(args.args)], timeout);
            }
            case 'web_guidance': {
                // The model sometimes passes the words of the search as the whole list of
                // the arguments instead of an object with a `query`. The words are the
                // search either way: a call that names a topic asks about the topic.
                const call = Array.isArray(args) ? { query: args } : (args ?? {});
                const ids = parseArgsList(call.ids);
                const limit = Number.isSafeInteger(Number(call.limit)) && Number(call.limit) > 0
                    ? Number(call.limit)
                    : 8;
                const source = String(call.source ?? GUIDANCE_SOURCE.bundled).trim().toLowerCase();
                if (ids.length) {
                    return await guidanceRetrieveText(ids, {
                        cwd: root,
                        env,
                        source: source === GUIDANCE_SOURCE.cli ? GUIDANCE_SOURCE.cli : GUIDANCE_SOURCE.bundled,
                    });
                }
                const query = Array.isArray(call.query)
                    ? call.query.map((item) => String(item)).join(' ')
                    : String(call.query ?? '');
                return await guidanceSearchText(query, {
                    limit,
                    source: source === GUIDANCE_SOURCE.cli ? GUIDANCE_SOURCE.cli : GUIDANCE_SOURCE.bundled,
                });
            }
            case 'fetch_url': {
                const answer = await fetchPage({
                    url: String(args.url ?? ''),
                    maxBytes: Number.isSafeInteger(Number(args.maxBytes)) ? Number(args.maxBytes) : 64 * 1024,
                });
                return `HTTP ${answer.status} · ${answer.url}\n\n${answer.text}`;
            }
            case 'screenshot': {
                const page = String(args.path ?? '').trim();
                // An explicit page is served from disk, not sent to whatever happens to be
                // answering on localhost. This also lets a standalone HTML preview work when
                // the project has no dev server. Verify it first so Chromium cannot return a
                // convincing screenshot of its own 404 page.
                if (page) {
                    const { abs } = await resolveInside(root, page, { allowRoot: false });
                    if (!(await stat(abs).then((info) => info.isFile()).catch(() => false))) {
                        throw new Error(`Страница для снимка не найдена: ${page}`);
                    }
                    if (!/\.html?$/i.test(page)) {
                        throw new Error(`Снимок принимает HTML-страницу, а не ресурс ${page}; SVG проверяется локально.`);
                    }
                }
                const live = page ? { url: null, stop: async () => {} } : await ensurePage({
                    root,
                    config,
                    env,
                    timeoutMs: Number.isSafeInteger(config?.browser?.devTimeoutMs) ? config.browser.devTimeoutMs : 60_000,
                });
                let shot = null;
                try {
                    shot = await shootPage({
                        root,
                        config,
                        env,
                        page,
                        output: String(args.output ?? ''),
                        width: Number.isSafeInteger(Number(args.width)) ? Number(args.width) : 1440,
                        height: Number.isSafeInteger(Number(args.height)) ? Number(args.height) : 900,
                        url: live.url,
                    });
                } finally {
                    await live.stop?.();
                }
                await rememberInMap(shot.rel);
                const lines = [
                    `Снимок страницы готов: ${shot.rel}`,
                    `bytes: ${shot.bytes}`,
                    `движок: ${shot.engine}`,
                ];
                if (shot.log) {
                    lines.push('', 'Что страница говорит о себе:', shot.log);
                }
                lines.push(
                    'Посмотрите на снимок: так видно, что сломалось в вёрстке, чего не видно в коде.',
                );
                return lines.join('\n');
            }
            case 'generate_svg': {
                if (scopedFiles && !args.path) {
                    throw new Error('В делегированной задаче укажите точный ожидаемый путь SVG в path.');
                }
                const output = args.path ? (await writePath(args.path)).rel : '';
                const result = await generateSvg({
                    prompt: String(args.prompt ?? ''),
                    width: Number(args.width) || 512,
                    height: Number(args.height) || 512,
                    output,
                    cwd: root,
                });
                rememberWrite(result.rel);
                return `Записан SVG ${result.rel} (${result.bytes} байт).`;
            }
            case 'download_font': {
                if (scopedFiles && !args.path) {
                    throw new Error('В делегированной задаче укажите точный ожидаемый путь шрифта в path.');
                }
                const output = args.path ? (await writePath(args.path)).rel : '';
                const result = await downloadFont({
                    name: String(args.name ?? ''),
                    style: String(args.style ?? ''),
                    url: args.url ? String(args.url) : null,
                    output,
                    cwd: root,
                });
                rememberWrite(result.rel);
                return `Загружен шрифт ${result.family}: ${result.rel} (${result.bytes} байт).`;
            }
            case 'compare_images': {
                const reference = String(args.reference ?? '').trim();
                const result = String(args.result ?? '').trim();
                if (!reference || !result) {
                    throw new Error('Сравнением нужны обе картинки: reference и result.');
                }
                const viewport = config?.browser?.viewport ?? {};
                const targetWidth = Number.isSafeInteger(Number(args.width))
                    ? Number(args.width)
                    : (Number.isSafeInteger(viewport.width) ? viewport.width : null);
                const report = await compareWithReference({
                    root,
                    reference,
                    result,
                    targetWidth,
                    dprs: Array.isArray(config?.browser?.compareDprs) ? config.browser.compareDprs : undefined,
                    env,
                });
                if (!report.ok) {
                    return `Сверка не выполнена: ${report.reason ?? 'причина неизвестна'}.`
                        + (report.warnings?.length ? ` ${report.warnings.join(' ')}` : '');
                }
                const lines = [
                    `Референс ${report.reference.width}x${report.reference.height}px, снимок ${report.result.width}x${report.result.height}px.`,
                    `PPI референса: ${report.design.dpr}x — ширина дизайна ${report.design.width} CSS px.`,
                    `Сходство: ${report.similarity ?? '?'}%. RMSE: ${report.metrics?.rmse?.toFixed?.(4) ?? '?'}, `
                    + `SSIM: ${report.metrics?.ssim?.toFixed?.(4) ?? '?'}, NCC: ${report.metrics?.ncc?.toFixed?.(4) ?? '?'}.`,
                ];
                for (const candidate of report.candidates ?? []) {
                    lines.push(`  ${candidate.dpr}x (${candidate.width}px): сходство ${candidate.similarity ?? '?'}%, `
                        + `RMSE ${candidate.metrics?.rmse?.toFixed?.(4) ?? '?'}.`);
                }
                if (report.difference?.rel) {
                    lines.push(`Картинка различий: ${report.difference.rel} (красное — расхождения).`);
                }
                return lines.join('\n');
            }
            case 'download_icons': {
                if (scopedFiles) {
                    throw new Error('В делегированной задаче загрузка набора иконок запрещена: она пишет каталог файлов.');
                }
                const output = args.path ? (await writePath(args.path)).rel : '';
                const result = await downloadIcons({
                    name: String(args.name ?? ''),
                    icon: args.icon ? String(args.icon) : null,
                    icons: parseNames(args.icons),
                    variant: String(args.variant ?? 'regular'),
                    output,
                    cwd: root,
                });
                const parts = [
                    `Скачано иконок: ${result.count}. Пути: ${result.paths.slice(0, 20).join(', ')}${result.paths.length > 20 ? ', …' : ''}`,
                ];
                if (result.missing.length) parts.push(`Нет в наборе: ${result.missing.join(', ')}.`);
                if (result.failed.length) parts.push(`Не скачаны: ${result.failed.join(', ')}.`);
                return parts.join(' ');
            }
            case 'search_icons': {
                const names = await searchIcons(String(args.name ?? ''), String(args.query ?? ''), {
                    limit: Number(args.limit) || 40,
                });
                if (!names.length) return `В наборе ${args.name} нет иконок по слову "${args.query ?? ''}".`;
                return `Иконки набора ${args.name}: ${names.join(', ')}.`;
            }
            case 'call_ai_decompose':
                return await callBridge('ai-decompose', args);
            case 'call_ai_measure':
                return await callMeasure(args);
            case 'call_ai_image':
                return await callBridge('ai-image', args);
            case 'magick': {
                const list = parseArgsList(args.args);
                if (!list.length) {
                    return 'ImageMagick: no arguments. The arguments are the arguments of ImageMagick, '
                        + 'one element per argument — for example ["convert", "in.png", "out.webp"].';
                }
                // Every path of the command stays inside the root of the run.
                for (const arg of familyPathArgs(list)) {
                    try {
                        await resolveInside(root, arg, { allowRoot: false });
                    } catch (error) {
                        return `ImageMagick: ${error.message}`;
                    }
                }
                const result = await runMagick({
                    args: list,
                    env,
                    cwd: root,
                    timeoutMs: Number.isSafeInteger(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 60_000,
                });
                if (!result.ok) {
                    const why = result.reason ?? result.stderr?.trim().slice(0, 400) ?? '';
                    return `ImageMagick did not finish: ${why || `the code is ${result.code}`}.`;
                }
                const out = String(result.stdout ?? '').trim();
                const err = String(result.stderr ?? '').trim();
                return [out, err ? `stderr: ${err}` : ''].filter(Boolean).join('\n')
                    || 'ImageMagick finished the work.';
            }
            case 'ai_cli': {
                const name = String(args.cli ?? '').trim();
                if (!name) return 'The CLI is not named.';
                if (!FAMILY_CLIS[name]) {
                    return `The CLI "${name}" is not one of the house: ${familyNames().join(', ')}. `
                        + 'Read the manual with the tool `ai_cli_help`.';
                }
                const list = parseArgsList(args.args);
                const line = [name, ...list].join(' ');
                // A server or a watcher does not finish on its own: it would hold the run
                // until the timeout, and the work of the run would wait for nothing.
                if (BLOCKING_COMMANDS.test(line)) {
                    return 'The command is not started: it does not finish on its own. '
                        + 'Check the files of the project or start such a command in the background of a shell.';
                }
                // Every path of the command stays inside the root of the run.
                for (const arg of familyPathArgs(list)) {
                    try {
                        await resolveInside(root, arg, { allowRoot: false });
                    } catch (error) {
                        return `The CLI "${name}": ${error.message}`;
                    }
                }
                // The files of the result land in a directory the stage opened for writing.
                const output = familyOutputArg(list);
                if (output) {
                    try {
                        await writeDirPath(output);
                    } catch (error) {
                        return `The CLI "${name}": ${error.message}`;
                    }
                }
                const found = await resolveFamilyCli(name, { root: FAMILY_ROOT, env });
                if (!found) {
                    const spec = FAMILY_CLIS[name];
                    return `The CLI "${name}" is not installed: set ${spec.env} `
                        + `or install ${spec.package ?? 'the package'}.`;
                }
                const timeoutMs = Number.isSafeInteger(Number(args.timeoutMs))
                    ? Number(args.timeoutMs)
                    : FAMILY_TIMEOUT_MS;
                const result = await runFamilyCli({ found, args: list, cwd: root, env, timeoutMs });
                const parts = [`${name} → code ${result.code ?? 0}${result.timedOut ? ' (the time is over)' : ''}`];
                if (result.stdout.trim()) parts.push(result.stdout.trim());
                if (result.stderr.trim()) parts.push(result.stderr.trim());
                return parts.join('\n');
            }
            case 'ai_cli_help':
                return familyDoc(args.topic);
            case 'ask_user':
                if (!config?.tools?.ask_user) return 'Operator questions are disabled; make a reasonable assumption and continue.';
                if (typeof askUser !== 'function') return 'No interactive operator is available. Make a reasonable assumption, continue, and state it in your final answer.';
                return await askUser(String(args.question ?? ''));
            default:
                return `Неизвестный инструмент: ${name}`;
        }
    }

    return {
        execute,
        specs,
        writePaths() {
            return [...writtenFiles];
        },
        /**
         * The tool list of one role: the catalogue, cut down to what that role may call.
         * @param {string} roleName
         * @param {string[]|null} names
         * @returns {object[]}
         */
        specsFor(roleName, names = null) {
            // The marker `mcp:<server>` gives the role the tools of that server: the names
            // of the tools of an MCP server are not known before the server is connected, so
            // a role cannot name them one by one.
            const list = Array.isArray(names) ? names : null;
            const markers = list
                ? list.filter((name) => String(name).startsWith('mcp:')).map((name) => String(name).slice(4).toLowerCase())
                : [];
            const plain = list ? list.filter((name) => !String(name).startsWith('mcp:')) : null;
            const local = buildSpecs(config?.tools, { role: roleName, names: plain });
            if (!list) return [...local, ...mcpSpecs];
            const wanted = new Set(plain);
            const fromServers = new Set(mcpTools
                .filter((entry) => markers.some((marker) => String(entry.connection?.name ?? '').toLowerCase().includes(marker)))
                .map((entry) => entry.name));
            return [...local, ...mcpSpecs.filter((spec) => wanted.has(spec.name) || fromServers.has(spec.name))];
        },
        /**
         * Open these directories for writing; every other path is refused.
         * @param {string[]} dirs
         */
        setWriteDirs(dirs) {
            allowed = (dirs ?? []).map((dir) => path.resolve(dir));
        },
        /** The directories the model may write into right now. */
        writeDirs() {
            return [...allowed];
        },
    };
}
