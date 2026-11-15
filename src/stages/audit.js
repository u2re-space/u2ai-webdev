/**
 * @file src/stages/audit.js
 * @module stages/audit
 * @purpose The audit of the whole project: the structure, the accessibility, the performance
 *          and the dependencies.
 *
 *   The audit is not a step of the plan: it looks at the project as it is, from the outside.
 *   The auditor may run the build and says what it printed; the verdict is not softened.
 *
 *   The auditor sees the project that is on the disk, and not the story of the run: the list
 *   of the files is read fresh, the report of the build is given to it, and the design of the
 *   task comes as the text it is, not as a flag. An auditor that sees nothing but the task
 *   describes a project that does not exist and calls it a verdict.
 *
 * @depends roles/index, model/profiles, stages/architect, stages/build, stages/workspace,
 *          agent/fs-tools, inputs/index
 * @usedBy stages/index, pipeline
 * @exports AUDIT_FILE, AUDIT_CORRECTION, writeAudit, readAudit, auditListing, buildReport,
 *          auditContext, auditStage
 * @ai.tags stages, audit
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: аудит проекта целиком.
 * @changed 2026-11-15 Аудитор видит проект: свежий список файлов, отчёт сборки и текст
 *                 дизайна вместо флага «дизайн есть».
 */

import { runRole, resolveRole } from '../roles/index.js';
import { getModelProfile } from '../model/profiles.js';
import { architectureText } from './architect.js';
import { readBuild } from './build.js';
import { listFiles } from '../agent/fs-tools.js';
import { inputContext } from '../inputs/index.js';
import { runId, runFile, writeJsonFile, readJsonFile } from './workspace.js';

/** The name of the file of the audit inside the directory of the run. */
export const AUDIT_FILE = 'audit.json';

/** How deep the listing of the project goes. */
export const AUDIT_LIST_DEPTH = 4;

/** How many entries the listing of the project holds. */
export const AUDIT_LIST_MAX = 400;

/**
 * The correction of an auditor that answered without looking at the project.
 *
 * The auditor that called no tool has described the project from the task: it has seen no
 * file, no command and no picture. It is told to work first and to answer second.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const AUDIT_CORRECTION = [
    'You have not looked at the project: you called no tool, read no file and ran no command,',
    'and the report was written from the task alone.',
    'Work first, answer second: list the files with `list_files`, read the ones that matter',
    'with `read_file`, and run the build of the project with `run_command` (`npm run build`).',
    'Report what the build printed, and name only the files that exist — the listing of the',
    'project is in the task context, and a file that is not in it does not exist.',
    'Then submit the report with the tool `review`: the verdict, the scores, the issues with',
    'their paths, the summary and the recommendations.',
].join('\n');

/**
 * The path of the audit of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function auditPath(root, config = {}, id = null) {
    return runFile(root, config, id, AUDIT_FILE);
}

/**
 * Write the audit of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @param {object} audit
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function writeAudit(root, config = {}, id = null, audit = {}) {
    return await writeJsonFile(auditPath(root, config, id), audit);
}

/**
 * Read the audit of a run. A missing file gives null.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readAudit(root, config = {}, id = null) {
    return await readJsonFile(auditPath(root, config, id));
}

/**
 * The listing of the project as it is on the disk right now.
 *
 * The listing is read here and not taken from the map of the run: the map knows the files
 * that the roles wrote, and the files that a person put into the project before the run
 * belong to the audit as much as the others.
 * @param {string} root
 * @param {{ depth?: number, maxEntries?: number }} [options]
 * @returns {Promise<{ text: string, count: number, truncated: boolean }>}
 * @exports
 * @ai.hint io
 */
export async function auditListing(root, { depth = AUDIT_LIST_DEPTH, maxEntries = AUDIT_LIST_MAX } = {}) {
    try {
        return await listFiles({ root, dir: '.', depth, includeHidden: false, maxEntries });
    } catch (error) {
        return {
            text: `The project could not be listed: ${error?.message ?? error}`,
            count: 0,
            truncated: false,
        };
    }
}

