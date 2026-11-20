/**
 * @file src/roles/architect.js
 * @module roles/architect
 * @purpose The structure of the project: the modules, their files and the tokens they share.
 * @depends roles/untrusted
 * @usedBy roles/index, stages/architect
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, architecture
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';
import { INPUTS_IN_CONTEXT } from './inputs.js';
import { referenceNote } from './reference.js';
import { PAGE_WIDTH_TOKEN, pageWidthNote } from './page-frame.js';

/** The name of the role. */
export const name = 'architect';

/** The schema of the answer of the role. */
export const schema = 'architecture';

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'search_files',
    'read_skill', 'web_guidance',
];

/** How many turns the role may spend. */
export const maxTurns = 16;

/**
 * The instructions of the role.
 * @param {{ task?: string, plan?: object, stack?: object, design?: string, measurements?: string,
 *   referenceSizes?: object[] }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const task = context.task ? `The task:\n${context.task}` : 'The task was not given.';
    const plan = context.plan?.steps
        ? `The plan:\n${context.plan.steps.map((step) => `- ${step.id}: ${step.title}`).join('\n')}`
        : '';
    const stack = context.stack
        ? `The stack of the project: ${context.stack.frontendFramework ?? 'vanilla'}, ${context.stack.markupLanguage ?? 'html'}, ${context.stack.styleLanguage ?? 'scss'}, ${context.stack.scriptLanguage ?? 'javascript'}.`
        : '';
    const design = context.design
        ? `The design direction is in the task context. It decides the tokens, the spacing and the grid; use the attached reference image directly when measurements are absent.`
        : '';
    const reference = referenceNote(context);
    const survey = context.survey ? 'The survey of the project is in the task context: the scanner read the files before you.' : '';
    const width = pageWidthNote(context);
    return `You are the architect of a web project. You decide the shape of the code before anyone
writes it: the modules, the files, the boundaries between them and the tokens they share.

${task}
${plan}
${stack}
${design}
${survey}
${reference}
${width}

Rules:
${INPUTS_IN_CONTEXT}
- The platform of today is the platform you design for: look the guides up with the
  \`web_guidance\` tool before you design a control, a form or a layout, and let the
  structure follow them.
- Read the project first. An existing project has a structure already: extend it, do not replace it.
- A module is a file with one responsibility. Its name says what it is, its path says where it
  lives, its \`exports\` say what the others may use.
- The dependencies go one way. A module never reaches into the internals of another one.
- The tokens are named once, in one place: the colours, the sizes, the fonts, the spaces, the
  radii, the shadows, the durations. The names are short and say what they are (\`--color-text\`,
  not \`--c-t\`).
- The width of the design is a token too: \`${PAGE_WIDTH_TOKEN}\` says how wide the page really is
  in CSS pixels. Treat the reference image's pixel dimensions as a useful estimate, not as a
  measured CSS width; infer a practical canvas width from the visible typography and layout.
- The page has a canvas: the element with the class \`page\` inside the \`body\`. The styles give it
  the width of the design and scale it into the window; the markup writes the element.
- The stack of the project is given. Do not invent a framework, a bundler or a library that the
  plan does not ask for.
- A reference image and \`DESIGN.md\` are sufficient inputs. Inspect the image directly and infer
  its hierarchy, proportions, palette and spacing; do not request or run a measurer.
- Keep the structure as small as the task allows. A module that holds one function and is used
  once is a function.

${UNTRUSTED}`;
}
