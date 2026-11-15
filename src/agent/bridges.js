/**
 * @file src/agent/bridges.js
 * @module agent/bridges
 * @purpose The bridges to the sibling CLIs: `ai-decompose`, `ai-measure` and `ai-image` run as
 *          subprocesses, each of them may be switched off, and a bridge that fails never breaks
 *          the run — it only empties its part of the context.
 *
 * The binary is looked up in this order: the environment variable of the bridge, the checkout of
 * the sibling package, the installed `node_modules`, and the `PATH`.
 *
 * @depends node:path, node:fs/promises, node:child_process, node:url, shared/child-log
 * @usedBy agent/tools, stages/collect, stages/pictures
 * @exports EXTERNAL_CLIS, externalCliCandidates, resolveExternalCli, runBridge, bridgeEnabled, bridgeKey
 * @ai.tags tools, bridges, external
 * @ai.hint io
 * @changed 2026-11-15 The log of the child comes live: the run shows the lines of the sibling
 *                       CLI while it works, and not only when it is over.
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLineReader } from '../shared/child-log.js';

/** The root of this package: the sibling packages are looked up next to it. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The external CLIs this package may call. */
export const EXTERNAL_CLIS = Object.freeze({
    'ai-decompose': {
        command: 'ai-decompose',
        env: 'AI_DECOMPOSE_BIN',
        package: '@u2ai/decomposer',
        checkout: 'u2ai-decomposer',
        script: path.join('bin', 'ai-decompose.js'),
    },
    'ai-measure': {
        command: 'ai-measure',
        env: 'AI_MEASURE_BIN',
        package: '@u2ai/measurer',
        checkout: 'u2ai-measurer',
        script: path.join('bin', 'ai-measure.js'),
    },
    'ai-image': {
        command: 'ai-image',
        env: 'AI_IMAGE_BIN',
        package: '@u2ai/images',
        checkout: 'u2ai-images',
        script: path.join('bin', 'ai-image.js'),
    },
});

/**
 * The files that may hold an external CLI, in the order they are tried.
 * @param {string} name
 * @param {{ root?: string, env?: object }} [options]
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function externalCliCandidates(name, { root = PACKAGE_ROOT, env = process.env } = {}) {
    const spec = EXTERNAL_CLIS[name];
    if (!spec) return [];
    const candidates = [];
    if (env[spec.env]) candidates.push(path.resolve(env[spec.env]));
    // The checkout of the sibling package, next to this one or inside it.
    candidates.push(path.join(root, spec.checkout, spec.script));
    candidates.push(path.join(root, '..', spec.checkout, spec.script));
    candidates.push(path.join(root, 'submodules', spec.checkout, spec.script));
    // The installed package.
    candidates.push(path.join(root, 'node_modules', ...spec.package.split('/'), spec.script));
    return candidates;
}

/**
 * The executable of an external CLI in PATH.
 * @param {string} name
 * @param {object} env
 * @returns {Promise<{ command: string, args: string[], shell?: boolean }|null>}
 * @ai.hint io
 */
async function findOnPath(name, env) {
    const spec = EXTERNAL_CLIS[name];
    if (!spec) return null;
    const names = process.platform === 'win32'
        ? [`${spec.command}.cmd`, `${spec.command}.exe`, spec.command]
        : [spec.command];
    for (const dir of String(env.PATH ?? '').split(path.delimiter)) {
        if (!dir) continue;
        for (const candidate of names) {
            const full = path.join(dir, candidate);
            if (!await stat(full).then(() => true).catch(() => false)) continue;
            if (process.platform === 'win32' && candidate.endsWith('.cmd')) {
                return { command: full, args: [], shell: true };
            }
            return { command: full, args: [] };
        }
    }
    return null;
}

/**
 * Find the external CLI to delegate to.
 *
 * A `.js` entry is run with the same Node that runs this CLI; anything else is an executable.
 * @param {string} name
 * @param {{ root?: string, env?: object }} [options]
 * @returns {Promise<{ command: string, args: string[], shell?: boolean }|null>} null when it is not installed
 * @exports
 * @ai.hint io
 */
