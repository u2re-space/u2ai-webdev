/**
 * @file src/agent/cdp.js
 * @module agent/cdp
 * @purpose The diagnostics of the page: the console, the errors and the failed requests.
 *
 *   A screenshot says how the page looks; the console says why it does not work. A model
 *   that sees both fixes the page instead of guessing: a failed request names the file that
 *   is missing, an exception names the line that broke, a warning from the bundler names the
 *   import that cannot be resolved.
 *
 *   The browser is spoken to over the Chrome DevTools Protocol: the process is started with a
 *   debugging port, the protocol answers on a WebSocket, and the events of the page come to
 *   that socket. The console, the exceptions and the failed requests are collected while the
 *   page loads.
 *
 * @depends node:path, node:os, node:child_process, node:fs/promises
 * @usedBy agent/browser
 * @exports collectPageDiagnostics, cdpScreenshot
 * @ai.tags browser, cdp, console, diagnostics
 * @ai.hint io
 * @changed 2026-11-16 Диагностика страницы: консоль, исключения и неудавшиеся запросы.
 */

import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';

/**
 * The line of the level of a console message.
 * @param {string} level
 * @returns {string}
 * @ai.hint pure
 */
function levelName(level) {
    const name = String(level ?? '').toLowerCase();
    if (name === 'error') return 'error';
    if (name === 'warning') return 'warning';
    if (name === 'info') return 'info';
    if (name === 'debug') return 'debug';
    return 'log';
}

/**
 * The text of the arguments of a console call.
 * @param {object[]} args
 * @returns {string}
 * @ai.hint pure
 */
function argumentsText(args = []) {
    return (Array.isArray(args) ? args : [])
        .map((item) => {
            if (item?.type === 'string') return item.value ?? '';
            if (item?.value !== undefined) return String(item.value);
            if (item?.description) return String(item.description);
            if (item?.type === 'object') {
                try {
                    return JSON.stringify(item.value ?? {});
                } catch {
                    return '[object]';
                }
            }
            return '';
        })
        .join(' ');
}

/**
 * The browser process with the debugging port open.
 *
 * The port is picked by the system (`--remote-debugging-port=0`), and the address of the
 * protocol comes on the stderr of the process.
 * @param {{ executable: string, width?: number, height?: number, cwd?: string, env?: object }} options
 * @returns {Promise<{ child: object, wsUrl: string, profile: string }>}
 * @ai.hint io
 */
