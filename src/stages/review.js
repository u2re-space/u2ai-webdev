/**
 * @file src/stages/review.js
 * @module stages/review
 * @purpose The review of the result: does the step do what it asked, and is it good enough.
 *
 *   The stage reviews every step of the plan that has a result. The reviewer judges the
 *   criteria of the step first and the quality after that, and every issue it names has a
 *   path and a request.
 *
 *   When there are screenshots of the result, they go into the request as pictures: the
 *   reviewer looks at the layout before it judges it.
 *
 * @depends node:fs/promises, roles/index, openai/responses, stages/architect, stages/workspace
 * @usedBy stages/index, pipeline
 * @exports REVIEW_FILE, reviewVerdict, worstVerdict, readScreenshots, writeReview, readReview,
 *          reviewStage
 * @ai.tags stages, review
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: ревью по критериям шага и по картинкам.
 */

import { readFile } from 'node:fs/promises';
import { runRole } from '../roles/index.js';
import { imagePart } from '../openai/responses.js';
import { resolveInside } from '../agent/paths.js';
import { architectureText } from './architect.js';
import { runId, runFile, writeJsonFile, readJsonFile } from './workspace.js';

/** The name of the file of the review inside the directory of the run. */
export const REVIEW_FILE = 'review.json';

/** The verdicts, from the best to the worst. */
const VERDICTS = Object.freeze(['pass', 'partial', 'fail']);

/**
 * The verdict of an answer, when it is one of the three.
 * @param {unknown} value
 * @returns {'pass'|'partial'|'fail'}
 * @exports
 * @ai.hint pure
 */
export function reviewVerdict(value) {
    const text = String(value ?? '').trim().toLowerCase();
    return VERDICTS.includes(text) ? text : 'partial';
}

/**
 * The worst verdict of a list.
 * @param {string[]} verdicts
 * @returns {'pass'|'partial'|'fail'}
 * @exports
 * @ai.hint pure
 */
export function worstVerdict(verdicts = []) {
    let worst = 'pass';
    for (const verdict of verdicts) {
        const value = reviewVerdict(verdict);
        if (VERDICTS.indexOf(value) > VERDICTS.indexOf(worst)) worst = value;
    }
    return worst;
}

/**
 * Read the screenshots of the result as the parts of a request.
 *
 * A file that cannot be read is skipped: a missing picture is not a reason to stop the
 * review, it only means the reviewer judges the code.
 * @param {string} root
 * @param {string[]} files
 * @returns {Promise<{ parts: object[], names: string[], warnings: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function readScreenshots(root, files = []) {
    const parts = [];
    const names = [];
    const warnings = [];
    for (const file of Array.isArray(files) ? files : []) {
        const rel = String(file ?? '').trim();
        if (!rel) continue;
        try {
            const { abs } = await resolveInside(root, rel);
            const bytes = await readFile(abs);
            const mime = rel.toLowerCase().endsWith('.jpg') || rel.toLowerCase().endsWith('.jpeg')
                ? 'image/jpeg'
                : 'image/png';
            parts.push(imagePart(bytes, mime));
            names.push(rel);
        } catch (error) {
            warnings.push(`Картинка ${rel} не прочитана: ${error?.message ?? error}`);
        }
    }
    return { parts, names, warnings };
}

/**
 * The path of the review of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function reviewPath(root, config = {}, id = null) {
    return runFile(root, config, id, REVIEW_FILE);
}

/**
 * Write the review of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @param {object} review
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function writeReview(root, config = {}, id = null, review = {}) {
    return await writeJsonFile(reviewPath(root, config, id), review);
}

/**
 * Read the review of a run. A missing file gives null.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readReview(root, config = {}, id = null) {
    return await readJsonFile(reviewPath(root, config, id));
}

/**
 * The stage of the review.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, reports?: object[], screenshots?: string[],
 *   runId?: string|null, notify?: (event: object) => void, env?: object }} request
 * @returns {Promise<{ stage: string, ok: boolean, verdict: string, reviews: object[],
 *   issues: object[], file: string|null, warnings: string[], runId: string }>}
 * @exports
 * @ai.hint io
 */
export async function reviewStage({
    client,
    config = {},
    root = process.cwd(),
    task = '',
    plan = null,
    architecture = null,
    inputs = null,
    reports = [],
    screenshots = [],
    runId: id = null,
    notify = () => {},
    env = process.env,
} = {}) {
    if (!client?.responses) throw new Error('Клиент API не передан.');
    const run = id ?? runId();
    const brief = architecture ? architectureText(architecture) : '';

    const done = new Set((Array.isArray(reports) ? reports : []).map((report) => report?.step?.id).filter(Boolean));
    const steps = (Array.isArray(plan?.steps) ? plan.steps : [])
        .filter((step) => !done.size || done.has(step.id));

    if (!steps.length) {
        return {
            stage: 'review',
            ok: false,
            verdict: 'fail',
            reviews: [],
            issues: [],
            file: null,
            warnings: ['Нечего ревьюить: в плане нет шагов с результатом.'],
            runId: run,
        };
    }

    const shots = await readScreenshots(root, screenshots);
    const warnings = [...shots.warnings];
    const reviews = [];
    const issues = [];

    for (const step of steps) {
        const blocks = [];
        if (task) blocks.push(String(task).trim());
        blocks.push([
            `## The step ${step.id}`,
            `- title: ${step.title}`,
            step.files?.length ? `- files: ${step.files.join(', ')}` : '- files: not named',
        ].join('\n'));
        if (brief) blocks.push(brief);
        if (inputs) blocks.push('The design direction and the measurements are in the task context.');

        const result = await runRole({
            client,
            config,
            role: 'reviewer',
            input: blocks.join('\n\n'),
            context: {
                task: String(task ?? ''),
                step,
                brief,
                criteria: step.criteria ?? [],
                screenshots: shots.names,
                design: Boolean(inputs),
            },
            root,
            env,
            maxTurns: config?.stages?.review?.maxTurns ?? null,
            notify,
            parts: shots.parts,
        });

        const data = result.data ?? {};
        const review = {
            step: { id: step.id, title: step.title },
            ok: Boolean(result.data),
            verdict: reviewVerdict(data.verdict),
            scores: data.scores ?? null,
            issues: Array.isArray(data.issues) ? data.issues : [],
            summary: String(data.summary ?? result.text ?? '').trim(),
            recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
        };
        if (!result.data) warnings.push(`Шаг ${step.id}: ревьюер не вернул ответ.`);
        reviews.push(review);
        issues.push(...review.issues);
    }

    const verdict = worstVerdict(reviews.map((review) => review.verdict));
    const review = {
        verdict,
        reviews,
        issues,
        summary: `Шагов проверено: ${reviews.length}. Вердикт: ${verdict}.`,
    };
    const file = await writeReview(root, config, run, review);

    return {
        stage: 'review',
        ok: verdict !== 'fail',
        verdict,
        reviews,
        issues,
        file,
        warnings,
        runId: run,
    };
}
