/**
 * @file src/agent/paths.js
 * @module agent/paths
 * @purpose Keep model paths inside the working directory and reject secrets, symlink escapes, and noisy trees.
 * @depends access/paths
 * @usedBy agent/fs-tools, agent/map, agent/tools, agent/desktop
 * @exports NOISY_DIRS, isProtectedFileName, isForbiddenDirName, toPosix, isInside, resolveInside
 * @ai.tags paths, sandbox
 * @ai.hint keep
 * @changed 2026-11-14 The rules moved to the access layer; the words stay Russian.
 */

import {
    NOISY_DIRS,
    isProtectedFileName,
    isForbiddenDirName,
    toPosix,
    isInside,
    resolveInside as resolveInsideBase,
} from '../access/paths.js';

export { NOISY_DIRS, isProtectedFileName, isForbiddenDirName, toPosix, isInside };

/**
 * The words of the refusals: the package speaks Russian, the rules are shared.
 * @type {Readonly<{ outside: Function, secret: Function, denied: Function, readOnly: Function, symlink: Function }>}
 */
const MESSAGES = Object.freeze({
    outside: (relative) => `Путь вне рабочего каталога: ${relative}`,
    secret: (rel) => `Файл с секретами недоступен: ${rel}`,
    denied: (rel) => `Доступ запрещён: ${rel}`,
    readOnly: (segment, rel) => `Запись в ${segment} запрещена: ${rel}`,
    symlink: (rel) => `Путь через символическую ссылку выходит за рабочий каталог: ${rel}`,
});

/**
 * Resolve a model-supplied path to an absolute path inside `root`.
 * Rejects escapes (including through symlinks of existing components), secrets and
 * writes into read-only directories. Returns { abs, rel } where rel is POSIX and root-relative.
 * @param {string} root
 * @param {string} relative
 * @param {{ forWrite?: boolean, allowRoot?: boolean }} [options]
 * @returns {Promise<{ abs: string, rel: string }>}
 * @exports
 * @ai.hint io
 */
export async function resolveInside(root, relative, { forWrite = false, allowRoot = true } = {}) {
    return resolveInsideBase(root, relative, { forWrite, allowRoot, messages: MESSAGES });
}
