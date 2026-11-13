/**
 * @file src/agent/work-plan.js
 * @module agent/work-plan
 * @purpose The plan of the work, the progress of the run on the disk and the resume point.
 *
 *   The plan says what has to be done; the progress says what is already done. The two
 *   live in the directory of the run: `plan.json` and `progress.json`. A run that was
 *   interrupted is read back from there and continues at the first stage that is not
 *   finished — nothing is guessed and nothing is done twice.
 *
 *   The plan may change while the run goes: a stage may add a step or revise one. The
 *   update is applied to the pending steps only, so the work that is already done stays
 *   done.
 *
 * @depends node:path, node:fs/promises, stages/workspace
 * @usedBy stages/index, pipeline, jobs/manager
 * @exports PROGRESS_FILE, progressPath, writeProgress, readProgress, createProgress,
 *          syncProgress, recordStep, applyFromStep, applyPlanUpdate, parsePlanUpdate,
 *          resolveResumeStep, briefProgress, isOpenProgress
 * @ai.tags plan, progress, resume
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: прогресс пишется рядом с планом прогона.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { runFile, writeJsonFile, readJsonFile } from '../stages/workspace.js';

/** The name of the file of the progress inside the directory of the run. */
export const PROGRESS_FILE = 'progress.json';

/**
 * The path of the progress of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function progressPath(root, config = {}, id = null) {
    return runFile(root, config, id, PROGRESS_FILE);
}

/**
 * Write the progress of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @param {object} progress
 * @returns {Promise<string>} the path of the file
 * @exports
 * @ai.hint io
 */
export async function writeProgress(root, config = {}, id = null, progress = {}) {
    const next = { ...progress, updatedAt: new Date().toISOString() };
    return await writeJsonFile(progressPath(root, config, id), next);
}

/**
 * Read the progress of a run. A missing file gives null.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readProgress(root, config = {}, id = null) {
    return await readJsonFile(progressPath(root, config, id));
}

/**
 * The empty progress of a run that has not started.
 * @param {{ id?: string, task?: string, stages?: object[] }} input
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function createProgress({ id = null, task = '', stages = [] } = {}) {
    return {
        id,
        task: String(task ?? ''),
        status: 'running',
        stage: null,
        cursor: 0,
        stages: (Array.isArray(stages) ? stages : []).map((stage, index) => ({
            name: String(stage?.name ?? ''),
            index: index + 1,
            status: 'pending',
            report: '',
            files: [],
        })),
        files: [],
        notes: [],
        updatedAt: new Date().toISOString(),
    };
}

/**
 * Keep the records of the stages that are done when the list of the stages changes.
 * @param {object} progress
 * @param {object[]} stages
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function syncProgress(progress, stages = []) {
    const previous = new Map((progress?.stages ?? []).map((stage) => [stage.name, stage]));
    const list = (Array.isArray(stages) ? stages : []).map((stage, index) => {
        const old = previous.get(String(stage?.name ?? ''));
        if (old) return { ...old, index: index + 1 };
        return {
            name: String(stage?.name ?? ''),
            index: index + 1,
            status: 'pending',
            report: '',
            files: [],
        };
    });
    return { ...progress, stages: list };
}

/**
 * Store the outcome of a stage.
 *
 * A stage that is done moves the cursor; any other status leaves the cursor on that
 * stage, so the run continues there.
 * @param {object} progress
 * @param {{ stage: string, status?: string, report?: string, files?: string[] }} outcome
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function recordStep(progress, { stage, status = 'completed', report = '', files = [] } = {}) {
    const name = String(stage ?? '').trim();
    const list = (progress?.stages ?? []).map((item) => {
        if (item.name !== name) return item;
        const merged = [...new Set([...(item.files ?? []), ...(files ?? [])])];
        return { ...item, status, report, files: merged };
    });
    const known = new Set((progress?.files ?? []).map((file) => file.path));
    const added = [];
    for (const file of list.find((item) => item.name === name)?.files ?? []) {
        if (!file || known.has(file)) continue;
        known.add(file);
        added.push({ path: file, stepId: name });
    }
    const open = list.findIndex((item) => item.status !== 'completed');
    return {
        ...progress,
        stages: list,
        files: [...(progress?.files ?? []), ...added],
        cursor: open < 0 ? list.length : open,
        stage: name,
        status: status === 'completed' ? 'running' : status,
    };
}

/**
 * Open the stages from `index` again. The stages before it stay done.
 * @param {object} progress
 * @param {number} index
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function applyFromStep(progress, index) {
    const list = (progress?.stages ?? []).map((stage, at) => {
        if (at < index) return stage;
        return { ...stage, status: 'pending' };
    });
    return { ...progress, stages: list, cursor: Math.max(0, index) };
}

/**
 * Read a `plan-update` fence out of the report of a stage.
 * @param {string} report
 * @returns {{ note: string, addSteps: object[], revise: object[] }|null}
 * @exports
 * @ai.hint pure
 */
