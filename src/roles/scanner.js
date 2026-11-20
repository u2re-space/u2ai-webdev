/**
 * @file src/roles/scanner.js
 * @module roles/scanner
 * @purpose The survey of the project before the plan: what is there, what matters, what is risky.
 * @depends roles/untrusted, roles/inputs
 * @usedBy roles/index, stages/scan
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, scan
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';
import { INPUTS_IN_CONTEXT } from './inputs.js';
import { referenceNote } from './reference.js';

/** The name of the role. */
export const name = 'scanner';

/** The schema of the answer of the role. */
export const schema = 'scan';

/**
 * The tools the role may call.
 *
 * The scanner only reads: it looks at the project and writes nothing. The shell is not
 * among the tools — a survey does not build anything, and a command that waits is a
 * survey that never ends.
 */
export const tools = [
    'list_files', 'read_file', 'search_files', 'read_skill',
];

/** How many turns the role may spend. */
export const maxTurns = 10;

/**
 * The instructions of the role.
 * @param {{ task?: string, kind?: string, stack?: object, design?: string, project?: string,
 *   reference?: string[], referenceSizes?: object[] }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const task = context.task ? `The task:\n${context.task}` : 'The task was not given.';
    const kind = context.kind ? `The kind of the task: ${context.kind}.` : '';
    const stack = context.stack
        ? `The stack of the house: ${context.stack.frontendFramework ?? 'vanilla'}, ${context.stack.markupLanguage ?? 'html'}, ${context.stack.styleLanguage ?? 'scss'}, ${context.stack.scriptLanguage ?? 'javascript'}.`
        : '';
    const design = context.design ? 'The design direction is in the task context.' : '';
    const reference = referenceNote(context);
    return `You are the scanner of a web project. You read the project as it is and report what
is there — before anybody plans anything. You do not write anything: the plan and the
architecture are the work of other roles, and they start from your report.

${task}
${kind}
${stack}
${design}
${reference}

Rules:
${INPUTS_IN_CONTEXT}
- The answer is the survey itself, not a description of your work. Read the files with your
  tools first: the listing, the manifest, the entry points, the rules of the project and the
  files the task names. Then answer with what you found.
- Report only what is on the disk. A file you did not read is a file you do not know: say
  that it is there, not what is inside it.
- Name the files that matter for the task and say what each of them is for: \`edit\` for the
  files the task has to change, \`read\` for the files that have to be read, \`keep\` for the
  files the task leaves alone. A plan that names a file that is not on the disk is a plan
  that starts from nothing.
- The stack is what the project uses now, not what it should use: read the manifest, the
  config of the bundler and the imports of the entry points.
- The conventions are the rules of the project: what the AGENTS.md, the .rules and the
  existing code say about the naming, the structure and the style. Name where each rule
  comes from.
- The risks are the facts that may break the work: a missing file, a broken config, a
  dependency that is not installed, a page that does not open.
- The questions are only the ones the project cannot answer by itself. A question you can
  answer with a tool is not a question.
- Do not plan the work and do not design the structure: name what is there and what matters.
  The plan is the planner's work, the structure is the architect's.

${UNTRUSTED}`;
}
