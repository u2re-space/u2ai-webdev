/**
 * @file src/cli/input.js
 * @module cli/input
 * @purpose Read the task from stdin and route live terminal input to the run.
 * @depends node:readline, cli/stdio
 * @exports readPipedInput, createInputChannel
 * @ai.tags cli, input, steering
 * @ai.hint io
 */

import { createInterface } from 'node:readline';
import { sanitizeText } from './stdio.js';

const STAGE_TITLES = Object.freeze({
    collect: 'Collect context', plan: 'Plan', pictures: 'Prepare pictures', architect: 'Architecture',
    setup: 'Setup', markup: 'Markup', coding: 'Code', styling: 'Styles', build: 'Build',
    sight: 'Visual check', vector: 'Vector', iconify: 'Icons', review: 'Review', audit: 'Audit', learn: 'Learn',
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

    const readline = createInterface({ input: stdin, output, terminal: true });
    const steering = [];
    const skips = [];
    const stepSkips = new Set();
    const questions = [];
    let closed = false;
    let quit = false;
    let location = null;
    let statusText = '';
    let statusWidth = 0;
    let statusDirty = true;
    let waitResolver = null;

    const drawStatus = () => {
        if (!statusDirty || closed) return;
        statusDirty = false;
        const text = statusText || 'ai-webdev · ready';
        const width = Math.max(statusWidth, text.length);
        statusWidth = width;
        readline.setPrompt(`${sanitizeText(text)}${' '.repeat(Math.max(0, width - text.length))}\nai-webdev › `);
        readline.prompt();
    };

    const askLine = (prompt) => new Promise((resolve) => {
        readline.setPrompt(`${statusText || 'ai-webdev · waiting for input'}\n${sanitizeText(prompt)}\n> `);
        questions.push(resolve);
        readline.prompt();
    });

    const redrawStatus = () => {
        if (!statusText || closed || questions.length) return;
        readline.setPrompt(`${sanitizeText(statusText)}\n> `);
        readline.prompt();
    };

    drawStatus();

    readline.on('line', (raw) => {
        const line = sanitizeText(raw).trim();
        const answer = questions.shift();
        if (answer) {
            answer(line);
            drawStatus();
            return;
        }
        if (quit) return;
        if (line.startsWith('/')) {
            const target = line.slice(1).trim().toLowerCase();
            if (target === 'skip' || target === 'skip-stage' || target === 'help' || target === 'quit'
                || target.startsWith('skip ')) {
                // Known interactive command; handled below.
            } else {
                if (target) skips.push({ target, location: location ? { ...location } : getLocation() });
                return;
            }
        }
        if (!line) return;
        if (line === '/help') {
            statusText = 'Controls: /skip [stage-or-step], /help, /quit';
            statusDirty = true;
            drawStatus();
            return;
        }
        if (line === '/quit') {
            quit = true;
            output.write('Run will pause after the current safe operation.\n');
            waitResolver?.();
            return;
        }
        if (line === '/skip' || line === '/skip-stage' || line.startsWith('/skip ')) {
            const target = line === '/skip-stage' ? null : (line === '/skip' ? null : line.slice(6).trim().toLowerCase() || null);
            const where = location ?? getLocation();
            if (target || where?.stage || where?.step) skips.push({ target, location: where });
            else { output.write('No active stage to skip yet.\n'); readline.prompt(); }
            return;
        }
        steering.push(line);
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
            return steering.splice(0);
        },
        setLocation(next) {
            location = next && typeof next === 'object' ? { ...next } : null;
            if (location) {
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
                statusDirty = true;
                drawStatus();
            }
        },
        setStatus(text) {
            statusText = String(text ?? '').replace(/\s+/g, ' ').trim();
            statusDirty = true;
            drawStatus();
        },
        takeSkip({ stage = '', step = '' } = {}) {
            const stageName = String(stage).toLowerCase();
            const stepName = String(step).toLowerCase();
            const index = skips.findIndex((item) => {
                if (!item.target) return (item.location?.step
                    ? String(item.location.step).toLowerCase() === stepName
                    : String(item.location?.stage ?? '').toLowerCase() === stageName);
                return item.target === stageName || (stepName && item.target === stepName);
            });
            return index < 0 ? null : skips.splice(index, 1)[0];
        },
        takeCurrentSkip() {
            const where = location ?? getLocation();
            const index = skips.findIndex((item) => !item.target
                && (item.location?.step === where?.step && where?.step
                    || item.location?.stage === where?.stage && !where?.step && where?.stage));
            return index < 0 ? null : skips.splice(index, 1)[0];
        },
        takePendingSkips({ namedOnly = false, includeCurrent = false } = {}) {
            if (!namedOnly && includeCurrent) return skips.splice(0);
            const named = skips.filter((item) => item.target);
            for (const item of named) skips.splice(skips.indexOf(item), 1);
            return named;
        },
        location() { return location ? { ...location } : null; },
        queueStepSkip(id) { stepSkips.add(String(id ?? '').toLowerCase()); },
        takeStepSkip(id) {
            const key = String(id ?? '').toLowerCase();
            if (!stepSkips.has(key)) return false;
            stepSkips.delete(key);
            return true;
        },
        shouldQuit() { return quit; },
        taskPending() { return questions.length > 0; },
        waitForQuit() {
            if (quit || closed) return Promise.resolve();
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
