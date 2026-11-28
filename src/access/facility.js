/**
 * @file src/access/facility.js
 * @module access/facility
 * @purpose The access of the run as a facility of Code Mode: the program may read and write
 *          the files and run the commands of the project.
 *
 *   The sandbox of Code Mode has no `import`, no `require` and no `fs`: the realm of
 *   `node:vm` cannot reach the disk at all. That is the point of the sandbox — but it also
 *   means that a program cannot do the one thing programs are for.
 *
 *   The **access** of the run is the door between the model and the machine: the files and
 *   the commands under one root, with their rights and their limits. It is already there —
 *   the tools of the run go through it. So the program gets it as a **facility**: the calls
 *   travel back to the parent over the frame protocol, the parent runs them through the
 *   access, and the answer comes back as plain data.
 *
 *   The rule of the border stays: nothing of the host crosses it. The program names a call
 *   and gives plain data; the parent answers with plain data. A path is a string, a file
 *   is a string, the answer of a command is a string — and the bytes of a picture travel as
 *   base64, because bytes are not text.
 *
 *   **The access is the access of the tools.** Everything the program writes goes through
 *   the same gates as `write_file`: the same directories are open for writing, the same
 *   step scope holds, the same map and the same memory of the run learn about it. A
 *   program must not be able to write where a role may not.
 *
 * @depends node:path, access/index
 * @usedBy agent/tools, agent/code-mode
 * @exports ACCESS_FACILITY_NAMES, accessFacilities, accessFacilityCatalog
 * @ai.tags house, code-mode, access, facility
 * @ai.hint io
 * @changed 2026-11-28 Доступ прогона стал возможностью Code Mode: программа читает и пишет
 *                       файлы и запускает команды через родителя.
 */

import { createAccess } from './index.js';

/**
 * The names of the calls of the access.
 *
 * They are named like the libraries are: `access.readFile`, `access.writeFile`. The dot
 * says what it is, and the program reaches it the same way it reaches a library — by its
 * name and its member.
 *
 * @type {ReadonlyArray<string>}
 * @exports
 */
export const ACCESS_FACILITY_NAMES = Object.freeze([
    'access.readFile',
    'access.writeFile',
    'access.readBytes',
    'access.writeBytes',
    'access.listFiles',
    'access.exists',
    'access.stat',
    'access.search',
    'access.makeDir',
    'access.remove',
    'access.copy',
    'access.run',
]);

/**
 * The description of one call of the access: what it takes and what it answers.
 *
 * @type {Readonly<Record<string, { summary: string, arguments: object }>>}
 */
const CALLS = Object.freeze({
    'access.readFile': Object.freeze({
        summary: 'Read a text file of the project and answer with its text.',
        arguments: Object.freeze({ path: 'The path of the file, relative to the root of the project.' }),
    }),
    'access.writeFile': Object.freeze({
        summary: 'Write a text file of the project.',
        arguments: Object.freeze({
            path: 'The path of the file, relative to the root of the project.',
            content: 'The text of the file.',
        }),
    }),
    'access.readBytes': Object.freeze({
        summary: 'Read a file of the project and answer with its bytes, in base64.',
        arguments: Object.freeze({ path: 'The path of the file, relative to the root of the project.' }),
    }),
    'access.writeBytes': Object.freeze({
        summary: 'Write the bytes of a file of the project. The bytes travel in base64.',
        arguments: Object.freeze({
            path: 'The path of the file, relative to the root of the project.',
            bytes: 'The bytes of the file, in base64.',
        }),
    }),
    'access.listFiles': Object.freeze({
        summary: 'List the files of the project.',
        arguments: Object.freeze({ path: 'The directory to list. Empty means the root.' }),
    }),
    'access.exists': Object.freeze({
        summary: 'Answer whether a path of the project exists.',
        arguments: Object.freeze({ path: 'The path, relative to the root of the project.' }),
    }),
    'access.stat': Object.freeze({
        summary: 'Answer with the size, the kind and the time of a path of the project.',
        arguments: Object.freeze({ path: 'The path, relative to the root of the project.' }),
    }),
    'access.search': Object.freeze({
        summary: 'Find the files of the project whose text holds a piece of it.',
        arguments: Object.freeze({
            query: 'What to look for.',
            scope: 'The directory to search in. Empty means the root.',
        }),
    }),
    'access.makeDir': Object.freeze({
        summary: 'Make a directory of the project.',
        arguments: Object.freeze({ path: 'The path of the directory, relative to the root.' }),
    }),
    'access.remove': Object.freeze({
        summary: 'Remove a file of the project.',
        arguments: Object.freeze({ path: 'The path of the file, relative to the root.' }),
    }),
    'access.copy': Object.freeze({
        summary: 'Copy a file of the project to another place.',
        arguments: Object.freeze({
            from: 'The path of the source, relative to the root.',
            to: 'The path of the copy, relative to the root.',
        }),
    }),
    'access.run': Object.freeze({
        summary: 'Run a program in the working directory of the project and answer with its output.',
        arguments: Object.freeze({
            command: 'The program to run.',
            args: 'The arguments of the program, as an array of strings.',
            timeoutMs: 'How long the program may run. Default 120000.',
        }),
    }),
});

