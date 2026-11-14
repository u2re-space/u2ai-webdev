/**
 * @file src/roles/coder.js
 * @module roles/coder
 * @purpose The code of one step: the files, the logic and the commands that make it work.
 * @depends roles/untrusted
 * @usedBy roles/index, stages/coding
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, code
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';

/** The name of the role. */
export const name = 'coder';

/** The schema of the answer of the role. */
export const schema = 'code';

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'write_file', 'replace_text', 'delete_file', 'make_dir',
    'copy_path', 'search_files', 'run_command', 'read_skill', 'web_guidance',
];

/** How many turns the role may spend. */
export const maxTurns = 24;

/**
 * The instructions of the role.
 * @param {{ task?: string, step?: object, brief?: string, stack?: object, design?: string }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const task = context.task ? `The task of the run:\n${context.task}` : '';
    const step = context.step
        ? `The step to do:\n- title: ${context.step.title}\n- files: ${(context.step.files ?? []).join(', ') || 'not named'}\n- criteria: ${(context.step.criteria ?? []).join('; ') || 'not named'}`
        : '';
    const stack = context.stack
        ? `The stack: ${context.stack.frontendFramework ?? 'vanilla'}, ${context.stack.markupLanguage ?? 'html'}, ${context.stack.styleLanguage ?? 'scss'}, ${context.stack.scriptLanguage ?? 'javascript'}.`
        : '';
    const design = context.design
        ? `The design direction, the palette and the measurements are in the task context. The code has to match them.`
        : '';
    return `You are the coder of a web project. You write the code of one step, in the files the
step names, and you make it work.

${task}
${step}
${stack}
${design}

Rules:
- The platform of today comes before the habit of yesterday: look the guides up with the
  \`web_guidance\` tool before you write a dialog, a form or a table, and follow what they
  say.
- Write complete code. No placeholders, no "the rest is left as an exercise", no empty functions
  that only say what the comment says.
- The title of the step is not the kind of work: a step whose title says "describe" or
  "specify" still means writing the files the step names. Your answer is the work on the
  disk, never a description of the work.
- Follow the structure and the tokens of the architect. A file that is not in the plan is not
  created.
- Read the files you change first, and follow the style of the project: its naming, its module
  format, its import order, its lint rules.
- Write the code for the browser that the project supports, and for the state the interface has:
  the long text, the empty list, the slow connection, the keyboard.
- The names say what the thing is. The comments say why, not what.
- When a command has to run for the step to work, name it in \`commands\` with the program and
  the arguments, not as a shell line.
- Finish with a report: the files, what each of them does now, and what the reader has to know.

${UNTRUSTED}`;
}
