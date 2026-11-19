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
 * @depends node:path, node:fs/promises, agent/browser, inputs/references, stages/workspace,
 *          agent/image-compare
 * @usedBy stages/styling
 * @exports visionEnabled, shootPage, visionPrompt, comparisonNote, comparePictures, designWidth
 * @ai.tags stages, vision, screenshot
 * @ai.hint io
 * @changed 2026-11-16 Зрение стадии стилей: снимок страницы и сравнение с референсом.
 * @changed 2026-11-17 Сверка с референсом при одном размере: перебор PPI и картинка различий.
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
import { compareWithReference, pickScale } from '../agent/image-compare.js';
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
    if (page && !/\.html?$/i.test(String(page))) {
        throw new Error(`Снимок страницы принимает HTML, а не ресурс ${page}; SVG проверяется локально.`);
    }
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
 * Without a reference there is nothing to compare with, and the task of the operator is the
 * target: the picture says how the page looks now, the task says what has to change.
 *
 * The words of the page come along: the console of the browser and the log of the bundler say
 * what is broken inside the page, and the picture says how it looks. A role that has both
 * fixes the cause, not the symptom.
 * @param {{ reference: string[], result: string, round: number, rounds: number, log?: string,
 *   comparison?: object|null, task?: string }} options
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function visionPrompt({ reference = [], result = '', round = 1, rounds = 1, log = '', comparison = null, task = '' } = {}) {
    const withReference = reference.length > 0;
    const lines = withReference ? [
        'The page has been opened in a browser and shot. The picture of the result is attached to',
        'this request, and the picture of the reference of the design is attached with it.',
        '',
        'Compare them and fix the styles that do not match: the proportions of the blocks, the',
        'size of the type, the spaces, the colours, the shape of the corners, the alignment.',
        'The reference is the target: the result must look like it at the same width.',
        '',
        `The picture of the result: ${result}`,
        `The pictures of the reference: ${reference.join(', ')}`,
    ] : [
        'The page has been opened in a browser and shot. The picture of the result is attached to',
        'this request.',
        '',
        'There is no reference of the design here: the task of the operator is the target.',
        task ? `The task:\n${task}` : '',
        '',
        'Fix what the task names, with the tools: the proportions of the blocks, the size of the',
        'type, the spaces, the colours, the shape of the corners, the alignment — whatever the',
        'task asks for and whatever the picture shows to be wrong.',
        '',
        `The picture of the result: ${result}`,
    ];
    lines.push(
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
        comparisonNote(comparison),
        log ? `\n## What the page says about itself\n${log}\nThe lines above are the words of the page and of the bundler. Use them: they name the cause of what the picture shows.` : '',
    );
    return lines.filter(Boolean).join('\n');
}

/**
 * The words of the comparison: what the machine measured between the page and the reference.
 *
 * The eye of the role sees two pictures; the numbers say how far the page is from the
 * reference and the picture of the difference says where. Both are cheaper than a long
 * argument about the picture.
 * @param {object|null} report the report of the comparison
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function comparisonNote(report = null) {
    if (!report?.ok) return '';
    const lines = ['## What the machine measured'];
    const reference = report.reference ?? {};
    const result = report.result ?? {};
    lines.push(`The reference is ${reference.width}x${reference.height} pixels, the picture of the page is ${result.width}x${result.height} pixels.`);
    if (report.design?.dpr) {
        lines.push(`The PPI of the reference: ${report.design.dpr}x — the design is ${report.design.width} CSS pixels wide`
            + `${report.design.height ? ` and ${report.design.height} CSS pixels high` : ''}. `
            + 'The picture of the page was taken at that size, so the two pictures are of the same size '
            + 'and the comparison is a comparison of the page and not of the sizes. Take your own picture '
            + 'at that size too when you want to look at the page yourself.');
    }
    const metrics = report.metrics ?? {};
    if (Number.isFinite(metrics.rmse)) {
        lines.push(`The difference (RMSE): ${metrics.rmse.toFixed(3)} — the pages differ by ${Math.round(metrics.rmse * 100)}%.`);
    }
    if (Number.isFinite(metrics.ssim)) {
        lines.push(`The structural similarity (SSIM): ${metrics.ssim.toFixed(3)}.`);
    }
    if (Number.isFinite(metrics.ncc)) {
        lines.push(`The correlation (NCC): ${metrics.ncc.toFixed(3)}.`);
    }
    if (Number.isFinite(report.similarity)) {
        lines.push(`The similarity of the page with the reference: ${report.similarity}%.`);
    }
    if (report.difference?.rel) {
        lines.push(`The picture of the difference is attached to this request: ${report.difference.rel}. The red places are the places where the page differs from the reference — that is where the styles are wrong. The white places are the places that already match: do not touch them.`);
    }
    return lines.join('\n');
}

/**
 * Compare the picture of the page with the reference of the design.
 *
 * The pictures of different sizes are brought to the same size first: the PPI of the
 * reference is tried one after another (1x, 1.5x, 2x, 3x), and the report says which one the
 * page matches and how much the page differs in the end.
 * @param {{ root: string, reference: string, result: string, config?: object, env?: object,
 *   targetWidth?: number|null, backend?: object|null }} request
 * @returns {Promise<object>} the report of the comparison
 * @exports
 * @ai.hint io
 */
export async function comparePictures({ root, reference, result, config = {}, env = process.env, targetWidth = null, backend = null } = {}) {
    const dprs = Array.isArray(config?.browser?.compareDprs) ? config.browser.compareDprs : undefined;
    return await compareWithReference({
        root,
        reference,
        result,
        targetWidth,
        dprs,
        backend,
        env,
    });
}

/**
 * The width of the design: what the width of the reference means in CSS pixels.
 *
 * A picture of the design is a picture of a page, and a page is measured in CSS pixels while
 * the picture is measured in pixels of the picture: a picture of 2880 pixels is a page of
 * 1440 pixels at 2x. The house tries the possible PPI and keeps the one whose width of the
 * design is the width the page is built for.
 * @param {{ reference?: { width?: number, height?: number }|null, targetWidth?: number|null,
 *   dprs?: number[] }} request
 * @returns {{ dpr: number, width: number, height: number, reason: string }|null}
 * @exports
 * @ai.hint pure
 */
export function designWidth({ reference = null, targetWidth = null, dprs = undefined } = {}) {
    const width = Number(reference?.width);
    const height = Number(reference?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return pickScale({
        referenceWidth: width,
        referenceHeight: height,
        targetWidth,
        dprs,
    });
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
