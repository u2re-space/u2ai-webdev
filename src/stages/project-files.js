/**
 * @file src/stages/project-files.js
 * @module stages/project-files
 * @purpose Файлы разметки и файлы стилей проекта: те, что пишут разные роли.
 *
 *   План знает, какие файлы пишет какая роль: шаг роли `markup` — это разметка, шаг роли
 *   `styler` — это стили. Когда плана нет или он молчит, файлы ищутся по диску: разметка
 *   проекта — это `index.html`, а стили — это все таблицы стилей, которые нашлись.
 *
 *   На диске смотрят только те файлы, которые есть: проверка разметки и стилей без
 *   файлов бессмысленна.
 *
 * @depends node:path, node:fs/promises, stages/build
 * @usedBy stages/review, stages/styling
 * @exports MARKUP_EXTENSIONS, STYLE_EXTENSIONS, projectFiles
 * @ai.tags stages, files, styles
 * @ai.hint io
 */

import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';

/** Расширения файлов разметки. */
export const MARKUP_EXTENSIONS = Object.freeze(['.html', '.htm', '.vue', '.svelte', '.jsx', '.tsx']);

/** Расширения файлов стилей. */
export const STYLE_EXTENSIONS = Object.freeze(['.scss', '.sass', '.css', '.less']);

/**
 * Расширения файлов кода.
 *
 * Модуль шаблона лежит файлом `.js` (`src/views/rooms.js`) — так работает проект, где
 * разметка собирается в модули. По одному расширению такой файл — код, и разметка уходит
 * кодеру. Надо учитывать каталог: код в каталоге шаблонов — это разметка.
 */
export const CODE_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);

/** Каталоги, в которых стилей проекта не бывает. */
const SKIP_DIRS = /^(?:\.git|node_modules|\.hg|\.svn|dist|build|coverage|\.next|\.nuxt|\.cache|\.venv|venv|__pycache__|target|\.backup|\.tmp|\.ai)$/i;

/**
 * Все таблицы стилей проекта, какие есть на диске.
 *
 * Поиск `listStyleFiles` знает только об исходниках (`scss`, `sass`) — собранный `css` для
 * сборки артефакт. Здесь нужны все: проект может быть на чистом CSS, и роль зрения имеет
 * право править именно тот файл, который лежит на диске.
 * @param {string} root
 * @param {{ limit?: number, depth?: number }} [options]
 * @returns {Promise<string[]>}
 * @ai.hint io
 */
async function listAllStyleFiles(root, { limit = 200, depth = 6 } = {}) {
    const found = [];
    /**
     * Обойти один каталог.
     * @param {string[]} parts
     * @param {number} level
     * @returns {Promise<void>}
     */
    async function walk(parts, level) {
        if (found.length >= limit || level > depth) return;
        const entries = await readdir(path.join(root, ...parts), { withFileTypes: true }).catch(() => null);
        if (!entries) return;
        for (const entry of entries) {
            if (found.length >= limit) return;
            if (entry.isDirectory()) {
                if (SKIP_DIRS.test(entry.name)) continue;
                await walk([...parts, entry.name], level + 1);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!STYLE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue;
            found.push(path.posix.join(...parts, entry.name));
        }
    }
    await walk([], 0);
    return found.sort();
}

/**
 * Есть ли такой файл в проекте.
 * @param {string} root
 * @param {string} rel
 * @returns {Promise<boolean>}
 * @ai.hint io
 */
async function exists(root, rel) {
    return await stat(path.join(root, rel)).then((info) => info.isFile()).catch(() => false);
}

/**
 * Файлы разметки и файлы стилей проекта.
 *
 * @param {string} root
 * @param {object|null} [plan]
 * @returns {Promise<{ markup: string[], styles: string[], code: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function projectFiles(root = process.cwd(), plan = null) {
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    const markup = new Set();
    const styles = new Set();
    const code = new Set();
    for (const step of steps) {
        const role = String(step?.role ?? '').trim().toLowerCase();
        for (const file of Array.isArray(step?.files) ? step.files : []) {
            const rel = String(file ?? '').trim().replace(/\\/g, '/');
            if (!rel) continue;
            const ext = path.extname(rel).toLowerCase();
            if (role === 'markup' && MARKUP_EXTENSIONS.includes(ext)) markup.add(rel);
            if (role === 'styler' && STYLE_EXTENSIONS.includes(ext)) styles.add(rel);
            if (role === 'coder' && CODE_EXTENSIONS.includes(ext)) code.add(rel);
        }
    }
    if (!markup.size) {
        for (const name of ['index.html', 'src/index.html', 'public/index.html']) {
            if (await exists(root, name)) {
                markup.add(name);
                break;
            }
        }
    }
    if (!styles.size) {
        for (const rel of await listAllStyleFiles(root)) styles.add(rel);
    }
    const markupFiles = [];
    for (const rel of markup) {
        if (await exists(root, rel)) markupFiles.push(rel);
    }
    const styleFiles = [];
    for (const rel of styles) {
        if (await exists(root, rel)) styleFiles.push(rel);
    }
    const codeFiles = [];
    for (const rel of code) {
        if (await exists(root, rel)) codeFiles.push(rel);
    }
    return { markup: markupFiles.sort(), styles: styleFiles.sort(), code: codeFiles.sort() };
}
