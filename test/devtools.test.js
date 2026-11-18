/**
 * @file test/devtools.test.js
 * @module test/devtools
 * @purpose The tests of the Chrome DevTools MCP support: the server of the house, the marker
 *          of the roles, the tools that the house exposes and the page that the house knows.
 * @depends node:test, node:os, node:path, node:fs/promises, agent/devtools, agent/mcp,
 *          agent/tools, roles/devtools
 * @ai.tags test, devtools, mcp, browser
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';

import {
    DEVTOOLS_NAME,
    DEVTOOLS_TOOLS,
    devToolsEnabled,
    devToolsServer,
    devToolsTools,
    firstPageId,
} from '../src/agent/devtools.js';
import { mcpToolEntries, mcpAnswer, createToolset } from '../src/agent/tools.js';
import { defaults } from '../src/config.js';
import { devToolsMarker, devToolsNote } from '../src/roles/devtools.js';

test('the browser of the DevTools is off unless it is asked for', () => {
    assert.equal(devToolsEnabled({}), false);
    assert.equal(devToolsEnabled({ browser: { devtools: 'off' } }), false);
    assert.equal(devToolsEnabled({ browser: { devtools: 'auto' } }), true);
    assert.equal(devToolsEnabled({ browser: { devtools: 'always' } }), true);
});

test('the auto mode never downloads the server', async () => {
    const { connectDevTools } = await import('../src/agent/devtools.js');
    // The server is not installed for the test: the run says so and goes on.
    const connection = await connectDevTools({
        config: { browser: { devtools: 'auto' } },
        env: { PATH: '' },
        root: process.cwd(),
    });
    assert.match(connection.error ?? '', /не установлен|not installed/);
    assert.equal(connection.tools.length, 0);
});

test('the server of the house starts headless, isolated and at the size of the design', () => {
    const server = devToolsServer({
        config: { browser: { viewport: { width: 1024, height: 768 } } },
        width: 1440,
        height: 900,
        executable: 'C:/chrome/chrome.exe',
    });
    assert.equal(server.name, DEVTOOLS_NAME);
    assert.ok(server.args.includes('--headless'));
    assert.ok(server.args.includes('--isolated'));
    assert.ok(server.args.includes('--viewport=1024x768'));
    assert.ok(server.args.includes('--executablePath=C:/chrome/chrome.exe'));
    // The run says nothing to anybody.
    assert.ok(server.args.includes('--no-usage-statistics'));
    assert.ok(server.args.includes('--no-performance-crux'));
    assert.equal(server.env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS, '1');
    // Without the program that is installed, the package is fetched by npx.
    assert.equal(server.command, 'npx');
    assert.ok(server.args.includes('-y'));
});

test('the installed program of the server is used as it is', () => {
    const server = devToolsServer({
        config: { browser: {} },
        program: 'C:/npm/chrome-devtools-mcp.cmd',
    });
    assert.equal(server.command, 'C:/npm/chrome-devtools-mcp.cmd');
    assert.ok(!server.args.includes('-y'));
    assert.ok(server.args.includes('--headless'));
});

test('the list of the tools of the server is short on purpose', () => {
    // The list of the house: the tools a role of a web project really uses.
    assert.ok(DEVTOOLS_TOOLS.includes('take_snapshot'));
    assert.ok(DEVTOOLS_TOOLS.includes('click'));
    assert.ok(DEVTOOLS_TOOLS.includes('get_css_styles'));
    // The heavy and the rare ones are not in it.
    assert.ok(!DEVTOOLS_TOOLS.includes('take_heapsnapshot'));
    assert.ok(!DEVTOOLS_TOOLS.includes('install_extension'));
    assert.ok(DEVTOOLS_TOOLS.length <= 15);

    // The config may widen the list, and an empty list means the list of the house.
    assert.deepEqual(devToolsTools({ browser: { devtoolsTools: ['click'] } }), ['click']);
    assert.deepEqual(devToolsTools({ browser: { devtoolsTools: [] } }), [...DEVTOOLS_TOOLS]);
    assert.deepEqual(devToolsTools({}), [...DEVTOOLS_TOOLS]);
});

test('the marker of the server gives the role the tools of that server', () => {
    const connection = {
        name: DEVTOOLS_NAME,
        tools: [
            { name: 'take_snapshot', description: 'the tree', inputSchema: { type: 'object', properties: { pageId: { type: 'number' } }, required: ['pageId'] } },
            { name: 'click', description: 'the click', inputSchema: { type: 'object', properties: {} } },
        ],
        call: async () => ({}),
        close: async () => {},
    };
    const tools = createToolset({
        root: process.cwd(),
        config: structuredClone(defaults),
        role: 'coder',
        mcp: [connection],
    });
    const withMarker = tools.specsFor('coder', ['list_files', devToolsMarker()]).map((spec) => spec.name);
    assert.ok(withMarker.includes('mcp_chrome-devtools_take_snapshot'));
    assert.ok(withMarker.includes('mcp_chrome-devtools_click'));
    assert.ok(withMarker.includes('list_files'));

    // A role without the marker does not see the tools of the server.
    const without = tools.specsFor('coder', ['list_files']).map((spec) => spec.name);
    assert.ok(!without.some((name) => name.startsWith('mcp_')));

    // The names of the tools of the house carry the name of the server.
    const entries = mcpToolEntries([connection]);
    assert.equal(entries.length, 2);
    assert.ok(entries[0].name.startsWith('mcp_chrome-devtools'));
});

test('the page of the browser is read out of the answer of the server', async () => {
    const connection = {
        call: async (name) => {
            assert.equal(name, 'list_pages');
            return { content: [{ type: 'text', text: '## Pages\n1: about:blank [selected]\n2: other' }] };
        },
    };
    assert.equal(await firstPageId(connection), 1);

    const broken = { call: async () => { throw new Error('no'); } };
    assert.equal(await firstPageId(broken), null);
});

test('the picture of the server is written into the project and named in the answer', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-devtools-'));
    try {
        const answer = await mcpAnswer(root, { tool: 'take_screenshot' }, {
            content: [{
                type: 'image',
                mimeType: 'image/png',
                data: Buffer.from('fake-png').toString('base64'),
            }],
        });
        assert.match(answer, /\.ai\/shots\/mcp-take_screenshot-[a-z0-9]+\.png/);
        // The text of the server comes through as it is.
        const text = await mcpAnswer(root, { tool: 'take_snapshot' }, {
            content: [{ type: 'text', text: '## Latest page snapshot' }],
        });
        assert.equal(text, '## Latest page snapshot');
    } finally {
        const { rm } = await import('node:fs/promises');
        await rm(root, { recursive: true, force: true });
    }
});

test('URL navigation without a URL uses the ready project page when one is known', async () => {
    const calls = [];
    const connection = {
        name: DEVTOOLS_NAME,
        projectUrl: 'http://localhost:5173/',
        tools: [{
            name: 'navigate_page',
            description: 'navigate',
            inputSchema: { type: 'object', properties: { type: { type: 'string' }, url: { type: 'string' } } },
        }],
        call: async (name, args) => { calls.push({ name, args }); return { content: [{ type: 'text', text: 'navigated' }] }; },
        close: async () => {},
    };
    const tools = createToolset({
        root: process.cwd(),
        config: structuredClone(defaults),
        role: 'coder',
        mcp: [connection],
    });
    const [spec] = tools.specsFor('coder', [devToolsMarker()]);
    const result = await tools.execute(spec.name, { type: 'url' });
    assert.match(result, /navigated/);
    assert.equal(calls[0].name, 'navigate_page');
    assert.equal(calls[0].args.type, 'url');
    assert.equal(calls[0].args.url, 'http://localhost:5173/');
});

test('the roles know the rules of the browser that answers', () => {
    const note = devToolsNote({ url: 'http://localhost:5173/', width: 1024 });
    assert.match(note, /take the snapshot/i);
    assert.match(note, /uid/);
    assert.match(note, /working directory is the project root/);
    assert.match(note, /Do not use `git status`/);
    assert.match(note, /http:\/\/localhost:5173\//);
    assert.match(note, /type: "url"/);
    assert.match(note, /url: "http:\/\/localhost:5173\/"/);
    assert.match(note, /non-empty URL/i);
    assert.match(note, /1024/);
    assert.match(note, /get_css_styles|cascade/i);
    assert.equal(devToolsMarker(), 'mcp:chrome-devtools');
});

test('the browser rules forbid guessing a URL when no live project address exists', () => {
    const note = devToolsNote();
    assert.match(note, /No live project URL was provided/);
    assert.match(note, /Do not guess localhost/);
    assert.doesNotMatch(note, /navigate_page.*http:\/\/localhost/);
});
