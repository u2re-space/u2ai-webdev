/**
 * @file src/agent/subagent.js
 * @module agent/subagent
 * @purpose Handing work to a sub-agent: a separate thread that runs an inherited role.
 *
 *   A role that meets work of another kind does not do it herself and does not describe it
 *   either: she hands it over. The work goes to a **sub-agent** — a separate thread of
 *   this process, with its own conversation, its own instructions and its own budget of
 *   turns.
 *
 *   The sub-agent carries no role of its own. Everything it is comes from here: the
 *   **role** it inherits (the instructions of that role and the tools of that role), the
 *   **goal** of the work, the **files** it may touch, and the **rights** it has inside the
 *   project. The sub-agent asks this process to run a tool, and this process runs it with
 *   its own executor, its own rules and its own map of the run — so the files it writes
 *   are written the same way the files of the parent are written.
 *
 *   The big texts of the hand-over — the instructions of the role, the notes of the
 *   context — travel in **shared memory**: one buffer the parent writes and the thread
 *   reads. The texts of the instructions are tens of kilobytes, and a copy of them in the
 *   thread is a copy nobody needs. The buffer also carries the flag of cancellation: the
 *   parent sets it, and the thread winds down without a message round trip.
 *
 *   What comes back is the report of the sub-agent and the list of the files it wrote.
 *   The disk keeps the truth: the files of the goal are checked here, and a file that did
 *   not change is reported as missing.
 *
 * @depends node:fs/promises, @u2ai/subagent, agent/paths, agent/fs-tools
 * @usedBy roles/index, agent/tool-specs
 * @exports SUBAGENTS, SUBAGENT_NAMES, createSubagentSpawner, subagentNote,
 *          subagentToolNames, subagentGate, subagentGateNote
 * @ai.tags roles, subagent, delegation, threads
 * @ai.hint keep
 * @changed 2026-11-24 Делегирование ушло в суб-агентов: отдельный поток, роль и права
 *                       наследуются от родителя.
 */

import { stat } from 'node:fs/promises';
import { runSubAgent } from '@u2ai/subagent';
import { createSharedBlock, readSharedBlock, sharedAvailable } from '@u2ai/subagent/shared';
import { resolveInside } from './paths.js';
import { resolveBackends } from '../openai/client.js';

/**
 * The roles that a sub-agent may inherit.
 *
 * A role is here when the work of another role is a thing this role does well: the markup
 * writes the semantics, the styler writes the rules, the coder writes the behaviour, the
 * editor draws the vector, the iconifier chooses the icons. The planner, the architect and
 * the reviewer are not here: they work once for the whole run, and a step does not send
 * them a piece of work.
 *
 * @type {Readonly<Record<string, { description: string }>>}
 * @exports
 */
export const SUBAGENTS = Object.freeze({
    markup: {
        description: 'The semantics of the page: the markup, the accessibility and the attributes. '
            + 'Use it when the structure is wrong — a class that means nothing, an element that '
            + 'is not there, a heading that is not a heading.',
    },
    styler: {
        description: 'The rules of the page: the tokens, the layout, the states. Use it when the '
            + 'page looks wrong — the spacing, the type, the colours, the alignment.',
    },
    coder: {
        description: 'The behaviour of the page: the scripts, the modules, the data. Use it when '
            + 'the page must do something — a menu that opens, a state that is remembered.',
    },
    editor: {
        description: 'The vector graphics of the page: the ornaments and the illustrations, as SVG '
            + 'code. Use it when something has to be drawn.',
    },
    iconifier: {
        description: 'The icons of the interface: the set, the names, the integration into the '
            + 'markup. Use it when a control needs a sign.',
    },
});

/** The names of the roles a sub-agent may inherit. */
export const SUBAGENT_NAMES = Object.freeze(Object.keys(SUBAGENTS));

