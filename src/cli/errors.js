/**
 * @file src/cli/errors.js
 * @module cli/errors
 * @purpose The errors of the CLI: a usage error is the fault of the user, a runtime error is
 *          the fault of the run.
 *
 *   The dispatcher maps them to the exit codes: a usage error leaves 2, a runtime error
 *   leaves 1.
 *
 * @depends none
 * @usedBy cli, cli/install
 * @exports UsageError, RuntimeError_
 * @ai.tags cli
 * @ai.hint keep
 * @changed 2026-11-13 First version.
 */

/**
 * The command was called wrongly: the message names what to do instead.
 */
export class UsageError extends Error {
    /**
     * @param {string} message
     */
    constructor(message) {
        super(message);
        this.name = 'UsageError';
        this.code = 'usage';
    }
}

/**
 * The command was called correctly but could not finish.
 */
export class CommandError extends Error {
    /**
     * @param {string} message
     * @param {{ cause?: unknown }} [options]
     */
    constructor(message, { cause = undefined } = {}) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = 'CommandError';
        this.code = 'runtime';
    }
}
