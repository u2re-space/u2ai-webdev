/**
 * @file src/stages/dev-server.js
 * @module stages/dev-server
 * @purpose The live page of the project: the dev server that shows the styles as they are.
 *
 *   The page of a project on Vite has no styles of its own: the styles live inside the
 *   script (`import './styles.scss'`), and only the bundler puts them into the page. The run
 *   has two ways to see the page:
 *
 *   - the dev server of the project (`npm run dev` → `http://localhost:5173/`): the styles
 *     there are the current ones, compiled by the bundler, so the next picture shows the fix
 *     right away;
 *   - the built page (`dist/`): what the user will get, but a rebuild is needed after every
 *     change.
 *
 *   The module finds the live server first: one that already runs is used as it is. Only when
 *   nothing answers, the run may start the server itself — and it always stops it afterwards,
 *   so a server started by mistake does not hold the machine.
 *
 * @depends node:path, node:child_process, agent/browser, agent/programs
 * @usedBy stages/vision, stages/sight
 * @exports DEFAULT_DEV_URL, devScripts, detectDevUrl, startDevServer, ensurePage
 * @ai.tags stages, dev-server, vision
 * @ai.hint io
 * @changed 2026-11-16 Живая страница: сервер проекта находит и поднимает dev-сервер.
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import { serverAnswers, waitForServer } from '../agent/browser.js';
import { findProgram, killTree } from '../agent/programs.js';

/** The address of the dev server of Vite. */
export const DEFAULT_DEV_URL = 'http://localhost:5173/';

/**
 * The scripts of the project that start a server.
 *
 * The script of the project says how the server is started: `dev`, `start`, `serve`.
 * @param {string} root
 * @returns {Promise<string[]>}
 * @exports
 * @ai.hint io
 */
export async function devScripts(root) {
    const text = await readFile(path.join(root, 'package.json'), 'utf8').catch(() => null);
    if (text === null) return [];
    try {
        const manifest = JSON.parse(text);
        const scripts = manifest?.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {};
        return Object.keys(scripts)
            .map((name) => String(name).trim())
            .filter((name) => /^(dev|start|serve)$/i.test(name));
    } catch {
        return [];
    }
}

/**
 * The scripts of the project that build it.
 * @param {string} root
 * @returns {Promise<string[]>}
 * @exports
 * @ai.hint io
 */
export async function buildScripts(root) {
    const text = await readFile(path.join(root, 'package.json'), 'utf8').catch(() => null);
    if (text === null) return [];
    try {
        const manifest = JSON.parse(text);
        const scripts = manifest?.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {};
        return Object.keys(scripts)
            .map((name) => String(name).trim())
            .filter((name) => /^build(:|$)/i.test(name));
    } catch {
        return [];
    }
}

/**
 * Build the project, so the page on the disk is the one of the current sources.
 *
 * The page of the run is the built one: the styles of a project on Vite live inside the
 * script, and only the bundler puts them into the page. Without the build the run would
 * look at a stale page and judge the wrong styles.
 * @param {{ root: string, env?: object, timeoutMs?: number }} options
 * @returns {Promise<{ ran: boolean, ok: boolean, reason: string|null, script: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function buildProject({ root, env = process.env, timeoutMs = 300_000 } = {}) {
    const scripts = await buildScripts(root);
    const script = scripts[0] ?? null;
    if (!script) {
        return { ran: false, ok: true, reason: 'у проекта нет скрипта сборки', script: null };
    }
    const manager = await findProgram('npm', env);
    if (!manager) {
        return { ran: false, ok: false, reason: 'npm не найден в PATH', script };
    }
    const child = manager.shell
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `"${manager.file}" run ${script}`], {
            cwd: root, env, shell: false, windowsHide: true, windowsVerbatimArguments: true,
        })
        : spawn(manager.file, ['run', script], { cwd: root, env, shell: false, windowsHide: true });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += String(chunk); });
    child.stderr?.on('data', (chunk) => { output += String(chunk); });
    const code = await new Promise((resolve) => {
        const timer = setTimeout(() => {
            killTree(child);
            resolve(null);
        }, timeoutMs);
        child.on('error', () => { clearTimeout(timer); resolve(1); });
        child.on('close', (exit) => { clearTimeout(timer); resolve(exit ?? 1); });
    });
    if (code === null) {
        return { ran: true, ok: false, reason: `сборка не закончилась за ${Math.round(timeoutMs / 1000)} с`, script };
    }
    if (code !== 0) {
        return { ran: true, ok: false, reason: output.trim().slice(0, 600) || `сборка вернула код ${code}`, script };
    }
    return { ran: true, ok: true, reason: null, script };
}

/**
 * The live address of the project: the configured one, or the default of Vite.
 * @param {object} config
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function detectDevUrl(config = {}) {
    const configured = String(config?.browser?.url ?? '').trim();
    return configured || DEFAULT_DEV_URL;
}

/**
 * Start the dev server of the project and wait until it answers.
 *
 * The server is a child of the run: the run stops it when it is done with it. Its output is
 * kept: the log of the bundler says what it could not resolve, and the role that fixes the
 * page needs to read it.
 * @param {{ root: string, config?: object, env?: object, url?: string|null,
 *   timeoutMs?: number }} options
 * @returns {Promise<{ url: string, started: boolean, ready: boolean, stop: Function,
 *   reason: string|null, script: string|null, log: Function }>}
 * @exports
 * @ai.hint io
 */
