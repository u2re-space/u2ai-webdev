/**
 * @file src/tui/render.js
 * @module tui/render
 * @purpose Draw the state of the worker as a small terminal dashboard.
 *
 *   The dashboard has three parts: the header with the run and its progress, the
 *   stages on the left, the live output of the worker on the right, and the operator
 *   line at the bottom. The layout is built as plain text first, so it can be tested
 *   without a terminal.
 *
 * @depends cli/stdio
 * @usedBy tui/app
 * @exports truncate, formatStatusRow, createTuiLayout, renderTui
 * @ai.tags tui, terminal, layout
 */

import { sanitizeText } from '../cli/stdio.js';

/**
 * Cut a text to the width of a terminal cell.
 * @param {unknown} value
 * @param {number} width
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function truncate(value, width) {
    const limit = Math.max(0, Math.floor(Number(width) || 0));
    if (!limit) return '';
    const chars = Array.from(sanitizeText(value).replace(/\s+/g, ' ').trim());
    if (chars.length <= limit) return chars.join('');
    if (limit === 1) return '…';
    return `${chars.slice(0, limit - 1).join('')}…`;
}

/**
 * The symbols of the interface.
 * @param {boolean} ascii
 * @returns {object}
 * @ai.hint pure
 */
function symbols(ascii) {
    return ascii
        ? { ok: '+', fail: 'x', skip: '->', run: '>', wait: '...', rule: '-', barFull: '#', barEmpty: '.' }
        : { ok: '✓', fail: '✗', skip: '→', run: '▸', wait: '…', rule: '─', barFull: '█', barEmpty: '░' };
}

/**
 * The rows of the thought of the model.
 *
 * The thought of a model is longer than the screen, and the operator reads what the
 * model thinks now, not what it thought first. The thought is wrapped into the rows of
 * the dashboard at the width of the screen: a line that does not fit wraps in the
 * terminal and pushes the rows of the dashboard down. The first row that was cut away
 * is marked with an ellipsis.
 *
 * @param {unknown} text
 * @param {string} kind `thinking` or `answer`
 * @param {number} cols the width of the screen
 * @param {number} [rows] how many rows the thought takes
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function wrapThought(text, kind = 'thinking', cols = 100, rows = 2) {
    const count = Math.max(1, Math.floor(Number(rows) || 1));
    const body = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!body) return Array.from({ length: count }, () => '');
    const label = kind === 'answer' ? '▸ answer: ' : '▸ thinking: ';
    // Every row is wrapped at the width of the narrowest one: the first row carries the
    // label and the ellipsis, and the next ones carry the indent. A row that does not
    // fit wraps in the terminal and pushes the rows of the dashboard down.
    const width = Math.max(16, cols - label.length - 2);
    const lines = [];
    let current = '';
    for (const word of body.split(' ')) {
        if (!word) continue;
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= width) { current = candidate; continue; }
        if (current) lines.push(current);
        current = word.length <= width ? word : `${word.slice(0, width - 1)}…`;
    }
    if (current) lines.push(current);
    // The newest words are the ones that stay: the thought is read from its end.
    const kept = lines.slice(-count);
    const cut = lines.length > kept.length;
    const out = kept.map((line, index) => {
        const body = cut && index === 0 ? `… ${line}` : line;
        return index === 0 ? `${label}${body}` : `  ${body}`;
    });
    while (out.length < count) out.push('');
    return out;
}

/**
 * The mark of one stage.
 * @param {object} stage
 * @param {object} marks
 * @returns {string}
 * @ai.hint pure
 */
function stageMark(stage, marks) {
    const status = String(stage?.status ?? 'pending');
    if (status === 'completed') return marks.ok;
    if (status === 'failed' || status === 'partial') return marks.fail;
    if (status === 'skipped' || status === 'paused') return marks.skip;
    if (status === 'running') return marks.run;
    return marks.wait;
}

/**
 * Choose the stages that fit into the left pane.
 * @param {object} state
 * @param {number} rows
 * @returns {object[]}
 * @ai.hint pure
 */
function visibleStages(state, rows) {
    const all = Object.values(state?.stages ?? {});
    const active = all.filter((stage) => stage?.status === 'running');
    const seen = all.filter((stage) => stage?.status && stage.status !== 'pending' && stage.status !== 'running');
    const pending = all.filter((stage) => stage?.status === 'pending');
    const out = [];
    const add = (stage) => {
        if (!stage || out.some((item) => item.name === stage.name)) return;
        out.push(stage);
    };
    active.forEach(add);
    seen.slice(-Math.max(1, rows - out.length)).forEach(add);
    for (const stage of pending) {
        if (out.length >= rows) break;
        add(stage);
    }
    return out.slice(0, rows);
}

