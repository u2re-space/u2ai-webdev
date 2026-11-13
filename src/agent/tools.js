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
 * @exports createToolset, toolSpecs, enabledToolNames, mcpToolEntries, htmlToText
 * @ai.tags tools, agent
 * @ai.hint keep
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { toolSpecs as buildSpecs } from './tool-specs.js';
import { listFiles, readTextFile, searchFiles, writeTextFile, replaceInFile, deleteFile, makeDirectory, copyPath } from './fs-tools.js';
import { listProjectBackups, restoreProjectBackup } from './project-backup.js';
import { generateSvg, downloadFont, downloadIcons } from './assets.js';
import { runBridge } from './bridges.js';
import { isInside, resolveInside } from './paths.js';

export { toolSpecs, enabledToolNames } from './tool-specs.js';

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
        return await new Promise((resolve, reject) => {
            const child = spawn(command, args, { cwd: root, env, shell: false, windowsHide: true });
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
            child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
            child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
            child.on('error', (error) => { clearTimeout(timer); reject(error); });
            child.on('close', (code) => {
                clearTimeout(timer);
                const head = `${command} ${args.join(' ')} → код ${code ?? 0}${timedOut ? ' (превышено время)' : ''}`;
                const body = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
                resolve(body ? `${head}\n${body}` : head);
            });
        });
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
                const file = await readTextFile({
                    root,
                    file: String(args.path ?? ''),
                    startLine: Number.isSafeInteger(Number(args.startLine)) ? Number(args.startLine) : null,
                    endLine: Number.isSafeInteger(Number(args.endLine)) ? Number(args.endLine) : null,
                });
                return file.text;
            }
            case 'write_file': {
                const target = await writePath(args.path);
                const result = await writeTextFile({ root, file: target.rel, content: String(args.content ?? '') });
                return `Записан ${result.rel} (${result.bytes} байт${result.created ? ', новый файл' : ''}).`;
            }
            case 'replace_text': {
                const target = await writePath(args.path);
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
                return await runProgram(
                    String(args.command ?? ''),
                    argsList,
                    Number.isSafeInteger(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 120_000,
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
                    variant: String(args.variant ?? 'regular'),
                    output,
                    cwd: root,
                });
                return `Скачано иконок: ${result.count}. Пути: ${result.paths.slice(0, 20).join(', ')}${result.paths.length > 20 ? ', …' : ''}`;
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
