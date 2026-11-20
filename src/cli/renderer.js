/**
 * @file src/cli/renderer.js
 * @module cli/renderer
 * @purpose The renderer of the CLI: the plan, the stages, the files, the tools, the
 *          warnings and the progress of a run.
 *
 *   Four modes:
 *   tty   — the colors and the symbols, the status of the stages on stderr.
 *   plain — the same without the colors: the output is a pipe or a file.
 *   json  — one json object per line on stdout, nothing else.
 *   quiet — only the result of the run on stdout and the errors on stderr.
 *
 * @depends cli/colors, cli/stdio
 * @usedBy cli, cli/run, cli/jobs, cli/memory
 * @exports detectMode, createRenderer, SYMBOLS, ASCII_SYMBOLS
 * @ai.tags cli, renderer, terminal
 * @ai.hint keep
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the modes, the symbols and the blocks.
 */

import { createColors } from './colors.js';
import { sanitizeText } from './stdio.js';
import { formatBridgeLine } from '../shared/child-log.js';
import { createInputChannel } from './input.js';

/** The symbols of the status lines. */
export const SYMBOLS = Object.freeze({
    action: '▸',
    ok: '✓',
    fail: '✗',
    warn: '⚠',
    info: '·',
    skip: '→',
});

/** The symbols for a terminal that does not know the unicode ones. */
export const ASCII_SYMBOLS = Object.freeze({
    action: '>',
    ok: '+',
    fail: 'x',
    warn: '!',
    info: '-',
    skip: '->',
});

/**
 * The mode of the output: json, quiet, tty or plain.
 *
 * @param {{ json?: boolean, quiet?: boolean, stdout?: object, stderr?: object }} [options]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function detectMode({
    json = false,
    quiet = false,
    stdout = process.stdout,
    stderr = process.stderr,
} = {}) {
    if (json) return 'json';
    if (quiet) return 'quiet';
    return stderr?.isTTY && stdout?.isTTY ? 'tty' : 'plain';
}

/**
 * Create the renderer of the CLI.
 *
 * @param {{ mode?: string, stdout?: object, stderr?: object, colors?: object,
 *   ascii?: boolean, verbose?: boolean, input?: object|null }} [options]
 * @returns {object} the renderer
 * @exports
 * @ai.hint io
 */
