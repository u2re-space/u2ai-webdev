/**
 * @file src/stages/audit.js
 * @module stages/audit
 * @purpose The audit of the whole project: the structure, the accessibility, the performance
 *          and the dependencies.
 *
 *   The audit is not a step of the plan: it looks at the project as it is, from the outside.
 *   The auditor may run the build and says what it printed; the verdict is not softened.
 *
 * @depends roles/index, stages/architect, stages/workspace
 * @usedBy stages/index, pipeline
 * @exports AUDIT_FILE, writeAudit, readAudit, auditStage
 * @ai.tags stages, audit
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: аудит проекта целиком.
 */

import { runRole } from '../roles/index.js';
import { architectureText } from './architect.js';
import { runId, runFile, writeJsonFile, readJsonFile } from './workspace.js';

/** The name of the file of the audit inside the directory of the run. */
export const AUDIT_FILE = 'audit.json';

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
 * The stage of the audit.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null,
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
    runId: id = null,
    notify = () => {},
    env = process.env,
} = {}) {
    if (!client?.responses) throw new Error('Клиент API не передан.');
    const run = id ?? runId();
    const brief = architecture ? architectureText(architecture) : '';

    const blocks = [];
    if (task) blocks.push(String(task).trim());
    if (plan?.steps?.length) {
        blocks.push(`The plan of the work:\n${plan.steps.map((step) => `- ${step.id}: ${step.title}`).join('\n')}`);
    }
    if (brief) blocks.push(brief);

    const result = await runRole({
        client,
        config,
        role: 'auditor',
        input: blocks.join('\n\n'),
        context: {
            task: String(task ?? ''),
            project: root,
            stack: config?.stack ?? {},
            design: Boolean(inputs),
        },
        root,
        env,
        maxTurns: config?.stages?.audit?.maxTurns ?? null,
        notify,
    });

    const data = result.data ?? {};
    const warnings = [];
    if (!result.data) warnings.push('Аудитор не вернул ответ.');

    const audit = {
        ok: Boolean(result.data),
        verdict: String(data.verdict ?? 'partial').trim().toLowerCase(),
        scores: data.scores ?? null,
        issues: Array.isArray(data.issues) ? data.issues : [],
        summary: String(data.summary ?? result.text ?? '').trim(),
        recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
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
