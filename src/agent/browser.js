/**
 * @file src/agent/browser.js
 * @module agent/browser
 * @purpose The eyes of the run: a screenshot of the page the roles build.
 *
 *   The styles of a page cannot be judged by the code that writes them: a rule that compiles
 *   may still break the layout. The run needs to see the result — a picture of the page in a
 *   real browser — and to compare it with the reference of the design.
 *
 *   Two engines are supported:
 *
 *   - headless Chromium (Chrome or Edge), always available on a desktop: a read-only engine
 *     that opens a page, takes a screenshot and reads the rendered text. It is the engine of
 *     the snapshot.
 *   - Ego Lite (`ego`), the browser of the house, with the window and the interaction. It is
 *     used when it is asked for explicitly: the ego lite hands the page to the session that is
 *     already open and gives nothing back to a caller that waits for a snapshot.
 *
 *   The page of the project is served by a local server of the package: a `file://` URL breaks
 *   the modules and the fetch of a modern project, so the run serves the root over HTTP and
 *   points the browser at it.
 *
 * @depends node:path, node:fs/promises, node:os, node:http, node:url, agent/programs, agent/paths
 * @usedBy agent/tools, stages/preview
 * @exports BROWSER_ACTIONS, chromiumCandidates, egoCandidates, findEgo, findChromium,
 *          resolveEngine, chromeArgs, startStaticServer, screenshotPage, pageText
 * @ai.tags browser, screenshot, vision
 * @ai.hint io
 * @changed 2026-11-16 Зрение прогона: снимок страницы и текст страницы через браузер.
 */

import path from 'node:path';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import { runProgram } from './programs.js';
import { resolveInside } from './paths.js';
import { collectPageDiagnostics, diagnosticsText } from './cdp.js';

/** What the browser tool can do. */
export const BROWSER_ACTIONS = Object.freeze(['status', 'screenshot', 'text']);

/** The Chromium builds of the desktop: Chrome and Edge, in the usual places. */
const CHROME_WIN = [
    'Google/Chrome/Application/chrome.exe',
    'Microsoft/Edge/Application/msedge.exe',
];
const CHROME_MAC = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const CHROME_LINUX = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
    .map((name) => `/usr/bin/${name}`);

const EGO_NOT_FOUND = 'ego не найден в PATH. Установите Ego Lite (https://lite.ego.app/) или укажите browser.executable.';

/**
 * Whether stat reports an existing file. A missing path returns false.
 * @param {string} filePath
 * @returns {Promise<boolean>}
 * @ai.hint io
 */
async function isFile(filePath) {
    try {
        return (await stat(filePath)).isFile();
    } catch {
        return false;
    }
}

/**
 * The places the `ego` command may live: the PATH, then the folders of the install.
 *
 * The command of the ego lite is `ego` — the application of Citro Labs, not `ego-browser`.
 * @param {string|null} configured the executable of the configuration
 * @param {object} env
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function egoCandidates(configured = null, env = process.env) {
    const names = configured
        ? [path.basename(configured)]
        : ['ego', 'ego.exe', 'ego.cmd', 'ego.bat'];
    const result = configured ? [configured] : [];
    const push = (dir) => {
        for (const name of names) {
            const candidate = path.join(dir, name);
            if (!result.includes(candidate)) result.push(candidate);
        }
    };
    for (const dir of String(env.PATH || env.Path || '').split(path.delimiter)) {
        if (dir.trim()) push(dir.trim());
    }
    const home = env.HOME || env.USERPROFILE || os.homedir();
    if (home) {
        push(path.join(home, '.local', 'bin'));
        push(path.join(home, '.local', 'share', 'ego'));
        push(path.join(home, 'Applications', 'ego lite.app', 'Contents', 'MacOS'));
    }
    // The install of the ego lite on Windows: «Citro Labs\ego lite\Application\ego.exe».
    if (process.platform === 'win32') {
        const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean);
        for (const root of roots) push(path.join(root, 'Citro Labs', 'ego lite', 'Application'));
    }
    return result;
}

/**
 * The places a Chromium browser may live: the configured one first, then the usual installs.
 * @param {string|null} configured
 * @param {object} env
 * @param {string} platform
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function chromiumCandidates(configured = null, env = process.env, platform = process.platform) {
    const candidates = configured ? [configured] : [];
    if (platform === 'win32') {
        const roots = [env?.ProgramFiles, env?.['ProgramFiles(x86)'], env?.LOCALAPPDATA].filter(Boolean);
        for (const suffix of CHROME_WIN) {
            for (const root of roots) candidates.push(path.join(root, suffix));
        }
    } else if (platform === 'darwin') {
        candidates.push(...CHROME_MAC);
    } else {
        candidates.push(...CHROME_LINUX);
    }
    return [...new Set(candidates)];
}

/**
 * Find the `ego` command of the house.
 * @param {{ executable?: string|null, env?: object, exists?: Function }} [options]
 * @returns {Promise<string|null>}
 * @exports
 * @ai.hint io
 */
