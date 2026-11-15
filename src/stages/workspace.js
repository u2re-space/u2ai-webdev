/**
 * @file src/stages/workspace.js
 * @module stages/workspace
 * @purpose The working directory of a run: the artifacts of the stages and the state they leave.
 *
 *   Every run gets its own directory in the house: `.ai/tmp/<run id>/`. The plan, the
 *   architecture, the setup and the notes of the stages live there, so a resumed run finds
 *   what the previous run wrote and a failed run leaves its trace.
 *
 *   The place of the state is computed here and nowhere else: `shared/house.js` holds the
 *   law, this module holds the run. The model sees the same path the disk has.
 *
 * @depends node:path, node:fs/promises, shared/house
 * @usedBy stages/plan, stages/architect, stages/setup, stages/index, pipeline
 * @exports runId, sanitizeId, workRoot, runDirectory, runFile, writeJsonFile,
 *          readJsonFile
 * @ai.tags stages, workspace, state
 * @ai.hint io
 * @changed 2026-11-13 First version: the directory of a run and the json files of the stages.
 * @changed 2026-11-15 The state of a run lives in the house: `.ai/tmp/<run id>/`.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { writeFileAtomic, workDir } from '../shared/house.js';

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
    return workDir(root, config);
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
 *
 * The write is atomic: the file appears whole, so a run that dies in the middle leaves the
 * old state and not half of a new one.
 * @param {string} file
 * @param {unknown} data
 * @returns {Promise<string>} the path of the file
 * @exports
 * @ai.hint io
 */
export async function writeJsonFile(file, data) {
    await writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
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