/**
 * Build the status row shown directly above the operator input.
 *
 * The row is the compact view of the current work: its model, stage, role, effort,
 * mode, plan step and state. A pending question goes first, because the answer of the
 * operator is the most immediate action.
 *
 * @param {object} state
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function formatStatusRow(state) {
    const location = state?.location ?? {};
    const running = Object.values(state?.stages ?? {})
        .find((stage) => stage?.status === 'running');
    const text = (value) => String(value ?? '').trim();
    const fields = [
        `Model: ${text(location.model) || '—'}`,
        `Stage: ${text(location.stage) || text(running?.name) || '—'}`,
        `Role: ${text(location.role) || '—'}`,
        `Effort: ${text(location.effort) || '—'}`,
        `Mode: ${text(location.mode) || '—'}`,
    ];
    if (text(location.step)) fields.push(`Step: ${text(location.step)}`);
    fields.push(`Status: ${text(state?.statusText) || text(state?.status) || 'starting'}`);
    const question = state?.question ?? null;
    if (question) fields.unshift(`Question: ${text(question.question) || 'Input'}`);
    return fields.join(' · ');
}

/**
 * Build the lines of the dashboard.
 *
 * @param {object} state
 * @param {{ width?: number, height?: number, input?: string, ascii?: boolean,
 *   logOffset?: number }} [options]
 * @returns {{ lines: object[], inputRow: number, statusRow: number, progressRow: number }}
 * @exports
 * @ai.hint pure
 */
export function createTuiLayout(state, {
    width = 100,
    height = 30,
    input = '',
    ascii = false,
    logOffset = 0,
} = {}) {
    const wantedWidth = Math.floor(Number(width));
    const wantedHeight = Math.floor(Number(height));
    const cols = Math.max(56, Number.isFinite(wantedWidth) && wantedWidth > 0 ? wantedWidth : 100);
    const rows = Math.max(12, Number.isFinite(wantedHeight) && wantedHeight > 0 ? wantedHeight : 30);
    const marks = symbols(ascii);
    const lines = [];
    const push = (text = '', style = 'normal') => lines.push({ text: String(text), style });

    const observed = Array.isArray(state?.observed) ? state.observed : [];
    const done = observed.filter((name) => {
        const status = state?.stages?.[name]?.status;
        return status && status !== 'pending' && status !== 'running';
    }).length;
    const total = observed.length;
    const barWidth = Math.max(8, Math.min(24, Math.floor(cols * 0.22)));
    const filled = total > 0 ? Math.round((done / total) * barWidth) : 0;
    const bar = `${marks.barFull.repeat(filled)}${marks.barEmpty.repeat(Math.max(0, barWidth - filled))}`;

    const command = String(state?.command || 'run');
    const header = truncate(`ai-webdev · ${command}`, cols);
    push(header, 'title');
    push(truncate(state?.task || 'Preparing the run…', cols), 'dim');
    push(marks.rule.repeat(cols), 'dim');

    const footerRows = 10;
    const headerRows = lines.length;
    const mainRows = Math.max(3, rows - headerRows - footerRows - 1);
    const leftWidth = Math.max(24, Math.min(44, Math.floor(cols * 0.38)));
    const rightWidth = cols - leftWidth - 3;
    const stageRows = visibleStages(state, mainRows);
    const logRows = state?.logs ?? [];
    const maxOffset = Math.max(0, logRows.length - mainRows);
    const offset = Math.min(Math.max(0, Number(logOffset) || 0), maxOffset);
    const firstLog = Math.max(0, logRows.length - mainRows - offset);

    push(`${'Stages'.padEnd(leftWidth)} │ Live log`, 'title');
    push(`${marks.rule.repeat(leftWidth)}─┼─${marks.rule.repeat(Math.max(0, rightWidth))}`, 'dim');

    for (let row = 0; row < mainRows; row += 1) {
        const stage = stageRows[row] ?? null;
        const stageText = stage
            ? `${stageMark(stage, marks)} ${stage.name} — ${stage.title ?? ''}`
            : '';
        const log = logRows[firstLog + row] ?? null;
        const logPrefix = log?.stream === 'stdout' ? '[out] ' : '[log] ';
        const logText = log ? `${logPrefix}${log.line}` : '';
        const left = truncate(stageText, leftWidth).padEnd(leftWidth);
        const right = truncate(logText, rightWidth).padEnd(rightWidth);
        push(`${left} │ ${right}`, 'normal');
    }

    push(marks.rule.repeat(cols), 'dim');
    // The stream of the model: the thought while it thinks, the answer while it writes.
    // Two rows, wrapped at the width of the screen: a line that does not fit pushes the
    // rows of the dashboard down.
    const stream = state?.stream ?? {};
    const streamKind = String(stream.kind ?? '') === 'answer' ? 'answer' : 'thinking';
    for (const row of wrapThought(stream.text, streamKind, cols, 2)) push(row, 'dim');
    const progressText = total > 0 ? `${bar} ${done}/${total}` : `${bar} 0/0`;
    const notice = String(state?.notice ?? '');
    const progressRow = lines.length;
    push(`${truncate(progressText, Math.floor(cols * 0.45))}  ${truncate(notice, Math.floor(cols * 0.5))}`, 'normal');
    const question = state?.question ?? null;
    push(marks.rule.repeat(cols), 'dim');
    const statusRow = lines.length;
    push(truncate(formatStatusRow(state), cols), question ? 'warn' : 'dim');
    push(marks.rule.repeat(cols), 'dim');
    const inputRow = lines.length;
    push(truncate('text: steer · /skip [name] · /help · /quit · Ctrl+C: stop', cols), 'dim');
    push(truncate(`› ${input}`, cols), 'normal');
    return { lines, inputRow, statusRow, progressRow };
}

