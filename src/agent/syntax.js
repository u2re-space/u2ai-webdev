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
 * @exports SCRIPT_EXTENSIONS, STYLE_EXTENSIONS, SVG_EXTENSIONS, RASTER_EXTENSIONS,
 *          RASTER_MAGIC, BINARY_CONTENT, CHECKED_EXTENSIONS, checkableFile, checkPicture,
 *          pictureExtension, contentLooksLikePicture,
 *          findSass, firstError, styleReferences, styleImportCandidates,
 *          missingStyleReferences, missingPartials, partialName, checkScript, checkStyle,
 *          checkFile, checkFiles
 * @ai.tags tools, agent, syntax
 * @ai.hint io
 * @changed 2026-11-25 Файла, который не написан, нет ошибки синтаксиса: о нём говорит
 *                       стадия шага.
 */

import path from 'node:path';
import os from 'node:os';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';

import { findProgram, runProgram } from './programs.js';

/** The extensions of the files that hold a script. */
export const SCRIPT_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs']);

/** The extensions of the files that hold a stylesheet. */
export const STYLE_EXTENSIONS = Object.freeze(['.scss', '.sass', '.css']);

/**
 * The extensions of the files that hold a vector graphic.
 *
 * The graphic is text, and the text is checked: an SVG with a lost tag does not open.
 */
export const SVG_EXTENSIONS = Object.freeze(['.svg']);

/**
 * The extensions of the files that hold a raster picture.
 *
 * The bytes of a picture are not text, and a picture whose content does not match its
 * extension is a picture the browser will not show. The check below is the one that catches
 * it: an SVG written into a `.webp` is the most common way to get one.
 */
export const RASTER_EXTENSIONS = Object.freeze(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.bmp', '.ico']);

/**
 * The magic bytes of the raster formats the browser shows.
 *
 * A file whose first bytes are not the magic of its extension is not that format: an SVG
 * inside a `.webp` is text, and the browser refuses to show it. The check names the file and
 * the format it really is.
 * @type {Readonly<Record<string, number[]>>}
 */
export const RASTER_MAGIC = Object.freeze({
    '.webp': [0x52, 0x49, 0x46, 0x46], // RIFF
    '.png': [0x89, 0x50, 0x4e, 0x47], // ‰PNG
    '.gif': [0x47, 0x49, 0x46], // GIF
    '.bmp': [0x42, 0x4d], // BM
    '.ico': [0x00, 0x00, 0x01, 0x00],
    '.avif': [0x66, 0x74, 0x79, 0x70], // ftyp
    '.jpg': [0xff, 0xd8, 0xff],
    '.jpeg': [0xff, 0xd8, 0xff],
});

/**
 * The formats that hold bytes and not text.
 *
 * A file of one of these formats is written by a program, not by `write_file`: текст в
 * файле картинки — это картинка, которую браузер не покажет.
 * @type {ReadonlySet<string>}
 */
export const BINARY_CONTENT = Object.freeze(new Set(RASTER_EXTENSIONS));

/**
 * The extension of a file, when the file holds a picture.
 * @param {string} file
 * @returns {string|null} the extension with the dot, or null
 * @exports
 * @ai.hint pure
 */
export function pictureExtension(file) {
    const ext = path.extname(String(file ?? '').trim()).toLowerCase();
    return BINARY_CONTENT.has(ext) ? ext : null;
}

/**
 * Does the text look like a picture that was already encoded?
 *
 * A role that writes a picture as base64 writes a long line of digits; such a file is a
 * real picture, and it may be written as text. SVG, HTML and код — не картинка.
 * @param {string} content
 * @returns {Promise<boolean>}
 * @exports
 * @ai.hint io
 */
export async function contentLooksLikePicture(content) {
    const text = String(content ?? '').trim();
    if (!text) return false;
    // Начало файла SVG или разметки — это текст, а не картинка.
    if (/^<\s*svg\b/i.test(text) || /^<\s*(!doctype|html)\b/i.test(text)) return false;
    // Картинка в base64: длинная строка без пробелов и без угловых скобок.
    if (text.length < 32) return false;
    if (/[<>{}]/.test(text)) return false;
    return /^[A-Za-z0-9+/=\s]+$/.test(text);
}

/** The extensions the check knows about. */
export const CHECKED_EXTENSIONS = Object.freeze([
    ...SCRIPT_EXTENSIONS,
    ...STYLE_EXTENSIONS,
    ...SVG_EXTENSIONS,
    ...RASTER_EXTENSIONS,
]);

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
 * True when the name of a stylesheet is a package of the project.
 *
 * A project may use the styles of a package: `@use "bootstrap/scss/bootstrap"`. The file is
 * in `node_modules`, not in the project, and nobody has to write it.
 * @param {string} root
 * @param {string} ref
 * @returns {Promise<boolean>}
 * @ai.hint io
 */
async function isPackageReference(root, ref) {
    const name = String(ref ?? '').trim();
    if (!name) return false;
    const base = path.join(root, 'node_modules', ...name.split('/').filter(Boolean));
    const dir = path.dirname(base);
    const stem = path.basename(base);
    const candidates = [
        base,
        `${base}.scss`,
        `${base}.sass`,
        path.join(dir, `_${stem}.scss`),
        path.join(dir, `_${stem}.sass`),
        path.join(base, '_index.scss'),
        path.join(base, 'index.scss'),
    ];
    for (const candidate of candidates) {
        const exists = await stat(candidate).then((info) => info.isFile()).catch(() => false);
        if (exists) return true;
    }
    return false;
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
        if (!found && await isPackageReference(root, ref)) continue;
        if (!found) out.push({ ref, expected: candidates[0] ?? ref });
    }
    return out;
}

