/**
 * @file src/agent/mcp.js
 * @module agent/mcp
 * @purpose A small MCP client: connect to a tool server over HTTP or over stdio, list its tools
 *          and call them.
 *
 *   The client speaks JSON-RPC on its own instead of pulling in an SDK. The webdev keeps its
 *   dependency list short on purpose, and the part of MCP it needs is three methods: initialize,
 *   tools/list and tools/call. A server that is not there is not an error either: the run simply
 *   has one tool less.
 *
 * @depends node:child_process
 * @usedBy agent/tools, roles/index, stages/collect
 * @exports PROTOCOL_VERSION, connectMcp, connectMcpServers, mcpToolSpecs, parseRpcBody
 * @ai.tags mcp, tools, jsonrpc
 * @ai.hint io
 */

import { spawn } from 'node:child_process';

import { findProgram, quoteWindowsArg } from './programs.js';

/** The protocol version this client speaks. */
export const PROTOCOL_VERSION = '2025-06-18';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Pull the JSON-RPC answer out of a response body.
 *
 * The answer is either plain JSON or an SSE stream, because both are legal for an HTTP MCP
 * server and the server picks.
 * @param {string} text the body of the response
 * @returns {object|null}
 * @exports
 * @ai.hint pure
 */
export function parseRpcBody(text) {
    const body = String(text ?? '').trim();
    if (!body) return null;
    if (body.startsWith('{') || body.startsWith('[')) {
        try { return JSON.parse(body); } catch { /* fall through to the SSE reading */ }
    }
    for (const line of body.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try { return JSON.parse(payload); } catch { /* keep looking */ }
    }
    return null;
}

/**
 * An MCP connection over HTTP.
 * @param {{ url: string, headers?: object, name?: string, signal?: AbortSignal }} server
 * @returns {Promise<{ name: string, tools: object[], call: Function, close: Function }>}
 * @ai.hint io
 */
async function connectHttp(server) {
    const headers = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(server.headers ?? {}),
    };
    let sessionId = null;
    let nextId = 1;

    async function rpc(method, params = null) {
        const id = nextId++;
        const body = { jsonrpc: '2.0', id, method };
        if (params) body.params = params;
        const response = await fetch(server.url, {
            method: 'POST',
            headers: sessionId ? { ...headers, 'mcp-session-id': sessionId } : headers,
            body: JSON.stringify(body),
            signal: server.signal ?? undefined,
        });
        const session = response.headers.get('mcp-session-id');
        if (session) sessionId = session;
        const text = await response.text();
        if (!response.ok) throw new Error(`MCP ${method}: HTTP ${response.status} ${text.slice(0, 200)}`);
        const parsed = parseRpcBody(text);
        if (parsed?.error) throw new Error(`MCP ${method}: ${parsed.error.message ?? JSON.stringify(parsed.error)}`);
        return parsed?.result ?? null;
    }

    async function notify(method, params = null) {
        const body = { jsonrpc: '2.0', method };
        if (params) body.params = params;
        await fetch(server.url, {
            method: 'POST',
            headers: sessionId ? { ...headers, 'mcp-session-id': sessionId } : headers,
            body: JSON.stringify(body),
            signal: server.signal ?? undefined,
        }).catch(() => null);
    }

    await rpc('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'ai-webdev', version: '0.3.0' },
    });
    await notify('notifications/initialized');

    const listed = await rpc('tools/list');
    const tools = Array.isArray(listed?.tools) ? listed.tools : [];

    return {
        name: server.name ?? server.url,
        tools,
        async call(name, args = {}) {
            return await rpc('tools/call', { name, arguments: args });
        },
        async close() { /* HTTP connections are not held open */ },
    };
}

/**
 * An MCP connection over stdio.
 * @param {{ command: string, args?: string[], env?: object, name?: string, signal?: AbortSignal }} server
 * @returns {Promise<{ name: string, tools: object[], call: Function, close: Function }>}
 * @ai.hint io
 */
