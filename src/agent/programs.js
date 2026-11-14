/**
 * @file src/agent/programs.js
 * @module agent/programs
 * @purpose The runner of the programs of the project: the lookup in the PATH, the start of a
 *          program, the collection of its answer and the kill of its tree.
 *
 *   A program is looked up the way the shell looks it up: the name itself, then the shims of
 *   Windows (`npm.cmd`, `npx.cmd`). A shim is a batch file, and a batch file is started through
 *   the shell of the system.
 *
 *   The runner never throws because of the program: a missing program, a non-zero exit code
 *   and a timeout all come back as an answer the caller may put into a report.
 *
 * @depends node:path, node:child_process, node:fs/promises
 * @usedBy agent/tools, stages/setup
 * @exports WINDOWS_EXTENSIONS, quoteWindowsArg, findProgram, killTree, runProgram
 * @ai.tags tools, agent
 * @ai.hint io
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';

/**
 * The extensions a program may have on Windows.
 *
 * On Windows the programs of the PATH are often shims: `npm` is `npm.cmd`, `npx` is
 * `npx.cmd`. A shim is a batch file, and a batch file cannot be started without a shell.
 * @type {string[]}
 * @exports
 * @ai.hint pure
 */
export const WINDOWS_EXTENSIONS = Object.freeze(['.cmd', '.exe', '.bat', '.com']);

/**
 * Quote an argument for the command line of Windows.
 *
 * The shell of Windows reads the command line as one string, so the arguments with spaces
 * or with a quote of their own have to be quoted for it.
 * @param {string} value
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function quoteWindowsArg(value) {
    const text = String(value ?? '');
    if (!text) return '""';
    if (!/[\s"&|<>^(),;]/.test(text)) return text;
    return `"${text.replace(/"/g, '\\"')}"`;
}

/**
 * Find a program of the PATH.
 *
 * The name is looked up the way the shell looks it up: the name itself, then the shims of
 * Windows. A program that is not in the PATH is not run: the runner says so instead of
 * failing later with an obscure error.
 * @param {string} name
 * @param {object} [env]
 * @returns {Promise<{ file: string, shell: boolean }|null>}
 * @exports
 * @ai.hint io
 */
export async function findProgram(name, env = process.env) {
    const command = String(name ?? '').trim();
    if (!command) return null;
    // A path is a path: it is used as it is. A shim of Windows is a batch file, and a batch
    // file is started through the shell of the system.
    if (command.includes('/') || command.includes('\\')) {
        const found = await stat(command).then((info) => info.isFile()).catch(() => false);
        if (!found) return null;
        return { file: command, shell: /\.(cmd|bat)$/i.test(command) };
    }
    const names = process.platform === 'win32'
        ? [...WINDOWS_EXTENSIONS.map((ext) => `${command}${ext}`), command]
        : [command];
    for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter)) {
        if (!dir) continue;
        for (const candidate of names) {
            const file = path.join(dir, candidate);
            const found = await stat(file).then((info) => info.isFile()).catch(() => false);
            if (!found) continue;
            // A file without an extension is a script of the shell of Unix: on Windows it is
            // not a program, so the shims are looked for first.
            if (process.platform === 'win32' && !path.extname(candidate)) continue;
            return { file, shell: candidate.endsWith('.cmd') || candidate.endsWith('.bat') };
        }
    }
    return null;
}

/**
 * Kill a program and everything it started.
 *
 * A program that started a program of its own leaves it behind when it dies: on Windows the
 * children survive the parent. The tree is killed with `taskkill`, so a server that was
 * started by mistake does not hold the machine.
 * @param {object} child the process of the program
 * @returns {void}
 * @exports
 * @ai.hint io
 */
export function killTree(child) {
    const pid = child?.pid;
    if (process.platform === 'win32' && pid) {
        try {
            spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: false, windowsHide: true }).unref?.();
        } catch { /* the process is gone already */ }
        return;
    }
    try {
        child?.kill?.();
    } catch { /* the process is gone already */ }
}

/**
 * Run a program in a directory and collect its answer.
 *
 * The program is looked up in the PATH the way the shell looks it up, so the shims of
 * Windows (`npm.cmd`, `npx.cmd`) are found and started. A program that is not in the PATH
 * is named in the answer instead of failing with an obscure error.
 * @param {{ command: string, args?: string[], cwd?: string, env?: object, timeoutMs?: number }} request
 * @returns {Promise<{ ok: boolean, code: number|null, stdout: string, stderr: string,
 *   reason: string|null, text: string }>}
 * @exports
 * @ai.hint io
 */
export async function runProgram({
    command = '',
    args = [],
    cwd = process.cwd(),
    env = process.env,
    timeoutMs = 60_000,
} = {}) {
    const name = String(command ?? '').trim();
    const list = (Array.isArray(args) ? args : []).map(String);
    if (!name) {
        return { ok: false, code: null, stdout: '', stderr: '', reason: 'команда не указана', text: 'Команда не запущена: имя программы не указано.' };
    }
    const found = await findProgram(name, env);
    if (!found) {
        return {
            ok: false,
            code: null,
            stdout: '',
            stderr: '',
            reason: `программа «${name}» не найдена в PATH`,
            text: `Команда не запущена: программа «${name}» не найдена в PATH.`,
        };
    }

    const result = await new Promise((resolve) => {
        // A shim is a batch file: it is started through the shell of the system. The path of
        // the program and its arguments are quoted for that shell.
        const line = found.shell
            ? [quoteWindowsArg(found.file), ...list.map(quoteWindowsArg)].join(' ')
            : null;
        const child = found.shell
            ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', line], {
                cwd, env, shell: false, windowsHide: true, windowsVerbatimArguments: true,
            })
            : spawn(found.file, list, { cwd, env, shell: false, windowsHide: true });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;
        const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
        timer.unref?.();
        child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
        child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ ok: false, code: null, stdout, stderr: `${stderr}${error.message}`, reason: error.message });
        });
        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                ok: code === 0 && !timedOut,
                code: code ?? null,
                stdout,
                stderr,
                reason: timedOut
                    ? `превышено время ${timeoutMs} мс`
                    : (code === 0 ? null : `код ${code ?? 0}`),
            });
        });
    });

    const head = `${name} ${list.join(' ')} → код ${result.code ?? 0}${result.reason && result.reason.startsWith('превышено') ? ` (${result.reason})` : ''}`;
    const body = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    return { ...result, text: body ? `${head}\n${body}` : head };
}
