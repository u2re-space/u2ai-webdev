/**
 * @file src/stages/step.js
 * @module stages/step
 * @purpose The common part of the stages that work on one step of the plan.
 *
 *   The stages `markup`, `coding` and `styling` do the same thing with a different role: they
 *   take the steps of the plan that belong to the role, give the role the step, the brief of
 *   the architect and the collected context, and then apply what the role wrote.
 *
 *   The files of the answer are written by the code, not only reported: a role that says what
 *   it wrote but writes nothing leaves the project as it was.
 *
 * @depends node:path, node:fs/promises, roles/index, agent/fs-tools, agent/syntax,
 *          inputs/index, stages/workspace
 * @usedBy stages/markup, stages/coding, stages/styling
 * @exports STEPS_DIR, stepsForRole, applyFiles, stepReportPath, writeStepReport,
 *          readStepReport, missingFiles, runStepStage
 * @ai.tags stages, steps, files
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the steps of the plan drive the stages.
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';
import { runRole, roleReason, syntaxCorrection } from '../roles/index.js';
import { writeTextFile } from '../agent/fs-tools.js';
import { checkFiles } from '../agent/syntax.js';
import { inputContext } from '../inputs/index.js';
import { runId, runFile, writeJsonFile, readJsonFile } from './workspace.js';

/** The directory inside the run that holds the reports of the steps. */
export const STEPS_DIR = 'steps';

/**
 * The steps of the plan that belong to a role.
 * @param {object} plan
 * @param {string} role
 * @returns {object[]}
 * @exports
 * @ai.hint pure
 */
export function stepsForRole(plan, role) {
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    const wanted = String(role ?? '').trim().toLowerCase();
    if (!wanted) return [];
    return steps.filter((step) => String(step?.role ?? '').trim().toLowerCase() === wanted);
}

/**
 * Write the files of an answer of a role.
 *
 * A file that is already there is not overwritten: the role may have written it with its own
 * tool, and the file on the disk is the truth.
 * @param {{ root: string, files?: object[], overwrite?: boolean, maxWriteBytes?: number,
 *   skip?: string[] }} request
 * @returns {Promise<{ written: string[], skipped: string[], warnings: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function applyFiles({
    root,
    files = [],
    overwrite = false,
    maxWriteBytes = 4 * 1024 * 1024,
    skip = ['package.json'],
} = {}) {
    const written = [];
    const skipped = [];
    const warnings = [];
    for (const item of Array.isArray(files) ? files : []) {
        const rel = String(item?.path ?? '').trim();
        const content = typeof item?.content === 'string' ? item.content : null;
        if (!rel || content === null) {
            warnings.push('Файл без пути или содержимого пропущен.');
            continue;
        }
        if (skip.includes(path.basename(rel))) {
            skipped.push(rel);
            continue;
        }
        try {
            const result = await writeTextFile({
                root,
                file: rel,
                content,
                overwrite,
                maxBytes: maxWriteBytes,
                backupSlot: 'step',
            });
            written.push(result.rel);
        } catch (error) {
            const message = error?.message ?? String(error);
            if (/уже существует/i.test(message)) {
                skipped.push(rel);
                continue;
            }
            warnings.push(`Файл ${rel} не записан: ${message}`);
        }
    }
    return { written, skipped, warnings };
}

/**
 * The path of the report of a step.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @param {string} stepId
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function stepReportPath(root, config = {}, id = null, stepId = 'step') {
    return runFile(root, config, id, path.join(STEPS_DIR, `${stepId}.json`));
}

/**
 * Write the report of a step.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @param {string} stepId
 * @param {object} report
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function writeStepReport(root, config = {}, id = null, stepId = 'step', report = {}) {
    return await writeJsonFile(stepReportPath(root, config, id, stepId), report);
}

/**
 * Read the report of a step. A missing file gives null.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @param {string} stepId
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readStepReport(root, config = {}, id = null, stepId = 'step') {
    return await readJsonFile(stepReportPath(root, config, id, stepId));
}

/**
 * The files of a step that are not on the disk.
 *
 * A step names the files it touches. A file that is missing after the role has answered means
 * that the work was not done, and the stage says so instead of calling the step done.
 * @param {string} root
 * @param {string[]} files
 * @returns {Promise<string[]>}
 * @exports
 * @ai.hint io
 */
export async function missingFiles(root, files = []) {
    const missing = [];
    for (const rel of Array.isArray(files) ? files : []) {
        const name = String(rel ?? '').trim();
        if (!name) continue;
        const found = await stat(path.join(root, name)).then((info) => info.isFile()).catch(() => false);
        if (!found) missing.push(name);
    }
    return missing;
}

/**
 * Run one role over the steps of the plan that belong to it.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, role: string,
 *   plan?: object|null, brief?: string, inputs?: object|null, runId?: string|null,
 *   overwrite?: boolean, apply?: boolean, context?: object, notify?: (event: object) => void,
 *   env?: object }} request
 * @returns {Promise<{ stage: string, ok: boolean, skipped: boolean, steps: object[],
 *   warnings: string[], turns: number, usage: object|null, runId: string }>}
 * @exports
 * @ai.hint io
 */
