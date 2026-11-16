/**
 * @file src/jobs/runner.js
 * @module jobs/runner
 * @purpose The child of a background job: it runs the command and writes the exit code.
 *
 *   The CLI may exit long before the job is done, so the child itself has to tell the
 *   result. The child reads the spec of the job, runs the command with its output in the
 *   log of the job and writes `exit.json` when the command ends.
 *
 * @depends node:child_process, node:fs/promises, node:path
 * @usedBy jobs/manager
 * @exports main
 * @ai.tags jobs, runner
 * @ai.hint io
 * @changed 2026-11-13 The runner of a background job: the exit code survives the CLI.
 */

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileAtomic } from '../shared/house.js';

/**
 * Run the job of a spec file.
 * @param {string[]} argv the arguments: the path of the spec file
 * @returns {Promise<number>} the exit code of the job
 * @exports
 * @ai.hint io
 */
export async function main(argv = []) {
    const specFile = argv[0];
    if (!specFile) return 1;

    let spec;
    try {
        spec = JSON.parse(await readFile(specFile, 'utf8'));
    } catch {
        return 1;
    }

    const exitFile = spec.exitFile ?? path.join(path.dirname(specFile), 'exit.json');
    const code = await new Promise((resolve) => {
        let child;
        try {
            child = spawn(spec.command, spec.args ?? [], {
                cwd: spec.cwd ?? process.cwd(),
                env: { ...process.env, ...(spec.env ?? {}) },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch {
            resolve(1);
            return;
        }

        const log = spec.logFile ? createWriteStream(spec.logFile, { flags: 'a' }) : null;
        child.stdout?.on('data', (chunk) => log?.write(chunk));
        child.stderr?.on('data', (chunk) => log?.write(chunk));

        child.on('error', () => {
            log?.end();
            resolve(1);
        });
        child.on('close', (status, signal) => {
            log?.end();
            resolve(signal ? 1 : (status ?? 1));
        });
    });

    await writeFileAtomic(exitFile, `${JSON.stringify({
        code,
        finishedAt: new Date().toISOString(),
    }, null, 2)}\n`).catch(() => {});
    return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await main(process.argv.slice(2));
}
