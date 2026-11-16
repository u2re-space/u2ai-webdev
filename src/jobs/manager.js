/**
 * @file src/jobs/manager.js
 * @module jobs/manager
 * @purpose The background jobs: the detached tasks that outlive the CLI.
 *
 *   A job is a command that runs apart from the CLI. The CLI may exit at once: the job
 *   keeps going, writes its output into its own log and leaves the exit code in the
 *   directory of the job. Every later call of the CLI reads those directories, so the
 *   list of the jobs, the wait for a job and the cancel of a job work from any process.
 *
 *   The jobs live in the home of the CLI (`~/.ai-webdev/jobs`), one directory per job:
 *   `job.json` is the record, `command.json` is the spec, `output.log` is the output and
 *   `exit.json` is the result.
 *
 * @depends node:path, node:fs/promises, node:child_process, node:crypto, config/paths
 * @usedBy cli
 * @exports JOB_STATUSES, createJobManager, jobId, readJob, listJobs
 * @ai.tags jobs, background, process
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: фоновые задачи живут в домашнем каталоге.
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defaultHome, homeJobsDir } from '../config/paths.js';
import { writeFileAtomic } from '../shared/house.js';

/** The states of a job. */
export const JOB_STATUSES = Object.freeze(['running', 'done', 'failed', 'cancelled']);

/** The path of the runner of the jobs. */
const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runner.js');

/**
 * The id of a new job: the time and a short random tail.
 * @param {Date} [date]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function jobId(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        '-',
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('');
    return `${stamp}-${randomBytes(3).toString('hex')}`;
}

/**
 * The directory of a job.
 * @param {string} dir the root of the jobs
 * @param {string} id
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function jobDirectory(dir, id) {
    return path.join(dir, String(id ?? ''));
}

/**
 * Read the record of a job. A missing job gives null.
 * @param {string} dir
 * @param {string} id
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readJob(dir, id) {
    const file = path.join(jobDirectory(dir, id), 'job.json');
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * The records of every job of the directory, the newest first.
 * @param {string} dir
 * @returns {Promise<object[]>}
 * @exports
 * @ai.hint io
 */
export async function listJobs(dir) {
    const entries = await readdir(dir).catch(() => []);
    const jobs = [];
    for (const entry of entries) {
        const job = await readJob(dir, entry);
        if (job) jobs.push(job);
    }
    return jobs.sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')));
}

/**
 * The manager of the background jobs.
 *
 * @param {{ dir?: string, env?: object, spawn?: Function, runner?: string }} [options]
 * @returns {object} the api of the manager
 * @exports
 * @ai.hint io
 */
