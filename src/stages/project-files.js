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
import { stat } from 'node:fs/promises';

import { listStyleFiles } from './build.js';

/** Расширения файлов разметки. */
export const MARKUP_EXTENSIONS = Object.freeze(['.html', '.htm', '.vue', '.svelte', '.jsx', '.tsx']);

/** Расширения файлов стилей. */
export const STYLE_EXTENSIONS = Object.freeze(['.scss', '.sass', '.css', '.less']);

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
 * @returns {Promise<{ markup: string[], styles: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function projectFiles(root = process.cwd(), plan = null) {
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    const markup = new Set();
    const styles = new Set();
    for (const step of steps) {
        const role = String(step?.role ?? '').trim().toLowerCase();
        for (const file of Array.isArray(step?.files) ? step.files : []) {
            const rel = String(file ?? '').trim().replace(/\\/g, '/');
            if (!rel) continue;
            const ext = path.extname(rel).toLowerCase();
            if (role === 'markup' && MARKUP_EXTENSIONS.includes(ext)) markup.add(rel);
            if (role === 'styler' && STYLE_EXTENSIONS.includes(ext)) styles.add(rel);
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
        for (const rel of await listStyleFiles(root)) styles.add(rel);
    }
    const markupFiles = [];
    for (const rel of markup) {
        if (await exists(root, rel)) markupFiles.push(rel);
    }
    const styleFiles = [];
    for (const rel of styles) {
        if (await exists(root, rel)) styleFiles.push(rel);
    }
    return { markup: markupFiles.sort(), styles: styleFiles.sort() };
}
