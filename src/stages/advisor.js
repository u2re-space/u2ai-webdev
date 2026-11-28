/**
 * @file src/stages/advisor.js
 * @module stages/advisor
 * @purpose The consultation of the senior adviser: the question asked before a step, and the
 *          advice that comes back.
 *
 *   The adviser is the senior model of the house, asked **before** the work of a step. It
 *   reads the project, thinks about the step, and answers: what is worth doing, what is a
 *   trap here, and in what order the work is better done.
 *
 *   The advice is a counsel, not an order. The role that does the step takes what it
 *   wants from it — and the code of the step says so in the request, so the role knows
 *   that the advice is there and that it may disagree with it.
 *
 *   **The advice is cached on the disk of the run.** A continued run must not pay for the
 *   same advice twice: the question of the step and the state of the project have not
 *   changed, so the answer is the same. The cache is keyed by the step and by a hash of
 *   what the adviser saw — and the hash covers the files of the project, so a changed file
 *   invalidates the advice.
 *
 * @depends node:path, node:fs/promises, roles/index, agent/schemas
 * @usedBy stages/step
 * @exports advisorWanted, adviceText, consultAdvisor, advisorAdvicePath, readAdvisorAdvice
 * @ai.tags house, advisor, code-mode
 * @ai.hint io
 * @changed 2026-11-29 Старшая модель стала советником шага: её спрашивают до работы.
 */

import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { runRole, roleReason } from '../roles/index.js';

/** The name of the file of the advice of a step, inside the directory of the steps. */
const ADVICE_DIR = 'advice';

/**
 * The hash of what the adviser saw: the step, the brief and the files of the project.
 *
 * The hash answers one question: would the advice be the same? The files of the project
 * are part of it, because the advice is about the project: a file that changed may change
 * the advice, and an advice that was cached against the old file is stale.
 *
 * @param {object} request
 * @returns {string}
 */
function adviceHash({ step = null, brief = '', task = '', files = [] } = {}) {
    const hash = createHash('sha256');
    hash.update(String(task ?? ''));
    hash.update(String(brief ?? ''));
    hash.update(JSON.stringify({
        id: step?.id ?? '',
        title: step?.title ?? '',
        role: step?.role ?? '',
        files: step?.files ?? [],
        criteria: step?.criteria ?? [],
    }));
    for (const file of files) {
        hash.update(String(file?.rel ?? ''));
        hash.update(String(file?.bytes ?? ''));
        hash.update(String(file?.mtimeMs ?? ''));
    }
    return hash.digest('hex');
}

/**
 * The path of the advice of a step, inside the directory of the run.
 *
 * @param {string} root the working directory of the project
 * @param {object} config the configuration of the run
 * @param {string|null} id the id of the run
 * @param {string} stepId the id of the step
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function advisorAdvicePath(root, config = {}, id = null, stepId = 'step') {
    const run = id ?? config?.run?.id ?? '';
    const rel = config?.paths?.context ?? '.ai/context';
    return path.join(root, String(rel), String(run), ADVICE_DIR, `${String(stepId ?? 'step').replace(/[^\w.-]/g, '_')}.json`);
}

/**
 * The advice of a step, as it was saved.
 *
 * @param {string} root the working directory of the project
 * @param {object} config the configuration of the run
 * @param {string|null} id the id of the run
 * @param {string} stepId the id of the step
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readAdvisorAdvice(root, config = {}, id = null, stepId = 'step') {
    const file = advisorAdvicePath(root, config, id, stepId);
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Should the adviser be asked about this step?
 *
 * The adviser costs a turn of the senior model, and not every step is worth it. The
 * config decides: the stages that are advised, and the steps of those stages that are
 * worth advising.
 *
 * The default is the writing stage: the step that writes the files of the page is the one
 * where a good approach saves the most work. A step of the icons is a cheap decision, and
 * the senior is not asked about it.
 *
 * @param {object} config the configuration of the run
 * @param {{ stage?: string, role?: string, step?: object }} request
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function advisorWanted(config = {}, { stage = '', role = '', step = null } = {}) {
    const section = config?.advisor ?? {};
    if (section.enabled === false) return false;
    const stages = Array.isArray(section.stages) ? section.stages.map((item) => String(item ?? '').trim()) : [];
    if (!stages.length) return false;
    const where = String(stage ?? '').trim();
    if (!stages.includes(where)) return false;
    // The steps that are named: the advice is asked about them and about nothing else.
    // An empty list means every step of the stage.
    const only = Array.isArray(section.steps) ? section.steps.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
    if (!only.length) return true;
    const id = String(step?.id ?? '').trim();
    const title = String(step?.title ?? '').trim();
    const files = (Array.isArray(step?.files) ? step.files : []).map((item) => String(item ?? '').trim());
    return only.some((name) => name === id || name === title || files.includes(name));
}

/**
 * The advice of the adviser, as the text that goes into the request of the step.
 *
 * The advice is written for the role of the step: the points, the risks and the order.
 * An answer with nothing in it is still an answer — «nothing to add» is worth knowing,
 * and the role must not wonder whether the senior was asked at all.
 *
 * @param {object|null} data the answer of the adviser
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function adviceText(data) {
    if (!data || typeof data !== 'object') return '';
    const lines = [];
    const summary = String(data.summary ?? '').trim();
    if (summary) lines.push(summary);
    const points = (Array.isArray(data.points) ? data.points : []).map((item) => String(item ?? '').trim()).filter(Boolean);
    if (points.length) {
        lines.push('');
        lines.push('What is worth doing:');
        for (const item of points) lines.push(`- ${item}`);
    }
    const risks = (Array.isArray(data.risks) ? data.risks : []).map((item) => String(item ?? '').trim()).filter(Boolean);
    if (risks.length) {
        lines.push('');
        lines.push('What is easy to get wrong here:');
        for (const item of risks) lines.push(`- ${item}`);
    }
    const order = (Array.isArray(data.order) ? data.order : []).map((item) => String(item ?? '').trim()).filter(Boolean);
    if (order.length) {
        lines.push('');
        lines.push('The order the work is better done in:');
        for (const item of order) lines.push(`- ${item}`);
    }
    const notes = String(data.notes ?? '').trim();
    if (notes) {
        lines.push('');
        lines.push(notes);
    }
    return lines.join('\n');
}

/**
 * The files of the project the adviser looks at, and their state.
 *
 * The adviser sees the files of the step and the files around them: the code that is
 * already there is the context of its advice. The state of every file is a part of the
 * hash: a file that changed invalidates the advice.
 *
 * @param {string} root the working directory of the project
 * @param {string[]} names the paths of the files
 * @returns {Promise<Array<{ rel: string, bytes: number, mtimeMs: number }>>}
 */
