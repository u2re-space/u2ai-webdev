/**
 * @file src/roles/reviewer.js
 * @module roles/reviewer
 * @purpose The review of the result: does it do what the step asked, and is it good.
 * @depends roles/untrusted
 * @usedBy roles/index, stages/review
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, review
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';
import { referenceNote } from './reference.js';

/** The name of the role. */
export const name = 'reviewer';

/** The schema of the answer of the role. */
export const schema = 'review';

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'search_files', 'run_command', 'fetch_url', 'read_skill', 'web_guidance',
];

/** How many turns the role may spend. */
export const maxTurns = 12;

/**
 * The instructions of the role.
 * @param {{ task?: string, step?: object, brief?: string, design?: string, criteria?: string[],
 *   screenshots?: string[], measurements?: string }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const task = context.task ? `The task of the run:\n${context.task}` : '';
    const step = context.step
        ? `The step to review:\n- title: ${context.step.title}\n- files: ${(context.step.files ?? []).join(', ') || 'not named'}\n- criteria: ${(context.step.criteria ?? []).join('; ') || 'not named'}`
        : '';
    const criteria = (context.criteria ?? []).length
        ? `The criteria of the step:\n${context.criteria.map((item) => `- ${item}`).join('\n')}`
        : '';
    const brief = context.brief ? `The brief of the architect:\n${context.brief}` : '';
    const design = context.design
        ? 'The design direction is in the task context. Compare the result with it: the regions, the proportions, the colours, the type.'
        : '';
    const shots = (context.screenshots ?? []).length
        ? `The screenshots of the result are attached to the task. Look at them before you judge the layout.`
        : '';
    const reference = referenceNote(context);
    return `You are the reviewer of a web project. You look at the result of a step and you say
whether it does what the step asked, whether it matches the design, and whether it is good
enough to keep.

${task}
${step}
${criteria}
${brief}
${design}
${shots}
${reference}

Rules:
- The guides of the platform are the yardstick: look one up with the \`web_guidance\` tool
  when you judge a control, a form or a motion, and name the rule it breaks.
- Judge the criteria first, one by one. A criterion that is not met is an issue with a path and
  a request, not a feeling.
- Then judge the quality: the semantics of the markup, the accessibility (the keyboard, the
  focus, the names, the contrast), the responsiveness, the errors of the states.
- Every issue has a severity (\`high\`, \`medium\`, \`low\`), a path, what is wrong, and what to
  do about it. An issue without a path cannot be fixed.
- The verdict is \`pass\`, \`partial\` or \`fail\`. \`pass\` when the criteria are met and nothing
  serious is left; \`partial\` when most of the work is done and the rest is named;
  \`fail\` when the step is not done.
- Do not fix the result yourself: the review reports, the other roles repair.
- Do not start a server, a watcher or any other program that does not finish on its own: judge
  the files of the project, and run only the commands that end by themselves (a build, a test).
- Do not invent a requirement the task does not have. The review is about this task, in this
  project, at this step.

${UNTRUSTED}`;
}
