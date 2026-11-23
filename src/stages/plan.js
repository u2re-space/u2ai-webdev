/**
 * @file src/stages/plan.js
 * @module stages/plan
 * @purpose The plan of the work: the steps, their order, their files and their criteria.
 *
 *   The planner reads the project and the collected context and answers with a plan. The plan
 *   is normalized before it is used: the ids become unique, the dependencies that point
 *   nowhere are dropped, and the steps are sorted in the order they may be done.
 *
 *   The plan is written to the directory of the run (`.tmp/<id>/plan.json`), so the next stages
 *   and a resumed run read the same plan and do not drift.
 *
 * @depends node:path, roles/index, inputs/index, stages/workspace, stages/roles
 * @usedBy stages/index, stages/architect, pipeline
 * @exports PLAN_FILE, normalizePlan, orderSteps, planText, writePlan, readPlan, planStage
 * @ai.tags stages, plan
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the plan is a file of the run, not a chat.
 * @changed 2026-11-15 Роль шага проверяется: план не оставляет шагов, которые никто не сделает.
 */

import { runRole, roleReason } from '../roles/index.js';
import { inputContext } from '../inputs/index.js';
import { readReferences } from '../inputs/references.js';
import { runId, runFile, writeJsonFile, readJsonFile } from './workspace.js';
import { readScan, scanText } from './scan.js';
import { planRole } from './roles.js';

/**
 * The name of the file of the plan inside the directory of the run. */
export const PLAN_FILE = 'plan.json';

/**
 * The correction the planner gets when its answer holds no steps.
 *
 * A plan without steps is a plan of intentions ("first I will study the project"), and the
 * stages of the run have nothing to do. The model is asked once more, and the answer has to
 * be the work itself.
 *
 * The correction names the tools on purpose: the answer of the planner is the plan of the
 * work, and the work of the planner is to look at the project and the collected design inputs
 * before it decides what the steps are. Measurements are optional; no measurer is required.
 */
export const PLAN_CORRECTION = [
    'The previous answer was not a plan: its list of steps was empty.',
    'Work first, answer second: read the files of the project with `list_files` and `read_file`.',
    'Use DESIGN.md and any attached reference picture directly. A measurement sheet is optional;',
    'do not call or require a measurer.',
    'Then submit the plan with the tool `plan`: at least two concrete steps, each with an id,',
    'a title, the role that does it, the files it touches and the criteria that can be checked',
    'without a human.',
    'The role of a step is one of: `markup`, `coder`, `styler`, `animator`, `editor`,',
    '`illustrator`, `iconifier`. The stages of the run take the steps of these roles and of no',
    'others: a step with any other role is never done.',
    'Do not answer in prose and do not describe what you are going to do later — the steps are',
    'the work.',
].join('\n');

/**
 * The text of a list, one item per line.
 * @param {unknown} value
 * @returns {string[]}
 * @ai.hint pure
 */
function lines(value) {
    if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
    if (typeof value === 'string' && value.trim()) return value.split('\n').map((item) => item.trim()).filter(Boolean);
    return [];
}

