/**
 * @file src/inputs/measured.js
 * @module inputs/measured
 * @purpose The sheet of the measurements that is already on the disk.
 *
 *   The measurer is slow and it costs money: before it runs again, the run looks for the
 *   sheet it wrote the last time. The sheet belongs to a picture — the field `source` says
 *   which one — and it is fresh when it is newer than the picture itself.
 *
 * @depends node:path, node:fs/promises, inputs/candidates, inputs/measurements
 * @usedBy agent/tools
 * @exports findMeasurement
 * @ai.tags inputs, measurements
 * @ai.hint io
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';
import { findInput, inputCandidates } from './candidates.js';
import { parseMeasurements, summarizeMeasurements } from './measurements.js';

/**
 * The name of a picture, without the directories and in the same case.
 * @param {string} value
 * @returns {string}
 * @ai.hint pure
 */
function fileName(value) {
    return path.basename(String(value ?? '').replace(/\\/g, '/')).trim().toLowerCase();
}

/**
 * The sheet of the measurements that is already on the disk.
 *
 * The sheet is found by the candidates of `inputs.measurements` — the root of the project
 * and the directory of the measurer. A sheet of another picture is not the answer, and a
 * sheet older than the picture is stale: both of them mean that the picture is measured
 * again.
 * @param {{ root: string, config?: object, picture?: string }} options
 * @returns {Promise<{ path: string, source: string, elements: number, regions: number,
 *   rules: number }|null>}
 * @exports
 * @ai.hint io
 */
export async function findMeasurement({ root, config = {}, picture = '' } = {}) {
    const wanted = fileName(picture);
    if (!wanted) return null;

    const candidates = inputCandidates(config?.inputs?.measurements, 'measurements');
    for (const rel of candidates) {
        const found = await findInput(root, [rel]);
        if (!found) continue;
        const sheet = parseMeasurements(found.text);
        if (!sheet.present) continue;
        // The sheet says which picture it measures: a sheet of another picture is not the answer.
        if (fileName(sheet.source) !== wanted) continue;
        // The sheet is fresh when it is newer than the picture: an old sheet measures an old picture.
        const info = await stat(path.resolve(root, picture)).catch(() => null);
        if (info?.isFile() && info.mtimeMs > found.mtimeMs) continue;
        const summary = summarizeMeasurements(sheet);
        return {
            path: rel,
            source: sheet.source,
            elements: summary.elements,
            regions: summary.regions,
            rules: summary.rules,
        };
    }
    return null;
}
