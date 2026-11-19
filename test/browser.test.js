/**
 * @file test/browser.test.js
 * @module test/browser
 * @purpose The tests of the browser of the run: the engines, the local server and the
 *          screenshot of the page.
 * @depends node:test, node:fs/promises, agent/browser, stages/vision
 * @ai.tags test, browser, screenshot
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';

import {
    BROWSER_ACTIONS,
    chromeArgs,
    chromiumCandidates,
    egoCandidates,
    findChromium,
    findEgo,
    resolveEngine,
    startStaticServer,
} from '../src/agent/browser.js';
import { entryPage, shootPage, visionEnabled, visionPrompt } from '../src/stages/vision.js';
import { stylesOnly } from '../src/stages/sight.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

/**
 * A fresh directory with one page for one test.
 * @returns {Promise<{ root: string, cleanup: () => Promise<void> }>}
 */
async function project() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-browser-'));
    await writeFile(path.join(root, 'index.html'), '<!doctype html><html><body><h1>Page</h1></body></html>', 'utf8');
    return { root, cleanup: async () => { await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true })); } };
}

test('the actions of the browser are known', () => {
    assert.deepEqual([...BROWSER_ACTIONS], ['status', 'screenshot', 'text']);
});

test('the places of the engines are known', () => {
    // The command of the ego lite is `ego`, not `ego-browser`.
    const ego = egoCandidates(null, { PATH: '/usr/bin' });
    assert.ok(ego.some((item) => path.basename(item) === 'ego'));
    assert.ok(!ego.some((item) => item.includes('ego-browser')));

    const chrome = chromiumCandidates(null, { ProgramFiles: 'C:/Program Files' }, 'win32');
    assert.ok(chrome.some((item) => item.endsWith('chrome.exe')));
    assert.ok(chrome.some((item) => item.includes('Google')));

    const mac = chromiumCandidates(null, {}, 'darwin');
    assert.ok(mac.some((item) => item.includes('Google Chrome')));
});

test('the engine is chosen by what is installed', async () => {
    // The `auto` mode takes the headless Chromium: the snapshot of the page is taken headless.
    const auto = await resolveEngine({ browser: {} }, {
        findEgo: async () => 'C:/ego/ego.exe',
        findChromium: async () => 'C:/chrome/chrome.exe',
    });
    assert.equal(auto.engine, 'chrome');
    assert.equal(auto.interactions, false);
    // The ego lite is found and named, but it does not take the snapshot by itself.
    assert.equal(auto.ego, 'C:/ego/ego.exe');

    // An explicit engine is honoured: the run does not fall back behind the back of the user.
    const forcedEgo = await resolveEngine({ browser: { engine: 'ego' } }, {
        findEgo: async () => 'C:/ego/ego.exe',
        findChromium: async () => 'C:/chrome/chrome.exe',
    });
    assert.equal(forcedEgo.engine, 'ego');
    assert.equal(forcedEgo.interactions, true);

    const forcedChrome = await resolveEngine({ browser: { engine: 'chrome' } }, {
        findEgo: async () => 'C:/ego/ego.exe',
        findChromium: async () => 'C:/chrome/chrome.exe',
    });
    assert.equal(forcedChrome.engine, 'chrome');
});

test('no engine at all is an error with a way out', async () => {
    await assert.rejects(
        () => resolveEngine({ browser: {} }, { findEgo: async () => null, findChromium: async () => null }),
        /Браузер не найден|Chromium/,
    );
});

test('the arguments of the headless Chromium are the ones of a screenshot', () => {
    const args = chromeArgs({
        mode: 'screenshot',
        url: 'http://127.0.0.1:8080/index.html',
        output: 'C:/shot.png',
        width: 1440,
        height: 900,
        budgetMs: 5000,
        userDataDir: 'C:/profile',
    });
    assert.ok(args.includes('--headless=new'));
    assert.ok(args.includes('--window-size=1440,900'));
    assert.ok(args.includes('--screenshot=C:/shot.png'));
    assert.equal(args.at(-1), 'http://127.0.0.1:8080/index.html');

    const dom = chromeArgs({ mode: 'dump-dom', url: 'http://x/', userDataDir: 'C:/profile' });
    assert.ok(dom.includes('--dump-dom'));
    assert.ok(!dom.some((item) => item.includes('--screenshot=')));
    // The scrollbars stay on the picture: a second scrollbar of the page is a defect the
    // role has to see, and a hidden scrollbar cannot be seen.
    assert.ok(!args.includes('--hide-scrollbars'));
});

test('the local server serves the project and keeps the escape out', async () => {
    const { root, cleanup } = await project();
    const server = await startStaticServer(root);
    try {
        const page = await fetch(`${server.url}/index.html`);
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-type') ?? '', /text\/html/);
        assert.match(await page.text(), /Page/);

        const missing = await fetch(`${server.url}/nothing.html`);
        assert.equal(missing.status, 404);

        // The path that climbs out of the root gets nothing.
        const escape = await fetch(`${server.url}/../../etc/passwd`);
        assert.ok([403, 404].includes(escape.status));
    } finally {
        await server.close();
        await cleanup();
    }
});

test('the entry point of the project is found', async () => {
    const { root, cleanup } = await project();
    try {
        assert.equal(await entryPage(root), 'index.html');
    } finally {
        await cleanup();
    }
});

test('a screenshot rejects SVG assets instead of opening them as project pages', async () => {
    await assert.rejects(
        () => shootPage({ root: process.cwd(), page: 'assets/award-badge.svg' }),
        /HTML, а не ресурс assets\/award-badge\.svg/,
    );
});

test('the eye of the styles is on when there is something to compare with', () => {
    assert.equal(visionEnabled({ browser: { stylingVision: 'off' } }, { reference: true }), false);
    assert.equal(visionEnabled({ browser: { stylingVision: 'auto' } }, { reference: false }), false);
    assert.equal(visionEnabled({ browser: { stylingVision: 'auto' } }, { reference: true }), true);
    assert.equal(visionEnabled({ browser: { stylingVision: 'always' } }, { reference: false }), true);
    assert.equal(visionEnabled({}, { reference: true }), true);
});

test('the request of the eye names the reference and the result', () => {
    const prompt = visionPrompt({ reference: ['landing.png'], result: '.ai/shots/page-1.png', round: 1, rounds: 2 });
    assert.match(prompt, /landing\.png/);
    assert.match(prompt, /\.ai\/shots\/page-1\.png/);
    assert.match(prompt, /pass 1 of 2/);
    assert.match(prompt, /Compare them/);
});

test('the request of the eye carries the words of the page', () => {
    const prompt = visionPrompt({
        reference: ['landing.png'],
        result: '.ai/shots/page-1.png',
        round: 1,
        rounds: 1,
        log: 'Errors of the page:\n- Failed to load resource: 404',
    });
    assert.match(prompt, /What the page says about itself/);
    assert.match(prompt, /404/);
    // Without the words of the page the request says nothing about them.
    const plain = visionPrompt({ reference: [], result: 'x.png', round: 1, rounds: 1 });
    assert.doesNotMatch(plain, /What the page says about itself/);
});

test('only the stylesheets of the project are the work of the stage of the sight', () => {
    const { files, skipped } = stylesOnly(['styles.scss', 'src/parts/_base.scss'], [
        { path: 'styles.scss', content: 'a{}' },
        { path: 'index.html', content: '<html>' },
        { path: 'main.js', content: 'export {};' },
    ]);
    assert.deepEqual(files.map((item) => item.path), ['styles.scss']);
    assert.deepEqual(skipped, ['index.html', 'main.js']);
});

void ROOT;