/**
 * Sort the steps in the order they may be done.
 *
 * The sort is stable: a step that waits for nothing keeps its place. A cycle in the
 * dependencies does not break the plan — the steps of the cycle keep their order and the
 * caller learns about the cycle from the warnings.
 * @param {object[]} steps
 * @returns {{ steps: object[], warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function orderSteps(steps = []) {
    const list = Array.isArray(steps) ? steps : [];
    const byId = new Map(list.map((step) => [step.id, step]));
    const pending = new Map(list.map((step) => [step.id, new Set((step.dependsOn ?? []).filter((id) => byId.has(id) && id !== step.id))]));
    const done = new Set();
    const out = [];
    const warnings = [];

    while (out.length < list.length) {
        const ready = list.find((step) => !done.has(step.id) && (pending.get(step.id)?.size ?? 0) === 0);
        if (!ready) break;
        done.add(ready.id);
        out.push(ready);
        for (const set of pending.values()) set.delete(ready.id);
    }

    if (out.length < list.length) {
        const rest = list.filter((step) => !done.has(step.id));
        const names = rest.map((step) => step.id).join(', ');
        warnings.push(`Цикл в зависимостях шагов: ${names}. Шаги оставлены в исходном порядке.`);
        out.push(...rest);
    }

    return { steps: out, warnings };
}

/**
 * Normalize the plan of the model into the shape the stages read.
 *
 * Every field of a step has a default, the ids are unique, the dependencies that point to
 * nothing are dropped, and the steps are sorted in the order they may be done.
 *
 * The role of a step is the role that does it. A role that no stage executes is a step that
 * nobody will do: the role is guessed by the files of the step, and a step whose role
 * cannot be guessed leaves the plan with a warning.
 * @param {object} plan
 * @returns {{ summary: string, steps: object[], risks: string[], questions: string[], warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function normalizePlan(plan = {}) {
    const warnings = [];
    const raw = Array.isArray(plan?.steps) ? plan.steps : [];
    const seen = new Map();
    const steps = [];

    for (const [at, source] of raw.entries()) {
        const item = source && typeof source === 'object' ? source : {};
        const base = String(item.id ?? '').trim() || `step-${at + 1}`;
        const count = seen.get(base) ?? 0;
        let id = base;
        if (count) {
            id = `${base}-${count + 1}`;
            warnings.push(`Шаг с id "${base}" повторяется: он переименован в "${id}".`);
        }
        // The role of the step decides who does it. A role that no stage takes is a promise
        // the run cannot keep: the step is either given to the role that owns its files or
        // it leaves the plan.
        const resolved = planRole(item.role, item.files);
        if (resolved.warning) warnings.push(`Шаг ${id}: ${resolved.warning}`);
        if (resolved.dropped) continue;
        seen.set(base, count + 1);
        steps.push({
            id,
            title: String(item.title ?? '').trim() || `Шаг ${id}`,
            role: resolved.role,
            dependsOn: lines(item.dependsOn),
            files: lines(item.files),
            criteria: lines(item.criteria),
        });
    }

    const known = new Set(steps.map((step) => step.id));
    for (const step of steps) {
        const before = step.dependsOn.length;
        step.dependsOn = step.dependsOn.filter((id) => {
            if (id === step.id) {
                warnings.push(`Шаг ${step.id}: зависимость от самого себя убрана.`);
                return false;
            }
            if (!known.has(id)) {
                warnings.push(`Шаг ${step.id}: зависимость "${id}" не найдена и убрана.`);
                return false;
            }
            return true;
        });
        if (step.dependsOn.length !== before) continue;
    }

    const ordered = orderSteps(steps);
    warnings.push(...ordered.warnings);

    return {
        summary: String(plan?.summary ?? '').trim(),
        steps: ordered.steps,
        risks: lines(plan?.risks),
        questions: lines(plan?.questions),
        warnings,
    };
}

/**
 * The plan as the text the roles read.
 * @param {object} plan
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function planText(plan = {}) {
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    if (!steps.length) return '';
    const out = ['# The plan of the work'];
    if (plan.summary) out.push(plan.summary, '');
    for (const step of steps) {
        out.push(`## ${step.id} — ${step.title}`);
        out.push(`- role: ${step.role}`);
        if (step.dependsOn?.length) out.push(`- after: ${step.dependsOn.join(', ')}`);
        if (step.files?.length) out.push(`- files: ${step.files.join(', ')}`);
        if (step.criteria?.length) {
            out.push('- criteria:');
            for (const item of step.criteria) out.push(`  - ${item}`);
        }
        out.push('');
    }
    if (plan.risks?.length) {
        out.push('# Risks');
        for (const item of plan.risks) out.push(`- ${item}`);
        out.push('');
    }
    if (plan.questions?.length) {
        out.push('# Questions for the user');
        for (const item of plan.questions) out.push(`- ${item}`);
        out.push('');
    }
    return out.join('\n').trim();
}

/**
 * The path of the plan of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function planPath(root, config = {}, id = null) {
    return runFile(root, config, id, PLAN_FILE);
}

/**
 * Write the plan of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @param {object} plan
 * @returns {Promise<string>} the path of the file
 * @exports
 * @ai.hint io
 */
