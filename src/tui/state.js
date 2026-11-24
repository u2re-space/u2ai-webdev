/**
 * @file src/tui/state.js
 * @module tui/state
 * @purpose The pure state of the graphical shell.
 *
 *   The shell does not draw from the worker's text. It folds the protocol frames and
 *   the live output of the worker into one state: the stages, the progress, the log,
 *   the pending question and the final result. The reducer is pure so every part of
 *   the interface can be tested without a terminal.
 *
 *   The sub-agents are part of the state too: a sub-agent is a separate thread of the
 *   run, and the operator has to see it — how many there are, which role each of them
 *   inherited and what it is doing right now.
 *
 * @depends none
 * @usedBy tui/app, tui/render
 * @exports LOG_LIMIT, STREAM_LIMIT, SUBAGENT_LIMIT, createTuiState, reduceTuiState,
 *          subagentLines
 * @ai.tags tui, state, reducer
 */

import { STAGES } from '../stages/index.js';

/** How many lines the shell keeps in memory. */
export const LOG_LIMIT = 1000;

/** How much of the stream of the model the shell keeps for the scroll of the thought. */
export const STREAM_LIMIT = 4000;

/** How many sub-agents the shell shows at once. */
export const SUBAGENT_LIMIT = 4;

/**
 * The initial state of the shell.
 * @param {{ command?: string, task?: string }} [options]
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function createTuiState({ command = '', task = '' } = {}) {
    const stages = {};
    for (const stage of STAGES) {
        stages[stage.name] = {
            name: stage.name,
            title: stage.title,
            status: 'pending',
        };
    }
    return {
        command: String(command ?? ''),
        task: String(task ?? ''),
        status: 'starting',
        exitCode: null,
        pid: null,
        protocol: null,
        stages,
        observed: [],
        logs: [],
        outputs: [],
        // The sub-agents of the run: the threads that work beside the main one. The shell
        // shows them, so a run that is busy in three places does not look like a run that
        // stands still.
        subagents: [],
        question: null,
        location: null,
        statusText: '',
        progress: null,
        plan: null,
        summary: null,
        notice: '',
        // The live text of the model: the thought while it thinks, the answer while it
        // writes. The shell shows it in one line that is redrawn, not in the log.
        stream: { kind: '', text: '', fresh: true },
        startedAt: new Date().toISOString(),
        finishedAt: null,
    };
}

/**
 * Add one line to a bounded list.
 * @param {object[]} list
 * @param {object} item
 * @returns {object[]}
 * @ai.hint pure
 */
function appendLimited(list, item) {
    const next = [...list, item];
    return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
}

/**
 * Add a stage to the observed list of the run.
 * @param {object} state
 * @param {string} name
 * @returns {object[]}
 * @ai.hint pure
 */
function observeStage(state, name) {
    const key = String(name ?? '').trim();
    if (!key || state.observed.includes(key)) return state.observed;
    return [...state.observed, key];
}

/**
 * Update one stage of the run.
 * @param {object} state
 * @param {string} name
 * @param {string} status
 * @param {string} [title]
 * @returns {object}
 * @ai.hint pure
 */
function withStage(state, name, status, title = '') {
    const key = String(name ?? '').trim();
    if (!key) return state;
    const old = state.stages[key] ?? { name: key, title: String(title ?? ''), status: 'pending' };
    return {
        ...state,
        observed: observeStage(state, key),
        stages: {
            ...state.stages,
            [key]: { ...old, title: String(title ?? '') || old.title, status: String(status ?? 'pending') },
        },
    };
}

/**
 * The number of finished and observed stages.
 * @param {object} state
 * @returns {{ done: number, total: number }}
 * @ai.hint pure
 */
export function stageProgress(state) {
    const observed = Array.isArray(state?.observed) ? state.observed : [];
    let done = 0;
    for (const name of observed) {
        const status = state?.stages?.[name]?.status;
        if (status && status !== 'pending' && status !== 'running') done += 1;
    }
    return { done, total: observed.length };
}

/**
 * Add a sub-agent to the list of the state.
 *
 * The list keeps the sub-agents of the run in the order they were started: the newest
 * one is the last, and the finished ones stay until there are more than the shell shows.
 *
 * @param {object} state
 * @param {object} subagent the sub-agent
 * @returns {object[]}
 * @ai.hint pure
 */
function withSubagent(state, subagent) {
    const list = Array.isArray(state?.subagents) ? state.subagents : [];
    const name = String(subagent?.name ?? '').trim();
    if (!name) return list;
    const at = list.findIndex((item) => item?.name === name);
    if (at < 0) return [...list, { ...subagent, name }];
    const next = [...list];
    next[at] = { ...next[at], ...subagent, name };
    return next;
}