async function connectStdio(server) {
    // The program of the server is looked up the way the shell looks it up: on Windows the
    // shims of npm (`npx.cmd`) are batch files, and a batch file is started through the shell
    // of the system. Without this the server of the house would never start on Windows.
    // The environment of the server is added to the environment of the machine, and not
    // instead of it: the PATH that holds the program has to be there.
    const environment = { ...process.env, ...(server.env ?? {}) };
    const found = await findProgram(server.command, environment);
    if (!found) {
        throw new Error(`программа «${server.command}» не найдена в PATH`);
    }
    const args = (server.args ?? []).map(String);
    // A shim is a batch file: the path of the program and its arguments are quoted for the
    // shell of the system.
    const line = found.shell
        ? [quoteWindowsArg(found.file), ...args.map(quoteWindowsArg)].join(' ')
        : null;
    const child = found.shell
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', line], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: environment,
            shell: false,
            windowsHide: true,
            windowsVerbatimArguments: true,
        })
        : spawn(found.file, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: environment,
            shell: false,
            windowsHide: true,
        });
    let nextId = 1;
    const pending = new Map();
    let buffer = '';
    // The log of the server: it is read, so the pipe never fills up and the server never
    // blocks on it, and the last lines of it are in the answer when the server is silent.
    let log = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let index = buffer.indexOf('\n');
        while (index >= 0) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            index = buffer.indexOf('\n');
            if (!line) continue;
            let message = null;
            try { message = JSON.parse(line); } catch { continue; }
            const waiter = pending.get(message?.id);
            if (!waiter) continue;
            pending.delete(message.id);
            if (message.error) waiter.reject(new Error(`MCP ${message.error.message ?? 'failed'}`));
            else waiter.resolve(message.result ?? null);
        }
    });
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on?.('data', (chunk) => {
        log = `${log}${chunk}`.slice(-2000);
    });

    function request(method, params = null) {
        const id = nextId++;
        const body = { jsonrpc: '2.0', id, method };
        if (params) body.params = params;
        return new Promise((resolve, reject) => {
            // A tool of a browser server takes longer than a list of the tools: a screenshot
            // and a trace are not quick.
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`MCP ${method}: the server did not answer`));
            }, Number(server.timeoutMs) > 0 ? Number(server.timeoutMs) : 60_000);
            pending.set(id, {
                resolve: (value) => { clearTimeout(timer); resolve(value); },
                reject: (error) => { clearTimeout(timer); reject(error); },
            });
            child.stdin.write(`${JSON.stringify(body)}\n`);
        });
    }

    await request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'ai-webdev', version: '0.3.0' },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

    const listed = await request('tools/list');
    const tools = Array.isArray(listed?.tools) ? listed.tools : [];

    return {
        name: server.name ?? server.command,
        tools,
        async call(name, args = {}) {
            return await request('tools/call', { name, arguments: args });
        },
        async close() {
            child.kill();
        },
    };
}

/**
 * Connect to one MCP server.
 *
 * A server that cannot be reached is not a crash: the caller gets an empty connection and the
 * reason in `error`.
 * @param {{ name?: string, url?: string, command?: string, args?: string[], headers?: object }} server
 * @returns {Promise<{ name: string, tools: object[], call: Function, close: Function, error?: string }>}
 * @exports
 * @ai.hint io
 */
export async function connectMcp(server) {
    const empty = {
        name: server?.name ?? 'mcp',
        tools: [],
        call: async () => ({ error: 'the MCP server is not connected' }),
        close: async () => {},
    };
    try {
        if (server?.url) return await connectHttp(server);
        if (server?.command) return await connectStdio(server);
        return { ...empty, error: 'the server has neither a url nor a command' };
    } catch (error) {
        return { ...empty, error: error?.message ?? String(error) };
    }
}

/**
 * Connect to every configured MCP server.
 * @param {object[]} servers the `mcp.servers` section of the config
 * @returns {Promise<Array<{ name: string, tools: object[], call: Function, close: Function, error?: string }>>}
 * @exports
 * @ai.hint io
 */
export async function connectMcpServers(servers = []) {
    const list = Array.isArray(servers) ? servers : [];
    const out = [];
    for (const server of list) out.push(await connectMcp(server));
    return out;
}

/**
 * Turn the tools of an MCP server into the tool definitions the Responses API expects.
 * @param {object[]} tools the tools of the server
 * @param {string} prefix the prefix of the tool names, so two servers cannot collide
 * @returns {object[]}
 * @exports
 * @ai.hint pure
 */
export function mcpToolSpecs(tools = [], prefix = 'mcp') {
    return (Array.isArray(tools) ? tools : [])
        .filter((tool) => isRecord(tool) && typeof tool.name === 'string')
        .map((tool) => ({
            type: 'function',
            name: `${prefix}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
            description: String(tool.description ?? ''),
            parameters: isRecord(tool.inputSchema) ? tool.inputSchema : { type: 'object', properties: {} },
        }));
}