/**
 * The report of the build as text.
 *
 * The report of the stage of the build says what the styles are, where the markup is, what
 * the markup links to and what the compiler said. It is the truth about the wiring of the
 * project, and it is the same truth that the auditor would find by running the build again.
 * @param {object|null} build
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function buildReport(build = null) {
    if (!build || typeof build !== 'object') return '';
    const lines = ['# The build of the project'];
    lines.push(`The markup: ${build.markup ?? 'not found'}. The script: ${build.script ?? 'not found'}.`);
    lines.push(`The bundler: ${build.vite ? 'Vite' : 'none'}. The entry point of the styles: ${build.entry ?? 'not found'}.`);
    lines.push(Array.isArray(build.styles) && build.styles.length
        ? `The stylesheets: ${build.styles.join(', ')}.`
        : 'There are no stylesheets in the project.');
    lines.push(Array.isArray(build.links) && build.links.length
        ? `The markup links: ${build.links.join(', ')}.`
        : 'The markup links no stylesheet.');

    const errors = Array.isArray(build.errors) ? build.errors : [];
    if (errors.length) {
        lines.push('The build of the styles failed:');
        for (const error of errors) {
            lines.push(`- ${error?.file ?? 'a file'}: ${error?.message ?? 'an error'}`);
        }
    } else {
        lines.push('The styles are compiled: the build of the styles passed.');
    }

    const missing = Array.isArray(build.missing) ? build.missing : [];
    if (missing.length) {
        lines.push('The markup links to files that are not on the disk:');
        for (const item of missing) lines.push(`- ${item}`);
    }
    return lines.join('\n');
}

/**
 * The context of the audit: what the auditor sees of the project.
 * @param {{ listing?: object|null, build?: object|null, design?: string }} [options]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function auditContext({ listing = null, build = null, design = '' } = {}) {
    const blocks = [];
    if (listing?.text) {
        blocks.push([
            '# The project on the disk',
            'This is the fresh listing of the project: every path below is on the disk, and',
            'nothing outside of it is. Judge the project by this list and not by the story of',
            'the run.',
            listing.text,
        ].join('\n'));
    }
    const report = buildReport(build);
    if (report) blocks.push(report);
    const text = String(design ?? '').trim();
    if (text) blocks.push(`# The design of the task\n${text}`);
    return blocks.join('\n\n');
}

/**
 * The stage of the audit.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, build?: object|null, runId?: string|null,
 *   notify?: (event: object) => void, env?: object }} request
 * @returns {Promise<{ stage: string, ok: boolean, verdict: string, audit: object|null,
 *   issues: object[], file: string|null, warnings: string[], runId: string }>}
 * @exports
 * @ai.hint io
 */
export async function auditStage({
    client,
    config = {},
    root = process.cwd(),
    task = '',
    plan = null,
    architecture = null,
    inputs = null,
    build = null,
    runId: id = null,
    notify = () => {},
    env = process.env,
    runContext = null,
} = {}) {
    if (!client?.responses) throw new Error('Клиент API не передан.');
    const run = id ?? runId();
    const brief = architecture ? architectureText(architecture) : '';
    // The design of the task comes as the text it is: a flag tells the auditor nothing about
    // the measurements, the palette and the tokens that the result is measured against.
    const design = inputs ? inputContext(inputs) : '';

    const blocks = [];
    // The task is already inside the дизайна: it is not repeated.
    if (task && !String(inputs?.task ?? '').trim()) blocks.push(String(task).trim());
    if (plan?.steps?.length) {
        blocks.push(`The plan of the work:\n${plan.steps.map((step) => `- ${step.id}: ${step.title}`).join('\n')}`);
    }
    if (brief) blocks.push(brief);

    // The project as it is: the files of the disk, the report of the build and the design.
    const listing = await auditListing(root);
    const report = build ?? await readBuild(root, config, run);
    blocks.push(auditContext({ listing, build: report, design }));
    const prompt = blocks.filter(Boolean).join('\n\n');

    const request = {
        client,
        config,
        role: 'auditor',
        input: prompt,
        context: {
            task: String(task ?? ''),
            project: root,
            stack: config?.stack ?? {},
            design,
        },
        root,
        env,
        maxTurns: config?.stages?.audit?.maxTurns ?? null,
        notify,
        runContext,
        stage: 'audit',
    };

    let result = await runRole(request);
    const warnings = [];

    // Аудитор, который не вызвал ни одного инструмента, проект не видел: он описал его по
    // задаче. Модель, которая умеет вызывать инструменты, спрашивается ещё раз, и на этот
    // раз схема едет в канале инструментов: модель может поработать перед ответом. Модель,
    // прибитая к JSON-ответу, инструменты не вызывает вовсе — для неё правда лежит в
    // контексте, и повторный вопрос стоит turn и ничего не меняет.
    if (!result.toolCalls?.length) {
        const model = resolveRole('auditor', config)?.model ?? null;
        const channel = model ? getModelProfile(model, config).schemaChannel : 'auto';
        if (channel !== 'format') {
            const retry = await runRole({
                ...request,
                input: `${prompt}\n\n${AUDIT_CORRECTION}`,
                schemaChannel: 'tool',
            });
            if (retry.data) {
                result = retry;
                warnings.push('Аудитор ответил, не прочитав проект, и был спрошен ещё раз.');
            }
        } else {
            warnings.push('Модель аудитора не вызывает инструменты: отчёт построен на том, что прочитал сам этап (файлы, сборка, дизайн).');
        }
    }

    const data = result.data ?? {};
    if (!result.data) warnings.push('Аудитор не вернул ответ.');

    const audit = {
        ok: Boolean(result.data),
        verdict: String(data.verdict ?? 'partial').trim().toLowerCase(),
        scores: data.scores ?? null,
        issues: Array.isArray(data.issues) ? data.issues : [],
        summary: String(data.summary ?? result.text ?? '').trim(),
        recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
        // Что аудитор видел на самом деле: сколько файлов было в списке, сколько вызовов
        // инструментов он сделал и какая модель отвечала.
        seen: {
            files: listing.count,
            tools: Array.isArray(result.toolCalls) ? result.toolCalls.length : 0,
            turns: result.turns ?? 0,
            model: result.model ?? null,
        },
    };
    const file = await writeAudit(root, config, run, audit);

    return {
        stage: 'audit',
        ok: Boolean(result.data) && audit.verdict !== 'fail',
        verdict: audit.verdict,
        audit,
        issues: audit.issues,
        file,
        warnings,
        runId: run,
    };
}