export function createJobManager({
    dir = null,
    env = process.env,
    spawn: spawnFn = spawn,
    runner = RUNNER,
} = {}) {
    const root = dir ?? homeJobsDir(defaultHome(env));

    /**
     * Write a json file of a job.
     * @param {string} file
     * @param {object} data
     * @returns {Promise<void>}
     */
    const writeJson = async (file, data) => {
        // The record of the job is written whole: a crash in the middle leaves the old
        // record and not a half-written one that no one can read.
        await writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
    };

    /**
     * The state of a job, read from its files.
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    const refresh = async (id) => {
        const job = await readJob(root, id);
        if (!job) return null;
        if (job.status === 'running') {
            const exitFile = path.join(jobDirectory(root, id), 'exit.json');
            const text = await readFile(exitFile, 'utf8').catch(() => null);
            if (text !== null) {
                try {
                    const exit = JSON.parse(text);
                    job.status = exit.code === 0 ? 'done' : 'failed';
                    job.exitCode = Number(exit.code ?? 1);
                    job.finishedAt = exit.finishedAt ?? job.finishedAt;
                    await writeJson(path.join(jobDirectory(root, id), 'job.json'), job);
                } catch { /* the exit file is being written: try again later */ }
            }
        }
        return job;
    };

    /**
     * Every job of the directory, refreshed.
     * @returns {Promise<object[]>}
     */
    const listAll = async () => {
        const jobs = await listJobs(root);
        const out = [];
        for (const job of jobs) out.push(await refresh(job.id));
        return out;
    };

    /**
     * Remove a job and its files.
     * @param {string} id
     * @returns {Promise<boolean>} true when the job was there
     */
    const removeJob = async (id) => {
        const job = await readJob(root, id);
        if (!job) return false;
        await rm(jobDirectory(root, id), { recursive: true, force: true });
        return true;
    };

    return {
        /** The directory of the jobs. */
        dir: root,

        /**
         * Start a job.
         * @param {{ name?: string, command: string, args?: string[], cwd?: string,
         *   env?: object }} request
         * @returns {Promise<object>} the record of the job
         */
        async start({ name = '', command, args = [], cwd = process.cwd(), env: jobEnv = {} } = {}) {
            if (!command || typeof command !== 'string') throw new Error('Команда задачи не указана.');
            const id = jobId();
            const directory = jobDirectory(root, id);
            await mkdir(directory, { recursive: true });

            const logFile = path.join(directory, 'output.log');
            const exitFile = path.join(directory, 'exit.json');
            const specFile = path.join(directory, 'command.json');
            await writeJson(specFile, { command, args, cwd, env: jobEnv, logFile, exitFile });

            const job = {
                id,
                name: String(name ?? '').trim() || command,
                command,
                args,
                cwd,
                status: 'running',
                pid: null,
                exitCode: null,
                startedAt: new Date().toISOString(),
                finishedAt: null,
                log: logFile,
            };

            try {
                const child = spawnFn(process.execPath, [runner, specFile], {
                    cwd,
                    env: { ...env, ...jobEnv },
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true,
                });
                job.pid = child?.pid ?? null;
                child?.unref?.();
            } catch (error) {
                job.status = 'failed';
                job.exitCode = 1;
                job.finishedAt = new Date().toISOString();
                job.error = error?.message ?? String(error);
            }

            await writeJson(path.join(directory, 'job.json'), job);
            return job;
        },

        /**
         * The record of a job, refreshed from the disk.
         * @param {string} id
         * @returns {Promise<object|null>}
         */
        async get(id) {
            return await refresh(id);
        },

        /**
         * Every job of the directory.
         * @returns {Promise<object[]>}
         */
        async list() {
            return await listAll();
        },

        /**
         * Wait until a job is done.
         * @param {string} id
         * @param {{ timeoutMs?: number, pollMs?: number }} [options]
         * @returns {Promise<object|null>} the record of the job
         */
        async wait(id, { timeoutMs = 0, pollMs = 100 } = {}) {
            const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0;
            for (;;) {
                const job = await refresh(id);
                if (!job) return null;
                if (job.status !== 'running') return job;
                if (deadline && Date.now() >= deadline) {
                    return { ...job, timedOut: true };
                }
                await new Promise((resolve) => { setTimeout(resolve, pollMs); });
            }
        },

        /**
         * Cancel a job that runs.
         * @param {string} id
         * @returns {Promise<object|null>} the record of the job
         */
        async cancel(id) {
            const job = await readJob(root, id);
            if (!job) return null;
            if (job.status !== 'running') return job;
            if (job.pid) {
                try {
                    process.kill(job.pid, 'SIGTERM');
                } catch { /* the job is already gone */ }
            }
            const next = {
                ...job,
                status: 'cancelled',
                finishedAt: new Date().toISOString(),
            };
            await writeJson(path.join(jobDirectory(root, id), 'job.json'), next);
            return next;
        },

        /**
         * Remove a job and its files.
         * @param {string} id
         * @returns {Promise<boolean>} true when the job was there
         */
        async remove(id) {
            return await removeJob(id);
        },

        /**
         * Remove the jobs that are finished.
         * @returns {Promise<string[]>} the ids of the removed jobs
         */
        async prune() {
            const removed = [];
            for (const job of await listAll()) {
                if (job.status === 'running') continue;
                if (await removeJob(job.id)) removed.push(job.id);
            }
            return removed;
        },
    };
}