export async function findEgo({ executable = null, env = process.env, exists = isFile } = {}) {
    for (const candidate of egoCandidates(executable, env)) {
        if (await exists(candidate)) return candidate;
    }
    return null;
}

/**
 * Find a Chromium browser of the desktop.
 * @param {{ executable?: string|null, env?: object, exists?: Function, platform?: string }} [options]
 * @returns {Promise<string|null>}
 * @exports
 * @ai.hint io
 */
export async function findChromium({ executable = null, env = process.env, exists = isFile, platform = process.platform } = {}) {
    for (const candidate of chromiumCandidates(executable, env, platform)) {
        if (await exists(candidate)) return candidate;
    }
    return null;
}

/**
 * The engine of the run: headless Chromium, or Ego Lite when the user asks for it.
 *
 * The `auto` mode takes the Chromium: the snapshot of the page is taken headless, and the ego
 * lite is a windowed application — it hands the page to the session that is already open and
 * gives nothing back to the caller. The ego lite is named `ego` (`ego nodejs -e …`), not
 * `ego-browser`.
 * @param {object} config
 * @param {{ findEgo?: Function, findChromium?: Function }} [options]
 * @returns {Promise<{ engine: 'ego'|'chrome', executable: string, interactions: boolean, ego: string|null, chrome: string|null }|null>}
 * @exports
 * @ai.hint io
 */
export async function resolveEngine(config = {}, { findEgo: findEgoFn = findEgo, findChromium: findChromiumFn = findChromium } = {}) {
    const browser = config?.browser ?? {};
    const preference = browser.engine ?? 'auto';
    const executable = typeof browser.executable === 'string' && browser.executable.trim() ? browser.executable.trim() : null;
    const selected = preference === 'auto' && executable
        ? (/^ego(?:\.exe|\.cmd|\.bat)?$/i.test(path.basename(executable)) ? 'ego' : 'chrome')
        : preference;
    const ego = selected === 'chrome' ? null : await findEgoFn({ executable: selected === 'ego' ? executable : null, env: process.env });
    const chrome = selected === 'ego' ? null : await findChromiumFn({ executable: selected === 'chrome' ? executable : null, env: process.env });
    if (selected === 'auto') {
        // The headless engine takes the snapshot; the ego lite is only a name in the report.
        if (chrome) return { engine: 'chrome', executable: chrome, interactions: false, ego, chrome };
        if (ego) return { engine: 'ego', executable: ego, interactions: true, ego, chrome };
        throw new Error(`Браузер не найден. Установите Chrome/Edge или укажите browser.executable (${CHROME_WIN.join(' | ')}).`);
    }
    if (ego) return { engine: 'ego', executable: ego, interactions: true, ego, chrome };
    if (chrome) return { engine: 'chrome', executable: chrome, interactions: false, ego, chrome };
    if (selected === 'chrome') throw new Error(`Chromium-браузер не найден. Укажите browser.executable (${CHROME_WIN.join(' | ')}).`);
    throw new Error(EGO_NOT_FOUND);
}

/**
 * The arguments of one headless Chromium call.
 * @param {{ mode: 'screenshot'|'dump-dom', url: string, output?: string|null, width?: number, height?: number, budgetMs?: number, userDataDir: string }} options
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function chromeArgs({ mode, url, output = null, width = 1440, height = 900, budgetMs = 8000, userDataDir }) {
    const args = [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-extensions', '--disable-sync', '--disable-component-update',
        // The scrollbars stay on the picture: a second scrollbar of the page is a defect the
        // role has to see, and a hidden scrollbar cannot be seen.
        `--user-data-dir=${userDataDir}`,
        `--virtual-time-budget=${Math.max(100, Math.min(60000, Math.round(budgetMs)))}`,
    ];
    if (mode === 'screenshot') {
        args.push(`--window-size=${Math.round(width)},${Math.round(height)}`);
        args.push(`--screenshot=${output}`);
    } else {
        args.push('--dump-dom');
    }
    args.push(url);
    return args;
}

/**
 * The MIME types of the files the local server serves.
 * @type {Readonly<Record<string, string>>}
 */
