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
 * @depends node:fs/promises, roles/index, openai/responses, stages/architect, stages/workspace,
 *          agent/markup-styles, stages/project-files
 * @usedBy stages/index, pipeline
 * @exports REVIEW_FILE, reviewVerdict, worstVerdict, readScreenshots, writeReview, readReview,
 *          issueOwner, repairText, repairIssues, markupSnapshot, stylePairIssues, reviewStage,
 *          compareReview
 * @ai.tags stages, review
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: ревью по критериям шага и по картинкам.
 * @changed 2026-11-17 Сверка страницы с референсом: числа и картинка различий в ревью.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { runRole, roleReason } from '../roles/index.js';
import { imagePart } from '../openai/responses.js';
import { resolveInside } from '../agent/paths.js';
import { checkFiles } from '../agent/syntax.js';
import { checkMarkupStyles, renamedClasses } from '../agent/markup-styles.js';
import { readReferences } from '../inputs/references.js';
import { architectureText } from './architect.js';
import { projectFiles } from './project-files.js';
import { applyFiles, filesByTool, LOOKS_AT_DESIGN } from './step.js';
import { comparisonNote, comparePictures, picturePart } from './vision.js';
import { runId, runFile, writeJsonFile, readJsonFile } from './workspace.js';

/**
 * Compare the page with the reference of the design, if both of them are there.
 *
 * A stage that cannot compare says so and goes on: the review of the code is worth more
 * than nothing, and the comparison is a help, not a condition.
 * @param {{ root: string, config?: object, env?: object, reference?: string|null,
 *   shot?: string|null, warnings?: string[] }} request
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function compareReview({ root, config = {}, env = process.env, reference = null, shot = null, warnings = [] } = {}) {
    const mode = String(config?.browser?.compare ?? 'auto');
    if (mode === 'off' || !reference || !shot) return null;
    try {
        const viewport = config?.browser?.viewport ?? {};
        const report = await comparePictures({
            root,
            reference,
            result: shot,
            config,
            env,
            targetWidth: Number.isSafeInteger(viewport.width) ? viewport.width : null,
        });
        if (!report.ok) {
            warnings.push(`Сверка с референсом не выполнена: ${report.reason ?? 'причина неизвестна'}`);
            return null;
        }
        return report;
    } catch (error) {
        warnings.push(`Сверка с референсом не выполнена: ${error?.message ?? error}`);
        return null;
    }
}

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
        'The picture of the page and the picture of the reference of the design are attached to',
        'this request. Look at them: a defect of the layout is a picture, and the picture says',
        'more about it than the text does.',
        '',
        ...(again
            ? ['The last repair did not close the defect: the file on the disk is still broken.',
                'Read it again and make the change that is asked for — not the same change again.']
            : []),
        ...(again ? [''] : []),
        `The files of the step: ${files.join(', ') || 'not named'}.`,
        '',
        'The class names are a contract with the styles: a class that the styles describe keeps',
        'its name, and a class may not be renamed or dropped while the rules still describe the',
        'old name. If a name has to change, the styles have to change with it — that is the work',
        'of the role that owns them.',
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
 *   env?: object, again?: boolean, runContext?: object|null }} request
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
    runContext = null,
    parts = [],
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
            runContext,
            stage: 'repair',
            // The role that repairs the styles sees the page and the reference: a defect of
            // the layout is a picture, not a line of text.
            parts: LOOKS_AT_DESIGN.has(group.role) ? parts : [],
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
 * Снимок разметки проекта: какими именами разметка называет свои части.
 *
 * Снимок снимается до ремонта и после: разница между двумя снимками — это то, что ремонт
 * сделал с именами.
 * @param {string} root
 * @param {object|null} [plan]
 * @returns {Promise<{ classes: string[], markup: string[], styles: string[], check: object }>}
 * @exports
 * @ai.hint io
 */
export async function markupSnapshot(root = process.cwd(), plan = null) {
    const files = await projectFiles(root, plan);
    const check = await checkMarkupStyles({ root, markup: files.markup, styles: files.styles });
    return { classes: check.used, markup: files.markup, styles: files.styles, check };
}

/**
 * Замечания о том, что разметка и стили разошлись.
 *
 * Ремонт переписывает разметку целиком и может переименовать классы: правила остаются от
 * прежней разметки, и страница остаётся без оформления. Поэтому сравниваются имена до
 * ремонта и после: класс, который исчез из разметки, но остался в стилях, — это
 * переименование, и чинить его должна разметка, а не стили.
 *
 * @param {{ root?: string, before?: string[], current?: string[], markup?: string[],
 *   styles?: string[] }} request
 * @returns {Promise<object[]>}
 * @exports
 * @ai.hint io
 */
