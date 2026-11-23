/**
 * @file src/roles/coder.js
 * @module roles/coder
 * @purpose The code of one step: the files, the logic and the commands that make it work.
 * @depends roles/untrusted
 * @usedBy roles/index, roles/chunks, stages/coding
 * @exports name, schema, tools, maxTurns, instructions, CODE_RULES
 * @ai.tags roles, code
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';
import { INPUTS_IN_CONTEXT } from './inputs.js';
import { referenceNote } from './reference.js';
import { CORE, HTML } from './web-development.js';
import { coderStyleNote } from './style-note.js';
import { DELEGATE_NAMES, delegationNote } from '../agent/delegation.js';
import { economyTools } from './economy.js';
import { devToolsMarker, devToolsNote } from './devtools.js';

/** The name of the role. */
export const name = 'coder';

/** The schema of the answer of the role. */
export const schema = 'code';

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'write_file', 'replace_text', 'delete_file', 'make_dir',
    'copy_path', 'search_files', 'run_command', 'read_skill', 'web_guidance',
    'call_ai_memory',
    'delegate_role',
    ...economyTools(),
    devToolsMarker(),
];

/** How many turns the role may spend. */
export const maxTurns = 24;

/**
 * The craft of the code: the rules that hold for a script of the project.
 *
 * The text is not in the prompt of the role: it comes at the write gate, right before the
 * code is written. A rule of the code in the middle of the reading of the project is a rule
 * the model does not need yet, and one it forgets by the time it writes.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const CODE_RULES = [CORE, HTML, `#### The boundaries of the work
- The platform of today comes before the habit of yesterday: look the guides up with the
  \`web_guidance\` tool before you write a dialog, a form or a table, and follow what they
  say.
- Follow the structure and the tokens of the architect. A file that is not in the plan is not
  created.
- The environment is the work of another stage: the manifest, the lock file and the config of
  the bundler are written before the markup, and the dependencies are installed there. Do not
  install the dependencies, do not change \`package.json\` or the lock file, and do not run
  \`npm install\` or \`npm ci\`. If a dependency is missing, say so in the report and go on.
- The stylesheets are written before your code, and they are its contract: read the stylesheets
  of the project before you write the code and use the names they give — when there are no
  stylesheets yet, use the class names of the markup and the tokens of the architect. Do not
  change the stylesheets: the styles are the styler's work, and a name that changes under the
  written code breaks the page.
- The states of the interface are named in the brief of the architect, and that list is the contract
  between you and the styler: put on the node exactly those states, with exactly those selectors,
  and no others. A state the list does not name is a class the styles will never dress; a state of
  the list that you do not put is a state the page never shows. The styles and the scripts are
  written against the list, and neither of them waits for the other: the styles of a page with a
  state are written before the scripts are, and the scripts follow the list, not the stylesheet.
- The production build of the project is the work of the stage \`build\`, which runs after the
  styles and after the code. A build that fails because the styles are not there yet is not
  your defect: do not chase it and do not start a loop of build-and-fix. The harness compiles
  the files of your step; run the tests or the lint of the project when they exist.
- One build is enough. Do not run the production build at all: it is the work of the stage
  \`build\`, and a build that fails because the styles are not there yet says nothing about
  your code. Run the tests of the project (\`npm test\`) or the lint — and if a test fails
  because of your own file, fix that file and stop there. A loop of build-and-fix over the
  whole project is how a run turns a working page into a broken one.
- The work is checked by the compiler, not by the eye: read what the compiler says about
  your own files and fix that. Never judge the syntax of the code by reading it.
- Give the program its arguments: \`run_command\` takes the program and the arguments as a JSON
  array. A program without its arguments (a bare \`node\`) waits for the input and brings
  nothing back.
- Write the code for the browser that the project supports, and for the state the interface has:
  the long text, the empty list, the slow connection, the keyboard.
- Read the files you change first, and follow the style of the project: its naming, its module
  format, its import order, its lint rules.`].join('\n\n');

/**
 * The instructions of the role: the spine of the work, not the craft of the code.
 *
 * The spine says who the role is, what the step is and what the answer has to be. The craft
 * of the script (see `CODE_RULES`) comes at the write gate — the rules of a script in the
 * middle of the reading of the project are rules the model does not need yet.
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
    const styles = context.styles?.source
        ? coderStyleNote(context.styles)
        : '';
    const design = context.design
        ? `The design direction, palette and any existing measurements are in the task context. Measurements are optional; use DESIGN.md and the attached reference image directly.`
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
${styles}
${reference}
${repair}

Rules:
${INPUTS_IN_CONTEXT}
${delegationNote(DELEGATE_NAMES)}
${devToolsNote({
    url: context?.pageUrl || context?.config?.browser?.url || null,
    width: context?.config?.browser?.viewport?.width ?? null,
})}
- The title of the step is not the kind of work: a step whose title says "describe" or
  "specify" still means writing the files the step names. Your answer is the work on the
  disk, never a description of the work.
- The class names and the tokens of the stylesheets are the contract of your code: use the
  names they give, and do not change the stylesheets — the styles are the styler's work, and
  a name that changes under the written code breaks the page. The markup names the classes,
  the stylesheet gives them a shape, and neither role renames what the other wrote. Your
  work is the code of your step.
- The pictures prepared from the crops are the assets of the result: use the prepared file as
  it is. Do not draw a copy of it and do not replace it with an SVG — the cut-out of the
  reference is closer to the reference than a new drawing.
- When a command has to run for the step to work, name it in \`commands\` with the program and
  the arguments, not as a shell line.
- The rules of the script itself come to you at the write gate, right before you write it: the
  structure, the boundaries of the environment, the compiler and the states of the interface.
- Finish with a report: the files, what each of them does now, and what the reader has to know.

${UNTRUSTED}`;
}
