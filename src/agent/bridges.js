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
 * The catalogue of the CLIs of the house lives in one place — `agent/cli-family` — and the
 * bridges are the three of them that the pipeline calls by itself. The free door of the
 * family (`ai_cli`) opens to all of them, the bridges included.
 *
 * @depends node:path, node:fs/promises, node:child_process, node:url, shared/child-log,
 *          agent/cli-family
 * @usedBy agent/tools, stages/collect, stages/pictures
 * @exports EXTERNAL_CLIS, externalCliCandidates, resolveExternalCli, runBridge, bridgeEnabled, bridgeKey
 * @ai.tags tools, bridges, external
 * @ai.hint io
 * @changed 2026-11-15 The log of the child comes live: the run shows the lines of the sibling
 *                       CLI while it works, and not only when it is over.
 * @changed 2026-11-16 The catalogue of the family lives in `agent/cli-family`: the bridges
 *                       and the free door of the family look the binaries the same way.
 */

import { spawn } from 'node:child_process';
import { createLineReader } from '../shared/child-log.js';
import { FAMILY_CLIS, FAMILY_ROOT, familyCandidates, resolveFamilyCli } from './cli-family.js';

/** The root of this package: the sibling packages are looked up next to it. */
const PACKAGE_ROOT = FAMILY_ROOT;

/** The external CLIs this package may call. */
export const EXTERNAL_CLIS = Object.freeze({
    'ai-decompose': FAMILY_CLIS['ai-decompose'],
    'ai-measure': FAMILY_CLIS['ai-measure'],
    'ai-image': FAMILY_CLIS['ai-image'],
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
    return familyCandidates(name, { root, env });
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
    return await resolveFamilyCli(name, { root, env });
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