/**
 * The lines of the sub-agents: one line per thread, the newest first.
 *
 * @param {object} state
 * @param {number} [limit] how many lines
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function subagentLines(state, limit = SUBAGENT_LIMIT) {
    const list = Array.isArray(state?.subagents) ? state.subagents : [];
    const rows = Math.max(0, Math.floor(Number(limit) || 0));
    return list
        .slice(-rows)
        .reverse()
        .map((item) => {
            const role = String(item?.role ?? '').trim() || 'subagent';
            const status = String(item?.status ?? '').trim() || 'working';
            const turn = Number.isInteger(item?.turn) && item.turn > 0 ? ` · turn ${item.turn}` : '';
            const tools = Array.isArray(item?.tools) && item.tools.length ? ` · ${item.tools.join(', ')}` : '';
            return `${role}: ${status}${turn}${tools}`;
        });
}

/**
 * Fold one worker event into the state.
 * @param {object} state
 * @param {object} event
 * @returns {object}
 * @ai.hint pure
 */
function reduceEvent(state, event) {
    const type = String(event?.type ?? '');
    if (type === 'stage.start') {
        const next = withStage(state, event.stage, 'running', event.title);
        const location = { ...(next.location ?? {}) };
        if (location.stage === String(event.stage ?? '')) return next;
        // The place of the run moves with the stage: the role, the step and the effort
        // of the last stage are not the ones of this one until their role reports them.
        delete location.role;
        delete location.step;
        delete location.effort;
        location.stage = String(event.stage ?? '');
        return { ...next, location };
    }
    if (type === 'stage.done') {
        const next = withStage(state, event.stage, event.status ?? 'completed');
        return { ...next, notice: `${String(event.stage ?? 'stage')}: ${String(event.status ?? 'completed')}` };
    }
    if (type === 'stage.skip') {
        return withStage(state, event.stage, 'skipped');
    }
    if (type === 'plan') {
        return { ...state, plan: event.payload ?? event.plan ?? null };
    }
    if (type === 'progress') {
        const payload = event.payload ?? event.progress ?? null;
        // The progress of the run on the disk is the truth of the run: a resume carries
        // the stages that ran before this shell was born, and the bar takes them in.
        let next = { ...state, progress: payload };
        for (const stage of Array.isArray(payload?.stages) ? payload.stages : []) {
            const name = String(stage?.name ?? '').trim();
            const status = String(stage?.status ?? '').trim();
            if (!name || !status) continue;
            next = withStage(next, name, status);
        }
        return next;
    }
    if (type === 'summary') {
        const report = event.payload ?? event.report ?? null;
        const status = String(report?.status ?? '');
        return {
            ...state,
            summary: report,
            status: status === 'completed' ? 'completed' : (status ? status : state.status),
        };
    }
    if (type === 'files') {
        const files = Array.isArray(event.payload?.files) ? event.payload.files : [];
        return { ...state, notice: files.length ? `Files: ${files.join(', ')}` : state.notice };
    }
    if (type === 'warning') {
        const text = String(event.payload?.text ?? event.text ?? event.payload?.message ?? event.message ?? '');
        return text ? { ...state, notice: text } : state;
    }
    if (type === 'error') {
        const text = String(event.payload?.text ?? event.text ?? event.payload?.message ?? event.message ?? '');
        return text ? { ...state, notice: text } : state;
    }
    if (type === 'role.done') {
        const role = String(event.role ?? 'role');
        const stopped = String(event.stopped ?? 'completed');
        // The thought of the role stays on the screen: it is the last thing the model
        // said. The next role starts its own stream.
        return { ...state, notice: `${role}: ${stopped}`, stream: { ...state.stream, fresh: true } };
    }
    if (type === 'subagent.start') {
        // A sub-agent starts: a separate thread that inherits a role of the run.
        const to = String(event.to ?? '').trim() || 'subagent';
        const from = String(event.from ?? '').trim();
        const subagents = withSubagent(state, {
            name: `${from || 'run'}→${to}`,
            role: to,
            from,
            status: 'working',
            turn: 0,
            tools: [],
            task: String(event.task ?? ''),
        });
        const notice = from
            ? `The sub-agent of the role ${to} starts (handed over by ${from}): ${String(event.task ?? '')}`
            : `The sub-agent of the role ${to} starts: ${String(event.task ?? '')}`;
        return { ...state, subagents, notice };
    }
    if (type === 'subagent.status') {
        // The state of a sub-agent: which turn it is on and what it is doing.
        const inner = event.event ?? {};
        const to = String(inner.role ?? event.to ?? '').trim() || 'subagent';
        const from = String(inner.from ?? event.from ?? '').trim();
        const subagents = withSubagent(state, {
            name: `${from || 'run'}→${to}`,
            role: to,
            from,
            status: String(inner.status ?? 'working'),
            turn: Number.isInteger(inner.turn) ? inner.turn : 0,
            tools: Array.isArray(inner.tools) ? inner.tools : [],
        });
        return { ...state, subagents };
    }
    if (type === 'subagent.done') {
        const to = String(event.to ?? '').trim() || 'subagent';
        const from = String(event.from ?? '').trim();
        const files = Array.isArray(event.files) ? event.files : [];
        const subagents = withSubagent(state, {
            name: `${from || 'run'}→${to}`,
            role: to,
            from,
            status: event.ok === true ? 'done' : 'not verified',
            turn: Number.isInteger(event.turns) ? event.turns : 0,
            tools: [],
            files,
        });
        const notice = `The sub-agent of the role ${to} ${event.ok === true ? 'is done' : 'is not confirmed'}: `
            + `${event.turns ?? 0} turns${files.length ? `; files: ${files.join(', ')}` : ''}`;
        return { ...state, subagents, notice };
    }
    if (type === 'role.tool' || type === 'reasoning.start' || type === 'message.start') {
        // A new turn begins: the thought of the last one is over. It stays on the screen
        // until the first piece of the new one comes — the row never blinks empty.
        return { ...state, stream: { ...state.stream, fresh: true } };
    }
    if (type === 'reasoning.delta' || type === 'text.delta') {
        // The stream of the model comes as pieces. The shell keeps the tail of it in one
        // place: the dashboard redraws that line, so the stream does not become a wall
        // of lines in the log.
        const kind = type === 'reasoning.delta' ? 'thinking' : 'answer';
        const text = String(event.text ?? '');
        const current = state.stream ?? {};
        // The answer is not the thought, and the thought of the next turn is not the
        // thought of this one: the row starts over.
        const fresh = current.kind !== kind || current.fresh === true;
        const joined = fresh ? text : `${current.text ?? ''}${text}`;
        return {
            ...state,
            // The tail of the stream stays on the disk of the state: the operator scrolls
            // back through the thought, so the shell keeps more than one screen of it.
            stream: {
                kind,
                text: joined.length > STREAM_LIMIT ? joined.slice(joined.length - STREAM_LIMIT) : joined,
                fresh: false,
            },
        };
    }
    if (type === 'request.wait') {
        const seconds = Number(event.seconds ?? Math.round(Number(event.elapsedMs ?? 0) / 1000));
        return { ...state, notice: `thinking (${seconds}s)` };
    }
    if (type === 'request.retry' || type === 'request.error' || type === 'stream.error') {
        const text = String(event.error ?? event.message ?? 'request failed');
        return { ...state, notice: text };
    }
    return state;
}

