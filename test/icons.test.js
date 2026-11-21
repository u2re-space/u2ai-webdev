/**
 * @file test/icons.test.js
 * @module test/icons
 * @purpose The tests of the icon sets: the names of the catalogue, the search and the
 *          download of the icons.
 * @depends node:test, node:os, node:path, node:fs/promises, agent/icon-sets, agent/assets
 * @ai.tags test, icons
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';

import {
    ICON_SET_NAMES, iconSetConfig, iconName, iconUrl, iconCatalogue, searchIcons, clearIconCatalogue,
} from '../src/agent/icon-sets.js';
import { downloadIcons } from '../src/agent/assets.js';
import { iconifyStage } from '../src/stages/iconify.js';

/**
 * Run a function with a fake `fetch`.
 * @param {(url: string) => Promise<{ ok: boolean, status: number, json: () => Promise<object>,
 *   text: () => Promise<string> }>} handler
 * @param {() => Promise<unknown>} body
 * @returns {Promise<unknown>}
 */
async function withFetch(handler, body) {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => handler(String(url));
    try {
        return await body();
    } finally {
        globalThis.fetch = original;
    }
}

/**
 * The answer of a request that is not JSON.
 * @param {number} status
 * @param {string} body
 * @returns {object}
 */
function textAnswer(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        body: null,
        json: async () => JSON.parse(body),
        text: async () => body,
        arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    };
}

test('the sets of the icons are known by their names', () => {
    assert.deepEqual(ICON_SET_NAMES(), ['phosphor', 'lucide']);
    assert.equal(iconSetConfig('lucide').package, 'lucide-static');
    assert.equal(iconSetConfig('font-awesome'), null);
});

test('the name of an icon is the name of the file', () => {
    assert.equal(iconName('House.svg'), 'house');
    assert.equal(iconName('  Arrow-Left-Right '), 'arrow-left-right');
    assert.equal(iconName(''), '');
});

test('the address of an icon is the address of the file of the set', () => {
    const lucide = iconSetConfig('lucide');
    const phosphor = iconSetConfig('phosphor');
    assert.match(iconUrl(lucide, 'mail'), /lucide-static.*\/icons\/mail\.svg$/);
    assert.match(iconUrl(phosphor, 'house', 'bold'), /phosphor-icons.*\/bold\/house\.svg$/);
    assert.match(iconUrl(phosphor, 'house', 'unknown'), /\/regular\/house\.svg$/);
});

test('the catalogue of a set is read from the CDN and kept', async () => {
    clearIconCatalogue();
    const calls = [];
    const files = [
        { name: '/icons/mail.svg' },
        { name: '/icons/mail-open.svg' },
        { name: '/icons/envelope.svg' },
        { name: '/dist/lucide.js' },
    ];
    const names = await withFetch(async (url) => {
        calls.push(url);
        if (url.endsWith('package.json')) return textAnswer(200, JSON.stringify({ version: '1.0.0' }));
        return textAnswer(200, JSON.stringify({ files }));
    }, async () => {
        const first = await iconCatalogue('lucide');
        const second = await iconCatalogue('lucide');
        return [first, second];
    });

    assert.deepEqual(names[0], ['envelope', 'mail', 'mail-open']);
    assert.deepEqual(names[1], names[0]);
    // The catalogue is read once: the second call is answered from the cache.
    assert.equal(calls.length, 2);
    clearIconCatalogue();
});

test('the search of the icons finds the name of the thing', async () => {
    clearIconCatalogue();
    const files = [
        { name: '/icons/mail.svg' },
        { name: '/icons/mail-open.svg' },
        { name: '/icons/envelope.svg' },
        { name: '/icons/calendar.svg' },
    ];
    const found = await withFetch(async (url) => {
        if (url.endsWith('package.json')) return textAnswer(200, JSON.stringify({ version: '1.0.0' }));
        return textAnswer(200, JSON.stringify({ files }));
    }, async () => searchIcons('lucide', 'mail'));

    assert.deepEqual(found, ['mail', 'mail-open']);
    clearIconCatalogue();
});

test('the icons are downloaded all at once, and a name the set does not have is reported', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-icons-'));
    const result = await withFetch(async (url) => {
        if (url.includes('/icons/nope.svg')) return textAnswer(404, 'not found');
        return textAnswer(200, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    }, async () => downloadIcons({
        name: 'lucide',
        icons: ['mail', 'nope', 'house'],
        output: 'assets/icons',
        cwd: root,
    }));

    assert.equal(result.count, 2);
    assert.deepEqual(result.paths, ['assets/icons/mail.svg', 'assets/icons/house.svg']);
    assert.deepEqual(result.missing, ['nope']);
    assert.deepEqual(result.failed, []);
    const svg = await readFile(path.join(root, 'assets', 'icons', 'mail.svg'), 'utf8');
    assert.match(svg, /<svg/);
});

/**
 * A client that answers the `write_ready` gate and then the step answer.
 * @param {object} answer the schema answer of the iconifier
 * @returns {object}
 */
function stepClient(answer) {
    return {
        responses: {
            async create(body) {
                if (body?.tools?.some((tool) => tool?.name === 'write_ready')) {
                    return {
                        output: [{ type: 'function_call', call_id: 'write-ready', name: 'write_ready', arguments: '{}' }],
                    };
                }
                return {
                    id: 'resp-1',
                    status: 'completed',
                    model: 'test-model',
                    output: [{
                        type: 'function_call',
                        id: 'fc-1',
                        call_id: 'c-1',
                        name: 'icon',
                        arguments: JSON.stringify(answer),
                    }],
                };
            },
        },
    };
}

test('an icon that points into a sprite is found through its fragment', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-sprite-'));
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await writeFile(path.join(root, 'assets', 'icons.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n'
        + '  <symbol id="icon-mail" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></symbol>\n'
        + '</svg>\n', 'utf8');

    const result = await iconifyStage({
        client: stepClient({
            summary: 'The icons.',
            set: 'lucide',
            icons: [
                { name: 'mail', purpose: 'The mail.', size: 20, file: 'assets/icons.svg#icon-mail' },
            ],
            files: [],
            notes: '',
        }),
        config: { output: { work: './.tmp' }, stack: { iconSet: 'lucide' } },
        root,
        task: 'Make a landing.',
        plan: { steps: [{ id: 'icon-1', title: 'The icons', role: 'iconifier', files: [], criteria: ['there'] }] },
        runId: 'run-1',
    });

    assert.equal(result.ok, true, `missing: ${JSON.stringify(result.icons.missing)}`);
    assert.deepEqual(result.icons.present, ['assets/icons.svg#icon-mail']);
    assert.deepEqual(result.icons.missing, []);

    // A fragment the sprite does not hold is still a missing icon.
    const broken = await iconifyStage({
        client: stepClient({
            summary: 'The icons.',
            set: 'lucide',
            icons: [
                { name: 'phone', purpose: 'The phone.', size: 20, file: 'assets/icons.svg#icon-phone' },
            ],
            files: [],
            notes: '',
        }),
        config: { output: { work: './.tmp' }, stack: { iconSet: 'lucide' } },
        root,
        task: 'Make a landing.',
        plan: { steps: [{ id: 'icon-1', title: 'The icons', role: 'iconifier', files: [], criteria: ['there'] }] },
        runId: 'run-2',
    });
    assert.equal(broken.ok, false);
    assert.equal(broken.icons.missing.length, 1);
    assert.match(broken.icons.missing[0].reason, /icon-phone/);
});