const MIME = Object.freeze({
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.webmanifest': 'application/manifest+json',
});

/**
 * Serve a directory over HTTP on a free port of the loopback.
 *
 * A `file://` URL breaks the modules and the fetch of a modern project, so the run serves the
 * root of the project and points the browser at it. The server answers only what is inside the
 * directory: a path that climbs out of it gets nothing.
 * @param {string} root
 * @param {{ port?: number, host?: string }} [options]
 * @returns {Promise<{ url: string, port: number, close: Function }>}
 * @exports
 * @ai.hint io
 */
export async function startStaticServer(root, { port = 0, host = '127.0.0.1' } = {}) {
    const base = path.resolve(String(root ?? process.cwd()));
    const server = createServer(async (req, res) => {
        try {
            const request = new URL(req.url || '/', `http://${host}`);
            let rel = decodeURIComponent(request.pathname);
            if (rel.endsWith('/')) rel += 'index.html';
            const target = path.resolve(base, `.${rel}`);
            // The server answers only what is inside the root: a path that climbs out gets nothing.
            const inside = target === base || target.startsWith(base + path.sep);
            if (!inside) {
                res.writeHead(403).end('Forbidden');
                return;
            }
            const info = await stat(target).catch(() => null);
            if (!info?.isFile()) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
                return;
            }
            const body = await readFile(target);
            const type = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length }).end(body);
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
                .end(String(error?.message ?? error));
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
    });
    const address = server.address();
    const actual = typeof address === 'object' && address ? address.port : port;
    return {
        url: `http://${host}:${actual}`,
        port: actual,
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}

/**
 * Drop the scripts, the styles and the tags, so the HTML becomes readable text.
 * @param {string} html
 * @returns {string}
 * @ai.hint pure
 */
function htmlToText(html) {
    return String(html ?? '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<\/(p|div|br|li|h[1-6]|tr|section|article|pre|blockquote)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

/**
 * One headless Chromium call.
 * @param {{ executable: string, args: string[], timeoutMs: number, cwd?: string, env?: object }} options
 * @returns {Promise<object>}
 * @ai.hint io
 */
async function runChromium({ executable, args, timeoutMs, cwd, env }) {
    return runProgram({ command: executable, args, cwd, env, timeoutMs });
}

/**
 * The screenshot of a page, with what the page says about itself.
 *
 * The page is opened in a headless Chromium, the picture is written to the disk and the path of
 * the file comes back. The engine of the house (Ego Lite) is used when it is installed.
 *
 * The URL may be any address: the page of the project that the run serves itself, or the
 * live dev server of the project (`npm run dev` → `http://localhost:5173/`), where the
 * styles are already compiled and the next screenshot shows the fix.
 *
 * The console, the exceptions and the failed requests come along with the picture: they are
 * the words of the page about itself, and the role that fixes the page needs them.
 * @param {{ url: string, output: string, width?: number, height?: number, timeoutMs?: number,
 *   engine?: object|null, env?: object, cwd?: string, run?: Function, diagnostics?: boolean }} options
 * @returns {Promise<{ ok: boolean, path: string, bytes: number, engine: string, reason: string|null,
 *   console: object[], errors: object[], failed: object[], log: string }>}
 * @exports
 * @ai.hint io
 */
export async function screenshotPage({
    url,
    output,
    width = 1440,
    height = 900,
    timeoutMs = 45_000,
    engine = null,
    env = process.env,
    cwd = process.cwd(),
    run = null,
    diagnostics = true,
} = {}) {
    const chosen = engine ?? await resolveEngine({});
    if (!chosen) throw new Error(EGO_NOT_FOUND);
    if (chosen.engine !== 'chrome') {
        // Ego Lite speaks its own protocol; the run falls back to the headless engine for the
        // picture, and the answer says which engine took it.
        if (!chosen.chrome) {
            throw new Error(`Движок ${chosen.engine} не умеет снимать страницу без Chromium. Установите Chrome/Edge или укажите browser.executable.`);
        }
    }
    const executable = chosen.engine === 'chrome' ? chosen.executable : chosen.chrome;

    // The protocol gives the picture and the words of the page in one pass.
    if (diagnostics) {
        try {
            const collected = await collectPageDiagnostics({ executable, url, width, height, timeoutMs, cwd, env });
            if (collected.screenshot) {
                const bytes = Buffer.from(collected.screenshot, 'base64');
                await writeFile(output, bytes);
                return {
                    ok: true,
                    path: output,
                    bytes: bytes.length,
                    engine: chosen.engine === 'chrome' ? 'chrome' : 'ego+chrome',
                    reason: null,
                    console: collected.console,
                    errors: collected.errors,
                    failed: collected.failed,
                    log: diagnosticsText(collected),
                };
            }
        } catch {
            // The protocol is not always there: the run falls back to the plain screenshot.
        }
    }

    const profile = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-chrome-'));
    try {
        const budget = Math.max(1000, Math.min(timeoutMs - 3000, 20_000));
        const args = chromeArgs({ mode: 'screenshot', url, output, width, height, budgetMs: budget, userDataDir: profile });
        const runner = run ?? ((options) => runChromium(options));
        const result = await runner({ executable, args, timeoutMs, cwd, env });
        if (result?.timedOut) throw new Error(`Chromium не завершился за ${Math.round(timeoutMs / 1000)} с.`);
        if (result?.error) throw new Error(`Запуск Chromium не удался: ${result.error}`);
        const bytes = (await stat(output).catch(() => null))?.size ?? 0;
        if (result?.code !== 0 || bytes === 0) {
            const detail = [result?.stdout, result?.stderr].filter(Boolean).join(' ').trim().slice(0, 600);
            throw new Error(`Chromium не сохранил снимок (exit ${result?.code ?? '?'}, байт ${bytes}). ${detail}`);
        }
        return {
            ok: true,
            path: output,
            bytes,
            engine: chosen.engine === 'chrome' ? 'chrome' : 'ego+chrome',
            reason: null,
            console: [],
            errors: [],
            failed: [],
            log: '',
        };
    } finally {
        await rm(profile, { recursive: true, force: true }).catch(() => {});
    }
}

/**
 * Whether a server already answers on the address.
 *
 * The dev server of the project may already be running: the run then shoots that page
 * instead of serving the project itself.
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<boolean>}
 * @exports
 * @ai.hint io
 */
export async function serverAnswers(url, { timeoutMs = 1500 } = {}) {
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(timeoutMs),
            method: 'GET',
            redirect: 'follow',
        });
        return response.status >= 200 && response.status < 400;
    } catch {
        return false;
    }
}

