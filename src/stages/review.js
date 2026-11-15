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
 *          issueOwner, repairText, repairIssues, reviewStage
 * @ai.tags stages, review
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: ревью по критериям шага и по картинкам.
 */

import { readFile } from 'node:fs/promises';
import { runRole, roleReason } from '../roles/index.js';
import { imagePart } from '../openai/responses.js';
import { resolveInside } from '../agent/paths.js';
import { checkFiles } from '../agent/syntax.js';
import { readReferences } from '../inputs/references.js';
import { architectureText } from './architect.js';
import { applyFiles, filesByTool } from './step.js';
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
 * The step that owns the file of an issue, and the role that has to fix it.
 *
 * The reviewer names the path of the file and the change that is asked for. The role that
 * wrote the file is the one that knows it: the role of the step of the plan that owns the
 * file. When no step names the file, the role is guessed from the extension.
 * @param {object|null} plan
 * @param {object} issue
 * @returns {{ step: object|null, role: string|null }}
 * @exports
 * @ai.hint pure
 */
export function issueOwner(plan, issue = {}) {
    const rel = String(issue?.path ?? '').trim().replace(/\\/g, '/');
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    for (const step of steps) {
        const files = Array.isArray(step?.files) ? step.files : [];
        if (files.some((file) => String(file ?? '').trim().replace(/\\/g, '/') === rel)) {
            return { step, role: String(step?.role ?? '').trim() || null };
        }
    }
    const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
    const byExt = { scss: 'styler', sass: 'styler', css: 'styler', less: 'styler', js: 'coder', mjs: 'coder', html: 'markup' };
    const role = byExt[ext] ?? null;
    const step = steps.find((item) => String(item?.role ?? '').trim() === role) ?? null;
    return { step, role };
}

/**
 * The stage a role belongs to.
 *
 * The roles and the stages do not share their names: the role `styler` works in the stage
 * `styling`, the role `coder` in the stage `coding`. The budget of the turns of the repair
 * is the budget of the stage the role belongs to.
 * @type {Readonly<Record<string, string>>}
 */
const STAGE_OF_ROLE = Object.freeze({
    coder: 'coding',
    markup: 'markup',
    styler: 'styling',
    editor: 'vector',
    iconifier: 'iconify',
    installer: 'setup',
});

