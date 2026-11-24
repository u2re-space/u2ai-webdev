/**
 * @file src/roles/markup.js
 * @module roles/markup
 * @purpose The markup of one step: the semantics, the accessibility and the attributes.
 * @depends roles/untrusted
 * @usedBy roles/index, roles/chunks, stages/markup
 * @exports name, schema, tools, maxTurns, instructions, MARKUP_RULES
 * @ai.tags roles, markup, accessibility
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';
import { INPUTS_IN_CONTEXT } from './inputs.js';
import { referenceNote } from './reference.js';
import { PAGE_FRAME_CONTRACT, pageFrameRules, pageWidthNote } from './page-frame.js';
import { CORE, HTML } from './web-development.js';
import { markupStyleNote } from './style-note.js';
import { DELEGATE_NAMES, delegationNote } from '../agent/delegation.js';
import { economyTools } from './economy.js';

/** The name of the role. */
export const name = 'markup';

/** The schema of the answer of the role. */
export const schema = 'markup';

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'write_file', 'replace_text', 'search_files', 'read_skill', 'web_guidance',
    'call_ai_memory',
    'delegate_role',
    ...economyTools(),
];

/** How many turns the role may spend. */
export const maxTurns = 16;

/**
 * The craft of the markup: the rules that hold for a page.
 *
 * The text is not in the prompt of the role: it comes at the write gate, right before the
 * markup is written. A rule of the markup in the middle of the reading of the project is a
 * rule the model does not need yet, and one it forgets by the time it writes.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const MARKUP_RULES = [CORE, HTML, `#### The element comes before the class
- The platform of today comes before the habit of yesterday: look the guides up with the
  \`web_guidance\` tool before you write a dialog, a form or a table, and follow what they
  say.
- A title is a heading, a list is a list, a link to a place is an anchor and an action is a
  button. A \`<div>\` with a click handler is neither.
- The landmarks are in place: one \`<main>\`, and the \`header\`, \`nav\`, \`aside\` and \`footer\`
  where they belong.
- Every image has an \`alt\`: a text that says what it shows, or an empty one when the image is
  decorative. Every field of a form has a \`<label for>\`, and the error of a field is linked to
  it with \`aria-describedby\`.
- The attributes of ARIA are a gap-filler, not a habit. \`aria-hidden\` on a decorative picture,
  \`aria-expanded\` on a disclosure, \`aria-current\` on the active item of a menu.
- The class names follow the naming of the project: one pattern, one way of writing it, and
  the names say what the part is (\`card__title\`, not \`blue-text\`).
- The markup is valid: the tags are closed, the attributes are quoted, the boolean attributes
  have no value.`].join('\n\n');

/**
 * The instructions of the role: the spine of the work, not the craft of the markup.
 *
 * The spine says who the role is, what the step is and what the answer has to be. The craft
 * of the page (see `MARKUP_RULES`) comes at the write gate — the rules of a document in the
 * middle of the reading of the project are rules the model does not need yet.
 * @param {{ task?: string, step?: object, brief?: string, markup?: string, design?: string,
 *   measurements?: string, assets?: string, referenceSizes?: object[] }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const vectorOnly = Boolean(context.vectorOnly);
    const task = context.task ? `The task of the run:\n${context.task}` : '';
    const step = context.step
        ? `The step to do:\n- title: ${context.step.title}\n- files: ${(context.step.files ?? []).join(', ') || 'not named'}\n- criteria: ${(context.step.criteria ?? []).join('; ') || 'not named'}`
        : '';
    const brief = context.brief ? `The brief of the architect:\n${context.brief}` : '';
    const markup = context.markup
        ? `The markup language of the project: ${context.markup}.`
        : 'The markup language of the project: html.';
    const design = context.design && !vectorOnly
        ? 'The design direction and any prepared assets are in the task context. The attached reference image is a visual source of truth; measurements are optional. Match its regions, proportions, hierarchy and names of the parts.'
        : '';
    const styles = context.styles?.source
        ? markupStyleNote(context.styles)
        : '';
    const reference = vectorOnly ? '' : referenceNote(context);
    const width = vectorOnly ? '' : pageWidthNote(context);
    const repair = Array.isArray(context.issues) && context.issues.length
        ? `The review of the step found what has to be fixed, and the request names the file, the
defect and the change that is asked for. Fix it now: find the place of the defect with
\`find_line\`, read that part of the file, and change that part with \`patch_file\`. The answer is
the repaired file on the disk, never a description of the change. The class names are a
contract with the styles: keep the names the styles describe, do not rename them and do not
drop a class that has a rule.`
        : '';
    return `You are the markup specialist of a web project. You write the structure of the
page: the elements, the order, the names and the attributes that give the page its meaning.

${task}
${step}
${brief}
${markup}
${design}
${styles}
${reference}
${width}
${repair}

Rules:
${INPUTS_IN_CONTEXT}
${vectorOnly ? '' : PAGE_FRAME_CONTRACT}
${delegationNote(DELEGATE_NAMES)}
- The class names are a contract with the styles: a class that the styles describe keeps its
  name. Do not rename a class and do not drop a class that has a rule — the styles are
  another role's work, and they are not changed together with the markup.
- The pictures prepared from the crops are the assets of the result: link the prepared file as
  it is. Do not draw a copy of it and do not replace it with an SVG — the cut-out of the
  reference is closer to the reference than a new drawing.
- The title of the step is not the kind of work: a step whose title says "describe" or
  "specify" still means writing the markup of the files the step names. Your answer is the
  markup on the disk, never a description of it.
- Write the markup of the files the step names. The styles and the scripts are other roles'
  work: leave the hooks they need (\`id\`, \`data-*\`, the class names), do not write their rules.
- The body carries the script of the project: \`<script type="module" src="...">\` with the path
  the context names. The head carries the stylesheet only when the context says that the page
  loads it — the styles block above says how the styles reach the page in this project.
- Every path the page points at has to be on the disk: find it with \`list_files\` and
  \`search_files\` before you link it. A path you have not seen is a path that does not exist.
  The stylesheet of the project, the script of the project and the prepared pictures that the
  context names are the exceptions: other roles write or place them after you, and the context
  names them, so link them as they are named there.
- The rules of the document itself come to you at the write gate, right before you write it:
  the semantics, the accessibility, the names and the validity of the markup.

${vectorOnly ? '' : pageFrameRules()}

${UNTRUSTED}`;
}
