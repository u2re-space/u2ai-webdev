/**
 * @file src/agent/syntax.js
 * @module agent/syntax
 * @purpose The syntax check of the files a role wrote: the scripts and the styles.
 *
 *   A model writes a file with a broken string, a lost quote or a stray backslash, and the
 *   file looks fine until the browser refuses to run it. The check is done by the tools of
 *   the platform: `node --check` for the scripts, `sass` for the styles.
 *
 *   The check is honest about what it cannot do: without `sass` in the project the styles
 *   are not checked, and a file of a partial that misses a variable of another file is not
 *   a syntax error — it is checked again through the stylesheet that imports it.
 *
 * @depends node:path, node:os, node:fs/promises, agent/programs
 * @usedBy stages/step
 * @exports SCRIPT_EXTENSIONS, STYLE_EXTENSIONS, CHECKED_EXTENSIONS, checkableFile,
 *          findSass, checkScript, checkStyle, checkFile, checkFiles
 * @ai.tags tools, agent, syntax
 * @ai.hint io
 */

import path from 'node:path';
import os from 'node:os';
import { readFile, rm, writeFile } from 'node:fs/promises';

import { findProgram, runProgram } from './programs.js';

/** The extensions of the files that hold a script. */
export const SCRIPT_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs']);

/** The extensions of the files that hold a stylesheet. */
export const STYLE_EXTENSIONS = Object.freeze(['.scss', '.sass', '.css']);

/** The extensions the check knows about. */
export const CHECKED_EXTENSIONS = Object.freeze([...SCRIPT_EXTENSIONS, ...STYLE_EXTENSIONS]);

/**
 * True when the check knows this file.
 * @param {string} file
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function checkableFile(file) {
    return CHECKED_EXTENSIONS.includes(path.extname(String(file ?? '')).toLowerCase());
}

/**
 * Find the compiler of the stylesheets.
 *
 * The compiler of the project comes first: the project knows the version of its stylesheets
 * better than the machine does. The PATH is the second place.
 * @param {string} root
 * @param {object} [env]
 * @returns {Promise<string|null>}
 * @exports
 * @ai.hint io
 */
export async function findSass(root, env = process.env) {
    const names = process.platform === 'win32'
        ? ['sass.cmd', 'sass.exe', 'sass.bat']
        : ['sass'];
    for (const name of names) {
        const file = path.join(root, 'node_modules', '.bin', name);
        const found = await findProgram(file, env);
        if (found) return found.file;
    }
    const inPath = await findProgram('sass', env);
    return inPath ? inPath.file : null;
}

/**
 * The error of a compiler, without the noise around it.
 * @param {string} text
 * @returns {string}
 * @ai.hint pure
 */
