/**
 * @file src/cli/jobs.js
 * @module cli/jobs
 * @purpose The command of the background jobs: `ai-webdev jobs`.
 *
 *   A job is a command that runs apart from the CLI. The jobs live in the home of the
 *   CLI, so the list of them, the wait for one and the cancel of one work from any
 *   process.
 *
 * @depends jobs/manager, config/paths, cli/errors
 * @usedBy cli
 * @exports jobsCommand
 * @ai.tags cli, jobs, background
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: фоновые задачи из домашнего каталога.
 */

import { createJobManager } from '../jobs/manager.js';
import { defaultHome, homeJobsDir } from '../config/paths.js';
import { UsageError } from './errors.js';

/**
 * One line of a job in the list.
 * @param {object} job
 * @returns {string}
 * @ai.hint pure
 */
function jobLine(job) {
    const when = String(job?.startedAt ?? '').replace('T', ' ').slice(0, 19);
    return `${job?.id ?? ''}\t${job?.status ?? ''}\t${when}\t${job?.name ?? job?.command ?? ''}`;
}

/**
 * `ai-webdev jobs [list|show|cancel|rm|prune|run]`
 *
 * @param {{ config: object, cwd: string, args?: string[], flags?: object, rest?: string[],
 *   renderer?: object, env?: object }} ctx
 * @returns {Promise<number>} the exit code
 * @exports
 * @ai.hint io
 */
export async function jobsCommand(ctx) {
    const { cwd, args = [], flags = {}, rest = [], renderer = null, env = process.env } = ctx;
    const sub = args[0] ?? 'list';
    const manager = createJobManager({ dir: homeJobsDir(defaultHome(env)) });

    if (sub === 'list') {
        const jobs = await manager.list();
        if (!jobs.length) {
            renderer?.note?.('No background jobs.');
            return 0;
        }
        for (const job of jobs) renderer?.note?.(jobLine(job));
        renderer?.note?.(`Total: ${jobs.length}`);
        return 0;
    }

    if (sub === 'show') {
        const id = String(args[1] ?? '').trim();
        if (!id) throw new UsageError('Укажите задачу: ai-webdev jobs show <id>.');
        const job = await manager.get(id);
        if (!job) {
            renderer?.error?.(`Задача не найдена: ${id}`);
            return 1;
        }
        renderer?.note?.(JSON.stringify(job, null, 2));
        return 0;
    }

    if (sub === 'cancel') {
        const id = String(args[1] ?? '').trim();
        if (!id) throw new UsageError('Укажите задачу: ai-webdev jobs cancel <id>.');
        const job = await manager.cancel(id);
        if (!job) {
            renderer?.error?.(`Задача не найдена: ${id}`);
            return 1;
        }
        renderer?.note?.(`Cancelled: ${id}`);
        return 0;
    }

    if (sub === 'rm' || sub === 'remove') {
        const id = String(args[1] ?? '').trim();
        if (!id) throw new UsageError('Укажите задачу: ai-webdev jobs rm <id>.');
        const removed = await manager.remove(id);
        if (!removed) {
            renderer?.error?.(`Задача не найдена: ${id}`);
            return 1;
        }
        renderer?.note?.(`Removed: ${id}`);
        return 0;
    }

    if (sub === 'prune') {
        const removed = await manager.prune();
        renderer?.note?.(`Removed: ${removed.length}`);
        for (const id of removed) renderer?.note?.(`  ${id}`);
        return 0;
    }

    if (sub === 'run') {
        const command = rest[0] ?? args[1];
        const commandArgs = rest.length ? rest.slice(1) : args.slice(2);
        if (!command) throw new UsageError('Укажите команду: ai-webdev jobs run -- <команда> [аргументы].');
        const job = await manager.start({
            name: String(flags.name ?? '').trim() || command,
            command,
            args: commandArgs,
            cwd,
        });
        renderer?.note?.(`Started: ${job.id}`);
        renderer?.note?.(`  log: ${job.log}`);
        return 0;
    }

    throw new UsageError('Доступно: ai-webdev jobs list | show <id> | cancel <id> | rm <id> | prune | run -- <команда>');
}