/**
 * The catalogue of the access: what the program may call and what each call takes.
 *
 * @returns {Array<{ name: string, available: boolean, operations: string[], facility: boolean,
 *   summary: string, arguments: object }>}
 * @exports
 * @ai.hint pure
 */
export function accessFacilityCatalog() {
    return ACCESS_FACILITY_NAMES.map((name) => ({
        name,
        available: true,
        operations: [],
        facility: true,
        summary: CALLS[name]?.summary ?? '',
        arguments: CALLS[name]?.arguments ?? {},
    }));
}

/**
 * The description of the calls of the access, as the catalogue of the program wants it.
 *
 * The name of a call does not tell the program what the call does: it reads the catalogue
 * and decides by the description. So the description travels with the facility — the model
 * sees what the access offers and what each call takes.
 *
 * @returns {Record<string, { summary: string, arguments: object }>}
 * @exports
 * @ai.hint pure
 */
export function accessFacilityDescriptions() {
    const out = {};
    for (const name of ACCESS_FACILITY_NAMES) {
        out[name] = {
            summary: CALLS[name]?.summary ?? '',
            arguments: CALLS[name]?.arguments ?? {},
        };
    }
    return out;
}

/**
 * The facilities of the access, bound to one root.
 *
 * The calls go through the **access** of the run, not through the disk: у access есть свои
 * права и свои лимиты, и программа Code Mode не должна их обходить. Всё, что она пишет,
 * проходит через те же ворота, что и инструменты роли.
 *
 * The writes, though, are not the writes of the access alone: they are the writes of the
 * **role** — the directories the stage opened, the files of the step, the map of the run
 * and the memory of the run. The program writes through the same gate as `write_file`, so
 * a program cannot write where the role may not, and the stage learns about every file the
 * program has written.
 *
 * @param {{ root?: string, config?: object, env?: object, timeoutMs?: number,
 *   access?: object|null,
 *   write?: (rel: string, content: string) => Promise<unknown>,
 *   writeBytes?: (rel: string, bytes: Uint8Array) => Promise<unknown>,
 *   onWrite?: (rel: string) => Promise<void>|void }} [options]
 *   `access` is the access of the run: the caller may pass the one it already has.
 *   `write` is the gate of the role: it is called instead of the write of the access.
 * @returns {Record<string, (args: object) => Promise<unknown>>}
 * @exports
 * @ai.hint io
 */
