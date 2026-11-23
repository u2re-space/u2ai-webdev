/**
 * @file src/cli/input.js
 * @module cli/input
 * @purpose Read the task from stdin and route live terminal input to the run.
 * @depends node:readline, cli/stdio
 * @exports readPipedInput, createInputChannel
 * @ai.tags cli, input, steering
 * @ai.hint io
 */

import { clearLine, createInterface, cursorTo, moveCursor } from 'node:readline';
import { sanitizeText } from './stdio.js';
import { createInputState } from './input-state.js';

const STAGE_TITLES = Object.freeze({
    collect: 'Collect context', scan: 'Scan', plan: 'Plan', pictures: 'Prepare pictures',
    architect: 'Architecture',
    setup: 'Setup', vector: 'Vector', assets: 'Assets', markup: 'Markup', styling: 'Styles',
    animation: 'Animation', coding: 'Code', build: 'Build',
    sight: 'Visual check', iconify: 'Icons', review: 'Review', audit: 'Audit', learn: 'Learn',
});

/**
 * Read piped stdin without consuming an unbounded amount of input.
 * @param {{ stdin?: NodeJS.ReadableStream|null, maxBytes?: number }} [options]
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function readPipedInput({ stdin = process.stdin, maxBytes = 4 * 1024 * 1024 } = {}) {
    if (!stdin || stdin.isTTY) return '';
    return await new Promise((resolve, reject) => {
        const chunks = [];
        let bytes = 0;
        let settled = false;
        let firstChunkTimer = null;
        const clean = () => {
            if (firstChunkTimer) clearTimeout(firstChunkTimer);
            stdin.off('data', onData);
            stdin.off('end', onEnd);
            stdin.off('error', onError);
            stdin.pause?.();
        };
        const finish = (error = null) => {
            if (settled) return;
            settled = true;
            clean();
            if (error) reject(error);
            else resolve(Buffer.concat(chunks).toString('utf8').trim());
        };
        const onData = (chunk) => {
            if (firstChunkTimer) clearTimeout(firstChunkTimer);
            firstChunkTimer = null;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > maxBytes) {
                finish(new Error(`stdin is larger than the limit of ${maxBytes} bytes.`));
                return;
            }
            chunks.push(buffer);
        };
        const onEnd = () => finish();
        const onError = (error) => finish(error);
        stdin.on('data', onData);
        stdin.once('end', onEnd);
        stdin.once('error', onError);
        // A CLI launched with no input can inherit an open pipe that never closes.
        firstChunkTimer = setTimeout(() => finish(), 100);
        firstChunkTimer.unref?.();
        stdin.resume?.();
    });
}

/**
 * Create the single interactive input channel of a run. Ordinary lines steer the next role
 * turn; answers to ask_user are delivered only to that question; slash commands are controls.
 * @param {{ stdin?: NodeJS.ReadStream, output?: NodeJS.WritableStream,
 *   interactive?: boolean, getLocation?: () => object|null }} [options]
 * @returns {object|null}
 * @exports
 * @ai.hint io
 */
