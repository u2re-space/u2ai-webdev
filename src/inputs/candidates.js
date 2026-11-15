/**
 * @file src/inputs/candidates.js
 * @module inputs/candidates
 * @purpose The path of an input may be a list of candidates: the first file that is there is
 *          the input of the run.
 *
 *   The measurer writes its delivery into `<root>/measurements/`, and a project may keep a
 *   copy of the sheet in its root. The run does not guess: it asks the contract of the
 *   project first — `.ai/manifest.json` says where every system put its work — and only then
 *   it tries the candidates of the config, and takes the first file that is there.
 *
 * @depends node:path, node:fs/promises, config/defaults, shared/house
 * @usedBy inputs/index, inputs/measured, stages/pictures
 * @exports inputCandidates, findInput, findContractInput
 * @ai.tags inputs, config
 * @ai.hint io
 */

import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { defaults } from '../config/defaults.js';
import { findGenerated } from '../shared/house.js';

/**
 * The candidates of one input: the value of the config comes first, the defaults come
 * after. A string becomes a list of one, and the empty names are dropped.
 * @param {unknown} value the value of the config
 * @param {string} [kind] the name of the input (`designMd`, `measurements`, ...)
 * @returns {string[]} the paths, relative to the root of the project
 * @exports
 * @ai.hint pure
 */
export function inputCandidates(value, kind = '') {
    const list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
    const fallback = kind && Array.isArray(defaults.inputs?.[kind]) ? defaults.inputs[kind] : [];
    const out = [];
    for (const item of [...list, ...fallback]) {
        const rel = String(item ?? '').trim();
        if (!rel || out.includes(rel)) continue;
        out.push(rel);
    }
    return out;
}

/**
 * The first candidate that is a file of the project.
 * @param {string} root the project directory
 * @param {string[]|string} candidates the paths, relative to the root
 * @returns {Promise<{ path: string, text: string, mtimeMs: number }|null>}
 * @exports
 * @ai.hint io
 */
export async function findInput(root, candidates = []) {
    for (const rel of inputCandidates(candidates)) {
        const abs = path.resolve(root, rel);
        const info = await stat(abs).catch(() => null);
        if (!info?.isFile()) continue;
        const text = await readFile(abs, 'utf8').catch(() => null);
        if (text === null) continue;
        return { path: rel, text, mtimeMs: info.mtimeMs };
    }
    return null;
}

/**
 * The first candidate that is a file of the project, the contract of the project first.
 *
 * The contract is the truth: the system that made the thing named where it lies. The
 * candidates of the config come after, so a project made before the contract still works.
 * @param {string} root the project directory
 * @param {string} name the name of the artifact (`measurements`, `palette`, `tokens`, ...)
 * @param {string[]|string} candidates the paths, relative to the root
 * @returns {Promise<{ path: string, text: string, mtimeMs: number }|null>}
 * @exports
 * @ai.hint io
 */
export async function findContractInput(root, name, candidates = []) {
    const list = inputCandidates(candidates);
    const declared = await findGenerated(root, name, list);
    if (declared) {
        const found = await findInput(root, [declared, ...list]);
        if (found) return found;
    }
    return await findInput(root, list);
}
