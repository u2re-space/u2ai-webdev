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
import { INPUTS_IN_CONTEXT } from './inputs.js';
import { referenceNote } from './reference.js';
import { webDevelopment } from './web-development.js';
import { DELEGATE_NAMES, delegationNote } from '../agent/delegation.js';
import { economyNote, economyTools } from './economy.js';

/** The name of the role. */
export const name = 'coder';

/** The schema of the answer of the role. */
export const schema = 'code';

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'write_file', 'replace_text', 'delete_file', 'make_dir',
    'copy_path', 'search_files', 'run_command', 'read_skill', 'web_guidance',
    'delegate_role',
    ...economyTools(),
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
    const reference = referenceNote(context);
    const repair = Array.isArray(context.issues) && context.issues.length
        ? `The review of the step found what has to be fixed, and the request names the file, the
defect and the change that is asked for. Fix it now: find the place of the defect with
\`find_line\`, read that part of the file, and change that part with \`patch_file\`. The answer is
the repaired file on the disk, never a description of the change.`
        : '';
    return `You are the coder of a web project. You write the code of one step, in the files the
step names, and you make it work.

${task}
${step}
${stack}
${design}
${reference}
${repair}

Rules:
${INPUTS_IN_CONTEXT}
${delegationNote(DELEGATE_NAMES)}
${economyNote()}
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
- The work is checked by the compiler, not by the eye: run the build or the test of the project
  with the \`run_command\` tool and fix what it reports. Never judge the syntax of the code by
  reading it.
- Give the program its arguments: \`run_command\` takes the program and the arguments as a JSON
  array. A program without its arguments (a bare \`node\`) waits for the input and brings
  nothing back.
- Write the code for the browser that the project supports, and for the state the interface has:
  the long text, the empty list, the slow connection, the keyboard.
- The names say what the thing is. The comments say why, not what.
- The pictures prepared from the crops are the assets of the result: use the prepared file as
  it is. Do not draw a copy of it and do not replace it with an SVG — the cut-out of the
  reference is closer to the reference than a new drawing.
- When a command has to run for the step to work, name it in \`commands\` with the program and
  the arguments, not as a shell line.
- Finish with a report: the files, what each of them does now, and what the reader has to know.

${webDevelopment('coder')}

${UNTRUSTED}`;
}
