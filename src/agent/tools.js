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
 *          agent/bridges, agent/tool-specs, agent/paths
 * @exports createToolset, toolSpecs, enabledToolNames, mcpToolEntries, htmlToText,
 *          BLOCKING_COMMANDS, WINDOWS_EXTENSIONS, quoteWindowsArg, findProgram, killTree
 * @ai.tags tools, agent
 * @ai.hint keep
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';
import { toolSpecs as buildSpecs } from './tool-specs.js';
import { listFiles, readTextFile, searchFiles, writeTextFile, replaceInFile, deleteFile, makeDirectory, copyPath } from './fs-tools.js';
import { listProjectBackups, restoreProjectBackup } from './project-backup.js';
import { generateSvg, downloadFont, downloadIcons } from './assets.js';
import { searchIcons } from './icon-sets.js';
import { runBridge } from './bridges.js';
import { readSkill } from './skills.js';
import { guidanceSearchText, guidanceRetrieveText, GUIDANCE_SOURCE } from './guidance.js';
import { runProgram as runProgramIn } from './programs.js';
import { isInside, resolveInside } from './paths.js';

export { toolSpecs, enabledToolNames } from './tool-specs.js';
export { WINDOWS_EXTENSIONS, quoteWindowsArg, findProgram, killTree } from './programs.js';

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
 * Create a toolset executor bound to a working directory.
 *
 * Every path the model names is resolved inside the working directory, and every file the model
 * writes has to land in one of the directories the current stage opened for writing.
 * @param {{ root: string, config: object, role?: string|null, mcp?: object[],
 *   writeDirs?: string[], env?: object }} opts
 * @returns {{ execute: (name: string, args: object) => Promise<string>, specs: object[],
 *   specsFor: Function, setWriteDirs: Function, writeDirs: Function }}
 */
export function createToolset({ root, config, role = null, mcp = [], writeDirs = null, env = process.env }) {
    const mcpTools = mcpToolEntries(mcp);
    const mcpSpecs = mcpTools.map((entry) => ({
        type: 'function',
        name: entry.name,
        description: entry.description,
        parameters: entry.parameters,
    }));
    const specs = [...buildSpecs(config?.tools, { role }), ...mcpSpecs];
    let allowed = (writeDirs ?? [root]).map((dir) => path.resolve(dir));

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
     * The directories the skill packs may live in, beyond the standard ones.
     * @returns {string[]}
     */
    function skillDirs() {
        const dir = config?.skills?.dir;
        return dir ? [path.resolve(dir)] : [];
    }

    /**
     * Resolve a path the model wants to write, and refuse the ones outside the allowed dirs.
     * @param {string} value
     * @returns {Promise<{ abs: string, rel: string }>}
     */
    async function writePath(value) {
        const located = await resolveInside(root, String(value ?? ''), { forWrite: true, allowRoot: false });
        if (!allowed.some((dir) => isInside(dir, located.abs))) {
            throw new Error(`Запись вне разрешённого каталога запрещена: ${located.rel}`);
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
     * @param {string} name
     * @param {object} args
     * @returns {Promise<string>}
     */
    async function callBridge(name, args) {
        const list = parseArgsList(args.args);
        const result = await runBridge({ name, args: list, config, cwd: root, env });
        if (result.skipped) return `Мост ${name} выключен.`;
        if (!result.ok) {
            const detail = (result.stderr || result.stdout || '').trim();
            return `Мост ${name} не отработал: ${result.reason ?? 'неизвестная причина'}${detail ? `\n${detail}` : ''}`;
        }
        return (result.stdout.trim() || result.stderr.trim() || `${name} отработал.`);
    }

    /**
     * Run one tool by name.
     * @param {string} name
     * @param {object} args
     * @returns {Promise<string>}
     */
    async function execute(name, args = {}) {
        const mcpTool = mcpTools.find((entry) => entry.name === name);
        if (mcpTool) {
            const result = await mcpTool.connection.call(mcpTool.tool, args ?? {});
            const content = Array.isArray(result?.content) ? result.content : null;
            if (content) {
                return content
                    .map((part) => (typeof part?.text === 'string' ? part.text : JSON.stringify(part)))
                    .join('\n');
            }
            return typeof result === 'string' ? result : JSON.stringify(result ?? null);
        }
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
                const file = await readTextFile({
                    root,
                    file: target,
                    startLine,
                    endLine,
                });
                if (stamp) reads.set(key, stamp);
                return file.text;
            }
            case 'write_file': {
                const target = await writePath(args.path);
                forgetReads(target.rel);
                const result = await writeTextFile({ root, file: target.rel, content: String(args.content ?? '') });
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
                return `Заменено в ${result.rel}: ${result.replacements} (${result.bytes} байт).`;
            }
            case 'delete_file': {
                const target = await writePath(args.path);
                forgetReads(target.rel);
                const result = await deleteFile({ root, file: target.rel });
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
                return `Скопировано ${result.rel ?? source.rel} → ${destination.rel}.`;
            }
            case 'search_files': {
                const found = await searchFiles({
                    root,
                    query: String(args.query ?? ''),
                    dir: String(args.path ?? '.'),
                    regex: Boolean(args.regex),
                    inContent: !(args.inContent === 0 || args.inContent === false || args.inContent === '0'),
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
                const ids = parseArgsList(args.ids);
                const limit = Number.isSafeInteger(Number(args.limit)) && Number(args.limit) > 0
                    ? Number(args.limit)
                    : 8;
                const source = String(args.source ?? GUIDANCE_SOURCE.bundled).trim().toLowerCase();
                if (ids.length) {
                    return await guidanceRetrieveText(ids, {
                        cwd: root,
                        env,
                        source: source === GUIDANCE_SOURCE.cli ? GUIDANCE_SOURCE.cli : GUIDANCE_SOURCE.bundled,
                    });
                }
                return await guidanceSearchText(String(args.query ?? ''), {
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
            case 'generate_svg': {
                const output = args.path ? (await writePath(args.path)).rel : '';
                const result = await generateSvg({
                    prompt: String(args.prompt ?? ''),
                    width: Number(args.width) || 512,
                    height: Number(args.height) || 512,
                    output,
                    cwd: root,
                });
                return `Записан SVG ${result.rel} (${result.bytes} байт).`;
            }
            case 'download_font': {
                const output = args.path ? (await writePath(args.path)).rel : '';
                const result = await downloadFont({
                    name: String(args.name ?? ''),
                    style: String(args.style ?? ''),
                    url: args.url ? String(args.url) : null,
                    output,
                    cwd: root,
                });
                return `Загружен шрифт ${result.family}: ${result.rel} (${result.bytes} байт).`;
            }
            case 'download_icons': {
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
                return await callBridge('ai-measure', args);
            case 'call_ai_image':
                return await callBridge('ai-image', args);
            default:
                return `Неизвестный инструмент: ${name}`;
        }
    }

    return {
        execute,
        specs,
        /**
         * The tool list of one role: the catalogue, cut down to what that role may call.
         * @param {string} roleName
         * @param {string[]|null} names
         * @returns {object[]}
         */
        specsFor(roleName, names = null) {
            const local = buildSpecs(config?.tools, { role: roleName, names });
            if (names) {
                const wanted = new Set(names);
                return [...local, ...mcpSpecs.filter((spec) => wanted.has(spec.name))];
            }
            return [...local, ...mcpSpecs];
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
