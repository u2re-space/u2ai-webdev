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
 * @depends agent/fs-tools
 * @usedBy roles/index, agent/tool-specs
 * @exports DELEGATES, DELEGATE_NAMES, delegateToolNames, createDelegator, delegationNote
 * @ai.tags roles, delegation, sessions
 * @ai.hint keep
 * @changed 2026-11-16 Делегирование между ролями: отдельная сессия для другой роли.
 */

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
        described,
        'Name the role, the task and the reason. The role that receives the work starts a',
        'separate session: it does not see this conversation, so the task has to say everything',
        'it needs — the file, what is wrong and what the result has to be.',
        'Wait for its report, then continue with your own work.',
    ].join('\n');
}

/**
 * The handler of the tool `delegate_role`.
 *
 * The work goes to a new session of the named role. Her answer comes back as the report of
 * the tool, and the files she named are written on the disk.
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
        const spec = typeof resolveRole === 'function' ? resolveRole(name) : null;
        if (!spec) throw new Error(`delegate_role: роль ${name} недоступна.`);

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
                delegated: true,
                from: role,
                reason,
            },
            config,
            root,
            env,
            notify,
            runContext,
            maxTurns: spec.maxTurns ?? null,
            depth: depth + 1,
            // The pictures of the caller travel with the work: the role that receives it
            // looks at the same reference the caller looked at.
            parts,
        });
        notify({ type: 'delegate.done', from: role, to: name, turns: result?.turns ?? 0 });

        // The files the delegated role named are written: the disk is the truth.
        const written = [];
        for (const file of Array.isArray(result?.data?.files) ? result.data.files : []) {
            const rel = String(file?.path ?? '').trim();
            const content = typeof file?.content === 'string' ? file.content : null;
            if (!rel || content === null) continue;
            try {
                await writeTextFile({ root, file: rel, content, overwrite: true });
                written.push(rel);
            } catch (error) {
                written.push(`${rel} (не записан: ${error?.message ?? error})`);
            }
        }

        const report = String(result?.text ?? '').trim() || (result?.data?.summary ? String(result.data.summary).trim() : '');
        const lines = [
            `The role ${name} did the work in a separate session: ${result?.turns ?? 0} turns, ${result?.toolCalls?.length ?? 0} calls of tools.`,
            written.length ? `Files: ${written.join(', ')}` : '',
            report ? '' : null,
            report || '(the role said nothing)',
        ].filter((item) => item !== null && item !== '');
        return lines.join('\n');
    };
}
