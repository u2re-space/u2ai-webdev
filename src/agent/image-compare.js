/**
 * @file src/agent/image-compare.js
 * @module agent/image-compare
 * @purpose The comparison of a page with the reference of the design: the same size, the
 *          possible PPI, the numbers of the difference and the picture of it.
 *
 *   Two pictures of different sizes cannot be compared: the difference between them is the
 *   difference of the sizes, not the difference of the page. The house therefore decides the
 *   size of the design first — the reference is a picture of a page, and the page is measured
 *   in CSS pixels, while the picture is measured in pixels of the picture: a picture of 2880
 *   pixels is a page of 1440 pixels at 2x, and a picture of 1024 pixels is a page of 1024
 *   pixels at 1x.
 *
 *   The possible PPI are tried one after another: 1x, 1.5x, 2x, 3x. Every candidate is
 *   brought to the same size and measured, and the report says which candidate the page
 *   matches best and how much it differs in the end.
 *
 *   The picture of the difference travels with the report: the numbers say how far the page
 *   is from the reference, and the picture says where.
 *
 * @depends node:path, node:fs/promises, agent/image-magick, agent/paths, inputs/assets
 * @usedBy stages/vision, stages/sight, agent/tools
 * @exports DEFAULT_DPR_CANDIDATES, MIN_DESIGN_WIDTH, MAX_DESIGN_WIDTH, scaleCandidates,
 *          pickScale, similarityOf, compareWithReference
 * @ai.tags images, compare, reference, ppi
 * @ai.hint io
 * @changed 2026-11-17 Сверка при одном размере и перебор PPI: 1x, 1.5x, 2x, 3x.
 */

import path from 'node:path';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';

import { resolveInside } from './paths.js';
import { detectImageMime, imageSize } from '../inputs/assets.js';
import { removeWorkDirectory, workDirectory } from './image-magick.js';

/** The PPI the house tries: 1x, 1.5x, 2x and 3x. */
export const DEFAULT_DPR_CANDIDATES = Object.freeze([1, 1.5, 2, 3]);

/** The narrowest page that is still a page. */
export const MIN_DESIGN_WIDTH = 320;

/** The widest page the house believes in. */
export const MAX_DESIGN_WIDTH = 2560;

/**
 * The candidates of the scale: what the width of the design is, if the picture was taken with
 * this PPI.
 * @param {{ referenceWidth: number, referenceHeight: number, dprs?: number[] }} request
 * @returns {Array<{ dpr: number, width: number, height: number, sane: boolean }>}
 * @exports
 * @ai.hint pure
 */
export function scaleCandidates({ referenceWidth, referenceHeight, dprs = DEFAULT_DPR_CANDIDATES } = {}) {
    const width = Number(referenceWidth);
    const height = Number(referenceHeight);
    const list = (Array.isArray(dprs) && dprs.length ? dprs : DEFAULT_DPR_CANDIDATES)
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
        .sort((left, right) => left - right);
    const out = [];
    for (const dpr of list) {
        const designWidth = Math.round(width / dpr);
        const designHeight = Math.round(height / dpr);
        out.push({
            dpr,
            width: designWidth,
            height: designHeight,
            // A page that is too narrow or too wide is not a page: the candidate is nonsense.
            sane: designWidth >= MIN_DESIGN_WIDTH && designWidth <= MAX_DESIGN_WIDTH,
        });
    }
    return out;
}

/**
 * Pick the scale of the reference: the PPI whose design width is the width the page is built
 * for.
 *
 * The width the page is built for is the hint that decides: a reference of 2880 pixels for a
 * page of 1440 pixels is a 2x picture, and a reference of 1024 pixels for the same page is a
 * narrow design that has to be built as it is.
 * @param {{ referenceWidth: number, referenceHeight: number, targetWidth?: number|null,
 *   dprs?: number[], tolerance?: number }} request
 * @returns {{ dpr: number, width: number, height: number, reason: string }}
 * @exports
 * @ai.hint pure
 */
