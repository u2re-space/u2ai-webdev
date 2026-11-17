/**
 * @file src/agent/devtools.js
 * @module agent/devtools
 * @purpose The Chrome DevTools MCP server of the house: the browser that can be talked to.
 *
 *   The house has its own eye: it opens the page in headless Chrome, takes a picture of it
 *   and reads the console. That eye is enough to *look* at a page and not enough to *use*
 *   one: a menu that does not open, a form that does not submit, a script that throws on a
 *   click — none of it is visible in a picture.
 *
 *   The Chrome DevTools MCP server is the browser that answers: it drives the real Chrome
 *   over the DevTools protocol and gives the roles the snapshot of the page, the clicks, the
 *   keys, the scripts, the console and the requests. The house uses it as an MCP server, the
 *   same way it uses any other server of the house.
 *
 *   Two things matter for the house:
 *
 *   - the server is started **by the house** with the flags the house needs: headless, an
 *     isolated profile (the profile of the user is never touched), the viewport of the
 *     design and the Chrome the house has found;
 *   - only the tools the roles really use are exposed. The server knows sixty of them, and
 *     every tool is a schema in every request of every turn: the house keeps the list short.
 *
 * @depends node:path, agent/browser, agent/mcp, agent/programs
 * @usedBy pipeline, agent/tools, roles/index
 * @exports DEVTOOLS_NAME, DEVTOOLS_PACKAGE, DEVTOOLS_TOOLS, devToolsEnabled, devToolsTools,
 *          devToolsServer, connectDevTools, firstPageId
 * @ai.tags browser, devtools, mcp, chrome
 * @ai.hint io
 * @changed 2026-11-17 Chrome DevTools MCP: браузер, с которым можно говорить.
 */

import { findChromium } from './browser.js';
import { connectMcp } from './mcp.js';
import { findProgram } from './programs.js';

/** The name of the server of the house: the tools of it are named after it. */
export const DEVTOOLS_NAME = 'chrome-devtools';

/** The package of the server. */
export const DEVTOOLS_PACKAGE = 'chrome-devtools-mcp@1.13.0';

/**
 * The tools of the server that the house exposes to the roles.
 *
 * The list is short on purpose: every tool of the server is a schema that travels with every
 * request of every turn. These are the ones a role of a web project really uses — the
 * snapshot of the page, the interaction with it, the console, the requests, the picture and
 * the styles that won.
 * @type {string[]}
 * @exports
 */
export const DEVTOOLS_TOOLS = Object.freeze([
    'take_snapshot',
    'click',
    'fill',
    'press_key',
    'navigate_page',
    'resize_page',
    'evaluate_script',
    'list_console_messages',
    'list_network_requests',
    'take_screenshot',
    'get_css_styles',
]);

/**
 * Whether the house may talk to the browser of the DevTools.
 * @param {object} config
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function devToolsEnabled(config = {}) {
    const mode = String(config?.browser?.devtools ?? 'off');
    return mode === 'auto' || mode === 'always' || mode === 'on';
}

/**
 * The tools of the server that the roles get.
 * @param {object} config
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function devToolsTools(config = {}) {
    const wanted = config?.browser?.devtoolsTools;
    if (!Array.isArray(wanted)) return [...DEVTOOLS_TOOLS];
    const list = wanted.map((item) => String(item ?? '').trim()).filter(Boolean);
    return list.length ? list : [...DEVTOOLS_TOOLS];
}

/**
 * The server of the house: the command, the arguments and the environment.
 *
 * The flags are the ones the house needs:
 *
 * - `--headless` — the run has no window to show;
 * - `--isolated` — the profile of the user is never touched, and the profile of the run is
 *   thrown away with it;
 * - `--viewport` — the page opens at the size of the design, so the picture of the page and
 *   the picture of the reference are of the same size;
 * - `--executablePath` — the Chrome the house has found, and not the one the server guesses;
 * - `--no-usage-statistics` and `--no-performance-crux` — the run says nothing to anybody.
 *
 * The program of the server is the one that is installed (`chrome-devtools-mcp` in the
 * PATH): a program that is already there starts at once, and `npx` is the way out when
 * nothing is installed — it fetches the package and starts it.
 *
 * @param {{ config?: object, env?: object, width?: number, height?: number,
 *   executable?: string|null, program?: string|null }} request
 * @returns {{ name: string, command: string, args: string[], env: object, timeoutMs: number }}
 * @exports
 * @ai.hint pure
 */