/**
 * The name of a partial of Sass: the file with the underscore.
 *
 * A stylesheet names a partial without the underscore (`@use 'variables'`), and Sass looks
 * for the file with it (`_variables.scss`). The name of the file on the disk is the one the
 * role has to write.
 * @param {string} expected the path as the stylesheet names it
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function partialName(expected) {
    const name = String(expected ?? '').trim().replace(/\\/g, '/');
    if (!name) return '';
    const dir = path.posix.dirname(name);
    const base = path.posix.basename(name);
    const ext = path.posix.extname(base) || '.scss';
    const stem = base.slice(0, -ext.length).replace(/^_/, '');
    const file = `_${stem}${ext}`;
    return dir === '.' ? file : path.posix.join(dir, file);
}

/**
 * The stylesheets that use a file that is not on the disk.
 *
 * A model writes an entry point that `@use`s five files and writes none of them: the page
 * has no styles, and the project of Vite breaks with "Can't find stylesheet to import". The
 * names of the missing files are found here, without the compiler, and every one of them is
 * named twice: as the stylesheet names it and as the file has to be written.
 * @param {string} root
 * @param {string[]} files the paths of the stylesheets
 * @returns {Promise<{ file: string, ref: string, expected: string, partial: string }[]>}
 * @exports
 * @ai.hint io
 */
export async function missingPartials(root, files = []) {
    const out = [];
    for (const rel of Array.isArray(files) ? files : []) {
        const name = String(rel ?? '').trim();
        if (!name) continue;
        for (const item of await missingStyleReferences(root, name)) {
            out.push({
                file: name,
                ref: item.ref,
                expected: item.expected,
                partial: partialName(item.expected),
            });
        }
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
    // Файла нет — это не ошибка синтаксиса: о нём говорит стадия шага («файлы не
    // написаны»). Проверка без файла читала ошибку node как «модуль не найден» и
    // звала роль чинить файл, которого никогда не было.
    const exists = await stat(abs).then((info) => info.isFile()).catch(() => false);
    if (!exists) return { file: rel, ok: true, errors: [], note: null };
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
 * Проверить картинку: байты файла должны быть того формата, который у него в имени.
 *
 * Роль, которая пишет картинку, может положить текст (SVG, код) в файл `.webp`: браузер
 * такой файл не покажет, и страница остаётся без картинки. Проверка называет файл и то,
 * чем он на самом деле является.
 *
 * @param {string} root
 * @param {string} rel
 * @returns {Promise<{ file: string, ok: boolean, errors: string[], note: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function checkPicture(root, rel) {
    const name = String(rel ?? '').trim();
    const ext = path.extname(name).toLowerCase();
    const kind = ext.replace(/^\./, '');
    const magic = RASTER_MAGIC[ext];
    if (!magic) return { file: name, ok: true, errors: [], note: null };
    const abs = path.join(root, name);
    let bytes = null;
    try {
        const buffer = await readFile(abs);
        bytes = buffer.subarray(0, 16);
    } catch {
        // Файла нет: об этом говорит стадия шага, а не проверка формата.
        return { file: name, ok: true, errors: [], note: null };
    }
    const matches = magic.every((byte, index) => bytes[index] === byte);
    if (matches) {
        // WebP лежит в контейнере RIFF: после «RIFF» идёт размер, потом «WEBP».
        if (ext === '.webp' && bytes.subarray(8, 12).toString('latin1') !== 'WEBP') {
            return { file: name, ok: false, errors: [`Файл ${name} не картинка webp: внутри контейнер RIFF, но не WEBP.`], note: null };
        }
        return { file: name, ok: true, errors: [], note: null };
    }
    // Текст внутри картинки: SVG или код. Такой файл браузер не покажет.
    const head = bytes.toString('latin1');
    if (/<svg\b/i.test(head) || head.trimStart().startsWith('<')) {
        return {
            file: name,
            ok: false,
            errors: [`Файл ${name} не картинка ${kind}: внутри SVG. Нарисуйте вектор в .svg или `
                + 'превратите его в картинку инструментом `magick` (например "magick file.svg file.webp").'],
            note: null,
        };
    }
    return {
        file: name,
        ok: false,
        errors: [`Файл ${name} не картинка ${kind}: первые байты не похожи на этот формат.`],
        note: null,
    };
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
    if (RASTER_EXTENSIONS.includes(ext)) return await checkPicture(root, name);
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