export function pickScale({ referenceWidth, referenceHeight, targetWidth = null, dprs = DEFAULT_DPR_CANDIDATES, tolerance = 0.35 } = {}) {
    const candidates = scaleCandidates({ referenceWidth, referenceHeight, dprs });
    if (!candidates.length) {
        return { dpr: 1, width: Math.round(referenceWidth) || 0, height: Math.round(referenceHeight) || 0, reason: 'нет кандидатов' };
    }
    const target = Number(targetWidth);
    const sane = candidates.filter((item) => item.sane);
    const pool = sane.length ? sane : candidates;
    if (!Number.isFinite(target) || target <= 0) {
        const first = pool[0];
        return { ...first, reason: 'ширина страницы неизвестна: взята 1x' };
    }
    // The candidate whose design width is the closest to the width of the page.
    let best = pool[0];
    let distance = Math.abs(best.width - target);
    for (const candidate of pool.slice(1)) {
        const gap = Math.abs(candidate.width - target);
        if (gap < distance) {
            best = candidate;
            distance = gap;
        }
    }
    // A candidate that is far from the width of the page is not the answer: the picture is
    // then a picture of another page, and the honest answer is 1x.
    if (distance > target * tolerance) {
        const first = pool[0];
        return { ...first, reason: `ни один PPI не даёт ширину близкую к ${target}px: взята 1x` };
    }
    return {
        ...best,
        reason: `ширина картинки ${Math.round(referenceWidth)}px, а страница строится под ${target}px: это ${best.dpr}x`,
    };
}

/**
 * The similarity of two pictures in percent: 100 is the same picture, 0 is nothing alike.
 *
 * The root mean square error is the distance between the pictures, normalized: the smaller it
 * is, the closer the pictures are.
 * @param {{ rmse?: number|null, ssim?: number|null, ncc?: number|null }} metrics
 * @returns {number|null} the similarity in percent
 * @exports
 * @ai.hint pure
 */
export function similarityOf({ rmse = null, ssim = null, ncc = null } = {}) {
    if (Number.isFinite(rmse)) return Math.max(0, Math.min(100, Math.round((1 - rmse) * 100)));
    if (Number.isFinite(ssim)) return Math.max(0, Math.min(100, Math.round(ssim * 100)));
    if (Number.isFinite(ncc)) return Math.max(0, Math.min(100, Math.round(ncc * 100)));
    return null;
}

/**
 * The size of the picture of a file.
 * @param {string} file
 * @returns {Promise<{ width: number|null, height: number|null }>}
 */
async function sizeOfFile(file) {
    try {
        const bytes = await readFile(file);
        return imageSize(bytes, detectImageMime(file, bytes));
    } catch {
        return { width: null, height: null };
    }
}

/**
 * Compare a page with the reference of the design.
 *
 * The reference is a picture, the page is a picture: they are brought to the same size and
 * measured. Every candidate of the PPI is tried, and the report names the best one, the
 * numbers of the difference and the picture of it.
 * @param {{ root: string, reference: string, result: string, targetWidth?: number|null,
 *   dprs?: number[], backend?: object|null, env?: object, outDir?: string, diff?: boolean,
 *   workDir?: string|null }} request
 * @returns {Promise<object>} the report of the comparison
 * @exports
 * @ai.hint io
 */