async function fileStates(root, names = []) {
    const out = [];
    for (const rel of names.slice(0, 40)) {
        const info = await readFile(path.join(root, rel)).then((bytes) => ({
            rel,
            bytes: bytes.byteLength,
            mtimeMs: 0,
        })).catch(() => null);
        if (info) out.push(info);
    }
    return out;
}

/**
 * Ask the senior adviser about a step.
 *
 * The adviser is called through the same machinery as every other role: the model comes
 * from `house.models` and the ladder of the ranks, the instructions are the ones of the
 * role, and the answer is checked against the schema of the advice.
 *
 * A failure of the adviser is **not** a failure of the step: the advice is a counsel, and
 * a counsel that could not be given leaves the role to work as it would have anyway. The
 * warning says so, and the work goes on.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, step?: object,
 *   plan?: object|null, brief?: string, inputs?: object|null, runId?: string|null,
 *   notify?: Function, env?: object, signal?: AbortSignal|null, runContext?: object|null,
 *   stage?: string }} request
 * @returns {Promise<{ text: string, data: object|null, cached: boolean, warnings: string[],
 *   turns: number, usage: object|null, model: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function consultAdvisor({
    client,
    config = {},
    root = process.cwd(),
    task = '',
    step = null,
    plan = null,
    brief = '',
    inputs = null,
    runId: id = null,
    notify = () => {},
    env = process.env,
    signal = null,
    runContext = null,
    stage = 'write',
} = {}) {
    const warnings = [];
    const empty = { text: '', data: null, cached: false, warnings, turns: 0, usage: null, model: null };
    if (!client?.responses) return empty;
    const stepId = String(step?.id ?? '').trim();
    if (!stepId) return empty;

    // The files the adviser looks at: the files of the step and the neighbours of them.
    const names = [];
    for (const rel of (Array.isArray(step?.files) ? step.files : []).map((item) => String(item ?? '').trim())) {
        if (rel && !names.includes(rel)) names.push(rel);
    }
    const states = await fileStates(root, names);
    const hash = adviceHash({ step, brief, task, files: states });

    // The advice that was given before: it is the same advice while nothing changed.
    const saved = await readAdvisorAdvice(root, config, id, stepId);
    if (saved && saved.hash === hash) {
        return { ...empty, text: String(saved.text ?? ''), data: saved.data ?? null, cached: true };
    }

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
    // The files that are already there: the adviser reads them with its tools, but it
    // must know that they exist and what they are.
    if (states.length) {
        blocks.push([
            '## The files of this step as they are now',
            'They are on the disk. Read the ones that matter before you advise.',
            ...states.map((item) => `- \`${item.rel}\` (${item.bytes} bytes)`),
        ].join('\n'));
    }

    const result = await runRole({
        client,
        config,
        role: 'advisor',
        input: blocks.join('\n\n'),
        context: {
            task: String(task ?? ''),
            step,
            brief,
            design: Boolean(inputs),
            criteria: step?.criteria ?? [],
        },
        root,
        env,
        // The adviser reads and answers: it never writes, so the write gate is not armed
        // and the budget of the turn is the reduced one — the budget of the reading.
        requireFiles: false,
        maxTurns: config?.advisor?.maxTurns ?? config?.roles?.advisor?.maxTurns ?? 2,
        notify,
        runContext,
        stage: 'advisor',
        signal,
    });

    if (!result.data) {
        warnings.push(`Шаг ${stepId}: советник не вернул совет (${roleReason(result) || 'нет ответа'}).`);
        return { ...empty, warnings, turns: result.turns ?? 0, usage: result.usage ?? null, model: result.model ?? null };
    }

    const text = adviceText(result.data);
    // The advice goes to the disk: a continued run asks the senior only once.
    const file = advisorAdvicePath(root, config, id, stepId);
    await mkdir(path.dirname(file), { recursive: true }).catch(() => {});
    await writeFile(file, `${JSON.stringify({ hash, text, data: result.data, at: new Date().toISOString() }, null, 2)}\n`, 'utf8').catch(() => {});

    return {
        text,
        data: result.data,
        cached: false,
        warnings,
        turns: result.turns ?? 0,
        usage: result.usage ?? null,
        model: result.model ?? null,
    };
}