/**
 * The gates of the hand-over: a door that is closed until the run reaches a stage.
 *
 * The markup is the first role of the chain of the steps: the styles and the scripts are
 * written by their own stages, and a hand-over from the markup to them would write the
 * work of a stage that has not started yet — twice, and in the wrong order. The gate opens
 * when the stages it names have started: then the work they own exists, and the markup may
 * hand a piece of it over.
 *
 * `editor` is in the list of the closed targets as well: the vector graphics are the work
 * of the role `editor`, and the markup may not reach them around the corner.
 *
 * The coder has a gate of its own. The styles are written before the code, and the code is
 * written against them: the class names and the tokens are the contract of the page, and a
 * change of the styles under the written code breaks the page. The icons belong to the stage
 * that comes after the code. The door of the coder opens when the stage after the code has
 * started — then the repair of the styles belongs to the review, and not to the code.
 *
 * @type {ReadonlyArray<Readonly<{ from: string, stage: string, targets: readonly string[],
 *   requires: readonly string[], reason: string }>>}
 * @exports
 */
export const SUBAGENT_GATES = Object.freeze([
    Object.freeze({
        from: 'markup',
        stage: 'markup',
        targets: Object.freeze(['styler', 'coder', 'editor']),
        requires: Object.freeze(['coding', 'styling']),
        reason: 'стили и код пишут свои стадии',
    }),
    Object.freeze({
        from: 'coder',
        stage: 'coding',
        targets: Object.freeze(['styler', 'iconifier']),
        requires: Object.freeze(['iconify']),
        reason: 'стили пишутся раньше кода и задают его контракт, а иконки — на своей стадии',
    }),
    Object.freeze({
        // Кодер не отдаёт разметку маркупу: разметка уже написана, и её правка после кода
        // ломает то, что код уже опирается. Кодер, что меняет разметку, меняет её сам —
        // своей правкой, а не через чужую роль.
        from: 'coder',
        stage: 'coding',
        targets: Object.freeze(['markup']),
        forbids: true,
        reason: 'разметка уже написана, и её правка после кода ломает то, на что код опирается — '
            + 'правьте её сами',
    }),
]);

/**
 * The names of the stages that have started.
 * @param {Set<string>|string[]|null|undefined} started
 * @returns {Set<string>}
 * @ai.hint pure
 */
function startedSet(started) {
    if (started instanceof Set) return started;
    return new Set(Array.isArray(started) ? started.map((item) => String(item ?? '').trim()) : []);
}

/**
 * Is the hand-over closed by a gate?
 * @param {{ from?: string|null, stage?: string|null, to?: string|null,
 *   startedStages?: Set<string>|string[]|null }} request
 * @returns {{ from: string, to: string, missing: string[], reason: string }|null}
 * @exports
 * @ai.hint pure
 */
export function subagentGate({ from = null, stage = null, to = null, startedStages = null } = {}) {
    const source = String(from ?? '').trim().toLowerCase();
    const target = String(to ?? '').trim().toLowerCase();
    const where = String(stage ?? '').trim().toLowerCase();
    if (!source || !target) return null;
    const started = startedSet(startedStages);
    for (const gate of SUBAGENT_GATES) {
        if (gate.from !== source) continue;
        if (gate.stage && where && gate.stage !== where) continue;
        if (!gate.targets.includes(target)) continue;
        if (gate.forbids) {
            return { from: source, to: target, missing: [], reason: gate.reason };
        }
        const missing = gate.requires.filter((name) => !started.has(name));
        if (!missing.length) return null;
        return { from: source, to: target, missing, reason: gate.reason };
    }
    return null;
}

