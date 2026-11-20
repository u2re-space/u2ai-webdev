/**
 * @file src/stages/scan.js
 * @module stages/scan
 * @purpose The survey of the project before the plan: the scanner reads the project and the
 *          report of the survey becomes the ground the plan stands on.
 *
 *   The stage runs right after the collection of the inputs and before the plan: the planner
 *   gets a project that has been read, not a project it has to guess. The report is written to
 *   the directory of the run and goes into the context of the run, so the plan and the
 *   architecture read the same survey.
 *
 * @depends roles/index, inputs/index, stages/workspace
 * @usedBy stages/index, stages/plan, stages/architect, pipeline
 * @exports SCAN_FILE, normalizeScan, scanText, writeScan, readScan, scanStage
 * @ai.tags stages, scan, survey
 * @ai.hint io
 * @changed 2026-11-20 Стадия сканирования: проект читается до плана.
 */

import { runRole, roleReason } from '../roles/index.js';
import { inputContext } from '../inputs/index.js';
import { readReferences } from '../inputs/references.js';
import { runId, runFile, writeJsonFile, readJsonFile } from './workspace.js';

/** The name of the file of the survey inside the directory of the run. */
export const SCAN_FILE = 'scan.json';

/**
 * Normalize the survey of the model into the shape the stages read.
 *
 * @param {object} data
 * @returns {{ summary: string, project: string, stack: object, files: object[],
 *   conventions: string[], risks: string[], questions: string[], notes: string, warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function normalizeScan(data = {}) {
    const warnings = [];
    const source = data && typeof data === 'object' ? data : {};
    const rawStack = source.stack && typeof source.stack === 'object' ? source.stack : {};
    const stack = {
        framework: String(rawStack.framework ?? '').trim(),
        markup: String(rawStack.markup ?? '').trim(),
        style: String(rawStack.style ?? '').trim(),
        script: String(rawStack.script ?? '').trim(),
    };

    const files = (Array.isArray(source.files) ? source.files : []).map((file) => {
        const item = file && typeof file === 'object' ? file : {};
        const path = String(item.path ?? '').trim();
        const role = String(item.role ?? 'read').trim().toLowerCase();
        if (!path) warnings.push('Файл без пути пропущен.');
        if (!['edit', 'read', 'keep'].includes(role)) {
            warnings.push(`Файл ${path || 'без пути'}: роль "${role}" неизвестна, взята "read".`);
        }
        return {
            path,
            role: ['edit', 'read', 'keep'].includes(role) ? role : 'read',
            reason: String(item.reason ?? '').trim(),
        };
    }).filter((file) => file.path);

    const list = (value) => (Array.isArray(value) ? value : [])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean);

    return {
        summary: String(source.summary ?? '').trim(),
        project: String(source.project ?? '').trim(),
        stack,
        files,
        conventions: list(source.conventions),
        risks: list(source.risks),
        questions: list(source.questions),
        notes: String(source.notes ?? '').trim(),
        warnings,
    };
}

/**
 * The survey as the text the plan and the architecture read.
 * @param {object} scan
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function scanText(scan = {}) {
    const out = ['# The survey of the project'];
    if (scan.summary) out.push(scan.summary, '');
    if (scan.project) out.push(`## The project\n${scan.project}`, '');

    const stack = scan.stack ?? {};
    const stackLines = Object.entries(stack)
        .filter(([, value]) => String(value ?? '').trim())
        .map(([key, value]) => `- ${key}: ${value}`);
    if (stackLines.length) out.push('## The stack on the disk', ...stackLines, '');

    if (scan.files?.length) {
        out.push('## The files that matter');
        for (const file of scan.files) {
            out.push(`- ${file.path} (${file.role}) — ${file.reason || 'why it matters is not said'}`);
        }
        out.push('');
    }
    if (scan.conventions?.length) {
        out.push('## The conventions of the project');
        for (const item of scan.conventions) out.push(`- ${item}`);
        out.push('');
    }
    if (scan.risks?.length) {
        out.push('## The risks');
        for (const item of scan.risks) out.push(`- ${item}`);
        out.push('');
    }
    if (scan.questions?.length) {
        out.push('## The questions');
        for (const item of scan.questions) out.push(`- ${item}`);
        out.push('');
    }
    if (scan.notes) out.push('## The notes', scan.notes, '');
    return out.join('\n').trim();
}

/**
 * The path of the file of the survey.
 * @param {string} root
 * @param {object} config
 * @param {string|null} id
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function scanPath(root, config = {}, id = null) {
    return runFile(root, config, id, SCAN_FILE);
}

/**
 * Write the survey of the run.
 * @param {string} root
 * @param {object} config
 * @param {string|null} id
 * @param {object} scan
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function writeScan(root, config = {}, id = null, scan = {}) {
    return await writeJsonFile(scanPath(root, config, id), scan);
}

/**
 * Read the survey of the run. A missing survey gives null.
 * @param {string} root
 * @param {object} config
 * @param {string|null} id
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readScan(root, config = {}, id = null) {
    return await readJsonFile(scanPath(root, config, id));
}

/**
 * The stage of the survey: the scanner reads the project before the plan.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, inputs?: object|null,
 *   runId?: string|null, notify?: (event: object) => void, env?: object, runContext?: object|null,
 *   input?: object|null }} request
 * @returns {Promise<{ stage: string, ok: boolean, scan: object|null, file: string|null,
 *   text: string, warnings: string[], turns: number, usage: object|null, runId: string }>}
 * @exports
 * @ai.hint io
 */
