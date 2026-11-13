/**
 * @file src/cli.js
 * @module cli
 * @purpose Parse argv, dispatch the commands, and map the failures to the exit codes.
 * @depends node:module, help, config, cli/errors, cli/install, cli/component
 * @usedBy bin/ai-webdev, index
 * @exports EXIT, parseArgv, main
 * @ai.tags cli, dispatch
 * @ai.hint keep
 * @changed 2026-11-13 The skeleton of the CLI: the help and the version only.
 * @changed 2026-11-13 The commands of the registry: `component` and `install`.
 */

import { createRequire } from 'node:module';
import { HELP } from './help.js';
import { loadConfig } from './config/index.js';
import { UsageError, CommandError } from './cli/errors.js';
import { installCommand } from './cli/install.js';
import { componentCommand } from './cli/component.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

/** The exit codes of the CLI. */
export const EXIT = Object.freeze({ ok: 0, failure: 1, usage: 2, aborted: 130 });

/**
 * Parse the arguments of the CLI.
 *
 * The first positional is the command, the rest are its inputs; `--name=value` and
 * `--name` are flags, `-x` is a short flag.
 *
 * @param {string[]} argv
 * @returns {{ command: string|null, args: string[], flags: Record<string, string|boolean> }}
 * @exports
 * @ai.hint pure
 */
export function parseArgv(argv = []) {
    const flags = {};
    const args = [];
    for (const item of argv) {
        if (item === '--') {
            flags.rest = true;
            continue;
        }
        if (item.startsWith('--')) {
            const [name, value] = item.slice(2).split('=');
            flags[name] = value === undefined ? true : value;
        } else if (item.startsWith('-') && item.length > 1) {
            flags[item.slice(1)] = true;
        } else {
            args.push(item);
        }
    }
    return { command: args.shift() ?? null, args, flags };
}

/**
 * The commands that need the resolved configuration.
 * @type {Record<string, (ctx: object) => Promise<number>>}
 */
const CONFIG_COMMANDS = Object.freeze({
    install: installCommand,
    component: componentCommand,
});

/**
 * The entry of the CLI.
 * @param {string[]} argv
 * @returns {Promise<number>}
 * @exports
 */
export async function main(argv = []) {
    const { command, args, flags } = parseArgv(argv);
    if (flags.version || flags.v) {
        process.stdout.write(`${pkg.version}\n`);
        return EXIT.ok;
    }
    if (flags.help || flags.h || command === null || command === 'help') {
        process.stdout.write(`${HELP}\n`);
        return EXIT.ok;
    }

    const runner = CONFIG_COMMANDS[command];
    if (!runner) {
        process.stderr.write(`ai-webdev: the command "${command}" is not ready yet.\n`);
        return EXIT.failure;
    }

    try {
        const config = await loadConfig({
            configPath: typeof flags.config === 'string' ? flags.config : null,
            cwd: process.cwd(),
        });
        return await runner({ config, cwd: process.cwd(), args, flags });
    } catch (error) {
        if (error instanceof UsageError) {
            process.stderr.write(`ai-webdev: ${error.message}\n`);
            return EXIT.usage;
        }
        if (error instanceof CommandError) {
            process.stderr.write(`ai-webdev: ${error.message}\n`);
            return EXIT.failure;
        }
        process.stderr.write(`ai-webdev: ${error?.message ?? error}\n`);
        return EXIT.failure;
    }
}