/**
 * The note that tells a role that its hand-over is closed right now.
 * @param {{ from?: string|null, stage?: string|null, startedStages?: Set<string>|string[]|null }} request
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function subagentGateNote({ from = null, stage = null, startedStages = null } = {}) {
    const source = String(from ?? '').trim().toLowerCase();
    const where = String(stage ?? '').trim().toLowerCase();
    const started = startedSet(startedStages);
    for (const gate of SUBAGENT_GATES) {
        if (gate.from !== source) continue;
        if (gate.stage && where && gate.stage !== where) continue;
        if (gate.forbids) {
            return [
                '## The hand-over is closed',
                `Do not hand work over to ${gate.targets.join(', ')}: ${gate.reason}.`,
                'Write the files of your own step yourself and leave the rest to the stages that own them.',
            ].join('\n');
        }
        const missing = gate.requires.filter((name) => !started.has(name));
        if (!missing.length) continue;
        return [
            '## The hand-over is closed for now',
            `Do not hand work over to ${gate.targets.join(', ')}: the ${missing.join(' and ')} ${missing.length > 1 ? 'stages have' : 'stage has'} not started yet, and ${gate.reason}.`,
            'Write the files of your own step yourself and leave the rest to the stages that own them.',
        ].join('\n');
    }
    return '';
}

/**
 * The tools a sub-agent of this role may call.
 *
 * The tool of the hand-over itself is not among them: the hand-over is one level deep,
 * and a chain of threads is a chain nobody reads.
 *
 * @param {string} name the role
 * @param {string[]} allNames the tools the caller has
 * @param {Function|null} [resolveRole] the registry of the roles
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function subagentToolNames(name, allNames = [], resolveRole = null) {
    const key = String(name ?? '').trim().toLowerCase();
    if (!SUBAGENTS[key]) return [];
    const spec = typeof resolveRole === 'function' ? resolveRole(key) : null;
    const own = Array.isArray(spec?.tools) ? spec.tools : [];
    return allNames.filter((tool) => own.includes(tool) && tool !== 'subagent');
}

/**
 * The rule that tells a role when to hand the work over.
 * @param {string[]} names
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function subagentNote(names = []) {
    const list = Array.isArray(names) ? names : [];
    if (!list.length) return '';
    const described = list
        .map((name) => `${name} — ${SUBAGENTS[name]?.description ?? ''}`.trim())
        .join('\n');
    return [
        'When the work is not yours, hand it over instead of doing it yourself:',
        '`write_ready` is not delegation: it starts no other role and only unlocks your own writing tools.',
        'Do not hand over a file listed in your current step. Write your own step files first.',
        described,
        'Name the role, the task and the reason. The sub-agent that receives the work starts in a',
        'separate thread with its own conversation: it does not see this conversation, so the task has',
        'to say everything it needs — the files, what is wrong and what the result has to be. Name',
        'every expected output file in the `files` field.',
        'The sub-agent inherits your role, your tools and your rights: it works in the same project',
        'and with the same skills, the same memory and the same tools.',
        'Wait for its report, check that its files were actually written, then continue with your own work.',
    ].join('\n');
}

/**
 * The spawner of a sub-agent.
 *
 * The spawner builds the spec of the sub-agent out of the role it inherits and the goal of
 * the work, starts the thread and waits for the report. The tools of the sub-agent are the
 * tools of this process: the sub-agent asks, this process runs.
 *
 * @param {{ config?: object, root: string, env?: object, notify?: Function,
 *   runContext?: object|null, role?: string|null, stage?: string|null, depth?: number,
 *   resolveRole?: Function|null, startedStages?: Set<string>|string[]|null,
 *   parts?: object[], context?: object, tools?: object|null,
 *   instructionsFor?: Function|null, model?: string|null, effort?: string|null,
 *   baseURL?: string|null, apiKey?: string|null, signal?: AbortSignal|null }} options
 *   `resolveRole` gives the tools and the budget of a role. `stage` is the stage of the
 *   caller: the work handed over belongs to it, so the sub-agent inherits the model of that
 *   stage. `tools` is the executor of this process: the sub-agent asks it to run a call.
 *   `instructionsFor` builds the instructions of the inherited role.
 * @returns {(args: object) => Promise<string>}
 * @exports
 * @ai.hint io
 */