async function startDebuggableBrowser({ executable, width = 1440, height = 900, cwd = process.cwd(), env = process.env }) {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-cdp-'));
    const child = spawn(executable, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-extensions', '--disable-sync', '--disable-component-update',
        '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
        `--window-size=${Math.round(width)},${Math.round(height)}`,
        'about:blank',
    ], { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    const wsUrl = await new Promise((resolve, reject) => {
        let buffer = '';
        const timer = setTimeout(() => reject(new Error('Браузер не открыл порт отладки.')), 20_000);
        child.stderr?.on('data', (chunk) => {
            buffer += String(chunk);
            const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
            if (!match) return;
            clearTimeout(timer);
            resolve(match[1]);
        });
        child.on('error', (error) => { clearTimeout(timer); reject(error); });
        child.on('close', () => { clearTimeout(timer); reject(new Error('Браузер закрылся, не открыв порт отладки.')); });
    });
    return { child, wsUrl, profile };
}

/**
 * Open the page and collect what it says.
 *
 * The console, the exceptions and the failed requests are collected while the page loads:
 * they are the words of the page about itself.
 * @param {{ executable: string, url: string, width?: number, height?: number, timeoutMs?: number,
 *   cwd?: string, env?: object }} options
 * @returns {Promise<{ console: object[], errors: object[], failed: object[], screenshot: string|null }>}
 * @ai.hint io
 */
export async function collectPageDiagnostics({
    executable,
    url,
    width = 1440,
    height = 900,
    timeoutMs = 30_000,
    cwd = process.cwd(),
    env = process.env,
} = {}) {
    const console_ = [];
    const errors = [];
    const failed = [];
    let browser = null;
    let socket = null;

    try {
        browser = await startDebuggableBrowser({ executable, width, height, cwd, env });
        socket = new WebSocket(browser.wsUrl);
        let nextId = 1;
        const pending = new Map();
        let sessionId = null;

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Протокол браузера не ответил.')), 15_000);
            socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
            socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Протокол браузера не открылся.')); }, { once: true });
        });

        const send = (method, params = {}, useSession = true) => new Promise((resolve, reject) => {
            const id = nextId++;
            const message = { id, method, params };
            if (useSession && sessionId) message.sessionId = sessionId;
            pending.set(id, { resolve, reject });
            socket.send(JSON.stringify(message));
        });

        socket.addEventListener('message', (event) => {
            let payload = null;
            try {
                payload = JSON.parse(String(event.data));
            } catch {
                return;
            }
            if (payload.id && pending.has(payload.id)) {
                const { resolve, reject } = pending.get(payload.id);
                pending.delete(payload.id);
                if (payload.error) reject(new Error(payload.error.message ?? 'ошибка протокола'));
                else resolve(payload.result ?? {});
                return;
            }
            const method = payload.method;
            const params = payload.params ?? {};
            if (method === 'Runtime.consoleAPICalled') {
                console_.push({
                    level: levelName(params.type),
                    text: argumentsText(params.args),
                    source: params.stackTrace?.callFrames?.[0]?.url ?? null,
                });
                return;
            }
            if (method === 'Runtime.exceptionThrown') {
                const details = params.exceptionDetails ?? {};
                errors.push({
                    text: details.exception?.description ?? details.text ?? 'неизвестная ошибка',
                    source: details.url ?? null,
                    line: details.lineNumber ?? null,
                });
                return;
            }
            if (method === 'Log.entryAdded') {
                const entry = params.entry ?? {};
                const level = levelName(entry.level);
                const text = String(entry.text ?? '');
                if (level === 'error') errors.push({ text, source: entry.url ?? null, line: entry.lineNumber ?? null });
                else console_.push({ level, text, source: entry.url ?? null });
                return;
            }
            if (method === 'Network.loadingFailed') {
                failed.push({
                    text: String(params.errorText ?? 'загрузка не удалась'),
                    url: params.type ? `(${params.type})` : null,
                });
                return;
            }
            if (method === 'Network.responseReceived') {
                const response = params.response ?? {};
                if (Number(response.status ?? 0) >= 400) {
                    failed.push({ text: `HTTP ${response.status}`, url: response.url ?? null });
                }
            }
        });

        const target = await send('Target.createTarget', { url: 'about:blank' }, false);
        const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, false);
        sessionId = attached.sessionId ?? null;

        await send('Runtime.enable');
        await send('Log.enable');
        await send('Network.enable');
        await send('Page.enable');
        await send('Emulation.setDeviceMetricsOverride', {
            width: Math.round(width),
            height: Math.round(height),
            deviceScaleFactor: 1,
            mobile: false,
        });

        await send('Page.navigate', { url });

        // The page is given its time to load and to say what it wants to say.
        await new Promise((resolve) => setTimeout(resolve, Math.max(1200, Math.min(timeoutMs, 8000))));

        let screenshot = null;
        try {
            const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            screenshot = shot.data ?? null;
        } catch {
            screenshot = null;
        }
        return { console: console_, errors, failed, screenshot };
    } finally {
        try {
            socket?.close();
        } catch { /* the socket is already gone */ }
        try {
            browser?.child?.kill();
        } catch { /* the browser is already gone */ }
        if (browser?.profile) {
            await rm(browser.profile, { recursive: true, force: true }).catch(() => {});
        }
    }
}

/**
 * The text of the diagnostics of the page: what the console said and what failed.
 * @param {{ console?: object[], errors?: object[], failed?: object[] }} diagnostics
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function diagnosticsText(diagnostics = {}) {
    const lines = [];
    const errors = Array.isArray(diagnostics.errors) ? diagnostics.errors : [];
    const failed = Array.isArray(diagnostics.failed) ? diagnostics.failed : [];
    const messages = Array.isArray(diagnostics.console) ? diagnostics.console : [];
    if (errors.length) {
        lines.push('Errors of the page:');
        for (const item of errors) {
            const where = item.source ? ` (${item.source}${item.line != null ? `:${item.line + 1}` : ''})` : '';
            lines.push(`- ${item.text}${where}`);
        }
    }
    if (failed.length) {
        lines.push('Failed requests:');
        for (const item of failed) {
            lines.push(`- ${item.text}${item.url ? ` — ${item.url}` : ''}`);
        }
    }
    if (messages.length) {
        lines.push('The console of the page:');
        for (const item of messages) {
            lines.push(`- [${item.level}] ${item.text}`);
        }
    }
    return lines.join('\n');
}