export function devToolsServer({ config = {}, env = process.env, width = 1440, height = 900, executable = null, program = null } = {}) {
    const viewport = config?.browser?.viewport ?? {};
    const viewWidth = Number.isSafeInteger(viewport.width) ? viewport.width : width;
    const viewHeight = Number.isSafeInteger(viewport.height) ? viewport.height : height;
    const flags = [
        '--headless',
        '--isolated',
        `--viewport=${viewWidth}x${viewHeight}`,
        '--no-usage-statistics',
        '--no-performance-crux',
    ];
    if (executable) flags.push(`--executablePath=${executable}`);
    const extra = Array.isArray(config?.browser?.devtoolsArgs) ? config.browser.devtoolsArgs : [];
    for (const item of extra) flags.push(String(item));
    // The installed program comes first: it starts at once. `npx` fetches the package and
    // starts it, and that takes a minute on the first run.
    const command = program ?? String(config?.browser?.devtoolsCommand ?? 'npx');
    const args = program
        ? [...flags]
        : ['-y', String(config?.browser?.devtoolsPackage ?? DEVTOOLS_PACKAGE), ...flags];
    return {
        name: DEVTOOLS_NAME,
        command,
        args,
        env: {
            // The server must not phone home and must not look for its own updates.
            CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
            CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
        },
        timeoutMs: Number.isSafeInteger(config?.browser?.devtoolsTimeoutMs)
            ? config.browser.devtoolsTimeoutMs
            : 120_000,
    };
}

/**
 * The number of the page the server works with.
 *
 * The tools of the server of the browser name the page they work on, and a role that does
 * not know the number has to ask for the list of the pages first — an extra turn for
 * nothing. The house asks once, at the start, and puts the number into the calls.
 * @param {{ call: Function }} connection
 * @returns {Promise<number|null>}
 * @exports
 * @ai.hint io
 */
export async function firstPageId(connection) {
    try {
        const answer = await connection.call('list_pages', {});
        const text = (answer?.content ?? [])
            .map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .join('\n');
        const match = text.match(/(?:^|\n)\s*(\d+)\s*:/);
        return match ? Number(match[1]) : null;
    } catch {
        return null;
    }
}

/**
 * Connect to the browser of the DevTools.
 *
 * The server that cannot be started is not a crash: the run goes on with the eye it has —
 * a picture and a console — and says what it could not do.
 * @param {{ config?: object, env?: object, root?: string, width?: number, height?: number }} request
 * @returns {Promise<{ name: string, tools: object[], call: Function, close: Function, error?: string }|null>}
 * @exports
 * @ai.hint io
 */
export async function connectDevTools({ config = {}, env = process.env, root = process.cwd(), width = 1440, height = 900 } = {}) {
    const executable = await findChromium({ env });
    // The program of the server: the one that is installed comes first, `npx` is the way
    // out when nothing is installed.
    const installed = await findProgram('chrome-devtools-mcp', env);
    // The `auto` mode never downloads anything: the server is used when it is installed, and
    // the run says that it is not there otherwise. The `always` mode fetches it.
    const mode = String(config?.browser?.devtools ?? 'off');
    if (!installed && mode === 'auto') {
        return {
            name: DEVTOOLS_NAME,
            tools: [],
            call: async () => ({ error: 'the MCP server is not connected' }),
            close: async () => {},
            error: 'сервер не установлен: npm i chrome-devtools-mcp@latest -g',
        };
    }
    const server = devToolsServer({
        config,
        env,
        width,
        height,
        executable,
        program: installed?.file ?? null,
    });
    const connection = await connectMcp(server);
    if (connection.error) {
        connection.error = `Chrome DevTools MCP: ${connection.error}`;
        return connection;
    }
    // Only the tools the house exposes: the rest of them is a schema in every request.
    const wanted = new Set(devToolsTools(config));
    connection.tools = (connection.tools ?? []).filter((tool) => wanted.has(String(tool?.name ?? '')));
    connection.server = server;
    connection.root = root;
    // The page the tools work on: the house knows it, the roles do not have to ask.
    connection.pageId = await firstPageId(connection);
    return connection;
}
