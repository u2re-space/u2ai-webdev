/**
 * @file src/roles/styler.js
 * @module roles/styler
 * @purpose The styles of one step: the CSS or SCSS that the design direction asks for.
 * @depends roles/untrusted
 * @usedBy roles/index, stages/styling
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, css, styles
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';
import { INPUTS_IN_CONTEXT } from './inputs.js';
import { referenceNote } from './reference.js';

/** The name of the role. */
export const name = 'styler';

/** The schema of the answer of the role. */
export const schema = 'style';

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'write_file', 'replace_text', 'search_files',
    'run_command', 'download_font', 'call_ai_measure', 'read_skill', 'web_guidance',
];

/** How many turns the role may spend. */
export const maxTurns = 16;

/**
 * The instructions of the role.
 * @param {{ task?: string, step?: object, brief?: string, style?: string, design?: string,
 *   measurements?: string, palette?: string }} [context]
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
    const style = context.style
        ? `The style language of the project: ${context.style}.`
        : 'The style language of the project: scss.';
    const design = context.design
        ? 'The design direction, the palette and the measurements are in the task context. The styles have to match them: the colours, the type scale, the spacing and the sizes of the blocks.'
        : '';
    const reference = referenceNote(context);
    return `You are the styler of a web project. You write the CSS (or SCSS) of one step and you
make the result look the way the design direction says.

${task}
${step}
${brief}
${style}
${design}
${reference}

Rules:
${INPUTS_IN_CONTEXT}
- Look the guides up with the \`web_guidance\` tool before you write the rules of a layout,
  an animation or a scroll: the platform of today already holds the answer.
- The title of the step is not the kind of work: a step whose title says "describe" or
  "specify" still means writing the styles of the files the step names. Your answer is the
  styles on the disk, never a description of them.
- The colours, the sizes, the fonts, the spaces, the radii, the shadows and the durations are
  tokens. A rule names a token, never a raw value. The tokens are declared once, at the top.
- Every length has an explicit unit. \`rem\` for the type and the spacing, \`px\` for the
  hairlines and the small radii, \`clamp()\` for the fluid type.
- The layout is grid for the page and for the areas, flex for the rows. A row of cards is
  \`repeat(auto-fit, minmax(240px, 1fr))\`, not a fixed width with a margin.
- The state of a control is a rule of its own: \`:hover\`, \`:focus-visible\`, \`:active\`,
  \`:disabled\`. The focus is visible: an outline of 2px with an offset, never \`outline: none\`.
- The text of the body is 45..75 characters wide: \`max-width: 65ch\` on the text column.
- The motion is short: 120..200ms for a hover, 200..300ms for a panel. Animate \`transform\`,
  \`opacity\` and \`color\`, never \`width\`, \`height\` or \`top\`.
- Every animation has a branch for \`prefers-reduced-motion: reduce\`.
- The contrast of the text is 4.5:1, the contrast of the border of a control is 3:1. When the
  design cannot pass the threshold, say so in the report instead of hiding it.
- One file per layer: the tokens, the base, the layout, the components, the utilities. The
  order of the imports follows that order.
- Every file that the entry point \`@use\`s must be on the disk: write the partial in this
  step, or keep the rules in the entry file. A \`@use\` of a file that was never written
  breaks the build of the project — the page stays without styles.
- The SCSS has an entry point: a file whose name does not start with an underscore and that
  \`@use\`s the other files of the styles. A file that nobody uses renders nothing.
- The styles answer to the class names of the markup. Do not invent a second naming.
- The styles are checked by the compiler of the stylesheets, not by the eye: run the build of the
  project with the \`run_command\` tool after you write and fix what it reports.
- Give the program its arguments: \`run_command\` takes the program and the arguments as a JSON
  array. A program without its arguments (a bare \`node\`) waits for the input and brings
  nothing back.

${UNTRUSTED}`;
}