/**
 * The request that asks the role of the step to fix what the reviewer found.
 *
 * The reviewer names the file, what is wrong with it and the change that is asked for. The
 * role that owns the file reads it, makes the change and writes the file back: a review
 * that finds a defect and leaves it on the disk is a report, not a repair.
 * @param {object} step
 * @param {object[]} issues
 * @param {{ again?: boolean }} [options] `again` says that the last repair did not close
 *   the defect: the role has to look at the file once more
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function repairText(step, issues = [], { again = false } = {}) {
    const list = Array.isArray(issues) ? issues : [];
    const lines = list.map((issue) => [
        `- file: ${issue?.path ?? 'unknown'}`,
        `- severity: ${issue?.severity ?? 'medium'}`,
        `- what is wrong: ${String(issue?.message ?? '').trim()}`,
        `- what to do: ${String(issue?.requestedChange ?? '').trim()}`,
    ].join('\n')).join('\n\n');
    const files = Array.isArray(step?.files) ? step.files : [];
    return [
        `The review of the step ${step?.id ?? ''} found what has to be fixed. The review named the`,
        'file, what is wrong with it and the change that is asked for:',
        '',
        lines,
        '',
        ...(again
            ? ['The last repair did not close the defect: the file on the disk is still broken.',
                'Read it again and make the change that is asked for — not the same change again.']
            : []),
        ...(again ? [''] : []),
        `The files of the step: ${files.join(', ') || 'not named'}.`,
        '',
        'Fix it now with the tools: read the file, make the change that is asked for, and write the',
        'file back under the same path. Change the file, not the report: an answer that only says',
        'what should be done leaves the defect on the disk. Keep the rest of the file as it is —',
        'the repair is the change that is asked for, nothing else. Write the repaired file under the',
        'same path as the broken one: a copy with another name leaves the broken file on the disk.',
        'Do not answer until the file is on the disk.',
    ].join('\n');
}

/**
 * The repair of the issues that the review found.
 *
 * The issues are grouped by the role that owns the file, and every role is asked to fix its
 * own: the role of the styles fixes the styles, the role of the code fixes the code. The
 * files the roles wrote go on the disk, and they are checked: a repair that does not compile
 * is a defect in a new place.
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, issues?: object[], notify?: (event: object) => void,
 *   env?: object, again?: boolean }} request
 * @returns {Promise<{ repaired: object[], written: string[], warnings: string[], errors: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function repairIssues({
    client,
    config = {},
    root = process.cwd(),
    task = '',
    plan = null,
    architecture = null,
    issues = [],
    notify = () => {},
    env = process.env,
    again = false,
} = {}) {
    const list = Array.isArray(issues) ? issues : [];
    const repaired = [];
    const written = [];
    const warnings = [];
    const errors = [];
    if (!list.length) return { repaired, written, warnings, errors };

    // The issues are grouped by the role that owns the file of the issue.
    const groups = new Map();
    for (const issue of list) {
        const { step, role } = issueOwner(plan, issue);
        const key = String(role ?? step?.id ?? 'unknown');
        if (!groups.has(key)) groups.set(key, { step, role, issues: [] });
        groups.get(key).issues.push(issue);
    }

    const brief = architecture ? architectureText(architecture) : '';
    for (const group of groups.values()) {
        if (!group.role) {
            warnings.push(`Ремонт пропущен: у замечания нет владельца (${group.issues[0]?.path ?? 'файл'}).`);
            continue;
        }
        const result = await runRole({
            client,
            config,
            role: group.role,
            input: repairText(group.step, group.issues, { again }),
            context: {
                task: String(task ?? ''),
                step: group.step,
                brief,
                issues: group.issues,
            },
            root,
            env,
            maxTurns: config?.stages?.[STAGE_OF_ROLE[group.role] ?? group.role]?.maxTurns ?? null,
            requireFiles: true,
            notify,
        });
        if (!result.data) {
            warnings.push(`Ремонт роли ${group.role} не удался: ${roleReason(result) || 'роль не вернула ответ'}.`);
            errors.push(`${group.role}: ${roleReason(result) || 'роль не вернула ответ'}`);
            continue;
        }
        const files = Array.isArray(result.data.files) ? result.data.files : [];
        if (!files.length) {
            warnings.push(`Ремонт роли ${group.role} не написал ни одного файла.`);
            errors.push(`${group.role}: ни одного файла не написано`);
            continue;
        }
        const applied = await applyFiles({ root, files, owned: filesByTool(result) });
        warnings.push(...applied.warnings);
        written.push(...applied.written);
        if (applied.failed.length) {
            warnings.push(`Ремонт роли ${group.role}: файлы не записаны: ${applied.failed.join(', ')}.`);
            errors.push(`${group.role}: файлы не записаны: ${applied.failed.join(', ')}`);
        }
        // The repaired files have to compile: a repair that does not compile is a defect in
        // a new place.
        const checked = [...new Set([...applied.written, ...applied.replaced])].filter(Boolean);
        const syntax = await checkFiles(root, checked, { env });
        for (const error of syntax.errors) {
            warnings.push(`Ремонт роли ${group.role}: ошибка синтаксиса в ${error.file}: ${error.message}`);
            errors.push(`${error.file}: ${error.message}`);
        }
        repaired.push({
            role: group.role,
            step: group.step?.id ?? null,
            issues: group.issues,
            files: [...applied.written, ...applied.replaced],
        });
    }
    return { repaired, written, warnings, errors };
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
    const reference = await readReferences(root, inputs?.references ?? []);
    const warnings = [...shots.warnings, ...reference.warnings];
    const reviews = [];

    /**
     * The review of one step of the plan.
     * @param {object} step
     * @returns {Promise<object>}
     * @ai.hint io
     */
    const reviewOne = async (step) => {
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
                reference: reference.names,
                design: Boolean(inputs),
            },
            root,
            env,
            maxTurns: config?.stages?.review?.maxTurns ?? null,
            notify,
            parts: [...reference.parts, ...shots.parts],
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
        return review;
    };

    for (const step of steps) reviews.push(await reviewOne(step));

    // The findings of the first pass go to the disk before the repair starts: a repair that
    // runs out of time must not take the findings with it.
    const snapshot = (repair) => {
        const issues = reviews.flatMap((review) => review.issues);
        const verdict = worstVerdict(reviews.map((review) => review.verdict));
        return {
            verdict,
            reviews,
            issues,
            repair: repair ?? null,
            summary: `Шагов проверено: ${reviews.length}. Вердикт: ${verdict}.`,
        };
    };
    await writeReview(root, config, run, snapshot(null));

    // The review finds the defects. The repair fixes them: the role that owns the file is
    // asked to make the change that the reviewer asked for, and the step is reviewed again.
    // A review that finds a defect and leaves it on the disk is a report, not a repair.
    // The repair may need more than one pass: what the role wrote is read again, and the
    // defects that are still there are named again and repaired again.
    const wanted = config?.stages?.review?.repair !== false;
    const rounds = Number.isSafeInteger(config?.stages?.review?.repairRounds)
        ? Math.max(0, config.stages.review.repairRounds)
        : 2;
    const repairs = [];
    if (wanted) {
        for (let round = 0; round < rounds; round++) {
            const found = reviews.flatMap((review) => review.issues);
            if (!found.length) break;
            const repair = await repairIssues({
                client,
                config,
                root,
                task,
                plan,
                architecture,
                issues: found,
                notify,
                env,
                again: round > 0,
            });
            warnings.push(...repair.warnings);
            repairs.push(repair);
            // The steps that were repaired are judged again: the verdict of the run has to
            // say what the project looks like now, not what it looked like before.
            const dirty = new Set(found
                .map((issue) => issueOwner(plan, issue).step?.id)
                .filter(Boolean));
            if (!dirty.size) break;
            for (const [index, old] of reviews.entries()) {
                if (!dirty.has(old.step.id)) continue;
                const step = steps.find((item) => item.id === old.step.id);
                if (!step) continue;
                reviews[index] = await reviewOne(step);
            }
            // The findings of the pass go to the disk as well: the next pass starts from
            // what the last one saw.
            await writeReview(root, config, run, snapshot(null));
        }
    }

    const repair = repairs.length
        ? {
            repaired: repairs.flatMap((item) => item.repaired),
            written: [...new Set(repairs.flatMap((item) => item.written))],
            errors: repairs.flatMap((item) => item.errors),
        }
        : null;
    const review = snapshot(repair);
    const file = await writeReview(root, config, run, review);

    return {
        stage: 'review',
        ok: review.verdict !== 'fail',
        verdict: review.verdict,
        reviews: review.reviews,
        issues: review.issues,
        repair: review.repair,
        file,
        warnings,
        runId: run,
    };
}