export async function writePlan(root, config = {}, id = null, plan = {}) {
    return await writeJsonFile(planPath(root, config, id), plan);
}

/**
 * Read the plan of a run. A missing plan gives null.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readPlan(root, config = {}, id = null) {
    return await readJsonFile(planPath(root, config, id));
}

/**
 * The stage of the plan: the planner reads the project and answers with the steps of the work.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, inputs?: object|null,
 *   runId?: string|null, notify?: (event: object) => void, env?: object, runContext?: object|null,
 *   input?: object|null }} request
 * @returns {Promise<{ stage: string, ok: boolean, plan: object|null, file: string|null,
 *   text: string, warnings: string[], turns: number, usage: object|null, runId: string }>}
 * @exports
 * @ai.hint io
 */
export async function planStage({
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
    // The survey of the project: the planner starts from what the scanner found on the disk.
    const scan = await readScan(root, config, run);
    const survey = scan ? scanText(scan) : '';
    const prompt = [String(task ?? '').trim(), context, survey].filter(Boolean).join('\n\n');
    const reference = await readReferences(root, inputs?.references ?? []);
    const stack = config?.stack ?? {};

    const request = {
        client,
        config,
        role: 'planner',
        input: prompt,
        parts: reference.parts,
        context: {
            task: String(task ?? ''),
            kind: config?.agent?.kind ?? null,
            stack,
            design: Boolean(context),
            project: root,
            survey,
            reference: reference.names,
            referenceSizes: reference.sizes,
        },
        root,
        env,
        maxTurns: config?.stages?.plan?.maxTurns ?? null,
        notify,
        runContext,
        stage: 'plan',
        inputChannel: input,
    };

    let result = await runRole(request);
    let plan = result.data ? normalizePlan(result.data) : null;

    // A plan without steps is a plan of intentions, and a plan without data is no plan at
    // all. The planner is asked once more — and this time the schema travels in the tool
    // channel: the answer is the call of the schema, and the model may work with the tools
    // before it answers. A model that is pinned to a JSON answer describes the work
    // instead of doing it, and the plan of such a model is the skeleton of the schema.
    if (!plan?.steps?.length) {
        const retry = await runRole({
            ...request,
            input: `${prompt}\n\n${PLAN_CORRECTION}`,
            schemaChannel: 'tool',
        });
        const second = retry.data ? normalizePlan(retry.data) : null;
        if (second?.steps?.length) {
            second.warnings.push('Планировщик вернул пустой план и был спрошен ещё раз.');
            plan = second;
            result = retry;
        }
    }

    if (!result.data) {
        return {
            stage: 'plan',
            ok: false,
            plan: null,
            file: null,
            text: result.text ?? '',
            warnings: [`Планировщик не вернул план (${roleReason(result)}).`],
            turns: result.turns,
            usage: result.usage,
            runId: run,
        };
    }

    // The answer of the planner that does not fit the schema is kept, but it is reported:
    // a run must not pass a malformed plan in silence.
    const schemaWarnings = (result.schemaProblems ?? []).map((problem) => `План не по схеме: ${problem}.`);

    if (!plan?.steps?.length) {
        return {
            stage: 'plan',
            ok: false,
            plan: null,
            file: null,
            text: result.text ?? '',
            warnings: [
                'Планировщик не вернул ни одного шага: план без шагов не запускает остальные стадии.',
                'Проверьте модель в конфиге (`models.<id>.schemaChannel`) или посмотрите план отдельно: `ai-webdev plan <задача>`.',
            ],
            turns: result.turns,
            usage: result.usage,
            runId: run,
        };
    }

    const file = await writePlan(root, config, run, plan);
    // The plan goes into the context of the run: the stages after it read it from there.
    await runContext?.plan?.(planText(plan), { stage: 'plan' });
    return {
        stage: 'plan',
        ok: true,
        plan,
        file,
        text: planText(plan),
        warnings: [...(plan.warnings ?? []), ...schemaWarnings],
        turns: result.turns,
        usage: result.usage,
        runId: run,
    };
}