export async function scanStage({
    client,
    config = {},
    root = process.cwd(),
    task = '',
    inputs = null,
    runId: id = null,
    notify = () => {},
    env = process.env,
    runContext = null,
    input = null,
} = {}) {
    if (!client?.responses) throw new Error('Клиент API не передан.');

    const run = id ?? runId();
    const context = inputs ? inputContext(inputs) : '';
    const prompt = [String(task ?? '').trim(), context].filter(Boolean).join('\n\n');
    const reference = await readReferences(root, inputs?.references ?? []);
    const stack = config?.stack ?? {};

    const result = await runRole({
        client,
        config,
        role: 'scanner',
        input: prompt,
        parts: reference.parts,
        context: {
            task: String(task ?? ''),
            kind: config?.agent?.kind ?? null,
            stack,
            design: Boolean(context),
            project: root,
            reference: reference.names,
            referenceSizes: reference.sizes,
        },
        root,
        env,
        maxTurns: config?.stages?.scan?.maxTurns ?? null,
        notify,
        runContext,
        stage: 'scan',
        inputChannel: input,
    });

    if (!result.data) {
        return {
            stage: 'scan',
            ok: false,
            scan: null,
            file: null,
            text: result.text ?? '',
            warnings: [`Сканер не вернул отчёт (${roleReason(result)}).`],
            turns: result.turns,
            usage: result.usage,
            runId: run,
        };
    }

    const scan = normalizeScan(result.data);
    const warnings = [...scan.warnings];
    for (const problem of result.schemaProblems ?? []) {
        warnings.push(`Отчёт не по схеме: ${problem}.`);
    }
    const file = await writeScan(root, config, run, scan);
    // The survey goes into the context of the run — in a compact form, so the brief of every
    // role keeps room for what the run does. The plan and the architecture read the full
    // report from the disk.
    const files = scan.files.map((item) => `${item.path} (${item.role})`).join(', ');
    const compact = [scan.summary, files ? `The files that matter: ${files}.` : '']
        .filter(Boolean)
        .join('\n\n');
    await runContext?.set?.('the survey of the project', compact);
    return {
        stage: 'scan',
        ok: true,
        scan,
        file,
        text: scanText(scan),
        warnings,
        turns: result.turns,
        usage: result.usage,
        runId: run,
    };
}