function firstError(text) {
    const lines = String(text ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const error = lines.find((line) => /^(Error|SyntaxError|ParseError)/i.test(line))
        ?? lines[0]
        ?? 'неизвестная ошибка';
    return error.length > 300 ? `${error.slice(0, 300)}…` : error;
}

/**
 * Check the syntax of a script.
 *
 * The script is checked by the node of the machine: `node --check` parses the file and says
 * nothing when the file is good. A file that the package of the project calls a module is
 * checked as a module, even when the package says otherwise — a browser loads it as a
 * module, and the check has to see the same code.
 * @param {string} root
 * @param {string} rel
 * @param {{ env?: object, timeoutMs?: number }} [options]
 * @returns {Promise<{ file: string, ok: boolean, errors: string[], note: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function checkScript(root, rel, { env = process.env, timeoutMs = 30_000 } = {}) {
    const abs = path.join(root, rel);
    const result = await runProgram({
        command: process.execPath,
        args: ['--check', abs],
        cwd: root,
        env,
        timeoutMs,
    });
    if (result.ok) return { file: rel, ok: true, errors: [], note: null };

    let message = (result.stderr || result.stdout || '').trim();
    // A module in a package that does not say so: the parser of the commonjs saw `import`
    // and refused it. The file is checked once more as a module.
    if (/Cannot use import statement outside a module|Unexpected token ['"]export['"]/.test(message)) {
        const tmp = path.join(os.tmpdir(), `ai-webdev-check-${process.pid}-${Date.now()}.mjs`);
        await writeFile(tmp, await readFile(abs), 'utf8').catch(() => null);
        const retry = await runProgram({
            command: process.execPath,
            args: ['--check', tmp],
            cwd: root,
            env,
            timeoutMs,
        });
        await rm(tmp, { force: true }).catch(() => null);
        if (retry.ok) return { file: rel, ok: true, errors: [], note: null };
        message = (retry.stderr || retry.stdout || '').trim().split(tmp).join(rel);
    }
    return { file: rel, ok: false, errors: [firstError(message)], note: null };
}

/**
 * Check the syntax of a stylesheet.
 *
 * The stylesheet is compiled by the `sass` of the project. A partial that misses a variable
 * of another file is not a syntax error: it is a file that stands alone, and the error is
 * named as a note, not as a failure.
 * @param {string} root
 * @param {string} rel
 * @param {{ env?: object, timeoutMs?: number }} [options]
 * @returns {Promise<{ file: string, ok: boolean, errors: string[], note: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function checkStyle(root, rel, { env = process.env, timeoutMs = 30_000 } = {}) {
    const sass = await findSass(root, env);
    if (!sass) {
        return {
            file: rel,
            ok: true,
            errors: [],
            note: 'sass не найден: стили не проверены.',
        };
    }
    const abs = path.join(root, rel);
    const result = await runProgram({
        command: sass,
        args: ['--no-source-map', abs],
        cwd: root,
        env,
        timeoutMs,
    });
    if (result.ok) return { file: rel, ok: true, errors: [], note: null };
    const message = (result.stderr || result.stdout || '').trim();
    // A partial that stands alone misses the variables of the files that import it.
    if (/Undefined variable|Undefined mixin|Undefined function/.test(message)) {
        return {
            file: rel,
            ok: true,
            errors: [],
            note: `Файл стоит отдельно и не видит переменных других файлов: ${firstError(message)}`,
        };
    }
    return { file: rel, ok: false, errors: [firstError(message)], note: null };
}

/**
 * Check the syntax of one file.
 * @param {string} root
 * @param {string} rel
 * @param {{ env?: object, timeoutMs?: number }} [options]
 * @returns {Promise<{ file: string, ok: boolean, errors: string[], note: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function checkFile(root, rel, options = {}) {
    const name = String(rel ?? '').trim();
    const ext = path.extname(name).toLowerCase();
    if (SCRIPT_EXTENSIONS.includes(ext)) return await checkScript(root, name, options);
    if (STYLE_EXTENSIONS.includes(ext)) return await checkStyle(root, name, options);
    return { file: name, ok: true, errors: [], note: null };
}

/**
 * Check the syntax of the files of a step.
 *
 * The answer is the list of the files that were checked and the list of the errors. A file
 * that is not there is not an error of the syntax: the stage of the step says that the file
 * is missing.
 * @param {string} root
 * @param {string[]} files
 * @param {{ env?: object, timeoutMs?: number }} [options]
 * @returns {Promise<{ checked: string[], errors: { file: string, message: string }[],
 *   notes: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function checkFiles(root, files = [], options = {}) {
    const checked = [];
    const errors = [];
    const notes = [];
    for (const rel of Array.isArray(files) ? files : []) {
        const name = String(rel ?? '').trim();
        if (!name || !checkableFile(name)) continue;
        const result = await checkFile(root, name, options);
        checked.push(name);
        for (const message of result.errors) errors.push({ file: name, message });
        if (result.note) notes.push(`${name}: ${result.note}`);
    }
    return { checked, errors, notes };
}
