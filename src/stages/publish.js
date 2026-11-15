/**
 * @file src/stages/publish.js
 * @module stages/publish
 * @purpose Sign the contract of the project for the run that has just finished.
 *
 *   The contract of the project is `.ai/manifest.json`: one file that says what every
 *   system of the house made and where it lies. The webdev signs its own part of it — the
 *   site it built, the assets it prepared, the files it wrote — and never touches the part
 *   of another system.
 *
 *   The paths in the contract are relative to the project and with forward slashes: the
 *   systems of the house read the contract on another machine and another system, and the
 *   path has to mean the same thing there.
 *
 * @depends node:path, shared/house
 * @usedBy pipeline, cli/run
 * @exports publishRun
 * @ai.tags house, manifest, pipeline
 * @ai.hint io
 */

import { HOUSE_SYSTEMS, publish } from '../shared/house.js';

/**
 * Publish what the run made.
 *
 * The contract is a hint, not a reason to fail: a run that cannot write it warns and goes
 * on.
 * @param {string} root the project directory
 * @param {object} [config] the config of the run
 * @param {object} [progress] the progress of the run
 * @returns {Promise<object|null>} the contract after the change, or null
 * @exports
 * @ai.hint io
 */
/**
 * The path of the contract, as the project sees it: relative, without `./`, with slashes.
 * @param {string} value
 * @returns {string}
 * @ai.hint pure
 */
function projectPath(value) {
    const text = String(value ?? '').trim().replace(/\\/g, '/');
    if (!text) return '';
    return text.replace(/^\.\//, '').replace(/\/+$/, '');
}

export async function publishRun(root, config = {}, progress = {}) {
    const files = (progress?.files ?? [])
        .map((file) => String(file?.path ?? '').trim())
        .filter(Boolean);

    const artifacts = { site: '.' };
    const assets = projectPath(config?.output?.assets);
    if (assets) artifacts.assets = assets;
    const pictures = projectPath(config?.pictures?.dir);
    if (pictures) artifacts.pictures = pictures;

    return await publish(root, HOUSE_SYSTEMS.webdev, {
        delivery: '.',
        artifacts,
        extra: {
            runId: progress?.id ?? null,
            status: progress?.status ?? null,
            files,
        },
    });
}
