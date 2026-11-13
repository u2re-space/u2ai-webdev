/**
 * @file src/structure/structure.js
 * @module structure/structure
 * @purpose Apply the structural tasks to a file or to a selected range of it.
 *
 *   The tasks are deterministic: sorting the imports, sorting and grouping the properties of a
 *   stylesheet, merging the rules that repeat. The task is applied to a slice of the file, so
 *   a selection from an editor limits the edit to that range and leaves the rest of the file
 *   untouched.
 *
 *   A task this module does not know is not run here: it belongs to the roles of the stages,
 *   which ask the model for the rewrite.
 *
 * @depends node:fs/promises, agent/paths, agent/fs-tools, structure/imports, structure/style
 * @usedBy stages/markup, stages/coding, stages/styling, agent/tools
 * @exports STRUCTURE_TASKS, STYLE_TASKS, normalizeStructureTasks, languageOf, structureText,
 *          structureCode
 * @ai.tags structure, edit
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the model rewrite moved to the roles.
 */

import { readFile } from 'node:fs/promises';
import { resolveInside } from '../agent/paths.js';
import { writeTextFile } from '../agent/fs-tools.js';
import { sortImports } from './imports.js';
import { parseStyle, printStyle, styleTasks } from './style.js';

/** The built-in task names. An unknown name belongs to the model. */
export const STRUCTURE_TASKS = Object.freeze([
    'sort-imports', 'sort-rules', 'sort-properties', 'group-properties', 'group-selectors',
    'layers', 'clean', 'dedupe', 'merge', 'sort-lines',
]);

/** The tasks that work on a stylesheet. */
export const STYLE_TASKS = Object.freeze(Object.keys(styleTasks));

const ALIASES = Object.freeze({
    unify: 'group-selectors',
    'merge-rules': 'merge',
    'sort-css': 'sort-rules',
    'sort-selectors': 'sort-rules',
    format: 'clean',
});

const STYLE = new Set(['css', 'scss', 'sass', 'less']);
const SCRIPT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts']);
const STYLE_TASK_NAMES = new Set(STYLE_TASKS);

/**
 * The canonical name of a task.
 * @param {string} name
 * @returns {string}
 * @ai.hint pure
 */
function canonical(name) {
    const task = String(name ?? '').trim().toLowerCase();
    return ALIASES[task] ?? task;
}

/**
 * The tasks of a language when the request names none.
 * @param {string} language
 * @returns {string[]}
 * @ai.hint pure
 */
function defaultTasks(language) {
    if (STYLE.has(language)) return ['dedupe', 'merge', 'group-properties', 'sort-rules', 'clean'];
    if (SCRIPT.has(language)) return ['sort-imports', 'clean'];
    return ['clean'];
}

/**
 * Split the requested tasks into the ones this module runs and the ones it does not.
 * @param {string[]|string|null|undefined} tasks
 * @param {string} language
 * @returns {{ known: string[], unknown: string[] }}
 * @exports
 * @ai.hint pure
 */
export function normalizeStructureTasks(tasks, language) {
    const list = Array.isArray(tasks) ? tasks : typeof tasks === 'string' ? tasks.split(',') : [];
    const names = list.map(canonical).filter(Boolean);
    const chosen = names.length ? names : defaultTasks(language);
    const known = [];
    const unknown = [];
    for (const task of chosen) {
        if (STRUCTURE_TASKS.includes(task)) known.push(task);
        else unknown.push(task);
    }
    return { known, unknown };
}

/**
 * The language of a piece of text: the request names it, or the extension of the path does.
 * @param {object} request
 * @param {string} text
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function languageOf(request, text) {
    const named = typeof request.language === 'string' ? request.language.trim().toLowerCase().replace(/^\./, '') : '';
    if (named) return named;
    const filePath = typeof request.path === 'string' ? request.path : '';
    const ext = filePath.includes('.') ? filePath.split('.').pop().toLowerCase() : '';
    if (STYLE.has(ext) || SCRIPT.has(ext)) return ext;
    if (/^\s*(import|export)\b/m.test(text)) return 'ts';
    if (/\{[\s\S]*:[\s\S]*;/.test(text)) return 'scss';
    return 'text';
}

/**
 * Remove the trailing spaces and the empty runs of lines.
 * @param {string} text
 * @returns {string}
 * @ai.hint pure
 */
function cleanText(text) {
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    return text
        .split(/\r?\n/)
        .map((line) => line.replace(/[ \t]+$/g, ''))
        .join(newline)
        .replace(/(?:\r?\n){3,}/g, newline + newline);
}

/**
 * Sort the lines of a text.
 * @param {string} text
 * @returns {string}
 * @ai.hint pure
 */
function sortLines(text) {
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const trailing = lines.at(-1) === '' ? lines.pop() : null;
    lines.sort((a, b) => a.localeCompare(b));
    if (trailing === '') lines.push('');
    return lines.join(newline);
}

