/**
 * @file src/cli/colors.js
 * @module cli/colors
 * @purpose The colors of the terminal: one painter for the whole CLI.
 *
 *   The colors are built on `node:util` `styleText`, so no dependency is needed. The
 *   painter is created once with the mode of the terminal: when the output is a pipe
 *   or a file, the text goes out unchanged.
 *
 * @depends node:util
 * @usedBy cli, cli/renderer
 * @exports createColors, COLORS
 * @ai.tags cli, colors, terminal
 * @ai.hint keep
 * @changed 2026-11-13 First version: the colors of the webdev CLI.
 */

import { styleText } from 'node:util';

/** The styles the CLI knows. */
export const COLORS = Object.freeze({
    bold: 'bold',
    dim: 'dim',
    italic: 'italic',
    underline: 'underline',
    red: 'red',
    green: 'green',
    yellow: 'yellow',
    blue: 'blue',
    magenta: 'magenta',
    cyan: 'cyan',
    white: 'white',
    gray: 'gray',
});

/**
 * Create the painter of the terminal.
 *
 * Every function returns the text unchanged when the colors are off, so the callers
 * never have to know whether the terminal understands the styles.
 *
 * @param {boolean} [enabled] true when the output may carry the styles
 * @returns {{ enabled: boolean, bold: Function, dim: Function, italic: Function,
 *   underline: Function, red: Function, green: Function, yellow: Function,
 *   blue: Function, magenta: Function, cyan: Function, white: Function,
 *   gray: Function }}
 * @exports
 * @ai.hint pure
 */
export function createColors(enabled = false) {
    const on = Boolean(enabled);
    const painter = {};
    for (const [name, format] of Object.entries(COLORS)) {
        painter[name] = (text) => {
            const body = String(text ?? '');
            if (!on) return body;
            try {
                return styleText(format, body);
            } catch {
                return body;
            }
        };
    }
    painter.enabled = on;
    return painter;
}
