/**
 * @file src/tui/app.js
 * @module tui/app
 * @purpose Connect the terminal-kit terminal, the worker and the state of the shell.
 *
 *   The app owns the keyboard: ordinary text steers the next role turn, a pending
 *   question receives the answer, and the slash commands keep the vocabulary of the
 *   classic CLI. The worker runs in its own process, so a crash of the shell never
 *   takes the run with it.
 *
 * @depends tui/state, tui/render, tui/worker-client
 * @usedBy tui/cli
 * @exports createTuiApp
 * @ai.tags tui, terminal, application
 * @ai.hint io
 */

import { createTuiState, reduceTuiState } from './state.js';
import { prepareTuiFrame, renderTui } from './render.js';
import { createWorkerClient } from './worker-client.js';

/**
 * Start the graphical application.
 *
 * @param {{ term: object, args?: string[], command?: string, task?: string,
 *   cwd?: string, env?: object, ascii?: boolean }} options
 * @returns {{ run: () => Promise<object>, stop: () => void }}
 * @exports
 * @ai.hint io
 */
export function createTuiApp({
    term,
    args = [],
    command = 'run',
    task = '',
    cwd = process.cwd(),
    env = process.env,
    ascii = false,
} = {}) {
    let state = createTuiState({ command, task });
    let input = '';
    let logOffset = 0;
    let client = null;
    let renderTimer = null;
    let stopped = false;
    let resultCode = null;
    // The rows of the last frame: the next frame is drawn by the difference, and a
    // row that did not change is not written at all.
    let frame = null;
    // The frame that is prepared for the next draw: the rows are built before the
    // terminal is touched, so the drawing itself only writes what changed.
    let prepared = null;

    /**
     * Prepare the frame of the dashboard.
     *
     * The rows are built while the run goes on, and the frame is kept until the state
     * moves: a draw that finds the state where it was leaves the frame alone.
     * @returns {void}
     */
    function prepare() {
        const width = Number(term?.width) > 0 ? Number(term.width) : 100;
        const height = Number(term?.height) > 0 ? Number(term.height) : 30;
        prepared = {
            state,
            input,
            logOffset,
            frame: prepareTuiFrame(state, { width, height, input, ascii, logOffset }),
        };
    }

    /**
     * Apply one action to the state.
     * @param {object} action
     * @returns {void}
     */
    const dispatch = (action) => {
        state = reduceTuiState(state, action);
        // The frame is prepared right away: the draw that follows only writes.
        prepare();
        requestRender();
    };

    /**
     * Draw the next frame.
     * @returns {void}
     */
    const draw = () => {
        // The frame is prepared before it is drawn, and it is reused when the state did
        // not move since the preparation.
        if (!prepared || prepared.state !== state || prepared.input !== input || prepared.logOffset !== logOffset) {
            prepare();
        }
        frame = renderTui(term, state, { input, ascii, logOffset, previous: frame, layout: prepared.frame });
    };

    /**
     * Draw soon, but not once for every tiny event.
     *
     * The stream of the model paints the frame many times a second. The frame is drawn
     * at most every few hundred milliseconds: the eye reads a thought that changes a few
     * times a second, and a frame that changes ten times a second is only noise.
     * @returns {void}
     */
    function requestRender() {
        if (renderTimer) return;
        renderTimer = setTimeout(() => {
            renderTimer = null;
            draw();
        }, 200);
        renderTimer.unref?.();
    }

    /**
     * Draw the frame at once: the operator typed something and waits for the letter.
     * @returns {void}
     */
    function drawNow() {
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
        prepare();
        draw();
    }

    /**
     * Handle one key of the terminal.
     * @param {string} name
     * @param {string[]} matches
     * @param {object} data
     * @returns {void}
     */
    const onKey = (name, matches = [], data = {}) => {
        if (name === 'ENTER' || name === 'KP_ENTER') {
            submit();
            return;
        }
        if (name === 'BACKSPACE') {
            const chars = Array.from(input);
            chars.pop();
            input = chars.join('');
            drawNow();
            return;
        }
        if (name === 'ESCAPE') {
            input = '';
            drawNow();
            return;
        }
        if (name === 'CTRL_C') {
            client?.command('abort');
            state = { ...state, notice: 'Stopping after the current safe operation…' };
            drawNow();
            return;
        }
        if (name === 'PAGE_UP') {
            logOffset += 10;
            drawNow();
            return;
        }
        if (name === 'PAGE_DOWN') {
            logOffset = Math.max(0, logOffset - 10);
            drawNow();
            return;
        }
        if (name === 'UP') {
            logOffset += 1;
            drawNow();
            return;
        }
        if (name === 'DOWN') {
            logOffset = Math.max(0, logOffset - 1);
            drawNow();
            return;
        }
        if (data?.isCharacter && Number.isInteger(data.codepoint)) {
            const char = String.fromCodePoint(data.codepoint);
            if (input.length < 4000) input += char;
            drawNow();
            return;
        }
        if (typeof name === 'string' && Array.from(name).length === 1 && !matches.includes('CTRL')) {
            if (input.length < 4000) input += name;
            drawNow();
        }
    };

    /**
     * Submit the operator line.
     * @returns {void}
     */
    function submit() {
        const text = input.trim();
        input = '';
        if (!text) {
            requestRender();
            return;
        }
        const question = state.question;
        if (question) {
            client?.answer(question.id, text);
            dispatch({ type: 'answer' });
            return;
        }
        if (text === '/help') {
            state = { ...state, notice: 'Text steers the next role turn · /skip [name] skips a stage or step · /quit stops safely' };
            requestRender();
            return;
        }
        const skip = text.match(/^\/skip(?:-stage)?(?:\s+(.+))?$/i);
        if (skip) {
            client?.command('skip', skip[1]?.trim() || null);
            state = { ...state, notice: skip[1] ? `Skip requested: ${skip[1].trim()}` : 'Skip requested for the current stage' };
            requestRender();
            return;
        }
        if (text === '/quit') {
            client?.command('abort');
            state = { ...state, notice: 'Stopping after the current safe operation…' };
            requestRender();
            return;
        }
        client?.steer(text);
        state = { ...state, notice: 'Steering sent to the next role turn' };
        requestRender();
    }

    const onResize = () => drawNow();

    /**
     * Leave the terminal in a clean state.
     * @returns {void}
     */
    function stop() {
        if (stopped) return;
        stopped = true;
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = null;
        term.off?.('key', onKey);
        term.off?.('resize', onResize);
        try {
            term.grabInput(false);
        } catch {
            // The terminal may already be in its normal mode.
        }
        try {
            term.hideCursor(false);
        } catch {
            // The terminal may not expose a visible cursor.
        }
        try {
            term.fullscreen(false);
        } catch {
            // The terminal may not support the alternate screen.
        }
    }

    return {
        /**
         * Run the worker until it ends.
         * @returns {Promise<{ code: number, outputs: object[] }>}
         */
        async run() {
            term.fullscreen(true);
            term.grabInput({ focus: true });
            term.on('key', onKey);
            term.on('resize', onResize);
            // The screen is cleared once, at the start: every frame after this one is
            // drawn by the difference, and a clear on every frame makes the terminal blink.
            term.clear();

            client = createWorkerClient({
                args,
                cwd,
                env,
                onFrame(frame) {
                    dispatch({ type: 'frame', frame });
                    const event = frame?.type === 'event' ? frame.event : null;
                    if (event?.type === 'summary') {
                        const status = String(event.payload?.status ?? event.report?.status ?? '');
                        if (status === 'completed' || status === 'paused') {
                            setTimeout(() => client?.command('quit'), 20);
                        }
                    }
                    if (frame?.type === 'result') resultCode = Number(frame.code ?? 1);
                },
                onLog(log) {
                    dispatch({ type: log?.stream === 'stdout' ? 'output' : 'log', ...log });
                },
                onError(error) {
                    state = { ...state, notice: error?.message ?? String(error) };
                    requestRender();
                },
            });

            // The shell that stops must not leave the worker behind: the signal of the
            // shell reaches the worker as the abort of the run.
            const onSignal = () => client?.command('abort');
            process.on('SIGINT', onSignal);
            process.on('SIGTERM', onSignal);

            draw();
            const exit = await client.finished;
            await new Promise((resolve) => setTimeout(resolve, 180));
            draw();
            stop();
            process.off('SIGINT', onSignal);
            process.off('SIGTERM', onSignal);
            return { code: resultCode ?? exit.code, outputs: state.outputs };
        },

        stop,
    };
}