export async function compareWithReference({
    root,
    reference,
    result,
    targetWidth = null,
    dprs = DEFAULT_DPR_CANDIDATES,
    backend = null,
    env = process.env,
    outDir = null,
    diff = true,
    workDir = null,
} = {}) {
    const warnings = [];
    const engine = backend ?? await (await import('./image-magick.js')).resolveImageBackend({ env, cwd: root });
    if (!engine) {
        return {
            ok: false,
            reason: 'ImageMagick не найден: сверка не выполнена',
            backend: null,
            warnings: ['ImageMagick не найден: поставьте ImageMagick или оставьте пакет @imagemagick/magick-wasm.'],
        };
    }
    const referenceAbs = (await resolveInside(root, String(reference), { allowRoot: false })).abs;
    const resultAbs = (await resolveInside(root, String(result), { allowRoot: false })).abs;
    const referenceSize = await sizeOfFile(referenceAbs);
    const resultSize = await sizeOfFile(resultAbs);
    if (!referenceSize.width || !resultSize.width) {
        return {
            ok: false,
            reason: 'размер одной из картинок не прочитан',
            backend: engine.name,
            warnings: [...warnings, 'Размер картинки не прочитан: сверка не выполнена.'],
        };
    }

    const candidates = scaleCandidates({
        referenceWidth: referenceSize.width,
        referenceHeight: referenceSize.height,
        dprs,
    });
    const design = pickScale({
        referenceWidth: referenceSize.width,
        referenceHeight: referenceSize.height,
        targetWidth,
        dprs,
    });

    const own = workDir ?? await workDirectory();
    const measured = [];
    let chosen = null;
    let chosenDiff = null;
    try {
        for (const candidate of candidates) {
            // The box of the comparison: both pictures are scaled to the width of the design
            // and cut to the height that both of them show.
            const width = Math.max(1, candidate.width);
            const referenceHeight = Math.max(1, Math.round(referenceSize.height * (width / referenceSize.width)));
            const resultHeight = Math.max(1, Math.round(resultSize.height * (width / resultSize.width)));
            const height = Math.max(1, Math.min(referenceHeight, resultHeight));
            const answer = await engine.compare({
                referencePath: referenceAbs,
                resultPath: resultAbs,
                width,
                height,
                workDir: own,
                diff: diff && candidate.dpr === design.dpr,
            });
            for (const note of answer.warnings ?? []) warnings.push(note);
            const metrics = {
                rmse: answer.rmse ?? null,
                ssim: answer.ssim ?? null,
                ncc: answer.ncc ?? null,
                psnr: answer.psnr ?? null,
            };
            const row = {
                dpr: candidate.dpr,
                width: candidate.width,
                height: candidate.height,
                sane: candidate.sane,
                box: { width, height },
                metrics,
                similarity: similarityOf(metrics),
            };
            measured.push(row);
            if (candidate.dpr === design.dpr) {
                chosen = row;
                chosenDiff = answer.diffPath ?? null;
            }
        }

        // The picture of the difference goes into the project before the work is cleaned up.
        let difference = null;
        if (chosenDiff && diff) {
            const target = outDir
                ? path.join(root, outDir, `diff-${path.basename(reference)}`)
                : path.join(root, '.ai', 'shots', `diff-${path.basename(reference)}`);
            await mkdir(path.dirname(target), { recursive: true });
            await copyFile(chosenDiff, target).catch(() => {});
            const written = await stat(target).catch(() => null);
            if (written?.isFile()) {
                const { rel } = await resolveInside(root, path.relative(root, target), { allowRoot: false });
                difference = { rel, bytes: written.size };
            }
        }

        // The candidate that matches the page best — the evidence next to the decision.
        // Only the plausible candidates count: a rescale washes the differences out, so a
        // candidate that is far from the width of the page looks "closer" only because it is
        // blurrier. The width of the page decides, the numbers show how far the page is.
        const target = Number(targetWidth);
        const plausible = measured.filter((row) => {
            if (!Number.isFinite(target) || target <= 0) return row.sane;
            return row.sane && Math.abs(row.width - target) <= target * 0.35;
        });
        const pool = plausible.length ? plausible : measured.filter((row) => row.sane);
        const best = pool
            .filter((row) => Number.isFinite(row.similarity))
            .sort((left, right) => right.similarity - left.similarity)[0] ?? null;
        // When the candidates are close to each other, the numbers do not tell the PPI apart.
        const spread = measured
            .filter((row) => Number.isFinite(row.similarity))
            .map((row) => row.similarity);
        if (spread.length > 1 && Math.max(...spread) - Math.min(...spread) <= 3) {
            warnings.push('Кандидаты PPI дали почти одинаковые числа: различие картинок не позволяет отличить 1x от 2x, решает ширина страницы.');
        }

        return {
            ok: Boolean(chosen),
            backend: engine.name,
            version: engine.version ?? null,
            reference: { path: String(reference), width: referenceSize.width, height: referenceSize.height },
            result: { path: String(result), width: resultSize.width, height: resultSize.height },
            design,
            metrics: chosen?.metrics ?? null,
            similarity: chosen?.similarity ?? null,
            candidates: measured,
            best: best ? { dpr: best.dpr, similarity: best.similarity, width: best.width } : null,
            difference,
            warnings,
        };
    } finally {
        if (!workDir) await removeWorkDirectory(own);
    }
}
