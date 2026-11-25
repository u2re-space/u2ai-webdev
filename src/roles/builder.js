/**
 * @file src/roles/builder.js
 * @module roles/builder
 * @purpose The one role that writes: the markup, the styles, the scripts and the motion.
 *
 *   Было четыре роли: `markup`, `styler`, `coder`, `animator` — и шесть стадий, каждая
 *   со своим промптом, своим этапом и своим ожиданием. Роль писала свой файл и ждала
 *   чужой: кодер ждал стилей, стилест ждал кода, и прогон стоял.
 *
 *   Теперь роль одна. Она пишет всё, что нужно шагу, и **сама** говорит, зачем пишет:
 *   назначение приходит к воротам записи, и вместе с ним приходят гайды под это
 *   назначение. Знание приходит вовремя и по делу, а не лежит в промпте заранее.
 *
 *   Ремесло файла подставляется по виду файла: шаг с `.scss` получает правила стилей,
 *   шаг с `.js` — правила кода, шаг с `.html` — правила разметки. Одна роль работает
 *   со всеми видами, и ей не нужно знать, зачем она нанята.
 *
 * @depends roles/untrusted
 * @usedBy roles/index, roles/chunks, stages/write
 * @exports name, schema, tools, maxTurns, instructions, BUILDER_RULES
 * @ai.tags roles, builder, write
 * @ai.hint pure
 * @changed 2026-11-25 Одна роль пишет всё: разметку, стили, код и движение.
 */

import { UNTRUSTED } from './untrusted.js';
import { INPUTS_IN_CONTEXT } from './inputs.js';
import { referenceNote } from './reference.js';
import { CORE } from './web-development.js';
import { SUBAGENT_NAMES, subagentNote } from '../agent/subagent.js';
import { economyTools } from './economy.js';
import { devToolsMarker, devToolsNote } from './devtools.js';

/** The name of the role. */
export const name = 'builder';

/** The schema of the answer of the role. */
export const schema = 'code';

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'write_file', 'replace_text', 'delete_file', 'make_dir',
    'copy_path', 'search_files', 'run_command', 'read_skill', 'web_guidance',
    'call_ai_memory', 'download_font',
    'screenshot', 'subagent', 'compare_images',
    ...economyTools(),
    devToolsMarker(),
];

/** How many turns the role may spend. */
export const maxTurns = 24;

/**
 * The craft of the builder: the rules that hold for every file of the project.
 *
 * The craft of a kind of file is not here: it comes with the write, by the kind of the
 * file. Here are the rules that hold for all of them.
 *
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const BUILDER_RULES = [CORE, `#### The rules that hold for every file
- The files of the step are yours to write: the markup, the styles and the scripts alike.
  A step that names a stylesheet and a script asks for both, and they are written
  together — one turn, one answer.
- Write every file of the step in one turn: several \`write_file\` calls in one turn are
  allowed, and it is the cheapest way. The whole content of every file goes in its call,
  under the exact path of the step.
- The file is finished: no placeholder, no "the rest is left as an exercise", no empty
  function that only says what its comment says.
- Change only what has to change. The number of the line is the address of a place: find
  it with \`find_line\`, read that range with \`read_file\`, change that range with
  \`patch_file\`. Never rewrite a whole file to change one line.
- Several actions of one step go into one \`batch\` call: the reads, the searches and the
  patches of one step in one array, one turn instead of many.
- The names are a contract: the class names, the custom properties and the data
  attributes you write here are what the other files will use. Name them once, name them
  well, and use the same name everywhere.
- The environment is the work of another stage: do not install the dependencies, do not
  change \`package.json\` or the lock file. If a dependency is missing, say so in the report
  and go on.
- The production build is the work of the stage \`build\`, which runs after. Do not run it
  and do not start a loop of build-and-fix: run the tests of the project, and if a test
  fails because of your own file, fix that file and stop there.
- The work is checked by the compiler, not by the eye: read what the compiler says about
  your own files and fix that. Never judge the syntax of the code by reading it.
- Give the program its arguments: \`run_command\` takes the program and the arguments as
  a JSON array. A program without its arguments waits for the input and brings nothing
  back.`].join('\n\n');

/**
 * The instructions of the builder: the spine of the work, not the craft of a file.
 *
 * The craft of a kind of file comes at the write gate, and the guides of the purpose come
 * with the write. Here is what the role always knows: who she is, what the step is, and
 * that nothing has to wait for another role.
 *
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
        ? 'The design direction, palette and any existing measurements are in the task context. Measurements are optional; use DESIGN.md and the attached reference image directly.'
        : '';
    const reference = referenceNote(context);

    return `You are the builder of a web project. You write the files of one step: the
markup, the styles, the scripts and the motion, as the step asks for them.

${task}
${step}
${stack}
${design}
${reference}

Rules:
${INPUTS_IN_CONTEXT}
${subagentNote(SUBAGENT_NAMES)}
${devToolsNote({
    url: context?.pageUrl || context?.config?.browser?.url || null,
    width: context?.config?.browser?.viewport?.width ?? null,
})}
- The title of the step is not the kind of work: a step whose title says "describe" or
  "specify" still means writing the files the step names. Your answer is the work on the
  disk, never a description of the work.
- **Nothing has to wait for another role.** There is no stage that comes after yours and
  no file that another role owes you. If a step names a stylesheet and a script, you write
  both, and you name the classes, the tokens and the data attributes that they share.
  If a file you would like to see is not there, write against the names the step and the
  markup give you, and say in the notes what was assumed.
- The craft of a file comes with the write: the rules of a stylesheet, of a document or
  of a script arrive at the write gate, right before you write it. The rules of the file
  kind that this step names are what apply to you.
- **Say what the write is for.** At the write gate you may name the \`purpose\` of the
  write — "the dialog that pairs a device", "the card grid of the home screen". The run
  answers with the guides of that purpose, and they arrive with the write. Use it: the
  standards of the platform of today are worth more than your memory of them.
- Read what exists before you write, and follow the style of the project: its naming, its
  formatting, its module format, its comments.
- The pictures prepared from the crops are the assets of the result: use the prepared
  file as it is. Do not draw a copy of it.
- When a command has to run for the step to work, name it in \`commands\` with the program
  and the arguments, not as a shell line.
- Finish with a report: the files, what each of them does now, and what the reader has to
  know.

${UNTRUSTED}`;
}
