/**
 * @file src/roles/economy.js
 * @module roles/economy
 * @purpose The rules that keep the run cheap: the line is the address of a place, the patch
 *          carries only what changes, the batch is one turn instead of many.
 *
 *   A model that rewrites a whole file to change one rule pays for the whole file in every
 *   turn, and pays for it again when it reads the file back. The tools of the house make the
 *   cheap way possible: `find_line` gives the number of the line, `read_file` reads that range
 *   alone, `patch_file` changes that range alone, and `batch` does several of these in one
 *   call. The role has to know that they are there — otherwise it keeps using the blunt way.
 *
 * @depends none
 * @usedBy roles/markup, roles/styler, roles/coder
 * @exports economyNote, economyTools
 * @ai.tags roles, tools, tokens
 * @ai.hint pure
 */

/**
 * The tools of the economy. A role that may read and write may use them.
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function economyTools() {
    return ['find_line', 'patch_file', 'batch'];
}

/**
 * The rules of the economy for the role that reads and writes files.
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function economyNote() {
    return `- Read only the part of the file you need. \`read_file\` takes \`startLine\` and
  \`endLine\`; a file of a thousand lines does not have to be read as a thousand lines.
- The number of the line is the address of a place. Find it with \`find_line\` (the text of the
  place, or a regular expression with \`regex: true\`), read that range alone, and change that
  range alone with \`patch_file\`. A patch names the lines it changes and carries their new
  text — the rest of the file is not sent and not rewritten.
- \`write_file\` is for a new file or for a file you have to rebuild from nothing. When the file
  exists and only some of its lines change, patch it.
- Several actions that belong to one step go into one \`batch\` call: the reads, the searches and
  the patches of one step in one array, one turn instead of many. The batch answers with the
  answer of every action, in order.
- The run remembers what it has read: the moment of the read of a file is in the context, with
  the range of the lines. Do not read the same range twice; read the next range instead.`;
}
