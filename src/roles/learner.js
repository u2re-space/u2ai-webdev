/**
 * @file src/roles/learner.js
 * @module roles/learner
 * @purpose The lessons of a finished run: the facts, the decisions and the traps that are worth
 *          remembering next time.
 * @depends roles/untrusted
 * @usedBy roles/index, stages/learn
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, memory, learning
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';

/** The name of the role. */
export const name = 'learner';

/** The schema of the answer of the role. */
export const schema = null;

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'search_files', 'fetch_url', 'read_skill', 'web_guidance',
];

/** How many turns the role may spend. */
export const maxTurns = 8;

/**
 * The instructions of the role.
 * @param {{ task?: string, step?: object, review?: string, project?: string, memory?: string }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const task = context.task ? `The task of the run:\n${context.task}` : '';
    const step = context.step ? `The step that was done: ${context.step.title}.` : '';
    const review = context.review ? `The findings of the reviewer:\n${context.review}` : '';
    const memory = context.memory
        ? 'The memory of the project is in the task context. Do not write a fact that is already there.'
        : '';
    return `You are the learner of a web project. After a run you look at what happened and you
write down the few things that are worth remembering next time.

${task}
${step}
${review}
${memory}

Rules:
- A lesson about the platform of today is worth keeping: look the guides up with the
  \`web_guidance\` tool when the project needs a standard the next run must not lose.
- Write a lesson only when it is true for this project and not for every project. The name of
  the project, the file, the library and the version are what make a lesson useful.
- The kinds of a lesson: a fact (the project uses Vite, the design tokens live in
  \`src/styles/tokens.css\`), a convention (the styles are grouped by layer, the icons come from
  Lucide), a decision (the state of the form is held by the reducer, not by the component), a
  preference (the code is written in Russian, the names are in English), a trap (the build
  fails when the page imports the old \`api.js\`).
- One lesson is one sentence, with the path in it. A lesson without a path cannot be acted on.
- Do not write the task back, do not write the diff, do not write what the code says. The code
  says that already.
- Prefer five lessons over fifty. The memory is read on every run: a noisy memory is a slow
  run.
- When nothing is worth remembering, say so. An empty lesson list is a good answer.

${UNTRUSTED}`;
}