/**
 * Wait until a server answers on the address.
 *
 * The dev server needs a moment to start: the run waits for it instead of shooting an empty
 * page.
 * @param {string} url
 * @param {{ timeoutMs?: number, intervalMs?: number }} [options]
 * @returns {Promise<boolean>}
 * @exports
 * @ai.hint io
 */
export async function waitForServer(url, { timeoutMs = 30_000, intervalMs = 400 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await serverAnswers(url)) return true;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
}

/**
 * The rendered text of a page.
 * @param {{ url: string, timeoutMs?: number, engine?: object|null, env?: object, cwd?: string, run?: Function }} options
 * @returns {Promise<{ ok: boolean, text: string, engine: string }>}
 * @exports
 * @ai.hint io
 */
export async function pageText({ url, timeoutMs = 45_000, engine = null, env = process.env, cwd = process.cwd(), run = null } = {}) {
    const chosen = engine ?? await resolveEngine({});
    if (!chosen) throw new Error(EGO_NOT_FOUND);
    if (!chosen.chrome) {
        throw new Error(`Движок ${chosen.engine} не умеет читать страницу без Chromium. Установите Chrome/Edge.`);
    }
    const profile = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-chrome-'));
    try {
        const budget = Math.max(1000, Math.min(timeoutMs - 3000, 20_000));
        const args = chromeArgs({ mode: 'dump-dom', url, budgetMs: budget, userDataDir: profile });
        const runner = run ?? ((options) => runChromium(options));
        const result = await runner({ executable: chosen.chrome, args, timeoutMs, cwd, env });
        if (result?.timedOut) throw new Error(`Chromium не завершился за ${Math.round(timeoutMs / 1000)} с.`);
        if (result?.error) throw new Error(`Запуск Chromium не удался: ${result.error}`);
        return { ok: true, text: htmlToText(result?.stdout ?? ''), engine: chosen.engine };
    } finally {
        await rm(profile, { recursive: true, force: true }).catch(() => {});
    }
}

/**
 * The URL of a page of the project: a path inside the root becomes a `file://` URL.
 * @param {string} root
 * @param {string} relative
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function pageUrl(root, relative = 'index.html') {
    const { abs } = await resolveInside(root, String(relative ?? 'index.html'), { allowRoot: false });
    return pathToFileURL(abs).href;
}