export async function startDevServer({
    root,
    config = {},
    env = process.env,
    url = null,
    timeoutMs = 60_000,
} = {}) {
    const address = url ?? detectDevUrl(config);
    const scripts = await devScripts(root);
    const script = scripts[0] ?? null;
    const noLog = () => '';
    if (!script) {
        return { url: address, started: false, ready: false, stop: async () => {}, reason: 'у проекта нет скрипта dev', script: null, log: noLog };
    }
    const manager = await findProgram('npm', env);
    if (!manager) {
        return { url: address, started: false, ready: false, stop: async () => {}, reason: 'npm не найден в PATH', script, log: noLog };
    }
    const child = manager.shell
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `"${manager.file}" run ${script}`], {
            cwd: root, env, shell: false, windowsHide: true, windowsVerbatimArguments: true,
        })
        : spawn(manager.file, ['run', script], { cwd: root, env, shell: false, windowsHide: true });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += String(chunk); });
    child.stderr?.on('data', (chunk) => { output += String(chunk); });
    const ready = await waitForServer(address, { timeoutMs });
    const stop = async () => {
        killTree(child);
        child.stdout?.destroy?.();
        child.stderr?.destroy?.();
    };
    return {
        url: address,
        started: true,
        ready,
        stop,
        reason: ready ? null : `сервер не ответил за ${Math.round(timeoutMs / 1000)} с: ${output.trim().slice(0, 400)}`,
        script,
        log: () => output.trim(),
    };
}

/**
 * The live page the run may shoot: the server of the project, or none.
 *
 * A server that already runs is used as it is — but only when the project has a script that
 * starts one: the address of the dev server is a guess, and a server of another project on
 * that port is not the page of this project.
 *
 * When nothing answers and the project has a dev script, the run starts the server itself
 * and stops it afterwards. The log of the server travels with the page: the bundler says
 * what it could not resolve, and the role that fixes the page needs to read it.
 * @param {{ root: string, config?: object, env?: object, timeoutMs?: number }} options
 * @returns {Promise<{ url: string|null, live: boolean, stop: Function, reason: string|null,
 *   log: Function }>}
 * @exports
 * @ai.hint io
 */
export async function ensurePage({ root, config = {}, env = process.env, timeoutMs = 60_000 } = {}) {
    const mode = config?.browser?.devServer ?? 'auto';
    const address = detectDevUrl(config);
    const noLog = () => '';
    if (mode === 'off') {
        return { url: null, live: false, stop: async () => {}, reason: 'dev-сервер выключен', log: noLog };
    }
    // The address of the dev server is a guess: only a project that starts a server may use
    // it, and only when the user named the address explicitly.
    const named = String(config?.browser?.url ?? '').trim();
    const scripts = await devScripts(root);
    if (!named && !scripts.length) {
        return { url: null, live: false, stop: async () => {}, reason: null, log: noLog };
    }
    if (await serverAnswers(address)) {
        return { url: address, live: true, stop: async () => {}, reason: null, log: noLog };
    }
    if (!scripts.length) {
        return { url: null, live: false, stop: async () => {}, reason: `по адресу ${address} никто не отвечает`, log: noLog };
    }
    const server = await startDevServer({ root, config, env, url: address, timeoutMs });
    if (!server.ready) {
        await server.stop();
        return { url: null, live: false, stop: async () => {}, reason: server.reason, log: server.log };
    }
    return { url: server.url, live: true, stop: server.stop, reason: null, log: server.log };
}