export function createSubagentSpawner({
    config = {},
    root,
    env = process.env,
    notify = () => {},
    runContext = null,
    role = null,
    stage = null,
    depth = 0,
    resolveRole = null,
    startedStages = null,
    parts = [],
    context = {},
    tools = null,
    instructionsFor = null,
    model = null,
    effort = null,
    baseURL = null,
    apiKey = null,
    specs = null,
    signal = null,
} = {}) {
    return async function spawn(args = {}) {
        const name = String(args?.role ?? '').trim().toLowerCase();
        const task = String(args?.task ?? '').trim();
        const reason = String(args?.reason ?? '').trim();
        // The model, the effort and the key the caller named: they win over the ones of the
        // inherited role, and the inherited role wins over the ones of the run. A sub-agent
        // on another model is the choice of the caller, not a surprise of the run.
        const askedModel = String(args?.model ?? '').trim();
        const askedEffort = String(args?.effort ?? '').trim();
        const askedKey = String(args?.apiKey ?? '').trim();
        const askedTransport = String(args?.transport ?? '').trim().toLowerCase() === 'process'
            ? 'process'
            : 'thread';
        const expected = [];
        for (const file of Array.isArray(args?.files) ? args.files : []) {
            const value = String(file ?? '').trim();
            if (!value) continue;
            const { rel } = await resolveInside(root, value, { forWrite: true, allowRoot: false });
            if (!expected.some((item) => item.toLowerCase() === rel.toLowerCase())) expected.push(rel);
        }
        if (!name) throw new Error('subagent: назовите роль, которую наследует суб-агент.');
        if (!task) throw new Error('subagent: задача пуста — напишите, что именно нужно сделать.');
        if (!SUBAGENTS[name]) {
            throw new Error(`subagent: неизвестная роль «${name}» (доступны: ${SUBAGENT_NAMES.join(', ')}).`);
        }
        if (role && name === role) {
            throw new Error(`subagent: роль ${name} не может передать работу самой себе.`);
        }
        if (depth > 0) {
            throw new Error('subagent: передача работы глубже одного уровня не делается.');
        }
        if (!expected.length) {
            throw new Error('subagent: укажите конкретные выходные файлы в поле files.');
        }
        const spec = typeof resolveRole === 'function' ? resolveRole(name) : null;
        if (!spec) throw new Error(`subagent: роль ${name} недоступна.`);

        // The work of the step belongs to the role of the step. A role that has not written
        // its own files yet does not hand a piece of work over: it hands the step away.
        const ownFiles = Array.isArray(context?.step?.files)
            ? context.step.files.map((file) => String(file ?? '').trim()).filter(Boolean)
            : [];
        const missingOwn = [];
        for (const file of ownFiles) {
            if (file.endsWith('/')) continue;
            try {
                const { abs } = await resolveInside(root, file, { allowRoot: false });
                if (!(await stat(abs)).isFile()) missingOwn.push(file);
            } catch {
                missingOwn.push(file);
            }
        }
        if (missingOwn.length) {
            throw new Error(`subagent: сначала напишите файлы своего шага (${missingOwn.join(', ')}) — `
                + 'передавать работу можно только после этого.');
        }
        // The gate of the hand-over: some doors stay closed until the run reaches a stage.
        const gate = subagentGate({ from: role, stage, to: name, startedStages });
        if (gate) {
            throw new Error(`subagent: роль ${gate.from} на стадии ${stage ?? gate.from} не может `
                + `передать работу роли ${gate.to}: стадии ${gate.missing.join(' и ')} ещё не начались, `
                + `а ${gate.reason}.`);
        }

        const baseline = new Map();
        for (const file of expected) {
            try {
                const { abs, rel } = await resolveInside(root, file, { allowRoot: false });
                const info = await stat(abs);
                if (info.isFile()) baseline.set(rel.toLowerCase(), `${info.size}:${info.mtimeMs}`);
            } catch { /* A missing expected file is the usual case for a sub-agent. */ }
        }

        notify({ type: 'subagent.start', from: role, to: name, task, reason });
        // The instructions of the inherited role: the sub-agent speaks them as they are.
        const inherited = typeof instructionsFor === 'function'
            ? await instructionsFor(name)
            : '';
        // The API of the house: the sub-agent talks to the same API with the same key.
        // The caller may name another model, another effort or another key: a named one
        // wins over the inherited role, and the inherited role wins over the run.
        const backends = resolveBackends(config, { kind: 'text', model: askedModel || model, env });
        const backend = backends[0] ?? null;
        const modelOf = askedModel || spec.model || model || '';
        const effortOf = askedEffort || spec.effort || effort || null;
        const keyOf = askedKey || apiKey || backend?.apiKey || '';
        const addressOf = baseURL || backend?.baseURL || '';
        // The tools of the sub-agent: the tools of the role it inherits, and among them
        // only the ones this process can really run. A tool that the executor of the
        // process does not know is a tool the sub-agent would call into the void. The
        // specs come from the caller; without them every named tool is runnable.
        const runnable = new Set((Array.isArray(specs) ? specs : []).map((item) => String(item?.name ?? '')));
        const inheritedTools = subagentToolNames(name, spec.tools ?? [], resolveRole)
            .filter((tool) => !runnable.size || runnable.has(tool));
        // The shared memory of the hand-over: the instructions and the notes travel in one
        // buffer when the thread transport can carry it. A process gets the texts inside
        // the spec — shared memory does not cross processes.
        const useShared = askedTransport === 'thread' && sharedAvailable();
        const shared = useShared
            ? createSharedBlock({ instructions: inherited, notes: textOf(context?.notes) })
            : null;
        const report = await runSubAgent({
            spec: {
                name: `${name}-${Date.now().toString(36)}`,
                role: {
                    name,
                    // In the thread transport the instructions live in the shared memory;
                    // the spec carries them too, for a reader that has no buffer.
                    instructions: shared ? '' : inherited,
                    tools: inheritedTools,
                    schema: spec.schema ?? null,
                    schemaName: spec.schema ?? 'response',
                },
                goal: task,
                reason,
                files: expected,
                rights: { cwd: root, write: true },
                budget: { maxTurns: Math.min(spec.maxTurns ?? 8, 8) },
                // The economy of the turns travels with the hand-over: the sub-agent spends
                // the cap of the model, and the estimate it gives at the write gate sizes
                // the budget of the write turn.
                output: {
                    maxOutputTokens: spec.maxOutputTokens ?? config?.maxOutputTokens ?? null,
                    models: config?.models ?? {},
                },
                model: {
                    model: modelOf,
                    baseURL: addressOf,
                    apiKey: keyOf,
                    effort: effortOf,
                },
                context: {
                    reference: Array.isArray(context?.reference) ? context.reference : [],
                    memory: textOf(context?.memory),
                    skills: Array.isArray(context?.skills) ? context.skills : [],
                    notes: shared ? '' : textOf(context?.notes),
                    // The picture of the reference travels with the work: the sub-agent
                    // looks at the same target the caller looked at.
                    parts: Array.isArray(parts) ? parts : [],
                },
                // The buffer of the hand-over: the thread reads its texts from here.
                shared: shared?.buffer ?? null,
            },
            transport: askedTransport,
            signal,
            // The stop of the run travels into the shared memory: the thread sees the flag
            // between its turns, without a message round trip.
            onCancel: shared ? () => shared.cancel() : null,
            onEvent: (event) => {
                notify({ type: 'subagent.status', from: role, to: name, event });
            },
            // The tools are the tools of this process: the sub-agent asks, this process runs.
            onCall: async (call) => {
                const executor = tools;
                if (!executor) throw new Error(`The tool ${call?.name} is not available here.`);
                return await executor.execute(call?.name, call?.arguments ?? {});
            },
        });

        // The files of the goal are checked on the disk: the disk keeps the truth.
        const existing = [];
        const expectedMissing = [];
        for (const file of expected) {
            try {
                const { abs, rel } = await resolveInside(root, file, { allowRoot: false });
                const info = await stat(abs);
                if (!info.isFile()) {
                    expectedMissing.push(file);
                    continue;
                }
                const before = baseline.get(rel.toLowerCase());
                if (before && `${info.size}:${info.mtimeMs}` === before) {
                    expectedMissing.push(`${file} (не изменён)`);
                    continue;
                }
                existing.push(rel);
            } catch {
                expectedMissing.push(file);
            }
        }
        const ok = report?.ok === true && existing.length > 0 && expectedMissing.length === 0;
        notify({
            type: 'subagent.done',
            from: role,
            to: name,
            turns: report?.turns ?? 0,
            ok,
            files: existing,
        });

        const lines = [
            `The sub-agent of the role ${name} worked in a separate thread: ${report?.turns ?? 0} turns.`,
            ok ? 'The output of the sub-agent: VERIFIED.' : 'The output of the sub-agent: NOT VERIFIED; continue the work here or report the blocker.',
            existing.length ? `Verified files on disk: ${existing.join(', ')}` : 'No output files were verified on disk.',
            expectedMissing.length ? `Expected files still missing: ${expectedMissing.join(', ')}.` : '',
            report?.report ? String(report.report) : '(the sub-agent said nothing)',
        ];
        return lines.filter(Boolean).join('\n');
    };
}

/**
 * The text of a value.
 * @param {unknown} value
 * @returns {string}
 * @ai.hint pure
 */
function textOf(value) {
    return typeof value === 'string' ? value : '';
}
