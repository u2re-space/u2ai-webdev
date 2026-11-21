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
 * @exports truncate, formatStatusRow, markdownSegments, thoughtLineCount, wrapThought,
 *           THOUGHT_ROWS, createTuiLayout, prepareTuiFrame, renderTui
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
 * How many rows the dashboard gives to the thought of the model.
 * @exports
 */
export const THOUGHT_ROWS = 4;

/**
 * The inline markdown of the stream: the strong, the code and the emphasis.
 * @ai.hint pure
 */
const INLINE_MD = /(\*\*|__)([\s\S]+?)\1|`([^`]+)`|(?<![\w\\])\*([^*\s][^*]*?)\*(?!\w)|(?<![\w\\])_([^_\s][^_]*?)_(?!\w)/g;

/**
 * Cut one text into the inline markdown segments: every segment carries its style.
 *
 * The thought of the model speaks markdown: the strong, the code and the emphasis
 * live in the same line as the ordinary words. The shell takes the marks away and
 * keeps their place, so the row can carry the styles of the pieces.
 *
 * @param {unknown} text
 * @returns {{ text: string, style: string }[]}
 * @exports
 * @ai.hint pure
 */
export function markdownSegments(text) {
    const body = String(text ?? '');
    const out = [];
    const push = (value, style) => {
        if (!value) return;
        const last = out[out.length - 1];
        if (last && last.style === style) last.text += value;
        else out.push({ text: value, style });
    };
    let at = 0;
    for (const match of body.matchAll(INLINE_MD)) {
        const start = match.index ?? 0;
        if (start > at) push(body.slice(at, start), '');
        if (match[2] !== undefined) push(match[2], 'strong');
        else if (match[3] !== undefined) push(match[3], 'code');
        else if (match[4] !== undefined) push(match[4], 'em');
        else push(match[5], 'em');
        at = start + match[0].length;
    }
    if (at < body.length) push(body.slice(at), '');
    return out;
}

/**
 * Wrap the markdown segments of a thought into rows of plain words.
 * @param {string} body the collapsed text of the thought
 * @param {number} width the width of a row
 * @returns {{ text: string, style: string }[][]}
 * @ai.hint pure
 */
function wrapWords(body, width) {
    const words = [];
    for (const segment of markdownSegments(body)) {
        for (const piece of segment.text.split(' ')) {
            if (piece) words.push({ text: piece, style: segment.style || '' });
        }
    }
    const lines = [];
    let current = [];
    let used = 0;
    for (const word of words) {
        let piece = word.text;
        if (piece.length > width) piece = `${piece.slice(0, Math.max(1, width - 1))}…`;
        const cost = current.length ? piece.length + 1 : piece.length;
        if (current.length && used + cost > width) {
            lines.push(current);
            current = [];
            used = 0;
        }
        current.push({ text: piece, style: word.style });
        used += current.length === 1 ? piece.length : piece.length + 1;
    }
    if (current.length) lines.push(current);
    return lines;
}

/**
 * Build one row of the thought from the words of a line.
 * @param {{ text: string, style: string }[]} words
 * @param {{ prefix?: string, head?: string }} [decoration]
 * @returns {{ text: string, segments: { text: string, style: string }[] | null }}
 * @ai.hint pure
 */
function thoughtRow(words, { prefix = '', head = '' } = {}) {
    const segments = [{ text: `${prefix}${head}`, style: '' }];
    let text = `${prefix}${head}`;
    words.forEach((word, index) => {
        const chunk = index === 0 ? word.text : ` ${word.text}`;
        const style = word.style || '';
        const last = segments[segments.length - 1];
        if (last.style === style) last.text += chunk;
        else segments.push({ text: chunk, style });
        text += chunk;
    });
    return { text, segments };
}

/**
 * How many rows the whole thought takes at the width of the screen.
 *
 * The shell keeps the tail of the stream and lets the operator scroll back through
 * it: this count is the bound of that scroll.
 *
 * @param {unknown} text
 * @param {string} [kind]
 * @param {number} [cols]
 * @returns {number}
 * @exports
 * @ai.hint pure
 */
export function thoughtLineCount(text, kind = 'thinking', cols = 100) {
    const body = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!body) return 0;
    const label = kind === 'answer' ? '▸ answer: ' : '▸ thinking: ';
    return wrapWords(body, Math.max(16, cols - label.length - 2)).length;
}

/**
 * The rows of the thought of the model.
 *
 * The thought of a model is longer than the screen, and the operator reads what the
 * model thinks now, not what it thought first. The thought is wrapped into the rows
 * of the dashboard at the width of the screen: a line that does not fit wraps in the
 * terminal and pushes the rows of the dashboard down. The shell shows the last rows
 * of the thought; the `offset` moves the window back through the rows that are cut
 * away, and the first visible row is then marked with an ellipsis. The rows speak
 * markdown: the strong, the code and the emphasis come back as styled segments.
 *
 * @param {unknown} text
 * @param {string} kind `thinking` or `answer`
 * @param {number} cols the width of the screen
 * @param {number} [rows] how many rows the thought takes
 * @param {number} [offset] how many rows the window is moved back from the end
 * @returns {{ text: string, segments: { text: string, style: string }[] | null }[]}
 * @exports
 * @ai.hint pure
 */
export function wrapThought(text, kind = 'thinking', cols = 100, rows = THOUGHT_ROWS, offset = 0) {
    const count = Math.max(1, Math.floor(Number(rows) || 1));
    const body = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!body) return Array.from({ length: count }, () => ({ text: '', segments: null }));
    const label = kind === 'answer' ? '▸ answer: ' : '▸ thinking: ';
    const width = Math.max(16, cols - label.length - 2);
    const lines = wrapWords(body, width);
    const shift = Math.max(0, Math.floor(Number(offset) || 0));
    const start = Math.max(0, lines.length - count - shift);
    const kept = lines.slice(start, start + count);
    const cut = start > 0;
    const out = kept.map((words, index) => thoughtRow(words, {
        prefix: index === 0 ? label : '  ',
        head: cut && index === 0 ? '… ' : '',
    }));
    while (out.length < count) out.push({ text: '', segments: null });
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
 * operator is the most immediate action. When the row has to share its width — with
 * the bar of the progress, for example — the least telling fields give way first: the
 * model, the stage, the effort and the state stay on the screen.
 *
 * @param {object} state
 * @param {{ maxWidth?: number }} [options]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function formatStatusRow(state, { maxWidth = Number.POSITIVE_INFINITY } = {}) {
    const location = state?.location ?? {};
    const running = Object.values(state?.stages ?? {})
        .find((stage) => stage?.status === 'running');
    const text = (value) => String(value ?? '').trim();
    const question = state?.question ?? null;
    const fields = [
        `Model: ${text(location.model) || '—'}`,
        `Stage: ${text(location.stage) || text(running?.name) || '—'}`,
        `Role: ${text(location.role) || '—'}`,
        `Effort: ${text(location.effort) || '—'}`,
        `Mode: ${text(location.mode) || '—'}`,
    ];
    if (text(location.step)) fields.push(`Step: ${text(location.step)}`);
    fields.push(`Status: ${text(state?.statusText) || text(state?.status) || 'starting'}`);
    if (question) fields.unshift(`Question: ${text(question.question) || 'Input'}`);
    const limit = Math.max(0, Math.floor(Number(maxWidth) || 0));
    if (!Number.isFinite(limit)) return fields.join(' · ');
    // The fields give way from the middle outwards: the mode and the step are the first
    // to go, the state and the effort stay as long as they fit.
    const order = ['Mode', 'Step', 'Role', 'Model', 'Stage', 'Effort'];
    const row = () => fields.join(' · ');
    while (row().length > limit && order.some((key) => fields.some((field) => field.startsWith(`${key}: `)))) {
        const drop = order.find((key) => fields.some((field) => field.startsWith(`${key}: `)));
        fields.splice(fields.findIndex((field) => field.startsWith(`${drop}: `)), 1);
    }
    return row();
}

/**
 * Build the lines of the dashboard.
 *
 * @param {object} state
 * @param {{ width?: number, height?: number, input?: string, ascii?: boolean,
 *   logOffset?: number, thoughtOffset?: number }} [options]
 * @returns {{ lines: object[], inputRow: number, statusRow: number, progressRow: number,
 *   thoughtMaxOffset: number }}
 * @exports
 * @ai.hint pure
 */
export function createTuiLayout(state, {
    width = 100,
    height = 30,
    input = '',
    ascii = false,
    logOffset = 0,
    thoughtOffset = 0,
} = {}) {
    const wantedWidth = Math.floor(Number(width));
    const wantedHeight = Math.floor(Number(height));
    const cols = Math.max(56, Number.isFinite(wantedWidth) && wantedWidth > 0 ? wantedWidth : 100);
    const rows = Math.max(12, Number.isFinite(wantedHeight) && wantedHeight > 0 ? wantedHeight : 30);
    const marks = symbols(ascii);
    const lines = [];
    const push = (text = '', style = 'normal') => lines.push({ text: String(text), style });

    // The bar of the progress counts the whole plan of the run: the stages that have not
    // started yet belong to the total, so the bar only fills when the run is truly over.
    const allStages = Object.values(state?.stages ?? {});
    const done = allStages.filter((stage) => stage?.status
        && stage.status !== 'pending' && stage.status !== 'running').length;
    const total = allStages.length;
    const barWidth = Math.max(6, Math.min(16, Math.floor(cols * 0.12)));
    const filled = total > 0 ? Math.round((done / total) * barWidth) : 0;
    const bar = `${marks.barFull.repeat(filled)}${marks.barEmpty.repeat(Math.max(0, barWidth - filled))}`;

    const command = String(state?.command || 'run');
    const header = truncate(`ai-webdev · ${command}`, cols);
    push(header, 'title');
    push(truncate(state?.task || 'Preparing the run…', cols), 'dim');
    push(marks.rule.repeat(cols), 'dim');

    const footerRows = 11;
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
    // Four rows, wrapped at the width of the screen and speaking markdown. The window
    // follows the end of the thought; the operator moves it back through the thought
    // with the scroll of the shell.
    const stream = state?.stream ?? {};
    const streamKind = String(stream.kind ?? '') === 'answer' ? 'answer' : 'thinking';
    const thoughtMaxOffset = Math.max(0, thoughtLineCount(stream.text, streamKind, cols) - THOUGHT_ROWS);
    const thoughtShift = Math.min(Math.max(0, Number(thoughtOffset) || 0), thoughtMaxOffset);
    for (const row of wrapThought(stream.text, streamKind, cols, THOUGHT_ROWS, thoughtShift)) {
        lines.push({ text: row.text, style: 'dim', segments: row.segments });
    }
    push(marks.rule.repeat(cols), 'dim');
    // The last word of the run: a file that was written, a warning, a wait. It lives on
    // its own row above the status, so the bar and the state stay readable.
    const notice = String(state?.notice ?? '');
    const progressRow = lines.length;
    push(truncate(notice, cols), 'normal');
    const question = state?.question ?? null;
    // The status and the state of the run share one row with the bar of the progress:
    // the operator reads how far the run went and where it stands in one glance. The
    // fields of the row give way before the state is cut away.
    const statusRow = lines.length;
    const progressText = total > 0 ? `${bar} ${done}/${total}` : `${bar} 0/0`;
    const statusWidth = Math.max(0, cols - progressText.length - 3);
    push(truncate(`${progressText} · ${formatStatusRow(state, { maxWidth: statusWidth })}`, cols), question ? 'warn' : 'dim');
    push(marks.rule.repeat(cols), 'dim');
    const inputRow = lines.length;
    push(truncate('text: steer · /skip [name] · Shift+↑/↓: thought · /help · /quit · Ctrl+C: stop', cols), 'dim');
    push(truncate(`› ${input}`, cols), 'normal');
    return { lines, inputRow, statusRow, progressRow, thoughtMaxOffset };
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
 *   logOffset?: number, thoughtOffset?: number }} [options]
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
    thoughtOffset = 0,
} = {}) {
    const measuredWidth = Math.floor(Number(width));
    const measuredHeight = Math.floor(Number(height));
    const cols = Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : 100;
    const rows = Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : 30;
    return createTuiLayout(state, { width: cols, height: rows, input, ascii, logOffset, thoughtOffset });
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
 * @param {{ input?: string, ascii?: boolean, logOffset?: number, thoughtOffset?: number,
 *   previous?: object[], layout?: object }} [options]
 * @returns {object[]} the rows of the frame
 * @exports
 * @ai.hint io
 */
export function renderTui(term, state, {
    input = '',
    ascii = false,
    logOffset = 0,
    thoughtOffset = 0,
    previous = null,
    layout = null,
} = {}) {
    const measuredWidth = Math.floor(Number(term?.width));
    const measuredHeight = Math.floor(Number(term?.height));
    const width = Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : 100;
    const height = Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : 30;
    const frame = layout ?? prepareTuiFrame(state, { width, height, input, ascii, logOffset, thoughtOffset });
    const lines = frame?.lines ?? [];
    const styleNames = { title: 'bold', good: 'green', bad: 'red', warn: 'yellow', dim: 'dim' };
    const segmentStyles = { strong: 'bold', em: 'italic', code: 'cyan' };
    lines.forEach((line, index) => {
        const old = Array.isArray(previous) ? previous[index] : null;
        // A row that did not change is left alone: the terminal keeps it, and the eye
        // does not see it blink. The pieces of a markdown row must match piece by piece.
        const sameSegments = Array.isArray(line.segments)
            ? Array.isArray(old?.segments)
                && old.segments.length === line.segments.length
                && line.segments.every((segment, at) => segment.text === old.segments[at]?.text
                    && segment.style === old.segments[at]?.style)
            : !Array.isArray(old?.segments);
        if (old && old.text === line.text && old.style === line.style && sameSegments) return;
        term.moveTo(1, index + 1);
        term.eraseLineAfter();
        if (Array.isArray(line.segments) && line.segments.length) {
            // The pieces of the markdown: every piece carries its own style, and the
            // styles of the thought live next to the ordinary words of the row.
            for (const segment of line.segments) {
                const styleName = segmentStyles[segment.style] ?? 'normal';
                const paint = typeof term?.[styleName] === 'function' ? term[styleName] : term;
                paint(segment.text);
            }
            return;
        }
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