/**
 * Reduce one action of the shell.
 *
 * An action is either a protocol frame or a line of the worker's ordinary output.
 *
 * @param {object} state
 * @param {{ type: string, frame?: object, stream?: string, line?: string }} action
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function reduceTuiState(state, action) {
    const current = state ?? createTuiState();
    const type = String(action?.type ?? '');
    if (type === 'log' || type === 'output') {
        const line = String(action.line ?? '').replace(/\r$/, '');
        if (!line.trim()) return current;
        const item = { at: new Date().toISOString(), stream: action.stream ?? 'stderr', line };
        const logs = appendLimited(current.logs, item);
        if (type === 'output') return { ...current, logs, outputs: appendLimited(current.outputs, item) };
        return { ...current, logs };
    }
    if (type === 'answer') {
        return { ...current, question: null };
    }
    if (type !== 'frame') return current;

    const frame = action.frame ?? {};
    if (frame.type === 'ready') {
        return { ...current, status: 'running', pid: frame.pid ?? null, protocol: frame.v ?? null };
    }
    if (frame.type === 'event') {
        return reduceEvent(current, frame.event ?? {});
    }
    if (frame.type === 'question') {
        return {
            ...current,
            question: {
                id: String(frame.id ?? ''),
                kind: String(frame.kind ?? 'question'),
                question: String(frame.question ?? ''),
            },
            notice: '',
        };
    }
    if (frame.type === 'status') {
        return {
            ...current,
            location: frame.location ?? current.location,
            // The frame of the place of the run carries no word about the state: the last
            // spoken state stays on the screen instead of going empty.
            statusText: String(frame.status ?? '').trim() || current.statusText,
        };
    }
    if (frame.type === 'error') {
        return {
            ...current,
            status: 'failed',
            notice: String(frame.message ?? 'worker error'),
            finishedAt: new Date().toISOString(),
        };
    }
    if (frame.type === 'result') {
        const code = Number(frame.code ?? 0);
        return {
            ...current,
            status: code === 0 ? 'completed' : 'failed',
            exitCode: code,
            question: null,
            finishedAt: new Date().toISOString(),
        };
    }
    return current;
}
