/**
 * @file src/cli.js
 * @module cli
 * @purpose Parse argv, dispatch the commands, and map the failures to the exit codes.
 *
 *   The CLI has one entry: `main`. It reads the flags, loads the config, builds the
 *   renderer and gives the work to the command. Every failure of the user is a usage
 *   error (exit code 2), every failure of the run is a runtime error (exit code 1), and
 *   an interrupted run leaves 130.
 *
 * @depends node:module, help, config, cli/errors, cli/compatibility, cli/renderer,
 *          cli/run, cli/install, cli/component, cli/config, cli/jobs, cli/memory, cli/skills
 * @usedBy bin/ai-webdev, index
 * @exports EXIT, VALUE_FLAGS, parseArgv, main
 * @ai.tags cli, dispatch
 * @ai.hint keep
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 The skeleton of the CLI: the help and the version only.
 * @changed 2026-11-13 The commands of the registry: `component` and `install`.
 * @changed 2026-11-13 The whole surface: run, plan, stages, component, install, jobs, memory.
 * @changed 2026-11-13 The command of the configuration: `config`.
 * @changed 2026-11-14 The command of the skill packs: `skills`.
 */

import { createRequire } from 'node:module';
import { HELP } from './help.js';
import { loadConfig } from './config/index.js';
import { UsageError, CommandError } from './cli/errors.js';
import { checkNode } from './cli/compatibility.js';
import { createRenderer, detectMode } from './cli/renderer.js';
import { readPipedInput } from './cli/input.js';
import { runCommand, planCommand, stagesCommand, configOverrides } from './cli/run.js';
import { sightCommand } from './cli/sight.js';
import { installCommand } from './cli/install.js';
import { componentCommand } from './cli/component.js';
import { configCommand } from './cli/config.js';
import { skillsCommand } from './cli/skills.js';
import { jobsCommand } from './cli/jobs.js';
import { memoryCommand } from './cli/memory.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

/** The exit codes of the CLI. */
export const EXIT = Object.freeze({ ok: 0, failure: 1, usage: 2, aborted: 130 });

/**
 * The flags that take a value: the value is the next argument, when it is there.
 *
 * @type {Set<string>}
 */
export const VALUE_FLAGS = new Set([
    'config', 'id', 'resume', 'route', 'stop-after', 'model', 'effort', 'summary',
    'context', 'role', 'extract', 'approve', 'pace', 'quality', 'fidelity',
    'creativity', 'platform', 'kind', 'frontend-framework', 'frontend-markup-language',
    'frontend-style-language', 'frontend-script-language', 'icon-set',
    'tag', 'tags', 'version', 'framework', 'scope', 'name', 'kind', 'as',
    'input', 'image',
]);

/**
 * Parse the arguments of the CLI.
 *
 * The first positional is the command, the rest are its inputs; `--name=value` and
 * `--name` are flags, `-x` is a short flag. A flag that is given twice becomes a list.
 * Everything after `--` is the rest: it goes to the command as it is.
 *
 * @param {string[]} argv
 * @returns {{ command: string|null, args: string[], flags: Record<string, string|boolean|string[]>,
 *   rest: string[] }}
 * @exports
 * @ai.hint pure
 */
export function parseArgv(argv = []) {
    const flags = {};
    const args = [];
    const rest = [];
    const list = Array.isArray(argv) ? argv : [];

    /**
     * Put a flag into the map: a flag that is given twice becomes a list.
     * @param {string} name
     * @param {string|boolean} value
     * @returns {void}
     */
    const setFlag = (name, value) => {
        if (!Object.hasOwn(flags, name)) {
            flags[name] = value;
            return;
        }
        const current = flags[name];
        if (Array.isArray(current)) current.push(value);
        else flags[name] = [current, value];
    };

    let literal = false;
    for (let index = 0; index < list.length; index += 1) {
        const item = String(list[index] ?? '');
        if (literal) {
            rest.push(item);
            continue;
        }
        if (item === '--') {
            literal = true;
            continue;
        }
        if (item.startsWith('--')) {
            const [name, value] = item.slice(2).split('=');
            if (value === undefined && VALUE_FLAGS.has(name)) {
                const next = list[index + 1];
                if (next !== undefined && !String(next).startsWith('-')) {
                    index += 1;
                    setFlag(name, String(next));
                    continue;
                }
            }
            setFlag(name, value === undefined ? true : value);
            continue;
        }
        if (item.startsWith('-') && item.length > 1) {
            setFlag(item.slice(1), true);
            continue;
        }
        args.push(item);
    }

    return { command: args.shift() ?? null, args, flags, rest };
}