export function createRenderer({
    mode = detectMode(),
    stdout = process.stdout,
    stderr = process.stderr,
    colors = null,
    ascii = false,
    verbose = false,
    stdin = process.stdin,
    inputEnabled = false,
    input: inputOverride = null,
    echoThought = true,
} = {}) {
    const paint = colors ?? createColors(mode === 'tty');
    const symbols = ascii ? ASCII_SYMBOLS : SYMBOLS;
    const json = mode === 'json';
    const quiet = mode === 'quiet';
    const input = inputOverride ?? (inputEnabled
        ? createInputChannel({ stdin, output: stderr, interactive: mode === 'tty' })
        : null);
    const terminalWrite = (text) => input ? input.log(text) : stderr.write(text);

    // The stream of the model: the thought comes as pieces, one after another. The
    // pieces are collected here and written as blocks, so the log of the run has a
    // line per block of the thought and not a line per token.
    let thought = '';
    let thoughtAt = Date.now();

    /**
     * How long a block of the thought waits before it is written.
     *
     * A model that thinks for minutes without a word must still show that it works:
     * the block is written while the thought grows, not only when it ends.
     * @type {number}
     * @ai.hint pure
     */
    const THOUGHT_FLUSH_MS = 5_000;

    /**
     * Write one line on stdout.
     * @param {string} text
     * @returns {void}
     */
    const out = (text) => {
        if (quiet) return;
        stdout.write(`${sanitizeText(text)}\n`);
    };

    /**
     * Write one line on stderr.
     * @param {string} text
     * @returns {void}
     */
    const err = (text) => {
        if (quiet) return;
        terminalWrite(`${sanitizeText(text)}\n`);
    };

    /**
     * Write the thought of the model as lines of blocks.
     *
     * The stream of the model comes as pieces. The pieces are collected and written
     * in blocks: a long thought is written while it grows, so the terminal shows that
     * the model works, and the log of the run has a line per block and not a line per
     * token. Nothing of the thought is lost: a long thought becomes several blocks.
     * @param {string} text
     * @returns {void}
     */
    const writeThought = (text) => {
        const body = String(text ?? '').replace(/\s+/g, ' ').trim();
        if (!body || json || !echoThought) return; // The json carries every piece of the stream on its own.
        for (let at = 0; at < body.length; at += 400) {
            err(paint.dim(`${symbols.info} thinking: ${body.slice(at, at + 400)}`));
        }
    };

    /**
     * Write the thought of the model as it stands and empty the buffer.
     * @returns {void}
     */
    const flushThought = () => {
        if (!thought) return;
        const body = thought;
        thought = '';
        thoughtAt = Date.now();
        writeThought(body);
    };

    /**
     * Write the thought of the model while it grows, so the terminal shows that the
     * model works even when the thought lasts minutes.
     * @returns {void}
     */
    const trimThought = () => {
        const now = Date.now();
        const grown = thought.length > 900;
        const waited = now - thoughtAt > THOUGHT_FLUSH_MS;
        if (!grown && !waited) return;
        const body = thought;
        thought = '';
        thoughtAt = now;
        writeThought(body);
    };

    /**
     * Write one json event on stdout.
     * @param {string} type
     * @param {object} payload
     * @returns {void}
     */
    const emit = (type, payload = {}) => {
        stdout.write(`${JSON.stringify({ time: new Date().toISOString(), type, ...payload })}\n`);
    };

    /**
     * The text of a file list.
     * @param {string[]} files
     * @returns {string}
     */
    const fileList = (files) => (Array.isArray(files) ? files : []).map(String).filter(Boolean);

    /**
     * The one line of a tool call: what the call touches.
     *
     * The name of the tool alone says nothing: "read_file" does not tell which file is
     * read and "run_command" does not tell which program runs. The line names the thing.
     * @param {object|null} detail the arguments of the call
     * @returns {string}
     */
    const toolSummary = (detail) => {
        if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return '';
        const one = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
        if (typeof detail.command === 'string' && detail.command.trim()) {
            const args = Array.isArray(detail.args) ? detail.args.map(one).filter(Boolean) : [];
            return one(`${detail.command} ${args.join(' ')}`).slice(0, 110);
        }
        for (const key of ['path', 'file', 'query', 'name', 'url', 'prompt', 'ids', 'args']) {
            const value = detail[key];
            if (typeof value === 'string' && value.trim()) return one(value).slice(0, 110);
            if (Array.isArray(value) && value.length) return one(value.map(one).join(' ')).slice(0, 110);
        }
        return '';
    };

    return {
        mode,
        colors: paint,
        verbose,
        input,
        get interactive() { return Boolean(input); },

        /**
         * A line of the answer: the text of the run.
         * @param {string} text
         * @returns {void}
         */
        note(text) {
            const body = String(text ?? '');
            if (json) { emit('text', { text: body }); return; }
            stdout.write(body.endsWith('\n') ? body : `${body}\n`);
        },

        /**
         * A title of a block.
         * @param {string} text
         * @returns {void}
         */
        heading(text) {
            if (json) { emit('heading', { text: String(text ?? '') }); return; }
            out(`${paint.bold(String(text ?? ''))}`);
        },

        /**
         * The plan of the work.
         * @param {object} plan
         * @returns {void}
         */
        plan(plan) {
            const steps = Array.isArray(plan?.steps) ? plan.steps : [];
            if (json) { emit('plan', { plan }); return; }
            const summary = String(plan?.summary ?? '').trim();
            if (summary) {
                if (quiet) stdout.write(`${sanitizeText(summary)}\n`);
                else out(`${paint.bold('Plan')}: ${summary}`);
            }
            steps.forEach((step, index) => {
                const role = step?.role ? ` ${paint.dim(`(${step.role})`)}` : '';
                const line = `  ${index + 1}. ${step?.id ?? 'step'} — ${step?.title ?? ''}${role}`;
                if (quiet) stdout.write(`${sanitizeText(line)}\n`);
                else out(line);
            });
        },

        /**
         * The list of the stages of the pipeline.
         * @param {object[]} stages
         * @returns {void}
         */
        stages(stages) {
            const list = Array.isArray(stages) ? stages : [];
            if (json) { emit('stages', { stages: list }); return; }
            for (const stage of list) {
                const title = stage?.title ?? '';
                const line = `  ${stage?.name ?? ''}${title ? ` — ${title}` : ''}`;
                if (quiet) stdout.write(`${sanitizeText(line)}\n`);
                else out(line);
            }
        },

        /**
         * A stage has started.
         * @param {string} name
         * @param {string} [title]
         * @returns {void}
         */
        stageStart(name, title = '') {
            if (json) { emit('stage.start', { stage: name, title }); return; }
            err(`${paint.cyan(symbols.action)} ${name}${title ? ` — ${title}` : ''}`);
        },

        /**
         * A stage is done.
         * @param {string} name
         * @param {string} [status] completed, failed or skipped
         * @returns {void}
         */
        stageDone(name, status = 'completed') {
            if (json) { emit('stage.done', { stage: name, status }); return; }
            if (status === 'completed') err(`${paint.green(symbols.ok)} ${name}`);
            else if (status === 'skipped') err(`${paint.dim(symbols.skip)} ${name} (skipped)`);
            else err(`${paint.red(symbols.fail)} ${name} (${status})`);
        },

        /**
         * The answer of a tool: what the call gave back.
         * @param {object} [detail]
         * @returns {void}
         */
        toolResult(detail = null) {
            const text = String(detail?.output ?? '').replace(/\s+/g, ' ').trim();
            if (!text) return;
            if (json) { emit('tool.result', { name: detail?.name ?? '', output: text }); return; }
            err(`${paint.dim(`  → ${text.slice(0, 140)}`)}`);
        },

        /**
         * A tool of a role has been called.
         * @param {string} name
         * @param {object} [detail] the arguments of the call
         * @returns {void}
         */
        tool(name, detail = null) {
            if (json) { emit('tool', { name, detail }); return; }
            const text = toolSummary(detail);
            err(`${paint.dim(`${symbols.info} ${name}${text ? ` ${text}` : ''}`)}`);
        },

        /**
         * The run waits for the model.
         *
         * A thinking model works for minutes without a word. The line says that the run
         * is alive, so the silence of the terminal is not read as a hang.
         * @param {number} [elapsedMs] how long the request has been in flight
         * @returns {void}
         */
        wait(elapsedMs = 0) {
            const ms = Number(elapsedMs);
            const seconds = Number.isFinite(ms) ? Math.max(1, Math.round(ms / 1000)) : 0;
            if (json) { emit('wait', { elapsedMs: ms, seconds }); return; }
            err(`${paint.dim(`${symbols.info} thinking (${seconds}s)`)}`);
        },

        /**
         * A request failed and is repeated.
         * @param {object} [detail]
         * @returns {void}
         */
        retry(detail = null) {
            const attempt = detail?.attempt ?? null;
            const error = String(detail?.error ?? '');
            if (json) { emit('retry', { attempt, error }); return; }
            err(`${paint.dim(`${symbols.info} retry${attempt ? ` ${attempt}` : ''}${error ? `: ${error}` : ''}`)}`);
        },

        /**
         * The files the run touched.
         * @param {string[]} files
         * @returns {void}
         */
        files(files) {
            const list = fileList(files);
            if (json) { emit('files', { files: list }); return; }
            if (!list.length) return;
            out(`${paint.bold('Files')}: ${list.join(', ')}`);
        },

        /**
         * A warning of the run.
         * @param {string} text
         * @returns {void}
         */
        warning(text) {
            if (json) { emit('warning', { text: String(text ?? '') }); return; }
            err(`${paint.yellow(symbols.warn)} ${text}`);
        },

        /**
         * A line of the log of a sibling CLI.
         *
         * The line goes to stderr: the stdout of the run carries the answer of the run,
         * and a line of a child is not a part of it. The error of the child is yellow: it
         * is the child's own stderr.
         * @param {string} name the name of the child
         * @param {string} line the line of the child
         * @param {string} [stream] `stdout` or `stderr`
         * @returns {void}
         */
        bridge(name, line, stream = 'stdout') {
            if (json) { emit('bridge.log', { name: String(name ?? ''), stream, line: String(line ?? '') }); return; }
            const text = formatBridgeLine(name, line);
            if (!text) return;
            if (stream === 'stderr') err(`${paint.yellow(`${symbols.info} ${text}`)}`);
            else err(`${paint.dim(`${symbols.info} ${text}`)}`);
        },

        /**
         * The progress of the run.
         * @param {object} progress
         * @returns {void}
         */
        progress(progress) {
            if (json) { emit('progress', { progress }); return; }
            const stages = Array.isArray(progress?.stages) ? progress.stages : [];
            const done = stages.filter((stage) => stage?.status === 'completed').length;
            const files = fileList((progress?.files ?? []).map((file) => file?.path ?? file));
            const head = `Progress: ${done}/${stages.length} stages — ${progress?.stage ?? 'start'}`;
            out(`${paint.bold(head)}${files.length ? `, ${files.length} files` : ''}`);
        },

        /**
         * The result of the run.
         * @param {object} report
         * @returns {void}
         */
        summary(report) {
            if (json) { emit('summary', { report }); return; }
            const status = String(report?.status ?? 'completed');
            const label = status === 'completed'
                ? paint.green('completed')
                : (status === 'paused' ? paint.yellow('paused') : (status === 'partial' ? paint.yellow('partial') : paint.red(status)));
            const lines = [`${paint.bold('Run')} ${report?.runId ?? ''}: ${label}`];
            for (const stage of Array.isArray(report?.stages) ? report.stages : []) {
                const mark = stage?.status === 'completed' ? symbols.ok
                    : (stage?.status === 'skipped' ? symbols.skip : symbols.fail);
                lines.push(`  ${mark} ${stage?.name ?? ''} — ${stage?.status ?? ''}`);
            }
            const files = fileList((report?.progress?.files ?? []).map((file) => file?.path ?? file));
            if (files.length) lines.push(`  files: ${files.join(', ')}`);
            if (report?.file) lines.push(`  progress: ${report.file}`);
            if (report?.error) lines.push(`  error: ${report.error}`);
            const text = lines.join('\n');
            if (quiet) {
                stdout.write(`${sanitizeText(`Run ${report?.runId ?? ''}: ${status}`)}\n`);
                return;
            }
            stdout.write(`${sanitizeText(text)}\n`);
        },

        /**
         * An error of the command.
         * @param {string} text
         * @returns {void}
         */
        error(text) {
            if (json) { emit('error', { text: String(text ?? '') }); return; }
            terminalWrite(`ai-webdev: ${sanitizeText(text)}\n`);
        },

        /**
         * An event of the pipeline.
         *
         * The pipeline tells the renderer what happens; the renderer decides how it
         * looks. An event nobody knows is ignored.
         *
         * @param {object} event
         * @returns {void}
         */
        event(event) {
            const type = String(event?.type ?? '');
            if (type === 'stage.start') { flushThought(); this.stageStart(event.stage, event.title); }
            else if (type === 'stage.done') { flushThought(); this.stageDone(event.stage, event.status); }
            else if (type === 'stage.skip') this.stageDone(event.stage, 'skipped');
            else if (type === 'stage.shot') {
                this.note(`снимок страницы: ${event.path ?? ''}${event.width ? ` (${event.width}x${event.height})` : ''}`);
            }
            else if (type === 'stage.compare') {
                // The comparison of the page with the reference: the run shows it, so the
                // person watching sees that the reference was looked at and what it said.
                this.note(`сверка с референсом ${event.reference ?? ''}: PPI ${event.dpr ?? '?'}x, `
                    + `ширина дизайна ${event.designWidth ?? '?'}x${event.designHeight ?? '?'} CSS px`);
                this.note(`  сходство ${event.similarity ?? '?'}%, RMSE ${event.rmse?.toFixed?.(4) ?? '?'}, `
                    + `SSIM ${event.ssim?.toFixed?.(4) ?? '?'}`);
                if (event.difference) this.note(`  картинка различий: ${event.difference}`);
            }
            else if (type === 'role.tool') { flushThought(); this.tool(event.name, event.arguments ?? null); }
            else if (type === 'role.tool.result') { flushThought(); this.toolResult(event); }
            else if (type === 'reasoning.delta') {
                // The thinking of the model, while it thinks: the stage is alive, and the
                // silence of the terminal is not the hang of the run. The pieces are
                // collected and written as one block: the log of the run has a line per
                // thought and not a line per token.
                const text = String(event.text ?? '');
                if (json) { emit('reasoning.delta', { text }); return; }
                thought += text;
                trimThought();
            }
            else if (type === 'text.delta') {
                // The text of the answer comes the same way. The answer itself is
                // reported by the stage; the stream is only a sign of life.
                const text = String(event.text ?? '');
                if (json) { emit('text.delta', { text }); return; }
            }
            else if (type === 'role.done') { flushThought(); }
            else if (type === 'delegate.start') {
                if (json) {
                    emit('delegate.start', { from: event.from ?? null, to: event.to ?? null, task: event.task ?? '', reason: event.reason ?? '' });
                } else {
                    this.note(`роль ${event.from ?? '?'} передаёт работу роли ${event.to ?? '?'}: ${event.task ?? ''}`);
                }
            }
            else if (type === 'delegate.done') {
                if (json) {
                    emit('delegate.done', {
                        from: event.from ?? null,
                        to: event.to ?? null,
                        turns: event.turns ?? 0,
                        ok: event.ok === true,
                        files: Array.isArray(event.files) ? event.files : [],
                    });
                } else {
                    const files = Array.isArray(event.files) && event.files.length
                        ? `; файлы на диске: ${event.files.join(', ')}`
                        : '';
                    this.note(`результат роли ${event.to ?? '?'} ${event.ok === true ? 'проверен' : 'не подтверждён'}: `
                        + `${event.turns ?? 0} ходов${files}`);
                }
            }
            else if (type === 'picture.attempt') {
                // The crop is prepared by one model; the run shows which one and how the
                // cut-out came out.
                const facts = event.facts ?? {};
                const alpha = Number.isFinite(facts.soft) ? `, мягкий край ${(facts.soft * 100).toFixed(1)}%` : '';
                this.note(`картинка ${event.name ?? ''} от ${event.model ?? '?'}${alpha}`);
            }
            else if (type === 'picture.ready') {
                this.note(`картинка готова: ${event.name ?? ''} → ${event.file ?? ''}${event.model ? ` (${event.model})` : ''}`);
            }
            else if (type === 'request.wait') { flushThought(); this.wait(event.elapsedMs ?? 0); }
            else if (type === 'request.retry') { flushThought(); this.retry(event); }
            else if (type === 'request.error') this.warning(`запрос не удался: ${event.error ?? ''}`);
            else if (type === 'warning') this.warning(event.text);
            else if (type === 'bridge.log') this.bridge(event.name, event.line, event.stream ?? 'stdout');
            else if (type === 'files') this.files(event.files);
            else if (type === 'plan') this.plan(event.plan);
            else if (type === 'progress') this.progress(event.progress);
        },
    };
}