export function accessFacilities({
    root = process.cwd(),
    config = {},
    env = process.env,
    timeoutMs = 120_000,
    access = null,
    write = null,
    writeBytes = null,
    onWrite = null,
} = {}) {
    const gate = access ?? createAccess({ root, config, env, timeoutMs });

    /**
     * The path of a call: a string inside the root.
     *
     * @param {unknown} value
     * @returns {string}
     */
    const relOf = (value) => {
        const text = String(value ?? '').trim();
        if (!text) return '';
        return text.replace(/\\/g, '/');
    };

    /**
     * The answer of a call, as plain data.
     *
     * The answer of the access is a string or a plain object: `listFiles` answers with an
     * array of names, `stat` — with an object of numbers and strings. Ничего из этого не
     * является объектом хоста.
     *
     * @param {unknown} value
     * @returns {unknown}
     */
    const plain = (value) => {
        if (value === null || value === undefined) return null;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
        if (Array.isArray(value)) return value.map((item) => plain(item));
        if (typeof value === 'object') {
            const out = {};
            for (const [key, item] of Object.entries(value)) {
                if (typeof item === 'function') continue;
                out[key] = plain(item);
            }
            return out;
        }
        return String(value);
    };

    /**
     * Write a file of the project through the gate of the role.
     *
     * @param {string} rel the path of the file
     * @param {string} content the text of the file
     * @returns {Promise<{ ok: boolean, path: string, bytes: number }>}
     */
    const putText = async (rel, content) => {
        if (typeof write === 'function') {
            const answer = await write(rel, content);
            return { ok: true, path: rel, bytes: Buffer.byteLength(content, 'utf8'), ...(answer && typeof answer === 'object' ? answer : {}) };
        }
        const result = await gate.fs.writeText(rel, content);
        await onWrite?.(rel);
        return { ok: true, path: result?.path ?? rel, bytes: result?.bytes ?? Buffer.byteLength(content, 'utf8') };
    };

    return {
        'access.readFile': async (args = {}) => {
            const rel = relOf(args.path);
            if (!rel) return { ok: false, error: 'The path is empty.' };
            const read = await gate.fs.readText(rel).catch((error) => {
                throw new Error(`The file ${rel} could not be read: ${error?.message ?? error}`);
            });
            return { ok: true, path: read.path ?? rel, content: read.text, bytes: read.bytes ?? null, truncated: Boolean(read.truncated) };
        },
        'access.writeFile': async (args = {}) => {
            const rel = relOf(args.path);
            if (!rel) return { ok: false, error: 'The path is empty.' };
            const content = typeof args.content === 'string' ? args.content : '';
            return await putText(rel, content);
        },
        'access.readBytes': async (args = {}) => {
            const rel = relOf(args.path);
            if (!rel) return { ok: false, error: 'The path is empty.' };
            const read = await gate.fs.readBytes(rel, {
                maxBytes: Number.isSafeInteger(Number(args.maxBytes)) && Number(args.maxBytes) > 0
                    ? Number(args.maxBytes)
                    : 64 * 1024 * 1024,
            }).catch((error) => {
                throw new Error(`The file ${rel} could not be read: ${error?.message ?? error}`);
            });
            return {
                ok: true,
                path: read.path ?? rel,
                bytes: Buffer.from(read.bytes).toString('base64'),
                size: read.size ?? read.bytes.byteLength,
                truncated: Boolean(read.truncated),
            };
        },
        'access.writeBytes': async (args = {}) => {
            const rel = relOf(args.path);
            if (!rel) return { ok: false, error: 'The path is empty.' };
            const bytes = Buffer.from(String(args.bytes ?? ''), 'base64');
            if (typeof writeBytes === 'function') {
                await writeBytes(rel, new Uint8Array(bytes));
                await onWrite?.(rel);
                return { ok: true, path: rel, bytes: bytes.byteLength };
            }
            const result = await gate.fs.writeBytes(rel, new Uint8Array(bytes));
            await onWrite?.(rel);
            return { ok: true, path: result?.path ?? rel, bytes: result?.bytes ?? bytes.byteLength };
        },
        'access.listFiles': async (args = {}) => {
            const rel = relOf(args.path);
            const files = await gate.fs.list(rel, { depth: Number(args.depth) > 0 ? Number(args.depth) : 2 });
            return { ok: true, path: files.path ?? rel, files: files.entries.map((item) => item.path) };
        },
        'access.exists': async (args = {}) => {
            const rel = relOf(args.path);
            if (!rel) return { ok: true, exists: false };
            const found = await gate.fs.exists(rel);
            return { ok: true, path: rel, exists: Boolean(found) };
        },
        'access.stat': async (args = {}) => {
            const rel = relOf(args.path);
            if (!rel) return { ok: false, error: 'The path is empty.' };
            const info = await gate.fs.stat(rel).catch(() => null);
            if (!info) return { ok: true, path: rel, exists: false };
            return {
                ok: true,
                path: info.path ?? rel,
                exists: true,
                type: info.type ?? null,
                size: Number(info.size ?? 0),
            };
        },
        'access.search': async (args = {}) => {
            const query = String(args.query ?? '').trim();
            if (!query) return { ok: true, matches: [] };
            const found = await gate.fs.search({
                query,
                path: relOf(args.scope) || '.',
            });
            return { ok: true, query: found.query ?? query, matches: found.matches ?? [] };
        },
        'access.makeDir': async (args = {}) => {
            const rel = relOf(args.path);
            if (!rel) return { ok: false, error: 'The path is empty.' };
            await gate.fs.makeDir(rel);
            return { ok: true, path: rel };
        },
        'access.remove': async (args = {}) => {
            const rel = relOf(args.path);
            if (!rel) return { ok: false, error: 'The path is empty.' };
            await gate.fs.remove(rel);
            await onWrite?.(rel);
            return { ok: true, path: rel, removed: true };
        },
        'access.copy': async (args = {}) => {
            const from = relOf(args.from);
            const to = relOf(args.to);
            if (!from || !to) return { ok: false, error: 'The path is empty.' };
            const result = await gate.fs.copy(from, to);
            await onWrite?.(to);
            return { ok: true, from: result?.source ?? from, to: result?.destination ?? to };
        },
        'access.run': async (args = {}) => {
            const command = String(args.command ?? '').trim();
            if (!command) return { ok: false, error: 'The command is empty.' };
            const list = Array.isArray(args.args) ? args.args.map((item) => String(item)) : [];
            const answer = await gate.exec.run(command, list, {
                timeoutMs: Number.isSafeInteger(Number(args.timeoutMs)) && Number(args.timeoutMs) > 0
                    ? Number(args.timeoutMs)
                    : timeoutMs,
            });
            return plain(answer);
        },
    };
}