/**
 * The commands of the CLI.
 * @type {Record<string, (ctx: object) => Promise<number>>}
 */
const COMMANDS = Object.freeze({
    run: runCommand,
    plan: planCommand,
    sight: sightCommand,
    stages: stagesCommand,
    install: installCommand,
    component: componentCommand,
    config: configCommand,
    jobs: jobsCommand,
    memory: memoryCommand,
    skills: skillsCommand,
});

/**
 * The entry of the CLI.
 * @param {string[]} argv
 * @param {{ renderer?: object|null, input?: object|null }} [options]
 * @returns {Promise<number>} the exit code
 * @exports
 * @ai.hint io
 */
export async function main(argv = [], options = {}) {
    // A run that dies must say so.
    //
    // A thinking model works for minutes, and the process may fall over somewhere deep inside
    // the transport. Without this the terminal stays empty and the exit code is the only
    // witness: a silent death is the hardest kind of failure to read.
    process.on('unhandledRejection', (reason) => {
        const message = reason?.message ?? String(reason ?? 'unknown');
        process.stderr.write(`ai-webdev: unhandled rejection: ${message}\n`);
        process.exitCode = EXIT.failure;
    });
    process.on('uncaughtException', (error) => {
        process.stderr.write(`ai-webdev: uncaught exception: ${error?.message ?? error}\n`);
        process.exitCode = EXIT.failure;
    });

    const { command, args, flags, rest } = parseArgv(argv);

    try {
        checkNode();
    } catch (error) {
        process.stderr.write(`ai-webdev: ${error.message}\n`);
        return EXIT.usage;
    }

    if (flags.version || flags.v) {
        process.stdout.write(`${pkg.version}\n`);
        return EXIT.ok;
    }
    if (flags.help || flags.h || command === null || command === 'help') {
        process.stdout.write(`${HELP}\n`);
        return EXIT.ok;
    }

    const mode = detectMode({
        json: Boolean(flags.json),
        quiet: Boolean(flags.quiet),
    });
    const renderer = options.renderer ?? createRenderer({
        mode,
        ascii: Boolean(flags.ascii),
        verbose: Boolean(flags.detail),
        stdin: process.stdin,
        input: options.input ?? null,
        inputEnabled: Boolean(options.input) || command === 'run' || !Object.hasOwn(COMMANDS, command),
    });

    // A command that is not known is a task: `ai-webdev "make a landing"` is a run.
    const known = Object.hasOwn(COMMANDS, command);
    const name = known ? command : 'run';
    const commandArgs = known ? args : [command, ...args];

    try {
        const config = await loadConfig({
            configPath: typeof flags.config === 'string' ? flags.config : null,
            overrides: configOverrides(flags),
            cwd: process.cwd(),
            env: process.env,
        });
        const stdinText = ['run', 'plan'].includes(name) && !process.stdin.isTTY
            ? await readPipedInput({ stdin: process.stdin, maxBytes: config?.limits?.maxStdinBytes })
            : '';
        const runner = COMMANDS[name];
        return await runner({
            config,
            cwd: process.cwd(),
            args: commandArgs,
            flags,
            rest,
            renderer,
            write: (text) => renderer.note(text),
            env: process.env,
            stdin: process.stdin,
            stdinText,
        });
    } catch (error) {
        if (error instanceof UsageError) {
            renderer.error(error.message);
            return EXIT.usage;
        }
        if (error instanceof CommandError) {
            renderer.error(error.message);
            return EXIT.failure;
        }
        renderer.error(error?.message ?? error);
        return EXIT.failure;
    }
}
