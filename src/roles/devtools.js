/**
 * @file src/roles/devtools.js
 * @module roles/devtools
 * @purpose The rules of the browser that answers: the Chrome DevTools MCP tools of the house.
 *
 *   The house has two eyes on the page. The first one takes a picture of it: that is the
 *   `screenshot` tool, and it shows how the page looks. The second one *drives* the page: it
 *   reads the tree of the page, clicks, types, resizes the window, runs a script and reads
 *   the console and the requests. That is the DevTools.
 *
 *   The second eye is the one that answers the questions a picture cannot: does the menu
 *   open, does the form submit, what does the script say when the button is pressed, what
 *   is the computed width of the panel at the width of the design.
 *
 * @depends none
 * @usedBy roles/coder, roles/styler, roles/editor, roles/reviewer
 * @exports devToolsNote, devToolsMarker
 * @ai.tags roles, browser, devtools
 * @ai.hint pure
 */

/**
 * The marker of the tools of the server: the role names the server and gets its tools.
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function devToolsMarker() {
    return 'mcp:chrome-devtools';
}

/**
 * The rules of the DevTools for the role that works with the page.
 * @param {{ url?: string|null, width?: number|null }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function devToolsNote({ url = null, width = null } = {}) {
    const lines = [
        '- The browser of the house speaks to you through the DevTools tools: the snapshot of',
        '  the page, the clicks, the keys, the window, the script, the console and the requests.',
        '  Use them when a picture is not enough: a picture shows how the page looks, the',
        '  DevTools show how it behaves.',
        '- Take the snapshot of the page first: the identifier of an element (`uid`) comes from',
        '  the snapshot, and a click without a fresh snapshot clicks nothing.',
    ];
    if (url) {
        lines.push(`- The page of the project is at ${url}. Open it with the navigation tool before you work with it.`);
    } else {
        lines.push('- The page of the project is the one the stage has opened. Open it with the navigation tool if the tools say that there is no page.');
    }
    if (Number.isFinite(width) && width > 0) {
        lines.push(`- The design is ${width} pixels wide. Resize the window to that width before you judge the layout: a page that is wider than the design is a different page.`);
    }
    lines.push(
        '- The script of the page reads and never writes: it shows what the page does, and the',
        '  files of the project are written with the tools of the files.',
        '- The styles of an element come from the DevTools: the tool of the styles says which',
        '  rule won, in which line of which file, and what the value really is. Use it instead',
        '  of guessing which rule is stronger — the cascade is not a matter of opinion.',
        '- The console and the requests name the cause of what the picture shows: an exception',
        '  names the line that broke, a failed request names the file that is missing.',
    );
    return lines.join('\n');
}
