/**
 * @file src/cli/config.js
 * @module cli/config
 * @purpose `ai-webdev config` — create, show or locate the configuration of the CLI.
 *
 *   The home config is optional: the CLI works on the defaults until the file appears. `init`
 *   writes the starter file once, `show` prints the merged configuration with the secret
 *   shortened, and `path` tells where the file is.
 *
 * @depends config/index, config/paths, cli/errors
 * @usedBy cli
 * @exports configCommand
 * @ai.tags cli, config
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 The command of the configuration of the home.
 */

import { ensureConfigFile, redactConfig } from '../config/index.js';
import { defaultHome, homeConfigFile } from '../config/paths.js';
import { UsageError } from './errors.js';

/**
 * `ai-webdev config [init|show|path]`
 *
 * @param {{ config: object, cwd: string, args?: string[], flags?: object, renderer?: object,
 *   env?: object }} ctx
 * @returns {Promise<number>} the exit code
 * @exports
 * @ai.hint io
 */
export async function configCommand(ctx) {
    const { config, args = [], renderer = null, env = process.env } = ctx;
    const sub = String(args[0] ?? 'show').trim().toLowerCase();
    const home = defaultHome(env);

    if (sub === 'init') {
        const result = await ensureConfigFile(env);
        renderer?.note?.(result.created
            ? `The configuration is written: ${result.file}`
            : `The configuration is already there: ${result.file}`);
        return 0;
    }

    if (sub === 'path') {
        renderer?.note?.(homeConfigFile(home));
        return 0;
    }

    if (sub === 'show') {
        renderer?.note?.(JSON.stringify(redactConfig(config), null, 2));
        return 0;
    }

    throw new UsageError('Доступно: ai-webdev config init | show | path');
}
