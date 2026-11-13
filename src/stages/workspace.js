/**
 * @file src/stages/workspace.js
 * @module stages/workspace
 * @purpose The working directory of a run: the artifacts of the stages and the state they leave.
 *
 *   Every run gets its own directory under the working directory of the config (`.tmp/` by
 *   default): `<work>/<run id>/`. The plan, the architecture, the setup and the notes of the
 *   stages live there, so a resumed run finds what the previous run wrote and a failed run
 *   leaves its trace.
 *
 * @depends node:path, node:fs/promises
 * @usedBy stages/plan, stages/architect, stages/setup, stages/index, pipeline
 * @exports runId, sanitizeId, workRoot, runDirectory, runFile, writeJsonFile, readJsonFile
 * @ai.tags stages, workspace, state
 * @ai.hint io
 * @changed 2026-11-13 First version: the directory of a run and the json files of the stages.
 */

import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

/**
 * The id of a run: the date and the time of the start.
 *
 * The id is a name of a directory, so it holds only digits and dashes.
 * @param {Date} [date]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function runId(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        '-',
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('');
    return stamp;
}

/**
 * Make an id safe for a path: nothing but letters, digits, dots and dashes.
 * @param {string} id
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function sanitizeId(id) {
    const text = String(id ?? '').trim();
    if (!text) return runId();
    return text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 64) || runId();
}

/**
 * The working directory of the runs, absolute.
 * @param {string} root the project directory
 * @param {object} [config]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function workRoot(root, config = {}) {
    const work = config?.output?.work ?? './.tmp';
    return path.resolve(root, work);
}

/**
 * The directory of one run.
 * @param {string} root
 * @param {object} [config]
 * @param {string} [id]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function runDirectory(root, config = {}, id = null) {
    return path.join(workRoot(root, config), sanitizeId(id ?? runId()));
}

/**
 * The path of a file of the run.
 * @param {string} root
 * @param {object} [config]
 * @param {string} id
 * @param {string} name
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function runFile(root, config = {}, id, name) {
    return path.join(runDirectory(root, config, id), name);
}

/**
 * Write a json file, creating the directories around it.
 * @param {string} file
 * @param {unknown} data
 * @returns {Promise<string>} the path of the file
 * @exports
 * @ai.hint io
 */
export async function writeJsonFile(file, data) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return file;
}

/**
 * Read a json file. A missing file and a broken file both give null: the state of a run is
 * a hint, not a reason to fail.
 * @param {string} file
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readJsonFile(file) {
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}