/**
 * Run the known tasks. The style tasks parse the tree once and print it once.
 * @param {string} text
 * @param {string[]} tasks
 * @param {string} language
 * @param {object} rules
 * @returns {string}
 * @ai.hint pure
 */
function applyKnown(text, tasks, language, rules) {
    let current = text;
    let tree = null;
    /**
     * Print the pending tree of the stylesheet back into the text.
     * @returns {void}
     * @ai.hint pure
     */
    const flush = () => {
        if (!tree) return;
        const printed = printStyle(tree);
        current = printed ? `${printed}\n` : '';
        tree = null;
    };
    for (const task of tasks) {
        if (task === 'sort-imports') { flush(); current = sortImports(current, rules); continue; }
        if (task === 'sort-lines') { flush(); current = sortLines(current); continue; }
        if (task === 'clean' && !STYLE.has(language)) { flush(); current = cleanText(current); continue; }
        if (!STYLE_TASK_NAMES.has(task)) continue;
        if (!STYLE.has(language)) throw new Error(`Задача ${task} применяется к CSS или SCSS.`);
        tree ??= parseStyle(current);
        tree = styleTasks[task](tree, rules);
    }
    flush();
    return current;
}

/**
 * The offsets of a selection. Without a selection the whole text is the slice.
 * @param {string} text the text with LF
 * @param {object|null} selection
 * @returns {{ prefix: string, slice: string, suffix: string }}
 * @ai.hint pure
 */
function splitSelection(text, selection) {
    if (!selection?.start || !selection?.end) return { prefix: '', slice: text, suffix: '' };
    const lines = text.split('\n');
    /**
     * The offset of a position in the text.
     * @param {{ line: number, character: number }} position
     * @returns {number}
     * @ai.hint pure
     */
    const offset = (position) => {
        const line = Math.min(Math.max(position.line ?? 0, 0), Math.max(0, lines.length - 1));
        let cursor = 0;
        for (let i = 0; i < line; i++) cursor += lines[i].length + 1;
        return cursor + Math.min(Math.max(position.character ?? position.column ?? 0, 0), lines[line].length);
    };
    let start = offset(selection.start);
    let end = offset(selection.end);
    if (end < start) [start, end] = [end, start];
    return { prefix: text.slice(0, start), slice: text.slice(start, end), suffix: text.slice(end) };
}

/**
 * Restructure a text.
 *
 * The tasks are the user-defined part; a task this module does not know is returned in
 * `unknown`, and the caller decides what to do with it.
 * @param {string} text
 * @param {{ language?: string, path?: string, tasks?: string[]|string, rules?: object, selection?: object }} request
 * @returns {{ text: string, slice: string, language: string, tasks: string[], unknown: string[] }}
 * @exports
 * @ai.hint pure
 */
export function structureText(text, request = {}) {
    const normalized = text.replace(/\r\n/g, '\n');
    const language = languageOf(request, normalized);
    const { known, unknown } = normalizeStructureTasks(request.tasks, language);
    const rules = request.rules && typeof request.rules === 'object' && !Array.isArray(request.rules) ? request.rules : {};
    const parts = splitSelection(normalized, request.selection);
    const slice = applyKnown(parts.slice, known, language, rules);
    const next = `${parts.prefix}${slice}${parts.suffix}`;
    const restored = text.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next;
    return { text: restored, slice, language, tasks: known, unknown };
}

/**
 * Load a file, restructure it, and optionally write it back.
 * @param {{ request: object, cwd?: string, maxWriteBytes?: number, backupDir?: string|null }} options
 * @returns {Promise<object>}
 * @exports
 * @ai.hint io
 */
export async function structureCode({ request, cwd = process.cwd(), maxWriteBytes = 4 * 1024 * 1024, backupDir = null } = {}) {
    if (request === null || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('Запрос структуры должен быть объектом.');
    }
    let content = typeof request.content === 'string' ? request.content : null;
    if (content === null) {
        if (typeof request.path !== 'string' || !request.path.trim()) throw new Error('Нужен content или path.');
        let abs;
        try {
            ({ abs } = await resolveInside(cwd, request.path, { allowRoot: false }));
        } catch (error) {
            throw new Error(error.message);
        }
        try {
            content = await readFile(abs, 'utf8');
        } catch {
            throw new Error(`Файл не найден: ${request.path}`);
        }
    }

    const built = structureText(content, request);
    let written = null;
    if (request.write && typeof request.path === 'string' && request.path.trim()) {
        written = await writeTextFile({
            root: cwd,
            file: request.path,
            content: built.text,
            overwrite: true,
            maxBytes: maxWriteBytes,
            backupDir,
            backupSlot: request.backupSlot ?? 'structure',
        });
    }

    return {
        text: built.text,
        language: built.language,
        tasks: built.tasks,
        unknown: built.unknown,
        changed: built.text !== content,
        path: written?.rel ?? request.path ?? null,
        bytes: written?.bytes ?? Buffer.byteLength(built.text),
    };
}
