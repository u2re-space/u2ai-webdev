/**
 * @file src/agent/delegation.js
 * @module agent/delegation
 * @purpose Handing work from one role to another: a separate session, not a change of words.
 *
 *   A role that meets work of another kind does not do it herself and does not describe it
 *   either: she hands it over. The markup that does not fit the design goes to the styler,
 *   the styler who finds the class names broken goes to the markup, the coder who needs a
 *   picture of the page goes to the role that can take one.
 *
 *   The work goes to a **separate session**: the role that receives it starts with a clean
 *   conversation, her own instructions, her own tools and her own budget of turns. The
 *   conversation of the caller is not continued — a session that has already spent its context
 *   on the wrong problem is the wrong place to solve the right one. What comes back is the
 *   report of the role and the list of the files it wrote; the disk keeps the truth.
 *
 *   A delegated role never gets the delegation tool itself: the hand-over is one level deep,
 *   and a chain of sessions is a chain nobody reads.
 *
 * @depends node:fs/promises, agent/fs-tools, agent/paths
 * @usedBy roles/index, agent/tool-specs
 * @exports DELEGATES, DELEGATE_NAMES, delegateToolNames, createDelegator, delegationNote
 * @ai.tags roles, delegation, sessions
 * @ai.hint keep
 * @changed 2026-11-16 Делегирование между ролями: отдельная сессия для другой роли.
 */

import { stat } from 'node:fs/promises';
import { resolveInside } from './paths.js';
import { writeTextFile } from './fs-tools.js';

/**
 * The roles that may be handed work, and what each of them is for.
 *
 * A role is here when the work of another role is a thing this role does well: the markup
 * writes the semantics, the styler writes the rules, the coder writes the behaviour, the
 * editor draws the vector, the iconifier chooses the icons. The planner, the architect and
 * the reviewer are not here: they work once for the whole run, and a step does not send them
 * a piece of work.
 *
 * The tools and the budget of the role are taken from the role itself — the registry of the
 * roles is passed in, so this module knows nothing about the roles and nothing imports it
 * back.
 * @type {Readonly<Record<string, { description: string }>>}
 * @exports
 */