export async function resolveExternalCli(name, { root = PACKAGE_ROOT, env = process.env } = {}) {
    for (const candidate of externalCliCandidates(name, { root, env })) {
        if (!await stat(candidate).then(() => true).catch(() => false)) continue;
        if (candidate.endsWith('.js')) return { command: process.execPath, args: [candidate] };
        if (candidate.endsWith('.cmd')) return { command: candidate, args: [], shell: true };
        return { command: candidate, args: [] };
    }
    return await findOnPath(name, env);
}

/**
 * The config key of a bridge: the CLI `ai-measure` lives under `bridges.measure`.
 * @param {string} name
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function bridgeKey(name) {
    return String(name ?? '').replace(/^ai-/, '');
}

/**
 * Whether a bridge is switched on in the config.
 * @param {object} config
 * @param {string} name the name of the CLI or of the config key
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function bridgeEnabled(config, name) {
    const bridges = config?.bridges ?? {};
    const bridge = bridges[name] ?? bridges[bridgeKey(name)];
    if (!bridge) return false;
    return bridge.enabled !== false;
}

/**
 * Run one external CLI and collect its answer.
 *
 * The bridge never throws: a missing binary, a non-zero exit code and a timeout all come back as
 * a result the caller may put into a report.
 *
 * The log of the child comes live: `onLine` is called with every line of the child as it is
 * written, so the run shows what the sibling CLI does instead of waiting in silence. The whole
 * output is still collected in the answer of the bridge.
 * @param {{ name: string, args?: string[], config?: object, cwd?: string, env?: object,
 *   root?: string, signal?: AbortSignal|null, onLine?: ((event: { stream: string, line: string }) => void)|null }} request
 * @returns {Promise<{ ok: boolean, skipped: boolean, code: number|null, stdout: string, stderr: string, reason: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function runBridge({ name, args = [], config = {}, cwd = process.cwd(), env = process.env, root = PACKAGE_ROOT, signal = null, onLine = null }) {
    const key = bridgeKey(name);
    const bridge = config?.bridges?.[key] ?? config?.bridges?.[name] ?? null;
    if (!bridge || bridge.enabled === false) {
        return { ok: false, skipped: true, code: null, stdout: '', stderr: '', reason: `the bridge "${name}" is off` };
    }
    const command = String(bridge.command ?? EXTERNAL_CLIS[name]?.command ?? name);
    const found = await resolveExternalCli(name, { root, env });
    if (!found) {
        return {
            ok: false, skipped: false, code: null, stdout: '', stderr: '',
            reason: `the CLI "${command}" is not installed: set ${EXTERNAL_CLIS[name]?.env ?? 'the path'} or install ${EXTERNAL_CLIS[name]?.package ?? 'the package'}`,
        };
    }
    const timeoutMs = Number.isSafeInteger(bridge.timeoutMs) ? bridge.timeoutMs : 600_000;
    // The log of the child is live unless the bridge is told to keep quiet.
    const live = typeof onLine === 'function' && bridge.log !== false;
    const readers = {
        stdout: live ? createLineReader((line) => onLine({ stream: 'stdout', line })) : null,
        stderr: live ? createLineReader((line) => onLine({ stream: 'stderr', line })) : null,
    };
    return await new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const child = spawn(found.command, [...found.args, ...args.map((item) => String(item))], {
            cwd,
            env,
            shell: found.shell ?? false,
            windowsHide: true,
        });
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
        const onAbort = () => child.kill();
        signal?.addEventListener('abort', onAbort, { once: true });
        child.stdout?.on('data', (chunk) => {
            stdout += String(chunk);
            readers.stdout?.push(chunk);
        });
        child.stderr?.on('data', (chunk) => {
            stderr += String(chunk);
            readers.stderr?.push(chunk);
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            readers.stdout?.flush();
            readers.stderr?.flush();
            resolve({ ok: false, skipped: false, code: null, stdout, stderr: `${stderr}${error.message}`, reason: error.message });
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            // The last line of the child may have no line break at the end.
            readers.stdout?.flush();
            readers.stderr?.flush();
            const reason = timedOut ? `the bridge "${name}" timed out after ${timeoutMs} ms`
                : code === 0 ? null : `the bridge "${name}" exited with code ${code}`;
            resolve({ ok: code === 0 && !timedOut, skipped: false, code: code ?? null, stdout, stderr, reason });
        });
    });
}