export function parsePlanUpdate(report) {
    const match = /```plan-update\s*\n([\s\S]*?)```/i.exec(String(report ?? ''));
    if (!match) return null;
    let data;
    try {
        data = JSON.parse(match[1]);
    } catch {
        return null;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const addSteps = Array.isArray(data.addSteps) ? data.addSteps.flatMap((step) => {
        if (!step || typeof step.title !== 'string' || !step.title.trim()) return [];
        return [{
            title: step.title.trim(),
            role: typeof step.role === 'string' ? step.role.trim() : '',
            dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.map(String) : [],
            files: Array.isArray(step.files) ? step.files.map(String) : [],
            criteria: Array.isArray(step.criteria) ? step.criteria.map(String) : [],
        }];
    }) : [];

    const revise = Array.isArray(data.revise) ? data.revise.flatMap((step) => {
        if (!step || typeof step.id !== 'string' || !step.id.trim()) return [];
        const item = { id: step.id.trim() };
        if (typeof step.title === 'string') item.title = step.title;
        if (typeof step.role === 'string') item.role = step.role;
        if (Array.isArray(step.files)) item.files = step.files.map(String);
        if (Array.isArray(step.criteria)) item.criteria = step.criteria.map(String);
        return [item];
    }) : [];

    if (!addSteps.length && !revise.length && typeof data.note !== 'string') return null;
    return { note: typeof data.note === 'string' ? data.note : '', addSteps, revise };
}

/**
 * Apply an update to the plan: the pending steps are revised and the new ones are added.
 *
 * A step that is already done is never touched: its result is on the disk.
 * @param {object} plan
 * @param {{ note?: string, addSteps?: object[], revise?: object[] }} update
 * @param {{ maxSteps?: number, afterId?: string|null, done?: string[] }} [options]
 * @returns {{ plan: object, note: string }}
 * @exports
 * @ai.hint pure
 */
export function applyPlanUpdate(plan, update, { maxSteps = 24, afterId = null, done = [] } = {}) {
    const completed = new Set(done);
    const steps = (Array.isArray(plan?.steps) ? plan.steps : []).map((step) => ({ ...step }));
    const warnings = [];

    for (const change of update?.revise ?? []) {
        const step = steps.find((item) => item.id === change.id);
        if (!step) {
            warnings.push(`Шаг "${change.id}" не найден и не изменён.`);
            continue;
        }
        if (completed.has(step.id)) continue;
        if (typeof change.title === 'string' && change.title.trim()) step.title = change.title.trim();
        if (typeof change.role === 'string' && change.role.trim()) step.role = change.role.trim();
        if (Array.isArray(change.files)) step.files = change.files.map(String);
        if (Array.isArray(change.criteria)) step.criteria = change.criteria.map(String);
    }

    const after = afterId ? steps.findIndex((step) => step.id === afterId) : -1;
    let insertAt = after >= 0 ? after + 1 : steps.length;
    const used = new Set(steps.map((step) => step.id));
    let number = steps.length + 1;
    for (const extra of update?.addSteps ?? []) {
        if (steps.length >= maxSteps) {
            warnings.push('Новые шаги не добавлены: предел плана достигнут.');
            break;
        }
        let id = `step-${number}`;
        while (used.has(id)) {
            number += 1;
            id = `step-${number}`;
        }
        used.add(id);
        number += 1;
        steps.splice(insertAt, 0, {
            id,
            title: extra.title,
            role: extra.role || 'planner',
            dependsOn: extra.dependsOn ?? [],
            files: extra.files ?? [],
            criteria: extra.criteria ?? [],
        });
        insertAt += 1;
    }

    const next = { ...plan, steps };
    if (warnings.length) next.warnings = [...(plan?.warnings ?? []), ...warnings];
    return { plan: next, note: update?.note ?? '' };
}

/**
 * The index of the step to continue at.
 *
 * The token is the number of the step (`2`) or its id (`markup-1`).
 * @param {object} plan
 * @param {string|number} token
 * @returns {number} the zero-based index, or -1 when the token names nothing
 * @exports
 * @ai.hint pure
 */
export function resolveResumeStep(plan, token) {
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    const text = String(token ?? '').trim();
    if (!text) return -1;
    const found = steps.findIndex((step) => String(step?.id ?? '').toLowerCase() === text.toLowerCase());
    if (found >= 0) return found;
    const number = Number(text);
    if (Number.isInteger(number) && number >= 1 && number <= steps.length) return number - 1;
    return -1;
}

/**
 * True when the progress may be continued: the run was not finished.
 * @param {object} progress
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function isOpenProgress(progress) {
    if (!progress) return false;
    if (['completed', 'failed', 'cancelled'].includes(progress.status)) return false;
    const stages = Array.isArray(progress.stages) ? progress.stages : [];
    return stages.some((stage) => stage.status !== 'completed');
}

/**
 * The short report of the progress the roles read.
 * @param {object} progress
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function briefProgress(progress) {
    const stages = Array.isArray(progress?.stages) ? progress.stages : [];
    if (!stages.length) return '';
    const lines = stages.map((stage) => `- [${stage.status}] ${stage.name}`);
    const files = (progress?.files ?? []).map((file) => file.path);
    return [
        'The progress of the run:',
        ...lines,
        files.length ? `Files: ${files.join(', ')}` : '',
    ].filter(Boolean).join('\n');
}

/**
 * Read the plan of a run from its directory.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readWorkPlan(root, config = {}, id = null) {
    const file = path.join(path.dirname(progressPath(root, config, id)), 'plan.json');
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}
