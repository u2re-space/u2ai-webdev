/**
 * @file src/cli/compatibility.js
 * @module cli/compatibility
 * @purpose The check of the environment: the CLI needs Node.js 26 and nothing else.
 *
 *   The package uses `node:sqlite`, the FTS5 index and the new test runner, so an
 *   older Node.js cannot run it. The check happens before the config is read and the
 *   message is in Russian: it is the first thing a user sees.
 *
 * @depends cli/errors
 * @usedBy cli
 * @exports MIN_NODE_MAJOR, nodeMajor, checkNode
 * @ai.tags cli, compatibility
 * @ai.hint keep
 * @changed 2026-11-13 First version: the check of Node.js 26+.
 */

import { UsageError } from './errors.js';

/** The major version of Node.js the CLI needs. */
export const MIN_NODE_MAJOR = 26;

/**
 * The major version of a version string.
 *
 * @param {string} [version] the version, `process.versions.node` by default
 * @returns {number} the major version, or 0 when the string is not a version
 * @exports
 * @ai.hint pure
 */
export function nodeMajor(version = process.versions.node) {
    const major = Number.parseInt(String(version ?? '').split('.')[0], 10);
    return Number.isSafeInteger(major) ? major : 0;
}

/**
 * Check that the Node.js in use is new enough.
 *
 * @param {string} [version] the version to check
 * @returns {boolean} true when the version is fine
 * @throws {UsageError} when Node.js is too old
 * @exports
 * @ai.hint pure
 */
export function checkNode(version = process.versions.node) {
    const major = nodeMajor(version);
    if (major < MIN_NODE_MAJOR) {
        throw new UsageError(`Нужен Node.js ${MIN_NODE_MAJOR}+; запущен ${version}.`);
    }
    return true;
}
