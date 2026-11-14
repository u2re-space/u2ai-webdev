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
import { mkdtemp, readFile } from 'node:fs/promises';

import {
    ICON_SET_NAMES, iconSetConfig, iconName, iconUrl, iconCatalogue, searchIcons, clearIconCatalogue,
} from '../src/agent/icon-sets.js';
import { downloadIcons } from '../src/agent/assets.js';

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
