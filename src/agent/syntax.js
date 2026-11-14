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
 *   The names of the files that a stylesheet uses are checked before the compiler is asked:
 *   a stylesheet that `@use`s a file that was never written is broken whatever the compiler
 *   says, and the name of the missing file is more useful than the error of the compiler.
 *
 * @depends node:path, node:os, node:fs/promises, agent/programs
 * @usedBy stages/step, stages/build
 * @exports SCRIPT_EXTENSIONS, STYLE_EXTENSIONS, CHECKED_EXTENSIONS, checkableFile,
 *          findSass, firstError, styleReferences, styleImportCandidates,
 *          missingStyleReferences, checkScript, checkStyle, checkFile, checkFiles
 * @ai.tags tools, agent, syntax
 * @ai.hint io
 */

import path from 'node:path';
import os from 'node:os';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';

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
 * @exports
 * @ai.hint pure
 */
export function firstError(text) {
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
 * The stylesheets that a stylesheet uses.
 *
 * Sass names the files of the other stylesheets in `@use`, `@forward` and `@import`. The name
 * may be written in any of the forms the language allows: with the extension, without it, or
 * with the underscore of a partial.
 * @param {string} content
 * @returns {string[]} the names, as they are written
 * @exports
 * @ai.hint pure
 */
export function styleReferences(content) {
    const text = String(content ?? '');
    const out = [];
    const pattern = /@(?:use|forward|import)\s+(?:url\(\s*)?['"]([^'"]+)['"]/gi;
    let match = pattern.exec(text);
    while (match) {
        const name = match[1].trim();
        if (name && !out.includes(name)) out.push(name);
        match = pattern.exec(text);
    }
    return out;
}

/**
 * True when the name of a stylesheet is a file of the project.
 *
 * The built-in modules of Sass (`sass:math`), the addresses of the web and the files of CSS
 * are not files of the project: nobody has to write them, and nobody may look for them.
 * @param {string} ref
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
function isFileReference(ref) {
    const name = String(ref ?? '').trim();
    if (!name) return false;
    if (/^[a-z][a-z0-9-]*:/i.test(name)) return false;
    if (name.startsWith('~')) return false;
    if (/^(?:https?:)?\/\//i.test(name) || name.startsWith('data:')) return false;
    if (/\.css$/i.test(name)) return false;
    return true;
}

/**
 * The files of the project that a name of a stylesheet may point to.
 *
 * The rules are the rules of Sass: the name may be written with the extension, without it,
 * with the underscore of a partial or with the folder that holds the entry of a folder.
 * @param {string} rel the path of the stylesheet that names it
 * @param {string} ref the name as it is written
 * @returns {string[]} the paths, relative to the root, in posix form
 * @exports
 * @ai.hint pure
 */
export function styleImportCandidates(rel, ref) {
    const file = String(rel ?? '').replace(/\\/g, '/');
    const dir = path.posix.dirname(file);
    const parent = dir === '.' ? '' : `${dir}/`;
    const name = String(ref ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!name) return [];
    const base = path.posix.basename(name);
    const folder = path.posix.dirname(name);
    const head = `${parent}${folder === '.' ? '' : `${folder}/`}`;
    const ext = path.posix.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    const out = [];
    /**
     * Add a candidate once.
     * @param {string} item
     * @returns {void}
     * @ai.hint pure
     */
    const add = (item) => {
        if (item && !out.includes(item)) out.push(item);
    };
    if (ext) {
        add(`${head}${base}`);
        add(`${head}_${stem}${ext}`);
        return out;
    }
    add(`${head}${stem}.scss`);
    add(`${head}_${stem}.scss`);
    add(`${head}${stem}.sass`);
    add(`${head}_${stem}.sass`);
    add(`${head}${stem}/_index.scss`);
    add(`${head}${stem}/index.scss`);
    return out;
}

/**
 * The stylesheets that a stylesheet uses and that are not on the disk.
 *
 * A model writes an entry point that `@use`s five files and writes none of them: the page
 * has no styles, and the compiler says only that it cannot find a stylesheet to import.
 * The name of the missing file is found here, without the compiler.
 * @param {string} root
 * @param {string} rel the path of the stylesheet
 * @param {{ content?: string|null }} [options]
 * @returns {Promise<{ ref: string, expected: string }[]>}
 * @exports
 * @ai.hint io
 */
export async function missingStyleReferences(root, rel, { content = null } = {}) {
    const file = String(rel ?? '').trim();
    if (!file) return [];
    const text = content ?? await readFile(path.join(root, file), 'utf8').catch(() => null);
    if (text === null) return [];
    const out = [];
    for (const ref of styleReferences(text)) {
        if (!isFileReference(ref)) continue;
        const candidates = styleImportCandidates(file, ref);
        let found = false;
        for (const candidate of candidates) {
            const exists = await stat(path.join(root, candidate)).then((info) => info.isFile()).catch(() => false);
            if (exists) {
                found = true;
                break;
            }
        }
        if (!found) out.push({ ref, expected: candidates[0] ?? ref });
    }
    return out;
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
 * The names of the files that the stylesheet uses are checked first: a stylesheet that
 * `@use`s a file that was never written is broken whatever the compiler says, and the name
 * of the missing file is more useful than the error of the compiler.
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
    const missing = await missingStyleReferences(root, rel);
    if (missing.length) {
        const errors = missing.map((item) => `Файл стилей не найден: ${item.ref} (${item.expected})`);
        return { file: rel, ok: false, errors, note: null };
    }
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