export const DELEGATES = Object.freeze({
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

/** The names of the roles that may be handed work. */
export const DELEGATE_NAMES = Object.freeze(Object.keys(DELEGATES));

/**
 * The tools a delegated role may call.
 *
 * The delegation tool itself is not among them: the hand-over is one level deep.
 * @param {string} name
 * @param {string[]} allNames the tools the caller has
 * @param {Function|null} [resolveRole] the registry of the roles
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function delegateToolNames(name, allNames = [], resolveRole = null) {
    const key = String(name ?? '').trim().toLowerCase();
    if (!DELEGATES[key]) return [];
    const spec = typeof resolveRole === 'function' ? resolveRole(key) : null;
    const own = Array.isArray(spec?.tools) ? spec.tools : [];
    return allNames.filter((tool) => own.includes(tool) && tool !== 'delegate_role');
}

/**
 * The rule that tells a role when to hand the work over.
 * @param {string[]} names
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function delegationNote(names = []) {
    const list = Array.isArray(names) ? names : [];
    if (!list.length) return '';
    const described = list
        .map((name) => `${name} — ${DELEGATES[name]?.description ?? ''}`.trim())
        .join('\n');
    return [
        'When the work is not yours, hand it over instead of doing it yourself:',
        '`write_ready` is not delegation: it starts no other role and only unlocks your own writing tools.',
        'Do not delegate a file listed in your current step. Write your own step files first.',
        described,
        'Name the role, the task and the reason. The role that receives the work starts a',
        'separate session: it does not see this conversation, so the task has to say everything',
        'it needs — the files, what is wrong and what the result has to be. Name every expected',
        'output file in the `files` field. Delegate only a bounded piece of work,',
        'not the whole step. The files of your own step are yours: write them first, and hand',
        'work over at most once in this role run.',
        'Wait for its report, check that its files were actually written, then continue with your own work.',
    ].join('\n');
}

/**
 * The handler of the tool `delegate_role`.
 *
 * The work goes to a new session of the named role. Expected output paths are scoped to that
 * session and checked on disk before the hand-over is reported as complete.
 * @param {{ run: Function, config?: object, root: string, env?: object, notify?: Function,
 *   runContext?: object|null, role?: string|null, depth?: number, resolveRole?: Function|null }} options
 *   `run` starts a session of a role: it is the runner of the roles, called with the role, the
 *   task and the options of the session. `resolveRole` gives the tools and the budget of a role.
 * @returns {(args: object) => Promise<string>}
 * @exports
 * @ai.hint io
 */
export function createDelegator({
    run,
    config = {},
    root,
    env = process.env,
    notify = () => {},
    runContext = null,
    role = null,
    depth = 0,
    resolveRole = null,
    parts = [],
    context = {},
} = {}) {
    return async function delegate(args = {}) {
        const name = String(args?.role ?? '').trim().toLowerCase();
        const task = String(args?.task ?? '').trim();
        const reason = String(args?.reason ?? '').trim();
        const expected = [];
        for (const file of Array.isArray(args?.files) ? args.files : []) {
            const value = String(file ?? '').trim();
            if (!value) continue;
            const { rel } = await resolveInside(root, value, { forWrite: true, allowRoot: false });
            if (!expected.some((item) => item.toLowerCase() === rel.toLowerCase())) expected.push(rel);
        }
        if (!name) throw new Error('delegate_role: назовите роль, которой передаётся работа.');
        if (!task) throw new Error('delegate_role: задача пуста — напишите, что именно нужно сделать.');
        if (!DELEGATES[name]) {
            throw new Error(`delegate_role: неизвестная роль «${name}» (доступны: ${DELEGATE_NAMES.join(', ')}).`);
        }
        if (role && name === role) {
            throw new Error(`delegate_role: роль ${name} не может передать работу самой себе.`);
        }
        if (depth > 0) {
            throw new Error('delegate_role: передача работы глубже одного уровня не делается.');
        }
        if (!expected.length) {
            throw new Error('delegate_role: укажите конкретные выходные файлы в поле files.');
        }
        const spec = typeof resolveRole === 'function' ? resolveRole(name) : null;
        if (!spec) throw new Error(`delegate_role: роль ${name} недоступна.`);

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
            throw new Error(`delegate_role: сначала напишите файлы своего шага (${missingOwn.join(', ')}) — `
                + 'передавать работу можно только после этого.');
        }

        const baseline = new Map();
        for (const file of expected) {
            try {
                const { abs, rel } = await resolveInside(root, file, { allowRoot: false });
                const info = await stat(abs);
                if (info.isFile()) baseline.set(rel.toLowerCase(), `${info.size}:${info.mtimeMs}`);
            } catch { /* A missing expected file is the usual case for delegated creation. */ }
        }

        notify({ type: 'delegate.start', from: role, to: name, task, reason });
        // The separate session: its own conversation, its own instructions, its own tools.
        const result = await run({
            role: name,
            input: [
                `The ${role ?? 'caller'} hands you this work: ${task}`,
                reason ? `The reason: ${reason}` : '',
                'You are a separate session: you do not see the conversation of the caller.',
                'Do the work with your tools and report what you did and what is on the disk.',
            ].filter(Boolean).join('\n\n'),
            context: {
                ...context,
                task,
                // A delegated task is not the parent's step. Carrying it over gave the child
                // conflicting instructions about which files it owns.
                step: expected.length ? { id: `delegate-${name}`, title: task, role: name, files: expected, criteria: [] } : null,
                delegated: true,
                from: role,
                reason,
            },
            config,
            root,
            env,
            notify,
            runContext,
            // Leave room for runRole's final schema answer: at most seven tool turns plus
            // one final request, rather than eight turns followed by an uncounted extra call.
            maxTurns: Math.min(spec.maxTurns ?? 7, 7),
            requireFiles: true,
            depth: depth + 1,
            // The pictures of the caller travel with the work: the role that receives it
            // looks at the same reference the caller looked at.
            parts,
        });
        // Apply files returned in the schema, then verify outputs against the disk.
        const candidates = new Set([...expected, ...(Array.isArray(result?.outputFiles) ? result.outputFiles : [])]);
        for (const file of Array.isArray(result?.data?.files) ? result.data.files : []) {
            const rel = String(file?.path ?? '').trim();
            const content = typeof file?.content === 'string' ? file.content : null;
            if (!rel || content === null) continue;
            if (!expected.some((item) => item.toLowerCase() === rel.toLowerCase())) continue;
            try {
                const saved = await writeTextFile({ root, file: rel, content, overwrite: true });
                candidates.add(saved.rel);
            } catch { /* The verification below reports missing output honestly. */ }
        }

        const existing = [];
        for (const rel of candidates) {
            try {
                const { abs, rel: safe } = await resolveInside(root, rel, { allowRoot: false });
                if ((await stat(abs)).isFile()) existing.push(safe);
            } catch { /* Missing, unsafe, or non-file output is not completed work. */ }
        }
        const expectedMissing = [];
        for (const file of expected) {
            const found = existing.find((item) => item.toLowerCase() === file.toLowerCase());
            if (!found) {
                expectedMissing.push(file);
                continue;
            }
            const before = baseline.get(found.toLowerCase());
            if (before) {
                const { abs } = await resolveInside(root, found, { allowRoot: false });
                const info = await stat(abs);
                if (`${info.size}:${info.mtimeMs}` === before) expectedMissing.push(`${file} (не изменён)`);
            }
        }
        const ok = existing.length > 0 && expectedMissing.length === 0;
        notify({ type: 'delegate.done', from: role, to: name, turns: result?.turns ?? 0, ok, files: existing });

        const report = String(result?.text ?? '').trim() || (result?.data?.summary ? String(result.data.summary).trim() : '');
        const lines = [
            `The role ${name} used a separate session: ${result?.turns ?? 0} turns, ${result?.toolCalls?.length ?? 0} calls of tools.`,
            ok ? 'Delegated output: VERIFIED.' : 'Delegated output: NOT VERIFIED; continue the work here or report the blocker.',
            existing.length ? `Verified files on disk: ${existing.join(', ')}` : 'No output files were verified on disk.',
            expectedMissing.length ? `Expected files still missing: ${expectedMissing.join(', ')}.` : '',
            report ? '' : null,
            report || '(the role said nothing)',
        ].filter((item) => item !== null && item !== '');
        return lines.join('\n');
    };
}
