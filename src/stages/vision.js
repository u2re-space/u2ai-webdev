/**
 * @file src/stages/vision.js
 * @module stages/vision
 * @purpose The eyes of the styles: a screenshot of the page and a comparison with the reference.
 *
 *   The styles of a page cannot be judged by the code that writes them. A rule that compiles
 *   may still break the layout: the type is enormous, the columns run out of the screen, the
 *   picture is stretched. The stage of the styles therefore opens the page of the project in a
 *   real browser, takes a screenshot of it and gives the picture to the styler together with
 *   the reference of the design — so the role sees what it has written and what it has to
 *   reach.
 *
 *   The loop is bounded: the stage shoots the page, asks the styler to compare it with the
 *   reference and to fix the styles, and shoots the page again. A page that cannot be opened
 *   (no browser, no entry point, a broken build) is reported and the run goes on — the styles
 *   are still written, they are simply not checked by the eye.
 *
 * @depends node:path, node:fs/promises, agent/browser, inputs/references, stages/workspace
 * @usedBy stages/styling
 * @exports visionEnabled, shootPage, visionPrompt, comparePictures
 * @ai.tags stages, vision, screenshot
 * @ai.hint io
 * @changed 2026-11-16 Зрение стадии стилей: снимок страницы и сравнение с референсом.
 */

import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

import {
    findChromium,
    findEgo,
    resolveEngine,
    screenshotPage,
    startStaticServer,
} from '../agent/browser.js';
import { resolveInside } from '../agent/paths.js';
import { imagePart } from '../openai/responses.js';
/**
 * Whether the stage of the styles may look at the page.
 *
 * `off` never shoots, `auto` shoots when the reference of the design is there — there is
 * nothing to compare with otherwise — and `always` shoots even without a reference.
 * @param {object} config
 * @param {{ reference?: boolean }} [options]
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function visionEnabled(config = {}, { reference = false } = {}) {
    const mode = config?.browser?.stylingVision ?? 'auto';
    if (mode === 'off') return false;
    if (mode === 'always') return true;
    return Boolean(reference);
}

/**
 * The entry point of the project: the page the browser opens.
 * @param {string} root
 * @returns {Promise<string|null>} the path of the page, relative to the root
 * @exports
 * @ai.hint io
 */
export async function entryPage(root) {
    for (const name of ['index.html', 'src/index.html', 'public/index.html', 'dist/index.html']) {
        const found = await readFile(path.join(root, name)).then(() => true).catch(() => false);
        if (found) return name;
    }
    return null;
}

/**
 * Take a screenshot of the page of the project.
 *
 * The page is served by a local server of the package: a `file://` URL breaks the modules
 * and the fetch of a modern project. The picture is written inside the working directory.
 *
 * A project on Vite keeps its styles inside the script (`import './styles.scss'`), so the page
 * of the root has no styles at all: the page of the build (`dist/`) is the one that shows
 * something. When the dev server of the project is already running (`npm run dev` →
 * `http://localhost:5173/`), that live page is taken instead: the styles there are the
 * current ones, compiled by the bundler.
 * @param {{ root: string, config?: object, env?: object, page?: string|null, output?: string,
 *   width?: number, height?: number, timeoutMs?: number, engine?: object|null, url?: string|null }} options
 * @returns {Promise<{ rel: string, abs: string, bytes: number, engine: string, url: string }>}
 * @exports
 * @ai.hint io
 */
export async function shootPage({
    root,
    config = {},
    env = process.env,
    page = null,
    output = '',
    width = 1440,
    height = 900,
    timeoutMs = 45_000,
    engine = null,
    url = null,
} = {}) {
    const target = output
        ? (await resolveInside(root, output, { forWrite: true, allowRoot: false })).abs
        : path.join(root, '.ai', 'shots', `page-${Date.now().toString(36)}.png`);
    await mkdir(path.dirname(target), { recursive: true });

    // The live server of the project wins: it shows the styles as they are now.
    const live = String(url ?? config?.browser?.url ?? '').trim();
    const server = live ? null : await startStaticServer(root);
    try {
        const entry = live ? '' : (page ?? await entryPage(root));
        if (!live && !entry) throw new Error('Страница не найдена: в проекте нет index.html.');
        const address = live || `${server.url}/${entry.split('/').map(encodeURIComponent).join('/')}`;
        const shot = await screenshotPage({
            url: address,
            output: target,
            width,
            height,
            timeoutMs,
            engine: engine ?? await resolveEngine(config, {
                findEgo: async () => await findEgo({ env }),
                findChromium: async () => await findChromium({ env }),
            }),
            env,
            cwd: root,
        });
        const { rel } = await resolveInside(root, path.relative(root, target), { allowRoot: false });
        return {
            rel,
            abs: target,
            bytes: shot.bytes,
            engine: shot.engine,
            url: address,
            console: shot.console ?? [],
            errors: shot.errors ?? [],
            failed: shot.failed ?? [],
            log: shot.log ?? '',
        };
    } finally {
        await server?.close();
    }
}

/**
 * The request that asks the styler to compare the page with the reference.
 *
 * The picture of the result and the picture of the reference travel together: the role sees
 * both and names the difference. The instruction is short and concrete — the role has the
 * tools to fix what it sees.
 *
 * The words of the page come along: the console of the browser and the log of the bundler say
 * what is broken inside the page, and the picture says how it looks. A role that has both
 * fixes the cause, not the symptom.
 * @param {{ reference: string[], result: string, round: number, rounds: number, log?: string }} options
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function visionPrompt({ reference = [], result = '', round = 1, rounds = 1, log = '' } = {}) {
    const lines = [
        'The page has been opened in a browser and shot. The picture of the result is attached to',
        'this request, and the picture of the reference of the design is attached with it.',
        '',
        'Compare them and fix the styles that do not match: the proportions of the blocks, the',
        'size of the type, the spaces, the colours, the shape of the corners, the alignment.',
        'The reference is the target: the result must look like it at the same width.',
        '',
        `The picture of the result: ${result}`,
        reference.length ? `The pictures of the reference: ${reference.join(', ')}` : '',
        '',
        round < rounds
            ? `Fix the styles now, with the tools. This is the pass ${round} of ${rounds}: after the fix the page is shot again.`
            : 'Fix the styles now, with the tools. This is the last pass: the fix has to be the whole one.',
        'Write the styles under the same paths as before: a copy with another name leaves the',
        'broken styles on the disk. Do not describe the fix — make it.',
        '',
        'In the notes of the answer write down what the reference looks like and what still',
        'differs from it: the proportions, the size of the type, the spaces, the colours. The',
        'later stages read those notes, so they know what the page is and what it is not —',
        'they do not see the picture.',
        log ? `\n## What the page says about itself\n${log}\nThe lines above are the words of the page and of the bundler. Use them: they name the cause of what the picture shows.` : '',
    ].filter(Boolean);
    return lines.join('\n');
}

/**
 * Read a picture of the project as a part of a request.
 * @param {string} root
 * @param {string} rel
 * @returns {Promise<object|null>} the image part, or null when the file is not there
 * @exports
 * @ai.hint io
 */
export async function picturePart(root, rel) {
    const name = String(rel ?? '').trim();
    if (!name) return null;
    try {
        const { abs } = await resolveInside(root, name, { allowRoot: false });
        const bytes = await readFile(abs);
        const mime = /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/png';
        return imagePart(bytes, mime);
    } catch {
        return null;
    }
}
