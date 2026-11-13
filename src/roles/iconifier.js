/**
 * @file src/roles/iconifier.js
 * @module roles/iconifier
 * @purpose The icons of the project: which ones, of which set, and how they are used.
 * @depends roles/untrusted
 * @usedBy roles/index, stages/iconify
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, icons
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';

/** The name of the role. */
export const name = 'iconifier';

/** The schema of the answer of the role. */
export const schema = 'icon';

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'write_file', 'replace_text', 'search_files',
    'download_icons', 'generate_svg', 'read_skill',
];

/** How many turns the role may spend. */
export const maxTurns = 10;

/**
 * The instructions of the role.
 * @param {{ task?: string, step?: object, brief?: string, iconSet?: string, design?: string,
 *   markup?: string }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const task = context.task ? `The task of the run:\n${context.task}` : '';
    const step = context.step
        ? `The step to do:\n- title: ${context.step.title}\n- files: ${(context.step.files ?? []).join(', ') || 'not named'}\n- criteria: ${(context.step.criteria ?? []).join('; ') || 'not named'}`
        : '';
    const brief = context.brief ? `The brief of the architect:\n${context.brief}` : '';
    const set = context.iconSet && context.iconSet !== 'auto'
        ? `The icon set of the project: ${context.iconSet}.`
        : 'The icon set is not chosen yet: pick one set for the whole project and say which.';
    const design = context.design
        ? 'The design direction is in the task context. The icons have to match its weight, its radius and its stroke.'
        : '';
    return `You are the iconifier of a web project. You choose the icons, you bring the set into
the project and you put the icons into the markup.

${task}
${step}
${brief}
${set}
${design}

Rules:
- One set for the whole project: phosphor or lucide. Never two sets in one interface, and
  never a drawn icon where the set already has one.
- The name of the icon is the plain name of the thing: \`search\`, not \`magnifier\`;
  \`trash-2\` for the delete, \`x\` for the close, \`house\` for the home.
- The icon never stands alone where a word is needed. An icon button has an accessible name;
  an icon next to a word is decorative and takes \`aria-hidden="true"\`.
- The size is a token: 16, 20, 24 or 32. The size comes from the stylesheet, not from the
  markup: the icon file carries no \`width\` and no \`height\`.
- The stroke follows the grid of the set: 2 on the 24×24 grid of Lucide, the weight of the
  style on the grid of Phosphor.
- The colour is \`currentColor\`, so the icon follows the text.
- Download the icons you picked with the \`download_icons\` tool, into the directory of the
  project, and say in the report which names were taken.
- When a picture of the design cannot be replaced by an icon, say so and make it an SVG:
  this package edits vector graphics as code.

${UNTRUSTED}`;
}