export function createInputChannel({ stdin = process.stdin, output = process.stderr,
    interactive = Boolean(stdin?.isTTY), getLocation = () => null } = {}) {
    if (!interactive || !stdin?.isTTY) return null;

    let statusText = 'ai-webdev · ready';
    output.write(`${statusText}\n`);
    const readline = createInterface({ input: stdin, output, terminal: true });
    // Keep readline's prompt single-line: it redraws the prompt after every input event.
    // The status itself is maintained in the terminal row above the prompt.
    const mainPrompt = () => 'ai-webdev › ';
    const statusLine = () => {
        const columns = Number.isSafeInteger(output.columns) && output.columns > 1 ? output.columns : 120;
        return sanitizeText(statusText).slice(0, columns - 1);
    };
    const redrawMainPrompt = () => {
        if (questions.length || closed || state.shouldQuit()) return;
        readline.setPrompt(mainPrompt());
        readline.prompt(true);
    };
    const writeLog = (text) => {
        if (questions.length) return output.write(text);
        readline.pause();
        const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
        if (lines.at(-1) === '') lines.pop();
        if (!lines.length) lines.push('');
        cursorTo(output, 0);
        output.write(`\x1b[${lines.length}L`);
        output.write(`${lines.map((line) => sanitizeText(line)).join('\r\n')}\r\n`);
        moveCursor(output, 0, 1);
        cursorTo(output, 0);
        readline.resume();
        readline.setPrompt(mainPrompt());
        readline.prompt(true);
    };
    output.write(`${statusLine()}\n`);
    readline.setPrompt(mainPrompt());
    readline.prompt();
    readline.on('SIGCONT', () => {
        readline.setPrompt(mainPrompt());
        readline.prompt();
    });
    const state = createInputState();
    const questions = [];
    let closed = false;
    let waitResolver = null;

    const drawStatus = () => {
        if (closed) return;
        output.write('\x1b[s');
        moveCursor(output, 0, -1);
        cursorTo(output, 0);
        clearLine(output, 0);
        output.write(statusLine());
        output.write('\x1b[u');
    };

    const askLine = (prompt) => new Promise((resolve) => {
        readline.setPrompt(`${sanitizeText(prompt)}> `);
        questions.push(resolve);
        readline.prompt();
    });

    readline.on('line', (raw) => {
        const line = sanitizeText(raw).trim();
        const answer = questions.shift();
        if (answer) {
            answer(line);
            output.write(`${statusLine()}\r\n`);
            readline.setPrompt(mainPrompt());
            readline.prompt(true);
            return;
        }
        if (state.shouldQuit()) return;
        if (line.startsWith('/')) {
            const target = line.slice(1).trim().toLowerCase();
            if (target === 'skip' || target === 'skip-stage' || target === 'help' || target === 'quit'
                || target.startsWith('skip ')) {
                // Known interactive command; handled below.
            } else {
                if (target) state.addSkip(target, state.location() ?? getLocation());
                return;
            }
        }
        if (!line) { redrawMainPrompt(); return; }
        if (line === '/help') {
            writeLog('Controls: /skip [stage-or-step], /help, /quit. Other text steers the next role turn.\n');
            return;
        }
        if (line === '/quit') {
            state.requestQuit();
            writeLog('Run will pause after the current safe operation.\n');
            waitResolver?.();
            return;
        }
        if (line === '/skip' || line === '/skip-stage' || line.startsWith('/skip ')) {
            const target = line === '/skip-stage' ? null : (line === '/skip' ? null : line.slice(6).trim().toLowerCase() || null);
            const where = state.location() ?? getLocation();
            if (target || where?.stage || where?.step) state.addSkip(target, where);
            else writeLog('No active stage to skip yet.\n');
            redrawMainPrompt();
            return;
        }
        state.addSteering(line);
        redrawMainPrompt();
    });

    readline.on('close', () => {
        closed = true;
        while (questions.length) questions.shift()('');
    });

    return {
        interactive: true,
        async readTask() {
            if (closed) return '';
            return await askLine('Task');
        },
        async askUser(question) {
            if (closed) return '';
            return await askLine(String(question ?? 'Question'));
        },
        async prompt(question) { return await askLine(String(question ?? 'Input')); },
        takeSteering() {
            return state.takeSteering();
        },
        setLocation(next) {
            state.setLocation(next);
            if (state.location()) {
                const location = state.location();
                const stage = String(location.stage ?? 'run');
                const role = String(location.role ?? location.step?.role ?? '').trim();
                const model = String(location.model ?? '').trim();
                const effort = String(location.effort ?? '').trim();
                const mode = String(location.mode ?? 'interactive').trim();
                const parts = [
                    STAGE_TITLES[stage] ?? stage,
                    ...(role ? [`role ${role}`] : []),
                    ...(effort ? [`reasoning ${effort}`] : []),
                    ...(mode ? [`mode ${mode}`] : []),
                    ...(model ? [model] : []),
                ];
                statusText = parts.join(' · ');
                drawStatus();
                readline.setPrompt(mainPrompt());
            }
        },
        setStatus(text) {
            statusText = String(text ?? '').replace(/\s+/g, ' ').trim();
            drawStatus();
            readline.setPrompt(mainPrompt());
        },
        log(text) { writeLog(String(text ?? '')); },
        takeSkip({ stage = '', step = '' } = {}) {
            return state.takeSkip({ stage, step });
        },
        takeCurrentSkip() {
            return state.takeCurrentSkip();
        },
        takePendingSkips({ namedOnly = false, includeCurrent = false } = {}) {
            return state.takePendingSkips({ namedOnly, includeCurrent });
        },
        location() { return state.location(); },
        queueStepSkip(id) { state.queueStepSkip(id); },
        takeStepSkip(id) { return state.takeStepSkip(id); },
        takeActiveStepSkip(id) { return state.takeStepSkip(id); },
        shouldQuit() { return state.shouldQuit(); },
        taskPending() { return questions.length > 0; },
        waitForQuit() {
            if (state.shouldQuit() || closed) return Promise.resolve();
            return new Promise((resolve) => {
                waitResolver = resolve;
                readline.once('close', resolve);
            });
        },
        commands: {
            help: 'Enter text to steer the next role turn; /skip [stage-or-step], /help, /quit.',
        },
        close() {
            if (closed) return;
            closed = true;
            readline.close();
            while (questions.length) questions.shift()('');
        },
    };
}