/**
 * Prepare the frame of the dashboard.
 *
 * The frame is prepared before it is drawn: the rows are built while the run goes on,
 * and the drawing itself only writes the rows that changed. The prepared frame is kept
 * by the shell and reused when nothing moved.
 *
 * @param {object} state
 * @param {{ width?: number, height?: number, input?: string, ascii?: boolean,
 *   logOffset?: number }} [options]
 * @returns {object} the frame: the rows and the place of the input
 * @exports
 * @ai.hint pure
 */
export function prepareTuiFrame(state, {
    width = 100,
    height = 30,
    input = '',
    ascii = false,
    logOffset = 0,
} = {}) {
    const measuredWidth = Math.floor(Number(width));
    const measuredHeight = Math.floor(Number(height));
    const cols = Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : 100;
    const rows = Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : 30;
    return createTuiLayout(state, { width: cols, height: rows, input, ascii, logOffset });
}

/**
 * Draw the dashboard in a terminal.
 *
 * The dashboard is redrawn by the difference: only the rows that changed are written.
 * The whole screen is never cleared — a clear on every frame makes the terminal blink,
 * and the stream of the model paints the frame many times a second.
 *
 * @param {object} term a terminal-kit terminal
 * @param {object} state
 * @param {{ input?: string, ascii?: boolean, logOffset?: number, previous?: object[],
 *   layout?: object }} [options]
 * @returns {object[]} the rows of the frame
 * @exports
 * @ai.hint io
 */
export function renderTui(term, state, {
    input = '',
    ascii = false,
    logOffset = 0,
    previous = null,
    layout = null,
} = {}) {
    const measuredWidth = Math.floor(Number(term?.width));
    const measuredHeight = Math.floor(Number(term?.height));
    const width = Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : 100;
    const height = Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : 30;
    const frame = layout ?? prepareTuiFrame(state, { width, height, input, ascii, logOffset });
    const lines = frame?.lines ?? [];
    const styleNames = { title: 'bold', good: 'green', bad: 'red', warn: 'yellow', dim: 'dim' };
    lines.forEach((line, index) => {
        const old = Array.isArray(previous) ? previous[index] : null;
        // A row that did not change is left alone: the terminal keeps it, and the eye
        // does not see it blink.
        if (old && old.text === line.text && old.style === line.style) return;
        term.moveTo(1, index + 1);
        term.eraseLineAfter();
        const styleName = styleNames[line.style] ?? 'normal';
        const style = typeof term?.[styleName] === 'function' ? term[styleName] : term;
        style(line.text);
    });
    // The rows that the last frame had and this one does not are erased.
    const oldLines = Array.isArray(previous) ? previous : [];
    for (let index = lines.length; index < oldLines.length; index += 1) {
        term.moveTo(1, index + 1);
        term.eraseLineAfter();
    }
    const inputCells = Array.from(String(input ?? '')).length;
    const cursorColumn = Math.min(width, 3 + inputCells);
    term.moveTo(cursorColumn, (frame?.inputRow ?? lines.length - 1) + 2);
    term.hideCursor(false);
    return lines;
}
