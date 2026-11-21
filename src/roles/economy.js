/**
 * @file src/roles/economy.js
 * @module roles/economy
 * @purpose The tools that keep the run cheap: the line is the address of a place, the patch
 *          carries only what changes, the batch is one turn instead of many.
 *
 *   A model that rewrites a whole file to change one rule pays for the whole file in every
 *   turn, and pays for it again when it reads the file back. The tools of the house make the
 *   cheap way possible: `find_line` gives the number of the line, `read_file` reads that range
 *   alone, `patch_file` changes that range alone, and `batch` does several of these in one
 *   call. The role has to know that they are there — otherwise it keeps using the blunt way.
 *
 *   The rules that explain them live in `roles/chunks`: the part of reading says how to read
 *   the place, the part of writing says how to patch it. The tools themselves are here.
 *
 * @depends none
 * @usedBy roles/markup, roles/styler, roles/coder
 * @exports economyTools
 * @ai.tags roles, tools, tokens
 * @ai.hint pure
 * @changed 2026-11-21 Правила экономии переехали в части инструкции: чтение и запись.
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