export async function stylePairIssues({
    root = process.cwd(),
    before = [],
    current = [],
    markup = [],
    styles = [],
} = {}) {
    if (!markup.length || !styles.length) return [];
    const check = await checkMarkupStyles({ root, markup, styles });
    const lost = renamedClasses(before, current, check.styled);
    const beforeSet = new Set(before);
    const gained = current.filter((name) => !beforeSet.has(name));
    if (lost.length && gained.length) {
        return [{
            severity: 'high',
            path: markup[0],
            message: `Ремонт переименовал классы разметки: ${lost.join(', ')} — в стилях для них есть`
                + ` правила, а в разметке их больше нет. Новые имена (${gained.join(', ')}) не имеют`
                + ' ни одного правила, и элементы с ними остались без оформления.',
            requestedChange: `Верни прежние имена классов (${lost.join(', ')}): стили описывают именно`
                + ' их. Не переименовывай классы в ремонте — правила стилей им соответствуют.',
        }];
    }
    if (check.orphans.length) {
        const target = styles.find((file) => !path.basename(file).startsWith('_')) ?? styles[0];
        return [{
            severity: 'medium',
            path: target,
            message: `В разметке есть классы, для которых в стилях нет ни одного правила:`
                + ` ${check.orphans.join(', ')}. Элементы с ними остаются без оформления.`,
            requestedChange: `Добавь правила для этих классов в ${target}: ${check.orphans.join(', ')}.`,
        }];
    }
    return [];
}

/**
 * The stage of the review.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, reports?: object[], screenshots?: string[],
 *   logs?: string, runId?: string|null, notify?: (event: object) => void, env?: object,
 *   runContext?: object|null }} request
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
    logs = '',
    runId: id = null,
    notify = () => {},
    env = process.env,
    runContext = null,
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
    // The words of the page: the console of the browser and the log of the bundler. The
    // reviewer judges the page as it is, and the page says what is wrong with it.
    const pageLog = String(logs ?? '').trim();
    const reviews = [];

    // The comparison of the page with the reference: the numbers say how far the page is,
    // the picture of the difference says where. The last screenshot is the page as it is
    // now, so it is the one that is compared.
    const comparison = await compareReview({
        root,
        config,
        env,
        reference: reference.names[0] ?? null,
        shot: shots.names[shots.names.length - 1] ?? null,
        warnings,
    });
    if (comparison?.ok) {
        // The run shows the comparison of the review too.
        notify({
            type: 'stage.compare',
            stage: 'review',
            reference: comparison.reference?.path ?? null,
            dpr: comparison.design?.dpr ?? null,
            designWidth: comparison.design?.width ?? null,
            designHeight: comparison.design?.height ?? null,
            similarity: comparison.similarity ?? null,
            rmse: comparison.metrics?.rmse ?? null,
            ssim: comparison.metrics?.ssim ?? null,
            difference: comparison.difference?.rel ?? null,
        });
    }
    const comparisonParts = comparison?.difference?.rel
        ? [await picturePart(root, comparison.difference.rel)].filter(Boolean)
        : [];
    const comparisonWords = comparisonNote(comparison);

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
        if (pageLog) {
            blocks.push([
                '## What the page says about itself',
                'The console of the browser and the log of the bundler. They name the cause of',
                'what the screenshot shows.',
                pageLog,
            ].join('\n'));
        }
        if (comparisonWords) blocks.push(comparisonWords);

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
                referenceSizes: reference.sizes,
                design: Boolean(inputs),
            },
            root,
            env,
            maxTurns: config?.stages?.review?.maxTurns ?? null,
            notify,
            parts: [...reference.parts, ...shots.parts, ...comparisonParts],
            runContext,
            stage: 'review',
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
        // The answer that does not fit the schema is kept, but it is reported.
        for (const problem of result.schemaProblems ?? []) {
            warnings.push(`Шаг ${step.id}: ответ ревьюера не по схеме — ${problem}.`);
        }
        return review;
    };

    for (const step of steps) reviews.push(await reviewOne(step));

    // The findings of the first pass go to the disk before the repair starts: a repair that
    // runs out of time must not take the findings with it.
    // The findings of the harness itself: the markup and the styles that do not match.
    const pairing = [];
    const snapshot = (repair) => {
        const issues = [...reviews.flatMap((review) => review.issues), ...pairing];
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
    // The markup and the styles have to speak the same language. The check is the harness's
    // own: the reviewer judges the step by its criteria and does not see that a class of the
    // markup has no rule. The check sees the names, and the repair fixes what it found.
    const checkStyles = config?.stages?.review?.checkStyles !== false;
    let current = null;
    let before = [];
    if (wanted && checkStyles) {
        current = await markupSnapshot(root, plan);
        before = current.classes;
    }
    if (wanted) {
        for (let round = 0; round < rounds; round++) {
            const found = reviews.flatMap((review) => review.issues);
            const issues = [...found];
            if (current) {
                const pair = await stylePairIssues({
                    root,
                    before,
                    current: current.classes,
                    markup: current.markup,
                    styles: current.styles,
                });
                issues.push(...pair);
                for (const issue of pair) {
                    if (!pairing.some((item) => item.path === issue.path && item.message === issue.message)) {
                        pairing.push(issue);
                    }
                }
            }
            if (!issues.length) break;
            const repair = await repairIssues({
                client,
                config,
                root,
                task,
                plan,
                architecture,
                issues,
                notify,
                env,
                again: round > 0,
                runContext,
                // The role that repairs the styles sees the page and the reference.
                parts: [...shots.parts, ...reference.parts, ...comparisonParts],
            });
            warnings.push(...repair.warnings);
            repairs.push(repair);
            // The steps that were repaired are judged again: the verdict of the run has to
            // say what the project looks like now, not what it looked like before.
            const dirty = new Set(issues
                .map((issue) => issueOwner(plan, issue).step?.id)
                .filter(Boolean));
            if (current) {
                before = current.classes;
                current = await markupSnapshot(root, plan);
            }
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