export async function runStepStage({
    client,
    config = {},
    root = process.cwd(),
    task = '',
    role,
    plan = null,
    brief = '',
    inputs = null,
    runId: id = null,
    overwrite = false,
    apply = true,
    context: extra = {},
    notify = () => {},
    env = process.env,
} = {}) {
    if (!client?.responses) throw new Error('Клиент API не передан.');
    const run = id ?? runId();
    const steps = stepsForRole(plan, role);
    const warnings = [];

    if (!steps.length) {
        // The plan is the work: a stage whose role has no step has nothing to do. It is
        // skipped and reported, but the run goes on — the rest of the stages still work.
        return {
            stage: role,
            ok: true,
            skipped: true,
            steps: [],
            warnings: [`В плане нет шага для роли ${role}.`],
            turns: 0,
            usage: null,
            runId: run,
        };
    }

    const design = inputs ? inputContext(inputs) : '';
    const reports = [];
    let turns = 0;
    let usage = null;

    for (const step of steps) {
        const blocks = [];
        if (task) blocks.push(String(task).trim());
        blocks.push([
            `## The step ${step.id}`,
            `- title: ${step.title}`,
            `- role: ${step.role}`,
            step.files?.length ? `- files: ${step.files.join(', ')}` : '- files: not named',
            step.criteria?.length ? `- criteria: ${step.criteria.join('; ')}` : '- criteria: not named',
        ].join('\n'));
        if (brief) blocks.push(brief);
        if (design) blocks.push(design);

        const result = await runRole({
            client,
            config,
            role,
            input: blocks.join('\n\n'),
            context: {
                task: String(task ?? ''),
                step,
                brief,
                design: Boolean(design),
                ...extra,
            },
            root,
            env,
            maxTurns: config?.stages?.[role]?.maxTurns ?? null,
            requireFiles: Boolean(step.files?.length),
            notify,
        });
        turns += result.turns;
        usage = usage ?? result.usage;

        const data = result.data ?? {};
        const files = Array.isArray(data.files) ? data.files : [];
        let applied = { written: [], skipped: [], warnings: [] };
        if (apply) {
            applied = await applyFiles({ root, files, overwrite });
            warnings.push(...applied.warnings);
        }

        // The files of the step have to compile. The compiler of the platform sees the lost
        // quote and the stray backslash that the reader of the code does not see.
        let syntax = await checkFiles(root, step.files ?? [], { env });
        let answer = result;
        let repair = null;
        if (syntax.errors.length) {
            // The role is told what the compiler said and has to fix the files.
            repair = await runRole({
                client,
                config,
                role,
                input: `${blocks.join('\n\n')}\n\n${syntaxCorrection(syntax.errors)}`,
                context: {
                    task: String(task ?? ''),
                    step,
                    brief,
                    design: Boolean(design),
                    ...extra,
                },
                root,
                env,
                maxTurns: config?.stages?.[role]?.maxTurns ?? null,
                requireFiles: Boolean(step.files?.length),
                notify,
            });
            turns += repair.turns;
            usage = usage ?? repair.usage;
            if (repair.data) answer = repair;
            const broken = new Set(syntax.errors.map((item) => item.file));
            const repaired = (Array.isArray(repair.data?.files) ? repair.data.files : [])
                .filter((file) => broken.has(String(file?.path ?? '').trim()));
            if (apply && repaired.length) {
                const written = await applyFiles({ root, files: repaired, overwrite: true });
                warnings.push(...written.warnings);
                applied = {
                    written: [...applied.written, ...written.written],
                    skipped: applied.skipped,
                    warnings: applied.warnings,
                };
            }
            syntax = await checkFiles(root, step.files ?? [], { env });
        }
        for (const note of syntax.notes) warnings.push(`Шаг ${step.id}: ${note}`);
        for (const error of syntax.errors) {
            warnings.push(`Шаг ${step.id}: ошибка синтаксиса в ${error.file}: ${error.message}`);
        }

        // The step is done when its files are on the disk: an answer without them is a
        // description of the work, not the work.
        const missing = await missingFiles(root, step.files ?? []);
        const ok = Boolean(answer.data) && !missing.length && !syntax.errors.length;
        if (missing.length) {
            warnings.push(`Шаг ${step.id}: файлы не написаны: ${missing.join(', ')}.`);
        }

        const report = {
            stage: role,
            step: { id: step.id, title: step.title, files: step.files, criteria: step.criteria },
            ok,
            summary: String(answer.data?.summary ?? answer.text ?? '').trim(),
            files: Array.isArray(answer.data?.files) ? answer.data.files : files,
            commands: Array.isArray(answer.data?.commands) ? answer.data.commands : [],
            notes: String(answer.data?.notes ?? '').trim(),
            landmarks: Array.isArray(answer.data?.landmarks) ? answer.data.landmarks : [],
            accessibility: Array.isArray(answer.data?.accessibility) ? answer.data.accessibility : [],
            tokens: Array.isArray(answer.data?.tokens) ? answer.data.tokens : [],
            set: String(answer.data?.set ?? '').trim(),
            icons: Array.isArray(answer.data?.icons) ? answer.data.icons : [],
            applied: {
                written: applied.written,
                skipped: applied.skipped,
            },
            syntax: { checked: syntax.checked, errors: syntax.errors },
            turns: result.turns + (repair?.turns ?? 0),
            stopped: answer.stopped,
        };
        if (!answer.data) {
            warnings.push(`Шаг ${step.id}: роль ${role} не вернула ответ (${roleReason(answer)}).`);
        }
        await writeStepReport(root, config, run, step.id, report);
        reports.push(report);
    }

    return {
        stage: role,
        ok: reports.every((report) => report.ok),
        skipped: false,
        steps: reports,
        warnings,
        turns,
        usage,
        runId: run,
    };
}
